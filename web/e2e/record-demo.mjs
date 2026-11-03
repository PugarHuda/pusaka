// Records a ~60 s walkthrough of the live app (no wallet needed) to media/pusaka-demo.webm.
//   node web/e2e/record-demo.mjs
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const URL = process.env.E2E_URL ?? "https://pusaka-two.vercel.app";
const out = path.join(import.meta.dirname, "..", "..", "media");
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: out, size: { width: 1280, height: 720 } } });
const page = await context.newPage();
const pause = (ms) => page.waitForTimeout(ms);
const scrollTo = async (text) => { await page.getByText(text).first().scrollIntoViewIfNeeded(); await pause(2500); };

// 1. The idea and the gallery
await page.goto(`${URL}/#/`);
await page.locator(".piece").first().waitFor({ timeout: 30_000 });
await pause(3500);
await page.mouse.wheel(0, 500); await pause(3000);

// 2. A Pusaka for sale: verified BTC, dollar value, premium vs the BTC inside
await page.goto(`${URL}/#/pusaka/4`);
await page.getByText("Bitcoin inside, verified on NEAR").waitFor({ timeout: 30_000 });
await page.getByText(/at mainnet BTC prices/).waitFor({ timeout: 30_000 });
await pause(4000);
await scrollTo("Ether inside");
await scrollTo(/You pay about|Buy for/);
await page.getByText("Why the seller can't keep the Bitcoin").click(); await pause(1500);
await scrollTo("Every coin ever signed for"); await pause(2000);

// 3. A loan request backed by verified BTC: LTV and APR
await page.goto(`${URL}/#/pusaka/1`);
await page.getByText("Bitcoin inside, verified on NEAR").waitFor({ timeout: 30_000 });
await pause(3000);
await scrollTo(/loan-to-value/); await pause(2500);
await scrollTo("History"); await pause(2500);

// 4. The NFT image is drawn by the contract and fills with verified BTC
await page.goto(`${URL}/#/`);
await page.locator(".piece").first().waitFor({ timeout: 30_000 });
await page.evaluate(async () => {
  const q = async (id) => {
    const r = await fetch("https://test.rpc.fastnear.com", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "optimistic", account_id: "pusaka-btc.testnet", method_name: "nft_token", args_base64: btoa(JSON.stringify({ token_id: id })) } }) }).then((x) => x.json());
    return JSON.parse(new TextDecoder().decode(new Uint8Array(r.result.result)));
  };
  const toks = await Promise.all(["1", "3", "4"].map(q));
  document.querySelector("main").innerHTML = '<h2 style="font-size:2rem;margin:2rem 0 1rem">Straight from the contract: <code>nft_token</code> media</h2><div style="display:flex;gap:24px">'
    + toks.map((t) => `<figure style="margin:0;width:300px"><img src="${t.metadata.media}" width="300"><figcaption style="font-size:15px">${t.metadata.title}: ${t.metadata.description}</figcaption></figure>`).join("") + "</div>";
});
await pause(6000);

await context.close();
await browser.close();
const video = fs.readdirSync(out).filter((f) => f.endsWith(".webm")).map((f) => path.join(out, f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
const target = path.join(out, "pusaka-demo.webm");
fs.renameSync(video, target);
console.log(target, `${(fs.statSync(target).size / 1e6).toFixed(1)} MB`);
