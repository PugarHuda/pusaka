// Prove every confirmed, unproven deposit of a Pusaka through the on-chain Bitcoin light client.
//   node prove.mjs <any-account.testnet> <token_id> [--wait]
// Anyone can prove a deposit; the caller only pays a small refundable storage deposit.
import { account, call, view, btcAddress, utxos, depositProof, lightClientHeight, PROVE_DEPOSIT, sleep } from "./lib.mjs";

const [callerId, tokenId = "1"] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const wait = process.argv.includes("--wait");
const caller = account(callerId);
let info = await view("token_info", { token_id: tokenId });
const addr = btcAddress(info.btc_pubkey);
const isProven = (u) => info.proven_utxos.some((p) => p.txid === u.txid && p.vout === u.vout);

let todo;
for (;;) {
  const list = await utxos(addr);
  todo = list.filter((u) => !isProven(u));
  const lc = await lightClientHeight();
  const confirmed = todo.filter((u) => u.status.confirmed && u.status.block_height <= lc);
  if (confirmed.length || !wait || !todo.length) { todo = confirmed; break; }
  console.log(`${todo.length} unproven deposit(s) waiting for a confirmation and for the light client (at ${lc}) to reach it…`);
  await sleep(20_000);
}
if (!todo.length) console.log("nothing to prove");

for (const u of todo) {
  const t0 = Date.now();
  const ok = await call(caller, "prove_deposit", { token_id: tokenId, ...(await depositProof(u.txid, u.vout)) },
    { deposit: PROVE_DEPOSIT, tgas: 100 });
  console.log(`${u.txid}:${u.vout} ${u.value} sats -> light client says ${ok} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}
info = await view("token_info", { token_id: tokenId });
console.log(`Pusaka #${tokenId}: ${info.verified_sats} sats verified on NEAR, ${info.proven_utxos.length} proven deposit(s)`);
