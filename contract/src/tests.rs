//! Unit tests for the threat model in docs/PRD.md §8 (T1–T6).

use super::*;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{test_vm_config, testing_env, PromiseResult, RuntimeFeesConfig};

// Real `derived_public_key("pusaka-1", pusaka.testnet)` answer from v1.signer-prod.testnet.
const MPC_KEY: &str = "secp256k1:5feCFR39BrE42L2psdjrLxdZbQazaqJTPjnvu7XQJNxZARDPgrya83HoCiBAZDc4sZNpMqe6mudTRxxjYRLQBAmx";
const TXID: &str = "4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b";
const SIG: &str = r#"{"scheme":"Secp256k1","big_r":{"affine_point":"02aa"},"s":{"scalar":"bb"},"recovery_id":0}"#;

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn ctx(caller: &str, deposit: NearToken, results: Vec<PromiseResult>) {
    let c = VMContextBuilder::new()
        .current_account_id(acc("pusaka.testnet"))
        .predecessor_account_id(acc(caller))
        .attached_deposit(deposit)
        .prepaid_gas(Gas::from_tgas(300))
        .build();
    testing_env!(c, test_vm_config(), RuntimeFeesConfig::test(), Default::default(), results);
}

fn as_contract(results: Vec<PromiseResult>) {
    ctx("pusaka.testnet", NearToken::from_yoctonear(0), results);
}

/// Contract with token "1" owned by alice and its BTC key set.
fn setup() -> Pusaka {
    ctx("alice.testnet", NearToken::from_near(1), vec![]);
    let mut c = Pusaka::new(acc("v1.signer-prod.testnet"));
    let _ = c.nft_mint(None);
    as_contract(vec![PromiseResult::Successful(
        serde_json::to_vec(MPC_KEY).unwrap(),
    )]);
    c.on_key("1".into());
    c
}

fn utxo(vout: u32) -> Utxo {
    Utxo { txid: TXID.into(), vout, value: U64(100_000) }
}

fn withdraw(c: &mut Pusaka, caller: &str, vouts: &[u32]) {
    ctx(caller, NearToken::from_millinear(20), vec![]);
    let _ = c.withdraw(
        "1".into(),
        vouts.iter().map(|v| utxo(*v)).collect(),
        "0014".to_string() + &"11".repeat(20),
        U64(50_000),
        U64(500),
    );
}

fn sign_ok(c: &mut Pusaka, vouts: &[u32], ok: &[bool]) -> SignedSpend {
    as_contract(
        ok.iter()
            .map(|o| {
                if *o {
                    PromiseResult::Successful(SIG.as_bytes().to_vec())
                } else {
                    PromiseResult::Failed
                }
            })
            .collect(),
    );
    c.on_signed("1".into(), vouts.len() as u32, U64(50_000), "00".into())
}

#[test]
fn key_is_compressed_from_mpc_format() {
    let c = setup();
    let pk = c.token_info("1".into()).unwrap().btc_pubkey.unwrap();
    assert_eq!(pk.len(), 66);
    assert!(pk.starts_with("02") || pk.starts_with("03"));
}

#[test]
#[should_panic(expected = "NotOwner")]
fn t5_non_owner_withdraw_fails() {
    let mut c = setup();
    withdraw(&mut c, "mallory.testnet", &[0]);
}

#[test]
#[should_panic(expected = "Listed")]
fn t1_withdraw_while_listed_fails() {
    let mut c = setup();
    ctx("alice.testnet", NearToken::from_yoctonear(0), vec![]);
    c.list("1".into(), NearToken::from_near(5), None, None);
    withdraw(&mut c, "alice.testnet", &[0]);
}

#[test]
#[should_panic(expected = "SignPending")]
fn t2_transfer_while_pending_fails() {
    let mut c = setup();
    withdraw(&mut c, "alice.testnet", &[0]);
    ctx("alice.testnet", NearToken::from_yoctonear(1), vec![]);
    c.nft_transfer(acc("bob.testnet"), "1".into(), None, None);
}

