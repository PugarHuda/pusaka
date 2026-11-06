// A gift link opened in a fresh browser with no wallet: the recipient picks a name, a new NEAR account is created and
// given the Pusaka, and the page shows its key once. The key is saved to .keys/ for clean-up, never printed.
//   node scripts/gift.mjs create pusaka-buyer.testnet <id>   then   node web/e2e/gift-qa.mjs .keys/gifts/pusaka-<id>.txt <name>
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const [linkFile, name] = process.argv.slice(2);
const link = fs.readFileSync(linkFile, "utf8").trim();
// PW_CHROME: a Chromium already on disk, when the resolved playwright wants a newer build than is installed
const b = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {});
const p = await b.newPage();
try {
  await p.goto(link);
  await p.getByRole("heading", { name: "A Pusaka for you" }).waitFor();
  await p.getByText(/sent you Pusaka #\d+/).waitFor({ timeout: 30_000 });
  console.log("page:", (await p.locator("section.gift p").first().innerText()).replace(/\s+/g, " "));
  console.log("wallet connected:", (await p.locator("header").innerText()).includes(".testnet"));
  await p.getByLabel(/Pick a name/).fill(name);
  const t0 = Date.now();
  await p.getByRole("button", { name: "Create my account and claim" }).click();
  await p.getByRole("status").waitFor({ timeout: 90_000 });
  console.log(`result in ${((Date.now() - t0) / 1000).toFixed(0)} s:`, await p.getByRole("status").innerText());
  const key = (await p.locator(".gift-link code").innerText().catch(() => "")).trim();
  if (key.startsWith("ed25519:")) {
    const id = `${name}.testnet`;
    fs.writeFileSync(path.join(import.meta.dirname, "..", "..", ".keys", `${id}.json`), JSON.stringify({ account_id: id, private_key: key }));
    console.log(`the page showed ${id}'s key once (saved to .keys/${id}.json)`);
  }
  await p.screenshot({ path: path.join(process.env.TEMP ?? ".", "gift-claimed.png") });
} finally { await b.close(); }
