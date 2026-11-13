// GET -> { btcUsd, nearUsd, ethUsd, at }: live market prices for the browser (Rhea's API has no CORS).
// POST -> the lending pool's reporters post BTC/USD if their reports are older than 30 minutes: the pool's price is
// refreshed whenever someone opens a token page, not by a cron (GitHub ran ours hours late). Keys: LEND_REPORTER_KEYS,
// one per reporter, each able to call only report_price on pusaka-lend.testnet.
import { Account, FailoverRpcProvider, JsonRpcProvider } from "near-api-js";
import { prices, nearProvider } from "@pusaka/shared";
import { LEND, SOURCES, sourcePrice } from "@pusaka/shared/lendprice";

// A source hiccup (timeout, rate limit) shouldn't blank every dollar figure: serve this instance's last good
// answer for up to 10 minutes, marked stale. ponytail: per instance; a cold instance with no good answer still 502s.
const STALE_MS = 10 * 60_000;
let last = null;

const REFRESH_MS = 30 * 60_000;
let lastReport = 0; // ponytail: per instance; the contract itself ignores nothing, so two instances just both report

async function reportLend(res) {
  let keys;
  // never echo a parse error: its message can quote the key material
  try { keys = JSON.parse(process.env.LEND_REPORTER_KEYS || "{}"); } catch { return res.status(500).json({ error: "reporter keys misconfigured" }); }
  if (!Object.keys(keys).length) return res.status(503).json({ error: "no reporter keys on this deployment" });
  const provider = nearProvider({ FailoverRpcProvider, JsonRpcProvider });
  const reports = await provider.callFunction({ contractId: LEND, method: "reports", args: {} });
  const now = Date.now(), stale = reports.filter(([, r]) => !r || now - Number(r.at_ms) > REFRESH_MS).map(([who]) => who);
  if (!stale.length) return res.status(200).json({ reported: [], fresh: true });
  if (now - lastReport < 5 * 60_000) return res.status(429).json({ error: "reported a few minutes ago" });
  lastReport = now;
  const out = await Promise.all(stale.filter((who) => keys[who] && SOURCES[who]).map(async (who) => {
    try {
      const price = await sourcePrice(who);
      await new Account(who, provider, keys[who]).callFunction({ contractId: LEND, methodName: "report_price", args: { price: String(price) }, gas: 10_000_000_000_000n });
      return { reporter: who, source: SOURCES[who][0], price: price / 1e6 };
    } catch (e) {
      console.error("report", who, String(e.message ?? e).replace(/ed25519:\w+/g, "[key]").slice(0, 200));
      return { reporter: who, source: SOURCES[who][0], error: "not reported" };
    }
  }));
  res.status(200).json({ reported: out });
}

export default async function handler(req, res) {
  res.setHeader("cache-control", "no-store");
  if (req.method === "POST") return reportLend(res).catch((e) => {
    console.error("reportLend", String(e.message ?? e).replace(/ed25519:\w+/g, "[key]").slice(0, 200));
    res.status(502).json({ error: "report failed" });
  });
  if (req.method !== "GET" && req.method !== "HEAD") return res.status(405).json({ error: "GET or POST" });
  try {
    last = { ...(await prices()), fetchedAt: Date.now() };
    res.setHeader("cache-control", "public, s-maxage=60, stale-while-revalidate=300");
    res.status(200).json(last);
  } catch (e) {
    if (last && Date.now() - last.fetchedAt < STALE_MS) return res.setHeader("cache-control", "no-store").status(200).json({ ...last, stale: true, error: e.message });
    res.setHeader("cache-control", "no-store").status(502).json({ error: e.message });
  }
}
