// node api/_prices.test.mjs (underscore: Vercel must not serve it as an endpoint): the last good answer covers a source failure, marked stale; nothing good yet means 502.
import assert from "node:assert/strict";
import handler from "./prices.mjs";

const res = () => { const r = { headers: {}, setHeader(k, v) { r.headers[k] = v; return r; }, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } }; return r; };
const real = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("down"); };
const call = async () => { const r = res(); await handler({ method: "GET" }, r); return r; };
let r = await call();
assert.equal(r.code, 502);
globalThis.fetch = async (u) => ({ ok: true, json: async () => (String(u).includes("mempool") ? { USD: 100000, time: 1 }
  : String(u).includes("ref.finance") ? { "wrap.near": { price: "3" } } : { bitcoin: { usd: 100500 }, near: { usd: 3.02 } }) });
r = await call();
assert.equal(r.code, 200); assert.equal(r.body.crossChecked, true); assert.ok(!r.body.stale);
globalThis.fetch = async () => { throw new Error("down"); };
r = await call();
assert.equal(r.code, 200); assert.equal(r.body.stale, true); assert.equal(r.body.btcUsd, 100000); assert.equal(r.headers["cache-control"], "no-store");
globalThis.fetch = real;
console.log("prices api ok");
