//! Pusaka — NEP-171 NFTs that each control a native Bitcoin address via NEAR Chain Signatures.
//!
//! The BTC key for token `N` is derived by the MPC network from (this contract, "pusaka-N").
//! Only this contract can request signatures for it, and it only does so for the current
//! NFT owner. Owning the NFT therefore *is* owning the BTC.

mod art;
mod btc;
mod gift;
mod upgrade;
mod usdc;

use near_contract_standards::non_fungible_token::core::{ext_nft_receiver, NonFungibleTokenCore, NonFungibleTokenResolver};
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
/// Proving dust would let anyone bloat a token's registry; below this a deposit isn't provable,
/// unless it is the Pusaka's own change (see MIN_CHANGE_SATS).
const MIN_PROVEN_SATS: u64 = 10_000;
/// A withdrawal's change (output 1 of a transaction this contract built for this token, recorded under
/// `ch:<txid>`) counts down to this, so a small withdrawal doesn't strand the rest of the BTC.
const MIN_CHANGE_SATS: u64 = 1_000;
/// One `ch:<txid>` -> token id entry, rounded up.
const CHANGE_BYTES: u64 = 120;
/// Shortest silence after which an heir may claim. Testnet: 10 minutes, so it can be shown.
#[cfg(not(feature = "mainnet"))]
const HEIR_MIN_MS: u64 = 10 * 60 * 1000;
#[cfg(feature = "mainnet")]
const HEIR_MIN_MS: u64 = 30 * 24 * 3600 * 1000;
/// key + owner + heir (64-byte account ids at most) + two u64
const HEIR_BYTES: u64 = 200;
/// Guardians: up to 5 named, up to 5 approvals, the owner, a threshold and two u64.
const MAX_GUARDIANS: usize = 5;
const GUARDIAN_BYTES: u64 = 800;
/// Once the guardians' quorum approves a release, the holder still has this long to show up and cancel it.
#[cfg(not(feature = "mainnet"))]
const RELEASE_WAIT_MS: u64 = 10 * 60 * 1000;
#[cfg(feature = "mainnet")]
const RELEASE_WAIT_MS: u64 = 7 * 24 * 3600 * 1000;
/// If the guardians never reach a quorum (lost keys, gone silent themselves), the heir may claim alone after
/// this many silences in total: the will still executes, just later.
const BACKSTOP_SILENCES: u64 = 3;
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
/// NEAR MPC foreign-transaction verification (secp256k1 attestations of other chains' txs).
const FOREIGN_TX_DOMAIN: u32 = 3;
/// Omni Bridge nBTC: native BTC deposited to its connector becomes this NEP-141 on NEAR.
/// Staking pools a Pusaka's NEAR account may delegate to: those made by the network's official pool factory.
#[cfg(not(feature = "mainnet"))]
pub const POOL_SUFFIX: &str = ".pool.f863973.m0";
#[cfg(feature = "mainnet")]
pub const POOL_SUFFIX: &str = ".poolv1.near";
/// A token remembers up to this many pools it delegated to, so a buyer can look its stake up.
const MAX_POOLS: usize = 3;
const POOLS_BYTES: u64 = 220;
#[cfg(not(feature = "mainnet"))]
pub const NBTC: &str = "nbtc.n-bridge.testnet";
#[cfg(feature = "mainnet")]
pub const NBTC: &str = "nbtc.bridge.near";
/// Storage for one proven USDC deposit record, and for a token's signed-out USDC counter.
const USDC_DEPOSIT_BYTES: u64 = 200;
/// Smallest USDC deposit that can be proven (0.01 USDC): makes dust spam cost the spammer.
const MIN_PROVEN_USDC: u128 = 10_000;
/// How many proven USDC deposits usdc_info lists per chain (the total counts all of them).
const RECENT_USDC: usize = 16;
const USDC_OUT_BYTES: u64 = 80;

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
    /// Current price of the listing at `now_ms`: `price` before the auction starts, falling linearly to `floor` at `end_ms`.
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
    /// nBTC (Omni Bridge NEP-141) sent from the Pusaka's own NEAR account.
    WithdrawNbtc { nonce: U64, sats: U128, signed: bool },
    /// The holder named an heir (or removed one with `heir: None`).
    HeirSet { heir: Option<AccountId>, after_ms: U64 },
    /// The holder showed they are still here; the heir's clock restarts.
    StillHere,
    /// The heir claimed the Pusaka after the holder stayed silent for `after_ms`.
    Inherited { from: AccountId, to: AccountId },
    /// The owner took a lender's standing offer; the loan is funded at once.
    LoanOfferAccepted { offer_id: U64, lender: AccountId, due_ms: U64 },
    /// A new lender paid the old one in full and took over on terms no worse for the borrower.
    LoanRefinanced { from: AccountId, to: AccountId, repay: NearToken, due_ms: U64 },
    LoanPartRepaid { amount: NearToken, remaining: NearToken },
    ExtensionProposed { extra_ms: U64, fee: NearToken },
    LoanExtended { due_ms: U64, fee: NearToken },
    /// The holder named guardians who must approve a release to the heir (empty: removed).
    GuardiansSet { guardians: Vec<AccountId>, threshold: u8 },
    /// A guardian approved releasing the Pusaka to the heir; at the quorum the holder's last waiting period starts.
    ReleaseApproved { guardian: AccountId, approvals: u8, release_at_ms: U64 },
    /// The holder had the Pusaka's own NEAR account stake, unstake or withdraw at a staking pool.
    Staking { nonce: U64, pool: AccountId, action: String, amount: NearToken, signed: bool },
}

