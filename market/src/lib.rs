//! Pusaka market: standing bids priced per verified sat, and perpetual callable loans.
//!
//! Everything is priced off `token_info(token_id).verified_sats`, read on-chain from the NFT
//! contract at the moment of each fill or loan; nothing in a `msg` is trusted beyond an id.
//!
//! * Bids (Blur collection bids): a bidder escrows `max_sats * price_per_sat`. A holder sells into
//!   it with `nft_approve(token, market, msg = {"bid_id": N})`. While a Pusaka has any approval the
//!   v1 contract refuses withdrawals, so `verified_sats` can't drop between our look and the sale.
//! * Loans (Blend): a lender escrows principal; a holder takes it with
//!   `nft_transfer_call(market, token, msg = {"accept_offer": N})`. The market holds the NFT (it
//!   never asks for a signature, so the BTC can't move) until repaid, refinanced or seized after a
//!   failed refinancing auction.

use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::{self, json, Value};
use near_sdk::store::IterableMap;
use near_sdk::{env, ext_contract, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue};
use std::collections::HashMap;

/// Refinancing auction length: the rate cap rises from 0 to MAX_RATE_BPS over this window.
#[cfg(not(feature = "mainnet"))]
pub const AUCTION_MS: u64 = 30 * 60 * 1000;
#[cfg(feature = "mainnet")]
pub const AUCTION_MS: u64 = 24 * 60 * 60 * 1000;
/// 1000% a year: the top of the auction, and the highest rate an offer may carry.
pub const MAX_RATE_BPS: u32 = 100_000;
pub const YEAR_MS: u128 = 365 * 24 * 60 * 60 * 1000;
const BPS: u128 = 10_000;
/// Flat storage deposit per bid, offer or loan (each record is < 600 bytes; 0.01 NEAR buys 1 kB).
/// Paid by whoever creates the record, refunded to whoever holds it when it's removed.
pub const STORAGE_DEPOSIT: u128 = 10_000_000_000_000_000_000_000;
pub const MAX_PAYOUT: u32 = 10;
const MAX_TOKEN_ID: usize = 64;
const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);

const INFO_TGAS: u64 = 20;
const NFT_TGAS: u64 = 50;
const CB_TGAS: u64 = 20;
/// on_bid_info schedules nft_transfer_payout (NFT_TGAS) and on_bid_payout (CB_TGAS) itself.
const FILL_CB_TGAS: u64 = NFT_TGAS + CB_TGAS + 15;

