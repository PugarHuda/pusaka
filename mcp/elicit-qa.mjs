// Human in the loop over MCP, live: a host that supports elicitation is asked before the agent spends; a "no"
// stops the transaction before anything is signed, a "yes" lets it through.
//   node elicit-qa.mjs <account>      (key from ../.keys; posts a 0.01 NEAR loan offer and cancels it)
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs";
import path from "node:path";

const id = process.argv[2] ?? "pusaka-seller.testnet";
const { private_key } = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "..", ".keys", `${id}.json`), "utf8"));
const c = new Client({ name: "elicit-qa", version: "1.0.0" }, { capabilities: { elicitation: {} } });
let answer = "decline";
const asked = [];
c.setRequestHandler(ElicitRequestSchema, async (req) => {
  asked.push(req.params.message);
  console.log(`  host shows the person: "${req.params.message.split("\n")[0]}" → ${answer}`);
  return answer === "approve" ? { action: "accept", content: { approve: true } } : { action: "decline" };
});
await c.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(import.meta.dirname, "server.mjs")],
  env: { ...process.env, PUSAKA_ACCOUNT_ID: id, PUSAKA_PRIVATE_KEY: private_key, PUSAKA_MAX_SPEND_NEAR: "0.05" } }));
const offer = { min_verified_sats: 10000, principal_near: 0.01, repay_near: 0.0101, days: 1 };
const before = (await c.callTool({ name: "pusaka_loan_offers", arguments: {} })).content[0].text;

console.log("1. the person declines");
const r1 = await c.callTool({ name: "pusaka_offer_loan", arguments: offer });
console.log(`  agent gets: ${r1.content[0].text}`);
if (!r1.isError || (await c.callTool({ name: "pusaka_loan_offers", arguments: {} })).content[0].text !== before) throw new Error("a declined spend went through");

console.log("2. the person approves");
answer = "approve";
const r2raw = await c.callTool({ name: "pusaka_offer_loan", arguments: offer });
if (r2raw.isError) throw new Error(r2raw.content[0].text);
const r2 = JSON.parse(r2raw.content[0].text);
console.log(`  offer ${r2.offer_id} posted`);
const r3 = await c.callTool({ name: "pusaka_cancel_loan_offer", arguments: { offer_id: r2.offer_id } });
console.log(`3. cancelled (no spend, so no question): ${r3.content[0].text.replace(/\s+/g, " ").slice(0, 80)}`);
const { tools } = await c.listTools();
const ann = (n) => JSON.stringify(tools.find((t) => t.name === n).annotations);
console.log(`annotations: pusaka_audit ${ann("pusaka_audit")}, pusaka_withdraw_btc ${ann("pusaka_withdraw_btc")}`);
if (asked.length !== 2) throw new Error(`expected 2 questions, got ${asked.length}`);
process.exit(0);
