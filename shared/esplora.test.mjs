import assert from "node:assert/strict";
import { btcFetch, ESPLORA } from "./btc.mjs";

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
}
hits.length = 0; globalThis.fetch = answer(400); // a rejected tx is the answer, not an outage
assert.equal((await btcFetch("/tx", { method: "POST", body: "00" })).status, 400);
assert.equal(hits.length, 1);
console.log("esplora: fails over on timeout/5xx/429, never on a 4xx answer");
