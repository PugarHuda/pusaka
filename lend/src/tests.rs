//! Each test is named after the attack or failure it stops.

use super::*;
use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::{test_vm_config, testing_env, PromiseResult, RuntimeFeesConfig};

const LEND: &str = "lend.testnet";
const USD: &str = "pusd.testnet";
const NFT: &str = "pusaka-btc.testnet";
const T0: u64 = 1_000_000_000; // ms
const U: u128 = 1_000_000; // 1 USD in stablecoin units
const PRICE: u128 = 100_000 * U; // 100,000 USD per BTC

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn ctx_at(caller: &str, ms: u64, results: Vec<PromiseResult>) {
    let c = VMContextBuilder::new()
        .current_account_id(acc(LEND))
        .predecessor_account_id(acc(caller))
        .block_timestamp(ms * 1_000_000)
        .prepaid_gas(Gas::from_tgas(300))
        .build();
    testing_env!(c, test_vm_config(), RuntimeFeesConfig::test(), Default::default(), results);
}

fn ctx(caller: &str) {
    ctx_at(caller, T0, vec![]);
}

fn ok(v: Value) -> PromiseResult {
    PromiseResult::Successful(serde_json::to_vec(&v).unwrap())
}

fn info(owner: &str, sats: u64) -> Value {
    json!({ "token": { "token_id": "1", "owner_id": owner }, "verified_sats": sats.to_string(), "loan": null, "listing": null, "pending": true })
}

fn new_lend() -> Lend {
    ctx("deployer.testnet");
    Lend::new(Config {
        stable: acc(USD),
        nfts: vec![acc(NFT)],
        reporters: vec![acc("r1.testnet"), acc("r2.testnet"), acc("r3.testnet")],
        quorum: 2,
        max_age_ms: U64(3_600_000),
        max_ltv_bps: 5_000,
        liq_ltv_bps: 8_000,
        liq_price_bps: 9_500,
        rate_bps: 800,
        min_amount: U128(U),
    })
}

fn report(l: &mut Lend, who: &str, price: u128, ms: u64) {
    ctx_at(who, ms, vec![]);
    l.report_price(U128(price));
}

fn priced(l: &mut Lend, price: u128, ms: u64) {
    report(l, "r1.testnet", price, ms);
    report(l, "r2.testnet", price, ms);
}

fn supply(l: &mut Lend, who: &str, amount: u128) {
    ctx(USD);
    l.ft_on_transfer(acc(who), U128(amount), "supply".into());
}

/// A pool with 1,000 USD and a fresh price; alice borrows `amount` against 100,000 sats (100 USD of BTC).
fn with_loan(amount: u128) -> Lend {
    let mut l = new_lend();
    supply(&mut l, "lender.testnet", 1_000 * U);
    priced(&mut l, PRICE, T0);
    ctx_at(LEND, T0, vec![ok(info(LEND, 100_000))]);
    assert!(!l.on_borrow_info(acc(NFT), "1".into(), acc("alice.testnet"), U128(amount)), "loan refused");
    l
}

#[test]
fn a_stale_price_blocks_borrowing() {
    let mut l = new_lend();
    supply(&mut l, "lender.testnet", 1_000 * U);
    priced(&mut l, PRICE, T0);
    // an hour and a second later no report is fresh: the NFT goes back
    ctx_at(LEND, T0 + 3_601_000, vec![ok(info(LEND, 100_000))]);
    assert!(l.on_borrow_info(acc(NFT), "1".into(), acc("alice.testnet"), U128(10 * U)));
    assert!(get_logs().iter().any(|g| g.contains("StalePrice")));
}

#[test]
fn a_single_reporter_has_no_quorum() {
    let mut l = new_lend();
    report(&mut l, "r1.testnet", PRICE, T0);
    ctx(LEND);
    assert!(l.price().is_none());
}

#[test]
fn a_lying_reporter_is_outvoted_by_the_median() {
    let mut l = new_lend();
    report(&mut l, "r1.testnet", PRICE, T0);
    report(&mut l, "r2.testnet", PRICE + U, T0);
    report(&mut l, "r3.testnet", 1, T0); // claims BTC is worth nothing, to liquidate everyone
    ctx(LEND);
    assert_eq!(l.price_now(), Some((PRICE, PRICE)));
}

#[test]
fn with_two_reports_one_source_cannot_move_the_price_either_way() {
    let mut l = new_lend();
    report(&mut l, "r1.testnet", PRICE, T0);
    report(&mut l, "r2.testnet", PRICE * 104 / 100, T0); // 4% higher: borrowing sees the lower, liquidation the higher
    ctx(LEND);
    assert_eq!(l.price_now(), Some((PRICE, PRICE * 104 / 100)));
    report(&mut l, "r2.testnet", PRICE * 2, T0); // one source doubles the price to over-borrow: there is no price at all
    ctx(LEND);
    assert_eq!(l.price_now(), None);
}

