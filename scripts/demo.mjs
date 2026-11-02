// End-to-end Pusaka demo on NEAR testnet + Bitcoin testnet4.
//
//   npm run demo                      fresh seller/buyer accounts (NEAR faucet), new token
//   npm run demo -- --token 1 --seller a.testnet --buyer b.testnet   reuse accounts in .keys/
//
// The only manual step: funding the token's BTC address once (one click at coinfaucet.eu).
import { parseNearAmount } from "near-api-js";
import fs from "node:fs";
import {
  CONTRACT, account, balances, broadcast, btcAddress, call, faucetAccount, finalize,
  keyFile, scriptHex, sleep, view, WITHDRAW_DEPOSIT, MINT_DEPOSIT,
} from "./lib.mjs";

const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
const PRICE = parseNearAmount("1");
const RETURN_TO = "tb1qerzrlxcfu24davlur5sqmgzzgsal6wusda40er"; // coinfaucet.eu return address
const step = (n, s) => console.log(`\n\x1b[1m${n}. ${s}\x1b[0m`);
const ok = (s) => console.log(`   \x1b[32m✓\x1b[0m ${s}`);

async function expectFail(what, fn, needle) {
  try { await fn(); } catch (e) {
    const msg = String(e?.message ?? e);
    if (msg.includes(needle)) return ok(`${what} → rejected (${needle})`);
    throw e;
  }
  throw new Error(`${what} should have failed with ${needle}`);
}

async function ensureAccount(id) {
  if (!fs.existsSync(keyFile(id))) { await faucetAccount(id); ok(`created ${id} (NEAR testnet faucet)`); }
  return account(id);
}

// ---------- 0. accounts ----------
const tag = Date.now().toString(36);
const sellerId = arg("seller") ?? `pusaka-s-${tag}.testnet`;
const buyerId = arg("buyer") ?? `pusaka-b-${tag}.testnet`;
step(0, `Accounts on ${CONTRACT}`);
let seller = await ensureAccount(sellerId);
let buyer = await ensureAccount(buyerId);

// ---------- 1. mint ----------
let tokenId = arg("token");
if (!tokenId) {
  step(1, "Seller mints a Pusaka");
  await call(seller, "nft_mint", {}, { deposit: MINT_DEPOSIT });
  tokenId = String(await view("nft_total_supply"));
}
let info = await view("token_info", { token_id: tokenId });
if (info.token.owner_id !== seller.accountId) [seller, buyer] = [buyer, seller]; // reuse: whoever owns it sells
const addr = btcAddress(info.btc_pubkey);
ok(`Pusaka #${tokenId} owned by ${info.token.owner_id}`);
ok(`its native Bitcoin address: ${addr}  (key derived on-chain by the NEAR MPC network)`);

// ---------- 2. fund ----------
step(2, "Put real (testnet4) BTC inside it");
let bal = await balances(addr, info.signed_outpoints);
if (bal.safe + bal.pending < 2000) {
  console.log(`   → open https://coinfaucet.eu/en/btc-testnet4/ and send to ${addr}`);
  console.log("   waiting for the deposit to show up in the mempool…");
  while ((bal = await balances(addr, info.signed_outpoints)).safe + bal.pending < 2000) await sleep(5000);
}
if (bal.safe < 2000) {
  // A buyer only counts confirmed coins: an unconfirmed deposit can still be replaced (RBF).
  console.log(`   ${bal.pending} sats seen, waiting up to 2 min for a Bitcoin confirmation…`);
  const until = Date.now() + 120_000;
  while ((bal = await balances(addr, info.signed_outpoints)).safe < 2000 && Date.now() < until) await sleep(15000);
}
if (bal.safe >= 2000) ok(`safe balance: ${bal.safe} sats confirmed  https://mempool.space/testnet4/address/${addr}`);
else console.log(`   \x1b[33m!\x1b[0m testnet4 hasn't confirmed it yet (its blocks are irregular). Continuing so the demo finishes;
     the web app shows these ${bal.pending} sats as "waiting for confirmation", not safe, and a real buyer should wait.`);

// ---------- 3. list ----------
step(3, `${seller.accountId} lists it for 1 NEAR`);
await call(seller, "list", { token_id: tokenId, price: PRICE });
ok("listed — withdrawals are now locked by the contract");
await expectFail("seller tries to withdraw while listed", () =>
  call(seller, "withdraw", {
    token_id: tokenId, utxos: bal.spendable.slice(0, 1).map((u) => ({ txid: u.txid, vout: u.vout, value: String(u.value) })),
    to_script_hex: scriptHex(RETURN_TO), amount_sat: "1000", fee_sat: "300",
  }, { deposit: WITHDRAW_DEPOSIT, tgas: 300 }), "Listed");

