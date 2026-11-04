// POST {"token_id": "1"} -> proves the token's confirmed BTC deposits through NEAR's light client, gas paid by the relayer.
import { body, handle, proveToken } from "./_relayer.mjs";

export default function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST a token_id" });
  return handle(res, () => proveToken(body(req).token_id));
}
