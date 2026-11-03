// Live: list a Pusaka on Mintbase's market (NEP-178), buy it there (NEP-199), check BTC control moved.
//   node scripts/mintbase.mjs [token_id=2] [--list-only]
import { CONTRACT, MARKET } from "@pusaka/shared";
import { account, call, callRaw, view } from "./lib.mjs";
const ID = process.argv.find((a) => /^\d+$/.test(a)) ?? "2";
const LIST_ONLY = process.argv.includes("--list-only");
const PRICE = 300_000_000_000_000_000_000_000n; // 0.3 NEAR
const owner = (await view("nft_token", { token_id: ID })).owner_id;
const seller = account(owner);
const buyer = account(owner === "pusaka-buyer.testnet" ? "pusaka-w-mvzhtaw8.testnet" : "pusaka-buyer.testnet");
const bal = async (a) => BigInt((await a.getState()).balance.available);
const s0 = await bal(seller);
console.log("owner before", (await view("nft_token", { token_id: ID })).owner_id);
const st = await callRaw(seller, "deposit_storage", {}, { deposit: 10_000_000_000_000_000_000_000n, receiver: MARKET }).catch((e) => console.log("deposit_storage:", String(e).slice(0, 200)));
console.log("storage tx", st?.transaction?.hash);
const ap = await callRaw(seller, "nft_approve", { token_id: ID, account_id: MARKET, msg: JSON.stringify({ price: PRICE.toString() }) }, { deposit: 10_000_000_000_000_000_000_000n, tgas: 150 });
console.log("approve tx", ap.transaction.hash, JSON.stringify(ap.status).slice(0, 120));
try { await call(seller, "withdraw", { token_id: ID, utxos: [], to_script_hex: "0014" + "11".repeat(20), amount_sat: "1", fee_sat: "1" }); console.log("BUG: withdraw allowed"); }
catch (e) { console.log("withdraw while approved refused:", String(e).includes("Approved")); }
if (LIST_ONLY) { console.log(`#${ID} is on sale through ${MARKET}`); process.exit(0); }
const by = await callRaw(buyer, "buy", { nft_contract_id: CONTRACT, token_id: ID }, { deposit: PRICE, tgas: 250, receiver: MARKET });
console.log("buy tx", by.transaction.hash, JSON.stringify(by.status).slice(0, 120));
await new Promise((r) => setTimeout(r, 4000));
const t = await view("token_info", { token_id: ID });
console.log("owner after", t.token.owner_id, "approvals", JSON.stringify(t.token.approved_account_ids));
console.log("seller balance change NEAR", Number(await bal(seller) - s0) / 1e24);
