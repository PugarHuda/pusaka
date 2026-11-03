// POST {token_id, auth: NEP-413 signed access message, action: "open" | "seal", text?}
// Opens the holder room of a Pusaka (its sealed letter) for its current holder only.
import { holderRoom } from "./_holder.mjs";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST {token_id, auth}" });
  try {
    // The wallet signed for this host; a signature made for another site doesn't open the room.
    res.status(200).json(await holderRoom(req.body ?? {}, req.headers["x-forwarded-host"] ?? req.headers.host));
  } catch (e) {
    res.status(e.status ?? 500).json({ error: e.status ? e.message : "holder room failed" });
  }
}
