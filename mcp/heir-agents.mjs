// Inheritance watched by agents, over MCP (tools pusaka_portfolio, pusaka_inspect, pusaka_claim_inheritance).
//   node mcp/heir-agents.mjs holder <account> [--warn-hours=48]   the holder's agent
//   node mcp/heir-agents.mjs heir <account> [--claim]              the heir's agent
// The holder's agent says how long each of its Pusakas has before the heir can claim it, and warns inside the window.
// It never checks in on the holder's behalf: a will an agent keeps alive forever would never pass on, so the check-in
// (pusaka_still_here, gas-free) stays the person's own act. The heir's agent watches every Pusaka naming it and, with
// --claim, claims the ones whose holder has gone silent: the heir doesn't have to remember a date, and nobody else can.
// Keys: .keys/<account>.json, used only by the heir's claim. PUSAKA_CONTRACT picks the deployment (default: main).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "node:fs";
import path from "node:path";

const [role, who] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!["holder", "heir"].includes(role) || !who) throw new Error("usage: node mcp/heir-agents.mjs holder|heir <account> [--warn-hours=48] [--claim]");
const warnMs = Number(process.argv.find((a) => a.startsWith("--warn-hours="))?.split("=")[1] ?? 48) * 3_600_000;
const claim = process.argv.includes("--claim");
const keyFile = path.join(import.meta.dirname, "..", ".keys", `${who}.json`);
const key = role === "heir" && claim && fs.existsSync(keyFile) ? JSON.parse(fs.readFileSync(keyFile, "utf8")).private_key : "";

const c = new Client({ name: `pusaka-${role}-agent`, version: "1.0.0" });
await c.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(import.meta.dirname, "server.mjs")],
  env: { ...process.env, PUSAKA_ACCOUNT_ID: key ? who : "", PUSAKA_PRIVATE_KEY: key, PUSAKA_CONFIRM: "off" } }));
const call = async (name, args = {}) => {
  const r = await c.callTool({ name, arguments: args });
  if (r.isError) throw new Error(`${name}: ${r.content[0].text}`);
  return JSON.parse(r.content[0].text);
};
const left = (ms) => ms <= 0 ? "now" : ms < 3_600_000 ? `${Math.round(ms / 60_000)} min` : ms < 172_800_000 ? `${(ms / 3_600_000).toFixed(1)} h` : `${(ms / 86_400_000).toFixed(1)} days`;

const p = await call("pusaka_portfolio", { account_id: who });
if (role === "holder") {
  const ids = (p.pusaka ?? []).map((x) => String(x.token_id ?? x.id ?? x));
  let named = 0;
  for (const id of ids) {
    const t = await call("pusaka_inspect", { token_id: id });
    if (!t.heir) continue;
    named++;
    const ms = Number(t.heir.claimable_from_ms) - Date.now();
    const verdict = ms <= 0 ? `CLAIMABLE NOW by ${t.heir.heir}: check in today if you're still here (pusaka_still_here, gas-free)`
      : ms <= warnMs ? `check in soon: ${t.heir.heir} can claim it in ${left(ms)}` : `fine: ${t.heir.heir} can claim it in ${left(ms)}`;
    console.log(`#${id}: ${verdict}`);
  }
  console.log(`${who}: ${ids.length} Pusaka(s) held, ${named} with an heir. (This agent warns; it never checks in for you.)`);
} else {
  const named = p.heir_of ?? [];
  if (!named.length) console.log(`${who} is nobody's heir.`);
  for (const h of named) {
    const ms = Date.parse(h.claimable_from) - Date.now();
    if (ms > 0) { console.log(`#${h.token_id}: its holder can still check in; claimable in ${left(ms)}`); continue; }
    if (!claim) { console.log(`#${h.token_id}: claimable now (run with --claim to claim it)`); continue; }
    const r = await call("pusaka_claim_inheritance", { token_id: String(h.token_id) });
    console.log(`#${h.token_id}: claimed by ${who}'s agent: ${JSON.stringify(r).slice(0, 240)}`);
  }
}
await c.close();
