// NEAR MPC confidential key derivation (CKD, domain 2, BLS12-381), client side.
// The MPC returns msk·H(pk ‖ app_id) ElGamal-encrypted to a one-time key `a`:
//   (Y, C) = (y·G1, msk·H + y·a·G1)   →   secret = C − a·Y
// and anyone holding the MPC public key can check it: e(H, pk) = e(secret, G2).
// Spec: near/mpc crates/ckd-example-cli/src/ckd.rs; checked against its test vectors in ckd.test.mjs.
import { bls12_381 } from "@noble/curves/bls12-381.js";
import { sha3_256 } from "@noble/hashes/sha3.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { bytesToNumberBE } from "@noble/curves/utils.js";
import { base58 } from "@scure/base";

const { G1, G2, pairing, fields } = bls12_381;
const DST = "NEAR BLS12381G1_XMD:SHA-256_SSWU_RO_";
const enc = new TextEncoder();
const unprefix = (s, p) => {
  if (typeof s !== "string" || !s.startsWith(p)) throw new Error(`expected ${p}<base58>`);
  return base58.decode(s.slice(p.length));
};

/** app_id = sha3_256("near-mpc v0.1.0 app_id derivation:" + account + "," + path): what the MPC keys on. */
export const ckdAppId = (accountId, path) => sha3_256(enc.encode(`near-mpc v0.1.0 app_id derivation:${accountId},${path}`));

/** A one-time key pair: send `appPublicKey` with the request, keep `a` to decrypt the answer. */
export function ckdEphemeral() {
  const a = G1.Point.Fn.create(bytesToNumberBE(globalThis.crypto.getRandomValues(new Uint8Array(48)))) || 1n;
  return { a, appPublicKey: "bls12381g1:" + base58.encode(G1.Point.BASE.multiply(a).toBytes(true)) };
}

/** Decrypts the MPC's {big_y, big_c} and checks it against the MPC public key; returns the 48-byte secret. */
export function ckdSecret({ big_y, big_c }, a, appId, mpcPublicKey) {
  const Y = G1.Point.fromBytes(typeof big_y === "string" ? unprefix(big_y, "bls12381g1:") : big_y);
  const C = G1.Point.fromBytes(typeof big_c === "string" ? unprefix(big_c, "bls12381g1:") : big_c);
  const pkBytes = typeof mpcPublicKey === "string" ? unprefix(mpcPublicKey, "bls12381g2:") : mpcPublicKey;
  const pk = G2.Point.fromBytes(pkBytes);
  const secret = C.subtract(Y.multiply(a));
  const H = G1.hashToCurve(new Uint8Array([...pkBytes, ...appId]), { DST });
  if (secret.is0() || !fields.Fp12.eql(pairing(H, pk), pairing(secret, G2.Point.BASE))) {
    throw new Error("the MPC's answer doesn't verify against its public key");
  }
  return secret.toBytes(true);
}

/** A 32-byte key for one purpose, as the near/mpc example derives it (HKDF-SHA256, fixed salt). */
export const ckdKey = (secret, purpose) => hkdf(sha256, secret, enc.encode("near-mpc-ckd-hkdf-v1"), enc.encode(purpose), 32);

// ---------- letters sealed with a CKD key (prefix ckd1:) ----------
const b64 = (u8) => btoa(String.fromCharCode(...u8));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const aes = (key, use) => globalThis.crypto.subtle.importKey("raw", key, "AES-GCM", false, [use]);
export const LETTER_PURPOSE = "pusaka-letter-v1";

/** AES-256-GCM with the token id as associated data, so a sealed letter can't be pasted onto another Pusaka. */
export async function sealCkd(key, tokenId, text) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await globalThis.crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(`pusaka:${tokenId}`) }, await aes(key, "encrypt"), enc.encode(text)));
  return "ckd1:" + b64(new Uint8Array([...iv, ...ct]));
}

export async function openCkd(key, tokenId, sealed) {
  if (!sealed?.startsWith("ckd1:")) throw new Error("not a ckd1 letter");
  const b = unb64(sealed.slice(5));
  const pt = await globalThis.crypto.subtle.decrypt({ name: "AES-GCM", iv: b.subarray(0, 12), additionalData: enc.encode(`pusaka:${tokenId}`) }, await aes(key, "decrypt"), b.subarray(12));
  return new TextDecoder().decode(pt);
}
