//! Pusaka lend: borrow a stablecoin against a Pusaka's proven Bitcoin, from a pool, with liquidation at a price.
//!
//! * Lenders supply the stablecoin (`ft_transfer_call(lend, amount, "supply")`) for pool shares; interest paid by
//!   borrowers raises the value of a share. `withdraw(shares)` takes them out while the pool has the cash.
//! * A holder borrows with `nft_transfer_call(lend, token, {"borrow": "<amount>"})`. The contract reads
//!   `token_info` itself: the collateral is the token's `verified_sats` (proven by NEAR's Bitcoin light client, never
//!   signed away). While the contract holds the NFT nobody can ask for a Bitcoin signature, so the BTC can't move.
//! * The price is the median of fresh reports from the reporters fixed at init. A stale price (fewer than `quorum`
//!   fresh reports) blocks both borrowing and liquidation, so nobody is liquidated on an old price.
//! * Anyone repays (`{"repay": id}`): the NFT goes back to the borrower. Once the loan-to-value reaches `liq_ltv_bps`
//!   anyone may liquidate (`{"liquidate": id}`) by paying max(debt, `liq_price_bps` of the BTC's value): the pool
//!   gets the debt, the borrower the rest, the liquidator the NFT and, with it, the Bitcoin key.
//!
//! Nothing is configurable after init; the deployment's key is deleted, so these rules are final.

use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::{self, json, Value};
use near_sdk::store::{IterableMap, LookupMap};
use near_sdk::{env, ext_contract, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue};

pub const BPS: u128 = 10_000;
pub const YEAR_MS: u128 = 365 * 24 * 60 * 60 * 1000;
const SATS_PER_BTC: u128 = 100_000_000;
const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);
const MAX_TOKEN_ID: usize = 64;
const INFO_TGAS: u64 = 20;
const NFT_TGAS: u64 = 50;
const FT_TGAS: u64 = 15;
const CB_TGAS: u64 = 25;
/// The two middle fresh reports may differ by at most 5%, or there is no price.
pub const MAX_SPREAD_BPS: u128 = 500;

#[ext_contract(ext_nft)]
#[allow(dead_code)]
trait Nft {
    fn token_info(&self, token_id: String);
    fn nft_transfer(&mut self, receiver_id: AccountId, token_id: String, approval_id: Option<u64>, memo: Option<String>);
}

