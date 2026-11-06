// node api/_relayer.test.mjs: the relayer only pays for an accept_loan_offer the contract would take.
import assert from "node:assert/strict";
import { acceptWouldSucceed } from "./_relayer.mjs";

const info = { sign_epoch: 3, verified_sats: "10000", listing: null, pending: null, loan: null };
const any = { lender: "bob", token_id: null, min_verified_sats: "10000", principal: "100", sign_epoch: null };
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
assert.ok(!ok({ ...info, pending: {} }, any), "signature in flight");
assert.ok(!ok({ ...info, loan: { borrower: "alice", lender: null, repay: "50" } }, any), "open request isn't refinanced");
assert.ok(ok({ ...info, loan: { borrower: "alice", lender: "carol", repay: "100" } }, any), "refinance the offer pays off");
assert.ok(!ok({ ...info, loan: { borrower: "alice", lender: "carol", repay: "101" } }, any), "refinance needs a top-up: not gas-free");
console.log("relayer accept preflight ok");
