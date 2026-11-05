import assert from "node:assert/strict";
import { exitQuoteRequest, exitQuote, INTENTS_BTC } from "./btc.mjs";

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
await assert.rejects(exitQuote(1, evm), /NEAR Intents: Amount is too low/);
globalThis.fetch = async (_, init) => {
  assert.equal(JSON.parse(init.body).dry, true);
  return new Response(JSON.stringify({ quote: { amountOutFormatted: "76.84", minAmountOut: "76074467", amountInUsd: "77.05", timeEstimate: 807 }, signature: "ed25519:x", correlationId: "c" }));
};
const q = await exitQuote(101446, evm);
assert.deepEqual([q.usdc, q.minUsdc, q.seconds], [76.84, 76.074467, 807]);
console.log("intents: dry 1Click quote request, parsed answer, refusals keep their reason");
