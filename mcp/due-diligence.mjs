// An agent's due diligence over MCP, live and read-only: trust the contract? are the reserves real? who is the borrower?
//   node due-diligence.mjs [token_id=1]
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";

const token_id = process.argv[2] ?? "1";
const c = new Client({ name: "due-diligence", version: "1.0.0" });
await c.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(import.meta.dirname, "server.mjs")], env: { ...process.env, PUSAKA_ACCOUNT_ID: "", PUSAKA_PRIVATE_KEY: "" } }));
const call = async (name, args = {}) => {
  const r = await c.callTool({ name, arguments: args });
  if (r.isError) throw new Error(`${name}: ${r.content[0].text}`);
  return JSON.parse(r.content[0].text);
};
const t = await call("pusaka_contract_trust");
console.log(`contract_trust: ${t.keys.verdict}; code ${t.code_sha256.slice(0, 12)}…; upgrades via ${t.upgrades.final ? "none (final)" : `${t.upgrades.governance.kind ?? t.upgrades.governance.admin}, threshold ${JSON.stringify(t.upgrades.governance.threshold)}, timelock ${t.upgrades.timelock_minutes} min`}`);
const a = await call("pusaka_audit", { token_id });
console.log(`audit #${token_id}: ${a.verdict} (${a.verified_sats} sats; ${a.checks.filter((x) => x.pass).length}/${a.checks.length} checks; ${a.deposits.length} deposits on Bitcoin)`);
const h = await call("pusaka_history", { token_id });
console.log(`history #${token_id}: holders ${h.holders.join(" → ")}; ${h.timeline.length} events; sales ${JSON.stringify(h.sales_near)}`);
const w = await call("pusaka_loan_watch");
console.log(`loan_watch: ${w.funded_loans.length} funded loan(s)`, w.funded_loans.map((l) => `#${l.token_id} ${l.hours_left} h LTV ${l.ltv_now}`).join(", "));
const borrower = w.funded_loans[0]?.borrower ?? h.owner;
const r = await call("pusaka_credit_record", { account_id: borrower });
console.log(`credit_record ${borrower}: ${r.loans_taken} taken, ${r.repaid} repaid, ${r.defaulted} defaulted, ${r.open} open`);
const { tools } = await c.listTools();
console.log(`${tools.length} tools on this server`);
process.exit(0);
