// Pusaka lend (lend/): borrow pUSD against a Pusaka's proven Bitcoin, from a lender pool, liquidated at a price.
//   node scripts/lend.mjs deploy [funder]                 create + deploy pusaka-usd.testnet (pUSD) and pusaka-lend.testnet
//   node scripts/lend.mjs report                          each reporter posts BTC/USD from its own source
//   node scripts/lend.mjs supply <lender> <usd>           faucet pUSD and supply it to the pool
//   node scripts/lend.mjs borrow <holder> <contract> <token_id> <usd>
//   node scripts/lend.mjs repay <payer> <loan_id>
//   node scripts/lend.mjs status
//   node scripts/lend.mjs reporter-keys                   add a key per reporter that can only call report_price (for CI)
// In CI, LEND_REPORTER_KEYS = {"<reporter>": "ed25519:…"} holds only those limited keys (.github/workflows/lend-price.yml).
// Price: three reporters, each posting one independent source (mempool.space, CoinGecko, Rhea's nBTC pool on NEAR);
// the contract takes the median of fresh reports, at least 2 of 3, at most 1 hour old. On testnet all three
// reporter accounts are ours: the quorum guards against one bad source, not against us (the README says so).
import fs from "node:fs";
import path from "node:path";
import { KeyPair } from "near-api-js";
import { Account } from "near-api-js";
import { account, callRaw, saveKey, exists, view, provider, NEAR_EXPLORER } from "./lib.mjs";

