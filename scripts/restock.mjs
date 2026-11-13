// Keep the README's "try it" demo usable for every judge, not just the first one: make sure the demo account has
// SALE Pusakas listed and LOAN Pusakas asking for a loan, each backed by verified BTC. Missing stock is minted and
// funded from a reserve Pusaka's own BTC (a real withdrawal), proven through the light client, then listed.
//   node restock.mjs [--sale 3] [--loan 3] [--reserve 1] [--reserve-contract pusaka-btc.testnet]
// --reserve-contract: the reserve lives on another Pusaka contract (the classic one holds the BTC; v2's stock is funded from it)
// It also keeps one standing loan offer from LENDER open, for any Pusaka with >= 10,000 verified sats: a judge who
// buys one can borrow against it at once, gas-free.
// Re-run until it says "stock full": funding needs one Bitcoin confirmation plus the light client catching up.
import { parseNearAmount } from "near-api-js";
import { CONTRACT } from "@pusaka/shared";
import {
  account, call, callRaw, view, btcAddress, scriptHex, balances, finalize, broadcast, utxos, depositProof,
  lightClientHeight, mintedTokenId, MINT_DEPOSIT, WITHDRAW_DEPOSIT, PROVE_DEPOSIT, EXPLORER,
} from "./lib.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const SALE = Number(arg("sale", 3)), LOAN = Number(arg("loan", 3)), RESERVE = arg("reserve", "1"), RC = arg("reserve-contract", CONTRACT);
const isReserve = (t) => RC === CONTRACT && t.id === RESERVE; // a reserve on another contract is never one of this contract's tokens
const DEMO = "pusaka-buyer.testnet", SATS = 10_000, FEE = 500; // SATS = the contract's MIN_PROVEN_SATS
const provable = async (t) => (await utxos(btcAddress(t.btc_pubkey))).filter((u) => u.value >= SATS
  && !t.proven_utxos.some((p) => p.txid === u.txid && p.vout === u.vout));
const PRICE = parseNearAmount("0.5"), LOAN_TERMS = { principal: PRICE, repay: parseNearAmount("0.501"), duration_ms: String(3 * 86_400_000) };
const me = account(DEMO);
const LENDER = "pusaka-seller.testnet", OFFER = { principal: parseNearAmount("0.05"), repay: parseNearAmount("0.0501"), duration_ms: String(3 * 86_400_000) };
if (!(await view("loan_offers", { from: "0", limit: "100" })).offers.some((o) => o.offer.lender === LENDER)) {
  const id = await call(account(LENDER), "offer_loan", { token_id: null, min_verified_sats: String(SATS), ...OFFER }, { deposit: BigInt(OFFER.principal) + BigInt(parseNearAmount("0.01")) });
  console.log(`standing offer ${id}: ${LENDER} lends 0.05 NEAR to any Pusaka with >= ${SATS} verified sats`);
}
const prove = async (t, receiver = CONTRACT) => {
  const lc = await lightClientHeight();
  for (const u of await provable(t)) {
    if (!u.status.confirmed || u.status.block_height > lc) { console.log(`#${t.id}: deposit ${u.txid.slice(0, 12)}… waiting (light client at ${lc})`); continue; }
    await call(me, "prove_deposit", { token_id: t.id, ...(await depositProof(u.txid, u.vout)) }, { deposit: PROVE_DEPOSIT, tgas: 100, receiver });
    console.log(`#${t.id}: proved ${u.value} sats`);
  }
};
// the reserve's change from earlier funding is a deposit too; prove it so its own loan ask is backed again
await prove({ id: RESERVE, ...(await view("token_info", { token_id: RESERVE }, RC)) }, RC);

