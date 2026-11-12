// nBTC back to native Bitcoin: the plan the Omni BTC connector accepts, and the account_call args a Smart Pusaka's keyless
// account sends. Shared by scripts/v2-nbtc-redeem.mjs, the web app and the MCP server.
import { NBTC, BTC_CONNECTOR, scriptHex } from "./btc.mjs";

/**
 * The connector's rules (learned live, 13 Nov): more inputs than change outputs, and any change below its smallest input.
 * The plan that always fits: one of its UTXOs spent whole, no change: the largest one `have` nBTC covers.
 * `view(method, args, contract)` reads NEAR. Returns { input, sats, btc_fee, bridge_fee, total, args } or throws.
 * ponytail: 2 sat/vB; P2WPKH 1-in-1-out = 109.5 vB.
 */
export async function redeemPlan({ have, to, view }) {
  const cfg = await view("get_config", {}, BTC_CONNECTOR);
  const bridgeFee = BigInt(cfg.withdraw_bridge_fee.fee_min); // fee_rate is 0 on testnet
  const btcFee = BigInt(Math.max(Number(cfg.min_btc_gas_fee), Math.ceil(109.5 * 2)));
  const utxos = Object.entries(await view("get_utxos_paged", {}, BTC_CONNECTOR))
    .map(([k, u]) => ({ txid: k.split("@")[0], vout: u.vout, balance: BigInt(u.balance) }));
  const fits = utxos.filter((x) => x.balance + bridgeFee <= BigInt(have) && x.balance - btcFee >= BigInt(cfg.min_withdraw_amount));
  const u = fits.sort((a, b) => (a.balance > b.balance ? -1 : 1))[0];
  if (!u) {
    const smallest = utxos.map((x) => x.balance).sort((a, b) => (a < b ? -1 : 1))[0];
    throw new Error(`${have} nBTC isn't enough to redeem: the connector's smallest coin is ${smallest} sats, plus a ${bridgeFee}-sat bridge fee`);
  }
  const sats = u.balance - btcFee, total = u.balance + bridgeFee;
  const msg = JSON.stringify({ Withdraw: { target_btc_address: to, input: [`${u.txid}:${u.vout}`],
    output: [{ value: Number(sats), script_pubkey: scriptHex(to) }], max_gas_fee: String(btcFee) } });
  return { input: `${u.txid}:${u.vout}`, sats: Number(sats), btc_fee: Number(btcFee), bridge_fee: Number(bridgeFee), total: String(total),
    // for account_call: the NFT's account sends this ft_transfer_call to the nBTC token
    call: { receiver_id: NBTC, method_name: "ft_transfer_call", deposit: "1", gas_tgas: 150,
      args: btoa(JSON.stringify({ receiver_id: BTC_CONNECTOR, amount: String(total), msg })) } };
}
