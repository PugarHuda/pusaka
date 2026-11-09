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
    body: JSON.stringify(exitQuoteRequest(sats, evm)), signal: AbortSignal.timeout(30_000), // 1Click gives up on its solvers after 25 s
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || !body.quote) throw new Error(`NEAR Intents: ${body.message ?? `HTTP ${r.status}`}`);
  const q = body.quote;
  return {
    usdc: Number(q.amountOutFormatted), minUsdc: Number(q.minAmountOut) / 1e6, usdIn: Number(q.amountInUsd),
    seconds: q.timeEstimate, signature: body.signature, id: body.correlationId,
  };
}

// ---------- executed swaps on testnet ----------
// 1Click has no testnet. Tidepool (usetidepool.tech) serves the same /quote, /deposit/submit and /status API on
// testnet, settling through NEAR's unmodified `defuse` verifier (verifier.tidepool-sandbox.testnet). Its Bitcoin
// side is testnet4 with a custodial test relayer: Tidepool's trust model, not Pusaka's (disclosed in README).
// The same tb1 address and MPC key hold coins on testnet3 and testnet4.
export const TIDEPOOL = "https://www.usetidepool.tech/v0";
export const TESTNET4 = "https://mempool.emzy.de/testnet4/api"; // Esplora without /address: coins are found by funding txid
export const TIDEPOOL_BTC = "nep141:btc.tp-omft.testnet";
export const TIDEPOOL_USDC = "nep141:usdc.tidepool-sandbox.testnet";

const ok = async (r) => {
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`NEAR Intents (Tidepool): ${b.message ?? `HTTP ${r.status}`}`);
  return b;
};

/** Confirmed, unspent outputs of testnet4 tx `txid` paying `address`. */
export async function testnet4Coins(txid, address) {
  if (!/^[0-9a-f]{64}$/i.test(txid.trim())) throw new Error("That isn't a Bitcoin transaction id (64 hex characters).");
  const get = (p) => fetch(`${TESTNET4}${p}`).then((r) => { if (!r.ok) throw new Error(`testnet4 explorer answered ${r.status}`); return r.json(); });
  const [tx, spends] = await Promise.all([get(`/tx/${txid.trim()}`), get(`/tx/${txid.trim()}/outspends`)]);
  if (!tx.status?.confirmed) throw new Error("That testnet4 transaction has no confirmation yet. Try again after the next block.");
  return tx.vout.map((o, vout) => ({ txid: txid.trim().toLowerCase(), vout, value: o.value, to: o.scriptpubkey_address }))
    .filter((u, i) => u.to === address && !spends[i]?.spent);
}

/** The request for a live (dry: false) BTC -> USDC-on-NEAR quote; refunds go back to the Pusaka's own address. */
export function swapRequest(sats, recipient, refundTo, now = Date.now()) {
  if (!(Number(sats) >= 10_000)) throw new Error("Tidepool's Bitcoin route takes at least 10,000 sats.");
  if (!/^[a-z0-9._-]+$/.test(recipient)) throw new Error("recipient must be a NEAR account");
  return {
    dry: false, swapType: "EXACT_INPUT", slippageTolerance: 100, originAsset: TIDEPOOL_BTC, depositType: "ORIGIN_CHAIN",
    amount: String(sats), destinationAsset: TIDEPOOL_USDC, recipient, recipientType: "DESTINATION_CHAIN",
    refundTo, refundType: "ORIGIN_CHAIN", deadline: new Date(now + 3_600_000).toISOString(),
  };
}

/** Opens a deposit address: { depositAddress, usdc, minUsdc, seconds, id }. */
export async function swapQuote(sats, recipient, refundTo) {
  const b = await fetch(`${TIDEPOOL}/quote`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(swapRequest(sats, recipient, refundTo)), signal: AbortSignal.timeout(30_000) }).then(ok);
  const q = b.quote;
  if (!q?.depositAddress) throw new Error("NEAR Intents (Tidepool): no deposit address in the quote");
  return { depositAddress: q.depositAddress, usdc: Number(q.amountOutFormatted), minUsdc: Number(q.minAmountOut) / 1e6, seconds: q.timeEstimate, id: b.correlationId };
}

export async function broadcastTestnet4(hex) {
  const r = await fetch(`${TESTNET4}/tx`, { method: "POST", body: hex });
  const t = await r.text();
  if (!r.ok) throw new Error(`testnet4 rejected the transaction: ${t}`);
  return t.trim();
}

export const submitDeposit = (txHash, depositAddress) => fetch(`${TIDEPOOL}/deposit/submit`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ txHash, depositAddress }) }).then(ok);

export const swapStatus = (depositAddress) => fetch(`${TIDEPOOL}/status?depositAddress=${encodeURIComponent(depositAddress)}`).then(ok);
export const SWAP_DONE = ["SUCCESS", "REFUNDED", "FAILED"];
