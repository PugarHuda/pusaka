// BIP-322 "simple" for P2WPKH, independent of the contract's Rust code: builds the witness from NEAR MPC's answer to
// `sign_btc_message` and verifies any P2WPKH BIP-322 signature against an address's key hash.
// The key signs the BIP143 sighash of a virtual `to_sign` spending a virtual `to_spend` (null input): never minable.
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { ripemd160 } from "@noble/hashes/legacy.js";
import { base64, hex } from "@scure/base";

const N = secp256k1.Point.CURVE().n;
const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
const u32 = (v) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v, true); return b; };
const ZERO8 = new Uint8Array(8);
const sha256d = (b) => sha256(sha256(b));
const utf8 = (s) => new TextEncoder().encode(s);
export const hash160 = (b) => ripemd160(sha256(b));

export function messageHash(msg) {
  const tag = sha256(utf8("BIP0322-signed-message"));
  return sha256(cat(tag, tag, utf8(msg)));
}

export function toSpend(pkh, msg) {
  return cat(u32(0), [1], new Uint8Array(32), u32(0xffffffff), [34, 0x00, 0x20], messageHash(msg), u32(0), [1], ZERO8, [22, 0x00, 0x14], pkh, u32(0));
}

export function toSign(spendTxid) {
  return cat(u32(0), [1], spendTxid, u32(0), [0], u32(0), [1], ZERO8, [1, 0x6a], u32(0));
}

/** The BIP143 SIGHASH_ALL digest the address's key signs. */
export function sighash(pkh, msg) {
  const outpoint = cat(sha256d(toSpend(pkh, msg)), u32(0));
  const code = cat([0x19, 0x76, 0xa9, 0x14], pkh, [0x88, 0xac]);
  return sha256d(cat(u32(0), sha256d(outpoint), sha256d(u32(0)), outpoint, code, ZERO8, u32(0), sha256d(cat(ZERO8, [1, 0x6a])), u32(0), u32(1)));
}

const txidHex = (raw) => hex.encode(sha256d(raw).reverse());
export const toSpendTxid = (pkh, msg) => txidHex(toSpend(pkh, msg));
export const toSignTxid = (pkh, msg) => txidHex(toSign(sha256d(toSpend(pkh, msg))));

/** The witness (base64, the "simple" encoding) from `sign_btc_message`'s answer. Checks it verifies before returning. */
export function witnessFromMpc({ message, pubkey, signature: sig }) {
  if (!sig) throw new Error("the MPC network returned no signature");
  const r = BigInt("0x" + sig.big_r.affine_point.slice(2));
  let s = BigInt("0x" + sig.s.scalar);
  if (s > N / 2n) s = N - s; // low-S, as Bitcoin requires
  const der = new secp256k1.Signature(r, s).toBytes("der");
  const pk = hex.decode(pubkey);
  const witness = base64.encode(cat([2, der.length + 1], der, [1], [pk.length], pk));
  if (!verify(hash160(pk), message, witness)) throw new Error("the signature doesn't verify for this Pusaka's address");
  return witness;
}

/** Whether `witness` (base64, optionally "smp"-prefixed) is a valid BIP-322 simple signature of `msg` by P2WPKH `pkh`. */
export function verify(pkh, msg, witness) {
  try {
    const w = base64.decode(witness.replace(/^smp/, ""));
    if (w[0] !== 2) return false;
    const sigLen = w[1], der = w.slice(2, 2 + sigLen - 1), type = w[1 + sigLen];
    const pk = w.slice(3 + sigLen, 3 + sigLen + w[2 + sigLen]);
    if (type !== 1 || hex.encode(hash160(pk)) !== hex.encode(pkh)) return false;
    return secp256k1.verify(der, sighash(pkh, msg), pk, { prehash: false, format: "der" });
  } catch {
    return false;
  }
}
