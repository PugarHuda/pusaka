//! Each test is named after the attack or failure it stops.

use super::*;
use near_sdk::test_utils::{get_created_receipts, get_logs, VMContextBuilder};
use near_sdk::mock::MockAction;
use near_sdk::{test_vm_config, testing_env, PromiseResult, RuntimeFeesConfig};

const NFT: &str = "pusaka-btc.testnet";
const MARKET: &str = "market.testnet";
const T0: u64 = 1_000_000_000; // ms
const PPS: u128 = 1_000_000_000_000_000; // 0.001 mNEAR per sat
const SD: u128 = STORAGE_DEPOSIT;
const NEAR: u128 = 1_000_000_000_000_000_000_000_000;

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn ctx_at(caller: &str, deposit: u128, ms: u64, results: Vec<PromiseResult>) {
    let c = VMContextBuilder::new()
        .current_account_id(acc(MARKET))
        .predecessor_account_id(acc(caller))
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .block_timestamp(ms * 1_000_000)
        .prepaid_gas(Gas::from_tgas(300))
        .build();
    testing_env!(c, test_vm_config(), RuntimeFeesConfig::test(), Default::default(), results);
}

fn ctx(caller: &str, deposit: u128) {
    ctx_at(caller, deposit, T0, vec![]);
}

fn ok(v: Value) -> PromiseResult {
    PromiseResult::Successful(serde_json::to_vec(&v).unwrap())
}

/// What Pusaka's `token_info` answers (trimmed; the market ignores the rest).
fn info(owner: &str, sats: u64) -> Value {
    json!({ "token": { "token_id": "1", "owner_id": owner }, "verified_sats": sats.to_string(),
            "loan": null, "listing": null, "pending": false, "sign_epoch": 3, "history": [] })
}

/// (receiver, yocto) of every NEAR transfer created in the last call.
fn transfers() -> Vec<(String, u128)> {
    get_created_receipts()
        .into_iter()
        .flat_map(|r| {
            let to = r.receiver_id.to_string();
            r.actions.into_iter().filter_map(move |a| match a {
                MockAction::Transfer { deposit, .. } => Some((to.clone(), deposit.as_yoctonear())),
                _ => None,
            })
        })
        .collect()
}

/// (receiver, method, args) of every function call created in the last call.
fn calls() -> Vec<(String, String, Value)> {
    get_created_receipts()
        .into_iter()
        .flat_map(|r| {
            let to = r.receiver_id.to_string();
            r.actions.into_iter().filter_map(move |a| match a {
                MockAction::FunctionCallWeight { method_name, args, .. } => Some((
                    to.clone(),
                    String::from_utf8(method_name).unwrap(),
                    serde_json::from_slice(&args).unwrap_or(Value::Null),
                )),
                _ => None,
            })
        })
        .collect()
}

fn events() -> Vec<String> {
    get_logs()
        .iter()
        .filter_map(|l| l.strip_prefix("EVENT_JSON:"))
        .map(|j| serde_json::from_str::<Value>(j).unwrap()["event"].as_str().unwrap().to_string())
        .collect()
}

fn market() -> Market {
    ctx("deployer.testnet", 0);
    Market::new()
}

/// Bob bids PPS per sat for 10k..=100k sats.
fn with_bid() -> (Market, U64) {
    let mut m = market();
    ctx("bob.testnet", 100_000 * PPS + SD);
    let id = m.place_bid(U128(PPS), U64(10_000), U64(100_000), acc(NFT));
    (m, id)
}

fn approve(m: &mut Market, bid: U64) {
    ctx(NFT, 0);
    let _ = m.nft_on_approve("1".into(), acc("alice.testnet"), 7, json!({ "bid_id": bid }).to_string());
}

fn bid_info(m: &mut Market, bid: U64, result: PromiseResult) {
    ctx_at(MARKET, 0, T0, vec![result]);
    m.on_bid_info(bid, "1".into(), acc("alice.testnet"), 7);
}

// ---------- bids ----------

