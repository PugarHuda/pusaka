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
await client.close();