// ---------- 4. buy ----------
step(4, `${buyer.accountId} checks the safe balance, then buys`);
info = await view("token_info", { token_id: tokenId });
bal = await balances(addr, info.signed_outpoints);
ok(`buyer verifies: ${bal.safe} sats safe (confirmed), ${bal.pending} unconfirmed, ${bal.atRisk} at risk, ${info.signed_outpoints.length} signed outpoint(s)`);
const t0 = Date.now();
await call(buyer, "buy", { token_id: tokenId, expected_signed_count: info.signed_outpoints.length }, { deposit: BigInt(PRICE) });
const saleSecs = ((Date.now() - t0) / 1000).toFixed(1);
info = await view("token_info", { token_id: tokenId });
ok(`sold in ${saleSecs}s — new owner: ${info.token.owner_id}. The BTC never moved on Bitcoin.`);

// ---------- 5. old owner is out ----------
step(5, "The old owner tries to take the BTC");
await expectFail(`${seller.accountId} withdraws`, () =>
  call(seller, "withdraw", {
    token_id: tokenId, utxos: bal.spendable.slice(0, 1).map((u) => ({ txid: u.txid, vout: u.vout, value: String(u.value) })),
    to_script_hex: scriptHex(RETURN_TO), amount_sat: "1000", fee_sat: "300",
  }, { deposit: WITHDRAW_DEPOSIT, tgas: 300 }), "NotOwner");

// ---------- 6. new owner withdraws ----------
step(6, `${buyer.accountId} withdraws 1000 sats to a Bitcoin address`);
const ins = bal.spendable.slice(0, 8);
const t1 = Date.now();
const signed = await call(buyer, "withdraw", {
  token_id: tokenId, utxos: ins.map((u) => ({ txid: u.txid, vout: u.vout, value: String(u.value) })),
  to_script_hex: scriptHex(RETURN_TO), amount_sat: "1000", fee_sat: "300",
}, { deposit: WITHDRAW_DEPOSIT, tgas: 300 });
ok(`NEAR MPC network signed ${signed.signatures.filter(Boolean).length}/${ins.length} input(s) in ${((Date.now() - t1) / 1000).toFixed(1)}s`);
const txid = await broadcast(finalize(signed, ins.map((u) => u.value)).toHex());
ok(`broadcast to Bitcoin testnet4: https://mempool.space/testnet4/tx/${txid}`);

// ---------- 7–8. borrow against it, default, lender takes it ----------
const LOAN_MS = 20_000;
step(7, `${buyer.accountId} borrows 0.5 NEAR against the Pusaka, repaying 0.55 within ${LOAN_MS / 1000}s`);
await call(buyer, "request_loan", {
  token_id: tokenId, principal: parseNearAmount("0.5"), repay: parseNearAmount("0.55"), duration_ms: String(LOAN_MS),
});
info = await view("token_info", { token_id: tokenId });
await call(seller, "fund_loan", { token_id: tokenId, expected_signed_count: info.signed_outpoints.length }, { deposit: BigInt(parseNearAmount("0.5")) });
ok(`${seller.accountId} lent 0.5 NEAR; it went straight to the borrower`);
await expectFail("borrower tries to withdraw the collateral", () =>
  call(buyer, "withdraw", {
    token_id: tokenId, utxos: [{ txid: "00".repeat(32), vout: 0, value: "10000" }],
    to_script_hex: scriptHex(RETURN_TO), amount_sat: "1000", fee_sat: "300",
  }, { deposit: WITHDRAW_DEPOSIT, tgas: 300 }), "Collateralised");
await expectFail("lender tries to claim before the due date", () => call(seller, "claim_collateral", { token_id: tokenId }), "NotDueYet");

step(8, "The loan isn't repaid in time");
await sleep(LOAN_MS + 2000);
await call(seller, "claim_collateral", { token_id: tokenId });
info = await view("token_info", { token_id: tokenId });
ok(`${seller.accountId} claimed the collateral — new owner: ${info.token.owner_id}, BTC included. No bridge, no liquidation bot.`);

console.log(`\nDone. Pusaka #${tokenId} history:`);
for (const h of info.history) console.log(`   ${new Date(Number(h.at_ms)).toISOString()}  ${h.event.kind}`);