#[ext_contract(ext_nft)]
#[allow(dead_code)]
trait Nft {
    fn token_info(&self, token_id: String);
    fn nft_transfer(&mut self, receiver_id: AccountId, token_id: String, approval_id: Option<u64>, memo: Option<String>);
    fn nft_transfer_payout(
        &mut self,
        receiver_id: AccountId,
        token_id: String,
        approval_id: Option<u64>,
        memo: Option<String>,
        balance: U128,
        max_len_payout: Option<u32>,
    );
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Bid {
    pub id: U64,
    pub bidder: AccountId,
    pub nft: AccountId,
    pub price_per_sat: U128,
    pub min_sats: U64,
    pub max_sats: U64,
    /// NEAR held for this bid, storage deposit not included.
    pub escrow: U128,
    /// A fill is in flight: no second fill, no cancel.
    pub filling: bool,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Offer {
    pub id: U64,
    pub lender: AccountId,
    pub nft: AccountId,
    pub principal: U128,
    pub rate_bps: u32,
    pub min_sats: U64,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Loan {
    pub id: U64,
    pub borrower: AccountId,
    pub lender: AccountId,
    pub nft: AccountId,
    pub token_id: String,
    pub principal: U128,
    pub rate_bps: u32,
    /// Interest accrues from here.
    pub start_ms: U64,
    /// Set by `call_loan`: the refinancing auction started here.
    pub auction_start_ms: Option<U64>,
    /// An NFT transfer (repay or seize) is in flight.
    pub busy: bool,
}

impl Loan {
    /// principal + principal * rate * elapsed / year, rounded down.
    /// ponytail: saturates instead of panicking (only past ~1e31 yocto-years, i.e. never); a panic here would freeze the loan.
    pub fn debt(&self, now_ms: u64) -> u128 {
        let p = self.principal.0;
        let b = (self.rate_bps as u128).saturating_mul(now_ms.saturating_sub(self.start_ms.0) as u128);
        let d = BPS * YEAR_MS;
        p.saturating_add((p / d).saturating_mul(b).saturating_add((p % d).saturating_mul(b) / d))
    }

    /// The highest rate a refinancing lender may take now: 0 at the call, MAX_RATE_BPS at AUCTION_MS. `None` outside an auction.
    pub fn auction_rate(&self, now_ms: u64) -> Option<u32> {
        let start = self.auction_start_ms?.0;
        let e = now_ms.saturating_sub(start);
        (e < AUCTION_MS).then(|| (MAX_RATE_BPS as u64 * e / AUCTION_MS) as u32)
    }

    fn auction_over(&self, now_ms: u64) -> bool {
        self.auction_start_ms.is_some_and(|s| now_ms >= s.0.saturating_add(AUCTION_MS))
    }
}

/// The part of Pusaka's `TokenInfo` the market reads. Unknown fields are ignored.
#[near(serializers = [json])]
pub struct Info {
    pub token: InfoToken,
    pub verified_sats: U64,
    pub loan: Option<Value>,
    pub listing: Option<Value>,
    pub pending: bool,
}

#[near(serializers = [json])]
pub struct InfoToken {
    pub owner_id: AccountId,
}

#[near(serializers = [json])]
pub struct Payout {
    pub payout: HashMap<AccountId, U128>,
}

#[near(serializers = [json])]
pub struct Reserves {
    /// Sum of open bid escrows.
    pub bids_escrow: U128,
    /// Sum of open offer principals.
    pub offers_escrow: U128,
    /// Sum of open loan principals (lent out; interest not included).
    pub loans_outstanding: U128,
    /// Storage deposits held for open records.
    pub deposits: U128,
    /// bids_escrow + offers_escrow + deposits: NEAR the contract owes back; `balance` must cover it.
    pub owed: U128,
    pub balance: U128,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Market {
    next_id: u64,
    bids: IterableMap<u64, Bid>,
    offers: IterableMap<u64, Offer>,
    loans: IterableMap<u64, Loan>,
    // ponytail: counters are reporting only, so they saturate rather than panic inside a callback.
    bids_escrow: u128,
    offers_escrow: u128,
    loans_out: u128,
    deposits: u128,
}

#[near]
impl Market {
    #[init]
    pub fn new() -> Self {
        Self {
            next_id: 0,
            bids: IterableMap::new(b"b"),
            offers: IterableMap::new(b"o"),
            loans: IterableMap::new(b"l"),
            bids_escrow: 0,
            offers_escrow: 0,
            loans_out: 0,
            deposits: 0,
        }
    }

    // ---------- bids ----------

    /// Escrows `max_sats * price_per_sat` + STORAGE_DEPOSIT (anything extra stays in escrow, refunded later). Returns the bid id.
    #[payable]
    pub fn place_bid(&mut self, price_per_sat_yocto: U128, min_sats: U64, max_sats: U64, nft: AccountId) -> U64 {
        require!(price_per_sat_yocto.0 > 0 && max_sats.0 > 0 && min_sats.0 <= max_sats.0, "BadBid");
        let need = (max_sats.0 as u128)
            .checked_mul(price_per_sat_yocto.0)
            .and_then(|v| v.checked_add(STORAGE_DEPOSIT))
            .unwrap_or_else(|| env::panic_str("Overflow"));
        let attached = env::attached_deposit().as_yoctonear();
        require!(attached >= need, format!("Attach at least {need} yoctoNEAR"));
        let id = self.id();
        let bid = Bid {
            id: U64(id),
            bidder: env::predecessor_account_id(),
            nft,
            price_per_sat: price_per_sat_yocto,
            min_sats,
            max_sats,
            escrow: U128(attached - STORAGE_DEPOSIT),
            filling: false,
        };
        self.bids_escrow = self.bids_escrow.saturating_add(bid.escrow.0);
        self.deposits = self.deposits.saturating_add(STORAGE_DEPOSIT);
        emit("bid_placed", json!(bid));
        self.bids.insert(id, bid);
        U64(id)
    }

    /// The bidder takes the bid down and gets escrow + deposit back.
    pub fn cancel_bid(&mut self, bid_id: U64) {
        let bid = self.bids.get(&bid_id.0).cloned().unwrap_or_else(|| env::panic_str("NoBid"));
        require!(bid.bidder == env::predecessor_account_id(), "NotBidder");
        require!(!bid.filling, "Filling");
        self.remove_bid(&bid);
        pay(&bid.bidder, bid.escrow.0 + STORAGE_DEPOSIT);
        emit("bid_cancelled", json!({ "bid_id": bid_id }));
    }

    /// NEP-178 receiver: a holder sells into bid `{"bid_id": N}`. The NFT contract is the caller.
    pub fn nft_on_approve(&mut self, token_id: String, owner_id: AccountId, approval_id: u64, msg: String) -> Promise {
        let bid_id = parse_id(&msg, "bid_id").unwrap_or_else(|| env::panic_str("BadMsg: expected {\"bid_id\": N}"));
        let mut bid = self.bids.get(&bid_id).cloned().unwrap_or_else(|| env::panic_str("NoBid"));
        require!(bid.nft == env::predecessor_account_id(), "WrongNft");
        require!(!bid.filling, "Filling");
        require!(token_id.len() <= MAX_TOKEN_ID, "TokenIdTooLong");
        bid.filling = true;
        self.bids.insert(bid_id, bid);
        emit("bid_filling", json!({ "bid_id": U64(bid_id), "token_id": token_id, "seller": owner_id }));
        ext_nft::ext(env::predecessor_account_id())
            .with_static_gas(Gas::from_tgas(INFO_TGAS))
            .token_info(token_id.clone())
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(Gas::from_tgas(FILL_CB_TGAS))
                    .on_bid_info(U64(bid_id), token_id, owner_id, approval_id),
            )
    }

    /// Checks the live token against the bid, then takes it with `nft_transfer_payout` for exactly `verified_sats * price_per_sat`.
    #[private]
    pub fn on_bid_info(&mut self, bid_id: U64, token_id: String, owner_id: AccountId, approval_id: u64) {
        let Some(bid) = self.bids.get(&bid_id.0).cloned() else { return };
        let checked = read_info().ok_or("NoTokenInfo").and_then(|i| {
            let sats = i.verified_sats.0;
            if i.token.owner_id != owner_id {
                Err("OwnerChanged")
            } else if i.loan.is_some() || i.listing.is_some() || i.pending {
                Err("TokenBusy")
            } else if sats < bid.min_sats.0 || sats > bid.max_sats.0 {
                Err("SatsOutOfRange")
            } else {
                (sats as u128).checked_mul(bid.price_per_sat.0).filter(|p| *p <= bid.escrow.0).ok_or("PriceOverEscrow")
            }
        });
        let price = match checked {
            Ok(p) => p,
            Err(reason) => return self.restore_bid(bid, reason),
        };
        // ponytail: the market pays the 1 yocto the NFT contract requires, not the bidder.
        ext_nft::ext(bid.nft.clone())
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(Gas::from_tgas(NFT_TGAS))
            .nft_transfer_payout(bid.bidder.clone(), token_id.clone(), Some(approval_id), None, U128(price), Some(MAX_PAYOUT))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(Gas::from_tgas(CB_TGAS))
                    .on_bid_payout(bid_id, token_id, owner_id, U128(price)),
            )
            .detach();
    }

    /// The token moved to the bidder: pay the payout (or, if it doesn't add up to `price`, the seller in full) and refund the rest.
    #[private]
    pub fn on_bid_payout(&mut self, bid_id: U64, token_id: String, owner_id: AccountId, price: U128) {
        let Some(bid) = self.bids.get(&bid_id.0).cloned() else { return };
        let Ok(bytes) = env::promise_result_checked(0, 4096) else {
            return self.restore_bid(bid, "TransferFailed");
        };
        self.remove_bid(&bid);
        let payout = serde_json::from_slice::<Payout>(&bytes).ok().map(|p| p.payout).filter(|p| {
            p.len() <= MAX_PAYOUT as usize
                && p.values().try_fold(0u128, |s, v| s.checked_add(v.0)) == Some(price.0)
        });
        match payout {
            Some(p) => p.iter().for_each(|(a, v)| pay(a, v.0)),
            // Untrusted NFT contract: never pay more than `price`, and the seller is the one who gave up the token.
            None => pay(&owner_id, price.0),
        }
        pay(&bid.bidder, bid.escrow.0 - price.0 + STORAGE_DEPOSIT);
        emit("bid_filled", json!({ "bid_id": bid_id, "token_id": token_id, "seller": owner_id, "buyer": bid.bidder, "price": price }));
    }

    // ---------- loans ----------

    /// A standing loan offer: attach `principal` + STORAGE_DEPOSIT exactly. Returns the offer id.
    #[payable]
    pub fn offer_loan(&mut self, principal: U128, rate_bps_per_year: u32, nft: AccountId, min_sats: U64) -> U64 {
        require!(principal.0 > 0, "BadPrincipal");
        require!(rate_bps_per_year <= MAX_RATE_BPS, "RateTooHigh");
        let need = principal.0.checked_add(STORAGE_DEPOSIT).unwrap_or_else(|| env::panic_str("Overflow"));
        require!(env::attached_deposit().as_yoctonear() == need, format!("Attach exactly {need} yoctoNEAR"));
        let id = self.id();
        let offer = Offer { id: U64(id), lender: env::predecessor_account_id(), nft, principal, rate_bps: rate_bps_per_year, min_sats };
        self.offers_escrow = self.offers_escrow.saturating_add(principal.0);
        self.deposits = self.deposits.saturating_add(STORAGE_DEPOSIT);
        emit("offer_posted", json!(offer));
        self.offers.insert(id, offer);
        U64(id)
    }

    /// The lender takes the offer down. Safe even while an acceptance is in flight: its callback finds no offer and returns the NFT.
    pub fn cancel_offer(&mut self, offer_id: U64) {
        let offer = self.offers.get(&offer_id.0).cloned().unwrap_or_else(|| env::panic_str("NoOffer"));
        require!(offer.lender == env::predecessor_account_id(), "NotLender");
        self.offers.remove(&offer_id.0);
        self.offers_escrow = self.offers_escrow.saturating_sub(offer.principal.0);
        self.deposits = self.deposits.saturating_sub(STORAGE_DEPOSIT);
        pay(&offer.lender, offer.principal.0 + STORAGE_DEPOSIT);
        emit("offer_cancelled", json!({ "offer_id": offer_id }));
    }

    /// NEP-171 receiver: `{"accept_offer": N}`. Returns true (give the token back) on anything wrong.
    pub fn nft_on_transfer(&mut self, sender_id: AccountId, previous_owner_id: AccountId, token_id: String, msg: String) -> PromiseOrValue<bool> {
        let ok = parse_id(&msg, "accept_offer")
            .and_then(|id| self.offers.get(&id))
            .filter(|o| o.nft == env::predecessor_account_id())
            // An approved account can't put someone else's Pusaka in debt.
            .filter(|_| sender_id == previous_owner_id && token_id.len() <= MAX_TOKEN_ID)
            .map(|o| o.id);
        let Some(offer_id) = ok else { return PromiseOrValue::Value(true) };
        ext_nft::ext(env::predecessor_account_id())
            .with_static_gas(Gas::from_tgas(INFO_TGAS))
            .token_info(token_id.clone())
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(Gas::from_tgas(CB_TGAS))
                    .on_offer_info(offer_id, token_id, previous_owner_id),
            )
            .into()
    }

    /// The market owns the token now: check it against the offer, then pay out the principal. Returns true to give it back.
    #[private]
    pub fn on_offer_info(&mut self, offer_id: U64, token_id: String, borrower: AccountId) -> bool {
        let Some(offer) = self.offers.get(&offer_id.0).cloned() else { return true };
        // `pending` is our own nft_transfer_call in flight, so it isn't checked here.
        let good = read_info().is_some_and(|i| {
            i.token.owner_id == env::current_account_id() && i.loan.is_none() && i.listing.is_none() && i.verified_sats.0 >= offer.min_sats.0
        });
        if !good {
            return true;
        }
        self.offers.remove(&offer_id.0);
        self.offers_escrow = self.offers_escrow.saturating_sub(offer.principal.0);
        self.loans_out = self.loans_out.saturating_add(offer.principal.0);
        let id = self.id();
        let loan = Loan {
            id: U64(id),
            borrower: borrower.clone(),
            lender: offer.lender,
            nft: offer.nft,
            token_id,
            principal: offer.principal,
            rate_bps: offer.rate_bps,
            start_ms: U64(env::block_timestamp_ms()),
            auction_start_ms: None,
            busy: false,
        };
        pay(&borrower, offer.principal.0);
        emit("loan_started", json!({ "offer_id": offer_id, "loan": loan }));
        self.loans.insert(id, loan);
        false
    }

    /// Anyone pays principal + interest (attach at least `loan(id).debt`; the rest is refunded). The NFT goes back to the borrower, then the lender is paid.
    #[payable]
    pub fn repay(&mut self, loan_id: U64) -> Promise {
        let mut loan = self.open_loan(loan_id);
        let debt = loan.debt(env::block_timestamp_ms());
        let paid = env::attached_deposit().as_yoctonear();
        require!(paid >= debt, format!("Attach at least {debt} yoctoNEAR"));
        let to = loan.borrower.clone();
        let p = self.nft_out(&mut loan, &to);
        p.then(
            Self::ext(env::current_account_id())
                .with_static_gas(Gas::from_tgas(CB_TGAS))
                .on_repaid(loan_id, env::predecessor_account_id(), U128(paid), U128(debt)),
        )
    }

    #[private]
    pub fn on_repaid(&mut self, loan_id: U64, payer: AccountId, paid: U128, debt: U128) {
        let Some(loan) = self.loans.get(&loan_id.0).cloned() else { return pay(&payer, paid.0) };
        if env::promise_result_checked(0, 0).is_err() {
            self.unbusy(loan, "repay");
            return pay(&payer, paid.0);
        }
        self.close_loan(&loan);
        pay(&loan.lender, debt.0 + STORAGE_DEPOSIT);
        pay(&payer, paid.0 - debt.0);
        emit("loan_repaid", json!({ "loan_id": loan_id, "payer": payer, "lender": loan.lender, "amount": debt }));
    }

    /// The lender starts the refinancing auction. No due date before this.
    pub fn call_loan(&mut self, loan_id: U64) {
        let mut loan = self.open_loan(loan_id);
        require!(loan.lender == env::predecessor_account_id(), "NotLender");
        require!(loan.auction_start_ms.is_none(), "AlreadyCalled");
        let now = env::block_timestamp_ms();
        loan.auction_start_ms = Some(U64(now));
        emit("loan_called", json!({ "loan_id": loan_id, "auction_ends_ms": U64(now + AUCTION_MS) }));
        self.loans.insert(loan_id.0, loan);
    }

    /// During the auction a new lender pays the old one principal + interest + their deposit, and takes over at `rate_bps`
    /// (at most the current auction rate; lower is better for the borrower). Attach at least `debt + STORAGE_DEPOSIT`.
    #[payable]
    pub fn refinance(&mut self, loan_id: U64, rate_bps: u32) {
        let mut loan = self.open_loan(loan_id);
        let now = env::block_timestamp_ms();
        let cap = loan.auction_rate(now).unwrap_or_else(|| env::panic_str("NoAuction"));
        require!(rate_bps <= cap, format!("RateAboveAuction: at most {cap} bps now"));
        let new_lender = env::predecessor_account_id();
        require!(new_lender != loan.lender, "SameLender");
        let debt = loan.debt(now);
        let need = debt.checked_add(STORAGE_DEPOSIT).unwrap_or_else(|| env::panic_str("Overflow"));
        let paid = env::attached_deposit().as_yoctonear();
        require!(paid >= need, format!("Attach at least {need} yoctoNEAR"));
        pay(&loan.lender, need);
        pay(&new_lender, paid - need);
        self.loans_out = self.loans_out.saturating_sub(loan.principal.0).saturating_add(debt);
        emit("loan_refinanced", json!({ "loan_id": loan_id, "from": loan.lender, "to": new_lender, "paid": U128(debt), "rate_bps": rate_bps }));
        loan.lender = new_lender;
        loan.principal = U128(debt);
        loan.rate_bps = rate_bps;
        loan.start_ms = U64(now);
        loan.auction_start_ms = None;
        self.loans.insert(loan_id.0, loan);
    }

    /// Nobody refinanced before the auction ended: the lender takes the NFT (and the BTC it controls).
    pub fn seize(&mut self, loan_id: U64) -> Promise {
        let mut loan = self.open_loan(loan_id);
        require!(loan.lender == env::predecessor_account_id(), "NotLender");
        require!(loan.auction_over(env::block_timestamp_ms()), "AuctionNotOver");
        let to = loan.lender.clone();
        self.nft_out(&mut loan, &to).then(
            Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(CB_TGAS)).on_seized(loan_id),
        )
    }

