// GET /api/audit?token_id=N[&contract=pusaka-btc.testnet] -> independent proof-of-reserves audit of one Pusaka, paid per call over x402 (HTTP 402).
// No payment: 402 with the requirements (PAYMENT-REQUIRED header and JSON body). With a PAYMENT-SIGNATURE header (a NEP-366
// SignedDelegate for one wNEAR ft_transfer to us): verify it, run the audit, and only then settle it on NEAR; our relayer
// pays the gas. The facilitator runs in-process: the public testnet one gates /verify and /settle behind a hand-issued key.
import { x402HTTPResourceServer } from "@x402/core/http";
import { createNearResourceServer } from "@fastnear/x402/server";
import { createNearFacilitator } from "@fastnear/x402/facilitator";
import { CONTRACT, SIBLINGS, NETWORK, NEAR_RPC } from "@pusaka/shared";
import { auditContract, auditToken, viewFinal } from "@pusaka/shared/audit";

export const X402_NETWORK = `near:${NETWORK}`;
// ponytail: wNEAR, not USDC: Circle's testnet USDC only comes from a web faucet; any NEP-141 works, payTo must be registered
export const PRICE = { amount: "1000000000000000000000", asset: NETWORK === "mainnet" ? "wrap.near" : "wrap.testnet" }; // 0.001 wNEAR

let paywall;
async function paywallServer() {
  if (paywall) return paywall;
  // X402_RELAYER_* if RELAYER_PRIVATE_KEY is a NEP-611 gas key: the x402 settler signs with plain full-access nonces
  const accountId = process.env.X402_RELAYER_ACCOUNT_ID ?? process.env.RELAYER_ACCOUNT_ID;
  const secretKey = process.env.X402_RELAYER_PRIVATE_KEY ?? process.env.RELAYER_PRIVATE_KEY;
  if (!accountId || !secretKey) throw Object.assign(new Error("x402 relayer is not configured"), { status: 503 });
  const facilitator = createNearFacilitator({ registrations: [{ network: X402_NETWORK,
    signer: { relayers: [{ accountId, secretKey }], rpcUrls: { [X402_NETWORK]: NEAR_RPC } } }] });
  const s = new x402HTTPResourceServer(createNearResourceServer({ facilitators: facilitator }), {
    // the fee goes to the relayer by default: it refills the account that sponsors the settlement gas
    accepts: { scheme: "exact", network: X402_NETWORK, price: PRICE, payTo: process.env.X402_PAY_TO ?? accountId, maxTimeoutSeconds: 120 },
    description: "Independent proof-of-reserves audit of one Pusaka: NEAR MPC key derivation, verified_sats recomputed, every deposit looked up on Bitcoin",
    mimeType: "application/json",
  });
  await s.initialize();
  return (paywall = s);
}

const adapter = (req) => {
  const url = new URL(req.url, `https://${req.headers.host ?? "localhost"}`);
  return {
    getHeader: (n) => req.headers[n.toLowerCase()], getMethod: () => req.method, getPath: () => url.pathname, getUrl: () => url.href,
    getAcceptHeader: () => req.headers.accept ?? "", getUserAgent: () => req.headers["user-agent"] ?? "",
    getQueryParams: () => Object.fromEntries(url.searchParams), getQueryParam: (n) => url.searchParams.get(n) ?? undefined,
  };
};

const send = (res, { status, headers = {}, body }) => {
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  // a browser gets x402's HTML paywall page as a string: send it as is, not as a JSON-escaped string
  if (typeof body === "string") return res.status(status).send(body);
  res.status(status).json(body ?? {});
};

export default async function handler(req, res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "payment-signature, x-payment, content-type");
  res.setHeader("access-control-expose-headers", "payment-required, payment-response");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  const q = new URL(req.url, "http://x").searchParams;
  const tokenId = q.get("token_id");
  if (!/^\d{1,9}$/.test(tokenId ?? "")) return res.status(400).json({ error: "?token_id=<number> required" });
  // the main contract or its frozen classic sibling, nothing else
  const contract = q.get("contract") ?? CONTRACT;
  if (![CONTRACT, ...SIBLINGS].includes(contract)) return res.status(400).json({ error: `contract must be one of ${[CONTRACT, ...SIBLINGS].join(", ")}` });
  try {
    // nothing is charged for a token that doesn't exist
    const info = await viewFinal("token_info", { token_id: tokenId }, contract);
    if (!info) return res.status(404).json({ error: `no Pusaka #${tokenId}` });
    const s = await paywallServer();
    const ctx = { adapter: adapter(req), path: new URL(req.url, "http://x").pathname, method: "GET" };
    const r = await s.processHTTPRequest(ctx);
    if (r.type === "payment-error") return send(res, r.response);
    const checks = [...await auditToken(tokenId, { info, contract }), ...await auditContract(contract)];
    // a Bitcoin explorer we couldn't reach is not a result: don't settle, the payer can retry with a fresh signature
    if (checks.some((c) => c.ok === null)) return res.status(503).json({ error: "a source was unreachable; not charged, retry", checks });
    const settled = await s.processSettlement(r.paymentPayload, r.paymentRequirements, r.declaredExtensions, { request: ctx });
    // say why instead of an empty 402: the client gets only the fixed reason code; the raw message (RPC details) stays in the log
    if (!settled.success) {
      console.error("x402 settlement failed:", settled.errorReason, String(settled.errorMessage ?? "").slice(0, 300));
      return send(res, { ...settled.response, body: { error: `payment not settled (${settled.errorReason}); check your wNEAR balance before retrying` } });
    }
    for (const [k, v] of Object.entries(settled.headers)) res.setHeader(k, v);
    res.status(200).json({ contract, token_id: tokenId, verdict: checks.every((c) => c.ok) ? "reserves verified" : "FAILED: do not rely on this Pusaka",
      checks, paid: { tx: settled.transaction, network: settled.network, payer: settled.payer } });
  } catch (e) {
    res.status(e.status ?? 502).json({ error: e.status ? e.message : "NEAR RPC unavailable" });
  }
}