#[test]
#[should_panic(expected = "SignPending")]
fn t2_list_while_pending_fails() {
    let mut c = setup();
    withdraw(&mut c, "alice.testnet", &[0]);
    ctx("alice.testnet", NearToken::from_yoctonear(0), vec![]);
    c.list("1".into(), NearToken::from_near(5), None, None);
}

#[test]
fn t3_outpoints_are_recorded_before_signing_and_lock_released() {
    let mut c = setup();
    withdraw(&mut c, "alice.testnet", &[0, 1]);
    let info = c.token_info("1".into()).unwrap();
    assert!(info.pending);
    // Recorded at request time, before any signature exists.
    assert_eq!(info.signed_outpoints.len(), 2);

    // Input 1's signature never came back (e.g. MPC timeout). It may still exist on
    // chain later, so it must stay recorded.
    let out = sign_ok(&mut c, &[0, 1], &[true, false]);
    assert!(out.signatures[1].is_none());
    let info = c.token_info("1".into()).unwrap();
    assert!(!info.pending);
    assert_eq!(
        info.signed_outpoints,
        vec![OutPointRef { txid: TXID.into(), vout: 0 }, OutPointRef { txid: TXID.into(), vout: 1 }]
    );
}

#[test]
fn repeated_withdrawals_do_not_duplicate_outpoints() {
    let mut c = setup();
    withdraw(&mut c, "alice.testnet", &[0]);
    sign_ok(&mut c, &[0], &[true]);
    withdraw(&mut c, "alice.testnet", &[0]);
    sign_ok(&mut c, &[0], &[true]);
    assert_eq!(c.token_info("1".into()).unwrap().signed_outpoints.len(), 1);
}

#[test]
#[should_panic(expected = "still waiting")]
fn unlock_stale_waits_for_timeout() {
    let mut c = setup();
    withdraw(&mut c, "alice.testnet", &[0]);
    ctx("alice.testnet", NearToken::from_yoctonear(0), vec![]);
    c.unlock_stale("1".into());
}

#[test]
fn unlock_stale_releases_after_timeout() {
    let mut c = setup();
    withdraw(&mut c, "alice.testnet", &[0]);
    let later = VMContextBuilder::new()
        .current_account_id(acc("pusaka.testnet"))
        .predecessor_account_id(acc("alice.testnet"))
        .block_height(10_000)
        .build();
    testing_env!(later, test_vm_config(), RuntimeFeesConfig::test(), Default::default(), vec![]);
    c.unlock_stale("1".into());
    let info = c.token_info("1".into()).unwrap();
    assert!(!info.pending);
    assert_eq!(info.signed_outpoints.len(), 1); // still recorded: unlocking is safe
}

#[test]
#[should_panic(expected = "nft_transfer_call is disabled")]
fn transfer_call_is_disabled() {
    let mut c = setup();
    ctx("alice.testnet", NearToken::from_yoctonear(1), vec![]);
    let _ = c.nft_transfer_call(acc("market.testnet"), "1".into(), None, None, "".into());
}

#[test]
#[should_panic(expected = "StateChanged")]
fn t4_buy_with_stale_count_fails() {
    let mut c = setup();
    withdraw(&mut c, "alice.testnet", &[0]);
    sign_ok(&mut c, &[0], &[true]); // 1 signed outpoint
    ctx("alice.testnet", NearToken::from_yoctonear(0), vec![]);
    c.list("1".into(), NearToken::from_near(5), None, None);
    ctx("bob.testnet", NearToken::from_near(5), vec![]);
    c.buy("1".into(), 0); // bob checked before the signature existed
}

