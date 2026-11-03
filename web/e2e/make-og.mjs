// Renders the social card (1200x630) from the live contract's on-chain NFT images.
//   node web/e2e/make-og.mjs   -> web/public/og.png
import { chromium } from "@playwright/test";
import path from "node:path";

const rpc = async (id) => {
  const r = await fetch("https://test.rpc.fastnear.com", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "optimistic", account_id: "pusaka-btc.testnet", method_name: "nft_token", args_base64: Buffer.from(JSON.stringify({ token_id: id })).toString("base64") } }) }).then((x) => x.json());
  return JSON.parse(Buffer.from(r.result.result).toString()).metadata.media;
};
const media = await Promise.all(["1", "4", "3"].map(rpc));
const html = `<!doctype html><html><head><link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,800&display=block" rel="stylesheet">
<style>body{margin:0;width:1200px;height:630px;background:#eceef1;font-family:"Bricolage Grotesque",sans-serif;color:#14213d;display:flex;align-items:center;gap:56px;padding:0 72px;box-sizing:border-box}
h1{font-size:76px;line-height:.98;letter-spacing:-.045em;font-weight:800;margin:0 0 22px}p{font-size:27px;color:#4a5570;margin:0 0 14px;max-width:560px}.row{display:flex;gap:18px}
img{width:196px;height:196px;border-radius:50%;filter:drop-shadow(0 10px 18px rgba(20,33,61,.18))}small{font-size:22px;color:#7d6220;font-weight:500}</style></head>
<body><div><h1>NFTs that hold real Bitcoin.</h1><p>Sell the NFT and the BTC goes with it. Deposits proven on NEAR by its Bitcoin light client.</p><small>Pusaka, built on NEAR Chain Signatures</small></div>
<div class="row">${media.map((m) => `<img src="${m}">`).join("")}</div></body></html>`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html, { waitUntil: "networkidle" });
const out = path.join(import.meta.dirname, "..", "public", "og.png");
await page.screenshot({ path: out });
await browser.close();
console.log(out);