    #[private]
    pub fn on_seized(&mut self, loan_id: U64) {
        let Some(loan) = self.loans.get(&loan_id.0).cloned() else { return };
        if env::promise_result_checked(0, 0).is_err() {
            return self.unbusy(loan, "seize");
        }
        self.close_loan(&loan);
        pay(&loan.lender, STORAGE_DEPOSIT);
        emit("loan_seized", json!({ "loan_id": loan_id, "lender": loan.lender, "token_id": loan.token_id }));
    }

    // ---------- views ----------

    pub fn bid(&self, bid_id: U64) -> Option<Bid> {
        self.bids.get(&bid_id.0).cloned()
    }

    /// A page of open bids, highest price per sat first within the page.
    /// ponytail: paged by insertion, sorted per page; a UI building a depth ladder reads all pages (bids are few). Add a price index if they aren't.
    pub fn bids(&self, from: Option<u32>, limit: Option<u32>) -> Vec<Bid> {
        let mut v: Vec<Bid> = page(&self.bids, from, limit);
        v.sort_by_key(|b| std::cmp::Reverse(b.price_per_sat.0));
        v
    }

    pub fn offer(&self, offer_id: U64) -> Option<Offer> {
        self.offers.get(&offer_id.0).cloned()
    }

    pub fn offers(&self, from: Option<u32>, limit: Option<u32>) -> Vec<Offer> {
        page(&self.offers, from, limit)
    }

