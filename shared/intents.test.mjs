import assert from "node:assert/strict";
import { exitQuoteRequest, exitQuote, INTENTS_BTC } from "./btc.mjs";
const realFetch = globalThis.fetch;

const evm = "0x50d7e8e0cc4b9ad5a1c3e30d1ea7d6a2d4f5e795";
const req = exitQuoteRequest(101446, evm, 0);
assert.equal(req.dry, true, "never opens a deposit address");
assert.equal(req.originAsset, INTENTS_BTC);
assert.equal(req.amount, "101446");
assert.equal(req.recipient, evm);
assert.equal(exitQuoteRequest(1, "0x578C38A22c2BB08b07b45451f65A7CD4daC50Ba8").refundTo, "0x578c38a22c2bb08b07b45451f65a7cd4dac50ba8", "1Click refuses a checksummed Intents account");
assert.throws(() => exitQuoteRequest(0, evm), /nothing to quote/);
assert.throws(() => exitQuoteRequest(1000, "tb1qxyz"), /EVM address/);

// a refusal surfaces 1Click's own reason
globalThis.fetch = async () => new Response(JSON.stringify({ message: "Amount is too low for bridge" }), { status: 400 });
await assert.rejects(exitQuote(10_000, evm), /NEAR Intents: Amount is too low/);
// below 1Click's minimum nothing is asked at all (no 400 in the console)
globalThis.fetch = async () => { throw new Error("must not be called"); };
await assert.rejects(exitQuote(3_400, evm), /below its minimum for Bitcoin/);
globalThis.fetch = async (_, init) => {
  assert.equal(JSON.parse(init.body).dry, true);
  return new Response(JSON.stringify({ quote: { amountOutFormatted: "76.84", minAmountOut: "76074467", amountInUsd: "77.05", timeEstimate: 807 }, signature: "ed25519:x", correlationId: "c" }));
};
const q = await exitQuote(101446, evm);
assert.deepEqual([q.usdc, q.minUsdc, q.seconds], [76.84, 76.074467, 807]);
console.log("intents: dry 1Click quote request, parsed answer, refusals keep their reason");

// executed swaps on testnet (Tidepool), against the live testnet4 explorer
globalThis.fetch = realFetch;
import { swapRequest, testnet4Coins } from "./btc.mjs";
const P21 = "tb1qk6djgvag8jlhs2ra9nj2v27fr3cu5jla03tksv";
const sr = swapRequest(20_000, "pusaka-s-mw5sfoai.testnet", P21, 0);
assert.equal(sr.dry, false); assert.equal(sr.refundTo, P21); assert.equal(sr.refundType, "ORIGIN_CHAIN");
assert.throws(() => swapRequest(9_999, "a.testnet", P21), /10,000 sats/);
assert.throws(() => swapRequest(20_000, "0xabc Name", P21), /NEAR account/);
await assert.rejects(testnet4Coins("nope", P21), /transaction id/);
// the faucet funding of #21 was spent by the executed swap; its change came back to #21
assert.deepEqual(await testnet4Coins("55692f2411be934c7891a6a13717b9bfac874627c14013e2bf2e6f2c9f381499", P21), []);
const change = await testnet4Coins("52a0adcd39318ffc9137a598f8c99d3a3d126914ab58fa92d04c5fd5e8cf4fe0", P21);
assert.ok(change.every((u) => u.to === P21) && change.length <= 1);
console.log("tidepool helpers ok; #21 change outputs:", change.map((u) => u.value));
