// Live: the drain-before-sale attacks on a Pusaka v2's own account, each refused on-chain (testnet).
//   PUSAKA_CONTRACT=pusaka-v2.testnet node scripts/v2-refusals.mjs <holder> <token_id> <agent> <stranger>
// The holder lists the NFT, then tries to empty its account, and its agent tries too: both `Listed`. A stranger
// tries to give itself a budget and to name the account: `NotOwner`. The listing is cancelled at the end.
import { account, callRaw, NEAR_EXPLORER } from "./lib.mjs";

const [holder, token_id, agent, stranger] = process.argv.slice(2);
const V2 = process.env.PUSAKA_CONTRACT;
if (V2 !== "pusaka-v2.testnet") throw new Error("PUSAKA_CONTRACT=pusaka-v2.testnet");
const yocto = (n) => BigInt(Math.round(n * 1e6)) * 10n ** 18n;
const tx = (who, method, args, deposit = 0n) => callRaw(account(who), method, args, { deposit, tgas: 100, receiver: V2 });
async function refused(what, who, method, args, deposit, why) {
  try { await tx(who, method, args, deposit); } catch (e) {
    const m = String(e.message ?? e);
    if (!why.test(m)) throw e;
    return console.log(`refused: ${what}: ${m.match(why)[0]}`);
  }
  throw new Error(`${what} should have been refused`);
}

await tx(holder, "set_agent", { token_id, agent, daily: yocto(0.02).toString(), to: [] }, yocto(0.01));
const l = await tx(holder, "list", { token_id, price: yocto(50).toString(), floor: null, duration_ms: null });
console.log(`listed: ${NEAR_EXPLORER}/tx/${l.transaction.hash}`);
try {
  await refused("the seller empties the NFT's account while it's listed", holder, "account_call",
    { token_id, alias: false, receiver_id: holder, method_name: "", args: "", deposit: yocto(0.01).toString(), gas_tgas: 0 }, 1n, /Listed/);
  await refused("the seller's agent empties it while it's listed", agent, "agent_send", { token_id, receiver_id: agent, amount: yocto(0.01).toString() }, 0n, /Listed/);
  await refused("a stranger gives itself a budget", stranger, "set_agent", { token_id, agent: stranger, daily: yocto(1).toString(), to: [] }, yocto(0.01), /NotOwner/);
  await refused("a stranger names the NFT's account", stranger, "name_account", { token_id }, yocto(0.05), /NotOwner/);
} finally {
  await tx(holder, "cancel_listing", { token_id });
  await tx(holder, "set_agent", { token_id, agent, daily: null, to: [] }, 0n);
}
console.log("OK: all four refused on-chain; listing cancelled, budget revoked");