#[test]
fn bid_refuses_underfunded_escrow() {
    let mut m = market();
    ctx("bob.testnet", 100_000 * PPS); // no storage deposit
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| m.place_bid(U128(PPS), U64(1), U64(100_000), acc(NFT))));
    assert!(r.is_err());
}

#[test]
fn place_bid_escrows_and_logs() {
    let (m, id) = with_bid();
    assert_eq!(m.bid(id).unwrap().escrow.0, 100_000 * PPS);
    assert_eq!(events(), vec!["bid_placed"]);
    let r = m.reserves();
    assert_eq!((r.bids_escrow.0, r.deposits.0), (100_000 * PPS, SD));
}

#[test]
fn cancel_bid_refunds_bidder_in_full() {
    let (mut m, id) = with_bid();
    ctx("bob.testnet", 0);
    m.cancel_bid(id);
    assert_eq!(transfers(), vec![("bob.testnet".into(), 100_000 * PPS + SD)]);
    assert!(m.bid(id).is_none());
    assert_eq!(m.reserves().owed.0, 0);
}

#[test]
#[should_panic(expected = "NotBidder")]
fn stranger_cannot_cancel_bid() {
    let (mut m, id) = with_bid();
    ctx("mallory.testnet", 0);
    m.cancel_bid(id);
}

#[test]
#[should_panic(expected = "WrongNft")]
fn bid_refuses_fake_nft_contract() {
    let (mut m, id) = with_bid();
    ctx("fake-pusaka.testnet", 0);
    let _ = m.nft_on_approve("1".into(), acc("mallory.testnet"), 1, json!({ "bid_id": id }).to_string());
}

#[test]
fn fill_reads_token_info_on_chain_not_msg() {
    let (mut m, id) = with_bid();
    approve(&mut m, id);
    assert!(m.bid(id).unwrap().filling);
    let c = calls();
    assert_eq!((c[0].0.as_str(), c[0].1.as_str()), (NFT, "token_info"));
    assert_eq!(c[0].2, json!({ "token_id": "1" }));
}

#[test]
#[should_panic(expected = "Filling")]
fn double_fill_refused() {
    let (mut m, id) = with_bid();
    approve(&mut m, id);
    approve(&mut m, id);
}

#[test]
#[should_panic(expected = "Filling")]
fn cannot_cancel_bid_while_filling() {
    let (mut m, id) = with_bid();
    approve(&mut m, id);
    ctx("bob.testnet", 0);
    m.cancel_bid(id);
}

#[test]
fn bid_refuses_token_whose_sats_dropped() {
    let (mut m, id) = with_bid();
    approve(&mut m, id);
    bid_info(&mut m, id, ok(info("alice.testnet", 9_999)));
    assert!(!m.bid(id).unwrap().filling);
    assert!(calls().is_empty() && transfers().is_empty());
    assert_eq!(events(), vec!["bid_fill_failed"]);
}

#[test]
fn bid_refuses_token_above_max_sats() {
    let (mut m, id) = with_bid();
    approve(&mut m, id);
    bid_info(&mut m, id, ok(info("alice.testnet", 100_001)));
    assert!(!m.bid(id).unwrap().filling && calls().is_empty());
}

#[test]
fn bid_refuses_token_with_loan_or_pending_signature() {
    let (mut m, id) = with_bid();
    for patch in [json!({ "loan": { "borrower": "alice.testnet" } }), json!({ "pending": true })] {
        approve(&mut m, id);
        let mut i = info("alice.testnet", 50_000);
        i.as_object_mut().unwrap().extend(patch.as_object().unwrap().clone());
        bid_info(&mut m, id, ok(i));
        assert!(!m.bid(id).unwrap().filling && calls().is_empty());
    }
}

#[test]
fn bid_refuses_if_owner_changed() {
    let (mut m, id) = with_bid();
    approve(&mut m, id);
    bid_info(&mut m, id, ok(info("carol.testnet", 50_000)));
    assert!(!m.bid(id).unwrap().filling && calls().is_empty());
}