#[test]
#[should_panic(expected = "NotReporter")]
fn an_outsider_cannot_report_a_price() {
    let mut l = new_lend();
    report(&mut l, "mallory.testnet", 1, T0);
}

#[test]
fn borrowing_past_the_maximum_ltv_is_refused() {
    let mut l = new_lend();
    supply(&mut l, "lender.testnet", 1_000 * U);
    priced(&mut l, PRICE, T0);
    ctx_at(LEND, T0, vec![ok(info(LEND, 100_000))]); // 100 USD of BTC: at most 50 USD
    assert!(l.on_borrow_info(acc(NFT), "1".into(), acc("alice.testnet"), U128(50 * U + 1)));
    assert!(!l.on_borrow_info(acc(NFT), "1".into(), acc("alice.testnet"), U128(50 * U)));
}

#[test]
fn a_token_the_contract_does_not_hold_is_refused() {
    let mut l = new_lend();
    supply(&mut l, "lender.testnet", 1_000 * U);
    priced(&mut l, PRICE, T0);
    ctx_at(LEND, T0, vec![ok(info("alice.testnet", 100_000))]);
    assert!(l.on_borrow_info(acc(NFT), "1".into(), acc("alice.testnet"), U128(10 * U)));
}

#[test]
fn an_approved_account_cannot_borrow_against_someone_elses_pusaka() {
    let mut l = new_lend();
    ctx(NFT);
    match l.nft_on_transfer(acc("market.testnet"), acc("alice.testnet"), "1".into(), r#"{"borrow":"10000000"}"#.into()) {
        PromiseOrValue::Value(back) => assert!(back),
        _ => panic!("should return the token"),
    }
}

#[test]
fn an_nft_from_another_contract_is_returned() {
    let mut l = new_lend();
    ctx("fake-pusaka.testnet");
    match l.nft_on_transfer(acc("alice.testnet"), acc("alice.testnet"), "1".into(), r#"{"borrow":"10000000"}"#.into()) {
        PromiseOrValue::Value(back) => assert!(back),
        _ => panic!("should return the token"),
    }
}

#[test]
#[should_panic(expected = "WrongToken")]
fn another_token_cannot_be_passed_off_as_the_stablecoin() {
    let mut l = new_lend();
    ctx("fake-usd.testnet");
    l.ft_on_transfer(acc("lender.testnet"), U128(1_000 * U), "supply".into());
}

