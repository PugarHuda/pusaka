// Exercises the holder room end to end against the live contract, signing NEP-413 messages with local keys.
//   node holder-test.mjs [token_id=5] [holder=pusaka-seller.testnet] [other=pusaka-buyer.testnet]
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { KeyPair } from "near-api-js";
import fs from "node:fs";
import { holderRoom, accessMessage, nep413Hash } from "../api/_holder.mjs";
import { keyFile, account, call, sleep } from "./lib.mjs";

process.env.LETTER_SECRET ??= "local-test-secret";
const [tokenId = "5", holder = "pusaka-seller.testnet", other = "pusaka-buyer.testnet"] = process.argv.slice(2);
const HOST = "pusaka-two.vercel.app";

function sign(accountId, { at = Date.now(), recipient = HOST, tid = tokenId } = {}) {
  const kp = KeyPair.fromString(JSON.parse(fs.readFileSync(keyFile(accountId))).private_key);
  const nonce = randomBytes(32), message = accessMessage(tid, at);
  const sig = kp.sign(nep413Hash({ message, nonce, recipient })).signature;
  return { accountId, publicKey: kp.getPublicKey().toString(), signature: Buffer.from(sig).toString("base64"), message, nonce: nonce.toString("base64"), at };
}
const rejects = async (p, re) => assert.match(await p.then(() => "resolved", (e) => e.message), re);

const room = await holderRoom({ token_id: tokenId, auth: sign(holder) }, HOST);
console.log("holder opens the room:", room);
await rejects(holderRoom({ token_id: tokenId, auth: sign(other) }, HOST), /doesn't hold/);
console.log("someone else is refused");
await rejects(holderRoom({ token_id: tokenId, auth: sign(holder, { at: Date.now() - 10 * 60_000 }) }, HOST), /expired/);
console.log("a 10-minute-old signature is refused");
await rejects(holderRoom({ token_id: tokenId, auth: { ...sign(holder), at: "soon" } }, HOST), /expired/);
console.log("a non-numeric timestamp is refused");
await rejects(holderRoom({ token_id: tokenId, auth: sign(holder, { recipient: "evil.example" }) }, HOST), /doesn't match/);
console.log("a signature made for another site is refused");
await rejects(holderRoom({ token_id: tokenId, auth: { ...sign(holder), accountId: other } }, HOST), /full-access key/);
console.log("a signature by one account presented as another is refused");

if (process.argv.includes("--write")) {
  const text = `For whoever holds Pusaka #${tokenId}: the Bitcoin inside is yours now. Written ${new Date().toISOString()}.`;
  const { sealed } = await holderRoom({ token_id: tokenId, auth: sign(holder), action: "seal", text }, HOST);
  await call(account(holder), "set_letter", { token_id: tokenId, sealed }, { deposit: 10_000_000_000_000_000_000_000n });
  await sleep(1500);
  const r = await holderRoom({ token_id: tokenId, auth: sign(holder) }, HOST);
  assert.equal(r.letter, text);
  console.log("letter sealed on-chain and opened:", r.letter);
}
