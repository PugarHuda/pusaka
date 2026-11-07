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
    assert!(empty.contains("data-fill=\"0\"") && !empty.contains("url(#l)"), "an empty vessel with no verified BTC");
    assert!(!empty.contains("id=\"seal\""), "no seal when unlocked");

    proven(&mut c, b"true", 0, 1_000_000); // ~0.01 BTC verified
    let full = svg_of(&c);
    assert!(full.contains("data-fill=\"1000\"") && full.contains("url(#l)"), "the vessel full at ~2^20 sats");

    ctx("alice.testnet", NearToken::from_yoctonear(0), vec![]);
    c.list("1".into(), NearToken::from_near(5), None, None);
    assert!(svg_of(&c).contains("id=\"seal\""), "seal while listed");
    let desc = c.nft_token("1".into()).unwrap().metadata.unwrap().description.unwrap();
    assert!(desc.contains("0.01000000 BTC verified") && desc.contains("Locked"), "{desc}");
}

#[test]
fn n2b_vessel_fill_scale() {
    use crate::art::fill_milli;
    assert_eq!(fill_milli(0), 0);
    assert_eq!(fill_milli(1), 120, "any proven deposit shows");
    assert_eq!(fill_milli(10_000), 700);
    assert_eq!(fill_milli(1_000_000), 1000);
    assert_eq!(fill_milli(u64::MAX - 1), 1000);
}

#[test]
fn n2c_image_shows_everything_inside() {
    let mut c = setup();
    let svg = svg_of(&c);
    assert!(!svg.contains("id=\"letter\"") && !svg.contains("id=\"heir\"") && svg.contains("data-usdc=\"0\""));

    // verified USDC: a blue layer, also with no BTC under it
    near_sdk::env::storage_write(format!("up:1:{}", crate::usdc::CHAINS[0].0).as_bytes(), &near_sdk::borsh::to_vec(&2_500_000u128).unwrap());
    let svg = svg_of(&c);
    assert!(svg.contains("url(#u)") && !svg.contains("url(#l)") && !svg.contains("data-usdc=\"0\""), "USDC layer");
    let d = c.nft_token("1".into()).unwrap().metadata.unwrap().description.unwrap();
    assert!(d.contains("2.500000 USDC verified"), "{d}");

    ctx("alice.testnet", NearToken::from_millinear(10), vec![]);
    c.set_letter("1".into(), "v1:QUJD".into(), None);
    assert!(svg_of(&c).contains("id=\"letter\""), "letter inside");

    ctx("alice.testnet", NearToken::from_millinear(10), vec![]);
    c.set_heir("1".into(), Some(acc("carol.testnet")), U64(SILENCE));
    let svg = svg_of(&c);
    assert!(svg.contains("id=\"heir\"") && !svg.contains("id=\"seal\""), "heir sprout, not locked");
    let d = c.nft_token("1".into()).unwrap().metadata.unwrap().description.unwrap();
    assert!(d.contains("sealed letter") && d.contains("named heir"), "{d}");

    // the heir travels? no: a transfer clears it, and the picture follows
    ctx("alice.testnet", NearToken::from_yoctonear(1), vec![]);
    c.nft_transfer(acc("bob.testnet"), "1".into(), None, None);
    let svg = svg_of(&c);
    assert!(!svg.contains("id=\"heir\"") && svg.contains("id=\"letter\""), "heir cleared by the transfer, letter kept");
}

