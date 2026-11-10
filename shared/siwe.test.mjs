// v2 F9: the MPC's sign_in answer becomes a 65-byte personal_sign signature that any SIWE site verifies.
// MPC can return either s (high or low); both must recover to the NFT's address, and a foreign address is refused.
import assert from "node:assert/strict";
import { hashMessage } from "viem";
import { sign, privateKeyToAccount } from "viem/accounts";
import { signInSignature } from "./btc.mjs";

const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const pk = "0x" + "11".repeat(32), address = privateKeyToAccount(pk).address.toLowerCase();
const message = "pusaka-two.vercel.app wants you to sign in with your Ethereum account:\n" + address;
const { r, s, yParity } = await sign({ hash: hashMessage(message), privateKey: pk });
const hex = (n) => n.toString(16).padStart(64, "0");
const mpc = (sv, rec) => ({ message, address, signature: { big_r: { affine_point: "02" + r.slice(2) }, s: { scalar: hex(sv) }, recovery_id: rec } });

const low = await signInSignature(mpc(BigInt(s), yParity));
const high = await signInSignature(mpc(N - BigInt(s), yParity ^ 1));
assert.equal(low, high, "high-s is normalised to the same low-s signature");
await assert.rejects(signInSignature({ ...mpc(BigInt(s), yParity), address: "0x" + "22".repeat(20) }), /recovers to/);
await assert.rejects(signInSignature({ message, address, signature: null }), /no signature/);
console.log("siwe: ok");
