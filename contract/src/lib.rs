//! Pusaka — NEP-171 NFTs that each control a native Bitcoin address via NEAR Chain Signatures.
//!
//! The BTC key for token `N` is derived by the MPC network from (this contract, "pusaka-N").
//! Only this contract can request signatures for it, and it only does so for the current
//! NFT owner. Owning the NFT therefore *is* owning the BTC.

mod btc;

use near_contract_standards::non_fungible_token::core::NonFungibleTokenCore;
use near_contract_standards::non_fungible_token::enumeration::NonFungibleTokenEnumeration;
use near_contract_standards::non_fungible_token::metadata::{
    NFTContractMetadata, NonFungibleTokenMetadataProvider, TokenMetadata, NFT_METADATA_SPEC,
};
use near_contract_standards::non_fungible_token::{NonFungibleToken, Token, TokenId};
use near_sdk::json_types::U64;
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
        let elapsed = now_ms.saturating_sub(start) as u128;
        NearToken::from_yoctonear(hi - (hi - lo) * elapsed / (end - start) as u128)
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
    pub signed_outpoints: Vec<OutPointRef>,
    pub history: Vec<Entry>,
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
}

/// State layout before loans existed; used once by `migrate`.
#[near(serializers = [borsh])]
struct PusakaV1 {
    tokens: NonFungibleToken,
    mpc: AccountId,
    next_id: u64,
    btc_keys: LookupMap<TokenId, Vec<u8>>,
    listings: LookupMap<TokenId, Listing>,
    pending: LookupMap<TokenId, u64>,
    signed: LookupMap<TokenId, Vec<OutPointRef>>,
    history: LookupMap<TokenId, Vec<Entry>>,
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
                None::<Key>, // no NEP-178 approvals: nobody but the owner can move a Pusaka
            ),
            mpc,
            next_id: 1,
            btc_keys: LookupMap::new(Key::BtcKeys),
            listings: LookupMap::new(Key::Listings),
            pending: LookupMap::new(Key::Pending),
            signed: LookupMap::new(Key::Signed),
            history: LookupMap::new(Key::History),
            loans: LookupMap::new(Key::Loans),
        }
    }

    /// One-time upgrade from the pre-loan layout. Requires no active listings
    /// (the Listing format changed); cancel them before upgrading.
    #[private]
    #[init(ignore_state)]
    pub fn migrate() -> Self {
        let old: PusakaV1 = env::state_read().expect("no state");
        Self {
            tokens: old.tokens,
            mpc: old.mpc,
            next_id: old.next_id,
            btc_keys: old.btc_keys,
            listings: old.listings,
            pending: old.pending,
            signed: old.signed,
            history: old.history,
            loans: LookupMap::new(Key::Loans),
        }
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
                ..empty_meta()
            }),
            None,
        );
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

    /// Atomic purchase. `expected_signed_count` is the number of signed outpoints the
    /// buyer saw when checking the token's safe balance; if it changed, the buy fails.
    #[payable]
    pub fn buy(&mut self, token_id: TokenId, expected_signed_count: u32) {
        let listing = self.listings.remove(&token_id).expect("NotListed");
        let buyer = env::predecessor_account_id();
        let paid = env::attached_deposit();
        let price = listing.price_at(env::block_timestamp_ms());
        require!(paid >= price, "InsufficientDeposit");
        require!(buyer != listing.seller, "SelfBuy");
        require!(
            self.signed_count(&token_id) == expected_signed_count,
            "StateChanged: signed outpoints differ from what you checked"
        );

        self.tokens.internal_transfer(&listing.seller, &buyer, &token_id, None, None);
        self.log(
            &token_id,
            Event::Sale { from: listing.seller.clone(), to: buyer.clone(), price },
        );
        Promise::new(listing.seller).transfer(price).detach();
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

    /// Lender sends `principal`, which goes straight to the borrower. Like `buy`, the
    /// lender passes the signed-outpoint count they checked the collateral against.
    #[payable]
    pub fn fund_loan(&mut self, token_id: TokenId, expected_signed_count: u32) {
        let mut loan = self.loans.get(&token_id).expect("NoLoan").clone();
        require!(loan.lender.is_none(), "LoanAlreadyFunded");
        let lender = env::predecessor_account_id();
        require!(lender != loan.borrower, "SelfLoan");
        let paid = env::attached_deposit();
        require!(paid >= loan.principal, "InsufficientDeposit");
        require!(
            self.signed_count(&token_id) == expected_signed_count,
            "StateChanged: signed outpoints differ from what you checked"
        );
        let due = U64(env::block_timestamp_ms() + loan.duration_ms.0);
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
            signed_outpoints: self.signed.get(&token_id).cloned().unwrap_or_default(),
            history: self.history.get(&token_id).cloned().unwrap_or_default(),
        })
    }

    pub fn mpc_contract(&self) -> AccountId {
        self.mpc.clone()
    }

    // ---------- internals ----------

    fn signed_count(&self, token_id: &TokenId) -> u32 {
        self.signed.get(token_id).map_or(0, |v| v.len() as u32)
    }

    fn assert_owner(&self, token_id: &TokenId) {
        let owner = self.tokens.owner_by_id.get(token_id).expect("NoToken");
        require!(owner == env::predecessor_account_id(), "NotOwner");
    }

    /// A token may move or sign only when nothing else is in flight.
    fn assert_free(&self, token_id: &TokenId) {
        require!(self.btc_keys.contains_key(token_id), "KeyNotReady");
        require!(!self.pending.contains_key(token_id), "SignPending");
        require!(!self.listings.contains_key(token_id), "Listed");
        require!(!self.loans.contains_key(token_id), "Collateralised");
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
        self.assert_free(&token_id);
        let from = env::predecessor_account_id();
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
        self.tokens.nft_token(token_id)
    }
}

#[near]
impl NonFungibleTokenEnumeration for Pusaka {
    fn nft_total_supply(&self) -> near_sdk::json_types::U128 {
        self.tokens.nft_total_supply()
    }
    fn nft_tokens(&self, from_index: Option<near_sdk::json_types::U128>, limit: Option<u64>) -> Vec<Token> {
        self.tokens.nft_tokens(from_index, limit)
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
        self.tokens.nft_tokens_for_owner(account_id, from_index, limit)
    }
}

#[near]
impl NonFungibleTokenMetadataProvider for Pusaka {
    fn nft_metadata(&self) -> NFTContractMetadata {
        NFTContractMetadata {
            spec: NFT_METADATA_SPEC.to_string(),
            name: "Pusaka".into(),
            symbol: "PUSAKA".into(),
            icon: None,
            base_uri: None,
            reference: None,
            reference_hash: None,
        }
    }
}

#[cfg(test)]
mod tests;
