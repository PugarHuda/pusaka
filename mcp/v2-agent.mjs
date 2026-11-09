// Live: an agent runs a Pusaka v2's own account over MCP, behind the post-quantum lock (testnet, pusaka-v2.testnet).
//   node v2-agent.mjs <holder.testnet> <token_id> <to.testnet>      (keys from ../.keys)
// Outflows off: refused before signing. Then the holder registers an ML-DSA-65 key; the agent's send is refused
// on-chain (PqLocked) until it calls pusaka_pq_unlock with the key from its environment, and then goes through.
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { base64 } from "@scure/base";
import { pqKeys } from "@pusaka/shared/pq";

process.env.PUSAKA_CONTRACT ??= "pusaka-v2.testnet";
const [id, token_id, to] = process.argv.slice(2);
const keys = path.join(import.meta.dirname, "..", ".keys");
const { private_key } = JSON.parse(fs.readFileSync(path.join(keys, `${id}.json`), "utf8"));
const pqFile = path.join(keys, `pq-${id}-${token_id}.json`);
const agent = async (env) => {
  const c = new Client({ name: "pusaka-v2-agent", version: "1.0.0" });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(import.meta.dirname, "server.mjs")],
    env: { ...process.env, PUSAKA_ACCOUNT_ID: id, PUSAKA_PRIVATE_KEY: private_key, PUSAKA_MAX_SPEND_NEAR: "0.1", PUSAKA_CONFIRM: "off", ...env } }));
  return c;
};
const run = async (c, name, args) => {
  const r = await c.callTool({ name, arguments: args });
  const text = r.content[0].text;
  console.log(`▶ ${name}${r.isError ? " (error)" : ""}: ${text.slice(0, 500)}`);
  return { ...r, text, json: r.isError ? null : JSON.parse(text) };
};
const send = { token_id, to, near: 0.001 };

const off = await agent({ PUSAKA_ALLOW_OUTFLOWS: "" });
await run(off, "pusaka_token_account", { token_id });
assert.match((await run(off, "pusaka_account_send", send)).text, /Outflows are off/);
await off.close();

// the holder (not the agent) registers the post-quantum key, once
if (!fs.existsSync(pqFile)) {
  const seed = randomBytes(32).toString("hex");
  fs.writeFileSync(pqFile, JSON.stringify({ ml_dsa65_seed_hex: seed }));
  const { account, callRaw } = await import("../scripts/lib.mjs");
  const o = await callRaw(account(id), "set_pq_key", { token_id, public_key: base64.encode(pqKeys(Buffer.from(seed, "hex")).publicKey) },
    { deposit: 3n * 10n ** 22n, tgas: 100 });
  console.log(`holder registered an ML-DSA-65 key: ${o.transaction.hash}`);
  await new Promise((r) => setTimeout(r, 120 * 1100)); // the registration block's window closes
}
const seed = JSON.parse(fs.readFileSync(pqFile, "utf8")).ml_dsa65_seed_hex;
const on = await agent({ PUSAKA_ALLOW_OUTFLOWS: "1", PUSAKA_ALLOWED_RECIPIENTS: to, PUSAKA_PQ_SEED_HEX: seed });
if ((await run(on, "pusaka_token_account", { token_id })).json.pq_lock.open) console.log("(still open from a run <2 min ago: skipping the locked check)");
else assert.match((await run(on, "pusaka_account_send", send)).text, /PqLocked/);
assert.ok(!(await run(on, "pusaka_pq_unlock", { token_id })).isError);
const ok = await run(on, "pusaka_account_send", send);
assert.ok(!ok.isError);
await run(on, "pusaka_token_account", { token_id });
await on.close();
console.log(`\nOK: the agent moved NEAR from #${token_id}'s own account only after an on-chain ML-DSA-65 unlock: ${ok.json.explorer}`);
