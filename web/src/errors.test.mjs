import assert from "node:assert/strict";
import { explain } from "./errors.js";
assert.equal(explain("NotOwner"), "Only the current holder of this Pusaka can do that. (NotOwner)");
assert.equal(explain("Approved: call nft_revoke_all first"), "Approved: call nft_revoke_all first"); // already a sentence
assert.equal(explain("SomethingNew"), "SomethingNew"); // unknown codes are shown as they are, never hidden
assert.equal(explain("deposit below the minimum that can be proven"), "deposit below the minimum that can be proven");
console.log("errors: contract codes read as sentences, unknown ones pass through");
// real panics from pusaka-btc.testnet (claim_inheritance CoteHaM8…, apply AjDJAVuJ…): epoch ms become a date
assert.doesNotMatch(explain("the holder was seen recently; claimable from 1793986788279 ms"), /\d{13}/);
assert.match(explain("TooEarly: deployable from 1793938919819 ms"), /^TooEarly: deployable from .*2026/);
