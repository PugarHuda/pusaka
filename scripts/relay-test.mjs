// Local test of the relayer: a user signs a NEP-366 delegate action for `list`, the relayer submits it.
//   node relay-test.mjs <owner.testnet> <token_id>
import { encodeSignedDelegate, actions, teraToGas } from "near-api-js";
import { account, view, CONTRACT } from "./lib.mjs";
import { relay, checkDelegate } from "../api/_relayer.mjs";

const [ownerId, tokenId = "2"] = process.argv.slice(2);
const owner = account(ownerId);
process.env.RELAYER_ACCOUNT_ID ??= "pusaka-relayer.testnet";
process.env.RELAYER_PRIVATE_KEY ??= JSON.parse((await import("node:fs")).readFileSync(new URL("../.keys/pusaka-relayer.testnet.json", import.meta.url))).private_key;

const sign = async (method, args, deposit = 0n) => {
  const { signedDelegate } = await owner.createSignedMetaTransaction({
    receiverId: CONTRACT, actions: [actions.functionCall(method, args, teraToGas(50), deposit)],
  });
  return Buffer.from(encodeSignedDelegate(signedDelegate)).toString("base64");
};
const before = (await owner.getState()).balance.available;

// 1. allowed: list, relayed gas-free
console.log("relay list:", await relay(await sign("list", { token_id: tokenId, price: "700000000000000000000000" })));
console.log("listing now:", (await view("token_info", { token_id: tokenId })).listing?.price);
// 2. allowed: cancel_listing, after the relayer's one-minute pause per token (anti-spam: one free action a minute)
await new Promise((r) => setTimeout(r, 62_000));
console.log("relay cancel:", await relay(await sign("cancel_listing", { token_id: tokenId })));
// 3. refused: a money-moving call
try { checkDelegate(await sign("buy", { token_id: tokenId, expected_sign_epoch: 0 }, 1n)); console.log("UNEXPECTED: buy accepted"); }
catch (e) { console.log("refused buy:", e.message); }
const after = (await owner.getState()).balance.available;
console.log(`owner balance change: ${(Number(BigInt(after) - BigInt(before)) / 1e24).toFixed(6)} NEAR (gas paid by the relayer)`);
// 4. refused: acting on a token you don't own
try { await relay(await sign("list", { token_id: "1", price: "1" })); console.log("UNEXPECTED: relayed for a non-owner"); }
catch (e) { console.log("refused non-owner:", e.message); }
