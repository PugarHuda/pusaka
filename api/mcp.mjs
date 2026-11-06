// Remote MCP endpoint (Streamable HTTP, stateless): any MCP client can connect by URL and use
// the read-only Pusaka tools (overview, inspect, loan_offers). Trading tools need the local server and the
// agent's own key: this endpoint never holds a key.
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "../mcp/tools.mjs";

export default async function handler(req, res) {
  // Browser MCP clients (e.g. the MCP Inspector) need CORS; nothing here is user-specific.
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type, accept, mcp-session-id, mcp-protocol-version");
  res.setHeader("access-control-expose-headers", "mcp-session-id");
  if (req.method === "OPTIONS") return res.status(204).end();
  let payload;
  // Vercel throws on a malformed JSON body, or hands it over as the raw string
  try { payload = req.body; if (typeof payload === "string") payload = JSON.parse(payload); } catch {
    return res.status(400).json({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error: the body must be JSON" }, id: null });
  }
  if (req.method !== "POST") {
    return res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "POST JSON-RPC to this endpoint" }, id: null });
  }
  const server = createServer({ readOnly: true });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, payload);
}
