// Live: a Smart Pusaka's keyless account (NEP-616 `0s…`) turns its nBTC back into native Bitcoin through the Omni BTC
// connector, paid out to the Pusaka's own Bitcoin address. So BTC can leave the Pusaka as nBTC (usable in NEAR DeFi) and
// come back as native BTC, without anyone holding a key: the holder asks, the contract forwards one ft_transfer_call.
//   node scripts/v2-nbtc-redeem.mjs <holder> <token_id> [--dry]
// One of the connector's UTXOs is spent whole (its rules allow no change here); the ft amount = output + Bitcoin fee + bridge fee.
// Near-One's relayer then has NEAR MPC sign the Bitcoin tx and broadcasts it.
import { createBtcBuilder } from "@omni-bridge/btc";
import { account, view, btcAddress, NEAR_EXPLORER } from "./lib.mjs";
import { NBTC } from "../shared/btc.mjs";

const V2 = "pusaka-v2.testnet", CONNECTOR = "btc-connector.n-bridge.testnet";
const [holder, token_id] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!token_id) throw new Error("usage: node scripts/v2-nbtc-redeem.mjs <holder> <token_id> [--dry]");

const acct = await view("account_of", { token_id }, V2);
const to = btcAddress((await view("token_info", { token_id }, V2)).btc_pubkey);
const have = BigInt(await view("ft_balance_of", { account_id: acct }, NBTC));
const cfg = await view("get_config", {}, CONNECTOR);
const bridgeFee = BigInt(cfg.withdraw_bridge_fee.fee_min); // fee_rate is 0 on testnet
const utxos = Object.entries(await view("get_utxos_paged", {}, CONNECTOR))
  .map(([k, u]) => ({ txid: k.split("@")[0], vout: u.vout, balance: BigInt(u.balance), path: u.path }));
// The connector's rules: more inputs than change outputs, and any change below its smallest input (it consolidates). The
// plan that always fits: one of its UTXOs spent whole, no change: the largest one the nBTC covers. ponytail: 2 sat/vB,
// P2WPKH 1-in-1-out = 109.5 vB.
const btcFee = BigInt(Math.max(Number(cfg.min_btc_gas_fee), Math.ceil(109.5 * 2)));
const u = utxos.filter((x) => x.balance + bridgeFee <= have && x.balance - btcFee >= BigInt(cfg.min_withdraw_amount))
  .sort((a, b) => (a.balance > b.balance ? -1 : 1))[0];
if (!u) throw new Error(`no connector UTXO fits ${have} nBTC (smallest: ${utxos.map((x) => x.balance).sort((a, b) => (a < b ? -1 : 1))[0]} + ${bridgeFee} fee)`);
const plan = { inputs: [`${u.txid}:${u.vout}`], fee: btcFee,
  outputs: [{ value: Number(u.balance - btcFee), script_pubkey: createBtcBuilder({ network: "testnet" }).addressToScriptPubkey(to) }] };
const want = String(u.balance - btcFee);
const fee = plan.fee < BigInt(cfg.min_btc_gas_fee) ? BigInt(cfg.min_btc_gas_fee) : plan.fee;
const total = BigInt(want) + fee + bridgeFee;
console.log(`Pusaka #${token_id}'s account ${acct}: ${have} nBTC; redeeming ${total} = ${want} to ${to} + ${fee} Bitcoin fee + ${bridgeFee} bridge fee`);
if (total > have) throw new Error(`needs ${total} nBTC, has ${have}`);
if (BigInt(want) < BigInt(cfg.min_withdraw_amount)) throw new Error(`at least ${cfg.min_withdraw_amount} sats`);
if (process.argv.includes("--dry")) { console.log(JSON.stringify(plan, (_, v) => typeof v === "bigint" ? String(v) : v)); process.exit(0); }

const msg = JSON.stringify({ Withdraw: { target_btc_address: to, input: plan.inputs, output: plan.outputs, max_gas_fee: String(fee) } });
const args = Buffer.from(JSON.stringify({ receiver_id: CONNECTOR, amount: String(total), msg })).toString("base64");
const out = await account(holder).callFunctionRaw({ contractId: V2, methodName: "account_call",
  args: { token_id, alias: false, receiver_id: NBTC, method_name: "ft_transfer_call", args, deposit: "1", gas_tgas: 150 },
  deposit: 1n, gas: 300_000_000_000_000n });
const failed = JSON.stringify(out.receipts_outcome.map((r) => r.outcome.status)).match(/Failure[^}]*}/);
console.log(`${failed ? "FAILED " + failed[0] : "sent"}: ${NEAR_EXPLORER}/tx/${out.transaction.hash}`);
console.log(`nBTC now ${await view("ft_balance_of", { account_id: acct }, NBTC)}; Near-One's relayer signs and broadcasts the Bitcoin payout to ${to}`);
