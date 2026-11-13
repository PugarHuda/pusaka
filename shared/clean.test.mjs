import assert from "node:assert/strict";
import { cleanChecks, verdict } from "./clean.mjs";

const info = { btc_pubkey: "02ab", pending: false, signed_outpoints: [{}], loan: null, token: { approved_account_ids: {} } };
const chain = (atRisk = 0n) => ({ c: { chain: { name: "Base Sepolia" } }, atRisk, usdcAtRisk: 0n });
const base = { info, bal: { atRisk: 0 }, eth: { chains: [chain()] }, sol: { atRisk: 0n }, nearAcct: { atRisk: 0n, floor: 3n } };

assert.equal(verdict(cleanChecks(base)), "clean");
assert.equal(verdict(cleanChecks({ ...base, info: { ...info, pending: true } })), "risk");
assert.equal(verdict(cleanChecks({ ...base, bal: { atRisk: 500 } })), "clean"); // already not counted
assert.equal(verdict(cleanChecks({ ...base, eth: { chains: [chain(1n)] } })), "risk");
assert.equal(verdict(cleanChecks({ ...base, nearAcct: { atRisk: 5n, floor: 3n } })), "risk");
assert.equal(verdict(cleanChecks({ ...base, info: { ...info, loan: { lender: "l.testnet" } } })), "risk");
assert.equal(verdict(cleanChecks({ info, bal: { atRisk: 0 } })), "unknown"); // chains not read yet: never clean
assert.equal(verdict(cleanChecks({ ...base, bal: { loading: true } })), "unknown");
assert.equal(verdict(cleanChecks({ ...base, eth: { chains: [{ c: { chain: { name: "x" } }, error: true }] } })), "unknown");
console.log("clean.test: ok");
