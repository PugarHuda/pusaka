// POST {token_id, auth: NEP-413 signed access message, action: "open" | "seal", text?}
// Opens the holder room of a Pusaka (its sealed letter) for its current holder only.
import { holderRoom } from "./_holder.mjs";

// The NEP-413 recipient is pinned server-side: a request header could claim any host, which would
// let a signature collected by a phishing site open the room. VERCEL_* are set by Vercel, not clients.
const HOSTS = [process.env.HOLDER_RECIPIENT ?? "pusaka-two.vercel.app", process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL].filter(Boolean);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST {token_id, auth}" });
  const host = req.headers.host;
  const recipient = HOSTS.includes(host) ? host : HOSTS[0];
  try {
    res.status(200).json(await holderRoom(req.body ?? {}, recipient));
  } catch (e) {
    res.status(e.status ?? 500).json({ error: e.status ? e.message : "holder room failed" });
  }
}
