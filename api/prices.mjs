// GET -> { btcUsd, nearUsd, ethUsd, at }: live market prices for the browser (Rhea's API has no CORS).
import { prices } from "@pusaka/shared";

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") return res.status(405).json({ error: "GET only" });
  try {
    res.setHeader("cache-control", "public, s-maxage=60, stale-while-revalidate=300");
    res.status(200).json(await prices());
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}