#[test]
fn bid_restored_when_token_info_fails() {
    let (mut m, id) = with_bid();
    for r in [PromiseResult::Failed, ok(Value::Null), PromiseResult::Successful(b"garbage".to_vec())] {
        approve(&mut m, id);
        bid_info(&mut m, id, r);
        assert!(!m.bid(id).unwrap().filling && calls().is_empty());
    }
}

#[test]
fn fill_transfers_at_verified_sats_times_price() {
    let (mut m, id) = with_bid();
    approve(&mut m, id);
    bid_info(&mut m, id, ok(info("alice.testnet", 40_000)));
    let c = calls();
    assert_eq!((c[0].0.as_str(), c[0].1.as_str()), (NFT, "nft_transfer_payout"));
    let a = &c[0].2;
    assert_eq!(a["receiver_id"], "bob.testnet");
    assert_eq!(a["approval_id"], 7);
    assert_eq!(a["balance"], (40_000 * PPS).to_string());
    assert_eq!(a["max_len_payout"], MAX_PAYOUT);
    assert_eq!(c[1].1, "on_bid_payout");
}

#[test]
fn fill_pays_payout_and_refunds_remainder() {
    let (mut m, id) = with_bid();
    approve(&mut m, id);
    let price = 40_000 * PPS;
    let payout = json!({ "payout": { "alice.testnet": (price - price / 50).to_string(), "creator.testnet": (price / 50).to_string() } });
    ctx_at(MARKET, 0, T0, vec![ok(payout)]);
    m.on_bid_payout(id, "1".into(), acc("alice.testnet"), U128(price));
    let mut t = transfers();
    t.sort();
    assert_eq!(t, vec![
        ("alice.testnet".into(), price - price / 50),
        ("bob.testnet".into(), 60_000 * PPS + SD),
        ("creator.testnet".into(), price / 50),
    ]);
    assert!(m.bid(id).is_none());
    assert_eq!(m.reserves().owed.0, 0);
    assert_eq!(events(), vec!["bid_filled"]);
}

#[test]
fn bid_restored_when_transfer_fails() {
    let (mut m, id) = with_bid();
    approve(&mut m, id);
    ctx_at(MARKET, 0, T0, vec![PromiseResult::Failed]);
    m.on_bid_payout(id, "1".into(), acc("alice.testnet"), U128(40_000 * PPS));
    assert!(transfers().is_empty());
    let b = m.bid(id).unwrap();
    assert!(!b.filling && b.escrow.0 == 100_000 * PPS);
}

#[test]
fn inflated_payout_pays_seller_price_only() {
    let (mut m, id) = with_bid();
    approve(&mut m, id);
    let price = 40_000 * PPS;
    let payout = json!({ "payout": { "mallory.testnet": (100_000 * PPS).to_string() } });
    ctx_at(MARKET, 0, T0, vec![ok(payout)]);
    m.on_bid_payout(id, "1".into(), acc("alice.testnet"), U128(price));
    let mut t = transfers();
    t.sort();
    assert_eq!(t, vec![("alice.testnet".into(), price), ("bob.testnet".into(), 60_000 * PPS + SD)]);
}

/// `#[private]` is enforced by the wasm entry wrapper, which unit tests bypass, so check the source:
/// a public `on_*` callback without it would let anyone fake a token_info or payout answer.
#[test]
fn callbacks_are_private() {
    let src = include_str!("lib.rs");
    let lines: Vec<&str> = src.lines().collect();
    let cbs: Vec<usize> = (0..lines.len()).filter(|&i| lines[i].trim_start().starts_with("pub fn on_")).collect();
    assert_eq!(cbs.len(), 5);
    for i in cbs {
        assert_eq!(lines[i - 1].trim(), "#[private]", "{}", lines[i]);
    }
}

// ---------- loans ----------

const P: u128 = 10 * NEAR;

/// Lender posts 10 NEAR at 10%/yr for >= 50k sats; alice accepts with token "1" at T0.
fn with_loan() -> (Market, U64) {
    let mut m = market();
    ctx("lender.testnet", P + SD);
    let offer = m.offer_loan(U128(P), 1_000, acc(NFT), U64(50_000));
    let _ = accept(&mut m, offer);
    ctx_at(MARKET, 0, T0, vec![ok(info(MARKET, 60_000))]);
    assert!(!m.on_offer_info(offer, "1".into(), acc("alice.testnet")));
    (m, U64(offer.0 + 1))
}

