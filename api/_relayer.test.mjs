// node api/_relayer.test.mjs: the relayer only pays for an accept_loan_offer the contract would take.
import assert from "node:assert/strict";
import { acceptWouldSucceed } from "./_relayer.mjs";

const info = { sign_epoch: 3, verified_sats: "10000", listing: null, pending: false, loan: null, btc_pubkey: "02ab", token: { approved_account_ids: {} } };
const any = { lender: "bob", token_id: null, min_verified_sats: "10000", principal: "10000000000000000000000", sign_epoch: null };
const mine = { ...any, token_id: "7", min_verified_sats: null, sign_epoch: 3 };
const args = { token_id: "7", offer_id: "1", expected_sign_epoch: 3 };
const ok = (i, o, a = args, who = "alice") => acceptWouldSucceed(i, o, who, a);
assert.ok(ok(info, any));
assert.ok(ok(info, mine));
assert.ok(!ok(info, null), "no such offer");
assert.ok(!ok(info, any, args, "bob"), "own offer");
assert.ok(!ok({ ...info, verified_sats: "9999" }, any), "below the sats floor");
assert.ok(!ok(info, { ...mine, token_id: "8" }), "offer for another token");
assert.ok(!ok({ ...info, sign_epoch: 4 }, mine, { ...args, expected_sign_epoch: 4 }), "signed since the offer");
assert.ok(!ok(info, any, { ...args, expected_sign_epoch: 2 }), "stale expected epoch");
assert.ok(!ok({ ...info, listing: {} }, any), "listed");
assert.ok(!ok({ ...info, pending: true }, any), "signature or transfer_call in flight");
assert.ok(!ok({ ...info, loan: { borrower: "alice", lender: null, repay: "50" } }, any), "open request isn't refinanced");
assert.ok(ok({ ...info, loan: { borrower: "alice", lender: "carol", repay: "10000000000000000000000" } }, any), "refinance the offer pays off");
assert.ok(!ok({ ...info, loan: { borrower: "alice", lender: "carol", repay: "10000000000000000000001" } }, any), "refinance needs a top-up: not gas-free");
assert.ok(!ok(info, { ...any, principal: "9999999999999999999999" }), "dust offer: farming, not a loan");
assert.ok(!ok({ ...info, btc_pubkey: null }, any), "key not derived yet");
assert.ok(!ok({ ...info, token: { approved_account_ids: { "market.testnet": 1 } } }, any), "NEP-178 approval");
assert.ok(!ok(info, any, { ...args, expected_sign_epoch: "3" }), "epoch must be a number");
assert.ok(!ok(info, any, { ...args, offer_id: 1 }), "offer id must be a string");
assert.ok(!ok(info, any, { ...args, extra: 1 }), "unknown keys");
console.log("relayer accept preflight ok");
