//! Pusaka — NEP-171 NFTs that each control a native Bitcoin address via NEAR Chain Signatures.
//!
//! The BTC key for token `N` is derived by the MPC network from (this contract, "pusaka-N").
//! Only this contract can request signatures for it, and it only does so for the current
//! NFT owner. Owning the NFT therefore *is* owning the BTC.

mod art;
mod btc;

use near_contract_standards::non_fungible_token::core::NonFungibleTokenCore;
use near_contract_standards::non_fungible_token::enumeration::NonFungibleTokenEnumeration;
use near_contract_standards::non_fungible_token::metadata::{
    NFTContractMetadata, NonFungibleTokenMetadataProvider, TokenMetadata, NFT_METADATA_SPEC,
};
use near_contract_standards::non_fungible_token::events::NftMint;
use near_contract_standards::non_fungible_token::{NonFungibleToken, Token, TokenId};
use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::{self, json, Value};
use near_sdk::store::LookupMap;
use near_sdk::{
    env, near, require, AccountId, BorshStorageKey, Gas, GasWeight, NearToken, PanicOnDefault,
    Promise, PromiseOrValue,
};

const MAX_INPUTS: usize = 8;
const KEY_TGAS: u64 = 10;
const SIGN_TGAS: u64 = 15;
const CALLBACK_TGAS: u64 = 20;
const MAX_HISTORY: usize = 32;
/// ~10 minutes; MPC yields time out well before this.
const PENDING_TIMEOUT_BLOCKS: u64 = 600;
/// Reserved per token, sized for the worst case: 32 history entries of ~170 bytes
/// (a Sale between two 64-char accounts) + listing + BTC key + pending flag ≈ 5.9 KB.
const TOKEN_RESERVE_BYTES: u64 = 8_000;
/// Per recorded signed outpoint (64-char txid + vout + Vec overhead), rounded up.
const OUTPOINT_BYTES: u64 = 120;
/// One "{token}:{chain}" -> u64 entry, rounded up.
const ETH_NONCE_BYTES: u64 = 120;
/// One proven UTXO (64-char txid + vout + value + Vec overhead), rounded up.
const PROVEN_BYTES: u64 = 140;
const PROOF_TGAS: u64 = 40;
/// Sealed holder letter, base64 ciphertext.
const MAX_LETTER: usize = 2000;
/// Proving dust would let anyone bloat a token's registry; below this a deposit isn't provable.
const MIN_PROVEN_SATS: u64 = 10_000;
/// Proven, unspent deposits kept per token (withdrawing consolidates them).
const MAX_PROVEN: usize = 64;
/// After a signature for a token, outside markets can't be approved for this long. A buyer
/// there can't pass a sign epoch, so this keeps "revoke, withdraw, re-approve" from emptying
/// a Pusaka between a buyer's look and their purchase.
#[cfg(not(feature = "mainnet"))]
const APPROVE_COOLDOWN_MS: u64 = 3_600_000; // 1 hour
#[cfg(feature = "mainnet")]
const APPROVE_COOLDOWN_MS: u64 = 86_400_000; // 1 day
/// Near-One's Bitcoin light client (Omni Bridge). Testnet build tracks Bitcoin testnet3.
#[cfg(not(feature = "mainnet"))]
const BTC_LIGHT_CLIENT: &str = "btc-client-v4.testnet";
#[cfg(not(feature = "mainnet"))]
const BTC_MIN_CONFIRMATIONS: u64 = 1;
#[cfg(feature = "mainnet")]
const BTC_LIGHT_CLIENT: &str = "btc-client.bridge.near"; // Near-One, synced to Bitcoin mainnet
#[cfg(feature = "mainnet")]
const BTC_MIN_CONFIRMATIONS: u64 = 6;
/// EVM chains a Pusaka may sign for. Kept to what the UI shows, so a seller can't hide a
/// signature on a chain buyers don't look at. Testnet build: Sepolia; `--features mainnet`: Ethereum.
#[cfg(not(feature = "mainnet"))]
pub const EVM_CHAINS: [u64; 3] = [11155111, 84532, 421614]; // Sepolia, Base Sepolia, Arbitrum Sepolia
#[cfg(feature = "mainnet")]
pub const EVM_CHAINS: [u64; 3] = [1, 8453, 42161]; // Ethereum, Base, Arbitrum One
/// Creator royalty on every resale (basis points), paid by our market and by NEP-199 markets.
pub const ROYALTY_BPS: u128 = 250;
/// Ed25519 domain of the MPC network (Solana keys).
const ED25519_DOMAIN: u32 = 1;
/// NEAR MPC confidential key derivation (BLS12-381).
const CKD_DOMAIN: u32 = 2;

#[derive(BorshStorageKey)]
#[near]
enum Key {
    Owners,
    TokenMeta,
    Enumeration,
    BtcKeys,
    Listings,
    Pending,
    Signed,
    History,
    Loans,
    EthNonces,
    SignEpoch,
    Proven,
    Approvals,
    SignedAt,
}

/// A deposit proven on NEAR: the Bitcoin light client confirmed its transaction is in the
/// main chain, and the contract checked the output pays this token's address.
#[near(serializers = [json, borsh])]
#[derive(Clone, PartialEq, Debug)]
pub struct ProvenUtxo {
    pub txid: String,
    pub vout: u32,
    pub value: U64,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Utxo {
    /// Explorer-style (big-endian) txid hex.
    pub txid: String,
    pub vout: u32,
    pub value: U64,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, PartialEq, Debug)]
pub struct OutPointRef {
    pub txid: String,
    pub vout: u32,
}

/// A sale. With `floor < price` it is a Dutch auction: the price falls linearly from
/// `price` at `start_ms` to `floor` at `end_ms`, then stays there.
#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Listing {
    pub seller: AccountId,
    pub price: NearToken,
    pub floor: NearToken,
    pub start_ms: U64,
    pub end_ms: U64,
}

impl Listing {
    pub fn price_at(&self, now_ms: u64) -> NearToken {
        let (start, end) = (self.start_ms.0, self.end_ms.0);
        if now_ms >= end || end <= start {
            return self.floor;
        }
        let (hi, lo) = (self.price.as_yoctonear(), self.floor.as_yoctonear());
        let (span, e, d) = (hi - lo, now_ms.saturating_sub(start) as u128, (end - start) as u128);
        // span * e / d without overflowing u128 for large prices and long auctions
        NearToken::from_yoctonear(hi - (span / d * e + span % d * e / d))
    }
}

/// A peer-to-peer loan with the Pusaka (and the BTC inside) as collateral.
/// Requested by the owner, funded by a lender, then either repaid or claimed after `due_ms`.
#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Loan {
    pub borrower: AccountId,
    pub principal: NearToken,
    pub repay: NearToken,
    pub duration_ms: U64,
    pub lender: Option<AccountId>,
    pub due_ms: Option<U64>,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