#[test]
fn sale_moves_btc_control_to_buyer() {
    let mut c = setup();
    ctx("alice.testnet", NearToken::from_yoctonear(0), vec![]);
    c.list("1".into(), NearToken::from_near(5), None, None);
    ctx("bob.testnet", NearToken::from_near(6), vec![]);
    c.buy("1".into(), 0);

    let info = c.token_info("1".into()).unwrap();
    assert_eq!(info.token.owner_id, acc("bob.testnet"));
    assert!(info.listing.is_none());

    // The buyer can now sign; the seller cannot (checked separately below).
    withdraw(&mut c, "bob.testnet", &[0]);
    assert!(c.token_info("1".into()).unwrap().pending);
}

#[test]
#[should_panic(expected = "NotOwner")]
fn seller_cannot_withdraw_after_sale() {
    let mut c = setup();
    ctx("alice.testnet", NearToken::from_yoctonear(0), vec![]);
    c.list("1".into(), NearToken::from_near(5), None, None);
    ctx("bob.testnet", NearToken::from_near(5), vec![]);
    c.buy("1".into(), 0);
    withdraw(&mut c, "alice.testnet", &[0]);
}

#[test]
#[should_panic(expected = "InsufficientDeposit")]
fn underpaying_buy_fails() {
    let mut c = setup();
    ctx("alice.testnet", NearToken::from_yoctonear(0), vec![]);
    c.list("1".into(), NearToken::from_near(5), None, None);
    ctx("bob.testnet", NearToken::from_near(4), vec![]);
    c.buy("1".into(), 0);
}

#[test]
#[should_panic(expected = "KeyNotReady")]
fn token_without_key_is_frozen() {
    ctx("alice.testnet", NearToken::from_near(1), vec![]);
    let mut c = Pusaka::new(acc("v1.signer-prod.testnet"));
    let _ = c.nft_mint(None);
    c.list("1".into(), NearToken::from_near(5), None, None);
}

#[test]
#[should_panic(expected = "inputs do not cover amount + fee")]
fn overspend_is_rejected() {
    let mut c = setup();
    ctx("alice.testnet", NearToken::from_millinear(20), vec![]);
    let _ = c.withdraw(
        "1".into(),
        vec![utxo(0)],
        "0014".to_string() + &"11".repeat(20),
        U64(100_000),
        U64(1),
    );
}

#[test]
fn uppercase_txid_is_recorded_canonically() {
    // Attack: sign with an upper-case txid so the registry entry doesn't match what
    // the buyer's indexer reports, making a signed UTXO look "safe".
    let upper = Utxo { txid: TXID.to_uppercase(), vout: 0, value: U64(100_000) };
    assert_eq!(canonical_utxos(vec![upper])[0].txid, TXID);
}

#[test]
#[should_panic(expected = "duplicate outpoint")]
fn duplicate_outpoints_rejected() {
    let mut c = setup();
    withdraw(&mut c, "alice.testnet", &[0, 0]);
}

#[test]
#[should_panic(expected = "txid must be 64 hex chars")]
fn malformed_txid_rejected() {
    let mut c = setup();
    ctx("alice.testnet", NearToken::from_millinear(20), vec![]);
    let bad = Utxo { txid: format!("{TXID}00"), vout: 0, value: U64(100_000) };
    let _ = c.withdraw("1".into(), vec![bad], "0014".to_string() + &"11".repeat(20), U64(50_000), U64(500));
}

#[test]
#[should_panic(expected = "for storage")]
fn mint_must_pay_storage() {
    ctx("alice.testnet", NearToken::from_millinear(1), vec![]);
    let mut c = Pusaka::new(acc("v1.signer-prod.testnet"));
    let _ = c.nft_mint(None);
}

#[test]
#[should_panic(expected = "for storage")]
fn withdraw_must_pay_outpoint_storage() {
    let mut c = setup();
    ctx("alice.testnet", NearToken::from_yoctonear(1), vec![]);
    let _ = c.withdraw("1".into(), vec![utxo(0)], "0014".to_string() + &"11".repeat(20), U64(50_000), U64(500));
}

// ---------- loans & Dutch auctions ----------

const DAY_MS: u64 = 86_400_000;

