import assert from "node:assert/strict";
import { badge } from "./badge.mjs";

const plain = badge("4", 10_000);
assert.match(plain, /Pusaka #4: 0\.00010000 BTC verified"/);
assert.doesNotMatch(plain, /clean/);
assert.match(badge("4", 10_000, "clean", 0), /, clean".*#2e7d32/s);
assert.match(badge("4", 10_000, "risk"), /not clean/);
assert.match(badge("4", 10_000, "anything else"), /clean: unchecked/); // never says clean unless the check said so
assert.match(badge("<x>", 1), /&#60;x&#62;/); // escaped
console.log("badge: clean / not clean / unchecked segments, escaped");