#[serde(tag = "kind")]
pub enum Event {
    Mint { owner: AccountId },
    Listed { price: NearToken },
    Unlisted,
    Sale { from: AccountId, to: AccountId, price: NearToken },
    Transfer { from: AccountId, to: AccountId },
    Withdraw { inputs: u32, amount_sat: U64, signed: u32 },
    LoanRequested { principal: NearToken, repay: NearToken, duration_ms: U64 },
    LoanCancelled,
    LoanFunded { lender: AccountId, due_ms: U64 },
    LoanRepaid { lender: AccountId, amount: NearToken },
    LoanDefaulted { lender: AccountId },
    WithdrawEth { chain_id: U64, nonce: U64, value_wei: U128, signed: bool },
    Approved { account: AccountId },
    ApprovalsRevoked,
    WithdrawErc20 { chain_id: U64, nonce: U64, token: String, amount: U128, signed: bool },
    WithdrawSol { lamports: U64, signed: bool },
    WithdrawNear { nonce: U64, amount: NearToken, signed: bool },
    Royalty { creator: AccountId, amount: NearToken },
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Entry {
    pub at_ms: U64,
    pub event: Event,
}

/// Everything the UI needs about one token, in one view call.
#[near(serializers = [json])]
pub struct TokenInfo {
    pub token: Token,
    pub btc_path: String,
    /// 33-byte compressed secp256k1 key (hex); `None` until the MPC key callback lands.
    pub btc_pubkey: Option<String>,
    pub listing: Option<Listing>,
    /// Current price if listed (Dutch auctions fall over time).
    pub price_now: Option<NearToken>,
    pub loan: Option<Loan>,
    pub pending: bool,
    /// Pass this to `buy` / `fund_loan`.
    pub sign_epoch: u32,
    pub signed_outpoints: Vec<OutPointRef>,
    /// Deposits proven by the on-chain Bitcoin light client.
    pub proven_utxos: Vec<ProvenUtxo>,
    /// Sum of proven deposits that were never signed for: trustless, no indexer needed.
    /// Only this contract can request signatures for the address, and every signature
    /// request is recorded, so a proven, never-signed UTXO cannot have been spent.
    pub verified_sats: U64,
    pub history: Vec<Entry>,
}

/// Returned by `on_eth_signed`: the client serialises the EIP-1559 tx with this signature.
#[near(serializers = [json])]
pub struct SignedEth {
    /// keccak256 of the unsigned EIP-1559 payload the MPC signed (hex).
    pub sighash: String,
    pub signature: Option<Value>,
}

/// Returned by `withdraw_sol`: the client prepends the signature to the message and broadcasts.
#[near(serializers = [json])]
pub struct SignedSol {
    /// The Solana legacy message the MPC signed (base64).
    pub message: String,
    /// The token's Solana address (base58).
    pub from: String,
    pub signature: Option<Value>,
}

/// Returned by `withdraw_near`: the client appends the signature to the tx and broadcasts.
#[near(serializers = [json])]
pub struct SignedNear {
    /// Borsh `Transaction` the MPC signed the sha256 of (base64).
    pub transaction: String,
    /// The token's NEAR implicit account (hex of its Ed25519 key).
    pub account: String,
    pub signature: Option<Value>,
}

/// Returned by `on_signed`: the client attaches witnesses and broadcasts.
#[near(serializers = [json])]
pub struct SignedSpend {
    pub unsigned_tx: String,
    pub btc_pubkey: String,
    /// One per input, raw MPC `SignatureResponse` JSON; `None` if that signature failed.
    pub signatures: Vec<Option<Value>>,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Pusaka {
    tokens: NonFungibleToken,
    mpc: AccountId,
    next_id: u64,
    btc_keys: LookupMap<TokenId, Vec<u8>>,
    listings: LookupMap<TokenId, Listing>,
    pending: LookupMap<TokenId, u64>, // token -> block height of the sign request
    signed: LookupMap<TokenId, Vec<OutPointRef>>,
    history: LookupMap<TokenId, Vec<Entry>>,
    loans: LookupMap<TokenId, Loan>,
    /// "{token}:{chain_id}" -> lowest EVM nonce that has never been signed for.
    eth_nonces: LookupMap<String, u64>,
    /// token -> number of signature requests ever made (BTC inputs + EVM txs). Buyers and
    /// lenders pass the value they checked; any new signature in between fails the call.
    sign_epoch: LookupMap<TokenId, u32>,
    proven: LookupMap<TokenId, Vec<ProvenUtxo>>,
    /// token -> time (ms) of its latest signature request; gates NEP-178 approvals.
    signed_at: LookupMap<TokenId, u64>,
}

/// Layout before `signed_at`; read once by `migrate`.
#[near(serializers = [borsh])]
struct PusakaV5 {
    tokens: NonFungibleToken,
    mpc: AccountId,
    next_id: u64,
    btc_keys: LookupMap<TokenId, Vec<u8>>,
    listings: LookupMap<TokenId, Listing>,
    pending: LookupMap<TokenId, u64>,
    signed: LookupMap<TokenId, Vec<OutPointRef>>,
    history: LookupMap<TokenId, Vec<Entry>>,
    loans: LookupMap<TokenId, Loan>,
    eth_nonces: LookupMap<String, u64>,
    sign_epoch: LookupMap<TokenId, u32>,
    proven: LookupMap<TokenId, Vec<ProvenUtxo>>,
}


pub fn btc_path(token_id: &str) -> String {
    format!("pusaka-{token_id}")
}

#[near]
impl Pusaka {
    #[init]
    pub fn new(mpc: AccountId) -> Self {
        Self {
            tokens: NonFungibleToken::new(
                Key::Owners,
                env::current_account_id(),
                Some(Key::TokenMeta),
                Some(Key::Enumeration),
                Some(Key::Approvals), // NEP-178: approved markets can sell it; BTC is frozen meanwhile
            ),
            mpc,
            next_id: 1,
            btc_keys: LookupMap::new(Key::BtcKeys),
            listings: LookupMap::new(Key::Listings),
            pending: LookupMap::new(Key::Pending),
            signed: LookupMap::new(Key::Signed),
            history: LookupMap::new(Key::History),
            loans: LookupMap::new(Key::Loans),
            eth_nonces: LookupMap::new(Key::EthNonces),
            sign_epoch: LookupMap::new(Key::SignEpoch),
            proven: LookupMap::new(Key::Proven),
            signed_at: LookupMap::new(Key::SignedAt),
        }
    }

    /// One-time upgrade from the layout without `signed_at`; also turns on NEP-178 approvals
    /// for contracts deployed without them.
    #[private]
    #[init(ignore_state)]
    pub fn migrate() -> Self {
        let old: PusakaV5 = env::state_read().expect("no state");
        let mut this = Self {
            tokens: old.tokens,
            mpc: old.mpc,
            next_id: old.next_id,
            btc_keys: old.btc_keys,
            listings: old.listings,
            pending: old.pending,
            signed: old.signed,
            history: old.history,
            loans: old.loans,
            eth_nonces: old.eth_nonces,
            sign_epoch: old.sign_epoch,
            proven: old.proven,
            signed_at: LookupMap::new(Key::SignedAt),
        };
        if this.tokens.approvals_by_id.is_none() {
            let prefix = near_sdk::IntoStorageKey::into_storage_key(Key::Approvals);
            this.tokens.approvals_by_id = Some(near_sdk::collections::LookupMap::new(prefix.clone()));
            this.tokens.next_approval_id_by_id = Some(near_sdk::collections::LookupMap::new([prefix, b"n".to_vec()].concat()));
        }
        this
    }

    // ---------- mint ----------

    /// Mints a Pusaka and asks the MPC contract for its derived BTC key. Attach ~0.02 NEAR for storage.
    #[payable]
    pub fn nft_mint(&mut self, receiver_id: Option<AccountId>) -> Promise {
        let before = env::storage_usage();
        let id = self.next_id.to_string();
        self.next_id += 1;
        let owner = receiver_id.unwrap_or_else(env::predecessor_account_id);
        self.tokens.internal_mint_with_refund(
            id.clone(),
            owner.clone(),
            Some(TokenMetadata {
                title: Some(format!("Pusaka #{id}")),
                description: Some("An NFT that holds native Bitcoin.".into()),
                // ponytail: creator lives in metadata.extra so royalties need no new state; tokens
                // minted before this have none and pay no royalty.
                extra: Some(json!({ "creator": env::predecessor_account_id() }).to_string()),
                ..empty_meta()
            }),
            None,
        );
        // internal_mint_with_refund doesn't emit NEP-297; without it indexers and wallets never see the token.
        NftMint { owner_id: &owner, token_ids: &[&id], memo: None }.emit();
        self.log(&id, Event::Mint { owner });
        // The minter pays for everything this token stores, including the BTC key
        // and history that land later.
        let bytes = env::storage_usage() - before + TOKEN_RESERVE_BYTES;
        charge_storage(bytes, 0);

        // The key is fetched on-chain from the MPC contract, so nobody can mint a
        // Pusaka that points at an address they control privately.
        Promise::new(self.mpc.clone())
            .function_call(
                "derived_public_key",
                json!({
                    "path": btc_path(&id),
                    "predecessor": env::current_account_id(),
                    "domain_id": 0
                })
                .to_string()
                .into_bytes(),
                NearToken::from_yoctonear(0),
                Gas::from_tgas(KEY_TGAS),
            )
            .then(Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(5)).on_key(id))
    }

