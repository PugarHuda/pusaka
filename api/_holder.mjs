// Holder-only access: NEP-413 signed messages + the sealed letter that travels with each Pusaka.
// Shared by api/holder.mjs and the local tests (scripts/holder-test.mjs).
import { createHash, createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { FailoverRpcProvider, JsonRpcProvider } from "near-api-js";
import { ed25519 } from "@noble/curves/ed25519.js";
import { base58 } from "@scure/base";
import { CONTRACT, nearProvider } from "@pusaka/shared";

const provider = nearProvider({ FailoverRpcProvider, JsonRpcProvider });
const MAX_AGE_MS = 5 * 60_000;
const fail = (status, m) => Object.assign(new Error(m), { status });

/** The exact message a holder signs. `at` (ms) keeps a signature from opening the room for more than 5 minutes. */
export const accessMessage = (tokenId, at) => `Open the holder room of Pusaka #${tokenId}\nat ${at}`;

/** NEP-413: sha256(u32le(2^31 + 413) || borsh({message, nonce[32], recipient, callbackUrl: None})). */
export function nep413Hash({ message, nonce, recipient }) {
  const str = (s) => { const b = Buffer.from(s); const l = Buffer.alloc(4); l.writeUInt32LE(b.length); return Buffer.concat([l, b]); };
  const tag = Buffer.alloc(4); tag.writeUInt32LE(2 ** 31 + 413);
  return createHash("sha256").update(Buffer.concat([tag, str(message), Buffer.from(nonce), str(recipient), Buffer.from([0])])).digest();
}

/**
 * Who is asking, proven: the signature verifies for `publicKey`, that key is a full-access key
 * of `accountId` right now, and the message is ours, for this token, and fresh. Returns accountId.
 */
// A signed message opens the room once: its nonce is remembered until the signature would expire anyway.
// ponytail: per serverless instance; a replay that lands on another warm instance within 5 minutes still gets in.
// The upgrade path is a shared store (e.g. Upstash Redis SET NX with a 5-minute TTL).
const usedNonces = new Map();
/** True the first time a (verified) nonce is seen inside its validity window, false on a replay. */
export function claimNonce(nonce, ts, now = Date.now()) {
  for (const [n, exp] of usedNonces) if (exp < now) usedNonces.delete(n);
  if (usedNonces.has(nonce)) return false;
  usedNonces.set(nonce, ts + MAX_AGE_MS);
  return true;
}

export async function verifyHolder(tokenId, auth, recipient) {
  const { accountId, publicKey, signature, message, nonce, at } = auth ?? {};
  if (!accountId || !publicKey?.startsWith("ed25519:") || !signature || !nonce) throw fail(400, "sign in with your NEAR wallet first");
  const ts = Number(at);
  // NaN would compare false and pass the age check, so require a real millisecond timestamp.
  if (!Number.isSafeInteger(ts) || Math.abs(Date.now() - ts) > MAX_AGE_MS) throw fail(401, "signature expired; sign in again");
  if (message !== accessMessage(tokenId, ts)) throw fail(400, "wrong message signed");
  const nonceBytes = Buffer.from(String(nonce), "base64");
  // Node's base64 decoder is lenient (whitespace, padding, url-safe letters): only the canonical spelling is accepted,
  // and the replay check below is keyed on the bytes, so no second spelling of one nonce gets in.
  if (nonceBytes.length !== 32 || nonceBytes.toString("base64") !== nonce) throw fail(400, "nonce must be 32 bytes, standard base64");
  const hash = nep413Hash({ message, nonce: nonceBytes, recipient });
  // NEP-413 says base64; some wallets hand back "ed25519:<base58>" instead.
  let sig = Buffer.from(signature, "base64");
  if (sig.length !== 64) { try { sig = Buffer.from(base58.decode(signature.replace(/^ed25519:/, ""))); } catch { /* fails below */ } }
  if (!ed25519.verify(sig, hash, base58.decode(publicKey.slice(8)))) throw fail(401, "signature doesn't match");
  const key = await provider.query({ request_type: "view_access_key", finality: "optimistic", account_id: accountId, public_key: publicKey }).catch(() => null);
  if (key?.permission !== "FullAccess") throw fail(401, `${publicKey} is not a full-access key of ${accountId}`);
  if (!claimNonce(nonceBytes.toString("hex"), ts)) throw fail(401, "this signature was already used; sign in again");
  return accountId;
}

/** Checked on every request, so the room closes for a seller the moment the NFT moves. */
export async function currentOwner(tokenId) {
  const t = await provider.callFunction({ contractId: CONTRACT, method: "nft_token", args: { token_id: String(tokenId) }, blockQuery: { finality: "optimistic" } });
  if (!t) throw fail(404, `no Pusaka #${tokenId}`);
  return t;
}

// Legacy (v1:) letters only: the key is derived from the relayer secret, so the operator could read
// them. New letters are ckd1:, sealed in the browser with a NEAR MPC CKD key (shared/ckd.mjs).
function letterKey() {
  const secret = process.env.LETTER_SECRET ?? process.env.RELAYER_PRIVATE_KEY;
  if (!secret) throw fail(503, "holder room is not configured");
  return Buffer.from(hkdfSync("sha256", secret, CONTRACT, "pusaka-letter-v1", 32));
}

/** AES-256-GCM; the token id is bound in as AAD, so a sealed letter can't be pasted onto another Pusaka. */
export function seal(tokenId, text) {
  if (typeof text !== "string" || !text.trim()) throw fail(400, "write something first");
  if (Buffer.byteLength(text) > 1400) throw fail(400, "letters are limited to 1400 bytes");
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", letterKey(), iv).setAAD(Buffer.from(`pusaka:${tokenId}`));
  const ct = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return "v1:" + Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}

export function open(tokenId, sealed) {
  if (!sealed?.startsWith("v1:")) return null;
  const b = Buffer.from(sealed.slice(3), "base64");
  const d = createDecipheriv("aes-256-gcm", letterKey(), b.subarray(0, 12)).setAAD(Buffer.from(`pusaka:${tokenId}`));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
}

/** {token_id, auth, action: "open" | "seal", text?} -> the room's content for the current holder only. */
export async function holderRoom({ token_id, auth, action = "open", text }, recipient) {
  if (!/^\d{1,10}$/.test(String(token_id ?? ""))) throw fail(400, "token_id must be a number");
  const who = await verifyHolder(token_id, auth, recipient);
  const token = await currentOwner(token_id);
  if (token.owner_id !== who) throw fail(403, `${who} doesn't hold Pusaka #${token_id}; only its current holder can open this room`);
  if (action === "seal") return { sealed: seal(token_id, text) };
  const extra = (() => { try { return JSON.parse(token.metadata?.extra ?? "{}"); } catch { return {}; } })();
  return { holder: who, creator: extra.creator ?? null, letter: extra.letter ? open(token_id, extra.letter) : null };
}