fn accept(m: &mut Market, offer: U64) -> PromiseOrValue<bool> {
    ctx(NFT, 0);
    m.nft_on_transfer(acc("alice.testnet"), acc("alice.testnet"), "1".into(), json!({ "accept_offer": offer }).to_string())
}

fn debt(m: &Market, id: U64) -> u128 {
    m.loan(id).unwrap()["debt"].as_str().unwrap().parse().unwrap()
}

#[test]
#[should_panic(expected = "Attach exactly")]
fn offer_refuses_underfunded_principal() {
    let mut m = market();
    ctx("lender.testnet", P);
    m.offer_loan(U128(P), 1_000, acc(NFT), U64(50_000));
}

#[test]
fn cancel_offer_refunds_lender() {
    let mut m = market();
    ctx("lender.testnet", P + SD);
    let id = m.offer_loan(U128(P), 1_000, acc(NFT), U64(50_000));
    ctx("lender.testnet", 0);
    m.cancel_offer(id);
    assert_eq!(transfers(), vec![("lender.testnet".into(), P + SD)]);
    assert_eq!(m.reserves().owed.0, 0);
}

#[test]
fn accept_refuses_fake_nft_contract_and_third_party_sender() {
    let mut m = market();
    ctx("lender.testnet", P + SD);
    let id = m.offer_loan(U128(P), 1_000, acc(NFT), U64(50_000));
    ctx("fake-pusaka.testnet", 0);
    let r = m.nft_on_transfer(acc("alice.testnet"), acc("alice.testnet"), "1".into(), json!({ "accept_offer": id }).to_string());
    assert!(matches!(r, PromiseOrValue::Value(true)));
    ctx(NFT, 0);
    let r = m.nft_on_transfer(acc("approved-market.testnet"), acc("alice.testnet"), "1".into(), json!({ "accept_offer": id }).to_string());
    assert!(matches!(r, PromiseOrValue::Value(true)));
    assert!(calls().is_empty());
}

#[test]
fn accept_refuses_token_below_min_sats() {
    let mut m = market();
    ctx("lender.testnet", P + SD);
    let id = m.offer_loan(U128(P), 1_000, acc(NFT), U64(50_000));
    let _ = accept(&mut m, id);
    ctx_at(MARKET, 0, T0, vec![ok(info(MARKET, 49_999))]);
    assert!(m.on_offer_info(id, "1".into(), acc("alice.testnet")), "token goes back");
    assert!(transfers().is_empty() && m.offer(id).is_some());
}

#[test]
fn accept_refuses_if_market_not_owner() {
    let mut m = market();
    ctx("lender.testnet", P + SD);
    let id = m.offer_loan(U128(P), 1_000, acc(NFT), U64(50_000));
    let _ = accept(&mut m, id);
    ctx_at(MARKET, 0, T0, vec![ok(info("alice.testnet", 60_000))]);
    assert!(m.on_offer_info(id, "1".into(), acc("alice.testnet")));
    assert!(transfers().is_empty());
}

#[test]
fn offer_cancelled_midflight_returns_token() {
    let mut m = market();
    ctx("lender.testnet", P + SD);
    let id = m.offer_loan(U128(P), 1_000, acc(NFT), U64(50_000));
    let _ = accept(&mut m, id);
    ctx("lender.testnet", 0);
    m.cancel_offer(id);
    ctx_at(MARKET, 0, T0, vec![ok(info(MARKET, 60_000))]);
    assert!(m.on_offer_info(id, "1".into(), acc("alice.testnet")));
    assert!(transfers().is_empty());
}

