import assert from "node:assert/strict";
import { crossCheck } from "./btc.mjs";

const px = { btcUsd: 78000, nearUsd: 4, ethUsd: 2300 };
assert.equal(crossCheck(px, { bitcoin: { usd: 77500 }, near: { usd: 4.05 }, ethereum: { usd: 2310 } }).crossChecked, true);
assert.throws(() => crossCheck(px, { bitcoin: { usd: 90000 }, near: { usd: 4 } }), /disagree on btcUsd/);
assert.throws(() => crossCheck(px, { bitcoin: { usd: 78000 }, near: { usd: 3 } }), /disagree on nearUsd/);
assert.equal(crossCheck(px, null).crossChecked, false); // second source down: flagged, never silently "checked"

// mempool.space down, CoinGecko up: CoinGecko's BTC price stands in, never marked cross-checked
const realFetch = globalThis.fetch;
let tries = 0;
const json = (o) => new Response(JSON.stringify(o));
const ref = () => json({ "wrap.near": { price: "3.3" } });
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes("mempool")) { tries++; throw new TypeError("fetch failed"); }
  return u.includes("coingecko") ? json({ bitcoin: { usd: 70000 }, near: { usd: 3.3 }, ethereum: { usd: 1900 } }) : ref();
};
const { prices } = await import("./btc.mjs");
const fb = await prices();
assert.equal(fb.btcUsd, 70000);
assert.equal(fb.crossChecked, false);
assert.match(fb.source, /CoinGecko/);
assert.equal(tries, 2, "retried once");

// both down: the source that is down is named, after one retry, instead of a bare "fetch failed"
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes("mempool") || u.includes("coingecko")) throw new TypeError("fetch failed");
  return ref();
};
await assert.rejects(prices(), /price source mempool\.space unavailable \(fetch failed\)/);
globalThis.fetch = realFetch;
console.log("prices: cross-check accepts agreement, rejects >5% spread, flags a missing second source; CoinGecko stands in for a down mempool.space, unchecked");