    #[private]
    pub fn on_key(&mut self, token_id: TokenId) {
        let Ok(bytes) = env::promise_result_checked(0, 256) else {
            env::panic_str("MPC key derivation failed; call refresh_key");
        };
        let s: String = serde_json::from_slice(&bytes).expect("key json");
        self.btc_keys.insert(token_id, btc::compress_mpc_key(&s));
    }

    /// Retries key derivation if the mint callback failed.
    pub fn refresh_key(&mut self, token_id: TokenId) -> Promise {
        require!(self.tokens.owner_by_id.contains_key(&token_id), "NoToken");
        require!(!self.btc_keys.contains_key(&token_id), "KeyAlreadySet");
        Promise::new(self.mpc.clone())
            .function_call(
                "derived_public_key",
                json!({"path": btc_path(&token_id), "predecessor": env::current_account_id(), "domain_id": 0})
                    .to_string()
                    .into_bytes(),
                NearToken::from_yoctonear(0),
                Gas::from_tgas(KEY_TGAS),
            )
            .then(Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(5)).on_key(token_id))
    }

    // ---------- withdraw ----------

    /// Owner-only. Builds a BTC tx spending `utxos` of this token's address, sends
    /// `amount_sat` to `to_script_hex` (any scriptPubKey) and change back home, then asks
    /// the MPC network to sign each input. Attach 1 yoctoNEAR per input and 300 TGas.
    #[payable]
    pub fn withdraw(
        &mut self,
        token_id: TokenId,
        utxos: Vec<Utxo>,
        to_script_hex: String,
        amount_sat: U64,
        fee_sat: U64,
    ) -> Promise {
        self.assert_owner(&token_id);
        self.assert_free(&token_id);
        require!(!utxos.is_empty() && utxos.len() <= MAX_INPUTS, "1..=8 inputs");
        let utxos = canonical_utxos(utxos);
        // 1 yocto per MPC sign call + storage for the outpoints this may record.
        charge_storage(
            OUTPOINT_BYTES * utxos.len() as u64,
            utxos.len() as u128,
        );

        let pk = self.btc_keys.get(&token_id).unwrap().clone();
        let pkh = btc::hash160(&pk);
        let inputs: Vec<_> = utxos.iter().map(|u| (u.txid.clone(), u.vout, u.value.0)).collect();
        let dest = hex::decode(&to_script_hex).expect("bad script hex");
        let spend = btc::build_spend(&pkh, &inputs, dest, amount_sat.0, fee_sat.0);

        // Record every outpoint *before* asking for signatures. If a signature is
        // produced but never reaches our callback (MPC timeout, late respond), it is
        // still accounted for: the registry errs on the side of "at risk".
        let signed = self.signed.entry(token_id.clone()).or_default();
        for u in &utxos {
            let o = OutPointRef { txid: u.txid.clone(), vout: u.vout };
            if !signed.contains(&o) {
                signed.push(o);
            }
        }

        self.bump_epoch(&token_id, utxos.len() as u32);
        // Proven deposits being spent no longer count; drop them so the list only holds live UTXOs.
        if let Some(list) = self.proven.get_mut(&token_id) {
            list.retain(|p| !utxos.iter().any(|u| u.txid == p.txid && u.vout == p.vout));
        }

        let path = btc_path(&token_id);
        let mut signs: Option<Promise> = None;
        for h in &spend.sighashes {
            let p = Promise::new(self.mpc.clone()).function_call_weight(
                "sign",
                json!({"request": {"path": path, "payload_v2": {"Ecdsa": hex::encode(h)}, "domain_id": 0}})
                    .to_string()
                    .into_bytes(),
                NearToken::from_yoctonear(1),
                Gas::from_tgas(SIGN_TGAS),
                GasWeight(1),
            );
            signs = Some(match signs {
                None => p,
                Some(acc) => acc.and(p),
            });
        }

        // Locked until the callback: no transfer/listing while a signature is in flight.
        self.pending.insert(token_id.clone(), env::block_height());
        signs.unwrap().then(
            Self::ext(env::current_account_id())
                .with_static_gas(Gas::from_tgas(CALLBACK_TGAS))
                .with_unused_gas_weight(0)
                .on_signed(token_id, utxos.len() as u32, amount_sat, btc::unsigned_hex(&spend.tx)),
        )
    }

    #[private]
    pub fn on_signed(
        &mut self,
        token_id: TokenId,
        inputs: u32,
        amount_sat: U64,
        unsigned_tx: String,
    ) -> SignedSpend {
        self.pending.remove(&token_id);
        let signatures: Vec<Option<Value>> = (0..env::promise_results_count())
            .map(|i| match env::promise_result_checked(i, 1024) {
                Ok(b) => serde_json::from_slice(&b).ok(),
                _ => None,
            })
            .collect();

        let ok = signatures.iter().filter(|s| s.is_some()).count() as u32;
        self.log(
            &token_id,
            Event::Withdraw { inputs, amount_sat, signed: ok },
        );
        SignedSpend {
            unsigned_tx,
            btc_pubkey: hex::encode(self.btc_keys.get(&token_id).unwrap()),
            signatures,
        }
    }

    /// Owner escape hatch if a withdrawal's callback never cleared the lock. Safe
    /// because the outpoints were recorded before signing was requested.
    pub fn unlock_stale(&mut self, token_id: TokenId) {
        self.assert_owner(&token_id);
        let since = *self.pending.get(&token_id).expect("NotPending");
        require!(
            env::block_height() >= since + PENDING_TIMEOUT_BLOCKS,
            "still waiting for the MPC network"
        );
        self.pending.remove(&token_id);
    }

    // ---------- trustless deposits (Bitcoin light client) ----------