#[test]
fn accept_offer_sends_principal_and_keeps_token() {
    let mut m = market();
    ctx("lender.testnet", P + SD);
    let id = m.offer_loan(U128(P), 1_000, acc(NFT), U64(50_000));
    let _ = accept(&mut m, id);
    ctx_at(MARKET, 0, T0, vec![ok(info(MARKET, 60_000))]);
    assert!(!m.on_offer_info(id, "1".into(), acc("alice.testnet")));
    assert_eq!(transfers(), vec![("alice.testnet".into(), P)]);
    assert!(m.offer(id).is_none());
    let r = m.reserves();
    assert_eq!((r.offers_escrow.0, r.loans_outstanding.0, r.deposits.0), (0, P, SD));
}

#[test]
fn debt_accrues_simple_interest() {
    let (m, id) = with_loan();
    ctx_at("x.testnet", 0, T0 + YEAR_MS as u64, vec![]);
    assert_eq!(debt(&m, id), P + P / 10);
    ctx_at("x.testnet", 0, T0 + YEAR_MS as u64 / 2, vec![]);
    assert_eq!(debt(&m, id), P + P / 20);
}

#[test]
#[should_panic(expected = "Attach at least")]
fn repay_underpaid_refused() {
    let (mut m, id) = with_loan();
    ctx_at("alice.testnet", P, T0 + 1_000, vec![]);
    let _ = m.repay(id);
}

#[test]
fn repay_returns_nft_then_pays_lender() {
    let (mut m, id) = with_loan();
    let t = T0 + YEAR_MS as u64;
    ctx_at("friend.testnet", 12 * NEAR, t, vec![]);
    let _ = m.repay(id);
    let c = calls();
    assert_eq!((c[0].0.as_str(), c[0].1.as_str()), (NFT, "nft_transfer"));
    assert_eq!(c[0].2["receiver_id"], "alice.testnet");
    assert!(transfers().is_empty(), "nobody paid before the NFT is back");
    ctx_at(MARKET, 0, t, vec![PromiseResult::Successful(vec![])]);
    m.on_repaid(id, acc("friend.testnet"), U128(12 * NEAR), U128(11 * NEAR));
    let mut tr = transfers();
    tr.sort();
    assert_eq!(tr, vec![("friend.testnet".into(), NEAR), ("lender.testnet".into(), 11 * NEAR + SD)]);
    assert!(m.loan(id).is_none());
    let r = m.reserves();
    assert_eq!((r.loans_outstanding.0, r.owed.0), (0, 0));
}

#[test]
fn repay_failed_transfer_refunds_payer_and_keeps_loan() {
    let (mut m, id) = with_loan();
    ctx_at("alice.testnet", 11 * NEAR, T0 + 1, vec![]);
    let _ = m.repay(id);
    ctx_at(MARKET, 0, T0 + 1, vec![PromiseResult::Failed]);
    m.on_repaid(id, acc("alice.testnet"), U128(11 * NEAR), U128(P));
    assert_eq!(transfers(), vec![("alice.testnet".into(), 11 * NEAR)]);
    assert!(m.loan(id).unwrap()["loan"]["busy"] == false);
}

#[test]
#[should_panic(expected = "Busy")]
fn double_repay_refused() {
    let (mut m, id) = with_loan();
    ctx_at("alice.testnet", 11 * NEAR, T0 + 1, vec![]);
    let _ = m.repay(id);
    let _ = m.repay(id);
}

#[test]
#[should_panic(expected = "AuctionNotOver")]
fn cannot_seize_before_auction_ends() {
    let (mut m, id) = with_loan();
    ctx("lender.testnet", 0);
    m.call_loan(id);
    ctx_at("lender.testnet", 0, T0 + AUCTION_MS - 1, vec![]);
    let _ = m.seize(id);
}

#[test]
#[should_panic(expected = "AuctionNotOver")]
fn cannot_seize_uncalled_loan() {
    let (mut m, id) = with_loan();
    ctx_at("lender.testnet", 0, T0 + 10 * YEAR_MS as u64, vec![]);
    let _ = m.seize(id);
}

#[test]
#[should_panic(expected = "NotLender")]
fn stranger_cannot_call_loan() {
    let (mut m, id) = with_loan();
    ctx("mallory.testnet", 0);
    m.call_loan(id);
}

