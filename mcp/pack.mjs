// Builds mcp/dist: the MCP server as a standalone npm package (`npx pusaka-mcp`). The workspace package
// @pusaka/shared isn't on npm, so its modules are copied in and the imports rewritten to relative paths.
//   node mcp/pack.mjs && cd mcp/dist && npm pack     (npm publish from mcp/dist)
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(import.meta.dirname, "..");
const DIST = path.join(import.meta.dirname, "dist");
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(path.join(DIST, "shared"), { recursive: true });
fs.mkdirSync(path.join(DIST, "deployments"), { recursive: true });

const sharedPkg = JSON.parse(fs.readFileSync(path.join(ROOT, "shared", "package.json"), "utf8"));
const rewrite = (src) => src.replace(/(["'])@pusaka\/shared(\/[a-z0-9]+)?\1/g, (_, q, sub) =>
  `${q}./shared/${sub ? sharedPkg.exports["." + sub].slice(2) : sharedPkg.exports["."].slice(2)}${q}`);
for (const f of ["server.mjs", "tools.mjs"]) fs.writeFileSync(path.join(DIST, f), rewrite(fs.readFileSync(path.join(import.meta.dirname, f), "utf8")));
for (const f of fs.readdirSync(path.join(ROOT, "shared")).filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs") || f === "ckd-vectors.json"))
  fs.copyFileSync(path.join(ROOT, "shared", f), path.join(DIST, "shared", f));
for (const f of fs.readdirSync(path.join(ROOT, "deployments")).filter((f) => f.endsWith(".json")))
  fs.copyFileSync(path.join(ROOT, "deployments", f), path.join(DIST, "deployments", f));
const left = [...fs.readdirSync(DIST), ...fs.readdirSync(path.join(DIST, "shared")).map((f) => "shared/" + f)]
  .filter((f) => f.endsWith(".mjs") && fs.readFileSync(path.join(DIST, f), "utf8").includes("@pusaka/"));
if (left.length) throw new Error(`still importing @pusaka/*: ${left}`);

const mcpPkg = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "package.json"), "utf8"));
const { "@pusaka/shared": _, ...deps } = { ...sharedPkg.dependencies, ...mcpPkg.dependencies };
const version = process.env.PUSAKA_MCP_VERSION ?? "1.0.0";
fs.writeFileSync(path.join(DIST, "package.json"), JSON.stringify({
  name: "pusaka-mcp",
  version,
  description: "MCP server for Pusaka: NFTs on NEAR that each control a native Bitcoin address (Chain Signatures), with deposits proven by NEAR's Bitcoin light client. Buy, lend, borrow, inherit, with spend caps.",
  mcpName: "io.github.PugarHuda/pusaka",
  type: "module",
  bin: { "pusaka-mcp": "server.mjs" },
  files: ["server.mjs", "tools.mjs", "shared", "deployments", "README.md", "LICENSE"],
  engines: { node: ">=20" },
  keywords: ["mcp", "near", "bitcoin", "chain-signatures", "nft", "ai-agent"],
  repository: { type: "git", url: "git+https://github.com/PugarHuda/pusaka.git", directory: "mcp" },
  homepage: "https://pusaka-two.vercel.app",
  license: "MIT",
  dependencies: deps,
}, null, 2) + "\n");
fs.copyFileSync(path.join(ROOT, "LICENSE"), path.join(DIST, "LICENSE"));
fs.writeFileSync(path.join(DIST, "README.md"), `# pusaka-mcp

MCP server for [Pusaka](https://pusaka-two.vercel.app): NEP-171 NFTs on NEAR, each controlling a native Bitcoin
address through NEAR Chain Signatures. Deposits are proven by NEAR's Bitcoin light client, so an agent can see
exactly how much Bitcoin a Pusaka holds before it buys or lends against it.

\`\`\`json
{ "mcpServers": { "pusaka": { "command": "npx", "args": ["-y", "pusaka-mcp"],
  "env": { "PUSAKA_ACCOUNT_ID": "agent.testnet", "PUSAKA_PRIVATE_KEY": "ed25519:…", "PUSAKA_MAX_SPEND_NEAR": "2" } } } }
\`\`\`

Without a key the read tools work (\`pusaka_overview\`, \`pusaka_inspect\`, \`pusaka_loan_offers\`, …). With one,
every spend is capped by \`PUSAKA_MAX_SPEND_NEAR\` (default 5), purchases by a max price, loans by a max LTV; moving a
Pusaka or its assets out needs \`PUSAKA_ALLOW_OUTFLOWS=1\` (ideally with \`PUSAKA_ALLOWED_RECIPIENTS\`).
Network: NEAR testnet (contract \`pusaka-btc.testnet\`). Source: https://github.com/PugarHuda/pusaka/tree/main/mcp
`);
fs.writeFileSync(path.join(DIST, "server.json"), JSON.stringify({
  $schema: "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
  name: "io.github.PugarHuda/pusaka",
  description: "Pusaka on NEAR: NFTs that each control a native Bitcoin address; buy, lend, borrow and inherit with caps.",
  repository: { url: "https://github.com/PugarHuda/pusaka", source: "github", subfolder: "mcp" },
  version,
  packages: [{
    registryType: "npm", identifier: "pusaka-mcp", version, transport: { type: "stdio" },
    environmentVariables: [
      { name: "PUSAKA_ACCOUNT_ID", description: "NEAR account the agent acts as (optional: read-only without it)", isRequired: false },
      { name: "PUSAKA_PRIVATE_KEY", description: "Its ed25519 key", isRequired: false, isSecret: true },
      { name: "PUSAKA_MAX_SPEND_NEAR", description: "Spend cap per call in NEAR (default 5)", isRequired: false },
    ],
  }],
  remotes: [{ type: "streamable-http", url: "https://pusaka-two.vercel.app/api/mcp" }],
}, null, 2) + "\n");
console.log(`mcp/dist ready: pusaka-mcp@${version}, ${Object.keys(deps).length} dependencies`);