    /// Anyone can prove a deposit into a Pusaka. The contract parses the transaction,
    /// checks output `vout` pays this token's P2WPKH address, and asks the on-chain Bitcoin
    /// light client to verify the transaction is in the main chain with enough
    /// confirmations. `tx_hex` is the non-witness serialization (so its hash is the txid);
    /// hashes are in explorer (display) byte order. Attach ~0.01 NEAR (storage, refunded).
    #[payable]
    #[allow(clippy::too_many_arguments)]
    pub fn prove_deposit(
        &mut self,
        token_id: TokenId,
        tx_hex: String,
        vout: u32,
        block_hash: String,
        tx_index: U64,
        merkle_proof: Vec<String>,
        coinbase_txid: String,
        coinbase_merkle_proof: Vec<String>,
    ) -> Promise {
        let pk = self.btc_keys.get(&token_id).expect("KeyNotReady").clone();
        let tx = hex::decode(&tx_hex).expect("bad tx hex");
        // A 64-byte "transaction" could double as an internal merkle node.
        require!(tx.len() != 64, "64-byte transactions are not accepted");
        let txid_internal = btc::sha256d(&tx);
        let mut txid_display = txid_internal;
        txid_display.reverse();
        let txid = hex::encode(txid_display);
        // A signed outpoint is spent or spendable by a signature holder: proving it would only add a dead entry.
        let spent = self.signed.get(&token_id).is_some_and(|s| s.iter().any(|o| o.txid == txid && o.vout == vout));
        require!(!spent, "already signed for; it can't count as verified");
        let (value, script) = btc::output(&tx, vout);
        require!(script == btc::p2wpkh_script(&btc::hash160(&pk)), "output does not pay this Pusaka");
        require!(value >= MIN_PROVEN_SATS, "deposit below the minimum that can be proven");
        let list = self.proven.get(&token_id);
        require!(!list.is_some_and(|v| v.iter().any(|u| u.txid == txid && u.vout == vout)), "already proven");
        require!(list.map_or(0, |v| v.len()) < MAX_PROVEN, "too many proven deposits; withdraw to consolidate");
        charge_storage(PROVEN_BYTES, 0);

        let args = btc::proof_args_borsh(
            &txid_internal,
            &block_hash,
            tx_index.0,
            &merkle_proof,
            &coinbase_txid,
            &coinbase_merkle_proof,
            BTC_MIN_CONFIRMATIONS,
        );
        Promise::new(BTC_LIGHT_CLIENT.parse().unwrap())
            .function_call("verify_transaction_inclusion_v2", args, NearToken::from_yoctonear(0), Gas::from_tgas(PROOF_TGAS))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(Gas::from_tgas(20))
                    .on_deposit_proven(token_id, txid, vout, U64(value), env::predecessor_account_id()),
            )
    }

    #[private]
    pub fn on_deposit_proven(
        &mut self,
        token_id: TokenId,
        txid: String,
        vout: u32,
        value: U64,
        payer: AccountId,
    ) -> bool {
        let ok = matches!(env::promise_result_checked(0, 16), Ok(b) if b == b"true");
        let mut stored = false;
        if ok {
            let list = self.proven.entry(token_id).or_default();
            // A parallel proof of the same outpoint, or the cap, can make this a no-op.
            if list.len() < MAX_PROVEN && !list.iter().any(|u| u.txid == txid && u.vout == vout) {
                list.push(ProvenUtxo { txid, vout, value });
                stored = true;
            }
        }
        if !stored {
            // Nothing was stored: give the prover back the storage they paid for.
            refund(payer, env::storage_byte_cost().saturating_mul(PROVEN_BYTES as u128));
        }
        ok
    }

    // ---------- EVM ----------

    /// Owner-only. The same MPC key that holds the token's BTC also controls one address
    /// on every EVM chain. Builds an EIP-1559 transfer of `value_wei` to `to` and asks the
    /// MPC network to sign it. Attach ~0.01 NEAR (storage, refunded) and 100 TGas.
    #[payable]
    #[allow(clippy::too_many_arguments)]
    pub fn withdraw_eth(
        &mut self,
        token_id: TokenId,
        chain_id: U64,
        nonce: U64,
        to: String,
        value_wei: U128,
        gas_limit: U128,
        max_fee_per_gas: U128,
        max_priority_fee_per_gas: U128,
        erc20: Option<String>,
    ) -> Promise {
        self.assert_owner(&token_id);
        self.assert_free(&token_id);
        require!(EVM_CHAINS.contains(&chain_id.0), "chain not supported; see EVM_CHAINS");
        require!(value_wei.0 > 0, "value_wei must be > 0"); // a 0-value tx would only burn a nonce and the fee
        let to = parse_evm_address(&to);
        // ERC-20: the tx calls token.transfer(to, value_wei) and moves no ETH.
        let (tx_to, value, input) = match &erc20 {
            None => (to, value_wei.0, vec![]),
            Some(t) => (parse_evm_address(t), 0, erc20_transfer_calldata(&to, value_wei.0)),
        };
        let tx = omni_transaction::evm::EVMTransaction {
            chain_id: chain_id.0,
            nonce: nonce.0,
            to: Some(tx_to),
            value,
            input,
            gas_limit: gas_limit.0,
            max_fee_per_gas: max_fee_per_gas.0,
            max_priority_fee_per_gas: max_priority_fee_per_gas.0,
            access_list: vec![],
        };
        let sighash = env::keccak256_array(&tx.build_for_signing());

        // Before signing: every nonce below the floor may have a signature in the wild.
        // A buyer only trusts the balance once the chain's nonce has passed the floor.
        let key = format!("{token_id}:{}", chain_id.0);
        let new_entry = !self.eth_nonces.contains_key(&key);
        charge_storage(if new_entry { ETH_NONCE_BYTES } else { 0 }, 1);
        let floor = self.eth_nonces.get(&key).copied().unwrap_or(0).max(nonce.0 + 1);
        self.eth_nonces.insert(key, floor);
        self.bump_epoch(&token_id, 1);
        self.pending.insert(token_id.clone(), env::block_height());

        Promise::new(self.mpc.clone())
            .function_call_weight(
                "sign",
                json!({"request": {"path": btc_path(&token_id), "payload_v2": {"Ecdsa": hex::encode(sighash)}, "domain_id": 0}})
                    .to_string()
                    .into_bytes(),
                NearToken::from_yoctonear(1),
                Gas::from_tgas(SIGN_TGAS),
                GasWeight(1),
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(Gas::from_tgas(10))
                    .with_unused_gas_weight(0)
                    .on_eth_signed(token_id, chain_id, nonce, value_wei, hex::encode(sighash), erc20.map(|t| t.to_ascii_lowercase())),
            )
    }

    #[private]
    pub fn on_eth_signed(
        &mut self,
        token_id: TokenId,
        chain_id: U64,
        nonce: U64,
        value_wei: U128,
        sighash: String,
        erc20: Option<String>,
    ) -> SignedEth {
        self.pending.remove(&token_id);
        let signature: Option<Value> = match env::promise_result_checked(0, 1024) {
            Ok(b) => serde_json::from_slice(&b).ok(),
            _ => None,
        };
        let signed = signature.is_some();
        self.log(&token_id, match erc20 {
            None => Event::WithdrawEth { chain_id, nonce, value_wei, signed },
            Some(token) => Event::WithdrawErc20 { chain_id, nonce, token, amount: value_wei, signed },
        });
        SignedEth { sighash, signature }
    }

    // ---------- NEAR: each Pusaka is also a NEAR account ----------

    /// Owner-only. The token's Ed25519 MPC key is a NEAR implicit account (id = hex of the key),
    /// so the Pusaka itself can hold NEAR and anything sent to that account. Builds a transaction
    /// with a single Transfer of `amount` to `receiver_id` and asks the MPC network to sign it.
    /// Only Transfer is ever signed: no AddKey, DeleteKey or calls, so the MPC key stays the
    /// account's only key. Every nonce up to the floor may have a signature in the wild; a buyer
    /// trusts the balance once the account's access-key nonce has reached it.
    /// Attach ~0.01 NEAR (storage, refunded) and 300 TGas.
    #[payable]
    pub fn withdraw_near(&mut self, token_id: TokenId, receiver_id: AccountId, amount: NearToken, nonce: U64, block_hash: String) -> Promise {
        self.assert_owner(&token_id);
        self.assert_free(&token_id);
        require!(!amount.is_zero(), "amount must be > 0");
        let block_hash = parse_b58_32(&block_hash, "block_hash");
        let key = format!("{token_id}:near");
        charge_storage(if self.eth_nonces.contains_key(&key) { 0 } else { ETH_NONCE_BYTES }, 1);
        let floor = self.eth_nonces.get(&key).copied().unwrap_or(0).max(nonce.0);
        self.eth_nonces.insert(key, floor);
        self.bump_epoch(&token_id, 1);
        self.pending.insert(token_id.clone(), env::block_height());
        Promise::new(self.mpc.clone())
            .function_call(
                "derived_public_key",
                json!({"path": btc_path(&token_id), "predecessor": env::current_account_id(), "domain_id": ED25519_DOMAIN})
                    .to_string()
                    .into_bytes(),
                NearToken::from_yoctonear(0),
                Gas::from_tgas(KEY_TGAS),
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(Gas::from_tgas(SIGN_TGAS + 25))
                    .on_near_key(token_id, receiver_id, amount, nonce, block_hash),
            )
    }

    #[private]
    pub fn on_near_key(&mut self, token_id: TokenId, receiver_id: AccountId, amount: NearToken, nonce: U64, block_hash: [u8; 32]) -> PromiseOrValue<SignedNear> {
        let Some(pk) = ed25519_key_result() else {
            self.pending.remove(&token_id);
            self.log(&token_id, Event::WithdrawNear { nonce, amount, signed: false });
            return PromiseOrValue::Value(SignedNear { transaction: String::new(), account: String::new(), signature: None });
        };
        let tx = near_transfer_tx(&pk, nonce.0, &receiver_id, &block_hash, amount.as_yoctonear());
        PromiseOrValue::Promise(
            Promise::new(self.mpc.clone())
                .function_call(
                    "sign",
                    json!({"request": {"path": btc_path(&token_id), "payload_v2": {"Eddsa": hex::encode(env::sha256_array(&tx))}, "domain_id": ED25519_DOMAIN}})
                        .to_string()
                        .into_bytes(),
                    NearToken::from_yoctonear(1),
                    Gas::from_tgas(SIGN_TGAS),
                )
                .then(
                    Self::ext(env::current_account_id())
                        .with_static_gas(Gas::from_tgas(8))
                        .on_near_signed(token_id, nonce, amount, base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &tx), hex::encode(pk)),
                ),
        )
    }

    #[private]
    pub fn on_near_signed(&mut self, token_id: TokenId, nonce: U64, amount: NearToken, transaction: String, account: String) -> SignedNear {
        self.pending.remove(&token_id);
        let signature: Option<Value> = match env::promise_result_checked(0, 1024) {
            Ok(b) => serde_json::from_slice(&b).ok(),
            _ => None,
        };
        self.log(&token_id, Event::WithdrawNear { nonce, amount, signed: signature.is_some() });
        SignedNear { transaction, account, signature }
    }

    /// Owner-only. Stores a sealed (encrypted) letter in the token's metadata; it travels with
    /// the NFT and only the current holder can have it opened (see api/holder.mjs). Empty clears it.
    #[payable]
    /// `sealed` is either `v1:…` (sealed by the holder-room server) or `ckd1:…`, encrypted in the
    /// owner's browser with a NEAR MPC confidential key; then `path` is the key's derivation path
    /// from `letter_key(write_nonce)`, which must be this owner's.
    pub fn set_letter(&mut self, token_id: TokenId, sealed: String, path: Option<String>) {
        self.assert_owner(&token_id);
        self.assert_free(&token_id); // a buyer must get the letter they saw
        require!(sealed.len() <= MAX_LETTER && sealed.bytes().all(|b| b.is_ascii_graphic()), "sealed letter: up to 2000 printable ASCII chars");
        let ckd = sealed.starts_with("ckd1:");
        if ckd {
            let mine = format!("letter:{token_id}:{}:", env::predecessor_account_id());
            require!(path.as_deref().is_some_and(|p| p.starts_with(&mine) && p.len() <= mine.len() + 32), "ckd1 letters need the path letter_key gave this owner");
        } else {
            require!(path.is_none(), "path is only for ckd1 letters");
        }
        let before = env::storage_usage();
        let metas = self.tokens.token_metadata_by_id.as_mut().unwrap();
        let mut m = metas.get(&token_id).expect("NoToken");
        let mut extra: Value = m.extra.as_deref().and_then(|e| serde_json::from_str(e).ok()).unwrap_or_else(|| json!({}));
        let o = extra.as_object_mut().unwrap();
        o.remove("letter_path");
        if sealed.is_empty() { o.remove("letter"); } else { o.insert("letter".into(), json!(sealed)); }
        if let (true, Some(p)) = (ckd, path) { o.insert("letter_path".into(), json!(p)); }
        m.extra = Some(extra.to_string());
        metas.insert(&token_id, &m);
        charge_storage(env::storage_usage().saturating_sub(before), 1);
    }

    /// Owner-only. Asks NEAR MPC for a confidential key (CKD, domain 2), encrypted to
    /// `app_public_key`: a one-time BLS12-381 G1 key (`bls12381g1:<base58>`) whose secret only the
    /// owner's browser holds. The key belongs to this contract's account and a derivation path:
    /// - `write_nonce` set: a new letter's key, path `letter:<id>:<owner>:<nonce>`;
    /// - unset: the key of the letter stored now (its `letter_path`).
    /// Only the current owner gets either, so the server never sees a key, and a seller never
    /// gets the key of a letter written after the sale. Returns the MPC's `{big_y, big_c}`.
    /// Attach 1 yoctoNEAR and ~50 TGas.
    #[payable]
    pub fn letter_key(&mut self, token_id: TokenId, app_public_key: String, write_nonce: Option<String>) -> Promise {
        self.assert_owner(&token_id);
        require!(env::attached_deposit() >= NearToken::from_yoctonear(1), "attach 1 yoctoNEAR");
        require!(app_public_key.starts_with("bls12381g1:") && app_public_key.len() <= 100, "app_public_key must be bls12381g1:<base58>");
        let path = match write_nonce {
            Some(n) => {
                require!(!n.is_empty() && n.len() <= 32 && n.bytes().all(|b| b.is_ascii_alphanumeric()), "write_nonce: 1 to 32 letters or digits");
                format!("letter:{token_id}:{}:{n}", env::predecessor_account_id())
            }
            None => self.letter_extra(&token_id)["letter_path"].as_str().map(String::from).expect("NoCkdLetter"),
        };
        Promise::new(self.mpc.clone()).function_call_weight(
            "request_app_private_key",
            json!({"request": {"derivation_path": path, "app_public_key": {"AppPublicKey": app_public_key}, "domain_id": CKD_DOMAIN}})
                .to_string()
                .into_bytes(),
            NearToken::from_yoctonear(1),
            Gas::from_tgas(SIGN_TGAS),
            GasWeight(1),
        )
    }

    fn letter_extra(&self, token_id: &TokenId) -> Value {
        let m = self.tokens.token_metadata_by_id.as_ref().unwrap().get(token_id).expect("NoToken");
        m.extra.as_deref().and_then(|e| serde_json::from_str(e).ok()).unwrap_or_else(|| json!({}))
    }

    /// Highest nonce of the token's NEAR account that was ever signed for (0 if none).
    pub fn near_nonce_floor(&self, token_id: TokenId) -> U64 {
        U64(self.eth_nonces.get(&format!("{token_id}:near")).copied().unwrap_or(0))
    }

    // ---------- Solana ----------

    /// Owner-only. The token's Ed25519 MPC key (same path, domain 1) is a Solana address.
    /// Builds a System transfer of `lamports` to `to` and asks the MPC network to sign it.
    /// The contract fixes the message shape (no durable-nonce instruction), so a signature
    /// dies with `recent_blockhash` after ~150 slots: buyers wait that out, not a nonce.
    /// Attach 1 yoctoNEAR and 300 TGas.
    #[payable]
    pub fn withdraw_sol(&mut self, token_id: TokenId, to: String, lamports: U64, recent_blockhash: String) -> Promise {
        self.assert_owner(&token_id);
        self.assert_free(&token_id);
        let to = parse_b58_32(&to, "to");
        let blockhash = parse_b58_32(&recent_blockhash, "recent_blockhash");
        require!(lamports.0 > 0, "lamports must be > 0");
        charge_storage(0, 1);
        self.bump_epoch(&token_id, 1);
        self.pending.insert(token_id.clone(), env::block_height());
        Promise::new(self.mpc.clone())
            .function_call(
                "derived_public_key",
                json!({"path": btc_path(&token_id), "predecessor": env::current_account_id(), "domain_id": ED25519_DOMAIN})
                    .to_string()
                    .into_bytes(),
                NearToken::from_yoctonear(0),
                Gas::from_tgas(KEY_TGAS),
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(Gas::from_tgas(SIGN_TGAS + 25))
                    .on_sol_key(token_id, to, lamports, blockhash),
            )
    }

    #[private]
    pub fn on_sol_key(&mut self, token_id: TokenId, to: [u8; 32], lamports: U64, blockhash: [u8; 32]) -> PromiseOrValue<SignedSol> {
        let key = ed25519_key_result().filter(|k| *k != to); // sending to itself: give up here, a panic would leave the lock on
        let Some(from) = key else {
            self.pending.remove(&token_id);
            self.log(&token_id, Event::WithdrawSol { lamports, signed: false });
            return PromiseOrValue::Value(SignedSol { message: String::new(), from: String::new(), signature: None });
        };
        let message = sol_transfer_message(&from, &to, lamports.0, &blockhash);
        PromiseOrValue::Promise(
            Promise::new(self.mpc.clone())
                .function_call(
                    "sign",
                    json!({"request": {"path": btc_path(&token_id), "payload_v2": {"Eddsa": hex::encode(&message)}, "domain_id": ED25519_DOMAIN}})
                        .to_string()
                        .into_bytes(),
                    NearToken::from_yoctonear(1),
                    Gas::from_tgas(SIGN_TGAS),
                )
                .then(
                    Self::ext(env::current_account_id())
                        .with_static_gas(Gas::from_tgas(8))
                        .on_sol_signed(token_id, lamports, base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &message), bs58::encode(from).into_string()),
                ),
        )
    }

    #[private]
    pub fn on_sol_signed(&mut self, token_id: TokenId, lamports: U64, message: String, from: String) -> SignedSol {
        self.pending.remove(&token_id);
        let signature: Option<Value> = match env::promise_result_checked(0, 1024) {
            Ok(b) => serde_json::from_slice(&b).ok(),
            _ => None,
        };
        self.log(&token_id, Event::WithdrawSol { lamports, signed: signature.is_some() });
        SignedSol { message, from, signature }
    }

    /// Lowest nonce on `chain_id` that has never been signed for this token (0 if none).
    pub fn eth_nonce_floor(&self, token_id: TokenId, chain_id: U64) -> U64 {
        U64(self.eth_nonces.get(&format!("{token_id}:{}", chain_id.0)).copied().unwrap_or(0))
    }

    // ---------- market ----------

    /// Fixed price: `list(id, price)`. Dutch auction: also pass `floor` and `duration_ms`;
    /// the price falls linearly from `price` to `floor` over that time.
    pub fn list(
        &mut self,
        token_id: TokenId,
        price: NearToken,
        floor: Option<NearToken>,
        duration_ms: Option<U64>,
    ) {
        self.assert_owner(&token_id);
        self.assert_free(&token_id);
        let floor = floor.unwrap_or(price);
        require!(!price.is_zero() && floor <= price, "need 0 < floor <= price");
        let now = env::block_timestamp_ms();
        let end = now + duration_ms.map_or(0, |d| d.0);
        require!(floor == price || end > now, "a falling price needs duration_ms");
        self.listings.insert(
            token_id.clone(),
            Listing {
                seller: env::predecessor_account_id(),
                price,
                floor,
                start_ms: U64(now),
                end_ms: U64(end),
            },
        );
        self.log(&token_id, Event::Listed { price });
    }

    pub fn cancel_listing(&mut self, token_id: TokenId) {
        self.assert_owner(&token_id);
        require!(self.listings.remove(&token_id).is_some(), "NotListed");
        self.log(&token_id, Event::Unlisted);
    }

    /// Atomic purchase. `expected_sign_epoch` is the token's sign epoch (see TokenInfo) the
    /// buyer saw when checking the token's safe balance; if it changed, the buy fails.
    #[payable]
    pub fn buy(&mut self, token_id: TokenId, expected_sign_epoch: u32) {
        let listing = self.listings.remove(&token_id).expect("NotListed");
        let buyer = env::predecessor_account_id();
        let paid = env::attached_deposit();
        let price = listing.price_at(env::block_timestamp_ms());
        require!(paid >= price, "InsufficientDeposit");
        require!(buyer != listing.seller, "SelfBuy");
        self.assert_epoch(&token_id, expected_sign_epoch);

        self.tokens.internal_transfer(&listing.seller, &buyer, &token_id, None, None);
        self.log(
            &token_id,
            Event::Sale { from: listing.seller.clone(), to: buyer.clone(), price },
        );
        for (to, amount) in self.split(&token_id, &listing.seller, price.as_yoctonear()) {
            if to != listing.seller {
                self.log(&token_id, Event::Royalty { creator: to.clone(), amount: NearToken::from_yoctonear(amount) });
            }
            refund(to, NearToken::from_yoctonear(amount));
        }
        refund(buyer, paid.saturating_sub(price));
    }

    // ---------- loans ----------

    /// Owner asks for `principal` NEAR, promising to pay back `repay` within `duration_ms`
    /// of funding. The Pusaka is locked (no withdraw, sale or transfer) until the loan ends.
    pub fn request_loan(
        &mut self,
        token_id: TokenId,
        principal: NearToken,
        repay: NearToken,
        duration_ms: U64,
    ) {
        self.assert_owner(&token_id);
        self.assert_free(&token_id);
        require!(!principal.is_zero() && repay >= principal, "need 0 < principal <= repay");
        require!(duration_ms.0 > 0, "duration_ms must be > 0");
        self.loans.insert(
            token_id.clone(),
            Loan {
                borrower: env::predecessor_account_id(),
                principal,
                repay,
                duration_ms,
                lender: None,
                due_ms: None,
            },
        );
        self.log(&token_id, Event::LoanRequested { principal, repay, duration_ms });
    }

    pub fn cancel_loan_request(&mut self, token_id: TokenId) {
        self.assert_owner(&token_id);
        let loan = self.loans.get(&token_id).expect("NoLoan");
        require!(loan.lender.is_none(), "LoanAlreadyFunded");
        self.loans.remove(&token_id);
        self.log(&token_id, Event::LoanCancelled);
    }

    /// Lender sends `principal`, which goes straight to the borrower. The lender restates
    /// the terms and sign epoch they reviewed; if the borrower changed either, it fails.
    #[payable]
    pub fn fund_loan(
        &mut self,
        token_id: TokenId,
        expected_sign_epoch: u32,
        principal: NearToken,
        repay: NearToken,
        duration_ms: U64,
    ) {
        let mut loan = self.loans.get(&token_id).expect("NoLoan").clone();
        require!(
            loan.principal == principal && loan.repay == repay && loan.duration_ms == duration_ms,
            "TermsChanged: the loan request differs from what you reviewed"
        );
        require!(loan.lender.is_none(), "LoanAlreadyFunded");
        let lender = env::predecessor_account_id();
        require!(lender != loan.borrower, "SelfLoan");
        let paid = env::attached_deposit();
        require!(paid >= loan.principal, "InsufficientDeposit");
        self.assert_epoch(&token_id, expected_sign_epoch);
        let due = U64(
            env::block_timestamp_ms().checked_add(loan.duration_ms.0).expect("duration too long"),
        );
        loan.lender = Some(lender.clone());
        loan.due_ms = Some(due);
        self.loans.insert(token_id.clone(), loan.clone());
        self.log(&token_id, Event::LoanFunded { lender: lender.clone(), due_ms: due });
        Promise::new(loan.borrower).transfer(loan.principal).detach();
        refund(lender, paid.saturating_sub(loan.principal));
    }

    /// Anyone may repay (usually the borrower). Repaying after the due date still works
    /// as long as the lender hasn't claimed the collateral yet.
    #[payable]
    pub fn repay_loan(&mut self, token_id: TokenId) {
        let loan = self.loans.get(&token_id).expect("NoLoan").clone();
        let lender = loan.lender.clone().expect("LoanNotFunded");
        let paid = env::attached_deposit();
        require!(paid >= loan.repay, "InsufficientDeposit");
        self.loans.remove(&token_id);
        self.log(&token_id, Event::LoanRepaid { lender: lender.clone(), amount: loan.repay });
        Promise::new(lender).transfer(loan.repay).detach();
        refund(env::predecessor_account_id(), paid.saturating_sub(loan.repay));
    }

    /// After the due date, an unpaid lender takes the Pusaka, and with it the BTC.
    pub fn claim_collateral(&mut self, token_id: TokenId) {
        let loan = self.loans.get(&token_id).expect("NoLoan").clone();
        let lender = loan.lender.clone().expect("LoanNotFunded");
        require!(env::predecessor_account_id() == lender, "NotLender");
        require!(env::block_timestamp_ms() >= loan.due_ms.unwrap().0, "NotDueYet");
        self.loans.remove(&token_id);
        self.tokens.internal_transfer(&loan.borrower, &lender, &token_id, None, None);
        self.log(&token_id, Event::LoanDefaulted { lender });
    }

    /// Re-emits NEP-297 mint events for tokens minted before the contract emitted them,
    /// so indexers and wallets pick them up. Events only; no state changes.
    #[private]
    pub fn emit_mint_events(&mut self, token_ids: Vec<TokenId>) {
        for id in &token_ids {
            let owner = self.tokens.owner_by_id.get(id).expect("NoToken");
            NftMint { owner_id: &owner, token_ids: &[id], memo: Some("re-emitted for indexers") }.emit();
        }
    }

    // ---------- views ----------

    pub fn token_info(&self, token_id: TokenId) -> Option<TokenInfo> {
        let token = self.tokens.nft_token(token_id.clone())?;
        Some(TokenInfo {
            token,
            btc_path: btc_path(&token_id),
            btc_pubkey: self.btc_keys.get(&token_id).map(hex::encode),
            listing: self.listings.get(&token_id).cloned(),
            price_now: self.listings.get(&token_id).map(|l| l.price_at(env::block_timestamp_ms())),
            loan: self.loans.get(&token_id).cloned(),
            pending: self.pending.contains_key(&token_id),
            sign_epoch: self.epoch(&token_id),
            signed_outpoints: self.signed.get(&token_id).cloned().unwrap_or_default(),
            proven_utxos: self.proven.get(&token_id).cloned().unwrap_or_default(),
            verified_sats: U64(self.verified_sats(&token_id)),
            history: self.history.get(&token_id).cloned().unwrap_or_default(),
        })
    }

    pub fn mpc_contract(&self) -> AccountId {
        self.mpc.clone()
    }

    // ---------- internals ----------

    /// Live metadata: the image and description follow the BTC verified inside and the lock state.
    fn with_art(&self, mut t: Token) -> Token {
        let sats = self.verified_sats(&t.token_id);
        let locked = self.listings.contains_key(&t.token_id)
            || self.loans.contains_key(&t.token_id)
            || self.pending.contains_key(&t.token_id);
        if let (Some(m), Some(pk)) = (t.metadata.as_mut(), self.btc_keys.get(&t.token_id)) {
            m.media = Some(art::data_uri(&art::emblem_svg(pk, sats, locked)));
            m.description = Some(format!(
                "Holds {}.{:08} BTC verified on NEAR by the Bitcoin light client.{}",
                sats / 100_000_000,
                sats % 100_000_000,
                if locked { " Locked: listed, collateral, or signing." } else { "" }
            ));
        }
        t
    }

    fn verified_sats(&self, token_id: &TokenId) -> u64 {
        let signed = self.signed.get(token_id);
        self.proven.get(token_id).map_or(0, |list| {
            list.iter()
                .filter(|u| {
                    !signed.is_some_and(|s| s.iter().any(|o| o.txid == u.txid && o.vout == u.vout))
                })
                .map(|u| u.value.0)
                .sum()
        })
    }

    /// Token creator, from metadata.extra (None for tokens minted before royalties).
    fn creator(&self, token_id: &TokenId) -> Option<AccountId> {
        let extra = self.tokens.token_metadata_by_id.as_ref()?.get(token_id)?.extra?;
        serde_json::from_str::<Value>(&extra).ok()?.get("creator")?.as_str()?.parse().ok()
    }

    /// Who gets what from a sale by `seller`: royalty to the creator unless they are the seller.
    fn split(&self, token_id: &TokenId, seller: &AccountId, amount: u128) -> Vec<(AccountId, u128)> {
        match self.creator(token_id).filter(|c| c != seller) {
            Some(c) => {
                let r = amount * ROYALTY_BPS / 10_000;
                vec![(seller.clone(), amount - r), (c, r)]
            }
            None => vec![(seller.clone(), amount)],
        }
    }

    fn epoch(&self, token_id: &TokenId) -> u32 {
        self.sign_epoch.get(token_id).copied().unwrap_or(0)
    }

    fn bump_epoch(&mut self, token_id: &TokenId, by: u32) {
        let e = self.epoch(token_id) + by;
        self.sign_epoch.insert(token_id.clone(), e);
        self.signed_at.insert(token_id.clone(), env::block_timestamp_ms());
    }

    fn assert_epoch(&self, token_id: &TokenId, expected: u32) {
        require!(
            self.epoch(token_id) == expected,
            "StateChanged: a signature was requested after you checked this Pusaka"
        );
    }

    fn assert_owner(&self, token_id: &TokenId) {
        let owner = self.tokens.owner_by_id.get(token_id).expect("NoToken");
        require!(owner == env::predecessor_account_id(), "NotOwner");
    }

    /// A token may move or sign only when nothing else is in flight.
    /// Nothing in flight and no sale or loan open. Also no NEP-178 approval: a market that
    /// can sell the token must not see its BTC or ETH leave first.
    fn assert_free(&self, token_id: &TokenId) {
        self.assert_unlocked(token_id);
        require!(!self.has_approvals(token_id), "Approved: call nft_revoke_all first");
    }

    fn assert_unlocked(&self, token_id: &TokenId) {
        require!(self.btc_keys.contains_key(token_id), "KeyNotReady");
        require!(!self.pending.contains_key(token_id), "SignPending");
        require!(!self.listings.contains_key(token_id), "Listed");
        require!(!self.loans.contains_key(token_id), "Collateralised");
    }

    fn has_approvals(&self, token_id: &TokenId) -> bool {
        self.tokens.approvals_by_id.as_ref().and_then(|a| a.get(token_id)).is_some_and(|m| !m.is_empty())
    }

    fn owner_of(&self, token_id: &TokenId) -> AccountId {
        self.tokens.owner_by_id.get(token_id).unwrap_or_else(|| env::panic_str("TokenNotFound"))
    }

    fn log(&mut self, token_id: &str, event: Event) {
        let h = self.history.entry(token_id.to_string()).or_default();
        h.push(Entry { at_ms: U64(env::block_timestamp_ms()), event });
        // ponytail: bounded so list/cancel spam can't grow storage; full history lives in tx logs
        if h.len() > MAX_HISTORY {
            h.remove(0);
        }
    }
}

