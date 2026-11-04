//! Unit tests for the threat model in docs/PRD.md §8 (T1–T6).

use super::*;
use near_sdk::json_types::U128;
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
    c.fund_loan("1".into(), 0, NearToken::from_near(10), NearToken::from_near(11), U64(DAY_MS));
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
    c.fund_loan("1".into(), 0, NearToken::from_near(10), NearToken::from_near(11), U64(DAY_MS));
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
    c.fund_loan("1".into(), 0, NearToken::from_near(10), NearToken::from_near(11), U64(DAY_MS));
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

// ---------- EVM ----------

const CHAIN: u64 = EVM_CHAINS[0]; // Sepolia on testnet builds, Ethereum with --features mainnet

fn withdraw_eth(c: &mut Pusaka, caller: &str, nonce: u64) {
    ctx(caller, NearToken::from_millinear(20), vec![]);
    let _ = c.withdraw_eth(
        "1".into(),
        U64(CHAIN),
        U64(nonce),
        "0x".to_string() + &"ab".repeat(20),
        U128(1_000_000_000_000_000),
        U128(21_000),
        U128(30_000_000_000),
        U128(1_000_000_000),
        None,
    );
}

#[test]
fn e1_nonce_floor_recorded_before_signing() {
    let mut c = setup();
    withdraw_eth(&mut c, "alice.testnet", 4);
    // Recorded at request time, while the signature is still in flight.
    assert!(c.token_info("1".into()).unwrap().pending);
    assert_eq!(c.eth_nonce_floor("1".into(), U64(CHAIN)), U64(5));
    assert_eq!(c.eth_nonce_floor("1".into(), U64(56)), U64(0)); // per chain
}

#[test]
fn e1_floor_never_goes_down() {
    let mut c = setup();
    withdraw_eth(&mut c, "alice.testnet", 7);
    as_contract(vec![PromiseResult::Successful(SIG.as_bytes().to_vec())]);
    let out = c.on_eth_signed("1".into(), U64(CHAIN), U64(7), U128(1), "00".into(), None);
    assert!(out.signature.is_some());
    withdraw_eth(&mut c, "alice.testnet", 2); // an older nonce must not lower the floor
    assert_eq!(c.eth_nonce_floor("1".into(), U64(CHAIN)), U64(8));
}

#[test]
#[should_panic(expected = "NotOwner")]
fn e2_non_owner_cannot_sign_evm() {
    let mut c = setup();
    withdraw_eth(&mut c, "mallory.testnet", 0);
}

#[test]
#[should_panic(expected = "Listed")]
fn e2_evm_locked_while_listed() {
    let mut c = setup();
    ctx("alice.testnet", NearToken::from_yoctonear(0), vec![]);
    c.list("1".into(), NearToken::from_near(5), None, None);
    withdraw_eth(&mut c, "alice.testnet", 0);
}

#[test]
#[should_panic(expected = "Collateralised")]
fn e2_evm_locked_while_collateralised() {
    let mut c = funded_loan();
    withdraw_eth(&mut c, "alice.testnet", 0);
}

#[test]
#[should_panic(expected = "to must be a 0x-prefixed 20-byte address")]
fn e3_bad_evm_address_rejected() {
    let mut c = setup();
    ctx("alice.testnet", NearToken::from_millinear(20), vec![]);
    let _ = c.withdraw_eth("1".into(), U64(CHAIN), U64(0), "0x1234".into(),
        U128(1), U128(21_000), U128(1), U128(1), None);
}

// ---------- review round 3: bind ETH state and loan terms ----------

#[test]
#[should_panic(expected = "StateChanged")]
fn r1_eth_signature_between_check_and_buy_fails() {
    // Seller: (buyer checks epoch 0) -> sign an ETH tx -> list -> buyer buys with 0.
    let mut c = setup();
    withdraw_eth(&mut c, "alice.testnet", 0);
    as_contract(vec![PromiseResult::Successful(SIG.as_bytes().to_vec())]);
    c.on_eth_signed("1".into(), U64(CHAIN), U64(0), U128(1), "00".into(), None);
    at("alice.testnet", NearToken::from_yoctonear(0), 0);
    c.list("1".into(), NearToken::from_near(5), None, None);
    at("bob.testnet", NearToken::from_near(5), 10);
    c.buy("1".into(), 0);
}

#[test]
fn r1_epoch_counts_btc_inputs_and_evm_txs() {
    let mut c = setup();
    withdraw(&mut c, "alice.testnet", &[0, 1]);
    sign_ok(&mut c, &[0, 1], &[true, true]);
    withdraw_eth(&mut c, "alice.testnet", 0);
    assert_eq!(c.token_info("1".into()).unwrap().sign_epoch, 3);
}

#[test]
#[should_panic(expected = "TermsChanged")]
fn r2_lender_rejects_changed_terms() {
    let mut c = setup();
    at("alice.testnet", NearToken::from_yoctonear(0), 0);
    c.request_loan("1".into(), NearToken::from_near(10), NearToken::from_near(11), U64(DAY_MS));
    // Borrower swaps in worse terms before the lender's transaction lands.
    c.cancel_loan_request("1".into());
    c.request_loan("1".into(), NearToken::from_near(10), NearToken::from_near(10), U64(3650 * DAY_MS));
    at("bob.testnet", NearToken::from_near(10), 1_000);
    c.fund_loan("1".into(), 0, NearToken::from_near(10), NearToken::from_near(11), U64(DAY_MS));
}

#[test]
#[should_panic(expected = "chain not supported")]
fn r3_unlisted_chain_rejected() {
    let mut c = setup();
    ctx("alice.testnet", NearToken::from_millinear(20), vec![]);
    let _ = c.withdraw_eth("1".into(), U64(56), U64(0), "0x".to_string() + &"ab".repeat(20),
        U128(1), U128(21_000), U128(1), U128(1), None);
}

