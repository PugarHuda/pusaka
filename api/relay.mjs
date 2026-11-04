// POST {"signed_delegate": "<base64 borsh>"} -> relays a NEP-366 meta-transaction to Pusaka, gas paid by the relayer.
import { body, handle, relay } from "./_relayer.mjs";

export default function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST a signed_delegate" });
  return handle(res, () => relay(String(body(req).signed_delegate ?? "")));
}