    /// The loan plus its live numbers: `debt` now, `auction_rate_bps` (null outside an auction) and `auction_ends_ms`.
    pub fn loan(&self, loan_id: U64) -> Option<Value> {
        self.loans.get(&loan_id.0).map(loan_view)
    }

    pub fn loans(&self, from: Option<u32>, limit: Option<u32>) -> Vec<Value> {
        page(&self.loans, from, limit).iter().map(loan_view).collect()
    }

    pub fn reserves(&self) -> Reserves {
        Reserves {
            bids_escrow: U128(self.bids_escrow),
            offers_escrow: U128(self.offers_escrow),
            loans_outstanding: U128(self.loans_out),
            deposits: U128(self.deposits),
            owed: U128(self.bids_escrow.saturating_add(self.offers_escrow).saturating_add(self.deposits)),
            balance: U128(env::account_balance().as_yoctonear()),
        }
    }
}

impl Market {
    fn id(&mut self) -> u64 {
        self.next_id += 1;
        self.next_id
    }

    fn remove_bid(&mut self, bid: &Bid) {
        self.bids.remove(&bid.id.0);
        self.bids_escrow = self.bids_escrow.saturating_sub(bid.escrow.0);
        self.deposits = self.deposits.saturating_sub(STORAGE_DEPOSIT);
    }

