// A Pusaka's own NEAR account stakes with a validator; the stake and its rewards move with the NFT.
//   node stake.mjs <owner> <token_id> pools                         factory pools that validate now, lowest fee first
//   node stake.mjs <owner> <token_id> status                        what the token's account holds at each pool it used
//   node stake.mjs <owner> <token_id> stake <pool> <near> [--fund=<near>]   (--fund: send NEAR to its account first)
//   node stake.mjs <owner> <token_id> unstake <pool> <near>
//   node stake.mjs <owner> <token_id> withdraw <pool>               after the unstake waiting period (about 4 epochs)
import { account, call, view, nearAccount, nearBalances, nearTxParams, finalizeNear, broadcastNear, stakingPools, stakeBalances, NEAR_EXPLORER } from "./lib.mjs";
import { parseNearAmount, formatNearAmount } from "near-api-js";

const [ownerId, tokenId, cmd, pool, amount = "0"] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const fund = process.argv.find((a) => a.startsWith("--fund="))?.split("=")[1];
const acct = await nearAccount(tokenId);
const show = async () => {
  const pools = await view("staking_pools_of", { token_id: tokenId });
  const b = await nearBalances(acct, await view("near_nonce_floor", { token_id: tokenId }));
  console.log(`Pusaka #${tokenId}'s NEAR account ${acct}: ${formatNearAmount(b.yocto.toString(), 4)} NEAR liquid`);
  for (const s of await stakeBalances(acct, pools))
    console.log(`  ${s.pool}: ${formatNearAmount(s.staked.toString(), 6)} staked, ${formatNearAmount(s.unstaked.toString(), 6)} unstaked${s.withdrawable ? " (ready to withdraw)" : ""}`);
};

if (cmd === "pools") {
  for (const p of (await stakingPools()).slice(0, 10)) console.log(`${p.pool}  fee ${(p.fee * 100).toFixed(0)}%`);
} else if (cmd === "status") {
  await show();
} else if (["stake", "unstake", "withdraw"].includes(cmd)) {
  const owner = account(ownerId);
  if (fund) {
    const r = await owner.transfer({ receiverId: acct, amount: BigInt(parseNearAmount(fund)) });
    console.log(`funded ${acct} with ${fund} NEAR: ${NEAR_EXPLORER}/tx/${r.transaction.hash}`);
    // the tx params are read at "final"; a fresh account shows up there a few blocks later
    for (let i = 0; i < 20 && !(await nearBalances(acct, 0)).exists; i++) await new Promise((ok) => setTimeout(ok, 1500));
  }
  const { nonce, blockHash } = await nearTxParams(acct);
  const signed = await call(owner, "stake_near", {
    token_id: tokenId, pool, action: cmd, amount: parseNearAmount(amount) ?? "0", nonce: String(nonce), block_hash: blockHash,
  }, { deposit: 10_000_000_000_000_000_000_000n, tgas: 300 });
  if (signed.account !== acct) throw new Error(`contract signed for ${signed.account}, expected ${acct}`);
  const tx = await broadcastNear(await finalizeNear(signed));
  console.log(`${cmd} ${cmd === "withdraw" ? "all unstaked" : `${amount} NEAR`} at ${pool}, signed by NEAR MPC for ${acct}: ${NEAR_EXPLORER}/tx/${tx}`);
  await show();
} else {
  console.log("usage: node stake.mjs <owner> <token_id> pools | status | stake <pool> <near> [--fund=<near>] | unstake <pool> <near> | withdraw <pool>");
}
