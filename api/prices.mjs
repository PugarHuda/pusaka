// GET -> { btcUsd, nearUsd, ethUsd, at }: live market prices for the browser (Rhea's API has no CORS).
import { prices } from "@pusaka/shared";

// A source hiccup (timeout, rate limit) shouldn't blank every dollar figure: serve this instance's last good
// answer for up to 10 minutes, marked stale. ponytail: per instance; a cold instance with no good answer still 502s.
const STALE_MS = 10 * 60_000;
let last = null;

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") return res.status(405).json({ error: "GET only" });
  try {
    last = { ...(await prices()), fetchedAt: Date.now() };
    res.setHeader("cache-control", "public, s-maxage=60, stale-while-revalidate=300");
    res.status(200).json(last);
  } catch (e) {
    if (last && Date.now() - last.fetchedAt < STALE_MS) return res.setHeader("cache-control", "no-store").status(200).json({ ...last, stale: true, error: e.message });
    res.setHeader("cache-control", "no-store").status(502).json({ error: e.message });
  }
}
