// Live: a Pusaka inside a Pusaka, sold as one. A v1 Pusaka (with its Bitcoin) goes into a v2 Pusaka's own keyless NEAR
// account; selling the v2 NFT then hands over everything in that account: the inner Pusaka, its Bitcoin, any tokens.
//   node scripts/nested.mjs <holder> <buyer> <v1_token> <v2_token>      (keys in ../.keys; testnet)
// 1. holder puts v1 #inner into v2 #outer's account
// 2. refused: holder's own key on the inner Pusaka (NotOwner); holder signing Bitcoin for it *through* the outer NFT
//    (AccountGrant: the NFT's account only moves assets, so no signature can be withheld and outlive a sale)
// 3. buyer buys v2 #outer   4. refused: the old holder pulls the inner one out   5. buyer unwraps it and moves its BTC
import assert from "node:assert/strict";
import { parseNearAmount } from "near-api-js";
import { account, callRaw, view, btcAddress, scriptHex, finalize, broadcast, balances, WITHDRAW_DEPOSIT, EXPLORER, NEAR_EXPLORER } from "./lib.mjs";

const V1 = "pusaka-btc.testnet", V2 = "pusaka-v2.testnet", USDC = "usdc.tidepool-sandbox.testnet";
const [holder, buyer, inner, outer] = process.argv.slice(2);
if (!outer) throw new Error("usage: node nested.mjs <holder> <buyer> <v1_token> <v2_token>");
const link = (h) => `${NEAR_EXPLORER}/tx/${h}`;
const refused = async (label, f) => {
  try { await f(); } catch (e) {
    const m = String(e.message ?? e), h = e.transactionResult?.transaction?.hash;
    console.log(`   refused: ${label}: ${m.match(/(NotOwner|AccountGrant[^:]*|Smart contract panicked: [^\n]{0,60})/)?.[0] ?? m.slice(0, 100)}${h ? ` ${link(h)}` : ""}`);
    return;
  }
  throw new Error(`${label} should have been refused`);
};
const viaNft = (who, receiver_id, method_name, args, deposit = "1", gas_tgas = 50) => callRaw(account(who), "account_call",
  { token_id: outer, alias: false, receiver_id, method_name, args: Buffer.from(JSON.stringify(args)).toString("base64"), deposit, gas_tgas },
  { deposit: 1n, tgas: gas_tgas + 60, receiver: V2 });
const withdrawArgs = async (sats) => {
  const t = await view("token_info", { token_id: inner }, V1);
  const { spendable } = await balances(btcAddress(t.btc_pubkey), t.signed_outpoints);
  const ins = spendable.slice(0, 2);
  const to = btcAddress((await view("token_info", { token_id: "1" }, V1)).btc_pubkey); // back to the demo reserve
  return { ins, args: { token_id: inner, utxos: ins.map((u) => ({ txid: u.txid, vout: u.vout, value: String(u.value) })),
    to_script_hex: scriptHex(to), amount_sat: String(sats), fee_sat: "500" } };
};

const nft = await view("account_of", { token_id: outer }, V2);
const usdc = async () => Number(await view("ft_balance_of", { account_id: nft }, USDC)) / 1e6;

// 1. the inner Pusaka goes into the outer one's account
const info = await view("token_info", { token_id: inner }, V1);
if (info.token.owner_id !== nft) {
  assert.equal(info.token.owner_id, holder, `v1 #${inner} is held by ${info.token.owner_id}`);
  if (info.listing) await callRaw(account(holder), "cancel_listing", { token_id: inner }, { receiver: V1 });
  const t = await callRaw(account(holder), "nft_transfer", { receiver_id: nft, token_id: inner, memo: `into Pusaka v2 #${outer}` }, { deposit: 1n, receiver: V1 });
  console.log(`1. v1 #${inner} went into v2 #${outer}'s own account ${nft}: ${link(t.transaction.hash)}`);
}
console.log(`   v2 #${outer} now holds: v1 #${inner} (${info.verified_sats} verified sats) and ${await usdc()} USDC`);

// 2. nobody reaches the inner Bitcoin except by holding the outer NFT, and even then only by unwrapping it
await refused(`${holder}'s own key withdraws v1 #${inner}'s BTC`, async () => callRaw(account(holder), "withdraw", (await withdrawArgs(3000)).args, { deposit: WITHDRAW_DEPOSIT, tgas: 300, receiver: V1 }));
await refused(`${holder} has the outer NFT sign Bitcoin for the inner one`, async () => viaNft(holder, V1, "withdraw", (await withdrawArgs(3000)).args, parseNearAmount("0.02"), 200));

// 3. the outer NFT is sold, with everything inside
const price = parseNearAmount("0.3");
await callRaw(account(holder), "list", { token_id: outer, price }, { receiver: V2 });
const epoch = (await view("token_info", { token_id: outer }, V2)).sign_epoch;
const sale = await callRaw(account(buyer), "buy", { token_id: outer, expected_sign_epoch: epoch }, { deposit: BigInt(price), tgas: 100, receiver: V2 });
console.log(`3. ${buyer} bought v2 #${outer} for 0.3 NEAR: ${link(sale.transaction.hash)}`);

// 4. the old holder is out
await refused(`${holder}, the old holder, pulls v1 #${inner} out`, () => viaNft(holder, V1, "nft_transfer", { receiver_id: holder, token_id: inner }));

// 5. the buyer unwraps the inner Pusaka and uses its Bitcoin; takes some USDC out too
const un = await viaNft(buyer, V1, "nft_transfer", { receiver_id: buyer, token_id: inner, memo: `out of Pusaka v2 #${outer}` });
assert.equal((await view("nft_token", { token_id: inner }, V1)).owner_id, buyer);
console.log(`5. ${buyer} took v1 #${inner} out of the NFT it bought: ${link(un.transaction.hash)}`);
const { ins, args } = await withdrawArgs(3000);
const w = await callRaw(account(buyer), "withdraw", args, { deposit: WITHDRAW_DEPOSIT, tgas: 300, receiver: V1 });
const signed = JSON.parse(Buffer.from(w.status.SuccessValue, "base64").toString());
const txid = await broadcast(finalize(signed, ins.map((u) => u.value)).toHex());
console.log(`   and moved 3,000 of its sats, NEAR MPC signing for its new owner: ${link(w.transaction.hash)}\n   Bitcoin ${EXPLORER}/tx/${txid}`);
if (!(await view("storage_balance_of", { account_id: buyer }, USDC))) await callRaw(account(buyer), "storage_deposit", { account_id: buyer, registration_only: true }, { deposit: 1_250_000_000_000_000_000_000n, receiver: USDC, tgas: 30 });
const f = await viaNft(buyer, USDC, "ft_transfer", { receiver_id: buyer, amount: "1000000" });
console.log(`   and 1 USDC of the NFT's ${await usdc() + 1} USDC: ${link(f.transaction.hash)}`);
