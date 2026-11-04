// GET /api/reserves -> every Pusaka with its BTC verified on NEAR (JSON, for agents and auditors).
import { reserves } from "./_reserves.mjs";

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") return res.status(405).json({ error: "GET only" });
  try {
    res.setHeader("cache-control", "public, s-maxage=60, stale-while-revalidate=300");
    res.setHeader("access-control-allow-origin", "*");
    res.status(200).json(await reserves());
  } catch {
    res.status(502).json({ error: "NEAR RPC unavailable" });
  }
}