#[test]
fn r4_huge_auction_does_not_overflow() {
    // 1M NEAR falling to 1 NEAR over 7 days used to overflow u128 after ~3.9 days.
    let l = Listing {
        seller: acc("alice.testnet"),
        price: NearToken::from_near(1_000_000),
        floor: NearToken::from_near(1),
        start_ms: U64(0),
        end_ms: U64(7 * DAY_MS),
    };
    let mid = l.price_at(7 * DAY_MS / 2).as_near();
    assert!((499_999..=500_001).contains(&mid), "midpoint {mid}");
    assert_eq!(l.price_at(6 * DAY_MS + 1).as_yoctonear() > NearToken::from_near(1).as_yoctonear(), true);
    assert_eq!(l.price_at(8 * DAY_MS), NearToken::from_near(1));
}

// ---------- trustless deposits (light client) ----------

/// Real Bitcoin testnet3 tx 077f4f07…00c3 (block 5260738), non-witness serialization.
const REAL_TX: &str = "0100000002715ab11ef9d3e33640b57d78c4f2df234d6157ab78065402f9864c6f962ed2e70000000000ffffffff5a83e222d73ed0b88b383534930b9ab2358b1f3ab9c28de891731af33a4d97c40000000000ffffffff0238e4010000000000160014e309c53e7ecc118d6197598f83dab4c3d99a006bd477000000000000160014bc0cd3cd486c63fbeaa51c9dc5b562165e616a0700000000";
const REAL_TXID: &str = "077f4f07163041c6c255499261248b2887a389f493d11230b9d0722ce8b600c3";

#[test]
fn p1_parses_real_bitcoin_tx_and_computes_txid() {
    ctx("alice.testnet", NearToken::from_yoctonear(0), vec![]);
    let tx = hex::decode(REAL_TX).unwrap();
    let (v0, s0) = btc::output(&tx, 0);
    let (v1, s1) = btc::output(&tx, 1);
    assert_eq!((v0, hex::encode(s0)), (123_960, "0014e309c53e7ecc118d6197598f83dab4c3d99a006b".to_string()));
    assert_eq!((v1, hex::encode(s1)), (30_676, "0014bc0cd3cd486c63fbeaa51c9dc5b562165e616a07".to_string()));
    let mut id = btc::sha256d(&tx);
    id.reverse();
    assert_eq!(hex::encode(id), REAL_TXID);
}

#[test]
#[should_panic(expected = "output does not pay this Pusaka")]
fn p2_deposit_to_someone_else_rejected() {
    let mut c = setup();
    ctx("bob.testnet", NearToken::from_millinear(20), vec![]);
    let _ = c.prove_deposit("1".into(), REAL_TX.into(), 0, "00".repeat(32), U64(1), vec![],
        "00".repeat(32), vec![]);
}

#[test]
#[should_panic(expected = "non-witness serialization")]
fn p2_segwit_serialization_rejected() {
    let mut c = setup();
    ctx("bob.testnet", NearToken::from_millinear(20), vec![]);
    let segwit = format!("{}0001{}", &REAL_TX[..8], &REAL_TX[8..]);
    let _ = c.prove_deposit("1".into(), segwit, 0, "00".repeat(32), U64(1), vec![], "00".repeat(32), vec![]);
}

fn proven(c: &mut Pusaka, result: &[u8], vout: u32, value: u64) -> bool {
    as_contract(vec![PromiseResult::Successful(result.to_vec())]);
    c.on_deposit_proven("1".into(), TXID.into(), vout, U64(value), acc("bob.testnet"))
}

#[test]
fn p3_verified_balance_counts_only_proven_never_signed() {
    let mut c = setup();
    assert!(proven(&mut c, b"true", 0, 70_000));
    assert!(proven(&mut c, b"true", 1, 30_000));
    assert!(!proven(&mut c, b"false", 2, 99_999)); // light client said no
    assert!(proven(&mut c, b"true", 0, 70_000)); // duplicate: not double counted
    let info = c.token_info("1".into()).unwrap();
    assert_eq!(info.proven_utxos.len(), 2);
    assert_eq!(info.verified_sats, U64(100_000));

    // Once outpoint 0 is signed for, it no longer counts: someone holds a signature.
    withdraw(&mut c, "alice.testnet", &[0]);
    assert_eq!(c.token_info("1".into()).unwrap().verified_sats, U64(30_000));
}

#[test]
fn p4_proof_args_borsh_layout() {
    ctx("alice.testnet", NearToken::from_yoctonear(0), vec![]);
    let h = "11".repeat(32);
    let b = btc::proof_args_borsh(&[7u8; 32], &h, 5, &[h.clone(), h.clone()], &h, &[h.clone()], 1);
    assert_eq!(b.len(), 32 + 32 + 8 + 4 + 64 + 32 + 4 + 32 + 8);
    assert_eq!(&b[64..72], &5u64.to_le_bytes());
    assert_eq!(&b[72..76], &2u32.to_le_bytes());
}

// ---------- NEP-297 events and on-chain dynamic art ----------

fn svg_of(c: &Pusaka) -> String {
    use base64::Engine;
    let media = c.nft_token("1".into()).unwrap().metadata.unwrap().media.unwrap();
    let b64 = media.strip_prefix("data:image/svg+xml;base64,").expect("data uri");
    String::from_utf8(base64::engine::general_purpose::STANDARD.decode(b64).unwrap()).unwrap()
}

#[test]
fn n1_mint_emits_nep297_event() {
    ctx("alice.testnet", NearToken::from_near(1), vec![]);
    let mut c = Pusaka::new(acc("v1.signer-prod.testnet"));
    let _ = c.nft_mint(None);
    let logs = near_sdk::test_utils::get_logs();
    assert!(logs.iter().any(|l| l.starts_with("EVENT_JSON:") && l.contains("\"event\":\"nft_mint\"") && l.contains("\"1\"")), "{logs:?}");
}

#[test]
fn n2_image_follows_verified_btc_and_lock_state() {
    let mut c = setup();
    let empty = svg_of(&c);
    assert!(empty.starts_with("<svg") && empty.ends_with("</svg>"));
    assert!(empty.contains("stroke-dasharray=\"0.0 578.0\""), "ring empty with no verified BTC");
    assert!(!empty.contains("#8e2c2c"), "no seal when unlocked");

    proven(&mut c, b"true", 0, 1_000_000); // ~0.01 BTC verified
    let full = svg_of(&c);
    assert!(full.contains("stroke-dasharray=\"578.0 578.0\""), "ring full at ~2^20 sats");

    ctx("alice.testnet", NearToken::from_yoctonear(0), vec![]);
    c.list("1".into(), NearToken::from_near(5), None, None);
    assert!(svg_of(&c).contains("#8e2c2c"), "seal while listed");
    let desc = c.nft_token("1".into()).unwrap().metadata.unwrap().description.unwrap();
    assert!(desc.contains("0.01000000 BTC verified") && desc.contains("Locked"), "{desc}");
}

