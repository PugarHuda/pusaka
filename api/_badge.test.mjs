import assert from "node:assert/strict";
import { badge } from "./badge.mjs";

const plain = badge("4", 10_000);
assert.match(plain, /Pusaka #4: 0\.00010000 BTC verified"/);
assert.doesNotMatch(plain, /clean/);
assert.match(badge("4", 10_000, "clean", Date.UTC(2026, 10, 13, 9, 12)), /, clean @09:12Z".*#2e7d32/s); // when it was checked, on the badge
assert.match(badge("4", 10_000, "risk"), /not clean/);
assert.match(badge("4", 10_000, "anything else"), /clean: unchecked/); // never says clean unless the check said so
assert.match(badge("<x>", 1), /&#60;x&#62;/); // escaped
console.log("badge: clean / not clean / unchecked segments, escaped");

const { attestation } = await import("./badge.mjs");
const at = Date.UTC(2026, 10, 13, 9, 12);
const ok = attestation("4", "pusaka-btc.testnet", 10_000, { verdict: "clean", checks: [{ ok: true, what: "w", detail: "d", extra: 1 }] }, at);
assert.equal(ok.standard, "pusaka-clean"); assert.equal(ok.verdict, "clean"); assert.equal(ok.verified_sats, "10000");
assert.equal(ok.checked_at, "2026-11-13T09:12:00.000Z"); assert.deepEqual(ok.checks, [{ ok: true, what: "w", detail: "d" }]);
assert.equal(attestation("4", "c", 1, null, at).verdict, "unknown"); // no check = not clean
assert.equal(attestation("4", "c", 1, { verdict: "weird" }, at).verdict, "unknown");
console.log("attestation: pusaka-clean/1 JSON, fail closed");