fn refund(to: AccountId, amount: NearToken) {
    if !amount.is_zero() {
        Promise::new(to).transfer(amount).detach();
    }
}

/// Requires the attached deposit to cover `bytes` of storage plus `extra_yocto`, refunds the rest.
fn charge_storage(bytes: u64, extra_yocto: u128) {
    let cost = env::storage_byte_cost()
        .saturating_mul(bytes as u128)
        .saturating_add(NearToken::from_yoctonear(extra_yocto));
    let paid = env::attached_deposit();
    require!(paid >= cost, format!("attach at least {cost} for storage"));
    let refund = paid.saturating_sub(cost);
    if !refund.is_zero() {
        Promise::new(env::predecessor_account_id()).transfer(refund).detach();
    }
}

/// Outpoints are recorded exactly as the buyer will compare them: 64 lower-case hex
/// txid, no duplicates. Anything else could let a signed UTXO hide from the registry.
fn canonical_utxos(utxos: Vec<Utxo>) -> Vec<Utxo> {
    let mut seen = std::collections::HashSet::new();
    utxos
        .into_iter()
        .map(|mut u| {
            require!(
                u.txid.len() == 64 && u.txid.bytes().all(|b| b.is_ascii_hexdigit()),
                "txid must be 64 hex chars"
            );
            u.txid = u.txid.to_ascii_lowercase();
            require!(seen.insert((u.txid.clone(), u.vout)), "duplicate outpoint");
            u
        })
        .collect()
}