fn at(caller: &str, deposit: NearToken, now_ms: u64) {
    let c = VMContextBuilder::new()
        .current_account_id(acc("pusaka.testnet"))
        .predecessor_account_id(acc(caller))
        .attached_deposit(deposit)
        .block_timestamp(now_ms * 1_000_000)
        .prepaid_gas(Gas::from_tgas(300))
        .build();
    testing_env!(c, test_vm_config(), RuntimeFeesConfig::test(), Default::default(), vec![]);
}

/// Alice asks for 10 NEAR, repays 11, within a day; Bob funds it at t=1000.
fn funded_loan() -> Pusaka {
    let mut c = setup();
    at("alice.testnet", NearToken::from_yoctonear(0), 0);
    c.request_loan("1".into(), NearToken::from_near(10), NearToken::from_near(11), U64(DAY_MS));
    at("bob.testnet", NearToken::from_near(10), 1_000);
    c.fund_loan("1".into(), 0);
    c
}

#[test]
fn loan_funding_sets_due_date_and_keeps_owner() {
    let c = funded_loan();
    let info = c.token_info("1".into()).unwrap();
    let loan = info.loan.unwrap();
    assert_eq!(loan.lender, Some(acc("bob.testnet")));
    assert_eq!(loan.due_ms, Some(U64(1_000 + DAY_MS)));
    assert_eq!(info.token.owner_id, acc("alice.testnet"));
}

#[test]
#[should_panic(expected = "Collateralised")]
fn l1_borrower_cannot_withdraw_collateral() {
    let mut c = funded_loan();
    withdraw(&mut c, "alice.testnet", &[0]);
}

#[test]
#[should_panic(expected = "Collateralised")]
fn l1_borrower_cannot_transfer_collateral() {
    let mut c = funded_loan();
    at("alice.testnet", NearToken::from_yoctonear(1), 2_000);
    c.nft_transfer(acc("carol.testnet"), "1".into(), None, None);
}

#[test]
#[should_panic(expected = "Collateralised")]
fn l1_borrower_cannot_sell_collateral() {
    let mut c = funded_loan();
    at("alice.testnet", NearToken::from_yoctonear(0), 2_000);
    c.list("1".into(), NearToken::from_near(5), None, None);
}

#[test]
#[should_panic(expected = "Collateralised")]
fn l1_unfunded_request_also_locks() {
    let mut c = setup();
    at("alice.testnet", NearToken::from_yoctonear(0), 0);
    c.request_loan("1".into(), NearToken::from_near(10), NearToken::from_near(11), U64(DAY_MS));
    withdraw(&mut c, "alice.testnet", &[0]);
}

#[test]
#[should_panic(expected = "StateChanged")]
fn l2_lender_with_stale_signed_count_fails() {
    let mut c = setup();
    withdraw(&mut c, "alice.testnet", &[0]);
    sign_ok(&mut c, &[0], &[true]);
    at("alice.testnet", NearToken::from_yoctonear(0), 0);
    c.request_loan("1".into(), NearToken::from_near(10), NearToken::from_near(11), U64(DAY_MS));
    at("bob.testnet", NearToken::from_near(10), 1_000);
    c.fund_loan("1".into(), 0);
}

#[test]
#[should_panic(expected = "NotDueYet")]
fn l3_lender_cannot_claim_before_due() {
    let mut c = funded_loan();
    at("bob.testnet", NearToken::from_yoctonear(0), 1_000 + DAY_MS - 1);
    c.claim_collateral("1".into());
}

#[test]
fn l3_lender_claims_collateral_after_default() {
    let mut c = funded_loan();
    at("bob.testnet", NearToken::from_yoctonear(0), 1_000 + DAY_MS);
    c.claim_collateral("1".into());
    let info = c.token_info("1".into()).unwrap();
    assert_eq!(info.token.owner_id, acc("bob.testnet"));
    assert!(info.loan.is_none());
    // Bob now controls the BTC: he can withdraw, Alice can't.
    withdraw(&mut c, "bob.testnet", &[0]);
}

