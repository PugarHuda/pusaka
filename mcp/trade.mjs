// Two agents trade through the MCP server: seller lists Pusaka #<id>, buyer buys under a price cap.
//   node trade.mjs <seller.testnet> <buyer.testnet> <token_id> <price_near>
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "node:fs";
import path from "node:path";

const [sellerId, buyerId, tokenId = "1", price = "0.3"] = process.argv.slice(2);
async function agent(id) {
  const { private_key } = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "..", ".keys", `${id}.json`), "utf8"));
  const c = new Client({ name: `agent-${id}`, version: "1.0.0" });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(import.meta.dirname, "server.mjs")],
    env: { ...process.env, PUSAKA_ACCOUNT_ID: id, PUSAKA_PRIVATE_KEY: private_key, PUSAKA_MAX_SPEND_NEAR: "1" } }));
  return async (name, args) => {
    const r = await c.callTool({ name, arguments: args });
    console.log(`${id} ▶ ${name} ${JSON.stringify(args)}\n  ${r.isError ? "ERROR " : ""}${r.content[0].text.replace(/\s+/g, " ").slice(0, 300)}`);
    if (r.isError) throw new Error(r.content[0].text);
    return JSON.parse(r.content[0].text);
  };
}
const seller = await agent(sellerId), buyer = await agent(buyerId);
await seller("pusaka_list", { token_id: tokenId, price_near: Number(price) });
const seen = await buyer("pusaka_inspect", { token_id: tokenId });
console.log(`buyer sees ${seen.btc.verified_sats} verified sats (~$${seen.usd?.btc_inside?.toFixed(2)}) for ${seen.listing.price_now_near} NEAR`);
await buyer("pusaka_buy", { token_id: tokenId, max_price_near: Number(price) + 0.05 });
console.log("new owner:", (await buyer("pusaka_inspect", { token_id: tokenId })).owner);
process.exit(0);
