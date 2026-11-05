import assert from "node:assert/strict";
import { btcFetch, ESPLORA, nearFetch, NEAR_RPCS } from "./btc.mjs";

const hits = [];
const answer = (first) => async (url) => {
  hits.push(new URL(url).host);
  if (url.startsWith(ESPLORA[0])) { if (first instanceof Error) throw first; return new Response("", { status: first }); }
  return new Response("[]", { status: 200 });
};
for (const first of [new Error("timeout"), 503, 429]) {
  hits.length = 0; globalThis.fetch = answer(first);
  assert.equal((await btcFetch("/address/x/utxo")).status, 200);
  assert.equal(hits.length, 2, `fails over on ${first}`);
  hits.length = 0; // the failed endpoint now waits its turn: the next request goes straight to the fallback
  assert.equal((await btcFetch("/address/y/utxo")).status, 200);
  assert.deepEqual(hits, [new URL(ESPLORA[1]).host], `skips the endpoint that just failed (${first})`);
  globalThis.fetch = async (url) => { hits.push(new URL(url).host); return new Response("[]", { status: url.startsWith(ESPLORA[1]) ? 503 : 200 }); };
  hits.length = 0; // fallback fails too: the first endpoint is still tried, and works again
  assert.equal((await btcFetch("/address/z/utxo")).status, 200);
  assert.equal(hits.length, 2);
  hits.length = 0; await btcFetch("/address/w/utxo"); // it answered, so it is first again
  assert.equal(hits[0], new URL(ESPLORA[0]).host);
}
hits.length = 0; globalThis.fetch = answer(400); // a rejected tx is the answer, not an outage
assert.equal((await btcFetch("/tx", { method: "POST", body: "00" })).status, 400);
assert.equal(hits.length, 1);
// NEAR RPC: a hung endpoint (it never answers; only the timeout signal ends it) fails over to the next one
hits.length = 0;
globalThis.fetch = (url, init) => { hits.push(url); if (url !== NEAR_RPCS[0]) return Promise.resolve(new Response("{}")); assert.ok(init.signal, "every RPC call carries a timeout");
  return new Promise((_, no) => init.signal.addEventListener("abort", () => no(init.signal.reason))); };
const ac = new AbortController(); setTimeout(() => ac.abort(new Error("timeout")), 50);
assert.equal((await nearFetch({ method: "POST", body: "{}", signal: ac.signal })).status, 200);
assert.deepEqual(hits, NEAR_RPCS.slice(0, 2));
console.log("esplora: fails over on timeout/5xx/429 (and remembers it), never on a 4xx answer");