#[test]
fn n3_collection_icon_set() {
    let c = setup();
    assert!(c.nft_metadata().icon.unwrap().starts_with("data:image/svg+xml;base64,"));
}

#[test]
fn p5_withdraw_prunes_spent_proven_deposits() {
    let mut c = setup();
    proven(&mut c, b"true", 0, 70_000);
    proven(&mut c, b"true", 1, 30_000);
    withdraw(&mut c, "alice.testnet", &[0]);
    let info = c.token_info("1".into()).unwrap();
    assert_eq!(info.proven_utxos.len(), 1);
    assert_eq!(info.verified_sats, U64(30_000));
}

#[test]
fn p6_registry_is_capped() {
    let mut c = setup();
    for v in 0..70u32 { proven(&mut c, b"true", v, 20_000); }
    assert_eq!(c.token_info("1".into()).unwrap().proven_utxos.len(), 64);
}

#[test]
fn p8_prover_refunded_whenever_nothing_is_stored() {
    // Two parallel proofs of one outpoint both pass prove_deposit's "already proven" check;
    // the second callback stores nothing and must hand the storage deposit back.
    let refunds = || near_sdk::test_utils::get_created_receipts().iter()
        .filter(|r| r.receiver_id.as_str() == "bob.testnet").count();
    let mut c = setup();
    assert!(proven(&mut c, b"true", 0, 70_000));
    assert_eq!(refunds(), 0, "stored: keeps the deposit");
    assert!(proven(&mut c, b"true", 0, 70_000));
    assert_eq!(refunds(), 1, "duplicate: refunded");
    assert!(!proven(&mut c, b"false", 1, 70_000));
    assert_eq!(refunds(), 1, "rejected: refunded");
}

#[test]
#[should_panic(expected = "already signed for")]
fn p7_cannot_reprove_a_signed_outpoint() {
    // After a withdrawal prunes a proven deposit, re-proving that outpoint must fail,
    // or dead entries could fill the 64-entry registry.
    let mut c = setup();
    ctx("pusaka.testnet", NearToken::from_yoctonear(0), vec![]);
    c.signed.insert("1".into(), vec![OutPointRef { txid: REAL_TXID.into(), vout: 0 }]);
    ctx("bob.testnet", NearToken::from_millinear(20), vec![]);
    let _ = c.prove_deposit("1".into(), REAL_TX.into(), 0, "00".repeat(32), U64(1), vec![], "00".repeat(32), vec![]);
}

// ---------- NEP-178 / NEP-199: external markets ----------

fn approve(c: &mut Pusaka, market: &str) {
    ctx("alice.testnet", NearToken::from_millinear(10), vec![]);
    let _ = c.nft_approve("1".into(), acc(market), None);
}

#[test]
#[should_panic(expected = "Approved")]
fn m1_withdraw_while_approved_fails() {
    let mut c = setup();
    approve(&mut c, "market.testnet");
    withdraw(&mut c, "alice.testnet", &[0]);
}

#[test]
#[should_panic(expected = "Approved")]
fn m1_loan_request_while_approved_fails() {
    let mut c = setup();
    approve(&mut c, "market.testnet");
    ctx("alice.testnet", NearToken::from_yoctonear(0), vec![]);
    c.request_loan("1".into(), NearToken::from_near(1), NearToken::from_near(2), U64(DAY_MS));
}

#[test]
fn m2_revoke_all_unlocks_withdrawals() {
    let mut c = setup();
    approve(&mut c, "market.testnet");
    ctx("alice.testnet", NearToken::from_yoctonear(1), vec![]);
    c.nft_revoke_all("1".into());
    withdraw(&mut c, "alice.testnet", &[0]);
    assert!(c.token_info("1".into()).unwrap().pending);
}

#[test]
fn m3_market_sells_with_payout_to_owner() {
    let mut c = setup();
    approve(&mut c, "market.testnet");
    ctx("market.testnet", NearToken::from_yoctonear(1), vec![]);
    let p = c.nft_transfer_payout(acc("bob.testnet"), "1".into(), Some(1), None, U128(5), Some(10));
    assert_eq!(p.payout.get(&acc("alice.testnet")), Some(&U128(5)));
    assert_eq!(p.payout.len(), 1);
    let t = c.nft_token("1".into()).unwrap();
    assert_eq!(t.owner_id, acc("bob.testnet"));
    // approvals are cleared, so the new owner can withdraw
    withdraw(&mut c, "bob.testnet", &[0]);
}

#[test]
#[should_panic]
fn m4_stale_approval_id_fails() {
    let mut c = setup();
    approve(&mut c, "market.testnet");
    ctx("alice.testnet", NearToken::from_yoctonear(1), vec![]);
    c.nft_revoke_all("1".into());
    approve(&mut c, "market.testnet"); // new approval id 2
    ctx("market.testnet", NearToken::from_yoctonear(1), vec![]);
    let _ = c.nft_transfer_payout(acc("bob.testnet"), "1".into(), Some(1), None, U128(5), None);
}

#[test]
#[should_panic]
fn m4_unapproved_account_cannot_sell() {
    let mut c = setup();
    approve(&mut c, "market.testnet");
    ctx("mallory.testnet", NearToken::from_yoctonear(1), vec![]);
    let _ = c.nft_transfer_payout(acc("mallory.testnet"), "1".into(), Some(0), None, U128(5), None);
}

#[test]
#[should_panic(expected = "Listed")]
fn m5_approve_while_listed_fails() {
    let mut c = setup();
    ctx("alice.testnet", NearToken::from_yoctonear(0), vec![]);
    c.list("1".into(), NearToken::from_near(1), None, None);
    approve(&mut c, "market.testnet");
}

#[test]
#[should_panic(expected = "SignPending")]
fn m5_approve_while_signing_fails() {
    let mut c = setup();
    withdraw(&mut c, "alice.testnet", &[0]);
    approve(&mut c, "market.testnet");
}

