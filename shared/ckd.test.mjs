// node shared/ckd.test.mjs — checks ckd.mjs against near/mpc's CKD test vectors
// (crates/threshold-signatures/tests/vectors/ckd_test_vectors.json) and a full round trip.
import assert from "node:assert/strict";
import fs from "node:fs";
import { bls12_381 } from "@noble/curves/bls12-381.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { base58 } from "@scure/base";
import { ckdAppId, ckdEphemeral, ckdSecret, ckdKey } from "./ckd.mjs";

const hex = (h) => Uint8Array.from(Buffer.from(h, "hex"));
const { vectors } = JSON.parse(fs.readFileSync(new URL("./ckd-vectors.json", import.meta.url)));
for (const v of vectors) {
  const secret = ckdSecret({ big_y: hex(v.big_y), big_c: hex(v.big_c) }, BigInt("0x" + v.a), hex(v.app_id), hex(v.pk));
  assert.equal(Buffer.from(secret).toString("hex"), v.sig, "decrypted secret = msk·H(pk‖app_id)");
  if (v.s) assert.equal(Buffer.from(hkdf(sha256, secret, undefined, new Uint8Array(), 32)).toString("hex"), v.s, "HKDF as in the vectors");
}
console.log(`${vectors.length} near/mpc vectors: decryption, verification and HKDF match`);

// Tampering is caught by the pairing check.
const v = vectors[0];
const other = bls12_381.G1.Point.BASE.toBytes(true);
assert.throws(() => ckdSecret({ big_y: hex(v.big_y), big_c: other }, BigInt("0x" + v.a), hex(v.app_id), hex(v.pk)), /doesn't verify/);
assert.throws(() => ckdSecret({ big_y: hex(v.big_y), big_c: hex(v.big_c) }, BigInt("0x" + v.a) + 1n, hex(v.app_id), hex(v.pk)), /doesn't verify/);
assert.throws(() => ckdSecret({ big_y: hex(v.big_y), big_c: hex(v.big_c) }, BigInt("0x" + v.a), ckdAppId("x.testnet", "p"), hex(v.pk)), /doesn't verify/);

// Round trip with a simulated network: same account + path → same key, whatever the one-time key.
const { G1, G2 } = bls12_381;
const msk = 123456789n, pk = G2.Point.BASE.multiply(msk).toBytes(true);
const appId = ckdAppId("pusaka-btc.testnet", "letter:1:alice.testnet:n1");
const answer = ({ a, appPublicKey }) => {
  const A = G1.Point.fromBytes(base58.decode(appPublicKey.slice(11)));
  const y = 987654321n + a % 1000n;
  const H = G1.hashToCurve(new Uint8Array([...pk, ...appId]), { DST: "NEAR BLS12381G1_XMD:SHA-256_SSWU_RO_" });
  return { big_y: "bls12381g1:" + base58.encode(G1.Point.BASE.multiply(y).toBytes(true)), big_c: "bls12381g1:" + base58.encode(H.multiply(msk).add(A.multiply(y)).toBytes(true)) };
};
const e1 = ckdEphemeral(), e2 = ckdEphemeral();
const k1 = ckdKey(ckdSecret(answer(e1), e1.a, appId, pk), "pusaka-letter-v1");
const k2 = ckdKey(ckdSecret(answer(e2), e2.a, appId, pk), "pusaka-letter-v1");
assert.deepEqual(k1, k2);
assert.notDeepEqual(k1, ckdKey(ckdSecret(answer(e1), e1.a, appId, pk), "other-purpose"));
console.log("round trip: deterministic per (account, path), distinct per purpose; tampering rejected");

const { sealCkd, openCkd } = await import("./ckd.mjs");
const sealed = await sealCkd(k1, "5", "for whoever holds it");
assert.equal(await openCkd(k1, "5", sealed), "for whoever holds it");
await assert.rejects(openCkd(k1, "6", sealed)); // bound to the token
await assert.rejects(openCkd(ckdKey(new Uint8Array(48).fill(7), "pusaka-letter-v1"), "5", sealed));
console.log("ckd1 letters: open with the key, refuse another token or key");