export const LEND = "pusaka-lend.testnet", USD = "pusaka-usd.testnet";
const U = 1_000_000n; // pUSD has 6 decimals
const REPORTERS = {
  "pusaka-relayer.testnet": ["mempool.space", async () => (await j("https://mempool.space/api/v1/prices")).USD],
  "pusaka-admin.testnet": ["CoinGecko", async () => (await j("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd")).bitcoin.usd],
  "pusaka-seller.testnet": ["Rhea nBTC", async () => Number((await j("https://api.ref.finance/list-token-price"))["nbtc.bridge.near"].price)],
};
const j = async (u) => { const r = await fetch(u, { signal: AbortSignal.timeout(10_000) }); if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`); return r.json(); };
const link = (o) => `${NEAR_EXPLORER}/tx/${o.transaction.hash}`;
const failed = (o) => JSON.stringify(o.receipts_outcome.map((r) => r.outcome.status)).match(/Failure[^}]*}/)?.[0];
const logs = (o) => o.receipts_outcome.flatMap((r) => r.outcome.logs).filter((l) => l.includes("pusaka-lend")).map((l) => JSON.parse(l.slice(11)).event);
const usd = (x) => `${(Number(x) / 1e6).toLocaleString()} pUSD`;

const [cmd, ...a] = process.argv.slice(2);
const register = async (who) => {
  if (!(await view("storage_balance_of", { account_id: who }, USD))) await callRaw(account(who), "storage_deposit", { account_id: who }, { deposit: 1_250_000_000_000_000_000_000n, receiver: USD });
};

if (cmd === "deploy") {
  const funder = a[0] ?? "pusaka-buyer.testnet"; // storage: 1 NEAR per 100 kB of wasm, plus 0.6 for state
  for (const [id, wasm, args] of [
    [USD, "lend/pusd/target/near/pusd.wasm", {}],
    [LEND, "lend/target/near/pusaka_lend.wasm", { config: {
      stable: USD, nfts: ["pusaka-v2.testnet", "pusaka-btc.testnet"], reporters: Object.keys(REPORTERS), quorum: 2,
      max_age_ms: String(3_600_000), max_ltv_bps: 5000, liq_ltv_bps: 8000, liq_price_bps: 9500, rate_bps: 800, min_amount: String(U),
    } }],
  ]) {
    if (!(await exists(id))) {
      const kp = KeyPair.fromRandom("ed25519");
      saveKey(id, kp); // before the account exists: a crash can't lose the key
      console.log(`created ${id}: ${link(await callRaw(account(funder), "create_account", { new_account_id: id, new_public_key: kp.getPublicKey().toString() }, { deposit: BigInt(fs.statSync(path.join(import.meta.dirname, "..", wasm)).size) * 10n ** 19n + 6n * 10n ** 23n, tgas: 100, receiver: "testnet" }))}`);
    }
    const acct = account(id);
    console.log(`deployed ${id}: ${link(await acct.deployContract(fs.readFileSync(path.join(import.meta.dirname, "..", wasm))))}`);
    try { console.log(`initialised: ${link(await callRaw(acct, "new", args, { receiver: id }))}`); }
    catch (e) { if (!/already (been )?initialized|state already exists/i.test(String(e.message))) throw e; }
  }
  await callRaw(account(funder), "storage_deposit", { account_id: LEND }, { deposit: 1_250_000_000_000_000_000_000n, receiver: USD });
  console.log("pool:", JSON.stringify(await view("pool", {}, LEND)));
} else if (cmd === "report") {
  const got = [];
  for (const [who, [src, get]] of Object.entries(REPORTERS)) {
    try {
      const p = await get();
      if (!(p > 1000 && p < 10_000_000)) throw new Error(`implausible ${p}`);
      const limited = process.env.LEND_REPORTER_KEYS && JSON.parse(process.env.LEND_REPORTER_KEYS)[who];
      const o = await callRaw(limited ? new Account(who, provider, limited) : account(who), "report_price", { price: String(Math.round(p * 1e6)) }, { receiver: LEND, tgas: 10 });
      got.push(p); console.log(`${who} (${src}): ${p} USD/BTC ${failed(o) ?? link(o)}`);
    } catch (e) { console.log(`${who} (${src}): not reported (${e.message})`); }
  }
  console.log("contract price (median of fresh):", await view("price", {}, LEND));
} else if (cmd === "reporter-keys") {
  const out = {};
  for (const who of Object.keys(REPORTERS)) {
    const kp = KeyPair.fromRandom("ed25519");
    // function-call key: receiver pusaka-lend.testnet, method report_price only, 0.25 NEAR of gas allowance
    const o = await account(who).addFunctionCallAccessKey({ publicKey: kp.getPublicKey().toString(), contractId: LEND, methodNames: ["report_price"], allowance: 250_000_000_000_000_000_000_000n });
    out[who] = kp.toString();
    console.log(`${who}: report-only key ${kp.getPublicKey().toString()} ${link(o)}`);
  }
  fs.writeFileSync(path.join(import.meta.dirname, "..", ".keys", "lend-reporters.json"), JSON.stringify(out));
  console.log("saved .keys/lend-reporters.json (set it as the LEND_REPORTER_KEYS repository secret)");
} else if (cmd === "supply") {
  const [who, amount] = a, n = BigInt(Math.round(Number(amount) * 1e6));
  await register(who);
  for (let left = n; left > 0n; left -= left > 1000n * U ? 1000n * U : left)
    await callRaw(account(who), "faucet", { amount: String(left > 1000n * U ? 1000n * U : left) }, { receiver: USD, tgas: 30 });
  const o = await callRaw(account(who), "ft_transfer_call", { receiver_id: LEND, amount: String(n), msg: "supply" }, { deposit: 1n, tgas: 100, receiver: USD });
  console.log(`${who} supplied ${usd(n)}: ${failed(o) ?? link(o)}; shares ${(await view("shares_of", { account_id: who }, LEND))}`);
} else if (cmd === "borrow") {
  const [who, nft, token_id, amount] = a;
  await register(who);
  const o = await callRaw(account(who), "nft_transfer_call", { receiver_id: LEND, token_id, msg: JSON.stringify({ borrow: String(Math.round(Number(amount) * 1e6)) }) },
    { deposit: 1n, tgas: 300, receiver: nft });
  console.log(`${who} borrowed against ${nft} #${token_id}: ${logs(o).join(", ") || "no event"} ${failed(o) ?? ""} ${link(o)}`);
  console.log("loans:", JSON.stringify(await view("loans", {}, LEND), null, 1));
} else if (cmd === "repay") {
  const [who, id] = a;
  const l = await view("loan", { loan_id: id }, LEND);
  const pay = BigInt(l.debt) + U / 100n; // a cent extra for the seconds until it lands; the rest comes back
  const have = BigInt(await view("ft_balance_of", { account_id: who }, USD));
  if (have < pay) await callRaw(account(who), "faucet", { amount: String(pay - have) }, { receiver: USD, tgas: 30 });
  const o = await callRaw(account(who), "ft_transfer_call", { receiver_id: LEND, amount: String(pay), msg: JSON.stringify({ repay: Number(id) }) }, { deposit: 1n, tgas: 200, receiver: USD });
  console.log(`${who} repaid loan ${id} (debt ${usd(l.debt)}): ${logs(o).join(", ")} ${failed(o) ?? ""} ${link(o)}`);
} else if (cmd === "status") {
  console.log("price:", await view("price", {}, LEND), "\nreports:", JSON.stringify(await view("reports", {}, LEND)));
  console.log("pool:", JSON.stringify(await view("pool", {}, LEND)), "\nloans:", JSON.stringify(await view("loans", {}, LEND), null, 1));
} else console.log("usage: deploy <funder> | report | supply <lender> <usd> | borrow <holder> <contract> <token_id> <usd> | repay <payer> <loan_id> | status");
