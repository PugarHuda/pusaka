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

const { heirSegment } = await import("./badge.mjs");
const now = Date.UTC(2026, 10, 14, 0, 0);
assert.deepEqual(heirSegment(null, now), ["no heir named", "#6b6b6b"]);
assert.equal(heirSegment({ claimable_from_ms: String(Date.UTC(2026, 10, 16, 2, 0)) }, now)[0], "heir claims 11-16 02:00Z (in 2d 2h 0m)");
assert.equal(heirSegment({ claimable_from_ms: String(now - 1) }, now)[0], "heir can claim now");
assert.match(badge("27", 7700, null, null, heirSegment({ claimable_from_ms: String(now + 90_000) }, now)), /heir claims 11-14 00:01Z \(in 0h 1m\)/);
assert.match(badge("4", 10_000, "clean", now), /clean @00:00Z/); // the clean badge is unchanged
console.log("heir badge: countdown, due, none");
