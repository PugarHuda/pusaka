// Holder-room signatures are single use: a replayed nonce is refused until the signature would have expired.
import assert from "node:assert/strict";
import { claimNonce } from "./_holder.mjs";

const t = 1_000_000;
assert.equal(claimNonce("n1", t, t), true);
assert.equal(claimNonce("n1", t, t + 1_000), false);           // replay inside the window
assert.equal(claimNonce("n2", t, t + 1_000), true);            // another signature is fine
assert.equal(claimNonce("n1", t, t + 5 * 60_000 + 1), true);   // forgotten once it would be expired anyway
console.log("holder room: a signed message opens it once");
