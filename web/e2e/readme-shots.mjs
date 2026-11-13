// README screenshots from the live app: docs/screenshots/*.png.
//   node web/e2e/readme-shots.mjs [proof.json]   (proof.json: a BIP-322 {message, witness} for the verify page)
//   SHOT_ONLY=heir node web/e2e/readme-shots.mjs  one screenshot only
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const URL = process.env.E2E_URL ?? "https://pusaka-two.vercel.app";
const CL = "/?contract=pusaka-btc.testnet";
const OUT = path.join(import.meta.dirname, "..", "..", "docs", "screenshots");
fs.mkdirSync(OUT, { recursive: true });
const proof = process.argv[2] && JSON.parse(fs.readFileSync(process.argv[2], "utf8"));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: "light", timezoneId: "UTC" }); // times match the README (UTC)
const shot = async (name, fn) => {
  if (process.env.SHOT_ONLY && process.env.SHOT_ONLY !== name) return;
  try { await fn(); await page.waitForTimeout(1500); await page.screenshot({ path: path.join(OUT, `${name}.png`) }); console.log("✓", name); }
  catch (e) { console.log("✗", name, e.message.split("\n")[0]); }
};
const open = async (p, text) => { await page.goto(URL + p); await page.getByText(text).first().waitFor({ timeout: 90_000 }); await page.waitForTimeout(3000); };
const center = (loc) => loc.first().evaluate((e) => e.scrollIntoView({ block: "center" }));

await shot("market", async () => { await open("/#/market", /verified on NEAR across|BTC verified/); });
await shot("token", async () => { await open(CL + "#/pusaka/4", "Bitcoin inside, verified on NEAR"); });
await shot("clean-to-buy", async () => {
  await open(CL + "#/pusaka/4", "Bitcoin inside, verified on NEAR");
  await page.getByText(/Clean to buy/).first().waitFor({ timeout: 90_000 });
  await page.locator("details.clean summary").click();
  await center(page.locator("details.clean"));
});
await shot("lend-pool", async () => {
  await open(CL + "#/pusaka/4", "Bitcoin inside, verified on NEAR");
  await page.locator("section.lend p.stats").waitFor({ timeout: 60_000 });
  await center(page.locator("section.lend"));
});
await shot("proof-trail-tee", async () => {
  await open(CL + "#/pusaka/1", "Bitcoin inside, verified on NEAR");
  await page.getByText(/Proven by Pusaka's attested TEE agent/).first().waitFor({ timeout: 90_000 });
  await center(page.getByText(/Proven by Pusaka's attested TEE agent/));
});
if (proof) await shot("verify-exchange", async () => {
  await open("/#/verify", "Verify a Pusaka's signature");
  await page.getByLabel("Signed message").fill(proof.message);
  await page.getByLabel(/BIP-322 witness/).fill(proof.witness);
  await page.getByRole("button", { name: "Verify" }).click();
  await page.getByText(/✓ Valid/).first().waitFor({ timeout: 90_000 });
  await center(page.getByText(/✓ Valid/));
});
await shot("smart-pusaka-nbtc", async () => {
  await open("/#/pusaka/4", /sats of nBTC/);
  await center(page.getByText(/sats of nBTC \(Omni Bridge\)/));
});
await shot("heir", async () => {
  await open(CL + "#/pusaka/27", "Bitcoin inside, verified on NEAR");
  await page.getByText(/can claim this Pusaka with everything it holds/).first().waitFor({ timeout: 90_000 });
  await center(page.getByRole("heading", { name: "Heir", exact: true }));
});
await shot("reserves", async () => { await open("/#/reserves", /verified across/); });
await shot("refused", async () => { await open("/#/refused", /Refused:/); });
await shot("agents", async () => { await open("/#/agents", /tools on this endpoint/); });
await browser.close();