#[ext_contract(ext_ft)]
#[allow(dead_code)]
trait Ft {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Config {
    /// NEP-141 stablecoin lent and repaid.
    pub stable: AccountId,
    /// Pusaka contracts whose NFTs are accepted as collateral.
    pub nfts: Vec<AccountId>,
    pub reporters: Vec<AccountId>,
    /// Fresh reports needed for a price.
    pub quorum: u32,
    pub max_age_ms: U64,
    /// Borrowing up to this loan-to-value.
    pub max_ltv_bps: u32,
    /// Liquidation from this loan-to-value.
    pub liq_ltv_bps: u32,
    /// A liquidator pays at least this share of the BTC's value (the rest of it is their discount).
    pub liq_price_bps: u32,
    pub rate_bps: u32,
    /// Smallest supply or loan, in stablecoin units (keeps dust records out).
    pub min_amount: U128,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Report {
    /// USD per BTC, in stablecoin units (6 decimals: 1 USD = 1_000_000).
    pub price: U128,
    pub at_ms: U64,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Loan {
    pub id: U64,
    pub borrower: AccountId,
    pub nft: AccountId,
    pub token_id: String,
    /// verified_sats when borrowed. It can only grow while the contract holds the NFT (nobody can sign it away).
    pub sats: U64,
    pub principal: U128,
    pub start_ms: U64,
    /// An NFT transfer (repay or liquidation) is in flight.
    pub busy: bool,
}

impl Loan {
    /// principal + principal * rate * elapsed / year, rounded up so the pool never loses a unit to rounding.
    pub fn debt(&self, rate_bps: u32, now_ms: u64) -> u128 {
        let p = self.principal.0;
        let num = p.saturating_mul(rate_bps as u128).saturating_mul(now_ms.saturating_sub(self.start_ms.0) as u128);
        let d = BPS * YEAR_MS;
        p.saturating_add(num.div_ceil(d))
    }
}

/// Stablecoin units the given sats are worth at `price` (USD per BTC in stablecoin units), rounded down.
pub fn value_of(sats: u64, price: u128) -> u128 {
    (sats as u128).saturating_mul(price) / SATS_PER_BTC
}

/// The part of Pusaka's `token_info` read here.
#[near(serializers = [json])]
pub struct Info {
    pub token: InfoToken,
    pub verified_sats: U64,
    pub loan: Option<Value>,
    pub listing: Option<Value>,
}

#[near(serializers = [json])]
pub struct InfoToken {
    pub owner_id: AccountId,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Lend {
    config: Config,
    reports: LookupMap<AccountId, Report>,
    shares: LookupMap<AccountId, u128>,
    total_shares: u128,
    /// Stablecoin held and not lent out.
    cash: u128,
    /// Sum of open loan principals.
    borrowed: u128,
    loans: IterableMap<u64, Loan>,
    /// Liquidation surplus a borrower couldn't be paid directly (not registered with the stablecoin); `claim` it.
    owed: LookupMap<AccountId, u128>,
    next_id: u64,
}

#[near]
impl Lend {
    #[init]
    pub fn new(config: Config) -> Self {
        require!(config.quorum >= 1 && config.quorum as usize <= config.reporters.len(), "BadQuorum");
        require!(config.max_ltv_bps < config.liq_ltv_bps && (config.liq_ltv_bps as u128) < BPS, "BadLtv");
        require!(config.liq_price_bps as u128 <= BPS && config.liq_price_bps >= config.liq_ltv_bps, "BadLiqPrice");
        require!(!config.nfts.is_empty() && config.min_amount.0 > 0, "BadConfig");
        Self {
            config,
            reports: LookupMap::new(b"r"),
            shares: LookupMap::new(b"s"),
            total_shares: 0,
            cash: 0,
            borrowed: 0,
            loans: IterableMap::new(b"l"),
            owed: LookupMap::new(b"o"),
            next_id: 0,
        }
    }

    // ---------- price ----------

    pub fn report_price(&mut self, price: U128) {
        let who = env::predecessor_account_id();
        require!(self.config.reporters.contains(&who), "NotReporter");
        require!(price.0 > 0, "BadPrice");
        self.reports.insert(who.clone(), Report { price, at_ms: U64(env::block_timestamp_ms()) });
        emit("price_reported", json!({ "reporter": who, "price": price }));
    }

    /// The two middle fresh reports (equal for an odd count): `low` values collateral for borrowing, `high` decides
    /// liquidation, so one outlying source can never move the price used against the pool or against a borrower.
    /// None if fewer than `quorum` are fresh or the two middles disagree by more than MAX_SPREAD_BPS.
    pub fn price(&self) -> Option<Value> {
        self.price_now().map(|(low, high)| json!({ "low": U128(low), "high": U128(high) }))
    }

    // ---------- lenders ----------

    /// NEP-141 receiver: "supply", {"repay": id} or {"liquidate": id}. Anything that panics is refunded in full by the token.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        require!(env::predecessor_account_id() == self.config.stable, "WrongToken");
        if msg == "supply" {
            require!(amount.0 >= self.config.min_amount.0, "BelowMinimum");
            let assets = self.assets();
            let s = if self.total_shares == 0 || assets == 0 { amount.0 } else { amount.0 * self.total_shares / assets };
            require!(s > 0, "TooSmall");
            let mine = self.shares.get(&sender_id).copied().unwrap_or(0);
            self.shares.insert(sender_id.clone(), mine + s);
            self.total_shares += s;
            self.cash += amount.0;
            emit("supplied", json!({ "lender": sender_id, "amount": amount, "shares": U128(s) }));
            return PromiseOrValue::Value(U128(0));
        }
        if let Some(id) = parse_id(&msg, "repay").map(|i| i as u64) {
            let mut loan = self.open_loan(id);
            let debt = loan.debt(self.config.rate_bps, env::block_timestamp_ms());
            require!(amount.0 >= debt, format!("Repay at least {debt}"));
            let to = loan.borrower.clone();
            return self.nft_out(&mut loan, &to)
                .then(Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(CB_TGAS)).on_repaid(U64(id), sender_id, amount, U128(debt)))
                .into();
        }
        if let Some(id) = parse_id(&msg, "liquidate").map(|i| i as u64) {
            let mut loan = self.open_loan(id);
            let (_, price) = self.price_now().unwrap_or_else(|| env::panic_str("StalePrice"));
            let debt = loan.debt(self.config.rate_bps, env::block_timestamp_ms());
            let value = value_of(loan.sats.0, price);
            require!(debt.saturating_mul(BPS) >= value.saturating_mul(self.config.liq_ltv_bps as u128), "Healthy");
            let required = debt.max(value * self.config.liq_price_bps as u128 / BPS);
            require!(amount.0 >= required, format!("Pay at least {required}"));
            return self.nft_out(&mut loan, &sender_id)
                .then(Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(CB_TGAS + FT_TGAS)).on_liquidated(U64(id), sender_id, amount, U128(required), U128(debt)))
                .into();
        }
        env::panic_str("BadMsg")
    }

