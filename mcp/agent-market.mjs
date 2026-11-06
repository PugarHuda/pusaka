// Three AI-agent wallets run the loan market over MCP, live on testnet, each through its own Pusaka MCP server:
// a lender agent posts a standing offer and the holder's agent takes it; a third agent offers cheaper, longer terms and
// the holder refinances into them (the old lender is paid in full); the holder pays part, the new lender proposes more
// time, the holder takes it, then repays in full. Guards are tried along the way.
//   node agent-market.mjs <lender> <holder> <refinancer> <token_id>     (keys from ../.keys)
// The token must be the holder's with >= 10,000 verified sats; if it is listed, it is unlisted first and relisted after.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "node:fs";
import path from "node:path";

const [lenderId, holderId, refiId, token_id] = process.argv.slice(2);
if (!token_id) throw new Error("usage: node agent-market.mjs <lender> <holder> <refinancer> <token_id>");
const agent = async (id) => {
  const { private_key } = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "..", ".keys", `${id}.json`), "utf8"));
  const c = new Client({ name: `agent-${id}`, version: "1.0.0" });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(import.meta.dirname, "server.mjs")],
    env: { ...process.env, PUSAKA_ACCOUNT_ID: id, PUSAKA_PRIVATE_KEY: private_key, PUSAKA_MAX_SPEND_NEAR: "1", PUSAKA_ALLOW_OUTFLOWS: "" } }));
  return async (name, args = {}, expectError) => {
    const r = await c.callTool({ name, arguments: args });
    const text = r.content[0].text;
    if (!!r.isError !== !!expectError || (expectError && !expectError.test(text))) throw new Error(`${id} ${name}: ${text}`);
    console.log(`${id.padEnd(26)} ${name} ${JSON.stringify(args)}\n  ${text.replace(/\s+/g, " ").slice(0, 260)}`);
    return r.isError ? null : JSON.parse(text);
  };
};
const [lender, holder, refi] = await Promise.all([lenderId, holderId, refiId].map(agent));

const listed = (await holder("pusaka_inspect", { token_id })).listing;
if (listed) await holder("pusaka_cancel_listing", { token_id });
const { offer_id } = await lender("pusaka_offer_loan", { min_verified_sats: 10000, principal_near: 0.1, repay_near: 0.102, days: 1 });
await holder("pusaka_loan_offers", { token_id });
await refi("pusaka_accept_loan_offer", { token_id, offer_id }, /owner|Owner/); // only the holder can take it
await holder("pusaka_accept_loan_offer", { token_id, offer_id });
const better = await refi("pusaka_offer_loan", { token_id, principal_near: 0.1, repay_near: 0.1005, days: 2, max_ltv: 0.5 });
await holder("pusaka_accept_loan_offer", { token_id, offer_id: better.offer_id }, /short of the 0.102 NEAR owed/); // 0.002 short
await holder("pusaka_accept_loan_offer", { token_id, offer_id: better.offer_id, max_topup_near: 0.002 });
await holder("pusaka_repay_partial", { token_id, near: 0.05 });
await refi("pusaka_propose_extension", { token_id, days: 1, fee_near: 0.001 });
await holder("pusaka_accept_extension", { token_id });
await holder("pusaka_repay_loan", { token_id });
if (listed) await holder("pusaka_list", { token_id, price_near: Number(listed.price_now_near) });
console.log("agent market ok");
process.exit(0);