#[test]
fn n2d_usdc_layer_scale() {
    use crate::art::usdc_milli;
    assert_eq!(usdc_milli(0), 0);
    assert_eq!(usdc_milli(1), 60, "any verified USDC shows");
    assert_eq!(usdc_milli(1_000_000), 175); // 1 USDC = 100 cents: 7 bits
    assert_eq!(usdc_milli(u128::MAX), 500, "never more than half the vessel");
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

/// A one-input, one-output transaction spending `prev:vout` (display order) and paying `value` to token 1.
fn tx_to_token_1(c: &Pusaka, prev: &str, vout: u32, value: u64) -> String {
    let pk = c.btc_keys.get("1").unwrap().clone();
    let script = btc::p2wpkh_script(&btc::hash160(&pk));
    let mut prev_internal = hex::decode(prev).unwrap();
    prev_internal.reverse();
    let mut tx = vec![2, 0, 0, 0, 1];
    tx.extend(prev_internal);
    tx.extend(vout.to_le_bytes());
    tx.extend([0, 0xff, 0xff, 0xff, 0xff, 1]);
    tx.extend(value.to_le_bytes());
    tx.push(script.len() as u8);
    tx.extend(script);
    tx.extend([0, 0, 0, 0]);
    hex::encode(tx)
}

/// Withdraws `amount` of one 10,000-sat input with a 300-sat fee; returns the unsigned spend the contract built.
fn small_withdrawal(c: &mut Pusaka, amount: u64) -> String {
    ctx("alice.testnet", NearToken::from_millinear(20), vec![]);
    let to = "0014".to_string() + &"11".repeat(20);
    let u = Utxo { txid: TXID.into(), vout: 0, value: U64(10_000) };
    let _ = c.withdraw("1".into(), vec![u], to.clone(), U64(amount), U64(300));
    let pk = c.btc_keys.get("1").unwrap().clone();
    let spend = btc::build_spend(&btc::hash160(&pk), &[(TXID.into(), 0, 10_000)], hex::decode(to).unwrap(), amount, 300, b"pusaka:1");
    btc::unsigned_hex(&spend.tx)
}

fn prove(c: &mut Pusaka, tx: String, vout: u32) {
    ctx("bob.testnet", NearToken::from_millinear(20), vec![]);
    let _ = c.prove_deposit("1".into(), tx, vout, "00".repeat(32), U64(1), vec![], "00".repeat(32), vec![]);
}

#[test]
fn ch1_a_withdrawals_change_below_the_deposit_minimum_is_provable() {
    // withdrawing 1,000 of 10,000 sats leaves 8,700: it must still count, or the rest of the BTC is stranded
    let mut c = setup();
    let tx = small_withdrawal(&mut c, 1_000);
    prove(&mut c, tx, 1);
}

#[test]
#[should_panic(expected = "below the minimum")]
fn ch2_the_same_small_amount_from_any_other_transaction_is_dust() {
    // spends an outpoint the contract signed, but the contract didn't build it: the holder's own wallet could
    let mut c = setup();
    let _ = small_withdrawal(&mut c, 1_000);
    let tx = tx_to_token_1(&c, TXID, 0, 8_700);
    prove(&mut c, tx, 0);
}

#[test]
#[should_panic(expected = "below the minimum")]
fn ch3_change_below_its_own_floor_is_rejected() {
    let mut c = setup();
    let tx = small_withdrawal(&mut c, 8_701); // change 999
    prove(&mut c, tx, 1);
}

#[test]
#[should_panic(expected = "below the minimum")]
fn ch4_another_tokens_change_does_not_count_here() {
    let mut c = setup();
    let tx = small_withdrawal(&mut c, 1_000);
    ctx("pusaka.testnet", NearToken::from_yoctonear(0), vec![]);
    let mut id = btc::sha256d(&hex::decode(&tx).unwrap());
    id.reverse();
    env::storage_write(format!("ch:{}", hex::encode(id)).as_bytes(), b"2");
    prove(&mut c, tx, 1);
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
    assert!(matches!(c.on_near_key("1".into(), acc("bob.testnet"), NearToken::from_millinear(100), U64(50), [3; 32], NearTx::Transfer), PromiseOrValue::Promise(_)));
    as_contract(vec![PromiseResult::Successful(br#"{"scheme":"Ed25519","signature":[1]}"#.to_vec())]);
    let _ = c.on_near_signed("1".into(), U64(50), NearToken::from_millinear(100), "".into(), "".into(), NearTx::Transfer);
    withdraw_near(&mut c, "alice.testnet", 10);
    assert_eq!(c.near_nonce_floor("1".into()), U64(50));
}

#[test]
fn a3_failed_key_releases_the_lock() {
    let mut c = setup();
    withdraw_near(&mut c, "alice.testnet", 1);
    as_contract(vec![PromiseResult::Failed]);
    assert!(matches!(c.on_near_key("1".into(), acc("bob.testnet"), NearToken::from_millinear(1), U64(1), [3; 32], NearTx::Transfer), PromiseOrValue::Value(_)));
    assert!(!c.token_info("1".into()).unwrap().pending);
}

#[test]
#[should_panic(expected = "NotOwner")]
fn a4_non_owner_cannot_move_the_near_account() {
    let mut c = setup();
    withdraw_near(&mut c, "bob.testnet", 1);
}

#[cfg(not(feature = "mainnet"))]
const POOL: &str = "legends.pool.f863973.m0";
#[cfg(feature = "mainnet")]
const POOL: &str = "legends.poolv1.near";

fn stake(c: &mut Pusaka, caller: &str, pool: &str, action: &str, millinear: u128) {
    ctx(caller, NearToken::from_millinear(10), vec![]);
    let _ = c.stake_near("1".into(), acc(pool), action.into(), NearToken::from_millinear(millinear), U64(7), SOL_TO.into());
}

/// Method name, args, gas and deposit of a FunctionCall tx built by near_call_tx, read back from its bytes.
fn call_parts(t: &[u8], receiver: &str) -> (String, String, u64, u128) {
    let mut i = 109 + 4 + receiver.len() + 32 + 4;
    assert_eq!(t[i], 2, "Action::FunctionCall");
    i += 1;
    let rd = |i: &mut usize| { let n = u32::from_le_bytes(t[*i..*i + 4].try_into().unwrap()) as usize; *i += 4 + n; String::from_utf8(t[*i - n..*i].to_vec()).unwrap() };
    let method = rd(&mut i);
    let args = rd(&mut i);
    let gas = u64::from_le_bytes(t[i..i + 8].try_into().unwrap());
    let deposit = u128::from_le_bytes(t[i + 8..i + 24].try_into().unwrap());
    assert_eq!(t.len(), i + 24);
    (method, args, gas, deposit)
}

#[test]
fn sk1_stake_tx_layout_for_each_action() {
    let pk = [7u8; 32];
    let pool = acc(POOL);
    let st = near_stake_tx(&pk, 9, &pool, "stake", 5, &[3; 32]);
    assert_eq!(&st[113..113 + POOL.len()], POOL.as_bytes());
    assert_eq!(call_parts(&st, POOL), ("deposit_and_stake".into(), "{}".into(), 125_000_000_000_000, 5));
    assert_eq!(call_parts(&near_stake_tx(&pk, 9, &pool, "unstake", 5, &[3; 32]), POOL), ("unstake".into(), r#"{"amount":"5"}"#.into(), 125_000_000_000_000, 0));
    assert_eq!(call_parts(&near_stake_tx(&pk, 9, &pool, "withdraw", 5, &[3; 32]), POOL), ("withdraw_all".into(), "{}".into(), 125_000_000_000_000, 0));
    // the nBTC transfer still builds byte for byte the same through the shared builder
    let ft = near_ft_transfer_tx(&pk, 9, &acc(NBTC), &acc("bob.testnet"), 1000, &[3; 32]);
    assert_eq!(call_parts(&ft, NBTC), ("ft_transfer".into(), r#"{"receiver_id":"bob.testnet","amount":"1000"}"#.into(), 30_000_000_000_000, 1));
}

#[test]
fn sk2_stake_records_the_pool_bumps_the_epoch_and_logs_it() {
    let mut c = setup();
    let seen = c.token_info("1".into()).unwrap().sign_epoch;
    stake(&mut c, "alice.testnet", POOL, "stake", 500);
    let info = c.token_info("1".into()).unwrap();
    assert!(info.pending, "locked until the MPC answers");
    assert!(info.sign_epoch > seen, "a buyer who looked before must look again");
    assert_eq!(c.staking_pools_of("1".into()), vec![acc(POOL)]);
    assert_eq!(c.near_nonce_floor("1".into()), U64(7));
    as_contract(vec![PromiseResult::Successful(SOL_KEY.as_bytes().to_vec())]);
    let kind = NearTx::Stake { pool: acc(POOL), action: "stake".into() };
    assert!(matches!(c.on_near_key("1".into(), acc(POOL), NearToken::from_millinear(500), U64(7), [3; 32], kind), PromiseOrValue::Promise(_)));
    as_contract(vec![PromiseResult::Successful(br#"{"scheme":"Ed25519","signature":[1]}"#.to_vec())]);
    let kind = NearTx::Stake { pool: acc(POOL), action: "stake".into() };
    let _ = c.on_near_signed("1".into(), U64(7), NearToken::from_millinear(500), "".into(), "".into(), kind);
    let info = c.token_info("1".into()).unwrap();
    assert!(!info.pending);
    assert!(matches!(&info.history.last().unwrap().event, Event::Staking { action, signed: true, .. } if action == "stake"));
}

#[test]
#[should_panic(expected = "pool must be a staking pool")]
fn sk3_only_pools_from_the_official_factory() {
    let mut c = setup();
    stake(&mut c, "alice.testnet", "drain.testnet", "stake", 500);
}

#[test]
#[should_panic(expected = "pool must be a staking pool")]
fn sk3_the_factory_itself_is_not_a_pool() {
    let mut c = setup();
    stake(&mut c, "alice.testnet", &POOL_SUFFIX[1..], "stake", 500);
}

#[test]
#[should_panic(expected = "action: stake, unstake or withdraw")]
fn sk4_only_the_three_pool_calls() {
    let mut c = setup();
    stake(&mut c, "alice.testnet", POOL, "unstake_all_and_send_to_me", 500);
}

#[test]
#[should_panic(expected = "NotOwner")]
fn sk5_only_the_holder_stakes() {
    let mut c = setup();
    stake(&mut c, "bob.testnet", POOL, "stake", 500);
}

#[test]
#[should_panic(expected = "amount must be > 0")]
fn sk6_zero_stake_rejected() {
    let mut c = setup();
    stake(&mut c, "alice.testnet", POOL, "stake", 0);
}

#[test]
fn sk6_withdraw_needs_no_amount() {
    let mut c = setup();
    stake(&mut c, "alice.testnet", POOL, "withdraw", 0);
    assert!(c.token_info("1".into()).unwrap().pending);
}

#[test]
#[should_panic(expected = "already uses 3 pools")]
fn sk7_at_most_three_pools() {
    let mut c = setup();
    for (i, p) in ["a", "b", "c", "d"].iter().map(|x| format!("{x}{POOL_SUFFIX}")).enumerate() {
        if i > 0 {
            as_contract(vec![PromiseResult::Failed]);
            let _ = c.on_near_key("1".into(), acc(&p), NearToken::from_millinear(1), U64(7), [3; 32], NearTx::Transfer);
        }
        stake(&mut c, "alice.testnet", &p, "stake", 1);
    }
}

#[test]
#[should_panic(expected = "Listed")]
fn sk8_a_listed_pusaka_cannot_stake() {
    let mut c = setup();
    ctx("alice.testnet", NearToken::from_yoctonear(0), vec![]);
    c.list("1".into(), NearToken::from_near(1), None, None);
    stake(&mut c, "alice.testnet", POOL, "stake", 500);
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
    let _ = c.on_near_key("1".into(), acc("bob.testnet"), NearToken::from_millinear(1), U64(1), [3; 32], NearTx::Transfer);
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

fn mpc_answers_tx(c: &mut Pusaka, tx_byte: u8, amount: u128) -> bool {
    as_contract(vec![PromiseResult::Successful(format!(r#"{{"payload_hash":"{}"}}"#, "aa".repeat(32)).into_bytes())]);
    c.on_usdc_proven("1".into(), U64(usdc::CHAINS[0].0), hex::encode([tx_byte; 32]), U64(0), U128(amount), "aa".repeat(32), acc("bob.testnet"))
}

#[test]
fn u7_dust_cannot_crowd_out_real_deposits() {
    // no list cap: 80 deposits all count; usdc_info lists the latest 16
    let mut c = setup();
    for i in 0..80u8 { assert!(mpc_answers_tx(&mut c, i, 10_000)); }
    let info = &c.usdc_info("1".into())[0];
    assert_eq!(info["verified"], "800000");
    assert_eq!(info["deposits"].as_array().unwrap().len(), 16);
    assert!(c.usdc_is_proven("1".into(), U64(usdc::CHAINS[0].0), hex::encode([79u8; 32]), U64(0)));
}

#[test]
#[should_panic(expected = "below the minimum")]
fn u8_dust_below_minimum_rejected() {
    let mut c = setup();
    ctx("bob.testnet", NearToken::from_millinear(5), vec![]);
    let _ = c.prove_usdc_deposit("1".into(), U64(usdc::CHAINS[0].0), format!("0x{}", "ab".repeat(32)), U64(4), U64(0),
        format!("0x{}", "cd".repeat(32)), U64(100), format!("0x{:0>64}", "1"),
        vec![format!("0x{}", usdc::TRANSFER_TOPIC), format!("0x{}", "11".repeat(32)), format!("0x{}", evm_of_token())]);
}

#[test]
#[should_panic(expected = "before USDC accounting existed")]
fn u9_token_that_signed_before_accounting_cannot_prove() {
    // a nonce floor with no signed-out counter = a signature from before the counter existed,
    // which could still spend a proven deposit
    let mut c = setup();
    ctx("pusaka.testnet", NearToken::from_yoctonear(0), vec![]);
    c.eth_nonces.insert(format!("1:{}", usdc::CHAINS[0].0), 1);
    prove_usdc(&mut c, &evm_of_token(), usdc::CHAINS[0].0);
}

#[test]
fn u9_any_signature_now_starts_the_counter() {
    // an ETH (not USDC) withdrawal on a verifiable chain creates the counter at 0, so proofs stay allowed
    let mut c = setup();
    ctx("alice.testnet", NearToken::from_millinear(20), vec![]);
    let _ = c.withdraw_eth("1".into(), U64(usdc::CHAINS[0].0), U64(0), "0x2af9ED1D3fe79c9a61518c9bFFA71bc3Fa1C3b63".into(),
        U128(1), U128(21_000), U128(1), U128(1), None);
    ctx("alice.testnet", NearToken::from_yoctonear(0), vec![]);
    c.pending.remove("1");
    prove_usdc(&mut c, &evm_of_token(), usdc::CHAINS[0].0); // doesn't panic
    assert_eq!(c.usdc_info("1".into())[0]["signed_out"], "0");
}

// ---------- nBTC (Omni Bridge) held by the Pusaka's own NEAR account ----------

#[test]
fn b1_nbtc_tx_is_one_ft_transfer_on_the_nbtc_contract_with_one_yocto() {
    ctx("alice.testnet", NearToken::from_yoctonear(0), vec![]);
    let tx = near_ft_transfer_tx(&[5; 32], 9, &NBTC.parse().unwrap(), &acc("bob.testnet"), 3300, &[7; 32]);
    let s = |b: &[u8]| { let mut v = (b.len() as u32).to_le_bytes().to_vec(); v.extend(b); v };
    let mut want = s(hex::encode([5u8; 32]).as_bytes());
    want.push(0); want.extend([5u8; 32]); want.extend(9u64.to_le_bytes());
    want.extend(s(NBTC.as_bytes())); want.extend([7u8; 32]);
    want.extend(1u32.to_le_bytes()); want.push(2); // one FunctionCall
    want.extend(s(b"ft_transfer"));
    want.extend(s(br#"{"receiver_id":"bob.testnet","amount":"3300"}"#));
    want.extend(30_000_000_000_000u64.to_le_bytes()); want.extend(1u128.to_le_bytes());
    assert_eq!(tx, want);
}

#[test]
fn b2_nbtc_withdrawal_locks_and_records_the_floor_like_near() {
    let mut c = setup();
    ctx("alice.testnet", NearToken::from_millinear(10), vec![]);
    let _ = c.withdraw_nbtc("1".into(), acc("bob.testnet"), U128(3300), U64(7), bs58::encode([1u8; 32]).into_string());
    assert!(c.token_info("1".into()).unwrap().pending);
    assert_eq!(c.near_nonce_floor("1".into()), U64(7));
}

#[test]
#[should_panic(expected = "NotOwner")]
fn b3_only_the_owner_moves_its_nbtc() {
    let mut c = setup();
    ctx("bob.testnet", NearToken::from_millinear(10), vec![]);
    let _ = c.withdraw_nbtc("1".into(), acc("bob.testnet"), U128(3300), U64(7), bs58::encode([1u8; 32]).into_string());
}

#[test]
#[should_panic(expected = "Listed")]
fn b3_nbtc_locked_while_listed() {
    let mut c = setup();
    ctx("alice.testnet", NearToken::from_yoctonear(0), vec![]);
    c.list("1".into(), NearToken::from_near(1), None, None);
    ctx("alice.testnet", NearToken::from_millinear(10), vec![]);
    let _ = c.withdraw_nbtc("1".into(), acc("bob.testnet"), U128(3300), U64(7), bs58::encode([1u8; 32]).into_string());
}

// ---------- Heirloom: an heir inherits a silent holder's Pusaka ----------

const SILENCE: u64 = 30 * DAY_MS;
const PAY: NearToken = NearToken::from_millinear(10);

fn with_heir() -> Pusaka {
    let mut c = setup();
    at("alice.testnet", PAY, 0);
    c.set_heir("1".into(), Some(acc("carol.testnet")), U64(SILENCE));
    c
}

fn owner(c: &Pusaka) -> AccountId {
    c.token_info("1".into()).unwrap().token.owner_id
}

#[test]
fn h1_heir_claims_only_after_the_silence() {
    let mut c = with_heir();
    assert_eq!(c.heir_of("1".into()).unwrap()["claimable_from_ms"], SILENCE.to_string());
    at("carol.testnet", NearToken::from_yoctonear(0), SILENCE);
    c.claim_inheritance("1".into());
    assert_eq!(owner(&c), acc("carol.testnet"));
    assert!(c.heir_of("1".into()).is_none()); // used up; carol names her own heir
}

#[test]
#[should_panic(expected = "seen recently")]
fn h2_still_here_restarts_the_clock() {
    let mut c = with_heir();
    at("alice.testnet", NearToken::from_yoctonear(0), SILENCE - 1);
    c.still_here("1".into());
    at("carol.testnet", NearToken::from_yoctonear(0), SILENCE + 1);
    c.claim_inheritance("1".into());
}

#[test]
#[should_panic(expected = "only the named heir")]
fn h3_nobody_else_claims() {
    let mut c = with_heir();
    at("mallory.testnet", NearToken::from_yoctonear(0), SILENCE * 2);
    c.claim_inheritance("1".into());
}

#[test]
#[should_panic(expected = "no heir set")]
fn h4_a_sale_ends_the_old_holders_will_even_if_it_comes_back() {
    let mut c = with_heir();
    at("alice.testnet", NearToken::from_yoctonear(1), 1);
    c.nft_transfer(acc("bob.testnet"), "1".into(), None, None);
    assert!(c.heir_of("1".into()).is_none());
    at("bob.testnet", NearToken::from_yoctonear(1), 2);
    c.nft_transfer(acc("alice.testnet"), "1".into(), None, None);
    at("carol.testnet", NearToken::from_yoctonear(0), SILENCE * 2);
    c.claim_inheritance("1".into());
}

#[test]
#[should_panic(expected = "lender's claim comes first")]
fn h5_a_funded_loan_comes_first() {
    let mut c = funded_loan();
    at("alice.testnet", PAY, 2_000);
    c.set_heir("1".into(), Some(acc("carol.testnet")), U64(SILENCE));
    at("carol.testnet", NearToken::from_yoctonear(0), SILENCE * 2);
    c.claim_inheritance("1".into());
}

#[test]
fn h6_a_silent_holders_listing_is_withdrawn_and_markets_lose_approval() {
    let mut c = with_heir();
    at("alice.testnet", NearToken::from_yoctonear(0), 1);
    c.list("1".into(), NearToken::from_near(5), None, None);
    at("carol.testnet", NearToken::from_yoctonear(0), SILENCE + 1);
    c.claim_inheritance("1".into());
    let info = c.token_info("1".into()).unwrap();
    assert!(info.listing.is_none());
    assert_eq!(info.token.owner_id, acc("carol.testnet"));
}

#[test]
#[should_panic(expected = "after_ms must be at least")]
fn h7_too_short_a_silence_is_refused() {
    let mut c = setup();
    at("alice.testnet", PAY, 0);
    c.set_heir("1".into(), Some(acc("carol.testnet")), U64(1_000));
}

#[test]
#[should_panic(expected = "NotOwner")]
fn h8_only_the_holder_names_an_heir() {
    let mut c = setup();
    at("carol.testnet", PAY, 0);
    c.set_heir("1".into(), Some(acc("carol.testnet")), U64(SILENCE));
}

#[test]
#[should_panic(expected = "seen recently")]
fn h9_any_holder_action_is_proof_of_life() {
    let mut c = with_heir();
    at("alice.testnet", NearToken::from_yoctonear(0), SILENCE - 1);
    c.list("1".into(), NearToken::from_near(5), None, None); // not a check-in, but she's clearly here
    at("alice.testnet", NearToken::from_yoctonear(0), SILENCE);
    c.cancel_listing("1".into());
    at("carol.testnet", NearToken::from_yoctonear(0), SILENCE + 1);
    c.claim_inheritance("1".into());
}

#[test]
fn h10_another_tokens_holder_doesnt_touch_this_clock() {
    let mut c = with_heir();
    at("carol.testnet", NearToken::from_yoctonear(0), SILENCE);
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.list("1".into(), NearToken::from_near(5), None, None)));
    assert_eq!(c.heir_of("1".into()).unwrap()["last_seen_ms"], "0");
}

fn metadata_updates() -> usize {
    near_sdk::test_utils::get_logs().iter()
        .filter(|l| l.starts_with("EVENT_JSON:") && l.contains("\"event\":\"nft_metadata_update\"") && l.contains("\"token_ids\":[\"1\"]"))
        .count()
}

#[test]
fn n4_metadata_update_when_the_art_changes() {
    let mut c = setup();
    // a deposit the light client rejects changes nothing, so nothing is announced
    assert!(!proven(&mut c, b"false", 0, 100_000));
    assert_eq!(metadata_updates(), 0);
    // more verified BTC: new ring and description
    assert!(proven(&mut c, b"true", 0, 100_000));
    assert_eq!(metadata_updates(), 1);
    // listing locks it: the art shows the lock
    ctx("alice.testnet", NearToken::from_yoctonear(0), vec![]);
    c.list("1".into(), NearToken::from_near(5), None, None);
    assert_eq!(metadata_updates(), 1, "one event for the listing");
}

// ---------- T8: nft_transfer_call locks the token until it resolves ----------

fn transfer_call(c: &mut Pusaka) {
    ctx("alice.testnet", NearToken::from_yoctonear(1), vec![]);
    let _ = c.nft_transfer_call(acc("market.testnet"), "1".into(), None, None, "".into());
}

/// `answer` is what nft_on_transfer returned (true = give it back); None = it failed.
fn resolve(c: &mut Pusaka, answer: Option<bool>) -> bool {
    as_contract(vec![match answer {
        Some(b) => PromiseResult::Successful(b.to_string().into_bytes()),
        None => PromiseResult::Failed,
    }]);
    c.nft_resolve_transfer(acc("alice.testnet"), acc("market.testnet"), "1".into(), None)
}

#[test]
fn x1_receiver_keeps_it_and_may_sign_after_resolve() {
    let mut c = setup();
    transfer_call(&mut c);
    assert_eq!(owner(&c), acc("market.testnet"));
    assert!(c.token_info("1".into()).unwrap().pending);
    assert!(resolve(&mut c, Some(false)));
    assert_eq!(owner(&c), acc("market.testnet"));
    assert!(!c.token_info("1".into()).unwrap().pending);
    withdraw(&mut c, "market.testnet", &[0]);
}

#[test]
fn x2_receiver_returns_it() {
    let mut c = setup();
    transfer_call(&mut c);
    assert!(!resolve(&mut c, Some(true)));
    assert_eq!(owner(&c), acc("alice.testnet"));
    withdraw(&mut c, "alice.testnet", &[0]); // unlocked again
}

#[test]
fn x2_failed_receiver_returns_it() {
    let mut c = setup();
    transfer_call(&mut c);
    assert!(!resolve(&mut c, None));
    assert_eq!(owner(&c), acc("alice.testnet"));
}

#[test]
#[should_panic(expected = "TransferCallPending")]
fn x3_receiver_cannot_withdraw_during_the_call() {
    let mut c = setup();
    transfer_call(&mut c);
    withdraw(&mut c, "market.testnet", &[0]);
}

#[test]
#[should_panic(expected = "TransferCallPending")]
fn x3_receiver_cannot_move_it_on_during_the_call() {
    let mut c = setup();
    transfer_call(&mut c);
    ctx("market.testnet", NearToken::from_yoctonear(1), vec![]);
    c.nft_transfer(acc("bob.testnet"), "1".into(), None, None);
}

#[test]
#[should_panic(expected = "TransferCallPending")]
fn x4_receiver_cannot_list_during_the_call() {
    let mut c = setup();
    transfer_call(&mut c);
    ctx("market.testnet", NearToken::from_yoctonear(0), vec![]);
    c.list("1".into(), NearToken::from_near(5), None, None);
}

#[test]
#[should_panic(expected = "StateChanged")]
fn x4_buyer_who_looked_before_the_call_fails() {
    let mut c = setup();
    let seen = c.token_info("1".into()).unwrap().sign_epoch;
    transfer_call(&mut c);
    resolve(&mut c, Some(true));
    ctx("alice.testnet", NearToken::from_yoctonear(0), vec![]);
    c.list("1".into(), NearToken::from_near(5), None, None);
    ctx("bob.testnet", NearToken::from_near(5), vec![]);
    c.buy("1".into(), seen);
}

#[test]
fn x5_transfer_call_clears_the_heir() {
    let mut c = with_heir();
    transfer_call(&mut c);
    resolve(&mut c, Some(true));
    assert_eq!(owner(&c), acc("alice.testnet"));
    assert!(c.heir_of("1".into()).is_none());
}

#[test]
fn y4_payout_of_a_huge_ft_balance_does_not_overflow() {
    let c = resold();
    let big = u128::MAX / 100; // a 24+-decimal FT; `amount * 250` alone would overflow
    let p = c.nft_payout("1".into(), U128(big), Some(5));
    let creator = p.payout.get(&acc("alice.testnet")).unwrap().0;
    let owner = p.payout.get(&acc("bob.testnet")).unwrap().0;
    assert_eq!(creator + owner, big, "nothing lost or created");
    assert_eq!(creator, big / 10_000 * 250 + big % 10_000 * 250 / 10_000);
}

#[test]
fn p9_a_proof_that_lands_after_a_withdrawal_signed_it_is_not_stored() {
    let mut c = setup();
    // the withdrawal signs outpoint 0 while its proof is still in flight
    withdraw(&mut c, "alice.testnet", &[0]);
    assert!(proven(&mut c, b"true", 0, 100_000)); // the light client still says it's in a block
    let info = c.token_info("1".into()).unwrap();
    assert!(info.proven_utxos.is_empty(), "a spent outpoint takes no MAX_PROVEN slot");
    assert_eq!(info.verified_sats, U64(0));
}

// ---------- loan market: lender offers, refinancing, partial repayment, extensions ----------

#[allow(non_snake_case)]
fn N(n: u128) -> NearToken {
    NearToken::from_near(n)
}
/// 10 NEAR principal plus enough for the offer's storage; the excess comes back.
const OFFER_PAY: NearToken = NearToken::from_millinear(10_100);

/// NEAR the contract sent to `who` in the current call.
fn paid_to(who: &str) -> u128 {
    near_sdk::test_utils::get_created_receipts().iter()
        .filter(|r| r.receiver_id.as_str() == who)
        .flat_map(|r| r.actions.iter())
        .map(|a| match a { near_sdk::mock::MockAction::Transfer { deposit, .. } => deposit.as_yoctonear(), _ => 0 })
        .sum()
}

/// Bob offers 10 NEAR for 11 back within a day, for token "1" or any token with `min` sats.
fn offer(c: &mut Pusaka, token: Option<&str>, min: Option<u64>) -> U64 {
    at("bob.testnet", OFFER_PAY, 0);
    c.offer_loan(token.map(Into::into), min.map(U64), N(10), N(11), U64(DAY_MS))
}

fn open_offers(c: &Pusaka) -> usize {
    c.loan_offers(None, None)["offers"].as_array().unwrap().len()
}

#[test]
fn o1_offer_escrows_and_the_owner_accepts_it_as_a_funded_loan() {
    let mut c = setup();
    let id = offer(&mut c, Some("1"), None);
    let storage = c.loan_offers(None, None)["offers"][0]["offer"]["storage"].as_str().unwrap().parse::<u128>().unwrap();
    assert!(storage > 0);
    assert_eq!(paid_to("bob.testnet"), OFFER_PAY.as_yoctonear() - N(10).as_yoctonear() - storage, "excess refunded");
    assert_eq!(open_offers(&c), 1);

    at("alice.testnet", NearToken::from_yoctonear(0), 1_000);
    c.accept_loan_offer("1".into(), id, 0);
    assert_eq!(paid_to("alice.testnet"), N(10).as_yoctonear(), "principal to the borrower");
    assert_eq!(paid_to("bob.testnet"), storage, "storage back to the lender");
    let loan = c.token_info("1".into()).unwrap().loan.unwrap();
    assert_eq!(loan.lender, Some(acc("bob.testnet")));
    assert_eq!(loan.due_ms, Some(U64(1_000 + DAY_MS)));
    assert_eq!(loan.repay, N(11));
    assert_eq!(open_offers(&c), 0);
    // the loan locks the token like any other
    at("alice.testnet", NearToken::from_yoctonear(1), 2_000);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.nft_transfer(acc("carol.testnet"), "1".into(), None, None)));
    assert!(r.is_err());
}

#[test]
fn o2_lender_cancels_and_gets_principal_and_storage_back() {
    let mut c = setup();
    let id = offer(&mut c, Some("1"), None);
    let storage = c.loan_offers(None, None)["offers"][0]["offer"]["storage"].as_str().unwrap().parse::<u128>().unwrap();
    at("bob.testnet", NearToken::from_yoctonear(0), 10);
    c.cancel_loan_offer(id);
    assert_eq!(paid_to("bob.testnet"), N(10).as_yoctonear() + storage);
    assert_eq!(open_offers(&c), 0);
}

#[test]
#[should_panic(expected = "NotLender")]
fn o2_only_the_lender_cancels() {
    let mut c = setup();
    let id = offer(&mut c, Some("1"), None);
    at("alice.testnet", NearToken::from_yoctonear(0), 10);
    c.cancel_loan_offer(id);
}

#[test]
#[should_panic(expected = "attach at least")]
fn o2_offer_must_escrow_principal_and_storage() {
    let mut c = setup();
    at("bob.testnet", N(10), 0); // principal only, no storage
    c.offer_loan(Some("1".into()), None, N(10), N(11), U64(DAY_MS));
}

#[test]
#[should_panic(expected = "exactly one")]
fn o2_offer_needs_exactly_one_target() {
    let mut c = setup();
    at("bob.testnet", OFFER_PAY, 0);
    c.offer_loan(Some("1".into()), Some(U64(1)), N(10), N(11), U64(DAY_MS));
}

#[test]
fn o3_sats_floor_offer_is_accepted_when_the_light_client_proved_enough() {
    let mut c = setup();
    assert!(proven(&mut c, b"true", 0, 100_000));
    let id = offer(&mut c, None, Some(100_000));
    at("alice.testnet", NearToken::from_yoctonear(0), 1_000);
    c.accept_loan_offer("1".into(), id, 0);
    assert_eq!(c.token_info("1".into()).unwrap().loan.unwrap().lender, Some(acc("bob.testnet")));
}

#[test]
#[should_panic(expected = "BelowSatsFloor")]
fn o4_sats_floor_not_met() {
    let mut c = setup();
    assert!(proven(&mut c, b"true", 0, 100_000));
    let id = offer(&mut c, None, Some(100_001));
    at("alice.testnet", NearToken::from_yoctonear(0), 1_000);
    c.accept_loan_offer("1".into(), id, 0);
}

#[test]
#[should_panic(expected = "NotOwner")]
fn o5_only_the_owner_accepts() {
    let mut c = setup();
    let id = offer(&mut c, Some("1"), None);
    at("carol.testnet", NearToken::from_yoctonear(0), 1_000);
    c.accept_loan_offer("1".into(), id, 0);
}

#[test]
#[should_panic(expected = "StateChanged")]
fn o6_stale_sign_epoch_fails() {
    let mut c = setup();
    assert!(proven(&mut c, b"true", 0, 100_000));
    let id = offer(&mut c, None, Some(50_000));
    // the lender's floor was checked at epoch 0; the owner then signs a withdrawal
    withdraw(&mut c, "alice.testnet", &[1]);
    sign_ok(&mut c, &[1], &[true]);
    at("alice.testnet", NearToken::from_yoctonear(0), 1_000);
    c.accept_loan_offer("1".into(), id, 0);
}

#[test]
#[should_panic(expected = "NoOffer")]
fn o7_offer_cannot_be_accepted_twice() {
    let mut c = setup();
    let id = offer(&mut c, Some("1"), None);
    at("alice.testnet", NearToken::from_yoctonear(0), 1_000);
    c.accept_loan_offer("1".into(), id, 0);
    c.accept_loan_offer("1".into(), id, 0);
}

#[test]
#[should_panic(expected = "NoOffer")]
fn o7_offer_cannot_be_accepted_again_after_repayment() {
    let mut c = setup();
    let id = offer(&mut c, Some("1"), None);
    at("alice.testnet", NearToken::from_yoctonear(0), 1_000);
    c.accept_loan_offer("1".into(), id, 0);
    at("alice.testnet", N(11), 2_000);
    c.repay_loan("1".into());
    at("alice.testnet", NearToken::from_yoctonear(0), 3_000);
    c.accept_loan_offer("1".into(), id, 0);
}

#[test]
#[should_panic(expected = "NoOffer")]
fn o8_cancel_after_accept_fails() {
    let mut c = setup();
    let id = offer(&mut c, Some("1"), None);
    at("alice.testnet", NearToken::from_yoctonear(0), 1_000);
    c.accept_loan_offer("1".into(), id, 0);
    at("bob.testnet", NearToken::from_yoctonear(0), 2_000);
    c.cancel_loan_offer(id);
}

#[test]
#[should_panic(expected = "Approved")]
fn o9_approved_token_cannot_take_an_offer() {
    let mut c = setup();
    let id = offer(&mut c, Some("1"), None);
    approve(&mut c, "market.testnet");
    at("alice.testnet", NearToken::from_yoctonear(0), 1_000);
    c.accept_loan_offer("1".into(), id, 0);
}

#[test]
#[should_panic(expected = "OfferForAnotherToken")]
fn o9_offer_for_another_token() {
    let mut c = setup();
    ctx("alice.testnet", NearToken::from_near(1), vec![]);
    let _ = c.nft_mint(None); // token 2
    let id = offer(&mut c, Some("2"), None);
    at("alice.testnet", NearToken::from_yoctonear(0), 1_000);
    c.accept_loan_offer("1".into(), id, 0);
}

// funded_loan: alice borrows 10, repays 11, bob lends at t=1000, due 1000 + DAY_MS

/// Carol offers 12 NEAR for 13 back within a day, for token "1".
fn carol_offers(c: &mut Pusaka, now: u64) -> U64 {
    at("carol.testnet", NearToken::from_millinear(12_100), now);
    c.offer_loan(Some("1".into()), None, N(12), N(13), U64(DAY_MS))
}

#[test]
fn o10_borrower_refinances_by_taking_an_offer() {
    let mut c = funded_loan();
    let id = carol_offers(&mut c, 1_500);
    let storage = c.loan_offers(None, None)["offers"][0]["offer"]["storage"].as_str().unwrap().parse::<u128>().unwrap();
    at("alice.testnet", NearToken::from_yoctonear(0), 2_000);
    c.accept_loan_offer("1".into(), id, 0);
    assert_eq!(paid_to("bob.testnet"), N(11).as_yoctonear(), "the old lender is paid in full");
    assert_eq!(paid_to("alice.testnet"), N(1).as_yoctonear(), "the rest of the new principal to the borrower");
    assert_eq!(paid_to("carol.testnet"), storage);
    let loan = c.token_info("1".into()).unwrap().loan.unwrap();
    assert_eq!(loan.lender, Some(acc("carol.testnet")));
    assert_eq!((loan.principal, loan.repay, loan.due_ms), (N(12), N(13), Some(U64(2_000 + DAY_MS))));
    // the old lender has no claim left
    at("bob.testnet", NearToken::from_yoctonear(0), 3 * DAY_MS);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.claim_collateral("1".into())));
    assert!(r.is_err());
}

#[test]
fn o10_a_smaller_offer_refinances_with_the_difference_attached() {
    let mut c = funded_loan();
    let id = offer(&mut c, Some("1"), None); // bob himself: 10 for 11, while 11 is owed to him
    at("alice.testnet", N(1), 2_000);
    c.accept_loan_offer("1".into(), id, 0);
    let storage = paid_to("bob.testnet") - N(11).as_yoctonear();
    assert!(storage > 0 && storage < NearToken::from_millinear(100).as_yoctonear(), "bob: owed 11 plus his storage");
    assert_eq!(paid_to("alice.testnet"), 0);
    assert_eq!(c.token_info("1".into()).unwrap().loan.unwrap().due_ms, Some(U64(2_000 + DAY_MS)));
}

#[test]
#[should_panic(expected = "doesn't cover")]
fn o10_a_smaller_offer_without_the_difference_fails() {
    let mut c = funded_loan();
    let id = offer(&mut c, Some("1"), None);
    at("alice.testnet", NearToken::from_millinear(999), 2_000);
    c.accept_loan_offer("1".into(), id, 0);
}

#[test]
#[should_panic(expected = "Collateralised")]
fn o10_an_open_loan_request_is_not_refinanced() {
    let mut c = setup();
    at("alice.testnet", NearToken::from_yoctonear(0), 0);
    c.request_loan("1".into(), N(10), N(11), U64(DAY_MS));
    let id = carol_offers(&mut c, 500);
    at("alice.testnet", NearToken::from_yoctonear(0), 1_000);
    c.accept_loan_offer("1".into(), id, 0);
}

#[test]
fn o11_partial_repayment_goes_to_the_lender_and_lowers_what_is_left() {
    let mut c = funded_loan();
    at("alice.testnet", N(4), 2_000);
    c.repay_partial("1".into());
    assert_eq!(paid_to("bob.testnet"), N(4).as_yoctonear());
    assert_eq!(c.token_info("1".into()).unwrap().loan.unwrap().repay, N(7));
    // the rest closes it as usual
    at("alice.testnet", N(7), 3_000);
    c.repay_loan("1".into());
    assert_eq!(paid_to("bob.testnet"), N(7).as_yoctonear());
    assert!(c.token_info("1".into()).unwrap().loan.is_none());
}

#[test]
#[should_panic(expected = "use repay_loan")]
fn o11_partial_repayment_of_everything_left_fails() {
    let mut c = funded_loan();
    at("alice.testnet", N(11), 2_000);
    c.repay_partial("1".into());
}

#[test]
#[should_panic(expected = "NotBorrower")]
fn o11_only_the_borrower_repays_in_part() {
    let mut c = funded_loan();
    at("carol.testnet", N(1), 2_000);
    c.repay_partial("1".into());
}

const EXT_PAY: NearToken = NearToken::from_millinear(10);

fn proposed(c: &mut Pusaka) {
    at("bob.testnet", EXT_PAY, 2_000);
    c.propose_extension("1".into(), U64(DAY_MS), N(1));
}

#[test]
fn o12_extension_moves_the_due_date_and_pays_the_fee_to_the_lender() {
    let mut c = funded_loan();
    proposed(&mut c);
    assert!(c.loan_extension("1".into()).is_some());
    at("alice.testnet", N(1), 3_000);
    c.accept_extension("1".into(), U64(DAY_MS));
    assert_eq!(paid_to("bob.testnet"), N(1).as_yoctonear());
    assert_eq!(c.token_info("1".into()).unwrap().loan.unwrap().due_ms, Some(U64(1_000 + 2 * DAY_MS)));
    assert!(c.loan_extension("1".into()).is_none(), "used up");
}

#[test]
#[should_panic(expected = "NotLender")]
fn o12_only_the_lender_proposes_an_extension() {
    let mut c = funded_loan();
    at("carol.testnet", EXT_PAY, 2_000);
    c.propose_extension("1".into(), U64(DAY_MS), N(0));
}

#[test]
#[should_panic(expected = "Overdue")]
fn o12_extension_after_the_due_date_fails() {
    let mut c = funded_loan();
    proposed(&mut c);
    at("alice.testnet", N(1), 1_000 + DAY_MS);
    c.accept_extension("1".into(), U64(DAY_MS));
}

#[test]
#[should_panic(expected = "WrongFee")]
fn o12_extension_with_the_wrong_fee_fails() {
    let mut c = funded_loan();
    proposed(&mut c);
    at("alice.testnet", NearToken::from_millinear(999), 3_000);
    c.accept_extension("1".into(), U64(DAY_MS));
}

#[test]
#[should_panic(expected = "NoExtension")]
fn o12_old_lenders_extension_dies_with_a_refinance() {
    let mut c = funded_loan();
    proposed(&mut c);
    let id = carol_offers(&mut c, 2_400);
    at("alice.testnet", NearToken::from_yoctonear(0), 2_500);
    c.accept_loan_offer("1".into(), id, 0);
    at("alice.testnet", N(1), 3_000);
    c.accept_extension("1".into(), U64(DAY_MS));
}

#[test]
#[should_panic(expected = "StateChanged")]
fn o13_owner_cannot_withdraw_then_accept_an_offer_made_for_the_full_btc() {
    let mut c = setup();
    assert!(proven(&mut c, b"true", 0, 100_000));
    let id = offer(&mut c, Some("1"), None); // the lender saw 100,000 sats
    withdraw(&mut c, "alice.testnet", &[0]); // the owner takes the BTC out
    let _ = sign_ok(&mut c, &[0], &[true]);
    let now = c.token_info("1".into()).unwrap().sign_epoch;
    at("alice.testnet", NearToken::from_yoctonear(0), 2_000);
    c.accept_loan_offer("1".into(), id, now); // the owner's own (current) epoch doesn't help
}

#[test]
#[should_panic(expected = "TermsChanged")]
fn o14_borrower_accepts_only_the_extension_they_saw() {
    let mut c = funded_loan();
    proposed(&mut c); // the lender: one day for 1 NEAR
    at("alice.testnet", N(1), 3_000);
    c.accept_extension("1".into(), U64(7 * DAY_MS)); // the borrower agreed to a week; the proposal says a day
}

// ---------- timelocked upgrades: the contract account can hold no key ----------

/// `at`, with raw call input (the wasm bytes for apply_upgrade).
fn at_with_input(caller: &str, now_ms: u64, input: &[u8]) {
    let mut c = VMContextBuilder::new()
        .current_account_id(acc("pusaka.testnet"))
        .predecessor_account_id(acc(caller))
        .block_timestamp(now_ms * 1_000_000)
        .prepaid_gas(Gas::from_tgas(300))
        .build();
    c.input = input.into();
    testing_env!(c, test_vm_config(), RuntimeFeesConfig::test(), Default::default(), vec![]);
}

const NEW_CODE: &[u8] = b" asm new code";

fn with_admin() -> Pusaka {
    let mut c = setup();
    at("pusaka.testnet", NearToken::from_yoctonear(0), 0);
    c.set_upgrade_admin(acc("admin.testnet"));
    c
}

fn announce(c: &mut Pusaka, now: u64) -> upgrade::UpgradeProposal {
    at("admin.testnet", NearToken::from_yoctonear(0), now);
    c.propose_upgrade(hex::encode(env::sha256_array(NEW_CODE)), None)
}

#[test]
#[should_panic(expected = "OnlyTheContractItself")]
fn up1_only_the_contract_itself_names_the_admin() {
    let mut c = setup();
    at("alice.testnet", NearToken::from_yoctonear(0), 0);
    c.set_upgrade_admin(acc("alice.testnet"));
}

#[test]
#[should_panic(expected = "NotUpgradeAdmin")]
fn up2_only_the_admin_announces() {
    let mut c = with_admin();
    at("alice.testnet", NearToken::from_yoctonear(0), 0);
    c.propose_upgrade("00".repeat(32), None);
}

#[test]
#[should_panic(expected = "NoUpgradeAdmin")]
fn up2_no_admin_no_upgrades() {
    let mut c = setup();
    at("alice.testnet", NearToken::from_yoctonear(0), 0);
    c.propose_upgrade("00".repeat(32), None);
}

#[test]
#[should_panic(expected = "TooEarly")]
fn up3_announced_code_waits_for_the_delay() {
    let mut c = with_admin();
    announce(&mut c, 1_000);
    at_with_input("bob.testnet", 1_000 + upgrade::UPGRADE_DELAY_MS - 1, NEW_CODE);
    let _ = c.apply_upgrade();
}

#[test]
#[should_panic(expected = "CodeMismatch")]
fn up4_only_the_announced_bytes_deploy() {
    let mut c = with_admin();
    announce(&mut c, 1_000);
    at_with_input("bob.testnet", 1_000 + upgrade::UPGRADE_DELAY_MS, b" asm other code");
    let _ = c.apply_upgrade();
}

#[test]
fn up5_after_the_delay_anyone_deploys_the_announced_code_once() {
    let mut c = with_admin();
    let p = announce(&mut c, 1_000);
    assert_eq!(p.applicable_from_ms, U64(1_000 + upgrade::UPGRADE_DELAY_MS));
    assert_eq!(c.upgrade_status()["proposal"]["code_sha256"], hex::encode(env::sha256_array(NEW_CODE)));
    at_with_input("bob.testnet", 1_000 + upgrade::UPGRADE_DELAY_MS, NEW_CODE);
    let _ = c.apply_upgrade();
    let deployed = near_sdk::test_utils::get_created_receipts().iter().any(|r| r.receiver_id == acc("pusaka.testnet")
        && r.actions.iter().any(|a| matches!(a, near_sdk::mock::MockAction::DeployContract { code, .. } if code == NEW_CODE)));
    assert!(deployed, "a DeployContract of exactly the announced bytes, to the contract itself");
    assert!(c.upgrade_status()["proposal"].is_null(), "used once");
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| { let _ = c.apply_upgrade(); }));
    assert!(r.is_err(), "nothing left to apply");
}

#[test]
#[should_panic(expected = "TooEarly")]
fn up6_a_new_announcement_restarts_the_delay() {
    let mut c = with_admin();
    announce(&mut c, 1_000);
    announce(&mut c, 1_000 + upgrade::UPGRADE_DELAY_MS - 10); // swapped in just before it matured
    at_with_input("bob.testnet", 1_000 + upgrade::UPGRADE_DELAY_MS, NEW_CODE);
    let _ = c.apply_upgrade();
}

#[test]
fn up7_renounced_means_final() {
    let mut c = with_admin();
    announce(&mut c, 1_000);
    at("admin.testnet", NearToken::from_yoctonear(0), 2_000);
    c.renounce_upgrades();
    let st = c.upgrade_status();
    assert_eq!(st["renounced"], true);
    assert!(st["admin"].is_null() && st["proposal"].is_null());
    at("pusaka.testnet", NearToken::from_yoctonear(0), 3_000);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.set_upgrade_admin(acc("admin.testnet"))));
    assert!(r.is_err(), "not even the contract account can turn upgrades back on");
}

#[test]
#[should_panic(expected = "64 hex")]
fn up8_announcement_must_be_a_sha256() {
    let mut c = with_admin();
    at("admin.testnet", NearToken::from_yoctonear(0), 0);
    c.propose_upgrade("not a hash".into(), None);
}

#[test]
fn up9_the_admin_hands_upgrades_to_a_dao() {
    let mut c = with_admin();
    announce(&mut c, 1_000);
    at("admin.testnet", NearToken::from_yoctonear(0), 2_000);
    c.transfer_upgrade_admin(acc("council.sputnik-v2.testnet"));
    let st = c.upgrade_status();
    assert_eq!(st["admin"], "council.sputnik-v2.testnet");
    assert!(st["proposal"].is_null(), "the old admin's announcement doesn't survive the handover");
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| { announce(&mut c, 3_000); }));
    assert!(r.is_err(), "the old admin can't announce any more");
    at("council.sputnik-v2.testnet", NearToken::from_yoctonear(0), 4_000);
    c.propose_upgrade(hex::encode(env::sha256_array(NEW_CODE)), None);
}

// ---------- NEAR Social notifications ----------

/// SocialDB `set` calls the contract made in the current call, as their JSON args.
fn social_sets() -> Vec<serde_json::Value> {
    near_sdk::test_utils::get_created_receipts().iter()
        .filter(|r| r.receiver_id.as_str() == SOCIAL_DB)
        .flat_map(|r| r.actions.iter())
        .filter_map(|a| match a {
            near_sdk::mock::MockAction::FunctionCallWeight { method_name, args, .. } if method_name == b"set" => serde_json::from_slice(args).ok(),
            _ => None,
        })
        .collect()
}

#[test]
fn sn1_a_sale_notifies_the_seller_on_near_social() {
    let mut c = setup();
    ctx("alice.testnet", NearToken::from_yoctonear(0), vec![]);
    c.list("1".into(), NearToken::from_near(5), None, None);
    ctx("bob.testnet", NearToken::from_near(5), vec![]);
    c.buy("1".into(), 0);
    let sets = social_sets();
    assert_eq!(sets.len(), 1, "one notification");
    let notify: serde_json::Value = serde_json::from_str(sets[0]["data"]["pusaka.testnet"]["index"]["notify"].as_str().unwrap()).unwrap();
    assert_eq!(notify["key"], "alice.testnet");
    assert_eq!(notify["value"]["event"], "sold");
    assert_eq!(notify["value"]["token_id"], "1");
}

#[test]
fn sn2_listing_notifies_nobody() {
    let mut c = setup();
    ctx("alice.testnet", NearToken::from_yoctonear(0), vec![]);
    c.list("1".into(), NearToken::from_near(5), None, None);
    assert!(social_sets().is_empty());
}

#[test]
fn sn3_a_transfer_call_returned_in_the_callback_notifies_nobody() {
    // nft_resolve_transfer runs on a fixed gas budget and must always unlock the token
    let mut c = setup();
    transfer_call(&mut c);
    assert!(!resolve(&mut c, Some(true)));
    assert!(social_sets().is_empty());
    withdraw(&mut c, "alice.testnet", &[0]); // and the token is unlocked
}


// ---------- gift links: NEP-452 linkdrop built into the contract ----------

const GIFT_PK: &str = "ed25519:BDW6jsm1qFKjVac7dsBCUpDJAeXX2Emzn2bjnuYrVKxQ";
fn gift_pk() -> near_sdk::PublicKey { GIFT_PK.parse().unwrap() }

/// A call signed with `pk` on the contract account itself (how a gift link's key calls claim).
fn as_link(pk: &str) {
    let c = VMContextBuilder::new()
        .current_account_id(acc("pusaka.testnet"))
        .predecessor_account_id(acc("pusaka.testnet"))
        .signer_account_id(acc("pusaka.testnet"))
        .signer_account_pk(pk.parse().unwrap())
        .prepaid_gas(Gas::from_tgas(100))
        .build();
    testing_env!(c, test_vm_config(), RuntimeFeesConfig::test(), Default::default(), vec![]);
}

fn gifted() -> Pusaka {
    let mut c = setup();
    ctx("alice.testnet", gift::GIFT_DEPOSIT, vec![]);
    c.gift("1".into(), gift_pk());
    as_contract(vec![PromiseResult::Successful(vec![])]); // the AddKey went through
    assert!(c.on_gift_key(gift_pk()));
    c
}

fn receipt_actions(to: &str) -> Vec<near_sdk::mock::MockAction> {
    near_sdk::test_utils::get_created_receipts().into_iter().filter(|r| r.receiver_id.as_str() == to).flat_map(|r| r.actions).collect()
}

#[test]
fn g1_a_gift_adds_a_claim_only_key_and_locks_the_pusaka() {
    let mut c = setup();
    ctx("alice.testnet", gift::GIFT_DEPOSIT, vec![]);
    c.gift("1".into(), gift_pk());
    let adds = receipt_actions("pusaka.testnet").into_iter().any(|a| matches!(a,
        near_sdk::mock::MockAction::AddKeyWithFunctionCall { public_key, receiver_id, method_names, .. }
            if public_key.to_string() == GIFT_PK && receiver_id.as_str() == "pusaka.testnet"
            && method_names.iter().map(|m| m.as_str()).collect::<Vec<_>>() == ["claim", "create_account_and_claim"]));
    assert!(adds, "a function-call key limited to the two claim methods, on the contract itself");
    assert_eq!(c.gift_of("1".into()).unwrap()["from"], "alice.testnet");
    ctx("alice.testnet", NearToken::from_yoctonear(1), vec![]);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.nft_transfer(acc("carol.testnet"), "1".into(), None, None)));
    assert!(r.is_err(), "gifted: it can't move except through the link");
}

#[test]
#[should_panic(expected = "Gifted")]
fn g1_the_giver_cannot_withdraw_while_the_link_is_open() {
    let mut c = gifted();
    withdraw(&mut c, "alice.testnet", &[0]);
}

#[test]
fn g2_the_link_claims_it_into_an_account_and_burns_the_key() {
    let mut c = gifted();
    as_link(GIFT_PK);
    c.claim(acc("bob.testnet"));
    assert_eq!(owner(&c), acc("bob.testnet"));
    assert!(receipt_actions("pusaka.testnet").iter().any(|a| matches!(a, near_sdk::mock::MockAction::DeleteKey { public_key, .. } if public_key.to_string() == GIFT_PK)));
    assert_eq!(paid_to("bob.testnet"), NearToken::from_millinear(130).as_yoctonear(), "first NEAR for the recipient");
    assert!(c.gift_of("1".into()).is_none());
    withdraw(&mut c, "bob.testnet", &[0]); // and the BTC is bob's to move
}

#[test]
#[should_panic(expected = "sign with the gift link's key")]
fn g3_nobody_else_can_call_claim() {
    let mut c = gifted();
    ctx("mallory.testnet", NearToken::from_yoctonear(0), vec![]);
    c.claim(acc("mallory.testnet"));
}

#[test]
#[should_panic(expected = "NoGift")]
fn g3_another_key_opens_nothing() {
    let mut c = gifted();
    as_link("ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp");
    c.claim(acc("mallory.testnet"));
}

#[test]
fn g4_the_giver_cancels_and_gets_it_back() {
    let mut c = gifted();
    ctx("alice.testnet", NearToken::from_yoctonear(0), vec![]);
    c.cancel_gift("1".into());
    assert!(c.gift_of("1".into()).is_none());
    assert!(receipt_actions("pusaka.testnet").iter().any(|a| matches!(a, near_sdk::mock::MockAction::DeleteKey { .. })));
    withdraw(&mut c, "alice.testnet", &[0]); // unlocked
}

#[test]
fn g5_a_new_account_is_created_then_given_the_pusaka() {
    let mut c = gifted();
    as_link(GIFT_PK);
    let _ = c.create_account_and_claim(acc("ana.testnet"), "ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp".parse().unwrap());
    assert!(receipt_actions(gift::REGISTRAR).iter().any(|a| matches!(a, near_sdk::mock::MockAction::FunctionCallWeight { method_name, .. } if method_name == b"create_account")));
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.claim(acc("eve.testnet"))));
    assert!(r.is_err(), "no second claim while the account is being created");
    as_contract(vec![PromiseResult::Successful(b"true".to_vec())]);
    assert!(c.on_gift_account(gift_pk(), acc("ana.testnet")));
    assert_eq!(owner(&c), acc("ana.testnet"));
}

#[test]
fn g5_if_the_name_is_taken_the_link_stays_claimable() {
    let mut c = gifted();
    as_link(GIFT_PK);
    let _ = c.create_account_and_claim(acc("taken.testnet"), "ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp".parse().unwrap());
    as_contract(vec![PromiseResult::Successful(b"false".to_vec())]);
    assert!(!c.on_gift_account(gift_pk(), acc("taken.testnet")));
    assert_eq!(owner(&c), acc("alice.testnet"));
    as_link(GIFT_PK);
    c.claim(acc("bob.testnet"));
    assert_eq!(owner(&c), acc("bob.testnet"));
}

#[test]
#[should_panic(expected = "attach")]
fn g6_a_gift_must_carry_its_deposit() {
    let mut c = setup();
    ctx("alice.testnet", NearToken::from_millinear(100), vec![]);
    c.gift("1".into(), gift_pk());
}

#[test]
fn g7_a_key_the_contract_did_not_add_is_never_deleted() {
    // someone "gifts" with a key that already exists on the account: AddKey fails, the gift is void
    let mut c = setup();
    ctx("alice.testnet", gift::GIFT_DEPOSIT, vec![]);
    c.gift("1".into(), gift_pk());
    as_contract(vec![PromiseResult::Failed]);
    assert!(!c.on_gift_key(gift_pk()));
    assert!(c.gift_of("1".into()).is_none(), "void");
    assert_eq!(paid_to("alice.testnet"), gift::GIFT_DEPOSIT.as_yoctonear(), "deposit back");
    assert!(!receipt_actions("pusaka.testnet").iter().any(|a| matches!(a, near_sdk::mock::MockAction::DeleteKey { .. })), "nothing deleted");
    withdraw(&mut c, "alice.testnet", &[0]); // unlocked
}

#[test]
#[should_panic(expected = "isn't confirmed")]
fn g7_an_unconfirmed_key_cannot_claim() {
    let mut c = setup();
    ctx("alice.testnet", gift::GIFT_DEPOSIT, vec![]);
    c.gift("1".into(), gift_pk());
    as_link(GIFT_PK);
    c.claim(acc("bob.testnet"));
}

#[test]
#[should_panic(expected = "isn't confirmed")]
fn g8_no_cancel_before_the_key_is_confirmed() {
    let mut c = setup();
    ctx("alice.testnet", gift::GIFT_DEPOSIT, vec![]);
    c.gift("1".into(), gift_pk());
    ctx("alice.testnet", NearToken::from_yoctonear(0), vec![]);
    c.cancel_gift("1".into());
}

#[test]
fn g8_a_key_confirmed_after_its_gift_ended_is_deleted() {
    let mut c = gifted();
    as_link(GIFT_PK);
    c.claim(acc("bob.testnet")); // gift over
    as_contract(vec![PromiseResult::Successful(vec![])]); // a late confirmation for the same key
    assert!(!c.on_gift_key(gift_pk()));
    assert!(receipt_actions("pusaka.testnet").iter().any(|a| matches!(a, near_sdk::mock::MockAction::DeleteKey { public_key, .. } if public_key.to_string() == GIFT_PK)));
}

// ---------- guardians: a quorum must approve the release, the holder can still cancel ----------

const WAIT: u64 = crate::RELEASE_WAIT_MS;

fn with_guardians() -> Pusaka {
    let mut c = with_heir();
    at("alice.testnet", PAY, 0);
    c.set_guardians("1".into(), vec![acc("g1.testnet"), acc("g2.testnet"), acc("g3.testnet")], 2);
    c
}

#[test]
#[should_panic(expected = "name an heir first")]
fn gd1_guardians_need_an_heir() {
    let mut c = setup();
    at("alice.testnet", PAY, 0);
    c.set_guardians("1".into(), vec![acc("g1.testnet")], 1);
}

#[test]
#[should_panic(expected = "a guardian can't be the holder or the heir")]
fn gd2_the_heir_cant_guard_their_own_claim() {
    let mut c = with_heir();
    at("alice.testnet", PAY, 0);
    c.set_guardians("1".into(), vec![acc("carol.testnet")], 1);
}

#[test]
#[should_panic(expected = "the guardians must approve the release first (0 of 2 so far)")]
fn gd3_with_guardians_silence_alone_is_not_enough() {
    let mut c = with_guardians();
    at("carol.testnet", NearToken::from_yoctonear(0), SILENCE);
    c.claim_inheritance("1".into());
}

#[test]
#[should_panic(expected = "guardians can approve from")]
fn gd4_guardians_cant_approve_while_the_holder_is_around() {
    let mut c = with_guardians();
    at("g1.testnet", NearToken::from_yoctonear(0), SILENCE - 1);
    c.approve_release("1".into());
}

#[test]
#[should_panic(expected = "only a named guardian can approve")]
fn gd5_strangers_cant_approve() {
    let mut c = with_guardians();
    at("mallory.testnet", NearToken::from_yoctonear(0), SILENCE);
    c.approve_release("1".into());
}

#[test]
fn gd6_quorum_then_the_waiting_period_then_the_heir() {
    let mut c = with_guardians();
    at("g1.testnet", NearToken::from_yoctonear(0), SILENCE);
    c.approve_release("1".into());
    assert!(c.guardians_of("1".into()).unwrap()["release_at_ms"].is_null(), "1 of 2: no release yet");
    at("g3.testnet", NearToken::from_yoctonear(0), SILENCE + 5);
    c.approve_release("1".into());
    assert_eq!(c.guardians_of("1".into()).unwrap()["release_at_ms"], (SILENCE + 5 + WAIT).to_string());
    at("carol.testnet", NearToken::from_yoctonear(0), SILENCE + 5 + WAIT);
    c.claim_inheritance("1".into());
    assert_eq!(owner(&c), acc("carol.testnet"));
    assert!(c.guardians_of("1".into()).is_none(), "the will is used up");
}

#[test]
#[should_panic(expected = "the guardians must approve the release first")]
fn gd7_claim_inside_the_waiting_period_is_refused() {
    let mut c = with_guardians();
    for g in ["g1.testnet", "g2.testnet"] {
        at(g, NearToken::from_yoctonear(0), SILENCE);
        c.approve_release("1".into());
    }
    at("carol.testnet", NearToken::from_yoctonear(0), SILENCE + WAIT - 1);
    c.claim_inheritance("1".into());
}

#[test]
fn gd8_the_holder_showing_up_voids_every_approval() {
    let mut c = with_guardians();
    for g in ["g1.testnet", "g2.testnet"] {
        at(g, NearToken::from_yoctonear(0), SILENCE);
        c.approve_release("1".into());
    }
    at("alice.testnet", NearToken::from_yoctonear(0), SILENCE + 60_000); // alive, inside the waiting period
    c.still_here("1".into());
    let g = c.guardians_of("1".into()).unwrap();
    assert_eq!(g["approvals"].as_array().unwrap().len(), 0);
    assert!(g["release_at_ms"].is_null());
    // the heir can't use the old quorum; a new silence needs new approvals
    at("carol.testnet", NearToken::from_yoctonear(0), SILENCE + WAIT + 1);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.claim_inheritance("1".into())));
    assert!(r.is_err());
}

#[test]
fn gd9_backstop_when_the_guardians_never_answer() {
    let mut c = with_guardians();
    at("carol.testnet", NearToken::from_yoctonear(0), 3 * SILENCE);
    c.claim_inheritance("1".into());
    assert_eq!(owner(&c), acc("carol.testnet"));
}

#[test]
fn gd10_a_new_holder_starts_with_no_guardians() {
    let mut c = with_guardians();
    at("alice.testnet", NearToken::from_yoctonear(1), 1);
    c.nft_transfer(acc("bob.testnet"), "1".into(), None, None);
    assert!(c.guardians_of("1".into()).is_none());
    assert!(c.heir_of("1".into()).is_none());
}