#[test]
#[should_panic(expected = "Healthy")]
fn a_healthy_loan_cannot_be_liquidated() {
    let mut l = with_loan(50 * U);
    ctx(USD);
    l.ft_on_transfer(acc("bob.testnet"), U128(1_000 * U), r#"{"liquidate":1}"#.into());
}

#[test]
#[should_panic(expected = "StalePrice")]
fn nobody_is_liquidated_on_a_stale_price() {
    let mut l = with_loan(50 * U);
    ctx_at(USD, T0 + 3_601_000, vec![]);
    l.ft_on_transfer(acc("bob.testnet"), U128(1_000 * U), r#"{"liquidate":1}"#.into());
}

#[test]
#[should_panic(expected = "Pay at least")]
fn a_liquidator_cannot_take_the_bitcoin_for_less_than_the_floor() {
    let mut l = with_loan(50 * U);
    priced(&mut l, PRICE * 6 / 10, T0 + 1); // BTC falls 40%: 60 USD of collateral for a 50 USD debt
    ctx_at(USD, T0 + 1, vec![]);
    l.ft_on_transfer(acc("bob.testnet"), U128(50 * U + 1), r#"{"liquidate":1}"#.into()); // 95% of 60 = 57 USD is the floor
}

#[test]
fn liquidation_repays_the_pool_and_pays_the_borrower_the_rest() {
    let mut l = with_loan(50 * U);
    priced(&mut l, PRICE * 6 / 10, T0 + 1);
    ctx_at(USD, T0 + 1, vec![]);
    let _ = l.ft_on_transfer(acc("bob.testnet"), U128(60 * U), r#"{"liquidate":1}"#.into());
    ctx_at(LEND, T0 + 1, vec![PromiseResult::Successful(vec![])]);
    let debt = l.loans.get(&1).unwrap().debt(800, T0 + 1);
    let unused = l.on_liquidated(U64(1), acc("bob.testnet"), U128(60 * U), U128(57 * U), U128(debt));
    assert_eq!(unused.0, 3 * U); // the liquidator paid 57 of 60
    assert!(l.loans.get(&1).is_none());
    assert_eq!(l.cash, 950 * U + debt); // the pool is whole
    assert!(get_logs().iter().any(|g| g.contains("\"to_borrower\"")));
}

#[test]
fn a_failed_nft_transfer_refunds_the_liquidator_and_keeps_the_loan() {
    let mut l = with_loan(50 * U);
    priced(&mut l, PRICE * 6 / 10, T0 + 1);
    ctx_at(USD, T0 + 1, vec![]);
    let _ = l.ft_on_transfer(acc("bob.testnet"), U128(60 * U), r#"{"liquidate":1}"#.into());
    ctx_at(LEND, T0 + 1, vec![PromiseResult::Failed]);
    assert_eq!(l.on_liquidated(U64(1), acc("bob.testnet"), U128(60 * U), U128(57 * U), U128(50 * U)).0, 60 * U);
    assert!(!l.loans.get(&1).unwrap().busy);
}

#[test]
#[should_panic(expected = "Repay at least")]
fn a_short_repayment_is_refused() {
    let mut l = with_loan(50 * U);
    ctx_at(USD, T0 + 86_400_000, vec![]);
    l.ft_on_transfer(acc("alice.testnet"), U128(50 * U), r#"{"repay":1}"#.into()); // a day of interest is missing
}

#[test]
fn interest_paid_raises_the_value_of_every_share() {
    let mut l = with_loan(50 * U);
    let year = T0 + YEAR_MS as u64;
    let debt = l.loans.get(&1).unwrap().debt(800, year);
    assert_eq!(debt, 54 * U); // 8% a year
    ctx_at(USD, year, vec![]);
    let _ = l.ft_on_transfer(acc("alice.testnet"), U128(60 * U), r#"{"repay":1}"#.into());
    ctx_at(LEND, year, vec![PromiseResult::Successful(vec![])]);
    assert_eq!(l.on_repaid(U64(1), acc("alice.testnet"), U128(60 * U), U128(debt)).0, 6 * U);
    assert_eq!(l.assets(), 1_004 * U);
    supply(&mut l, "late.testnet", 1_004 * U); // a later lender pays the higher share price
    assert_eq!(l.shares_of(acc("late.testnet")).0, 1_000 * U);
}

#[test]
#[should_panic(expected = "NotEnoughCash")]
fn a_lender_cannot_withdraw_what_is_lent_out() {
    let mut l = new_lend();
    supply(&mut l, "lender.testnet", 100 * U);
    priced(&mut l, PRICE, T0);
    ctx_at(LEND, T0, vec![ok(info(LEND, 200_000))]);
    assert!(!l.on_borrow_info(acc(NFT), "1".into(), acc("alice.testnet"), U128(100 * U)));
    ctx("lender.testnet");
    l.withdraw(U128(100 * U));
}

#[test]
fn a_borrower_who_cannot_receive_the_stablecoin_gets_the_nft_back() {
    let mut l = with_loan(50 * U);
    ctx_at(LEND, T0, vec![PromiseResult::Failed]);
    l.on_lent(U64(1));
    assert!(l.loans.get(&1).is_none());
    assert_eq!(l.cash, 1_000 * U);
    assert_eq!(l.borrowed, 0);
}

#[test]
fn a_busy_loan_cannot_be_repaid_twice() {
    let mut l = with_loan(50 * U);
    ctx(USD);
    let _ = l.ft_on_transfer(acc("alice.testnet"), U128(60 * U), r#"{"repay":1}"#.into());
    let again = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        l.ft_on_transfer(acc("alice.testnet"), U128(60 * U), r#"{"repay":1}"#.into());
    }));
    assert!(again.is_err());
}

#[test]
#[should_panic(expected = "NotEmpty")]
fn the_pool_cannot_be_reset_while_lenders_or_borrowers_are_in_it() {
    let l = with_loan(50 * U);
    env::state_write(&l);
    ctx(LEND);
    let cfg = l.config();
    Lend::reset(cfg);
}

#[test]
fn an_empty_pool_can_start_over_with_another_stablecoin() {
    let mut l = new_lend();
    supply(&mut l, "lender.testnet", 10 * U);
    ctx("lender.testnet");
    let _ = l.withdraw(U128(10 * U));
    env::state_write(&l);
    ctx(LEND);
    let mut cfg = l.config();
    cfg.stable = acc("usdc.testnet");
    let fresh = Lend::reset(cfg);
    assert_eq!(fresh.config().stable, acc("usdc.testnet"));
}
