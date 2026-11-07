import assert from "node:assert/strict";
import { crossCheck } from "./btc.mjs";

const px = { btcUsd: 78000, nearUsd: 4, ethUsd: 2300 };
assert.equal(crossCheck(px, { bitcoin: { usd: 77500 }, near: { usd: 4.05 }, ethereum: { usd: 2310 } }).crossChecked, true);
assert.throws(() => crossCheck(px, { bitcoin: { usd: 90000 }, near: { usd: 4 } }), /disagree on btcUsd/);
assert.throws(() => crossCheck(px, { bitcoin: { usd: 78000 }, near: { usd: 3 } }), /disagree on nearUsd/);
assert.equal(crossCheck(px, null).crossChecked, false); // second source down: flagged, never silently "checked"
// a source that is down is named, after one retry, instead of a bare "fetch failed"
const realFetch = globalThis.fetch;
let tries = 0;
globalThis.fetch = async (url) => { if (String(url).includes("mempool")) { tries++; throw new TypeError("fetch failed"); } return realFetch(url); };
const { prices } = await import("./btc.mjs");
await assert.rejects(prices(), /price source mempool\.space unavailable \(fetch failed\)/);
assert.equal(tries, 2, "retried once");
globalThis.fetch = realFetch;
console.log("prices: cross-check accepts agreement, rejects >5% spread, flags a missing second source");
