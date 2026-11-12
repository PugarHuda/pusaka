// POST {message, signature, domain?} -> a "Sign in as Pusaka #N" (EIP-4361) checked: signature, the NFT's own address, holder now, expiry, site.
// POST {message, witness}            -> a BIP-322 proof of a Pusaka's Bitcoin address checked: signature, holder now.
// For websites and exchanges that accept a Pusaka as a user or a withdrawal address. Free, read-only, CORS open.
import { verifySignIn, verifyBtcProof } from "@pusaka/shared/holderproof";
import { body } from "./_relayer.mjs";

export default async function handler(req, res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "content-type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST {message, signature, domain?} or {message, witness}" });
  try {
    const b = body(req);
    if (typeof b.message !== "string" || b.message.length > 2000) return res.status(400).json({ error: "message: the signed text" });
    if (typeof b.signature === "string") return res.status(200).json(await verifySignIn({ message: b.message, signature: b.signature, expectedDomain: typeof b.domain === "string" ? b.domain : undefined }));
    if (typeof b.witness === "string") return res.status(200).json(await verifyBtcProof({ message: b.message, witness: b.witness }));
    res.status(400).json({ error: "signature (a sign-in) or witness (a BIP-322 proof) required" });
  } catch (e) {
    res.status(e.status ?? 502).json({ error: e.status ? e.message : "NEAR RPC unavailable" });
  }
}
