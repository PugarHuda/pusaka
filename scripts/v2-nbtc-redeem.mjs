// Live: a Smart Pusaka's keyless account (NEP-616 `0s…`) turns its nBTC back into native Bitcoin through the Omni BTC
// connector, paid out to the Pusaka's own Bitcoin address. So BTC can leave the Pusaka as nBTC (usable in NEAR DeFi) and
// come back as native BTC, without anyone holding a key: the holder asks, the contract forwards one ft_transfer_call.
//   node scripts/v2-nbtc-redeem.mjs <holder> <token_id> [--dry]
// Plan: shared/nbtc.mjs (one connector UTXO spent whole; its rules). Near-One's relayer then has NEAR MPC sign the payout.
// Live 13 Nov: v2 #4 redeemed 3,600 nBTC (3fh6nare…) → 3,281 sats to its own address, Bitcoin tx 5aa00f73….
import { account, view, btcAddress, NEAR_EXPLORER } from "./lib.mjs";
import { NBTC } from "../shared/btc.mjs";
import { redeemPlan } from "../shared/nbtc.mjs";

const V2 = "pusaka-v2.testnet";
const [holder, token_id] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!token_id) throw new Error("usage: node scripts/v2-nbtc-redeem.mjs <holder> <token_id> [--dry]");

const acct = await view("account_of", { token_id }, V2);
const to = btcAddress((await view("token_info", { token_id }, V2)).btc_pubkey);
const have = await view("ft_balance_of", { account_id: acct }, NBTC);
const p = await redeemPlan({ have, to, view });
console.log(`Pusaka #${token_id}'s account ${acct}: ${have} nBTC; redeeming ${p.total} = ${p.sats} to ${to} + ${p.btc_fee} Bitcoin fee + ${p.bridge_fee} bridge fee (connector coin ${p.input})`);
if (process.argv.includes("--dry")) process.exit(0);

const out = await account(holder).callFunctionRaw({ contractId: V2, methodName: "account_call",
  args: { token_id, alias: false, ...p.call }, deposit: 1n, gas: 300_000_000_000_000n });
const failed = JSON.stringify(out.receipts_outcome.map((r) => r.outcome.status)).match(/Failure[^}]*}/);
console.log(`${failed ? "FAILED " + failed[0] : "sent"}: ${NEAR_EXPLORER}/tx/${out.transaction.hash}`);
console.log(`nBTC now ${await view("ft_balance_of", { account_id: acct }, NBTC)}; Near-One's relayer signs and broadcasts the Bitcoin payout to ${to}`);
