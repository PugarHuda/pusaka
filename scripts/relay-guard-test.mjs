// The relayer refuses forged, tampered, foreign-key and stale delegates before paying any gas.
//   node relay-guard-test.mjs [account.testnet]   (default: one fresh faucet account; nothing is relayed or spent)
import assert from "node:assert/strict";
import { KeyPair, actions, encodeSignedDelegate, teraToGas } from "near-api-js";
import { checkDelegate, verifyDelegate } from "../api/_relayer.mjs";
import fs from "node:fs";
import { ensureAccount, keyFile, CONTRACT } from "./lib.mjs";

const owner = await ensureAccount(process.argv[2] ?? `pusaka-g-${Date.now().toString(36)}.testnet`);
const sign = async (opts = {}) => {
  const { signedDelegate } = await owner.createSignedMetaTransaction({
    receiverId: CONTRACT, actions: [actions.functionCall("cancel_listing", { token_id: "4" }, teraToGas(30), 0n)], ...opts,
  });
  return signedDelegate;
};
const b64 = (sd) => Buffer.from(encodeSignedDelegate(sd)).toString("base64");
const refused = async (sd, status, re) => {
  const e = await verifyDelegate(sd).then(() => null, (x) => x);
  assert.ok(e, "expected a refusal");
  assert.equal(e.status, status, e.message);
  assert.match(e.message, re);
};

const good = await sign();
await verifyDelegate(checkDelegate(b64(good)));
console.log("a genuine delegate passes");
// Smart Pusakas (an allowlisted sibling) are relayed with the same checks; any other contract is refused before any gas
await verifyDelegate(checkDelegate(b64(await sign({ receiverId: "pusaka-v2.testnet" }))));
console.log("a genuine delegate to the Smart Pusaka contract passes");
const elsewhere = await sign({ receiverId: "wrap.testnet" });
assert.throws(() => checkDelegate(b64(elsewhere)), /only calls to pusaka-btc.testnet or pusaka-v2.testnet are relayed/);
console.log("a delegate to any other contract is refused");

// Work on decoded copies; re-sign with the sender's own key where a valid signature is needed.
const { sha256 } = await import("@noble/hashes/sha2.js");
const { encodeDelegateAction } = await import("near-api-js");
const mine = KeyPair.fromString(JSON.parse(fs.readFileSync(keyFile(owner.accountId))).private_key);
const copy = () => checkDelegate(b64(good));
const resign = (p, kp = mine) => { p.signature.ed25519Signature.data = Array.from(kp.sign(sha256(encodeDelegateAction(p.delegateAction))).signature); return p; };

const zero = copy();
zero.signature.ed25519Signature.data = Array(64).fill(0);
await refused(zero, 401, /signature/);
console.log("a zero signature is refused");

const tampered = copy();
tampered.delegateAction.actions[0].functionCall.args = Array.from(Buffer.from(JSON.stringify({ token_id: "1" })));
await refused(tampered, 401, /signature/);
console.log("changed args under the original signature are refused");

const stranger = KeyPair.fromRandom("ed25519");
const foreign = copy();
foreign.delegateAction.publicKey = { ed25519Key: { data: Array.from(stranger.getPublicKey().data) } };
await refused(resign(foreign, stranger), 401, /isn.t an access key/);
console.log("a correctly signed delegate from a key the sender doesn't have is refused");

const stale = copy();
stale.delegateAction.maxBlockHeight = 1n;
await refused(resign(stale), 410, /expired/);
console.log("an expired delegate is refused");

const replay = copy();
replay.delegateAction.nonce = 1n;
await refused(resign(replay), 409, /nonce/);
console.log("a used nonce is refused");
