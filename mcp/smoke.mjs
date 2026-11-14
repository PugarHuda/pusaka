// Smoke test: start the MCP server over stdio like an agent host would, call its tools
// against the live testnet contract.   node smoke.mjs [account.testnet]   (key from ../.keys)
// Without a key file (a fresh clone) it uses a throwaway key: every guard below refuses before signing.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "node:fs";
import path from "node:path";
import { KeyPair } from "near-api-js";
import { CONTRACT } from "@pusaka/shared";
import { viewFinal } from "@pusaka/shared/audit";

const id = process.argv[2] ?? "pusaka-buyer.testnet";
const keyFile = path.join(import.meta.dirname, "..", ".keys", `${id}.json`);
const private_key = fs.existsSync(keyFile) ? JSON.parse(fs.readFileSync(keyFile, "utf8")).private_key : KeyPair.fromRandom("ed25519").toString();
const client = new Client({ name: "pusaka-smoke", version: "1.0.0" });
await client.connect(new StdioClientTransport({
  command: process.execPath,
  args: [path.join(import.meta.dirname, "server.mjs")],
  env: { ...process.env, PUSAKA_ACCOUNT_ID: id, PUSAKA_PRIVATE_KEY: private_key, PUSAKA_MAX_SPEND_NEAR: "2", PUSAKA_ALLOW_OUTFLOWS: "" },
}));

const show = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content[0].text;
  console.log(`\n▶ ${name} ${JSON.stringify(args)}${r.isError ? "  (error)" : ""}\n${text.length > 900 ? text.slice(0, 900) + "…" : text}`);
  return r;
};

const { tools } = await client.listTools();
console.log("tools:", tools.map((t) => t.name).join(", "));
await show("pusaka_overview");
await show("pusaka_inspect", { token_id: "1" });
// either refusal stops the agent before it signs: LTV above the cap, or no second price source to check it against
const LTV_REFUSED = /Loan-to-value .* is above|could not be cross-checked/;
const refused = (r, why) => { if (!r.isError || !why.test(r.content[0].text)) throw new Error(`expected a refusal matching ${why}`); };
// The live stock changes as people trade: find a Pusaka asking for a loan and one for sale above 0.1 NEAR now.
const rpcView = (method, args) => viewFinal(method, args, CONTRACT); // with the shared RPC failover
const infos = [];
for (const t of await rpcView("nft_tokens", { from_index: "0", limit: 100 })) infos.push(await rpcView("token_info", { token_id: t.token_id }).catch(() => null));
const asking = infos.find((i) => i?.loan && !i.loan.lender && Number(i.verified_sats) > 0), forSale = infos.find((i) => i?.listing && BigInt(i.listing.price) > 10n ** 23n);
// Guard: an open loan request; an agent capped at 0.1% LTV must refuse.
if (asking) refused(await show("pusaka_fund_loan", { token_id: asking.token.token_id, max_ltv: 0.001 }), LTV_REFUSED); else console.log("(no open loan request right now: LTV guard skipped)");
// Guard: price cap; an agent capped at 0.1 NEAR must refuse a listing above it.
if (forSale) refused(await show("pusaka_buy", { token_id: forSale.token.token_id, max_price_near: 0.1 }), /above your max/); else console.log("(nothing for sale above 0.1 NEAR right now: price guard skipped)");
// Guard: outflows (give, withdraw_*) are off unless the operator opts in.
refused(await show("pusaka_give", { token_id: "4", to: "pusaka-seller.testnet" }), /Outflows are off/);
await show("pusaka_loan_offers");
// pUSD pool (lend/): the read view, and a liquidation the tool refuses before signing (no such loan / healthy)
await show("pusaka_lend_pool", { token_id: "11", contract: "pusaka-btc.testnet" });
refused(await show("pusaka_lend_liquidate", { loan_id: "999999" }), /No open loan/);
// Guard: a token offer above the LTV cap is refused before anything is escrowed.
refused(await show("pusaka_offer_loan", { token_id: "1", principal_near: 1, repay_near: 1.01, days: 1, max_ltv: 0.0001 }), LTV_REFUSED);
if (fs.existsSync(keyFile)) {
  // Live: escrow a 0.01 NEAR standing offer for any Pusaka with >= 10,000 verified sats, see it listed, take it back.
  const r = await show("pusaka_offer_loan", { min_verified_sats: 10000, principal_near: 0.01, repay_near: 0.0101, days: 1 });
  if (r.isError) throw new Error("offer_loan failed");
  const { offer_id } = JSON.parse(r.content[0].text);
  if (!JSON.parse((await show("pusaka_loan_offers")).content[0].text).offers.some((o) => o.offer_id === offer_id)) throw new Error("offer not listed");
  if ((await show("pusaka_cancel_loan_offer", { offer_id })).isError) throw new Error("cancel failed");
}
await client.close();
console.log("\nsmoke ok");
