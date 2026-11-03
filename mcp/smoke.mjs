// Smoke test: start the MCP server over stdio like an agent host would, call its tools
// against the live testnet contract.   node smoke.mjs <account.testnet>   (key from ../.keys)
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "node:fs";
import path from "node:path";

const id = process.argv[2] ?? "pusaka-buyer.testnet";
const { private_key } = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "..", ".keys", `${id}.json`), "utf8"));
const client = new Client({ name: "pusaka-smoke", version: "1.0.0" });
await client.connect(new StdioClientTransport({
  command: process.execPath,
  args: [path.join(import.meta.dirname, "server.mjs")],
  env: { ...process.env, PUSAKA_ACCOUNT_ID: id, PUSAKA_PRIVATE_KEY: private_key, PUSAKA_MAX_SPEND_NEAR: "2" },
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
// Guard: #3 asks for a loan with no verified BTC behind it, so an agent must refuse.
const r = await show("pusaka_fund_loan", { token_id: "3", max_ltv: 0.5 });
if (!r.isError) throw new Error("expected the LTV guard to refuse");
// Guard: spend cap.
const cap = await show("pusaka_buy", { token_id: "999", max_price_near: 100 });
if (!cap.isError) throw new Error("expected an error for a missing listing");
await client.close();
console.log("\nsmoke ok");
