// Live: an heirloom will with guardians, end to end on testnet (about 21 minutes: two 10-minute waits).
//   node guardians.mjs <holder> <heir> <guardian> <stranger> <token_id>   (keys from ../.keys)
// The holder names an heir (10-minute silence) and one guardian (threshold 1). The heir's claim is refused while
// the holder is around, then refused again after the silence because the guardian hasn't approved; a stranger's
// approval is refused; the guardian approves; a claim inside the release wait is refused; after it the heir claims.
// Then the heir gives the Pusaka back and the holder names the heir again with a 30-day silence.
import { account, call, callRaw, view } from "./lib.mjs";

const [holderId, heirId, guardId, strangerId, tokenId] = process.argv.slice(2);
if (!tokenId) throw new Error("usage: node guardians.mjs <holder> <heir> <guardian> <stranger> <token_id>");
const PAY = 10_000_000_000_000_000_000_000n;
const SILENCE = 10 * 60 * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tx = async (who, method, args, opts) => (await callRaw(account(who), method, args, opts)).transaction.hash;
async function refused(who, method, args, why) {
  try { await call(account(who), method, args); } catch (e) {
    if (!why.test(String(e.message ?? e))) throw e;
    return console.log(`  refused (${who} ${method}): ${String(e.message ?? e).match(why)[0]}`);
  }
  throw new Error(`${who} ${method} should have been refused`);
}

console.log("1. the holder names an heir and a guardian");
console.log(`  set_heir ${await tx(holderId, "set_heir", { token_id: tokenId, heir: heirId, after_ms: String(SILENCE) }, { deposit: PAY })}`);
console.log(`  set_guardians ${await tx(holderId, "set_guardians", { token_id: tokenId, guardians: [guardId], threshold: 1 }, { deposit: PAY })}`);
console.log("  guardians_of:", JSON.stringify(await view("guardians_of", { token_id: tokenId })));
await refused(heirId, "claim_inheritance", { token_id: tokenId }, /seen recently/);

console.log("2. the holder goes silent for 10 minutes");
await sleep(SILENCE + 20_000);
await refused(heirId, "claim_inheritance", { token_id: tokenId }, /the guardians must approve the release first \(0 of 1 so far\)/);
await refused(strangerId, "approve_release", { token_id: tokenId }, /only a named guardian can approve/);
console.log(`  the guardian approves: ${await tx(guardId, "approve_release", { token_id: tokenId })}`);
const g = await view("guardians_of", { token_id: tokenId });
console.log(`  release at ${new Date(Number(g.release_at_ms)).toISOString()}`);
await refused(heirId, "claim_inheritance", { token_id: tokenId }, /the guardians must approve the release first \(1 of 1 so far\)/);

console.log("3. the release waiting period passes; the holder stays silent");
await sleep(Number(g.release_at_ms) - Date.now() + 20_000);
console.log(`  the heir claims: ${await tx(heirId, "claim_inheritance", { token_id: tokenId })}`);
console.log(`  owner now ${(await view("token_info", { token_id: tokenId })).token.owner_id}; guardians_of ${JSON.stringify(await view("guardians_of", { token_id: tokenId }))}`);

console.log("4. back to how it was");
await tx(heirId, "nft_transfer", { receiver_id: holderId, token_id: tokenId }, { deposit: 1n });
await tx(holderId, "set_heir", { token_id: tokenId, heir: heirId, after_ms: String(30 * 24 * 3600 * 1000) }, { deposit: PAY });
console.log(`  #${tokenId} with ${(await view("token_info", { token_id: tokenId })).token.owner_id}, heir ${JSON.stringify(await view("heir_of", { token_id: tokenId }))}`);
