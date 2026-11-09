// Live: an agent sells a Pusaka's BTC for USDC on NEAR through NEAR Intents, over MCP (testnet, Tidepool).
//   node swap-agent.mjs <holder.testnet> <token_id> <testnet4_funding_txid> [sats=20000]   (key from ../.keys)
// First with outflows off (refused before anything is signed), then on: pusaka_swap_to_usdc, then
// pusaka_swap_status until it settles.
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "node:fs";
import path from "node:path";

const [id, token_id, funding_txid, sats = "20000"] = process.argv.slice(2);
const { private_key } = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "..", ".keys", `${id}.json`), "utf8"));
const agent = async (outflows) => {
  const c = new Client({ name: "pusaka-swap-agent", version: "1.0.0" });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(import.meta.dirname, "server.mjs")],
    env: { ...process.env, PUSAKA_ACCOUNT_ID: id, PUSAKA_PRIVATE_KEY: private_key, PUSAKA_MAX_SPEND_NEAR: "0.1", PUSAKA_ALLOW_OUTFLOWS: outflows, PUSAKA_CONFIRM: "off" } }));
  return c;
};
const run = async (c, name, args) => {
  const r = await c.callTool({ name, arguments: args });
  const text = r.content[0].text;
  console.log(`▶ ${name}${r.isError ? " (error)" : ""}: ${text.slice(0, 700)}`);
  return { ...r, json: r.isError ? null : JSON.parse(text) };
};

const off = await agent("");
const refused = await run(off, "pusaka_swap_to_usdc", { token_id, funding_txid, sats: Number(sats) });
assert.ok(refused.isError && /Outflows are off/.test(refused.content[0].text));
await off.close();

const on = await agent("1");
const sent = await run(on, "pusaka_swap_to_usdc", { token_id, funding_txid, sats: Number(sats) });
assert.ok(!sent.isError);
let st;
for (let i = 0; i < 100; i++) {
  st = (await run(on, "pusaka_swap_status", { deposit_address: sent.json.deposit_address })).json;
  if (["SUCCESS", "REFUNDED", "FAILED"].includes(st?.status)) break;
  await new Promise((r) => setTimeout(r, 20_000));
}
await on.close();
assert.equal(st.status, "SUCCESS");
