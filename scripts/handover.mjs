// Live: a Pusaka changes hands twice; the creator earns a royalty on the resale, and the holder
// room (sealed letter) opens only for whoever holds it now.
//   node handover.mjs [token_id=5] [creator] [buyer] [third]
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import { KeyPair, parseNearAmount } from "near-api-js";
import { holderRoom, accessMessage, nep413Hash } from "../api/_holder.mjs";
import { account, call, view, keyFile, provider, sleep } from "./lib.mjs";

const [id = "5", a = "pusaka-seller.testnet", b = "pusaka-buyer.testnet", c = "pusaka-b-mvzgq3wm.testnet"] = process.argv.slice(2);
const HOST = "pusaka-two.vercel.app";
const auth = (acct) => {
  const kp = KeyPair.fromString(JSON.parse(fs.readFileSync(keyFile(acct))).private_key);
  const at = Date.now(), nonce = randomBytes(32), message = accessMessage(id, at);
  return { accountId: acct, publicKey: kp.getPublicKey().toString(), message, at, nonce: nonce.toString("base64"),
    signature: Buffer.from(kp.sign(nep413Hash({ message, nonce, recipient: HOST })).signature).toString("base64") };
};
// Through the live API when given (proves the deployed room), else in-process.
const room = async (acct) => {
  if (!process.env.HOLDER_API) return holderRoom({ token_id: id, auth: auth(acct) }, HOST).catch((e) => ({ error: e.message }));
  const r = await fetch(process.env.HOLDER_API, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token_id: id, auth: auth(acct) }) });
  return r.json();
};
const balance = async (acct) => BigInt((await provider.viewAccount({ accountId: acct })).amount);
const sell = async (seller, buyer, near) => {
  await call(account(seller), "list", { token_id: id, price: parseNearAmount(near) });
  const info = await view("token_info", { token_id: id });
  const r = await call(account(buyer), "buy", { token_id: id, expected_sign_epoch: info.sign_epoch }, { deposit: BigInt(parseNearAmount(near)) });
  console.log(`${seller} sold #${id} to ${buyer} for ${near} NEAR`);
  return r;
};

console.log("before:", a, "->", (await room(a)).letter ? "opens the letter" : "room", (await room(a)).error ?? "");
await sell(a, b, "0.1");
await sleep(1500);
assert.match((await room(a)).error ?? "", /doesn't hold/);
console.log(`${a} (old holder) is locked out of the room`);
assert.ok((await room(b)).letter);
console.log(`${b} (new holder) reads the letter:`, (await room(b)).letter.slice(0, 60) + "…");

const creator = JSON.parse((await view("nft_token", { token_id: id })).metadata.extra ?? "{}").creator;
assert.ok(creator && ![b, c].includes(creator), "pick a buyer/third account other than the creator");
const creatorBefore = await balance(creator);
await sell(b, c, "0.2");
await sleep(1500);
const royalty = (await balance(creator)) - creatorBefore;
assert.equal(royalty, BigInt(parseNearAmount("0.005")));
console.log(`creator ${creator} received the 2.5% royalty: 0.005 NEAR`);
assert.match((await room(b)).error ?? "", /doesn't hold/);
assert.ok((await room(c)).letter);
console.log(`${c} now holds #${id} and the letter; ${b} is locked out`);
const h = (await view("token_info", { token_id: id })).history.slice(-6).map((e) => e.event.kind).join(", ");
console.log("history:", h);
