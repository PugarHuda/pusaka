// Deploys the Pusaka market (market/: standing bids per verified sat, perpetual callable loans) to a new testnet
// account created through the `testnet` registrar.
//   node scripts/market-deploy.mjs <funder> [account=pusaka-market.testnet]      (keys in .keys/)
// The account's key stays until the final deploy (13 Nov), then `delete-key` makes the market immutable.
//   node scripts/market-deploy.mjs delete-key [account]
import fs from "node:fs";
import path from "node:path";
import { KeyPair } from "near-api-js";
import { account, callRaw, saveKey, exists, view, NEAR_EXPLORER } from "./lib.mjs";

const [a, b] = process.argv.slice(2);
const MARKET = (a === "delete-key" ? b : b) ?? "pusaka-market.testnet";
const link = (o) => `${NEAR_EXPLORER}/tx/${o.transaction.hash}`;

if (a === "delete-key") {
  const m = account(MARKET);
  const keys = await m.getAccessKeyList();
  for (const k of keys.keys) console.log(`deleted ${k.public_key}: ${link(await m.deleteKey(k.public_key))}`);
  process.exit(0);
}

const wasm = fs.readFileSync(path.join(import.meta.dirname, "..", "market", "target", "near", "pusaka_market.wasm"));
if (!(await exists(MARKET))) {
  const kp = KeyPair.fromRandom("ed25519");
  saveKey(MARKET, kp); // before the account exists: a crash can't lose the key
  const o = await callRaw(account(a), "create_account", { new_account_id: MARKET, new_public_key: kp.getPublicKey().toString() },
    { deposit: 3n * 10n ** 24n, tgas: 100, receiver: "testnet" });
  console.log(`created ${MARKET}: ${link(o)}`);
}
const m = account(MARKET);
console.log(`deployed: ${link(await m.deployContract(wasm))}`);
try {
  console.log(`initialised: ${link(await callRaw(m, "new", {}, { receiver: MARKET }))}`);
} catch (e) {
  if (!/already initialized|state already exists/i.test(String(e.message))) throw e;
}
console.log("reserves:", JSON.stringify(await view("reserves", {}, MARKET)));