fn parse_evm_address(s: &str) -> [u8; 20] {
    let h = s.strip_prefix("0x").unwrap_or(s);
    let b = hex::decode(h).unwrap_or_default();
    require!(b.len() == 20, "to must be a 0x-prefixed 20-byte address");
    b.try_into().unwrap()
}

/// The MPC's `derived_public_key` answer for the Ed25519 domain, as raw key bytes.
fn ed25519_key_result() -> Option<[u8; 32]> {
    let b = env::promise_result_checked(0, 256).ok()?;
    let s: String = serde_json::from_slice(&b).ok()?;
    bs58::decode(s.strip_prefix("ed25519:")?).into_vec().ok()?.try_into().ok()
}

/// Borsh `Transaction` (v0) from the implicit account of `pk` with one Transfer action.
pub fn near_transfer_tx(pk: &[u8; 32], nonce: u64, receiver: &AccountId, block_hash: &[u8; 32], yocto: u128) -> Vec<u8> {
    let str_ = |t: &mut Vec<u8>, s: &str| { t.extend((s.len() as u32).to_le_bytes()); t.extend(s.as_bytes()); };
    let mut t = vec![];
    str_(&mut t, &hex::encode(pk)); // signer_id: the implicit account
    t.push(0); // PublicKey::ED25519
    t.extend(pk);
    t.extend(nonce.to_le_bytes());
    str_(&mut t, receiver.as_str());
    t.extend(block_hash);
    t.extend(1u32.to_le_bytes()); // one action
    t.push(3); // Action::Transfer
    t.extend(yocto.to_le_bytes());
    t
}

