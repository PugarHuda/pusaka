// Live: list Pusaka #2 on Mintbase's testnet market, buy it there, check BTC control moved.
import { account, call, callRaw, view } from "./lib.mjs";
const MARKET = "market-v2-beta.mintspace2.testnet";
const PRICE = 200_000_000_000_000_000_000_000n; // 0.2 NEAR
const seller = account("pusaka-w-mvzhtaw8.testnet"), buyer = account("pusaka-buyer.testnet");
const bal = async (a) => BigInt((await a.getState()).balance.available);
const s0 = await bal(seller);
console.log("owner before", (await view("nft_token", { token_id: "2" })).owner_id);
const st = await callRaw(seller, "deposit_storage", {}, { deposit: 10_000_000_000_000_000_000_000n, receiver: MARKET }).catch((e) => console.log("deposit_storage:", String(e).slice(0, 200)));
console.log("storage tx", st?.transaction?.hash);
const ap = await callRaw(seller, "nft_approve", { token_id: "2", account_id: MARKET, msg: JSON.stringify({ price: PRICE.toString() }) }, { deposit: 10_000_000_000_000_000_000_000n, tgas: 150 });
console.log("approve tx", ap.transaction.hash, JSON.stringify(ap.status).slice(0, 120));
try { await call(seller, "withdraw", { token_id: "2", utxos: [], to_script_hex: "0014" + "11".repeat(20), amount_sat: "1", fee_sat: "1" }); console.log("BUG: withdraw allowed"); }
catch (e) { console.log("withdraw while approved refused:", String(e).includes("Approved")); }
const by = await callRaw(buyer, "buy", { nft_contract_id: "pusaka-btc.testnet", token_id: "2" }, { deposit: PRICE, tgas: 250, receiver: MARKET });
console.log("buy tx", by.transaction.hash, JSON.stringify(by.status).slice(0, 120));
await new Promise((r) => setTimeout(r, 4000));
const t = await view("token_info", { token_id: "2" });
console.log("owner after", t.token.owner_id, "approvals", JSON.stringify(t.token.approved_account_ids));
console.log("seller balance change NEAR", Number(await bal(seller) - s0) / 1e24);