#[test]
#[should_panic(expected = "Cooldown")]
fn m6_approve_right_after_a_withdrawal_fails() {
    let mut c = setup();
    withdraw(&mut c, "alice.testnet", &[0]);
    let _ = sign_ok(&mut c, &[0], &[true]);
    approve(&mut c, "market.testnet"); // revoke -> withdraw -> re-approve is blocked
}

#[test]
fn m6_approve_after_cooldown_works() {
    let mut c = setup();
    withdraw(&mut c, "alice.testnet", &[0]);
    let _ = sign_ok(&mut c, &[0], &[true]);
    at("alice.testnet", NearToken::from_millinear(10), APPROVE_COOLDOWN_MS);
    let _ = c.nft_approve("1".into(), acc("market.testnet"), None);
    assert!(c.nft_is_approved("1".into(), acc("market.testnet"), None));
}

// ---------- ERC-20, more EVM chains, Solana, royalties ----------

#[test]
fn x1_erc20_calldata_is_transfer_to_amount() {
    let to = [0xab; 20];
    let d = erc20_transfer_calldata(&to, 1_000_000);
    assert_eq!(hex::encode(&d[..4]), "a9059cbb");
    assert_eq!(d.len(), 4 + 32 + 32);
    assert_eq!(&d[16..36], &to);
    assert_eq!(u128::from_be_bytes(d[52..68].try_into().unwrap()), 1_000_000);
}

#[test]
fn x2_erc20_withdrawal_shares_the_nonce_floor_and_is_logged() {
    let mut c = setup();
    ctx("alice.testnet", NearToken::from_millinear(20), vec![]);
    let usdc = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238".to_string();
    let _ = c.withdraw_eth("1".into(), U64(CHAIN), U64(3), "0x".to_string() + &"ab".repeat(20),
        U128(5_000_000), U128(80_000), U128(1), U128(1), Some(usdc.clone()));
    assert_eq!(c.eth_nonce_floor("1".into(), U64(CHAIN)), U64(4));
    as_contract(vec![PromiseResult::Successful(SIG.as_bytes().to_vec())]);
    let _ = c.on_eth_signed("1".into(), U64(CHAIN), U64(3), U128(5_000_000), "00".into(), Some(usdc.to_ascii_lowercase()));
    let h = c.token_info("1".into()).unwrap().history;
    assert!(matches!(&h.last().unwrap().event, Event::WithdrawErc20 { token, amount, .. } if token == &usdc.to_ascii_lowercase() && amount.0 == 5_000_000));
}

#[test]
fn x3_every_listed_evm_chain_is_accepted() {
    let mut c = setup();
    for (i, chain) in EVM_CHAINS.iter().enumerate() {
        ctx("alice.testnet", NearToken::from_millinear(20), vec![]);
        let _ = c.withdraw_eth("1".into(), U64(*chain), U64(i as u64), "0x".to_string() + &"ab".repeat(20),
            U128(1), U128(21_000), U128(1), U128(1), None);
        assert_eq!(c.eth_nonce_floor("1".into(), U64(*chain)), U64(i as u64 + 1));
        as_contract(vec![PromiseResult::Successful(SIG.as_bytes().to_vec())]);
        let _ = c.on_eth_signed("1".into(), U64(*chain), U64(i as u64), U128(1), "00".into(), None);
    }
}

const SOL_TO: &str = "11111111111111111111111111111112"; // any 32-byte base58 key
const SOL_KEY: &str = "\"ed25519:BDW6jsm1qFKjVac7dsBCUpDJAeXX2Emzn2bjnuYrVKxQ\"";

fn withdraw_sol(c: &mut Pusaka, caller: &str) {
    ctx(caller, NearToken::from_yoctonear(1), vec![]);
    let _ = c.withdraw_sol("1".into(), SOL_TO.into(), U64(1_000_000), SOL_TO.into());
}

#[test]
fn s1_solana_message_layout() {
    let (a, b, h) = ([1u8; 32], [2u8; 32], [3u8; 32]);
    let m = sol_transfer_message(&a, &b, 42, &h);
    assert_eq!(m.len(), 4 + 96 + 32 + 6 + 12);
    assert_eq!(&m[..4], &[1, 0, 1, 3]);
    assert_eq!(&m[4..36], &a);
    assert_eq!(&m[68..100], &[0u8; 32]);
    assert_eq!(&m[100..132], &h);
    assert_eq!(u32::from_le_bytes(m[138..142].try_into().unwrap()), 2);
    assert_eq!(u64::from_le_bytes(m[142..150].try_into().unwrap()), 42);
}