/// ABI for `transfer(address,uint256)`.
fn erc20_transfer_calldata(to: &[u8; 20], amount: u128) -> Vec<u8> {
    let mut d = vec![0xa9, 0x05, 0x9c, 0xbb];
    d.extend([0u8; 12]);
    d.extend(to);
    d.extend([0u8; 16]);
    d.extend(amount.to_be_bytes());
    d
}

fn parse_b58_32(s: &str, what: &str) -> [u8; 32] {
    let b = bs58::decode(s).into_vec().unwrap_or_default();
    require!(b.len() == 32, format!("{what} must be a base58 32-byte value"));
    b.try_into().unwrap()
}

/// Solana legacy message: one System Program `Transfer` from `from` (sole signer) to `to`.
pub fn sol_transfer_message(from: &[u8; 32], to: &[u8; 32], lamports: u64, blockhash: &[u8; 32]) -> Vec<u8> {
    let mut m = vec![1, 0, 1, 3]; // header (1 signer, 0 ro-signed, 1 ro-unsigned), 3 account keys
    m.extend(from);
    m.extend(to);
    m.extend([0u8; 32]); // System Program
    m.extend(blockhash);
    m.extend([1, 2, 2, 0, 1, 12]); // 1 ix: program #2, accounts [0, 1], 12 data bytes
    m.extend(2u32.to_le_bytes()); // SystemInstruction::Transfer
    m.extend(lamports.to_le_bytes());
    m
}

