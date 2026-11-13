// Holder-room signatures are single use: a replayed nonce is refused until the signature would have expired.
import assert from "node:assert/strict";
import { claimNonce, seal, open } from "./_holder.mjs";

const t = 1_000_000;
assert.equal(claimNonce("n1", t, t), true);
assert.equal(claimNonce("n1", t, t + 1_000), false);           // replay inside the window
assert.equal(claimNonce("n2", t, t + 1_000), true);            // another signature is fine
assert.equal(claimNonce("n1", t, t + 5 * 60_000 + 1), true);   // forgotten once it would be expired anyway

// Other spellings of one nonce decode to the same bytes; verifyHolder rejects every non-canonical one before this point.
const n = Buffer.alloc(32, 7).toString("base64");
for (const variant of [` ${n}`, n.replace(/=+$/, ""), `${n}
`, n.replaceAll("/", "_")])
  assert.ok(Buffer.from(variant, "base64").toString("base64") !== variant || variant === n, `variant accepted: ${JSON.stringify(variant)}`);
console.log("holder room: a signed message opens it once; only the canonical nonce spelling is accepted");

// a legacy letter is keyed to its contract: a classic Pusaka's letter opens with the classic key, never with another's
process.env.LETTER_SECRET ??= "test-secret";
const sealed = seal("7", "for the next holder", "pusaka-btc.testnet");
assert.equal(open("7", sealed, "pusaka-btc.testnet"), "for the next holder");
assert.throws(() => open("7", sealed, "pusaka-v2.testnet"));
assert.throws(() => open("8", sealed, "pusaka-btc.testnet")); // and it can't be pasted onto another Pusaka
console.log("holder room: legacy letters open with their own contract's key only");
