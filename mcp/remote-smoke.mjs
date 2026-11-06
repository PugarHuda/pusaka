// Connects to the deployed remote MCP endpoint over Streamable HTTP and calls its read-only tools.
//   node remote-smoke.mjs [https://pusaka-two.vercel.app/api/mcp]
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = new URL(process.argv[2] ?? "https://pusaka-two.vercel.app/api/mcp");
const client = new Client({ name: "pusaka-remote-smoke", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(url));
const { tools } = await client.listTools();
console.log("remote tools:", tools.map((t) => t.name).join(", "));
const r = await client.callTool({ name: "pusaka_inspect", arguments: { token_id: "4" } });
const d = JSON.parse(r.content[0].text);
console.log(`Pusaka #4: owner ${d.owner}, ${d.btc.verified_sats} sats verified, ~$${d.usd?.btc_inside?.toFixed(2)}`);
if (!["pusaka_loan_offers", "pusaka_audit", "pusaka_contract_trust", "pusaka_credit_record", "pusaka_deals", "pusaka_portfolio"].every((n) => tools.some((t) => t.name === n)) || tools.some((t) => t.name === "pusaka_offer_loan")) throw new Error("remote must list loan offers and nothing that signs");
const prompts = (await client.listPrompts()).prompts.map((p) => p.name);
const contract = JSON.parse((await client.readResource({ uri: "pusaka://contract" })).contents[0].text);
console.log(`prompts: ${prompts.join(", ")}; pusaka://contract: ${contract.keys.verdict}`);
if (!prompts.includes("due_diligence")) throw new Error("remote must offer the due_diligence prompt");
const o = JSON.parse((await client.callTool({ name: "pusaka_loan_offers", arguments: {} })).content[0].text);
console.log(`open loan offers: ${o.offers.length}`);
await client.close();