fn empty_meta() -> TokenMetadata {
    TokenMetadata {
        title: None,
        description: None,
        media: None,
        media_hash: None,
        copies: None,
        issued_at: None,
        expires_at: None,
        starts_at: None,
        updated_at: None,
        extra: None,
        reference: None,
        reference_hash: None,
    }
}

// ---------- NEP-171 with transfer locks ----------

#[near]
impl NonFungibleTokenCore for Pusaka {
    #[payable]
    fn nft_transfer(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        approval_id: Option<u64>,
        memo: Option<String>,
    ) {
        // Approvals don't block a transfer: the transfer clears them.
        self.assert_unlocked(&token_id);
        let from = self.owner_of(&token_id);
        self.tokens.nft_transfer(receiver_id.clone(), token_id.clone(), approval_id, memo);
        self.log(&token_id, Event::Transfer { from, to: receiver_id });
    }

    /// Disabled: during a transfer_call the receiver owns the token mid-flight and could
    /// withdraw the BTC before handing back an empty token. Use nft_transfer or the market.
    #[payable]
    fn nft_transfer_call(
        &mut self,
        _receiver_id: AccountId,
        _token_id: TokenId,
        _approval_id: Option<u64>,
        _memo: Option<String>,
        _msg: String,
    ) -> PromiseOrValue<bool> {
        env::panic_str("nft_transfer_call is disabled for Pusaka; use nft_transfer")
    }

    fn nft_token(&self, token_id: TokenId) -> Option<Token> {
        self.tokens.nft_token(token_id).map(|t| self.with_art(t))
    }
}

#[near]
impl NonFungibleTokenEnumeration for Pusaka {
    fn nft_total_supply(&self) -> near_sdk::json_types::U128 {
        self.tokens.nft_total_supply()
    }
    fn nft_tokens(&self, from_index: Option<near_sdk::json_types::U128>, limit: Option<u64>) -> Vec<Token> {
        self.tokens.nft_tokens(from_index, limit).into_iter().map(|t| self.with_art(t)).collect()
    }
    fn nft_supply_for_owner(&self, account_id: AccountId) -> near_sdk::json_types::U128 {
        self.tokens.nft_supply_for_owner(account_id)
    }
    fn nft_tokens_for_owner(
        &self,
        account_id: AccountId,
        from_index: Option<near_sdk::json_types::U128>,
        limit: Option<u64>,
    ) -> Vec<Token> {
        self.tokens.nft_tokens_for_owner(account_id, from_index, limit).into_iter().map(|t| self.with_art(t)).collect()
    }
}

#[near]
impl NonFungibleTokenMetadataProvider for Pusaka {
    fn nft_metadata(&self) -> NFTContractMetadata {
        NFTContractMetadata {
            spec: NFT_METADATA_SPEC.to_string(),
            name: "Pusaka".into(),
            symbol: "PUSAKA".into(),
            icon: Some(art::icon()),
            base_uri: None,
            reference: None,
            reference_hash: None,
        }
    }
}

#[cfg(test)]
mod tests;

// ---------- NEP-178 approvals and NEP-199 payouts: sell on other NEAR markets ----------

/// NEP-199 payout: account -> amount (yoctoNEAR, as a string).
#[near(serializers = [json])]
pub struct Payout {
    pub payout: std::collections::HashMap<AccountId, U128>,
}

#[near]
impl Pusaka {
    /// NEP-178. Only while the token is free; from then on withdrawals, loans and our own
    /// listing are refused until the owner calls `nft_revoke_all` or the token is sold.
    #[payable]
    pub fn nft_approve(&mut self, token_id: TokenId, account_id: AccountId, msg: Option<String>) -> Option<Promise> {
        self.assert_unlocked(&token_id);
        // ponytail: tokens signed for before `signed_at` existed have no entry, so they skip the
        // cooldown. Only testnet has such tokens, and its window closed 1 h after the migration;
        // mainnet deploys fresh with `signed_at` from the start.
        if let Some(t) = self.signed_at.get(&token_id) {
            require!(env::block_timestamp_ms() >= t + APPROVE_COOLDOWN_MS,
                "Cooldown: outside markets can be approved 1 h (mainnet: 24 h) after the last signature");
        }
        self.log(&token_id, Event::Approved { account: account_id.clone() });
        near_contract_standards::non_fungible_token::approval::NonFungibleTokenApproval::nft_approve(
            &mut self.tokens, token_id, account_id, msg)
    }

    #[payable]
    pub fn nft_revoke(&mut self, token_id: TokenId, account_id: AccountId) {
        near_contract_standards::non_fungible_token::approval::NonFungibleTokenApproval::nft_revoke(
            &mut self.tokens, token_id.clone(), account_id);
        if !self.has_approvals(&token_id) {
            self.log(&token_id, Event::ApprovalsRevoked);
        }
    }

    #[payable]
    pub fn nft_revoke_all(&mut self, token_id: TokenId) {
        near_contract_standards::non_fungible_token::approval::NonFungibleTokenApproval::nft_revoke_all(
            &mut self.tokens, token_id.clone());
        self.log(&token_id, Event::ApprovalsRevoked);
    }

    pub fn nft_is_approved(&self, token_id: TokenId, approved_account_id: AccountId, approval_id: Option<u64>) -> bool {
        near_contract_standards::non_fungible_token::approval::NonFungibleTokenApproval::nft_is_approved(
            &self.tokens, token_id, approved_account_id, approval_id)
    }

    /// NEP-199: the creator gets ROYALTY_BPS, the owner the rest.
    pub fn nft_payout(&self, token_id: TokenId, balance: U128, max_len_payout: Option<u32>) -> Payout {
        let split = self.split(&token_id, &self.owner_of(&token_id), balance.0);
        require!(max_len_payout.is_none_or(|n| n as usize >= split.len()), "max_len_payout too small");
        Payout { payout: split.into_iter().map(|(a, v)| (a, U128(v))).collect() }
    }

    /// NEP-199: an approved market transfers the token and gets back who to pay.
    #[payable]
    pub fn nft_transfer_payout(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        approval_id: Option<u64>,
        memo: Option<String>,
        balance: U128,
        max_len_payout: Option<u32>,
    ) -> Payout {
        let payout = self.nft_payout(token_id.clone(), balance, max_len_payout);
        NonFungibleTokenCore::nft_transfer(self, receiver_id, token_id, approval_id, memo);
        payout
    }
}