    /// Burn `shares` for their share of the pool, paid now if the cash is there.
    pub fn withdraw(&mut self, shares: U128) -> Promise {
        let who = env::predecessor_account_id();
        let mine = self.shares.get(&who).copied().unwrap_or(0);
        require!(shares.0 > 0 && shares.0 <= mine, "NotEnoughShares");
        let amount = shares.0 * self.assets() / self.total_shares;
        require!(amount <= self.cash, "NotEnoughCash: lent out; wait for repayments");
        self.shares.insert(who.clone(), mine - shares.0);
        self.total_shares -= shares.0;
        self.cash -= amount;
        ext_ft::ext(self.config.stable.clone()).with_attached_deposit(ONE_YOCTO).with_static_gas(Gas::from_tgas(FT_TGAS))
            .ft_transfer(who.clone(), U128(amount), None)
            .then(Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(CB_TGAS)).on_withdrawn(who, shares, U128(amount)))
    }

    #[private]
    pub fn on_withdrawn(&mut self, lender: AccountId, shares: U128, amount: U128) {
        if env::promise_result_checked(0, 0).is_ok() {
            return emit("withdrawn", json!({ "lender": lender, "shares": shares, "amount": amount }));
        }
        let mine = self.shares.get(&lender).copied().unwrap_or(0);
        self.shares.insert(lender, mine + shares.0);
        self.total_shares += shares.0;
        self.cash += amount.0;
    }