/// The kinds of transaction the contract signs from a Pusaka's own NEAR account.
#[near(serializers = [json])]
pub enum NearTx {
    Transfer,
    Nbtc { sats: U128 },
    /// deposit_and_stake, unstake or withdraw_all at a staking pool (action: stake | unstake | withdraw).
    Stake { pool: AccountId, action: String },
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

#[near(contract_state, contract_metadata(
    link = "https://github.com/PugarHuda/pusaka",
    standard(standard = "nep171", version = "1.2.0"),
    standard(standard = "nep177", version = "2.0.0"),
    standard(standard = "nep178", version = "1.0.0"),
    standard(standard = "nep181", version = "1.0.0"),
    standard(standard = "nep199", version = "2.0.0"),
    standard(standard = "nep297", version = "1.0.0"),
    standard(standard = "nep330", version = "1.3.0"),
))]
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
    /// Initializes the contract with the NEAR MPC signer it asks for keys and signatures (`v1.signer-prod.testnet` / `v1.signer`).
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

    /// Callback of `nft_mint`: stores the token's Bitcoin public key as derived by the MPC for this contract (never taken from user input).
    #[private]
    pub fn on_key(&mut self, token_id: TokenId) {
        let Ok(bytes) = env::promise_result_checked(0, 256) else {
            env::panic_str("MPC key derivation failed; call refresh_key");
        };
        let s: String = serde_json::from_slice(&bytes).expect("key json");
        raw_put(&format!("ea:{token_id}"), &btc::evm_address_of_mpc_key(&s));
        self.btc_keys.insert(token_id, btc::compress_mpc_key(&s));
    }

    // ---------- verified USDC (NEAR MPC foreign-transaction verification, domain 3) ----------

    /// The token's EVM address as the contract knows it (from the MPC's uncompressed key).
    /// Tokens minted before this was stored need one `evm_key` call.
    pub fn evm_address(&self, token_id: TokenId) -> Option<String> {
        raw_get::<[u8; 20]>(&format!("ea:{token_id}")).map(|a| format!("0x{}", hex::encode(a)))
    }

    /// Anyone: fetches the token's key from the MPC again to record its EVM address.
    pub fn evm_key(&mut self, token_id: TokenId) -> Promise {
        require!(self.btc_keys.contains_key(&token_id), "NoKey");
        require!(self.evm_address(token_id.clone()).is_none(), "EvmAddressKnown");
        Promise::new(self.mpc.clone())
            .function_call(
                "derived_public_key",
                json!({"path": btc_path(&token_id), "predecessor": env::current_account_id(), "domain_id": 0}).to_string().into_bytes(),
                NearToken::from_yoctonear(0),
                Gas::from_tgas(KEY_TGAS),
            )
            .then(Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(5)).on_evm_key(token_id))
    }

    /// Callback of `evm_key`: stores the token's EVM address, derived by the MPC from the same secp256k1 key.
    #[private]
    pub fn on_evm_key(&mut self, token_id: TokenId) {
        let bytes = env::promise_result_checked(0, 256).unwrap_or_else(|_| env::panic_str("MPC key derivation failed"));
        let s: String = serde_json::from_slice(&bytes).expect("key json");
        // same key the token's BTC uses, or something is badly wrong
        require!(self.btc_keys.get(&token_id) == Some(&btc::compress_mpc_key(&s)), "key mismatch");
        raw_put(&format!("ea:{token_id}"), &btc::evm_address_of_mpc_key(&s));
    }

    /// Anyone can prove a USDC deposit into a Pusaka on Base or Arbitrum (the EVM chains NEAR MPC
    /// verifies). Pass the Transfer log as the chain's RPC returns it. The contract checks it is
    /// Circle's USDC paying this token's address, hashes the exact facts and asks the MPC network
    /// to confirm them on a finalized block. Attach ~0.002 NEAR for storage (refunded on failure).
    #[payable]
    #[allow(clippy::too_many_arguments)]
    pub fn prove_usdc_deposit(
        &mut self,
        token_id: TokenId,
        chain_id: U64,
        tx_hash: String,
        log_index: U64,
        transaction_index: U64,
        block_hash: String,
        block_number: U64,
        data: String,
        topics: Vec<String>,
    ) -> Promise {
        let (cid, name, index, usdc_addr) = usdc::chain(chain_id.0).unwrap_or_else(|| env::panic_str("chain not verifiable by NEAR MPC; see usdc::CHAINS"));
        let to = raw_get::<[u8; 20]>(&format!("ea:{token_id}")).unwrap_or_else(|| env::panic_str("EVM address unknown: call evm_key first"));
        require!(topics.len() == 3, "a Transfer log has 3 topics");
        require!(topics[0].trim_start_matches("0x") == usdc::TRANSFER_TOPIC, "not a Transfer log");
        let mut padded = [0u8; 32];
        padded[12..].copy_from_slice(&to);
        require!(usdc::hex32(&topics[2], "topics[2]") == padded, "this Transfer doesn't pay this Pusaka");
        let amount = usdc::amount(&data);
        require!(amount > 0, "zero transfer");
        let tx = usdc::hex32(&tx_hash, "tx_hash");
        require!(amount >= MIN_PROVEN_USDC, "deposit below the minimum that can be proven (0.01 USDC)");
        // A signature from before signed-out USDC was counted could still spend a proven deposit.
        require!(
            !self.eth_nonces.contains_key(&format!("{token_id}:{cid}")) || env::storage_has_key(format!("uo:{token_id}:{cid}").as_bytes()),
            "this Pusaka signed on this chain before USDC accounting existed"
        );
        // One marker per deposit, no list cap: dust transfers can't crowd out real ones (each prover pays).
        require!(!env::storage_has_key(usdc_marker(&token_id, cid, &tx, log_index.0).as_bytes()), "already proven");
        let log = usdc::Log {
            tx,
            log_index: log_index.0,
            tx_index: transaction_index.0,
            block_hash: usdc::hex32(&block_hash, "block_hash"),
            block_number: block_number.0,
            address: hex::decode(usdc_addr).unwrap().try_into().unwrap(),
            data: data.to_ascii_lowercase(),
            topics: topics.iter().map(|t| usdc::hex32(t, "topic")).collect(),
        };
        let expected = hex::encode(usdc::payload_hash(index, &log));
        charge_storage(USDC_DEPOSIT_BYTES, 0);
        let mut request = serde_json::Map::new();
        request.insert(name.into(), json!({"tx_id": hex::encode(tx), "extractors": [{"Log": {"log_index": log_index.0}}], "finality": "Finalized"}));
        Promise::new(self.mpc.clone())
            .function_call_weight(
                "verify_foreign_transaction",
                json!({"request": {"request": request, "domain_id": FOREIGN_TX_DOMAIN, "payload_version": 1, "expected_payload_hash": expected}})
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
                    .on_usdc_proven(token_id, chain_id, hex::encode(tx), log_index, U128(amount), expected, env::predecessor_account_id()),
            )
    }

    /// Callback of `prove_usdc_deposit`: records a USDC transfer to the token's EVM address once the MPC's foreign-transaction check confirms it. Returns whether it was stored.
    #[private]
    #[allow(clippy::too_many_arguments)]
    pub fn on_usdc_proven(&mut self, token_id: TokenId, chain_id: U64, tx: String, log_index: U64, amount: U128, expected: String, payer: AccountId) -> bool {
        // Only the MPC contract's answer to our own request reaches here; it carries the payload
        // hash the network signed after reading the chain itself.
        let attested = env::promise_result_checked(0, 2048)
            .ok()
            .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
            .and_then(|v| v["payload_hash"].as_str().map(|h| h.eq_ignore_ascii_case(&expected)))
            .unwrap_or(false);
        let tx = usdc::hex32(&tx, "tx");
        let marker = usdc_marker(&token_id, chain_id.0, &tx, log_index.0);
        let stored = attested && !env::storage_has_key(marker.as_bytes()); // a parallel proof may have landed first
        if stored {
            env::storage_write(marker.as_bytes(), &[1]);
            let total = format!("up:{token_id}:{}", chain_id.0);
            raw_put(&total, &raw_get::<u128>(&total).unwrap_or(0).saturating_add(amount.0));
            // the latest few, for display; the total above is what counts
            let recent = format!("ud:{token_id}:{}", chain_id.0);
            let mut deposits: Vec<UsdcDeposit> = raw_get(&recent).unwrap_or_default();
            deposits.push(UsdcDeposit { tx, log_index: log_index.0, amount: amount.0 });
            if deposits.len() > RECENT_USDC { deposits.remove(0); }
            raw_put(&recent, &deposits);
        } else {
            refund(payer, env::storage_byte_cost().saturating_mul(USDC_DEPOSIT_BYTES as u128));
        }
        stored
    }

    /// Whether this USDC transfer (chain, tx hash, log index) is already recorded for the token.
    pub fn usdc_is_proven(&self, token_id: TokenId, chain_id: U64, tx: String, log_index: U64) -> bool {
        env::storage_has_key(usdc_marker(&token_id, chain_id.0, &usdc::hex32(&tx, "tx"), log_index.0).as_bytes())
    }

    /// Per chain: USDC proven by NEAR MPC, ever signed out by this contract, and what a buyer or
    /// lender can rely on (`verified` = proven - signed out), in USDC base units (6 decimals).
    pub fn usdc_info(&self, token_id: TokenId) -> Vec<Value> {
        usdc::CHAINS
            .iter()
            .map(|c| {
                let deposits: Vec<UsdcDeposit> = raw_get(&format!("ud:{token_id}:{}", c.0)).unwrap_or_default();
                let proven = raw_get::<u128>(&format!("up:{token_id}:{}", c.0)).unwrap_or(0);
                let out = raw_get::<u128>(&format!("uo:{token_id}:{}", c.0)).unwrap_or(0);
                json!({
                    "chain_id": U64(c.0), "chain": c.1, "usdc": format!("0x{}", c.3),
                    "verified": U128(proven.saturating_sub(out)), "proven": U128(proven), "signed_out": U128(out),
                    "deposits": deposits.iter().map(|d| json!({"tx": format!("0x{}", hex::encode(d.tx)), "log_index": U64(d.log_index), "amount": U128(d.amount)})).collect::<Vec<_>>(),
                })
            })
            .collect()
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
            OUTPOINT_BYTES * utxos.len() as u64 + CHANGE_BYTES,
            utxos.len() as u128,
        );

        let pk = self.btc_keys.get(&token_id).unwrap().clone();
        let pkh = btc::hash160(&pk);
        let inputs: Vec<_> = utxos.iter().map(|u| (u.txid.clone(), u.vout, u.value.0)).collect();
        let dest = hex::decode(&to_script_hex).expect("bad script hex");
        let spend = btc::build_spend(&pkh, &inputs, dest, amount_sat.0, fee_sat.0, format!("pusaka:{token_id}").as_bytes());
        // The txid of a segwit spend doesn't depend on its signatures: remember it, so its change can be proven below 10,000 sats.
        env::storage_write(change_key(&btc::txid(&spend.tx)).as_bytes(), token_id.as_bytes());

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

    /// Callback of `withdraw`: collects the MPC signature for every input, releases the `SignPending` lock and returns the spend. Inputs stay recorded as signed even when a signature failed.
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
        // below the dust floor only the change output of a withdrawal this contract built for this token
        let own_change = vout == 1 && env::storage_read(change_key(&txid).as_bytes()).is_some_and(|t| t == token_id.as_bytes());
        require!(value >= MIN_PROVEN_SATS || (value >= MIN_CHANGE_SATS && own_change), "deposit below the minimum that can be proven");
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

    /// Callback of `prove_deposit`: stores the output as a proven UTXO when the Bitcoin light client confirmed the transaction and the output pays this token's address; refunds the prover when nothing is stored. Returns the light client's answer.
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
            // A parallel proof of the same outpoint, or the cap, can make this a no-op.
            // a withdrawal signed while the proof was in flight spends it: it must not be stored
            let spent = self.signed.get(&token_id).is_some_and(|s| s.iter().any(|o| o.txid == txid && o.vout == vout));
            let list = self.proven.entry(token_id.clone()).or_default();
            if !spent && list.len() < MAX_PROVEN && !list.iter().any(|u| u.txid == txid && u.vout == vout) {
                list.push(ProvenUtxo { txid, vout, value });
                stored = true;
            }
            if stored {
                emit_metadata_update(&token_id); // more verified BTC: new art and description
            }
        }
        if !stored {
            // Nothing was stored: give the prover back the storage they paid for.
            refund(payer, env::storage_byte_cost().saturating_mul(PROVEN_BYTES as u128));
        }
        ok
    }

    // ---------- Heirloom: an heir inherits a silent holder's Pusaka ----------

    /// Name an heir who may claim this Pusaka (and everything it holds) once you have been
    /// silent for `after_ms`; `heir: None` removes it. Calling this again, or `still_here`,
    /// restarts the clock, as does anything else you sign for it (withdraw, list, letter…). Selling or giving the Pusaka clears it.
    #[payable]
    pub fn set_heir(&mut self, token_id: TokenId, heir: Option<AccountId>, after_ms: U64) {
        self.assert_owner(&token_id);
        let owner = env::predecessor_account_id();
        let key = heir_key(&token_id);
        match heir.clone() {
            None => clear_heir(&token_id),
            Some(h) => {
                require!(h != owner, "you can't be your own heir");
                require!(after_ms.0 >= HEIR_MIN_MS, format!("after_ms must be at least {HEIR_MIN_MS}"));
                if !env::storage_has_key(key.as_bytes()) { charge_storage(HEIR_BYTES, 0); }
                raw_put(&key, &Heir { owner, heir: h, after_ms: after_ms.0, last_seen_ms: env::block_timestamp_ms() });
            }
        }
        self.log(&token_id, Event::HeirSet { heir, after_ms });
    }

    /// Proof of life without doing anything else; any other call of the holder's counts too.
    pub fn still_here(&mut self, token_id: TokenId) {
        require!(env::storage_has_key(heir_key(&token_id).as_bytes()), "no heir set");
        self.assert_owner(&token_id); // restarts the clock
        self.log(&token_id, Event::StillHere);
    }

    /// Name guardians for your will: once you have been silent for the heir's `after_ms`, `threshold` of them must
    /// approve before the heir can claim, and then you still have a last waiting period to cancel by showing up.
    /// They can only release the Pusaka to the heir you named, never take it. An empty list removes them.
    #[payable]
    pub fn set_guardians(&mut self, token_id: TokenId, guardians: Vec<AccountId>, threshold: u8) {
        self.assert_owner(&token_id);
        let owner = env::predecessor_account_id();
        let h: Heir = raw_get(&heir_key(&token_id)).expect("name an heir first");
        let key = guardians_key(&token_id);
        if guardians.is_empty() {
            env::storage_remove(key.as_bytes());
        } else {
            require!(guardians.len() <= MAX_GUARDIANS, format!("at most {MAX_GUARDIANS} guardians"));
            require!(threshold >= 1 && (threshold as usize) <= guardians.len(), "threshold must be between 1 and the number of guardians");
            for (i, g) in guardians.iter().enumerate() {
                require!(*g != owner && *g != h.heir, "a guardian can't be the holder or the heir");
                require!(!guardians[..i].contains(g), "each guardian once");
            }
            if !env::storage_has_key(key.as_bytes()) { charge_storage(GUARDIAN_BYTES, 0); }
            raw_put(&key, &Guardians { owner, members: guardians.clone(), threshold, approvals: vec![], for_seen_ms: 0, release_at_ms: 0 });
        }
        self.log(&token_id, Event::GuardiansSet { guardians, threshold });
    }

    /// A guardian agrees the holder is gone: possible only once the holder has been silent for the heir's
    /// `after_ms`. At `threshold` approvals the release is scheduled `RELEASE_WAIT_MS` later; anything the holder
    /// signs before then (or `still_here`) voids every approval.
    pub fn approve_release(&mut self, token_id: TokenId) {
        let h: Heir = raw_get(&heir_key(&token_id)).expect("no heir set");
        require!(h.owner == self.owner_of(&token_id), "the heir was named by an earlier holder");
        let key = guardians_key(&token_id);
        let mut g: Guardians = raw_get(&key).expect("no guardians");
        let me = env::predecessor_account_id();
        require!(g.members.contains(&me), "only a named guardian can approve");
        let now = env::block_timestamp_ms();
        let due = h.last_seen_ms.saturating_add(h.after_ms);
        require!(now >= due, format!("the holder was seen recently; guardians can approve from {due} ms"));
        if g.for_seen_ms != h.last_seen_ms {
            // a new silence: approvals given before the holder last showed up don't carry over
            g.approvals.clear();
            g.release_at_ms = 0;
            g.for_seen_ms = h.last_seen_ms;
        }
        require!(!g.approvals.contains(&me), "already approved");
        g.approvals.push(me.clone());
        if g.release_at_ms == 0 && g.approvals.len() >= g.threshold as usize {
            g.release_at_ms = now.saturating_add(RELEASE_WAIT_MS);
        }
        let (approvals, release_at_ms) = (g.approvals.len() as u8, U64(g.release_at_ms));
        raw_put(&key, &g);
        self.log(&token_id, Event::ReleaseApproved { guardian: me, approvals, release_at_ms });
    }

    /// The current holder's guardians: who, how many must approve, the approvals that still count, and when the
    /// heir can claim (after the quorum's waiting period, or alone after the backstop).
    pub fn guardians_of(&self, token_id: TokenId) -> Option<Value> {
        let h: Heir = raw_get(&heir_key(&token_id))?;
        let g: Guardians = raw_get(&guardians_key(&token_id))?;
        if self.tokens.owner_by_id.get(&token_id).as_ref() != Some(&g.owner) { return None; }
        let live = g.for_seen_ms == h.last_seen_ms;
        Some(json!({
            "guardians": g.members, "threshold": g.threshold,
            "approvals": if live { g.approvals.clone() } else { vec![] },
            "release_at_ms": if live && g.release_at_ms > 0 { Some(U64(g.release_at_ms)) } else { None },
            "release_wait_ms": U64(RELEASE_WAIT_MS),
            "backstop_from_ms": U64(h.last_seen_ms.saturating_add(h.after_ms.saturating_mul(BACKSTOP_SILENCES))),
        }))
    }

    /// The heir takes the Pusaka after the holder's silence. Waits for a funded loan (the
    /// lender's claim comes first) and anything in flight; an open listing or loan request of
    /// the silent holder is withdrawn.
    pub fn claim_inheritance(&mut self, token_id: TokenId) {
        let key = heir_key(&token_id);
        let h: Heir = raw_get(&key).expect("no heir set");
        let owner = self.owner_of(&token_id);
        require!(h.owner == owner, "the heir was named by an earlier holder");
        require!(env::predecessor_account_id() == h.heir, "only the named heir can claim");
        let due = h.last_seen_ms.saturating_add(h.after_ms);
        let now = env::block_timestamp_ms();
        require!(now >= due, format!("the holder was seen recently; claimable from {due} ms"));
        if let Some(g) = raw_get::<Guardians>(&guardians_key(&token_id)).filter(|g| g.owner == owner) {
            let backstop = h.last_seen_ms.saturating_add(h.after_ms.saturating_mul(BACKSTOP_SILENCES));
            let released = g.for_seen_ms == h.last_seen_ms && g.release_at_ms > 0 && now >= g.release_at_ms;
            require!(released || now >= backstop, format!(
                "the guardians must approve the release first ({} of {} so far), or wait for the backstop at {backstop} ms",
                if g.for_seen_ms == h.last_seen_ms { g.approvals.len() } else { 0 }, g.threshold));
        }
        require!(self.btc_keys.contains_key(&token_id), "KeyNotReady");
        require!(!self.pending.contains_key(&token_id), "SignPending");
        if let Some(l) = self.loans.get(&token_id) {
            require!(l.lender.is_none(), "Collateralised: the lender's claim comes first");
            self.loans.remove(&token_id);
            self.log(&token_id, Event::LoanCancelled);
        }
        if self.listings.remove(&token_id).is_some() {
            self.log(&token_id, Event::Unlisted);
        }
        self.end_gift(&token_id); // an open gift link dies with the holder's will
        // internal_transfer also clears NEP-178 approvals, so no market can sell it afterwards
        self.tokens.internal_transfer(&owner, &h.heir, &token_id, None, None);
        clear_heir(&token_id);
        self.log(&token_id, Event::Inherited { from: owner, to: h.heir });
    }

    /// The current holder's heir, if any: { heir, after_ms, last_seen_ms, claimable_from_ms } (with guardians, see
    /// guardians_of for when the heir can actually claim).
    pub fn heir_of(&self, token_id: TokenId) -> Option<Value> {
        let h: Heir = raw_get(&heir_key(&token_id))?;
        (self.tokens.owner_by_id.get(&token_id).as_ref() == Some(&h.owner)).then(|| json!({
            "heir": h.heir, "after_ms": U64(h.after_ms), "last_seen_ms": U64(h.last_seen_ms),
            "claimable_from_ms": U64(h.last_seen_ms.saturating_add(h.after_ms)),
        }))
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
        // Verified USDC = proven deposits - everything ever signed out, recorded before signing.
        // Written for every signature on a chain the MPC verifies (0 added for non-USDC), so "nonce
        // floor set but no counter" means a signature predates USDC accounting (see prove_usdc_deposit).
        let usdc_out = usdc::chain(chain_id.0).map(|c| {
            let is_usdc = erc20.as_deref().is_some_and(|t| t.trim_start_matches("0x").eq_ignore_ascii_case(c.3));
            (format!("uo:{token_id}:{}", chain_id.0), if is_usdc { value_wei.0 } else { 0 })
        });
        let new_out = usdc_out.as_ref().is_some_and(|(k, _)| !env::storage_has_key(k.as_bytes()));
        charge_storage(if new_entry { ETH_NONCE_BYTES } else { 0 } + if new_out { USDC_OUT_BYTES } else { 0 }, 1);
        if let Some((k, add)) = usdc_out {
            let out = raw_get::<u128>(&k).unwrap_or(0).saturating_add(add);
            raw_put(&k, &out);
        }
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

    /// Callback of `withdraw_eth`: returns the signed EIP-1559 transaction and releases the lock; the nonce floor stays raised either way.
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
        require!(!amount.is_zero(), "amount must be > 0");
        self.internal_near_tx(token_id, receiver_id, amount, NearTx::Transfer, nonce, block_hash)
    }

    /// Owner-only. Sends nBTC (Omni Bridge) held by the Pusaka's own NEAR account: the one other
    /// transaction shape the contract signs from it, `ft_transfer` on the nBTC contract with 1 yoctoNEAR
    /// (gas paid from the account's NEAR). Native BTC the Pusaka deposits to the Omni BTC connector,
    /// with its NEAR account as recipient, arrives there as nBTC and moves with the NFT.
    /// Attach ~0.01 NEAR (storage, refunded) and 300 TGas.
    #[payable]
    pub fn withdraw_nbtc(&mut self, token_id: TokenId, receiver_id: AccountId, sats: U128, nonce: U64, block_hash: String) -> Promise {
        require!(sats.0 > 0, "sats must be > 0");
        self.internal_near_tx(token_id, receiver_id, NearToken::from_yoctonear(0), NearTx::Nbtc { sats }, nonce, block_hash)
    }

    /// Owner-only. The Pusaka's own NEAR account delegates to a staking pool from the official factory
    /// (action `stake` puts `amount` in with deposit_and_stake, `unstake` starts taking `amount` out,
    /// `withdraw` collects whatever finished unstaking). The stake and its rewards stay the account's,
    /// so they move with the NFT: only the next holder can unstake them. Attach ~0.01 NEAR, 300 TGas.
    #[payable]
    pub fn stake_near(&mut self, token_id: TokenId, pool: AccountId, action: String, amount: NearToken, nonce: U64, block_hash: String) -> Promise {
        self.assert_owner(&token_id);
        require!(pool.as_str().ends_with(POOL_SUFFIX) && pool.as_str().len() > POOL_SUFFIX.len(), format!("pool must be a staking pool *{POOL_SUFFIX}"));
        require!(matches!(action.as_str(), "stake" | "unstake" | "withdraw"), "action: stake, unstake or withdraw");
        require!(action == "withdraw" || !amount.is_zero(), "amount must be > 0");
        let key = pools_key(&token_id);
        let mut pools = self.staking_pools_of(token_id.clone());
        if !pools.contains(&pool) {
            require!(pools.len() < MAX_POOLS, "this Pusaka already uses 3 pools");
            pools.push(pool.clone());
            env::storage_write(key.as_bytes(), &serde_json::to_vec(&pools).unwrap());
        }
        self.internal_near_tx(token_id, pool.clone(), amount, NearTx::Stake { pool, action }, nonce, block_hash)
    }

    /// Staking pools this Pusaka's NEAR account has delegated to; ask each pool for its balances.
    pub fn staking_pools_of(&self, token_id: TokenId) -> Vec<AccountId> {
        env::storage_read(pools_key(&token_id).as_bytes()).map(|b| serde_json::from_slice(&b).unwrap()).unwrap_or_default()
    }

    fn internal_near_tx(&mut self, token_id: TokenId, receiver_id: AccountId, amount: NearToken, kind: NearTx, nonce: U64, block_hash: String) -> Promise {
        self.assert_owner(&token_id);
        self.assert_free(&token_id);
        let block_hash = parse_b58_32(&block_hash, "block_hash");
        let key = format!("{token_id}:near");
        let pools = if matches!(kind, NearTx::Stake { .. }) { POOLS_BYTES } else { 0 };
        charge_storage(pools + if self.eth_nonces.contains_key(&key) { 0 } else { ETH_NONCE_BYTES }, 1);
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
                    .on_near_key(token_id, receiver_id, amount, nonce, block_hash, kind),
            )
    }

    /// Callback of `withdraw_near`: with the token's NEAR implicit-account key from the MPC, builds the Transfer transaction to sign.
    #[private]
    pub fn on_near_key(&mut self, token_id: TokenId, receiver_id: AccountId, amount: NearToken, nonce: U64, block_hash: [u8; 32], kind: NearTx) -> PromiseOrValue<SignedNear> {
        let Some(pk) = ed25519_key_result() else {
            self.pending.remove(&token_id);
            self.log(&token_id, near_event(&kind, nonce, amount, false));
            return PromiseOrValue::Value(SignedNear { transaction: String::new(), account: String::new(), signature: None });
        };
        let tx = match &kind {
            NearTx::Nbtc { sats } => near_ft_transfer_tx(&pk, nonce.0, &NBTC.parse().unwrap(), &receiver_id, sats.0, &block_hash),
            NearTx::Transfer => near_transfer_tx(&pk, nonce.0, &receiver_id, &block_hash, amount.as_yoctonear()),
            NearTx::Stake { pool, action } => near_stake_tx(&pk, nonce.0, pool, action, amount.as_yoctonear(), &block_hash),
        };
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
                        .on_near_signed(token_id, nonce, amount, base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &tx), hex::encode(pk), kind),
                ),
        )
    }

    /// Callback of `withdraw_near`: returns the signed NEAR transaction and releases the lock.
    #[private]
    pub fn on_near_signed(&mut self, token_id: TokenId, nonce: U64, amount: NearToken, transaction: String, account: String, kind: NearTx) -> SignedNear {
        self.pending.remove(&token_id);
        let signature: Option<Value> = match env::promise_result_checked(0, 1024) {
            Ok(b) => serde_json::from_slice(&b).ok(),
            _ => None,
        };
        let signed = signature.is_some();
        self.log(&token_id, near_event(&kind, nonce, amount, signed));
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

    /// Callback of `withdraw_sol`: with the token's Ed25519 key from the MPC, builds the Solana transfer message to sign.
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

    /// Callback of `withdraw_sol`: returns the signed Solana transaction and releases the lock.
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

    /// Owner only: takes the token off sale, which unlocks withdrawals and transfers again.
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
        clear_heir(&token_id);
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

    /// Owner only: withdraws an unfunded loan request.
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
        clear_heir(&token_id);
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

    /// Everything about one token in one view: owner, keys, listing and current price, loan, locks, sign epoch, signed outpoints, proven UTXOs, `verified_sats` and history.
    pub fn token_info(&self, token_id: TokenId) -> Option<TokenInfo> {
        let token = self.tokens.nft_token(token_id.clone())?;
        Some(TokenInfo {
            token,
            btc_path: btc_path(&token_id),
            btc_pubkey: self.btc_keys.get(&token_id).map(hex::encode),
            listing: self.listings.get(&token_id).cloned(),
            price_now: self.listings.get(&token_id).map(|l| l.price_at(env::block_timestamp_ms())),
            loan: self.loans.get(&token_id).cloned(),
            pending: self.pending.contains_key(&token_id) || in_transfer_call(&token_id),
            sign_epoch: self.epoch(&token_id),
            signed_outpoints: self.signed.get(&token_id).cloned().unwrap_or_default(),
            proven_utxos: self.proven.get(&token_id).cloned().unwrap_or_default(),
            verified_sats: U64(self.verified_sats(&token_id)),
            history: self.history.get(&token_id).cloned().unwrap_or_default(),
        })
    }

    /// The MPC signer account this contract uses.
    pub fn mpc_contract(&self) -> AccountId {
        self.mpc.clone()
    }

    // ---------- internals ----------

    /// Live metadata: the image and description follow what the token holds (verified BTC and USDC, a sealed letter,
    /// a named heir) and whether its BTC is locked.
    fn with_art(&self, mut t: Token) -> Token {
        let id = t.token_id.clone();
        let usdc: u128 = usdc::CHAINS.iter().map(|ch| {
            raw_get::<u128>(&format!("up:{id}:{}", ch.0)).unwrap_or(0).saturating_sub(raw_get::<u128>(&format!("uo:{id}:{}", ch.0)).unwrap_or(0))
        }).sum();
        let c = art::Contents {
            sats: self.verified_sats(&id),
            usdc,
            letter: t.metadata.as_ref().and_then(|m| m.extra.as_deref()).is_some_and(|e| e.contains("\"letter\"")),
            heir: self.heir_of(id.clone()).is_some(),
            locked: self.listings.contains_key(&id)
                || self.loans.contains_key(&id)
                || self.pending.contains_key(&id)
                || t.approved_account_ids.as_ref().is_some_and(|a| !a.is_empty()),
        };
        if let (Some(m), Some(pk)) = (t.metadata.as_mut(), self.btc_keys.get(&id)) {
            m.media = Some(art::data_uri(&art::emblem_svg(pk, &c)));
            let mut d = format!("Holds {}.{:08} BTC verified on NEAR by the Bitcoin light client", c.sats / 100_000_000, c.sats % 100_000_000);
            if c.usdc > 0 {
                d.push_str(&format!(" and {}.{:06} USDC verified by NEAR's MPC network", c.usdc / 1_000_000, c.usdc % 1_000_000));
            }
            d.push('.');
            if c.letter { d.push_str(" Carries a sealed letter for its holder."); }
            if c.heir { d.push_str(" Has a named heir."); }
            if c.locked { d.push_str(" Locked: listed, collateral, approved to a market, or signing."); }
            m.description = Some(d);
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
                // split before multiplying: a payout in a 24+-decimal FT must not overflow (and panic)
                let r = amount / 10_000 * ROYALTY_BPS + amount % 10_000 * ROYALTY_BPS / 10_000;
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

    /// Also proof of life: anything the holder signs restarts their heir's clock.
    fn assert_owner(&self, token_id: &TokenId) {
        let owner = self.tokens.owner_by_id.get(token_id).expect("NoToken");
        require!(owner == env::predecessor_account_id(), "NotOwner");
        require!(!in_transfer_call(token_id), "TransferCallPending");
        let key = heir_key(token_id);
        if let Some(mut h) = raw_get::<Heir>(&key) {
            if h.owner == owner {
                h.last_seen_ms = env::block_timestamp_ms();
                raw_put(&key, &h);
            }
        }
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
        require!(!in_transfer_call(token_id), "TransferCallPending");
        require!(!self.listings.contains_key(token_id), "Listed");
        require!(!self.loans.contains_key(token_id), "Collateralised");
        require!(!gift::is_gifted(token_id), "Gifted: cancel the gift first");
    }

    fn has_approvals(&self, token_id: &TokenId) -> bool {
        self.tokens.approvals_by_id.as_ref().and_then(|a| a.get(token_id)).is_some_and(|m| !m.is_empty())
    }

    fn owner_of(&self, token_id: &TokenId) -> AccountId {
        self.tokens.owner_by_id.get(token_id).unwrap_or_else(|| env::panic_str("TokenNotFound"))
    }

    fn log(&mut self, token_id: &str, event: Event) {
        // Every logged event changes the owner or the lock state, and so the live art (with_art).
        emit_metadata_update(token_id);
        // NEAR Social: tell the account this event happened to, in its SocialDB notifications
        let to = match &event {
            Event::Sale { from, .. } => Some((from.clone(), "sold")),
            Event::Transfer { to, .. } => Some((to.clone(), "received")),
            Event::LoanFunded { .. } => self.tokens.owner_by_id.get(&token_id.to_string()).map(|o| (o, "loan_funded")),
            Event::LoanOfferAccepted { lender, .. } => Some((lender.clone(), "offer_taken")),
            Event::LoanRepaid { lender, .. } => Some((lender.clone(), "loan_repaid")),
            Event::HeirSet { heir: Some(h), .. } => Some((h.clone(), "named_heir")),
            _ => None,
        };
        // Not from callbacks (their predecessor is the contract): they run on a fixed gas budget, and
        // nft_resolve_transfer must always finish or the token stays locked (TransferCallPending).
        if let Some((who, kind)) = to.filter(|_| env::predecessor_account_id() != env::current_account_id()) {
            social_notify(&who, kind, token_id);
        }
        let h = self.history.entry(token_id.to_string()).or_default();
        h.push(Entry { at_ms: U64(env::block_timestamp_ms()), event });
        // ponytail: bounded so list/cancel spam can't grow storage; full history lives in tx logs
        if h.len() > MAX_HISTORY {
            h.remove(0);
        }
    }
}

/// SocialDB (NEAR Social), where wallets and social apps read an account's notifications.
#[cfg(not(feature = "mainnet"))]
const SOCIAL_DB: &str = "v1.social08.testnet";
#[cfg(feature = "mainnet")]
const SOCIAL_DB: &str = "social.near";
const SOCIAL_TGAS: u64 = 10;

/// Writes a NEAR Social notification (`index.notify`, the standard notifications index) from the contract's
/// own SocialDB account to `who`. Detached: a full SocialDB storage balance or any failure there never
/// undoes the sale or loan that triggered it. Storage is prepaid with `storage_deposit` on SocialDB for
/// this contract; index entries overwrite one key, so it doesn't grow.
fn social_notify(who: &AccountId, kind: &str, token_id: &str) {
    let me = env::current_account_id();
    let value = json!({ "key": who, "value": { "type": "pusaka", "event": kind, "token_id": token_id, "contract": me } });
    let data = json!({ "data": { me.as_str(): { "index": { "notify": value.to_string() } } } });
    Promise::new(SOCIAL_DB.parse().unwrap())
        .function_call("set", data.to_string().into_bytes(), NearToken::from_yoctonear(0), Gas::from_tgas(SOCIAL_TGAS))
        .detach();
}

/// Events a third party can repeat cheaply go to the transaction log only, not the bounded history.
fn log_only(token_id: &str, e: &Event) {
    env::log_str(&format!("pusaka #{token_id}: {}", serde_json::to_string(e).unwrap_or_default()));
}

/// NEP-171 1.2.0 `nft_metadata_update`: the token's metadata is computed live (`with_art`), so wallets and
/// indexers need this to know when to fetch it again.
fn emit_metadata_update(token_id: &str) {
    let e = json!({ "standard": "nep171", "version": "1.2.0", "event": "nft_metadata_update", "data": [{ "token_ids": [token_id] }] });
    env::log_str(&format!("EVENT_JSON:{e}"));
}

/// A USDC deposit NEAR MPC attested (see usdc.rs).
#[near(serializers = [borsh])]
pub struct UsdcDeposit {
    pub tx: [u8; 32],
    pub log_index: u64,
    pub amount: u128,
}

// ponytail: raw storage under string prefixes (ea:, ud:, uo:) instead of new state fields, so
// adding verified USDC needed no migration. Upgrade: fold into Pusaka with the next migrate().
fn usdc_marker(token_id: &str, chain_id: u64, tx: &[u8; 32], log_index: u64) -> String {
    format!("ux:{token_id}:{chain_id}:{}:{log_index}", hex::encode(tx))
}

fn raw_get<T: near_sdk::borsh::BorshDeserialize>(key: &str) -> Option<T> {
    env::storage_read(key.as_bytes()).map(|b| near_sdk::borsh::from_slice(&b).expect("raw storage"))
}

fn raw_put<T: near_sdk::borsh::BorshSerialize>(key: &str, value: &T) {
    env::storage_write(key.as_bytes(), &near_sdk::borsh::to_vec(value).unwrap());
}

/// An heir named by `owner`: may claim once `owner` has been silent for `after_ms`.
#[near(serializers = [borsh])]
pub struct Heir {
    pub owner: AccountId,
    pub heir: AccountId,
    pub after_ms: u64,
    pub last_seen_ms: u64,
}

fn change_key(txid: &str) -> String {
    format!("ch:{txid}")
}

fn heir_key(token_id: &str) -> String {
    format!("hr:{token_id}")
}

// ponytail: raw `tc:` key, like the heir's, so the lock needed no migration.
fn transfer_call_key(token_id: &str) -> String {
    format!("tc:{token_id}")
}

/// Set from nft_transfer_call until nft_resolve_transfer: the receiver owns the token meanwhile
/// but nobody can sign, list, lend, approve or move it. No unlock_stale: the resolve always runs.
// ponytail: fail-closed, no timeout. A receiver can delay nft_resolve_transfer (chained promises), so a lock
// that lapsed would let it empty the token before handing it back. The callback does no cross-contract work
// (no SocialDB notify from callbacks), so its fixed gas covers it.
fn in_transfer_call(token_id: &str) -> bool {
    env::storage_has_key(transfer_call_key(token_id).as_bytes())
}

/// Any change of holder ends the old holder's will: a buyer never inherits someone else's heir or guardians.
fn clear_heir(token_id: &str) {
    env::storage_remove(heir_key(token_id).as_bytes());
    env::storage_remove(guardians_key(token_id).as_bytes());
}

/// Guardians named by `owner`: `threshold` of them must approve before the heir can claim. Approvals count only
/// for the silence they were given in (`for_seen_ms` = the holder's last_seen then): any sign of life voids them.
#[near(serializers = [borsh])]
pub struct Guardians {
    pub owner: AccountId,
    pub members: Vec<AccountId>,
    pub threshold: u8,
    pub approvals: Vec<AccountId>,
    pub for_seen_ms: u64,
    pub release_at_ms: u64,
}

fn guardians_key(token_id: &str) -> String {
    format!("gd:{token_id}")
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

fn near_event(kind: &NearTx, nonce: U64, amount: NearToken, signed: bool) -> Event {
    match kind {
        NearTx::Nbtc { sats } => Event::WithdrawNbtc { nonce, sats: *sats, signed },
        NearTx::Transfer => Event::WithdrawNear { nonce, amount, signed },
        NearTx::Stake { pool, action } => Event::Staking { nonce, pool: pool.clone(), action: action.clone(), amount, signed },
    }
}

fn pools_key(token_id: &str) -> String {
    format!("sp:{token_id}")
}

/// Borsh `Transaction` (v0) from the implicit account of `pk` with one FunctionCall on `receiver`.
#[allow(clippy::too_many_arguments)]
pub fn near_call_tx(pk: &[u8; 32], nonce: u64, receiver: &str, method: &str, args: &[u8], gas: u64, deposit: u128, block_hash: &[u8; 32]) -> Vec<u8> {
    let str_ = |t: &mut Vec<u8>, s: &[u8]| { t.extend((s.len() as u32).to_le_bytes()); t.extend(s); };
    let mut t = vec![];
    str_(&mut t, hex::encode(pk).as_bytes()); // signer_id: the implicit account
    t.push(0); // PublicKey::ED25519
    t.extend(pk);
    t.extend(nonce.to_le_bytes());
    str_(&mut t, receiver.as_bytes());
    t.extend(block_hash);
    t.extend(1u32.to_le_bytes()); // one action
    t.push(2); // Action::FunctionCall
    str_(&mut t, method.as_bytes());
    str_(&mut t, args);
    t.extend(gas.to_le_bytes());
    t.extend(deposit.to_le_bytes());
    t
}

/// `ft_transfer({receiver_id, amount})` on `token`, 1 yoctoNEAR (NEP-141 requires exactly that), 30 TGas.
pub fn near_ft_transfer_tx(pk: &[u8; 32], nonce: u64, token: &AccountId, receiver: &AccountId, amount: u128, block_hash: &[u8; 32]) -> Vec<u8> {
    let args = json!({"receiver_id": receiver, "amount": amount.to_string()}).to_string();
    near_call_tx(pk, nonce, token.as_str(), "ft_transfer", args.as_bytes(), 30_000_000_000_000, 1, block_hash)
}

/// The staking pool calls: deposit_and_stake (attaching `yocto`), unstake({amount}), withdraw_all. 125 TGas each.
pub fn near_stake_tx(pk: &[u8; 32], nonce: u64, pool: &AccountId, action: &str, yocto: u128, block_hash: &[u8; 32]) -> Vec<u8> {
    let (method, args, deposit) = match action {
        "stake" => ("deposit_and_stake", "{}".to_string(), yocto),
        "unstake" => ("unstake", json!({"amount": yocto.to_string()}).to_string(), 0),
        _ => ("withdraw_all", "{}".to_string(), 0),
    };
    near_call_tx(pk, nonce, pool.as_str(), method, args.as_bytes(), 125_000_000_000_000, deposit, block_hash)
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
        clear_heir(&token_id);
        self.log(&token_id, Event::Transfer { from, to: receiver_id });
    }

    /// The receiver owns the token during the call but can't withdraw, sign, list or move it
    /// (T8): the token stays locked until nft_resolve_transfer, which returns it if asked.
    #[payable]
    fn nft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        approval_id: Option<u64>,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<bool> {
        near_sdk::assert_one_yocto();
        self.assert_unlocked(&token_id);
        let sender = env::predecessor_account_id();
        let (from, approvals) = self.tokens.internal_transfer(&sender, &receiver_id, &token_id, approval_id, memo);
        clear_heir(&token_id);
        raw_put(&transfer_call_key(&token_id), &());
        // A buyer or lender who looked before the call must look again (T4/T19). Nothing was
        // signed, so no approval cooldown (signed_at) is started.
        self.sign_epoch.insert(token_id.clone(), self.epoch(&token_id) + 1);
        self.log(&token_id, Event::Transfer { from: from.clone(), to: receiver_id.clone() });
        ext_nft_receiver::ext(receiver_id.clone())
            .with_unused_gas_weight(1)
            .nft_on_transfer(sender, from.clone(), token_id.clone(), msg)
            .then(
                // ponytail: our own resolve gas, not the standard's 5 TGas: if the resolve ran out,
                // the lock would never clear.
                Self::ext(env::current_account_id())
                    .with_static_gas(Gas::from_tgas(CALLBACK_TGAS))
                    .with_unused_gas_weight(0)
                    .nft_resolve_transfer(from, receiver_id, token_id, approvals),
            )
            .into()
    }

    fn nft_token(&self, token_id: TokenId) -> Option<Token> {
        self.tokens.nft_token(token_id).map(|t| self.with_art(t))
    }
}

#[near]
impl NonFungibleTokenResolver for Pusaka {
    #[private]
    fn nft_resolve_transfer(
        &mut self,
        previous_owner_id: AccountId,
        receiver_id: AccountId,
        token_id: TokenId,
        approved_account_ids: Option<std::collections::HashMap<AccountId, u64>>,
    ) -> bool {
        env::storage_remove(transfer_call_key(&token_id).as_bytes());
        let kept = self.tokens.nft_resolve_transfer(previous_owner_id.clone(), receiver_id.clone(), token_id.clone(), approved_account_ids);
        if !kept {
            self.log(&token_id, Event::Transfer { from: receiver_id, to: previous_owner_id });
        }
        kept
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

    /// NEP-178: the owner revokes one market's approval (1 yoctoNEAR).
    #[payable]
    pub fn nft_revoke(&mut self, token_id: TokenId, account_id: AccountId) {
        near_contract_standards::non_fungible_token::approval::NonFungibleTokenApproval::nft_revoke(
            &mut self.tokens, token_id.clone(), account_id);
        if !self.has_approvals(&token_id) {
            self.log(&token_id, Event::ApprovalsRevoked);
        }
    }

    /// NEP-178: the owner revokes every approval (1 yoctoNEAR), which unlocks the BTC again.
    #[payable]
    pub fn nft_revoke_all(&mut self, token_id: TokenId) {
        near_contract_standards::non_fungible_token::approval::NonFungibleTokenApproval::nft_revoke_all(
            &mut self.tokens, token_id.clone());
        self.log(&token_id, Event::ApprovalsRevoked);
    }

    /// NEP-178: whether `approved_account_id` may transfer the token (with `approval_id`, only that approval).
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

// ---------- loan market: lender offers, refinancing, partial repayment, extensions ----------

/// A lender's standing offer, with `principal` escrowed in the contract. Either for one
/// token, or for any token with at least `min_verified_sats` proven by the light client.
#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct LoanOffer {
    pub lender: AccountId,
    pub token_id: Option<TokenId>,
    pub min_verified_sats: Option<U64>,
    pub principal: NearToken,
    pub repay: NearToken,
    pub duration_ms: U64,
    /// Storage the lender paid for this entry; refunded with the principal.
    pub storage: NearToken,
    /// For an offer on one token: its sign epoch when the lender looked. Any signature since (a
    /// withdrawal of the collateral) voids the offer; the borrower's own expected epoch can't.
    pub sign_epoch: Option<u32>,
}

/// The lender's offer to move a funded loan's due date by `extra_ms` for `fee`. Bound to the
/// lender and due date it was made for, so a stale one (repaid, refinanced) can't be accepted.
#[near(serializers = [borsh])]
pub struct Extension {
    pub lender: AccountId,
    pub due_ms: u64,
    pub extra_ms: u64,
    pub fee: NearToken,
}

const EXTENSION_BYTES: u64 = 200;
const MAX_OFFERS_PAGE: u64 = 100;
// ponytail: raw storage (lo#, lo:, lx:) like the heir feature, so no migration. Offers are
// listed by scanning the id range; a per-token index is the upgrade if offers get many.
const OFFER_COUNTER: &str = "lo#";

fn offer_key(id: u64) -> String {
    format!("lo:{id}")
}

fn extension_key(token_id: &str) -> String {
    format!("lx:{token_id}")
}

#[near]
impl Pusaka {
    /// Lender posts a standing offer for one token (`token_id`) or for any token holding at
    /// least `min_verified_sats` of light-client-proven BTC. Attach `principal` plus storage;
    /// the excess is refunded. The principal stays escrowed until accepted or cancelled.
    #[payable]
    pub fn offer_loan(
        &mut self,
        token_id: Option<TokenId>,
        min_verified_sats: Option<U64>,
        principal: NearToken,
        repay: NearToken,
        duration_ms: U64,
    ) -> U64 {
        require!(token_id.is_some() != min_verified_sats.is_some(), "give exactly one of token_id, min_verified_sats");
        if let Some(t) = &token_id {
            self.owner_of(t);
        }
        require!(!principal.is_zero() && repay >= principal, "need 0 < principal <= repay");
        require!(duration_ms.0 > 0, "duration_ms must be > 0");
        let id: u64 = raw_get(OFFER_COUNTER).unwrap_or(0);
        let before = env::storage_usage();
        raw_put(OFFER_COUNTER, &(id + 1));
        let mut offer = LoanOffer {
            lender: env::predecessor_account_id(),
            token_id,
            min_verified_sats,
            principal,
            repay,
            duration_ms,
            storage: NearToken::from_yoctonear(0),
            sign_epoch: None,
        };
        if let Some(t) = &offer.token_id {
            offer.sign_epoch = Some(self.epoch(t));
        }
        raw_put(&offer_key(id), &offer);
        let bytes = env::storage_usage() - before;
        offer.storage = env::storage_byte_cost().saturating_mul(bytes as u128);
        raw_put(&offer_key(id), &offer); // same size: u128 is fixed width
        charge_storage(bytes, principal.as_yoctonear());
        // ponytail: offers stay out of the token's history so nobody can flush it with cheap offers.
        env::log_str(&format!("loan_offer {id} by {} for {}", offer.lender, offer.token_id.as_deref().unwrap_or("any")));
        U64(id)
    }

    /// The lender takes the offer back with its principal and storage.
    pub fn cancel_loan_offer(&mut self, offer_id: U64) {
        let offer: LoanOffer = raw_get(&offer_key(offer_id.0)).expect("NoOffer");
        require!(env::predecessor_account_id() == offer.lender, "NotLender");
        env::storage_remove(offer_key(offer_id.0).as_bytes());
        env::log_str(&format!("loan_offer {} cancelled", offer_id.0));
        refund(offer.lender, offer.principal.saturating_add(offer.storage));
    }

    /// The owner takes a standing offer: the loan is funded at once on the offer's terms and
    /// the principal goes to the owner. Same checks as `request_loan` + `fund_loan`, including
    /// `expected_sign_epoch` (T4), so the lender's sats floor holds when the loan starts.
    /// With a funded loan already on the token this refinances it: the new principal (plus any
    /// deposit) first pays the current lender the full repay, the rest goes to the borrower.
    #[payable]
    pub fn accept_loan_offer(&mut self, token_id: TokenId, offer_id: U64, expected_sign_epoch: u32) {
        let offer: LoanOffer = raw_get(&offer_key(offer_id.0)).expect("NoOffer");
        self.assert_owner(&token_id);
        let borrower = env::predecessor_account_id();
        let old = self.loans.get(&token_id).cloned();
        if let Some(l) = &old {
            require!(l.lender.is_some(), "Collateralised: cancel your loan request first");
            require!(l.borrower == borrower, "NotBorrower");
            self.loans.remove(&token_id); // paid off below; every other lock still applies
        }
        self.assert_free(&token_id);
        self.assert_epoch(&token_id, expected_sign_epoch);
        match (&offer.token_id, offer.min_verified_sats) {
            (Some(t), _) => {
                require!(*t == token_id, "OfferForAnotherToken");
                // the lender priced this token's BTC at offer time; a withdrawal since bumps the epoch
                require!(offer.sign_epoch == Some(self.epoch(&token_id)), "StateChanged: the Pusaka signed something after this offer was made");
            }
            (None, Some(min)) => require!(self.verified_sats(&token_id) >= min.0, "BelowSatsFloor"),
            _ => env::panic_str("bad offer"),
        }
        require!(borrower != offer.lender, "SelfLoan");
        let owed = old.as_ref().map_or(NearToken::from_yoctonear(0), |l| l.repay);
        let have = offer.principal.saturating_add(env::attached_deposit());
        require!(have >= owed, format!("the offer doesn't cover the {owed} owed now: attach the difference"));
        let due = U64(env::block_timestamp_ms().checked_add(offer.duration_ms.0).expect("duration too long"));
        // Removed before any transfer: the same offer can't be accepted or cancelled again.
        env::storage_remove(offer_key(offer_id.0).as_bytes());
        self.loans.insert(
            token_id.clone(),
            Loan {
                borrower: borrower.clone(),
                principal: offer.principal,
                repay: offer.repay,
                duration_ms: offer.duration_ms,
                lender: Some(offer.lender.clone()),
                due_ms: Some(due),
            },
        );
        self.log(&token_id, Event::LoanOfferAccepted { offer_id, lender: offer.lender.clone(), due_ms: due });
        if let Some(l) = old {
            let from = l.lender.unwrap();
            log_only(&token_id, &Event::LoanRefinanced { from: from.clone(), to: offer.lender.clone(), repay: offer.repay, due_ms: due });
            refund(from, owed);
        }
        refund(borrower, have.saturating_sub(owed));
        refund(offer.lender, offer.storage);
    }

    /// Open offers with ids in `[from, from + limit)` and the next id, for paging.
    pub fn loan_offers(&self, from: Option<U64>, limit: Option<U64>) -> Value {
        let next: u64 = raw_get(OFFER_COUNTER).unwrap_or(0);
        let from = from.map_or(0, |f| f.0);
        let end = from.saturating_add(limit.map_or(MAX_OFFERS_PAGE, |l| l.0.min(MAX_OFFERS_PAGE))).min(next);
        let offers: Vec<Value> = (from..end)
            .filter_map(|id| raw_get::<LoanOffer>(&offer_key(id)).map(|o| json!({ "id": U64(id), "offer": o })))
            .collect();
        json!({ "next_id": U64(next), "offers": offers })
    }

    /// The borrower pays part of the loan before it is due; it goes straight to the lender.
    /// To pay the rest in full use `repay_loan`, which also releases the Pusaka.
    #[payable]
    pub fn repay_partial(&mut self, token_id: TokenId) {
        let mut loan = self.loans.get(&token_id).expect("NoLoan").clone();
        let lender = loan.lender.clone().expect("LoanNotFunded");
        require!(env::predecessor_account_id() == loan.borrower, "NotBorrower");
        require!(env::block_timestamp_ms() < loan.due_ms.unwrap().0, "Overdue: repay in full with repay_loan");
        let paid = env::attached_deposit();
        require!(!paid.is_zero() && paid < loan.repay, "attach less than what is left; use repay_loan for all of it");
        loan.repay = loan.repay.checked_sub(paid).unwrap();
        let remaining = loan.repay;
        self.loans.insert(token_id.clone(), loan);
        self.log(&token_id, Event::LoanPartRepaid { amount: paid, remaining });
        Promise::new(lender).transfer(paid).detach();
    }

    /// The lender offers to move the due date by `extra_ms` for `fee`. Attach storage once.
    #[payable]
    pub fn propose_extension(&mut self, token_id: TokenId, extra_ms: U64, fee: NearToken) {
        let loan = self.loans.get(&token_id).expect("NoLoan");
        let lender = loan.lender.clone().expect("LoanNotFunded");
        require!(env::predecessor_account_id() == lender, "NotLender");
        require!(extra_ms.0 > 0, "extra_ms must be > 0");
        let due = loan.due_ms.unwrap().0;
        let key = extension_key(&token_id);
        if !env::storage_has_key(key.as_bytes()) { charge_storage(EXTENSION_BYTES, 0); }
        raw_put(&key, &Extension { lender, due_ms: due, extra_ms: extra_ms.0, fee });
        log_only(&token_id, &Event::ExtensionProposed { extra_ms, fee }); // repeatable by the lender: kept out of the history
    }

    /// The borrower takes the lender's extension before the due date, attaching exactly `fee`.
    #[payable]
    /// `extra_ms` restates what the borrower agreed to, so the lender can't swap the proposal just before.
    pub fn accept_extension(&mut self, token_id: TokenId, extra_ms: U64) {
        let mut loan = self.loans.get(&token_id).expect("NoLoan").clone();
        let lender = loan.lender.clone().expect("LoanNotFunded");
        require!(env::predecessor_account_id() == loan.borrower, "NotBorrower");
        let due = loan.due_ms.unwrap().0;
        require!(env::block_timestamp_ms() < due, "Overdue: the extension had to be taken before the due date");
        let key = extension_key(&token_id);
        let x: Extension = raw_get(&key).expect("NoExtension");
        require!(x.lender == lender && x.due_ms == due, "NoExtension: proposed for an earlier loan or lender");
        require!(env::attached_deposit() == x.fee, format!("WrongFee: attach exactly {}", x.fee));
        require!(x.extra_ms == extra_ms.0, "TermsChanged: the extension proposal changed");
        let new_due = U64(due.checked_add(x.extra_ms).expect("duration too long"));
        loan.due_ms = Some(new_due);
        self.loans.insert(token_id.clone(), loan);
        env::storage_remove(key.as_bytes());
        self.log(&token_id, Event::LoanExtended { due_ms: new_due, fee: x.fee });
        refund(lender, x.fee);
    }

    /// The lender's open extension proposal for this token's current loan, if any.
    pub fn loan_extension(&self, token_id: TokenId) -> Option<Value> {
        let loan = self.loans.get(&token_id)?;
        let x: Extension = raw_get(&extension_key(&token_id))?;
        (loan.lender.as_ref() == Some(&x.lender) && loan.due_ms.map(|d| d.0) == Some(x.due_ms))
            .then(|| json!({ "lender": x.lender, "extra_ms": U64(x.extra_ms), "fee": x.fee }))
    }
}
