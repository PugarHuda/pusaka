// Records the wallet-free scenes of docs/reports/08-video.md as separate 1080p clips (media/clips/NN-name.webm),
// real screens of the live app, ready to cut. The buy and withdraw scenes need your wallet: record those by hand.
//   node web/e2e/record-clips.mjs [scene ...]        (default: all; E2E_URL to point elsewhere)
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const URL = process.env.E2E_URL ?? "https://pusaka-two.vercel.app";
const TOKEN = process.env.CLIP_TOKEN ?? "11";
const out = path.join(import.meta.dirname, "..", "..", "media", "clips");
fs.mkdirSync(out, { recursive: true });
const size = { width: 1920, height: 1080 };

const scenes = {
  // 0:00 the idea
  "01-landing": async (p, pause) => {
    await p.goto(`${URL}/#/`);
    await p.getByText(/verified on NEAR across/).waitFor({ timeout: 30_000 });
    await pause(4000);
    await p.mouse.wheel(0, 600); await pause(3500);
  },
  // 0:10 a Pusaka: verified sats and its tb1 address, then the proof trail
  "02-token": async (p, pause, see) => {
    await p.goto(`${URL}/#/pusaka/${TOKEN}`);
    await p.getByText("Bitcoin inside, verified on NEAR").waitFor({ timeout: 30_000 });
    await pause(4500);
    await see("Why the seller can't keep the Bitcoin");
    await see("History");
  },
  // 1:20 the refusal room, then one refusal on the explorer
  "03-refused": async (p, pause) => {
    await p.goto(`${URL}/#/refused`);
    await p.locator("ol.refused li").first().waitFor({ timeout: 30_000 });
    await p.getByText(/Refused:/).first().waitFor({ timeout: 60_000 });
    await pause(3500);
    for (let i = 0; i < 6; i++) { await p.mouse.wheel(0, 450); await pause(1600); }
    const href = await p.locator("ol.refused a[href*='near.rocks/tx']").first().getAttribute("href");
    await p.goto(href); await pause(7000);
  },
  // 1:42 one NFT, many chains
  "04-chains": async (p, pause, see) => {
    await p.goto(`${URL}/#/pusaka/${TOKEN}`);
    await p.getByText("Bitcoin inside, verified on NEAR").waitFor({ timeout: 30_000 });
    await pause(1500);
    for (let i = 0; i < 10; i++) { await p.mouse.wheel(0, 500); await pause(1300); }
  },
  // 1:58 check it yourself, from the browser
  "05-check": async (p, pause) => {
    await p.goto(`${URL}/#/pusaka/${TOKEN}`);
    const b = p.getByRole("button", { name: "Check it yourself" });
    await b.waitFor({ timeout: 30_000 });
    await b.scrollIntoViewIfNeeded(); await pause(1500);
    await b.click();
    await p.getByText(/checks passed|check\(s\) failed/).first().waitFor({ timeout: 120_000 });
    await pause(5000);
  },
  // v2: the NFT's own account, post-quantum lock and the agent's on-chain budget
  "06-v2-agent": async (p, pause, see) => {
    await p.goto(`${URL}/#/v2/${process.env.CLIP_V2 ?? "7"}`);
    await p.getByText("Its own account").waitFor({ timeout: 30_000 });
    await pause(3500);
    await see("Post-quantum lock");
    await see("Agent budget"); await pause(2000);
  },
};

const pick = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(scenes);
const browser = await chromium.launch();
for (const name of pick) {
  const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 1, recordVideo: { dir: out, size } });
  const p = await ctx.newPage();
  const pause = (ms) => p.waitForTimeout(ms);
  const see = async (text) => { await p.getByText(text).first().scrollIntoViewIfNeeded(); await pause(3000); };
  try { await scenes[name](p, pause, see); } catch (e) { console.error(`✗ ${name}: ${e.message.split("\n")[0]}`); }
  const v = p.video();
  await ctx.close();
  const target = path.join(out, `${name}.webm`);
  fs.renameSync(await v.path(), target);
  console.log(`${target} ${(fs.statSync(target).size / 1e6).toFixed(1)} MB`);
}
await browser.close();