    /// Liquidation surplus that couldn't be sent (register with the stablecoin first).
    pub fn claim(&mut self) -> Promise {
        let who = env::predecessor_account_id();
        let amount = self.owed.remove(&who).unwrap_or_else(|| env::panic_str("NothingOwed"));
        ext_ft::ext(self.config.stable.clone()).with_attached_deposit(ONE_YOCTO).with_static_gas(Gas::from_tgas(FT_TGAS))
            .ft_transfer(who.clone(), U128(amount), None)
            .then(Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(CB_TGAS)).on_surplus(who, U128(amount)))
    }

    // ---------- borrowers ----------

    /// NEP-171 receiver: {"borrow": "<amount>"}. Returns true (give the token back) on anything wrong.
    pub fn nft_on_transfer(&mut self, sender_id: AccountId, previous_owner_id: AccountId, token_id: String, msg: String) -> PromiseOrValue<bool> {
        let nft = env::predecessor_account_id();
        let amount = parse_id(&msg, "borrow");
        // an approved account can't put someone else's Pusaka in debt
        let Some(amount) = amount.filter(|_| self.config.nfts.contains(&nft) && sender_id == previous_owner_id && token_id.len() <= MAX_TOKEN_ID)
        else { return PromiseOrValue::Value(true) };
        ext_nft::ext(nft.clone())
            .with_static_gas(Gas::from_tgas(INFO_TGAS))
            .token_info(token_id.clone())
            .then(Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(CB_TGAS + FT_TGAS)).on_borrow_info(nft, token_id, previous_owner_id, U128(amount)))
            .into()
    }

    /// The contract holds the token now: check it, the price and the pool, then pay the loan out.
    #[private]
    pub fn on_borrow_info(&mut self, nft: AccountId, token_id: String, borrower: AccountId, amount: U128) -> bool {
        let Some((price, _)) = self.price_now() else { emit("borrow_refused", json!({ "token_id": token_id, "reason": "StalePrice" })); return true };
        let info = read_info().filter(|i| i.token.owner_id == env::current_account_id() && i.loan.is_none() && i.listing.is_none());
        let Some(info) = info else { emit("borrow_refused", json!({ "token_id": token_id, "reason": "BadToken" })); return true };
        let value = value_of(info.verified_sats.0, price);
        let ok = amount.0 >= self.config.min_amount.0
            && amount.0.saturating_mul(BPS) <= value.saturating_mul(self.config.max_ltv_bps as u128)
            && amount.0 <= self.cash;
        if !ok {
            emit("borrow_refused", json!({ "token_id": token_id, "reason": "OverLimit", "max": U128(value * self.config.max_ltv_bps as u128 / BPS), "cash": U128(self.cash) }));
            return true;
        }
        self.next_id += 1;
        let loan = Loan { id: U64(self.next_id), borrower: borrower.clone(), nft, token_id, sats: info.verified_sats, principal: amount, start_ms: U64(env::block_timestamp_ms()), busy: false };
        self.cash -= amount.0;
        self.borrowed += amount.0;
        emit("borrowed", json!({ "loan": loan, "price": U128(price) }));
        self.loans.insert(loan.id.0, loan);
        ext_ft::ext(self.config.stable.clone()).with_attached_deposit(ONE_YOCTO).with_static_gas(Gas::from_tgas(FT_TGAS))
            .ft_transfer(borrower, amount, None)
            .then(Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(NFT_TGAS + 10)).on_lent(U64(self.next_id)))
            .detach();
        false
    }

    /// The borrower couldn't be paid (not registered with the stablecoin): undo the loan and send the NFT back.
    #[private]
    pub fn on_lent(&mut self, loan_id: U64) {
        if env::promise_result_checked(0, 0).is_ok() { return }
        let Some(loan) = self.loans.remove(&loan_id.0) else { return };
        self.cash += loan.principal.0;
        self.borrowed -= loan.principal.0;
        emit("borrow_unwound", json!({ "loan_id": loan_id }));
        ext_nft::ext(loan.nft).with_attached_deposit(ONE_YOCTO).with_static_gas(Gas::from_tgas(NFT_TGAS))
            .nft_transfer(loan.borrower, loan.token_id, None, None)
            .detach();
    }

    #[private]
    pub fn on_repaid(&mut self, loan_id: U64, payer: AccountId, amount: U128, debt: U128) -> U128 {
        let Some(loan) = self.loans.get(&loan_id.0).cloned() else { return amount };
        if env::promise_result_checked(0, 0).is_err() {
            self.unbusy(loan);
            return amount;
        }
        self.close(&loan, debt.0);
        emit("repaid", json!({ "loan_id": loan_id, "payer": payer, "debt": debt }));
        U128(amount.0 - debt.0)
    }

    #[private]
    pub fn on_liquidated(&mut self, loan_id: U64, liquidator: AccountId, amount: U128, required: U128, debt: U128) -> U128 {
        let Some(loan) = self.loans.get(&loan_id.0).cloned() else { return amount };
        if env::promise_result_checked(0, 0).is_err() {
            self.unbusy(loan);
            return amount;
        }
        self.close(&loan, debt.0);
        let surplus = required.0 - debt.0;
        if surplus > 0 {
            ext_ft::ext(self.config.stable.clone()).with_attached_deposit(ONE_YOCTO).with_static_gas(Gas::from_tgas(FT_TGAS))
                .ft_transfer(loan.borrower.clone(), U128(surplus), None)
                .then(Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(5)).on_surplus(loan.borrower.clone(), U128(surplus)))
                .detach();
        }
        emit("liquidated", json!({ "loan_id": loan_id, "liquidator": liquidator, "paid": required, "debt": debt, "to_borrower": U128(surplus) }));
        U128(amount.0 - required.0)
    }

    #[private]
    pub fn on_surplus(&mut self, to: AccountId, amount: U128) {
        if env::promise_result_checked(0, 0).is_ok() { return }
        let o = self.owed.get(&to).copied().unwrap_or(0);
        self.owed.insert(to, o + amount.0);
    }

    // ---------- views ----------

    pub fn config(&self) -> Config {
        self.config.clone()
    }

    pub fn reports(&self) -> Vec<(AccountId, Option<Report>)> {
        self.config.reporters.iter().map(|r| (r.clone(), self.reports.get(r).cloned())).collect()
    }

    /// cash + borrowed principal; a share is worth assets / total_shares.
    pub fn pool(&self) -> Value {
        json!({ "cash": U128(self.cash), "borrowed": U128(self.borrowed), "assets": U128(self.assets()), "total_shares": U128(self.total_shares),
                "loans": self.loans.len(), "price": self.price(), "rate_bps": self.config.rate_bps })
    }

    pub fn shares_of(&self, account_id: AccountId) -> U128 {
        U128(self.shares.get(&account_id).copied().unwrap_or(0))
    }

    pub fn owed_to(&self, account_id: AccountId) -> U128 {
        U128(self.owed.get(&account_id).copied().unwrap_or(0))
    }

    /// The loan with its live numbers: debt, value and loan-to-value at the current price, and whether it can be liquidated now.
    pub fn loan(&self, loan_id: U64) -> Option<Value> {
        self.loans.get(&loan_id.0).map(|l| self.loan_view(l))
    }

    pub fn loans(&self, from: Option<u32>, limit: Option<u32>) -> Vec<Value> {
        self.loans.values().skip(from.unwrap_or(0) as usize).take(limit.unwrap_or(50).min(100) as usize).map(|l| self.loan_view(l)).collect()
    }
}

