// Live: a holder gives an AI agent an on-chain daily budget from a Pusaka v2's own account; the contract, not the
// agent's software, enforces it (testnet, pusaka-v2.testnet).
//   node v2-budget-agent.mjs <holder.testnet> <token_id> <agent.testnet> <shop.testnet> <stranger.testnet>   (keys from ../.keys)
// The agent pays the listed shop within budget; over budget, to an unlisted account, and a stranger posing as the
// agent are refused on-chain; then the holder revokes the budget and the agent is refused again.
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "node:fs";
import path from "node:path";

process.env.PUSAKA_CONTRACT ??= "pusaka-v2.testnet";
const [holder, token_id, agentId, shop, stranger] = process.argv.slice(2);
const keys = path.join(import.meta.dirname, "..", ".keys");
const key = (id) => JSON.parse(fs.readFileSync(path.join(keys, `${id}.json`), "utf8")).private_key;
const mcp = async (id, env = {}) => {
  const c = new Client({ name: "pusaka-budget-agent", version: "1.0.0" });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(import.meta.dirname, "server.mjs")],
    env: { ...process.env, PUSAKA_ACCOUNT_ID: id, PUSAKA_PRIVATE_KEY: key(id), PUSAKA_MAX_SPEND_NEAR: "0.1", PUSAKA_CONFIRM: "off", ...env } }));
  return c;
};
const run = async (c, name, args) => {
  const r = await c.callTool({ name, arguments: args });
  const text = r.content[0].text;
  console.log(`▶ ${name}${r.isError ? " (refused)" : ""}: ${text.slice(0, 400)}`);
  return { ...r, text, json: r.isError ? null : JSON.parse(text) };
};

const { account, callRaw, view, exists } = await import("../scripts/lib.mjs");
const V2 = process.env.PUSAKA_CONTRACT;
// the NFT's own account, created once, topped up each run
const acct = await view("account_of", { token_id }, V2);
if (!(await exists(acct))) {
  await callRaw(account(holder), "open_account", { token_id }, { deposit: 10n ** 22n, receiver: V2 });
}
await account(holder).transfer({ receiverId: acct, amount: 5n * 10n ** 22n });

const h = await mcp(holder, { PUSAKA_ALLOW_OUTFLOWS: "1", PUSAKA_ALLOWED_RECIPIENTS: `${agentId},${shop}` });
assert.ok(!(await run(h, "pusaka_set_agent", { token_id, agent: agentId, daily_near: 0.02, only_to: [shop] })).isError);

const a = await mcp(agentId, { PUSAKA_ALLOW_OUTFLOWS: "1" }); // no local allowlist: the contract is what refuses
const paid = await run(a, "pusaka_agent_send", { token_id, to: shop, near: 0.01 });
assert.ok(!paid.isError);
assert.match((await run(a, "pusaka_agent_send", { token_id, to: shop, near: 0.02 })).text, /AgentBudget/);
assert.match((await run(a, "pusaka_agent_send", { token_id, to: stranger, near: 0.001 })).text, /AgentReceiver|holder's list|listed/);
const s = await mcp(stranger, { PUSAKA_ALLOW_OUTFLOWS: "1" });
assert.match((await run(s, "pusaka_agent_send", { token_id, to: shop, near: 0.001 })).text, /NotAgent|agent the holder named/);
await s.close();

assert.ok(!(await run(h, "pusaka_set_agent", { token_id, agent: agentId, daily_near: 0 })).isError);
assert.match((await run(a, "pusaka_agent_send", { token_id, to: shop, near: 0.001 })).text, /NoAgent|no agent budget/);
await run(a, "pusaka_token_account", { token_id });
await Promise.all([a.close(), h.close()]);
console.log(`\nOK: the agent spent only within the holder's on-chain budget: ${paid.json.explorer}`);
