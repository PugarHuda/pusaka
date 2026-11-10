// node api/_audit.test.mjs: /api/audit answers 402 with x402 v2 NEAR requirements until paid (reads testnet, spends nothing).
import assert from "node:assert/strict";
import { KeyPair } from "near-api-js";
import { decodePaymentRequiredHeader } from "@x402/core/http";

process.env.RELAYER_ACCOUNT_ID ??= "pusaka-relayer.testnet";
process.env.RELAYER_PRIVATE_KEY ??= KeyPair.fromRandom("ed25519").toString(); // never used: nothing gets settled here
const { default: handler, PRICE, X402_NETWORK } = await import("./audit.mjs");

const call = (url, headers = {}) => new Promise((done) => {
  const out = { headers: {} };
  const res = { setHeader: (k, v) => (out.headers[k.toLowerCase()] = v), status: (s) => ((out.status = s), res),
    json: (b) => done({ ...out, body: b }), end: () => done(out) };
  handler({ method: "GET", url, headers: { host: "pusaka.test", ...headers } }, res);
});

assert.equal((await call("/api/audit")).status, 400, "token_id required");
assert.equal((await call("/api/audit?token_id=999999999")).status, 404, "no charge for a missing token");

const r = await call("/api/audit?token_id=1");
assert.equal(r.status, 402);
const req = decodePaymentRequiredHeader(r.headers["payment-required"]);
assert.equal(req.x402Version, 2);
assert.equal(req.accepts.length, 1);
const [a] = req.accepts;
assert.equal(a.scheme, "exact");
assert.equal(a.network, X402_NETWORK);
assert.equal(a.asset, PRICE.asset);
assert.equal(a.amount, PRICE.amount);
assert.equal(a.payTo, process.env.X402_PAY_TO ?? process.env.RELAYER_ACCOUNT_ID);
assert.match(req.resource.url, /\/api\/audit\?token_id=1$/);

const bad = await call("/api/audit?token_id=1", { "payment-signature": "bm90IGEgcGF5bWVudA==" });
assert.equal(bad.status, 402, "garbage payment header is not access");
console.log("x402 audit paywall ok");
