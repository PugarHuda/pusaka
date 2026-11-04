// Heirloom, live: the holder names an heir, checks in gas-free, goes silent; the heir claims gas-free.
//   node heir.mjs <holder.testnet> <heir.testnet> <token_id> [--give-back]
// Testnet's shortest silence is 10 minutes, so this takes ~11 minutes end to end.
import fs from "node:fs";
import { encodeSignedDelegate, actions, teraToGas } from "near-api-js";
import { account, call, view, CONTRACT, NEAR_EXPLORER } from "./lib.mjs";
import { relay } from "../api/_relayer.mjs";

const [holderId, heirId, tokenId] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!tokenId) throw new Error("usage: node heir.mjs <holder.testnet> <heir.testnet> <token_id> [--give-back]");
process.env.RELAYER_ACCOUNT_ID ??= "pusaka-relayer.testnet";
process.env.RELAYER_PRIVATE_KEY ??= JSON.parse(fs.readFileSync(new URL("../.keys/pusaka-relayer.testnet.json", import.meta.url))).private_key;
const SILENCE_MS = 10 * 60 * 1000;

const signed = async (who, method, args) => {
  const { signedDelegate } = await account(who).createSignedMetaTransaction({
    receiverId: CONTRACT, actions: [actions.functionCall(method, args, teraToGas(50), 0n)],
  });
  return Buffer.from(encodeSignedDelegate(signedDelegate)).toString("base64");
};
const refused = async (label, p) => {
  try { await p; throw new Error(`UNEXPECTED: ${label} went through`); }
  catch (e) { if (e.message.startsWith("UNEXPECTED")) throw e; console.log(`refused ${label}: ${e.message}`); }
};

const info = await view("token_info", { token_id: tokenId });
if (info.token.owner_id !== holderId) throw new Error(`#${tokenId} is held by ${info.token.owner_id}`);

await call(account(holderId), "set_heir", { token_id: tokenId, heir: heirId, after_ms: String(SILENCE_MS) }, { deposit: 10_000_000_000_000_000_000_000n });
console.log("heir named:", await view("heir_of", { token_id: tokenId }));
await refused("early claim by the heir", relay(await signed(heirId, "claim_inheritance", { token_id: tokenId })));

// naming the heir was itself proof of life; the relayer gives one free check-in per tenth of the silence
await refused("gas-free check-in right after naming the heir", relay(await signed(holderId, "still_here", { token_id: tokenId })));
await new Promise((r) => setTimeout(r, SILENCE_MS / 10 + 5_000));
const t = await relay(await signed(holderId, "still_here", { token_id: tokenId }));
console.log(`holder checked in gas-free: ${NEAR_EXPLORER}/tx/${t.tx}`);
const h = await view("heir_of", { token_id: tokenId });
console.log("clock restarted, claimable from", new Date(Number(h.claimable_from_ms)).toISOString());

const wait = Number(h.claimable_from_ms) - Date.now() + 15_000;
console.log(`holder goes silent; waiting ${Math.round(wait / 1000)} s`);
await new Promise((r) => setTimeout(r, wait));

await refused("claim by someone else", relay(await signed(holderId, "claim_inheritance", { token_id: tokenId })));
const c = await relay(await signed(heirId, "claim_inheritance", { token_id: tokenId }));
console.log(`heir claimed gas-free: ${NEAR_EXPLORER}/tx/${c.tx}`);
await new Promise((r) => setTimeout(r, 4000)); // views read the final block, a couple behind the claim
const after = await view("token_info", { token_id: tokenId });
console.log(`#${tokenId} is now held by ${after.token.owner_id}; heir_of = ${JSON.stringify(await view("heir_of", { token_id: tokenId }))}`);
console.log("history:", after.history.slice(-4).map((e) => e.event.kind).join(" → "));

if (process.argv.includes("--give-back")) {
  await call(account(heirId), "nft_transfer", { receiver_id: holderId, token_id: tokenId }, { deposit: 1n, tgas: 50 });
  console.log(`given back to ${holderId}`);
}
