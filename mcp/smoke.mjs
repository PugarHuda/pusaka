// Smoke test: start the MCP server over stdio like an agent host would, call its tools
// against the live testnet contract.   node smoke.mjs [account.testnet]   (key from ../.keys)
// Without a key file (a fresh clone) it uses a throwaway key: every guard below refuses before signing.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "node:fs";
import path from "node:path";
import { KeyPair } from "near-api-js";

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
// Guard: #1 asks for a loan at well under 2% LTV; an agent capped at 0.1% must refuse.
refused(await show("pusaka_fund_loan", { token_id: "1", max_ltv: 0.001 }), LTV_REFUSED);
// Guard: price cap. #4 is listed at 0.5 NEAR; an agent capped at 0.1 must refuse.
refused(await show("pusaka_buy", { token_id: "4", max_price_near: 0.1 }), /above your max/);
// Guard: outflows (give, withdraw_*) are off unless the operator opts in.
refused(await show("pusaka_give", { token_id: "4", to: "pusaka-seller.testnet" }), /Outflows are off/);
await show("pusaka_loan_offers");
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
