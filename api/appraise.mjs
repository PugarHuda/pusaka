// GET /api/appraise?id=N -> a short appraisal of one Pusaka, written by a model running in a NEAR AI Cloud TEE,
// with the evidence: the gateway's and the model's attestation verified for a fresh nonce before the request,
// and the model TEE's signature over the exact request and response bytes checked after it (api/_nearai.mjs).
// GET /api/appraise?status=1 -> { configured, model }. The appraisal needs NEARAI_API_KEY on the deployment.
import { prices } from "@pusaka/shared";
import { viewFinal } from "@pusaka/shared/audit";
import { verifiedCompletion, NEARAI_MODEL } from "./_nearai.mjs";

// ponytail: per instance; caps credit spend if the page is hammered. A firewall rule is the upgrade path.
const CACHE_MS = 15 * 60_000, MAX_PER_HOUR = 60;
const cache = new Map();
let quota = { start: Date.now(), n: 0 };

const pctLabel = (d) => `${Math.abs(Math.round(d * 1000) / 10)}% ${d < 0 ? "below" : "above"} the value of the BTC inside`;

/** Only on-chain facts (and two market prices) go to the model; it is told to use nothing else. */
async function facts(id) {
  const [info, px] = await Promise.all([viewFinal("token_info", { token_id: id }), prices().catch(() => null)]);
  if (!info) return null;
  const sats = Number(info.verified_sats), yocto = (y) => Number(BigInt(y) / 10n ** 18n) / 1e6;
  const listed = info.listing && yocto(info.price_now ?? info.listing.price);
  const holders = [...new Set(info.history.flatMap(({ event: e }) => [e.owner, e.from, e.to].filter(Boolean)))];
  return {
    key: `${id}:${info.sign_epoch}:${sats}:${info.token.owner_id}:${listed ?? ""}:${info.loan?.lender ?? info.loan?.principal ?? ""}`,
    data: {
      pusaka: Number(id), network: "NEAR testnet (Bitcoin testnet3)", owner: info.token.owner_id,
      verified_btc_sats: sats, verified_by: "NEAR's on-chain Bitcoin light client; never signed away",
      proven_deposits: info.proven_utxos.length, outpoints_ever_signed: info.signed_outpoints.length, signing_in_progress: info.pending,
      btc_usd: px?.btcUsd ?? null, near_usd: px?.nearUsd ?? null,
      btc_inside_usd: px ? Math.round(sats / 1e8 * px.btcUsd * 100) / 100 : null,
      for_sale_near: listed ?? null, dutch_auction: !!info.listing && info.listing.floor !== info.listing.price,
      // arithmetic done here, not by the model: it quotes these numbers
      for_sale_usd: px && listed ? Math.round(listed * px.nearUsd * 100) / 100 : null,
      price_vs_btc_inside: px && listed && sats ? pctLabel(listed * px.nearUsd / (sats / 1e8 * px.btcUsd) - 1) : null,
      loan_to_value: px && info.loan && sats ? `${Math.round(yocto(info.loan.principal) * px.nearUsd / (sats / 1e8 * px.btcUsd) * 1000) / 10}%` : null,
      loan: info.loan ? { principal_near: yocto(info.loan.principal), repay_near: yocto(info.loan.repay), funded: !!info.loan.lender, due_ms: info.loan.due_ms ?? null } : null,
      approved_outside_markets: Object.keys(info.token.approved_account_ids ?? {}),
      history_entries: info.history.length, distinct_holders_seen: holders.length,
    },
  };
}

const SYSTEM = "You appraise one Pusaka: a NEAR NFT that controls a native Bitcoin address. Use only the JSON facts you are given; never compute or invent numbers: quote the given ones (price_vs_btc_inside, loan_to_value, *_usd) exactly. "
  + "Prices are mainnet market prices applied to testnet balances; say so once. Answer in at most 6 short lines, each starting with '- ': "
  + "the BTC inside and its USD value; the asking price against that value (if for sale); loan exposure and loan-to-value (if any); "
  + "anything that limits a buyer (signing in progress, outside-market approvals, loan collateral); its history in one line; a one-line verdict.";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  res.setHeader("cache-control", "no-store");
  const configured = !!process.env.NEARAI_API_KEY;
  if (req.query.status) return res.status(200).json({ configured, model: NEARAI_MODEL });
  if (!configured) return res.status(503).json({ error: "This deployment has no NEAR AI Cloud key (NEARAI_API_KEY)." });
  const id = String(req.query.id ?? "");
  if (!/^\d{1,9}$/.test(id)) return res.status(400).json({ error: "id must be a token id" });
  try {
    const f = await facts(id);
    if (!f) return res.status(404).json({ error: `no Pusaka #${id}` });
    const hit = cache.get(f.key);
    if (hit && Date.now() - hit.at < CACHE_MS) return res.status(200).json({ ...hit.body, cached: true });
    if (Date.now() - quota.start > 3_600_000) quota = { start: Date.now(), n: 0 };
    if (++quota.n > MAX_PER_HOUR) return res.status(429).json({ error: "Too many appraisals this hour; try again later." });
    const out = await verifiedCompletion([{ role: "system", content: SYSTEM }, { role: "user", content: JSON.stringify(f.data) }]);
    const body = { id: Number(id), facts: f.data, ...out };
    cache.set(f.key, { at: Date.now(), body });
    res.status(200).json(body);
  } catch (e) {
    res.status(502).json({ error: String(e.message ?? e).slice(0, 300) });
  }
}