const all = [];
for (let i = 1; i <= Number(await view("nft_total_supply")); i++) all.push({ id: String(i), ...(await view("token_info", { token_id: String(i) })) });
const mine = all.filter((t) => t.token.owner_id === DEMO);
const sale = mine.filter((t) => t.listing && +t.verified_sats > 0);
const loan = mine.filter((t) => t.loan && !t.loan.lender && (+t.verified_sats > 0 || isReserve(t))); // the reserve re-proves its change
// demo Pusakas holding Bitcoin (proven or on the way) that aren't offered yet; the reserve stays out of it
const idle = [];
for (const t of mine) if (!isReserve(t) && !t.listing && !t.loan && (+t.verified_sats > 0 || (await provable(t)).length)) idle.push(t);
console.log(`for sale: ${sale.map((t) => "#" + t.id)}; asking a loan: ${loan.map((t) => "#" + t.id)}; on the way: ${idle.map((t) => "#" + t.id)}`);

// 1. prove and offer the idle ones
for (const t of idle) {
  await prove(t);
  if (+(await view("token_info", { token_id: t.id })).verified_sats === 0) continue;
  if (sale.length < SALE) { await call(me, "list", { token_id: t.id, price: PRICE }); sale.push(t); console.log(`#${t.id}: listed at 0.5 NEAR`); }
  else if (loan.length < LOAN) { await call(me, "request_loan", { token_id: t.id, ...LOAN_TERMS }); loan.push(t); console.log(`#${t.id}: asks 0.5 NEAR, repays 0.501 in 3 days (~24% a year)`); }
}

// 2. mint and fund what is still missing
const offered = new Set([...sale, ...loan].map((t) => t.id));
const short = Math.max(0, SALE - sale.length) + Math.max(0, LOAN - loan.length) - idle.filter((t) => !offered.has(t.id)).length;
if (short <= 0) { console.log(sale.length >= SALE && loan.length >= LOAN ? "stock full" : "funded; re-run after a confirmation"); process.exit(0); }

let reserve = { id: RESERVE, ...(await view("token_info", { token_id: RESERVE }, RC)) };
if (reserve.token.owner_id !== DEMO) throw new Error(`reserve #${RESERVE} is held by ${reserve.token.owner_id}`);
const asked = reserve.loan && !reserve.loan.lender ? reserve.loan : null;
if (reserve.loan?.lender) throw new Error(`reserve #${RESERVE} is collateral for a funded loan`);
if (asked) await call(me, "cancel_loan_request", { token_id: RESERVE }, { receiver: RC });
if (reserve.listing) throw new Error(`reserve #${RESERVE} is listed`);
try {
  for (let n = 0; n < short; n++) {
    const id = mintedTokenId(await callRaw(me, "nft_mint", {}, { deposit: MINT_DEPOSIT }), DEMO);
    let t = await view("token_info", { token_id: id });
    for (let i = 0; !t.btc_pubkey && i < 20; i++) { await new Promise((r) => setTimeout(r, 3000)); t = await view("token_info", { token_id: id }); }
    // the previous withdrawal's change is unconfirmed; Esplora may take a few seconds to show it
    let spendable = [];
    for (let i = 0; !spendable.length && i < 20; i++) {
      if (i) await new Promise((r) => setTimeout(r, 3000));
      reserve = await view("token_info", { token_id: RESERVE }, RC);
      ({ spendable } = await balances(btcAddress(reserve.btc_pubkey), reserve.signed_outpoints));
    }
    const ins = spendable.slice(0, 8);
    const signed = await call(me, "withdraw", {
      token_id: RESERVE, utxos: ins.map((u) => ({ txid: u.txid, vout: u.vout, value: String(u.value) })),
      to_script_hex: scriptHex(btcAddress(t.btc_pubkey)), amount_sat: String(SATS), fee_sat: String(FEE),
    }, { deposit: WITHDRAW_DEPOSIT, tgas: 300, receiver: RC });
    const txid = await broadcast(finalize(signed, ins.map((u) => u.value)).toHex());
    console.log(`minted #${id}; #${RESERVE} sent it ${SATS} sats: ${EXPLORER}/tx/${txid}`);
  }
} finally {
  if (asked) await call(me, "request_loan", { token_id: RESERVE, principal: asked.principal, repay: asked.repay, duration_ms: asked.duration_ms }, { receiver: RC });
}
console.log("funded; re-run after a Bitcoin confirmation to prove and list");
