// Remote MCP endpoint (Streamable HTTP, stateless): any MCP client can connect by URL and use
// the read-only Pusaka tools (overview, inspect). Trading tools need the local server and the
// agent's own key: this endpoint never holds a key.
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "../mcp/tools.mjs";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "POST JSON-RPC to this endpoint" }, id: null });
  }
  const server = createServer({ readOnly: true });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}