#[test]
fn s2_sol_withdrawal_locks_and_bumps_epoch() {
    let mut c = setup();
    let before = c.token_info("1".into()).unwrap().sign_epoch;
    withdraw_sol(&mut c, "alice.testnet");
    let i = c.token_info("1".into()).unwrap();
    assert!(i.pending);
    assert_eq!(i.sign_epoch, before + 1);
    as_contract(vec![PromiseResult::Successful(SOL_KEY.as_bytes().to_vec())]);
    assert!(matches!(c.on_sol_key("1".into(), [9; 32], U64(1_000_000), [3; 32]), PromiseOrValue::Promise(_)));
    as_contract(vec![PromiseResult::Successful(br#"{"scheme":"Ed25519","signature":[1]}"#.to_vec())]);
    let out = c.on_sol_signed("1".into(), U64(1_000_000), "AA==".into(), "x".into());
    assert!(out.signature.is_some());
    assert!(!c.token_info("1".into()).unwrap().pending);
}

#[test]
fn s3_failed_key_or_self_send_releases_the_lock() {
    let mut c = setup();
    withdraw_sol(&mut c, "alice.testnet");
    as_contract(vec![PromiseResult::Failed]);
    assert!(matches!(c.on_sol_key("1".into(), [9; 32], U64(1), [3; 32]), PromiseOrValue::Value(_)));
    assert!(!c.token_info("1".into()).unwrap().pending);
    withdraw_sol(&mut c, "alice.testnet");
    let own: [u8; 32] = bs58::decode("BDW6jsm1qFKjVac7dsBCUpDJAeXX2Emzn2bjnuYrVKxQ").into_vec().unwrap().try_into().unwrap();
    as_contract(vec![PromiseResult::Successful(SOL_KEY.as_bytes().to_vec())]);
    assert!(matches!(c.on_sol_key("1".into(), own, U64(1), [3; 32]), PromiseOrValue::Value(_)));
    assert!(!c.token_info("1".into()).unwrap().pending);
}

#[test]
#[should_panic(expected = "NotOwner")]
fn s4_non_owner_cannot_sign_solana() {
    let mut c = setup();
    withdraw_sol(&mut c, "bob.testnet");
}

#[test]
#[should_panic(expected = "Listed")]
fn s4_solana_locked_while_listed() {
    let mut c = setup();
    ctx("alice.testnet", NearToken::from_yoctonear(0), vec![]);
    c.list("1".into(), NearToken::from_near(1), None, None);
    withdraw_sol(&mut c, "alice.testnet");
}

#[test]
#[should_panic(expected = "base58")]
fn s5_bad_solana_address_rejected() {
    let mut c = setup();
    ctx("alice.testnet", NearToken::from_yoctonear(1), vec![]);
    let _ = c.withdraw_sol("1".into(), "0xdead".into(), U64(1), SOL_TO.into());
}

/// alice mints, sells to bob; bob's resale pays alice the royalty.
fn resold() -> Pusaka {
    let mut c = setup();
    ctx("alice.testnet", NearToken::from_yoctonear(0), vec![]);
    c.list("1".into(), NearToken::from_near(1), None, None);
    let e = c.token_info("1".into()).unwrap().sign_epoch;
    ctx("bob.testnet", NearToken::from_near(1), vec![]);
    c.buy("1".into(), e);
    c
}

#[test]
fn y1_creator_recorded_and_no_royalty_on_first_sale() {
    let c = resold();
    let h = c.token_info("1".into()).unwrap().history;
    assert!(!h.iter().any(|e| matches!(e.event, Event::Royalty { .. })));
    assert_eq!(c.creator(&"1".to_string()), Some(acc("alice.testnet")));
}

#[test]
fn y2_resale_pays_creator_royalty() {
    let mut c = resold();
    ctx("bob.testnet", NearToken::from_yoctonear(0), vec![]);
    c.list("1".into(), NearToken::from_near(2), None, None);
    let e = c.token_info("1".into()).unwrap().sign_epoch;
    ctx("carol.testnet", NearToken::from_near(2), vec![]);
    c.buy("1".into(), e);
    let h = c.token_info("1".into()).unwrap().history;
    let r = h.iter().find_map(|e| match &e.event { Event::Royalty { creator, amount } => Some((creator.clone(), *amount)), _ => None });
    assert_eq!(r, Some((acc("alice.testnet"), NearToken::from_millinear(50))));
}

#[test]
fn y3_nep199_payout_includes_creator() {
    let c = resold();
    let p = c.nft_payout("1".into(), U128(10_000), Some(5));
    assert_eq!(p.payout.get(&acc("bob.testnet")), Some(&U128(9_750)));
    assert_eq!(p.payout.get(&acc("alice.testnet")), Some(&U128(250)));
}

#[test]
#[should_panic(expected = "max_len_payout")]
fn y3_payout_respects_max_len() {
    let c = resold();
    let _ = c.nft_payout("1".into(), U128(10_000), Some(1));
}

// ---------- each Pusaka is a NEAR account ----------

fn withdraw_near(c: &mut Pusaka, caller: &str, nonce: u64) {
    ctx(caller, NearToken::from_millinear(10), vec![]);
    let _ = c.withdraw_near("1".into(), acc("bob.testnet"), NearToken::from_millinear(100), U64(nonce), SOL_TO.into());
}

#[test]
fn a1_near_tx_layout() {
    let pk = [7u8; 32];
    let t = near_transfer_tx(&pk, 9, &acc("bob.testnet"), &[3; 32], 5);
    assert_eq!(u32::from_le_bytes(t[..4].try_into().unwrap()), 64);
    assert_eq!(&t[4..68], hex::encode(pk).as_bytes());
    assert_eq!(t[68], 0);
    assert_eq!(&t[69..101], &pk);
    assert_eq!(u64::from_le_bytes(t[101..109].try_into().unwrap()), 9);
    let r = 109 + 4 + "bob.testnet".len();
    assert_eq!(&t[113..r], b"bob.testnet");
    assert_eq!(&t[r + 32..r + 37], &[1, 0, 0, 0, 3]);
    assert_eq!(u128::from_le_bytes(t[r + 37..].try_into().unwrap()), 5);
}

#[test]
fn a2_near_floor_recorded_before_signing_and_never_drops() {
    let mut c = setup();
    withdraw_near(&mut c, "alice.testnet", 50);
    assert!(c.token_info("1".into()).unwrap().pending);
    assert_eq!(c.near_nonce_floor("1".into()), U64(50));
    as_contract(vec![PromiseResult::Successful(SOL_KEY.as_bytes().to_vec())]);
    assert!(matches!(c.on_near_key("1".into(), acc("bob.testnet"), NearToken::from_millinear(100), U64(50), [3; 32]), PromiseOrValue::Promise(_)));
    as_contract(vec![PromiseResult::Successful(br#"{"scheme":"Ed25519","signature":[1]}"#.to_vec())]);
    let _ = c.on_near_signed("1".into(), U64(50), NearToken::from_millinear(100), "".into(), "".into());
    withdraw_near(&mut c, "alice.testnet", 10);
    assert_eq!(c.near_nonce_floor("1".into()), U64(50));
}

#[test]
fn a3_failed_key_releases_the_lock() {
    let mut c = setup();
    withdraw_near(&mut c, "alice.testnet", 1);
    as_contract(vec![PromiseResult::Failed]);
    assert!(matches!(c.on_near_key("1".into(), acc("bob.testnet"), NearToken::from_millinear(1), U64(1), [3; 32]), PromiseOrValue::Value(_)));
    assert!(!c.token_info("1".into()).unwrap().pending);
}

#[test]
#[should_panic(expected = "NotOwner")]
fn a4_non_owner_cannot_move_the_near_account() {
    let mut c = setup();
    withdraw_near(&mut c, "bob.testnet", 1);
}

/// The sale-in-the-middle-of-a-payout case: the seller starts a payout, a buyer tries to buy
/// while it is in flight, then again with the epoch they saw before it.
#[test]
#[should_panic(expected = "NotListed")]
fn a5_sale_during_payout_is_impossible() {
    let mut c = setup();
    withdraw_near(&mut c, "alice.testnet", 1); // payout in flight: pending, so it can't be listed
    ctx("bob.testnet", NearToken::from_near(1), vec![]);
    c.buy("1".into(), 0);
}

#[test]
#[should_panic(expected = "StateChanged")]
fn a5_buyer_with_pre_payout_view_cannot_buy() {
    let mut c = setup();
    let seen = c.token_info("1".into()).unwrap().sign_epoch;
    withdraw_near(&mut c, "alice.testnet", 1);
    as_contract(vec![PromiseResult::Failed]);
    let _ = c.on_near_key("1".into(), acc("bob.testnet"), NearToken::from_millinear(1), U64(1), [3; 32]);
    ctx("alice.testnet", NearToken::from_yoctonear(0), vec![]);
    c.list("1".into(), NearToken::from_near(1), None, None);
    ctx("bob.testnet", NearToken::from_near(1), vec![]);
    c.buy("1".into(), seen); // a signature was requested after bob looked
}

// ---------- sealed letter ----------

fn extra(c: &Pusaka) -> Value {
    serde_json::from_str(&c.nft_token("1".into()).unwrap().metadata.unwrap().extra.unwrap()).unwrap()
}

#[test]
fn h1_letter_is_stored_kept_on_sale_and_clearable() {
    let mut c = setup();
    ctx("alice.testnet", NearToken::from_millinear(10), vec![]);
    c.set_letter("1".into(), "v1:QUJD".into(), None);
    assert_eq!(extra(&c)["letter"], "v1:QUJD");
    assert_eq!(extra(&c)["creator"], "alice.testnet");
    ctx("alice.testnet", NearToken::from_yoctonear(1), vec![]);
    c.nft_transfer(acc("bob.testnet"), "1".into(), None, None);
    assert_eq!(extra(&c)["letter"], "v1:QUJD"); // travels with the NFT
    ctx("bob.testnet", NearToken::from_millinear(10), vec![]);
    c.set_letter("1".into(), "".into(), None);
    assert!(extra(&c).get("letter").is_none());
}

#[test]
#[should_panic(expected = "NotOwner")]
fn h2_old_owner_cannot_rewrite_the_letter() {
    let mut c = setup();
    ctx("alice.testnet", NearToken::from_yoctonear(1), vec![]);
    c.nft_transfer(acc("bob.testnet"), "1".into(), None, None);
    ctx("alice.testnet", NearToken::from_millinear(10), vec![]);
    c.set_letter("1".into(), "v1:QUJD".into(), None);
}

#[test]
#[should_panic(expected = "Listed")]
fn h3_letter_frozen_while_listed() {
    let mut c = setup();
    ctx("alice.testnet", NearToken::from_yoctonear(0), vec![]);
    c.list("1".into(), NearToken::from_near(1), None, None);
    ctx("alice.testnet", NearToken::from_millinear(10), vec![]);
    c.set_letter("1".into(), "v1:QUJD".into(), None);
}

#[test]
#[should_panic(expected = "sealed letter")]
fn h4_oversized_letter_rejected() {
    let mut c = setup();
    ctx("alice.testnet", NearToken::from_millinear(10), vec![]);
    c.set_letter("1".into(), "A".repeat(2001), None);
}

// ---------- confidential letters: NEAR MPC CKD (domain 2) ----------

const APP_PK: &str = "bls12381g1:67UMHEnqJCvuBv44ecVtcoE7ES2vNvAnvh72DhEkvChw1cjQ7L4Ybt8KJdHqSdXoNz";

/// The one request letter_key sent to the MPC: (method, args json).
fn ckd_request() -> (String, Value) {
    let receipts = near_sdk::test_utils::get_created_receipts();
    let r = receipts.iter().find(|r| r.receiver_id.as_str() == "v1.signer-prod.testnet").expect("a receipt to the MPC");
    match &r.actions[0] {
        near_sdk::mock::MockAction::FunctionCallWeight { method_name, args, attached_deposit, .. } => {
            assert_eq!(*attached_deposit, NearToken::from_yoctonear(1));
            (String::from_utf8(method_name.clone()).unwrap(), serde_json::from_slice(args).unwrap())
        }
        a => panic!("unexpected action {a:?}"),
    }
}

#[test]
fn k1_write_key_is_bound_to_token_and_current_owner() {
    let mut c = setup();
    ctx("alice.testnet", NearToken::from_yoctonear(1), vec![]);
    let _ = c.letter_key("1".into(), APP_PK.into(), Some("n1".into()));
    let (method, args) = ckd_request();
    assert_eq!(method, "request_app_private_key");
    assert_eq!(args["request"]["derivation_path"], "letter:1:alice.testnet:n1");
    assert_eq!(args["request"]["domain_id"], 2);
    assert_eq!(args["request"]["app_public_key"]["AppPublicKey"], APP_PK);
}

#[test]
fn k2_next_owner_reads_with_the_stored_path_and_writes_under_their_own() {
    let mut c = setup();
    ctx("alice.testnet", NearToken::from_millinear(10), vec![]);
    c.set_letter("1".into(), "ckd1:QUJD".into(), Some("letter:1:alice.testnet:n1".into()));
    assert_eq!(extra(&c)["letter_path"], "letter:1:alice.testnet:n1");
    ctx("alice.testnet", NearToken::from_yoctonear(1), vec![]);
    c.nft_transfer(acc("bob.testnet"), "1".into(), None, None);
    // bob reads alice's letter: same path, so the same key
    ctx("bob.testnet", NearToken::from_yoctonear(1), vec![]);
    let _ = c.letter_key("1".into(), APP_PK.into(), None);
    assert_eq!(ckd_request().1["request"]["derivation_path"], "letter:1:alice.testnet:n1");
    // bob's new letter gets a path alice can never ask for
    ctx("bob.testnet", NearToken::from_yoctonear(1), vec![]);
    let _ = c.letter_key("1".into(), APP_PK.into(), Some("n2".into()));
    assert_eq!(ckd_request().1["request"]["derivation_path"], "letter:1:bob.testnet:n2");
    ctx("bob.testnet", NearToken::from_millinear(10), vec![]);
    c.set_letter("1".into(), "ckd1:REVG".into(), Some("letter:1:bob.testnet:n2".into()));
    assert_eq!(extra(&c)["letter_path"], "letter:1:bob.testnet:n2");
    // a server letter replaces it and drops the path
    ctx("bob.testnet", NearToken::from_millinear(10), vec![]);
    c.set_letter("1".into(), "v1:QUJD".into(), None);
    assert!(extra(&c).get("letter_path").is_none());
}

#[test]
#[should_panic(expected = "NotOwner")]
fn k3_seller_cannot_get_any_key_after_the_sale() {
    let mut c = setup();
    ctx("alice.testnet", NearToken::from_millinear(10), vec![]);
    c.set_letter("1".into(), "ckd1:QUJD".into(), Some("letter:1:alice.testnet:n1".into()));
    ctx("alice.testnet", NearToken::from_yoctonear(1), vec![]);
    c.nft_transfer(acc("bob.testnet"), "1".into(), None, None);
    ctx("alice.testnet", NearToken::from_yoctonear(1), vec![]);
    let _ = c.letter_key("1".into(), APP_PK.into(), None);
}

#[test]
#[should_panic(expected = "ckd1 letters need the path letter_key gave this owner")]
fn k4_owner_cannot_store_a_letter_under_someone_elses_path() {
    // otherwise bob could make the stored path one alice still holds the key for
    let mut c = setup();
    ctx("alice.testnet", NearToken::from_yoctonear(1), vec![]);
    c.nft_transfer(acc("bob.testnet"), "1".into(), None, None);
    ctx("bob.testnet", NearToken::from_millinear(10), vec![]);
    c.set_letter("1".into(), "ckd1:QUJD".into(), Some("letter:1:alice.testnet:n1".into()));
}

#[test]
#[should_panic(expected = "ckd1 letters need the path letter_key gave this owner")]
fn k4_path_of_another_token_rejected() {
    let mut c = setup();
    ctx("alice.testnet", NearToken::from_millinear(10), vec![]);
    c.set_letter("1".into(), "ckd1:QUJD".into(), Some("letter:12:alice.testnet:n1".into()));
}

#[test]
#[should_panic(expected = "NoCkdLetter")]
fn k5_read_key_needs_a_ckd_letter() {
    let mut c = setup();
    ctx("alice.testnet", NearToken::from_millinear(10), vec![]);
    c.set_letter("1".into(), "v1:QUJD".into(), None);
    ctx("alice.testnet", NearToken::from_yoctonear(1), vec![]);
    let _ = c.letter_key("1".into(), APP_PK.into(), None);
}

#[test]
#[should_panic(expected = "write_nonce")]
fn k6_nonce_cannot_smuggle_path_separators() {
    let mut c = setup();
    ctx("alice.testnet", NearToken::from_yoctonear(1), vec![]);
    let _ = c.letter_key("1".into(), APP_PK.into(), Some("x:bob.testnet".into()));
}

#[test]
#[should_panic(expected = "app_public_key")]
fn k6_app_key_must_be_g1() {
    let mut c = setup();
    ctx("alice.testnet", NearToken::from_yoctonear(1), vec![]);
    let _ = c.letter_key("1".into(), "ed25519:abc".into(), Some("n1".into()));
}

#[test]
#[should_panic(expected = "attach 1 yoctoNEAR")]
fn k6_needs_a_deposit() {
    let mut c = setup();
    ctx("alice.testnet", NearToken::from_yoctonear(0), vec![]);
    let _ = c.letter_key("1".into(), APP_PK.into(), Some("n1".into()));
}

#[test]
#[should_panic(expected = "path is only for ckd1 letters")]
fn k7_server_letter_takes_no_path() {
    let mut c = setup();
    ctx("alice.testnet", NearToken::from_millinear(10), vec![]);
    c.set_letter("1".into(), "v1:QUJD".into(), Some("letter:1:alice.testnet:n1".into()));
}

#[test]
#[should_panic(expected = "value_wei must be > 0")]
fn e3_zero_value_evm_withdrawal_rejected() {
    // seen live: the UI rounded 0.0000001 USDC to 0 and the MPC signed a no-op
    let mut c = setup();
    ctx("alice.testnet", NearToken::from_millinear(20), vec![]);
    let _ = c.withdraw_eth("1".into(), U64(EVM_CHAINS[0]), U64(0), "0x2af9ED1D3fe79c9a61518c9bFFA71bc3Fa1C3b63".into(),
        U128(0), U128(21_000), U128(1), U128(1), None);
}

#[test]
fn o1_every_withdrawal_carries_its_pusaka_in_op_return() {
    let pkh = [7u8; 20];
    let memo = b"pusaka:1";
    let with = btc::build_spend(&pkh, &[(TXID.into(), 0, 100_000)], btc::p2wpkh_script(&[9u8; 20]), 10_000, 500, memo);
    let hex = btc::unsigned_hex(&with.tx);
    // OP_RETURN, push 8 bytes, "pusaka:1", after the payment and change outputs (value 0)
    let op_return = format!("00000000000000000a6a08{}", hex::encode(memo));
    assert!(hex.contains(&op_return), "{hex}");
    // the signed message covers it: same inputs without the memo give different sighashes
    let without = btc::build_spend(&pkh, &[(TXID.into(), 0, 100_000)], btc::p2wpkh_script(&[9u8; 20]), 10_000, 500, b"");
    assert_ne!(with.sighashes, without.sighashes);
    assert!(!btc::unsigned_hex(&without.tx).contains("6a08"));
}

#[test]
#[should_panic(expected = "memo too long")]
fn o2_memo_fits_one_push() {
    let _ = btc::build_spend(&[7u8; 20], &[(TXID.into(), 0, 100_000)], btc::p2wpkh_script(&[9u8; 20]), 10_000, 500, &[b'x'; 76]);
}

// ---------- verified USDC: NEAR MPC foreign-transaction verification (domain 3) ----------

#[test]
fn u1_payload_hash_matches_what_the_mpc_signed_live() {
    // A Base Sepolia USDC Transfer, verified by v1.signer-prod.testnet on 4 Nov 2026
    // (tx BKeg9y2vhjfYKggRj7Y5PLiFgPTsxHmE7havcxaKchk4): it answered this payload_hash.
    ctx("alice.testnet", NearToken::from_yoctonear(0), vec![]);
    let t = |s: &str| usdc::hex32(s, "t");
    let log = usdc::Log {
        tx: t("0xb7deb81a095bbaeff6a98b5fa40fa745db59ea3da87697790a02efdd5c0b5ee1"),
        log_index: 2,
        tx_index: 3,
        block_hash: t("0x665a4d5b935791082e35ef0c73378064e605f429d70b7065d21ef4d6ca5064a3"),
        block_number: 54193413,
        address: hex::decode("036cbd53842c5426634e7929541ec2318f3dcf7e").unwrap().try_into().unwrap(),
        data: "0x00000000000000000000000000000000000000000000000000000000000003e8".into(),
        topics: vec![
            t("0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"),
            t("0x0000000000000000000000002e0c37b721124e2558baf75f6f8e6cc9f14aec29"),
            t("0x0000000000000000000000002e0c37b721124e2558baf75f6f8e6cc9f14aec29"),
        ],
    };
    assert_eq!(hex::encode(usdc::payload_hash(6, &log)), "9c1b7c49425dd65d55425055037697390b05894776026eea393a8b27fdcbb497");
    assert_eq!(usdc::amount(&log.data), 1000);
}

fn evm_of_token() -> String { format!("{:0>64}", hex::encode(btc::evm_address_of_mpc_key(MPC_KEY))) }

fn prove_usdc(c: &mut Pusaka, to_topic: &str, chain: u64) {
    ctx("bob.testnet", NearToken::from_millinear(5), vec![]);
    let _ = c.prove_usdc_deposit("1".into(), U64(chain), format!("0x{}", "ab".repeat(32)), U64(4), U64(0),
        format!("0x{}", "cd".repeat(32)), U64(100), format!("0x{:0>64}", "f4240"),
        vec![format!("0x{}", usdc::TRANSFER_TOPIC), format!("0x{}", "11".repeat(32)), format!("0x{to_topic}")]);
}

#[test]
fn u2_mint_records_the_evm_address_of_the_same_key() {
    let c = setup();
    assert_eq!(c.evm_address("1".into()).unwrap(), format!("0x{}", hex::encode(btc::evm_address_of_mpc_key(MPC_KEY))));
}

#[test]
fn u3_proof_asks_the_mpc_to_confirm_exactly_these_facts() {
    let mut c = setup();
    prove_usdc(&mut c, &evm_of_token(), usdc::CHAINS[0].0);
    let (method, args) = ckd_request();
    assert_eq!(method, "verify_foreign_transaction");
    let r = &args["request"];
    assert_eq!(r["domain_id"], 3);
    let chain = usdc::CHAINS[0].1;
    assert_eq!(r["request"][chain]["tx_id"], "ab".repeat(32));
    assert_eq!(r["request"][chain]["extractors"][0]["Log"]["log_index"], 4);
    assert_eq!(r["request"][chain]["finality"], "Finalized");
    assert_eq!(r["expected_payload_hash"].as_str().unwrap().len(), 64);
}

#[test]
#[should_panic(expected = "doesn't pay this Pusaka")]
fn u4_transfer_to_someone_else_rejected() {
    let mut c = setup();
    prove_usdc(&mut c, &"22".repeat(32), usdc::CHAINS[0].0);
}

#[test]
#[should_panic(expected = "not verifiable by NEAR MPC")]
fn u4_chain_the_mpc_cannot_read_rejected() {
    let mut c = setup();
    prove_usdc(&mut c, &evm_of_token(), 11155111); // Sepolia L1: not in the MPC's foreign chains
}

fn mpc_answers(c: &mut Pusaka, payload_hash: &str) -> bool {
    as_contract(vec![PromiseResult::Successful(format!(r#"{{"payload_hash":"{payload_hash}","signature":{{}}}}"#).into_bytes())]);
    c.on_usdc_proven("1".into(), U64(usdc::CHAINS[0].0), "ab".repeat(32), U64(4), U128(1_000_000), "aa".repeat(32), acc("bob.testnet"))
}

#[test]
fn u5_only_an_attested_deposit_counts_and_only_once() {
    let mut c = setup();
    assert!(!mpc_answers(&mut c, &"bb".repeat(32))); // the MPC saw something else
    assert_eq!(c.usdc_info("1".into())[0]["verified"], "0");
    assert!(mpc_answers(&mut c, &"aa".repeat(32)));
    assert!(!mpc_answers(&mut c, &"aa".repeat(32))); // same log again
    let info = &c.usdc_info("1".into())[0];
    assert_eq!(info["verified"], "1000000");
    assert_eq!(info["deposits"].as_array().unwrap().len(), 1);
}

#[test]
fn u6_signing_usdc_out_lowers_verified_before_the_signature_exists() {
    let mut c = setup();
    assert!(mpc_answers(&mut c, &"aa".repeat(32)));
    let (chain, _, _, usdc_addr) = usdc::CHAINS[0];
    ctx("alice.testnet", NearToken::from_millinear(20), vec![]);
    let _ = c.withdraw_eth("1".into(), U64(chain), U64(0), "0x2af9ED1D3fe79c9a61518c9bFFA71bc3Fa1C3b63".into(),
        U128(400_000), U128(60_000), U128(1), U128(1), Some(format!("0x{}", usdc_addr.to_uppercase())));
    let info = &c.usdc_info("1".into())[0];
    assert_eq!(info["signed_out"], "400000");
    assert_eq!(info["verified"], "600000");
}

#[test]
fn u6_other_tokens_dont_touch_the_usdc_count() {
    let mut c = setup();
    assert!(mpc_answers(&mut c, &"aa".repeat(32)));
    ctx("alice.testnet", NearToken::from_millinear(20), vec![]);
    let _ = c.withdraw_eth("1".into(), U64(usdc::CHAINS[0].0), U64(0), "0x2af9ED1D3fe79c9a61518c9bFFA71bc3Fa1C3b63".into(),
        U128(400_000), U128(60_000), U128(1), U128(1), Some(format!("0x{}", "12".repeat(20))));
    assert_eq!(c.usdc_info("1".into())[0]["verified"], "1000000");
}
