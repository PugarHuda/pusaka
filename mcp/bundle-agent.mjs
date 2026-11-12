// Live: an AI agent values Smart Pusaka *bundles* and buys one only when it's priced below what's inside it, over MCP.
//   node mcp/bundle-agent.mjs <agent.testnet> [max_spend_near=1]      (key from ../.keys; Pusaka v2 on testnet)
// For every Smart Pusaka for sale: its own proven Bitcoin + the Pusakas its account holds (each with its proven
// Bitcoin) + the USDC in its account, at live prices, against the asking price. It buys the best discount, if any,
// with pusaka_buy capped at that price; everything is read through the server's tools, never from our own code.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "node:fs";
import path from "node:path";

const [id, cap = "1"] = process.argv.slice(2);
if (!id) throw new Error("usage: node mcp/bundle-agent.mjs <agent.testnet> [max_spend_near]");
const { private_key } = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "..", ".keys", `${id}.json`), "utf8"));
const c = new Client({ name: "pusaka-bundle-agent", version: "1.0.0" });
await c.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(import.meta.dirname, "server.mjs")],
  env: { ...process.env, PUSAKA_CONTRACT: "pusaka-v2.testnet", PUSAKA_ACCOUNT_ID: id, PUSAKA_PRIVATE_KEY: private_key, PUSAKA_MAX_SPEND_NEAR: cap, PUSAKA_CONFIRM: "off" } }));
const tool = async (name, args = {}) => {
  const r = await c.callTool({ name, arguments: args });
  if (r.isError) throw new Error(`${name}: ${r.content[0].text}`);
  return JSON.parse(r.content[0].text);
};

const { pusaka } = await tool("pusaka_overview");
const forSale = pusaka.filter((p) => p.for_sale_near && p.owner !== id);
console.log(`${forSale.length} Smart Pusaka(s) for sale: ${forSale.map((p) => `#${p.token_id} at ${p.for_sale_near} NEAR`).join(", ") || "none"}`);
const offers = [];
for (const p of forSale) {
  const [me, acct] = await Promise.all([tool("pusaka_inspect", { token_id: p.token_id }), tool("pusaka_token_account", { token_id: p.token_id })]);
  if (!me.usd) { console.log(`#${p.token_id}: no live prices, skipped`); continue; }
  const { btc_usd, near_usd } = me.usd;
  const sats = me.btc.verified_sats + acct.inside.pusakas.reduce((a, x) => a + x.verified_sats, 0);
  const valueUsd = (sats / 1e8) * btc_usd + (acct.inside.usdc ?? 0);
  const priceUsd = p.for_sale_near * near_usd;
  console.log(`#${p.token_id}: ${me.btc.verified_sats} own sats + ${acct.inside.pusakas.map((x) => `Pusaka #${x.token_id} (${x.verified_sats} sats)`).join(" + ") || "no Pusakas"} + ${acct.inside.usdc ?? 0} USDC`
    + ` = $${valueUsd.toFixed(2)} inside; asks ${p.for_sale_near} NEAR = $${priceUsd.toFixed(2)}`);
  offers.push({ ...p, valueUsd, priceUsd, discount: 1 - priceUsd / valueUsd });
}
const best = offers.filter((o) => o.discount > 0).sort((a, b) => b.discount - a.discount)[0];
if (!best) { console.log("nothing is priced below what's inside it: no purchase"); process.exit(0); }
console.log(`best: #${best.token_id}, ${(best.discount * 100).toFixed(0)}% below its contents; buying with max ${best.for_sale_near} NEAR (spend cap ${cap})`);
const bought = await tool("pusaka_buy", { token_id: best.token_id, max_price_near: best.for_sale_near });
console.log(`bought: ${JSON.stringify(bought)}`);
const after = await tool("pusaka_token_account", { token_id: best.token_id });
console.log(`now held by ${after.holder}, with inside: ${JSON.stringify(after.inside.pusakas)} and ${after.inside.usdc} USDC`);
await c.close();