    fn restore_bid(&mut self, mut bid: Bid, reason: &str) {
        bid.filling = false;
        emit("bid_fill_failed", json!({ "bid_id": bid.id, "reason": reason }));
        self.bids.insert(bid.id.0, bid);
    }

    fn open_loan(&self, loan_id: U64) -> Loan {
        let loan = self.loans.get(&loan_id.0).cloned().unwrap_or_else(|| env::panic_str("NoLoan"));
        require!(!loan.busy, "Busy");
        loan
    }

    /// Marks the loan busy and sends its NFT to `to`.
    fn nft_out(&mut self, loan: &mut Loan, to: &AccountId) -> Promise {
        loan.busy = true;
        emit("loan_closing", json!({ "loan_id": loan.id, "to": to }));
        self.loans.insert(loan.id.0, loan.clone());
        ext_nft::ext(loan.nft.clone())
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(Gas::from_tgas(NFT_TGAS))
            .nft_transfer(to.clone(), loan.token_id.clone(), None, None)
    }

    fn unbusy(&mut self, mut loan: Loan, what: &str) {
        loan.busy = false;
        emit("loan_close_failed", json!({ "loan_id": loan.id, "action": what }));
        self.loans.insert(loan.id.0, loan);
    }

    fn close_loan(&mut self, loan: &Loan) {
        self.loans.remove(&loan.id.0);
        self.loans_out = self.loans_out.saturating_sub(loan.principal.0);
        self.deposits = self.deposits.saturating_sub(STORAGE_DEPOSIT);
    }
}