impl Lend {
    fn price_now(&self) -> Option<(u128, u128)> {
        let now = env::block_timestamp_ms();
        let mut fresh: Vec<u128> = self.config.reporters.iter()
            .filter_map(|r| self.reports.get(r))
            .filter(|r| now.saturating_sub(r.at_ms.0) <= self.config.max_age_ms.0)
            .map(|r| r.price.0)
            .collect();
        if fresh.len() < self.config.quorum as usize { return None }
        fresh.sort_unstable();
        let n = fresh.len();
        let (low, high) = (fresh[(n - 1) / 2], fresh[n / 2]);
        ((high - low).saturating_mul(BPS) <= low.saturating_mul(MAX_SPREAD_BPS)).then_some((low, high))
    }

    fn assets(&self) -> u128 {
        self.cash + self.borrowed
    }

    fn open_loan(&self, id: u64) -> Loan {
        let loan = self.loans.get(&id).cloned().unwrap_or_else(|| env::panic_str("NoLoan"));
        require!(!loan.busy, "Busy");
        loan
    }

    fn nft_out(&mut self, loan: &mut Loan, to: &AccountId) -> Promise {
        loan.busy = true;
        self.loans.insert(loan.id.0, loan.clone());
        ext_nft::ext(loan.nft.clone()).with_attached_deposit(ONE_YOCTO).with_static_gas(Gas::from_tgas(NFT_TGAS))
            .nft_transfer(to.clone(), loan.token_id.clone(), None, None)
    }

    fn unbusy(&mut self, mut loan: Loan) {
        loan.busy = false;
        emit("close_failed", json!({ "loan_id": loan.id }));
        self.loans.insert(loan.id.0, loan);
    }

    /// The loan is over and `debt` came back to the pool (interest included: lenders' shares are worth more).
    fn close(&mut self, loan: &Loan, debt: u128) {
        self.loans.remove(&loan.id.0);
        self.borrowed -= loan.principal.0;
        self.cash += debt;
    }

    fn loan_view(&self, l: &Loan) -> Value {
        let now = env::block_timestamp_ms();
        let debt = l.debt(self.config.rate_bps, now);
        // the liquidation side of the price: what decides whether this loan can be liquidated
        let value = self.price_now().map(|(_, high)| value_of(l.sats.0, high));
        json!({
            "loan": l, "debt": U128(debt),
            "value": value.map(U128),
            "ltv_bps": value.filter(|v| *v > 0).map(|v| (debt * BPS / v) as u64),
            "liquidatable": value.is_some_and(|v| debt.saturating_mul(BPS) >= v.saturating_mul(self.config.liq_ltv_bps as u128)),
        })
    }
}

/// `{"<key>": 7}` or `{"<key>": "7"}` → 7.
fn parse_id(msg: &str, key: &str) -> Option<u128> {
    let v: Value = serde_json::from_str(msg).ok()?;
    let id = v.get(key)?;
    id.as_u64().map(|x| x as u128).or_else(|| id.as_str()?.parse().ok())
}

fn read_info() -> Option<Info> {
    let bytes = env::promise_result_checked(0, 64 * 1024).ok()?;
    serde_json::from_slice::<Option<Info>>(&bytes).ok().flatten()
}

fn emit(event: &str, data: Value) {
    let e = json!({ "standard": "pusaka-lend", "version": "1.0.0", "event": event, "data": [data] });
    env::log_str(&format!("EVENT_JSON:{e}"));
}

#[cfg(test)]
mod tests;
