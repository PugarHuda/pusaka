// Two agents pass a Pusaka by gift link over MCP, live: one makes the link, the other claims it with no gas of its own.
//   node gift-agents.mjs <giver> <receiver> <token_id>     (keys from ../.keys; the link stays in memory, never printed)
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "node:fs";
import path from "node:path";

const [giverId, receiverId, token_id] = process.argv.slice(2);
if (!token_id) throw new Error("usage: node gift-agents.mjs <giver> <receiver> <token_id>");
const agent = async (id) => {
  const { private_key } = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "..", ".keys", `${id}.json`), "utf8"));
  const c = new Client({ name: `agent-${id}`, version: "1.0.0" });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(import.meta.dirname, "server.mjs")],
    env: { ...process.env, PUSAKA_ACCOUNT_ID: id, PUSAKA_PRIVATE_KEY: private_key, PUSAKA_MAX_SPEND_NEAR: "1", PUSAKA_ALLOW_OUTFLOWS: "1", PUSAKA_ALLOWED_RECIPIENTS: "" } }));
  return async (name, args) => {
    const r = await c.callTool({ name, arguments: args });
    if (r.isError) throw new Error(`${id} ${name}: ${r.content[0].text}`);
    return JSON.parse(r.content[0].text);
  };
};
const [giver, receiver] = await Promise.all([giverId, receiverId].map(agent));
const { link } = await giver("pusaka_gift_link", { token_id });
console.log(`${giverId}: pusaka_gift_link → a link for Pusaka #${token_id} (kept in memory)`);
const c = await receiver("pusaka_claim_gift", { link });
console.log(`${receiverId}: pusaka_claim_gift → ${JSON.stringify(c)}`);
process.exit(0);
