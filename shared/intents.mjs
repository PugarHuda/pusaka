// NEAR Intents 1Click: what a Pusaka's BTC would really fetch, as a solver-signed quote. `dry: true` asks the
// solvers for a binding-format quote but opens no deposit address, so nothing can be sent or lost.
// ponytail: 1Click only quotes mainnet liquidity; on testnet this prices the same amount of real BTC.
export const ONECLICK = "https://1click.chaindefuser.com/v0";
export const INTENTS_BTC = "nep141:btc.omft.near";
export const INTENTS_USDC_BASE = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";

/** The request body: EXACT_INPUT `sats` of BTC to USDC on Base, paid to `evm` (the Pusaka's own EVM address). */
export function exitQuoteRequest(sats, evm, now = Date.now()) {
  if (!(Number(sats) > 0)) throw new Error("nothing to quote");
  if (!/^0x[0-9a-fA-F]{40}$/.test(evm)) throw new Error("recipient must be an EVM address");
  return {
    dry: true, swapType: "EXACT_INPUT", slippageTolerance: 100, // 1%
    originAsset: INTENTS_BTC, depositType: "ORIGIN_CHAIN", amount: String(sats),
    destinationAsset: INTENTS_USDC_BASE, recipient: evm, recipientType: "DESTINATION_CHAIN",
    // a refund stays inside NEAR Intents under the same address; a testnet tb1 refund address isn't accepted
    refundTo: evm.toLowerCase(), refundType: "INTENTS", // an Intents account is the lower-case address
    deadline: new Date(now + 3_600_000).toISOString(),
  };
}

/** Live quote: { usdc, minUsdc, usdIn, seconds, signature, id }. Throws with 1Click's message on refusal. */
export async function exitQuote(sats, evm) {
  const r = await fetch(`${ONECLICK}/quote`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(exitQuoteRequest(sats, evm)), signal: AbortSignal.timeout(15_000),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || !body.quote) throw new Error(`NEAR Intents: ${body.message ?? `HTTP ${r.status}`}`);
  const q = body.quote;
  return {
    usdc: Number(q.amountOutFormatted), minUsdc: Number(q.minAmountOut) / 1e6, usdIn: Number(q.amountInUsd),
    seconds: q.timeEstimate, signature: body.signature, id: body.correlationId,
  };
}
