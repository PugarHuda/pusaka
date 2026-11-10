// node web/src/passkey.test.mjs: a passkey's PRF output always becomes the same NEAR key and implicit account.
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { KeyPairSigner, buildDelegateAction, actions, encodeDelegateAction } from "near-api-js";
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { keyFromPrf } from "./passkey.js";

// RFC 8032 test 1: this seed's ed25519 public key is d75a98…511a, so that is the implicit account
const prf = Uint8Array.from(Buffer.from("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60", "hex"));
const { keyPair, accountId } = keyFromPrf(prf.buffer);
assert.equal(accountId, "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a");
assert.equal(keyFromPrf(prf).accountId, accountId, "same bytes, same account");
assert.equal(Buffer.from(keyPair.getPublicKey().data).toString("hex"), accountId);
assert.notEqual(keyFromPrf(prf.map((b, i) => (i ? b : b ^ 1))).accountId, accountId);
assert.throws(() => keyFromPrf(new Uint8Array(16)), /32 bytes/);

// the delegate it signs verifies the way api/_relayer.mjs checks it
const d = buildDelegateAction({ senderId: accountId, receiverId: "pusaka-btc.testnet", actions: [actions.functionCall("list", { token_id: "1", price: "1" }, 1n, 0n)], nonce: 1n, maxBlockHeight: 2n, publicKey: keyPair.getPublicKey() });
const { signedDelegate } = await new KeyPairSigner(keyPair).signDelegateAction(d);
assert.ok(ed25519.verify(signedDelegate.signature.data, sha256(encodeDelegateAction(d)), keyPair.getPublicKey().data));
console.log("passkey ok");
