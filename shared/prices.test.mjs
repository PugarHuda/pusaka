import assert from "node:assert/strict";
import { crossCheck } from "./btc.mjs";

const px = { btcUsd: 78000, nearUsd: 4, ethUsd: 2300 };
assert.equal(crossCheck(px, { bitcoin: { usd: 77500 }, near: { usd: 4.05 }, ethereum: { usd: 2310 } }).crossChecked, true);
assert.throws(() => crossCheck(px, { bitcoin: { usd: 90000 }, near: { usd: 4 } }), /disagree on btcUsd/);
assert.throws(() => crossCheck(px, { bitcoin: { usd: 78000 }, near: { usd: 3 } }), /disagree on nearUsd/);
assert.equal(crossCheck(px, null).crossChecked, false); // second source down: flagged, never silently "checked"
console.log("prices: cross-check accepts agreement, rejects >5% spread, flags a missing second source");