fn loan_view(l: &Loan) -> Value {
    let now = env::block_timestamp_ms();
    json!({
        "loan": l,
        "debt": U128(l.debt(now)),
        "auction_rate_bps": l.auction_rate(now),
        "auction_ends_ms": l.auction_start_ms.map(|s| U64(s.0 + AUCTION_MS)),
    })
}

fn page<V: Clone + near_sdk::borsh::BorshSerialize + near_sdk::borsh::BorshDeserialize>(
    m: &IterableMap<u64, V>,
    from: Option<u32>,
    limit: Option<u32>,
) -> Vec<V> {
    m.values().skip(from.unwrap_or(0) as usize).take(limit.unwrap_or(50).min(100) as usize).cloned().collect()
}

/// `{"<key>": 7}` or `{"<key>": "7"}` → 7.
fn parse_id(msg: &str, key: &str) -> Option<u64> {
    let v: Value = serde_json::from_str(msg).ok()?;
    let id = v.get(key)?;
    id.as_u64().or_else(|| id.as_str()?.parse().ok())
}

/// The `token_info` answer, or None if the call failed, the token doesn't exist or the answer doesn't parse.
fn read_info() -> Option<Info> {
    let bytes = env::promise_result_checked(0, 64 * 1024).ok()?;
    serde_json::from_slice::<Option<Info>>(&bytes).ok().flatten()
}

/// ponytail: a transfer to an account that doesn't exist bounces back to the market and stays there.
fn pay(to: &AccountId, yocto: u128) {
    if yocto > 0 {
        Promise::new(to.clone()).transfer(NearToken::from_yoctonear(yocto)).detach();
    }
}

/// NEP-297 event log.
fn emit(event: &str, data: Value) {
    let e = json!({ "standard": "pusaka-market", "version": "1.0.0", "event": event, "data": [data] });
    env::log_str(&format!("EVENT_JSON:{e}"));
}

#[cfg(test)]
mod tests;
