// Withdraw NEAR from a Pusaka's own NEAR account (its Ed25519 MPC key, an implicit account).
//   node withdraw-near.mjs <owner.testnet> <token_id> <receiver.testnet> <near> [--dry] [--fund=<near>]
// --fund: first send that much NEAR from the owner to the Pusaka's account (creates it).
import { account, call, view, nearAccount, nearBalances, nearTxParams, finalizeNear, broadcastNear, NEAR_EXPLORER } from "./lib.mjs";
import { parseNearAmount } from "near-api-js";

const [ownerId, tokenId = "1", receiver, amount = "0.01"] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const fund = process.argv.find((a) => a.startsWith("--fund="))?.split("=")[1];
const owner = account(ownerId);
const acct = await nearAccount(tokenId);
if (fund) {
  const r = await owner.transfer({ receiverId: acct, amount: BigInt(parseNearAmount(fund)) });
  console.log(`funded ${acct} with ${fund} NEAR: ${NEAR_EXPLORER}/tx/${r.transaction.hash}`);
}
const floor = await view("near_nonce_floor", { token_id: tokenId });
const b = await nearBalances(acct, floor);
console.log(`Pusaka #${tokenId} NEAR account ${acct}: ${b.yocto} yocto, nonce ${b.nonce}, floor ${floor}, safe ${b.safe}`);

const { nonce, blockHash } = await nearTxParams(acct);
const t0 = Date.now();
const signed = await call(owner, "withdraw_near", {
  token_id: tokenId, receiver_id: receiver ?? ownerId, amount: parseNearAmount(amount), nonce: String(nonce), block_hash: blockHash,
}, { deposit: 10_000_000_000_000_000_000_000n, tgas: 300 });
if (signed.account !== acct) throw new Error(`contract signed for ${signed.account}, expected ${acct}`);
const tx = await finalizeNear(signed);
console.log(`MPC signed in ${((Date.now() - t0) / 1000).toFixed(1)}s; Ed25519 signature verifies for ${acct}`);
if (process.argv.includes("--dry")) console.log("dry run: not broadcast");
else console.log(`broadcast: ${NEAR_EXPLORER}/tx/${await broadcastNear(tx)}`);
console.log(`new floor ${await view("near_nonce_floor", { token_id: tokenId })}; balance now`, await nearBalances(acct, await view("near_nonce_floor", { token_id: tokenId })));