#[test]
#[should_panic(expected = "NotLender")]
fn l3_only_lender_claims() {
    let mut c = funded_loan();
    at("mallory.testnet", NearToken::from_yoctonear(0), 1_000 + DAY_MS);
    c.claim_collateral("1".into());
}

#[test]
fn l4_repay_unlocks_and_closes_loan() {
    let mut c = funded_loan();
    at("alice.testnet", NearToken::from_near(11), 5_000);
    c.repay_loan("1".into());
    let info = c.token_info("1".into()).unwrap();
    assert!(info.loan.is_none());
    assert_eq!(info.token.owner_id, acc("alice.testnet"));
    withdraw(&mut c, "alice.testnet", &[0]); // unlocked again
}

#[test]
#[should_panic(expected = "NoLoan")]
fn l4_no_claim_after_repay() {
    let mut c = funded_loan();
    at("alice.testnet", NearToken::from_near(11), 5_000);
    c.repay_loan("1".into());
    at("bob.testnet", NearToken::from_yoctonear(0), 1_000 + DAY_MS);
    c.claim_collateral("1".into());
}

#[test]
#[should_panic(expected = "InsufficientDeposit")]
fn l4_partial_repay_fails() {
    let mut c = funded_loan();
    at("alice.testnet", NearToken::from_near(10), 5_000);
    c.repay_loan("1".into());
}

#[test]
#[should_panic(expected = "LoanAlreadyFunded")]
fn l5_borrower_cannot_cancel_funded_loan() {
    let mut c = funded_loan();
    at("alice.testnet", NearToken::from_yoctonear(0), 2_000);
    c.cancel_loan_request("1".into());
}

#[test]
#[should_panic(expected = "LoanAlreadyFunded")]
fn l5_loan_cannot_be_funded_twice() {
    let mut c = funded_loan();
    at("carol.testnet", NearToken::from_near(10), 2_000);
    c.fund_loan("1".into(), 0);
}

#[test]
fn dutch_auction_price_falls_linearly_then_floors() {
    let mut c = setup();
    at("alice.testnet", NearToken::from_yoctonear(0), 0);
    c.list("1".into(), NearToken::from_near(10), Some(NearToken::from_near(2)), Some(U64(1_000)));
    let p = |c: &Pusaka| c.token_info("1".into()).unwrap().price_now.unwrap();
    at("x.testnet", NearToken::from_yoctonear(0), 500);
    assert_eq!(p(&c), NearToken::from_near(6));
    at("x.testnet", NearToken::from_yoctonear(0), 5_000);
    assert_eq!(p(&c), NearToken::from_near(2));
}

#[test]
fn dutch_auction_buys_at_current_price() {
    let mut c = setup();
    at("alice.testnet", NearToken::from_yoctonear(0), 0);
    c.list("1".into(), NearToken::from_near(10), Some(NearToken::from_near(2)), Some(U64(1_000)));
    at("bob.testnet", NearToken::from_near(6), 500); // exactly the price at t=500
    c.buy("1".into(), 0);
    assert_eq!(c.token_info("1".into()).unwrap().token.owner_id, acc("bob.testnet"));
}

#[test]
#[should_panic(expected = "InsufficientDeposit")]
fn dutch_auction_rejects_yesterdays_price() {
    let mut c = setup();
    at("alice.testnet", NearToken::from_yoctonear(0), 0);
    c.list("1".into(), NearToken::from_near(10), Some(NearToken::from_near(2)), Some(U64(1_000)));
    at("bob.testnet", NearToken::from_near(5), 400); // price is 6.8 here
    c.buy("1".into(), 0);
}

#[test]
#[should_panic(expected = "need 0 < floor <= price")]
fn listing_floor_above_price_rejected() {
    let mut c = setup();
    at("alice.testnet", NearToken::from_yoctonear(0), 0);
    c.list("1".into(), NearToken::from_near(2), Some(NearToken::from_near(3)), Some(U64(1_000)));
}
