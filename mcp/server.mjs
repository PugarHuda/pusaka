#!/usr/bin/env node
// Pusaka MCP server over stdio, for an agent that holds its own NEAR key. Tools: ./tools.mjs.
//   PUSAKA_ACCOUNT_ID=agent.testnet PUSAKA_PRIVATE_KEY=ed25519:… PUSAKA_MAX_SPEND_NEAR=5 node server.mjs
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./tools.mjs";

await createServer().connect(new StdioServerTransport());
