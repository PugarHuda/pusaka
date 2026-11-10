// Live (testnet): F14 vault, F15 covered call on a Smart Pusaka (pusaka-v2.testnet), and a market buy pool.
//   PUSAKA_CONTRACT=pusaka-v2.testnet node scripts/v2-vault-call.mjs vault <holder> <token_id> <recovery>
//       vaults it (60 s delay), shows the holder's own key refused (VaultLocked), requests an unlock, and the recovery
//       account claws it back during the delay
//   PUSAKA_CONTRACT=pusaka-v2.testnet node scripts/v2-vault-call.mjs call <writer> <token_id> <buyer>
//       writes a covered call, the writer's withdrawal is refused while it's open, the buyer buys it and exercises
//   PUSAKA_CONTRACT=pusaka-v2.testnet node scripts/v2-vault-call.mjs btccall <writer> <token_id> <buyer> <pay_to_tb1>
//       a call whose strike is paid in native Bitcoin (F16): written, NEAR exercise refused, bought, exercise reserved
//   node scripts/v2-vault-call.mjs pool <bidder> <seller> <token_id> <near_per_10k_sats> <fills>
//       a buy pool on the original contract: the seller sells into it and the pool stays open one step lower
import { account, callRaw, view, scriptHex, NEAR_EXPLORER } from "./lib.mjs";

const V2 = "pusaka-v2.testnet", NFT = "pusaka-btc.testnet", MARKET = "pusaka-market.testnet";
const near = (n) => BigInt(Math.round(Number(n) * 1e6)) * 10n ** 18n;
const link = (o) => `${NEAR_EXPLORER}/tx/${o.transaction.hash}`;
const tx = (who, method, args, deposit = 0n, tgas = 100, receiver = V2) => callRaw(account(who), method, args, { deposit, tgas, receiver });
const owner = async (id, c = V2) => (await view("nft_token", { token_id: id }, c)).owner_id;
async function refused(what, why, f) {
  try { await f(); } catch (e) {
    const m = String(e.message ?? e);
    if (!why.test(m)) throw e;
    // the refused transaction's hash, when the RPC error carries it
    return console.log(`refused: ${what}: ${m.match(why)[0]}${m.match(/[1-9A-HJ-NP-Za-km-z]{43,44}/) ? ` (${m.match(/[1-9A-HJ-NP-Za-km-z]{43,44}/)[0]})` : ""}`);
  }
  throw new Error(`${what} should have been refused`);
}
const [step, ...a] = process.argv.slice(2);

if (step === "vault") {
  const [holder, token_id, recovery] = a;
  console.log(`vault: ${link(await tx(holder, "set_vault", { token_id, recovery, delay_ms: "60000" }, near(0.01), 30))}`);
  await refused("the holder's own key moves it at once (what a thief would try)", /VaultLocked/, () =>
    tx(holder, "nft_transfer", { receiver_id: recovery, token_id }, 1n, 100));
  const o = await tx(holder, "request_unlock", { token_id });
  console.log(`unlock requested (opens in 60 s; ${recovery} notified): ${link(o)}`);
  const c = await tx(recovery, "vault_clawback", { token_id });
  console.log(`clawed back by ${recovery} during the delay; #${token_id} now held by ${await owner(token_id)}: ${link(c)}`);
} else if (step === "call") {
  const [writer, token_id, buyer] = a;
  const w = await tx(writer, "write_call", { token_id, strike: near(0.2).toString(), premium: near(0.01).toString(), expires_ms: String(Date.now() + 3_600_000) }, near(0.01), 30);
  console.log(`call written (strike 0.2 NEAR, premium 0.01, 1 h): ${link(w)}`);
  await refused("the writer withdraws its Bitcoin under the call", /CallWritten/, () =>
    tx(writer, "withdraw", { token_id, utxos: [{ txid: "11".repeat(32), vout: 0, value: "10000" }], to_script_hex: "0014" + "11".repeat(20), amount_sat: "5000", fee_sat: "500" }, near(0.02), 300));
  const { sign_epoch } = await view("token_info", { token_id }, V2);
  console.log(`bought by ${buyer}: ${link(await tx(buyer, "buy_call", { token_id, expected_sign_epoch: sign_epoch }, near(0.01)))}`);
  console.log(`exercised; #${token_id} now held by ${(await tx(buyer, "exercise_call", { token_id }, near(0.2)), await owner(token_id))}`);
} else if (step === "btccall") {
  // F16: the strike is paid in native Bitcoin; then `v2-bitcoin.mjs pay <id>` and `prove-exercise`
  const [writer, token_id, buyer, payTo] = a;
  const w = await tx(writer, "write_btc_call", { token_id, strike_sats: "1000", pay_to_script: scriptHex(payTo), premium: near(0.01).toString(), expires_ms: String(Date.now() + 3_600_000) }, near(0.01), 30);
  console.log(`Bitcoin call written (strike 1,000 sats to ${payTo}, premium 0.01 NEAR, 1 h): ${link(w)}`);
  const { sign_epoch } = await view("token_info", { token_id }, V2);
  console.log(`bought by ${buyer}: ${link(await tx(buyer, "buy_call", { token_id, expected_sign_epoch: sign_epoch }, near(0.01)))}`);
  await refused("exercising a Bitcoin call with NEAR", /strike is paid on Bitcoin/, () => tx(buyer, "exercise_call", { token_id }, near(1)));
  const r = await tx(buyer, "reserve_btc_exercise", { token_id });
  console.log(`exercise reserved, OP_RETURN ${JSON.parse(Buffer.from(r.status.SuccessValue, "base64").toString())}: ${link(r)}`);
} else if (step === "pool") {
  const [bidder, seller, token_id, per10k, fills] = a;
  const { verified_sats } = await view("token_info", { token_id }, NFT);
  const perSat = near(per10k) / 10_000n, max = 20_000n;
  const o = await tx(bidder, "place_pool", { price_per_sat_yocto: String(perSat), delta_yocto: String(perSat / 10n), fills: Number(fills), min_sats: "1000", max_sats: String(max), nft: NFT },
    perSat * max * BigInt(fills) + 10n ** 22n, 30, MARKET);
  const id = JSON.parse(Buffer.from(o.status.SuccessValue, "base64").toString());
  console.log(`pool ${id}: ${per10k} NEAR per 10k sats, ${fills} fills, -10% a fill: ${link(o)}`);
  const f = await tx(seller, "nft_approve", { token_id, account_id: MARKET, msg: JSON.stringify({ bid_id: id }) }, 10n ** 21n, 300, NFT);
  const bid = await view("bid", { bid_id: id }, MARKET);
  console.log(`#${token_id} (${verified_sats} sats) sold into it, now held by ${await owner(token_id, NFT)}: ${link(f)}`);
  console.log(`pool still open: ${bid.price_per_sat} yocto/sat, ${(await view("curve_of", { bid_id: id }, MARKET)).fills_left} fills left`);
} else throw new Error("step: vault | call | btccall | pool");
