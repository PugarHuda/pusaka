// Live: a Pusaka's own Bitcoin swapped through NEAR Intents, executed, on testnet.
//   node intents-exit.mjs <owner.testnet> <token_id> <testnet4_funding_txid> [sats=20000] [--to <account>]
//   --to: where the USDC goes (default the owner). On Pusaka v2 (PUSAKA_CONTRACT=pusaka-v2.testnet) pass the NFT's own
//   account (`account_of`): the proceeds then stay inside the NFT, move with it when it's sold, and leave only via
//   the holder's `account_call`.
// NEAR Intents (1Click) has no testnet, so this uses Tidepool (usetidepool.tech): the same API on testnet, settled by
// NEAR's unmodified `defuse` verifier. Its Bitcoin route is testnet4 with a custodial test relayer (README). The web
// app's "Swap to USDC" form runs the same steps from shared/intents.mjs.
import assert from "node:assert/strict";
import { testnet4Coins, swapQuote, broadcastTestnet4, submitDeposit, swapStatus, SWAP_DONE, TIDEPOOL_USDC } from "@pusaka/shared";
import { account, call, view, btcAddress, scriptHex, finalize, WITHDRAW_DEPOSIT, NEAR_EXPLORER } from "./lib.mjs";

const toAt = process.argv.indexOf("--to"), to = toAt > 0 ? process.argv.splice(toAt, 2)[1] : null;
const [ownerId, id, fundingTxid, satsArg] = process.argv.slice(2);
const recipient = to ?? ownerId;
if (!ownerId || !id || !fundingTxid) throw new Error("usage: node intents-exit.mjs <owner> <token_id> <funding_txid> [sats]");
const sats = Number(satsArg ?? 20_000), FEE = 500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const info = await view("token_info", { token_id: id });
assert.equal(info.token.owner_id, ownerId, `#${id} is held by ${info.token.owner_id}`);
const addr = btcAddress(info.btc_pubkey);
const utxos = await testnet4Coins(fundingTxid, addr);
const have = utxos.reduce((a, u) => a + u.value, 0);
console.log(`Pusaka #${id} ${addr}: ${have} sats on testnet4 in ${fundingTxid.slice(0, 12)}…`);
assert.ok(have >= sats + FEE, `needs ${sats + FEE} sats`);

// 1. live quote: BTC -> USDC on NEAR to the owner, refunds to the Pusaka's own address
const q = await swapQuote(sats, recipient, addr);
console.log(`1. quote ${q.id}: ${sats} sats -> ${q.usdc} USDC (min ${q.minUsdc}) to ${recipient}; deposit to ${q.depositAddress}`);

// 2. the contract builds the spend, NEAR MPC signs it
const t0 = Date.now();
const signed = await call(account(ownerId), "withdraw", {
  token_id: id, utxos: utxos.map((u) => ({ txid: u.txid, vout: u.vout, value: String(u.value) })),
  to_script_hex: scriptHex(q.depositAddress), amount_sat: String(sats), fee_sat: String(FEE),
}, { deposit: WITHDRAW_DEPOSIT, tgas: 300 });
const txid = await broadcastTestnet4(finalize(signed, utxos.map((u) => u.value)).toHex());
console.log(`2. NEAR MPC signed in ${((Date.now() - t0) / 1000).toFixed(1)} s; Bitcoin testnet4 tx ${txid}`);

// 3. report the deposit, follow the swap
await submitDeposit(txid, q.depositAddress);
let st;
for (let i = 0; i < 120; i++) {
  st = await swapStatus(q.depositAddress);
  if (i % 4 === 0) console.log(`   status ${st.status}`);
  if (SWAP_DONE.includes(st.status)) break;
  await sleep(15_000);
}
console.log(`3. ${st.status}`, JSON.stringify(st.swapDetails ?? {}).slice(0, 600));
const bal = await view("ft_balance_of", { account_id: recipient }, TIDEPOOL_USDC.slice(7));
console.log(`   ${recipient} holds ${Number(bal) / 1e6} USDC on ${TIDEPOOL_USDC.slice(7)}`);
for (const h of st.swapDetails?.nearTxHashes ?? []) console.log(`   settlement ${NEAR_EXPLORER}/tx/${h}`);
assert.equal(st.status, "SUCCESS");