#[test]
fn seize_after_auction_transfers_nft_to_lender() {
    let (mut m, id) = with_loan();
    ctx("lender.testnet", 0);
    m.call_loan(id);
    let t = T0 + AUCTION_MS;
    ctx_at("lender.testnet", 0, t, vec![]);
    let _ = m.seize(id);
    assert_eq!(calls()[0].2["receiver_id"], "lender.testnet");
    ctx_at(MARKET, 0, t, vec![PromiseResult::Successful(vec![])]);
    m.on_seized(id);
    assert_eq!(transfers(), vec![("lender.testnet".into(), SD)]);
    assert!(m.loan(id).is_none());
    assert_eq!(m.reserves().loans_outstanding.0, 0);
}

#[test]
fn auction_rate_rises_linearly() {
    let (mut m, id) = with_loan();
    ctx("lender.testnet", 0);
    m.call_loan(id);
    for (dt, rate) in [(0, 0), (AUCTION_MS / 4, MAX_RATE_BPS / 4), (AUCTION_MS / 2, MAX_RATE_BPS / 2)] {
        ctx_at("x.testnet", 0, T0 + dt, vec![]);
        assert_eq!(m.loan(id).unwrap()["auction_rate_bps"], rate);
    }
    ctx_at("x.testnet", 0, T0 + AUCTION_MS, vec![]);
    assert!(m.loan(id).unwrap()["auction_rate_bps"].is_null());
}

#[test]
#[should_panic(expected = "RateAboveAuction")]
fn refinance_rate_above_auction_cap_refused() {
    let (mut m, id) = with_loan();
    ctx("lender.testnet", 0);
    m.call_loan(id);
    ctx_at("newlender.testnet", 20 * NEAR, T0 + AUCTION_MS / 2, vec![]);
    m.refinance(id, MAX_RATE_BPS / 2 + 1);
}

#[test]
fn refinance_pays_old_lender_in_full() {
    let (mut m, id) = with_loan();
    let t = T0 + YEAR_MS as u64;
    ctx_at("lender.testnet", 0, t, vec![]);
    m.call_loan(id);
    ctx_at("newlender.testnet", 20 * NEAR, t + AUCTION_MS / 2, vec![]);
    let owed = debt(&m, id);
    assert!(owed > P + P / 10, "includes interest up to this ms");
    m.refinance(id, 2_000);
    let mut tr = transfers();
    tr.sort();
    assert_eq!(tr, vec![("lender.testnet".into(), owed + SD), ("newlender.testnet".into(), 20 * NEAR - owed - SD)]);
    let l = &m.loan(id).unwrap()["loan"];
    assert_eq!((l["lender"].as_str(), l["rate_bps"].as_u64()), (Some("newlender.testnet"), Some(2_000)));
    assert!(l["auction_start_ms"].is_null());
    assert_eq!(l["principal"], owed.to_string());
    assert_eq!(m.reserves().loans_outstanding.0, owed);
}

#[test]
#[should_panic(expected = "NoAuction")]
fn cannot_refinance_after_auction_ends() {
    let (mut m, id) = with_loan();
    ctx("lender.testnet", 0);
    m.call_loan(id);
    ctx_at("newlender.testnet", 20 * NEAR, T0 + AUCTION_MS, vec![]);
    m.refinance(id, 0);
}

#[test]
#[should_panic(expected = "Busy")]
fn cannot_refinance_while_repay_in_flight() {
    let (mut m, id) = with_loan();
    ctx("lender.testnet", 0);
    m.call_loan(id);
    ctx_at("alice.testnet", 11 * NEAR, T0 + 1, vec![]);
    let _ = m.repay(id);
    ctx_at("newlender.testnet", 20 * NEAR, T0 + 2, vec![]);
    m.refinance(id, 0);
}

#[test]
fn borrower_can_repay_during_auction() {
    let (mut m, id) = with_loan();
    ctx("lender.testnet", 0);
    m.call_loan(id);
    ctx_at("alice.testnet", 11 * NEAR, T0 + AUCTION_MS - 1, vec![]);
    let _ = m.repay(id);
    assert_eq!(calls()[0].2["receiver_id"], "alice.testnet");
}
