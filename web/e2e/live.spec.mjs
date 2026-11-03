// End-to-end checks against the deployed app and the live testnet contract.
//   npm run e2e -w web                      (default: https://pusaka-two.vercel.app)
//   E2E_URL=http://localhost:5173 npm run e2e -w web
// Read-only: no wallet, no transactions. Wallet flows were exercised by hand with Meteor (see README).
import { test, expect } from "@playwright/test";

const errorsOf = (page) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  return errors;
};

test("home lists every Pusaka with its verified BTC", async ({ page }) => {
  const errors = errorsOf(page);
  await page.goto("/#/");
  await expect(page.getByRole("heading", { name: "NFTs that hold real Bitcoin." })).toBeVisible();
  await expect(page.locator(".piece").first()).toContainText("BTC verified", { timeout: 30_000 });
  expect(await page.locator(".piece").count()).toBeGreaterThanOrEqual(4);
  expect(errors).toEqual([]);
});

test("a Pusaka page shows proven BTC, its address, ETH and history", async ({ page }) => {
  const errors = errorsOf(page);
  await page.goto("/#/pusaka/1");
  await expect(page.getByRole("heading", { name: "Bitcoin inside, verified on NEAR" })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".amount").first()).toHaveText(/\d\.\d{8} BTC/);
  await expect(page.locator(".addr a").first()).toHaveAttribute("href", /mempool\.space\/testnet\/address\/tb1/);
  await expect(page.getByRole("heading", { name: /Ether inside/ })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".history li").first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("unknown Pusaka shows not-found, and the page recovers on navigation", async ({ page }) => {
  await page.goto("/#/pusaka/99999");
  await expect(page.getByText("There is no Pusaka #99999")).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => { location.hash = "#/pusaka/1"; }); // regression: stale state used to stick
  await expect(page.getByRole("heading", { name: "Pusaka #1" })).toBeVisible({ timeout: 30_000 });
});

test("detail page fits a phone screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/pusaka/1");
  await expect(page.getByRole("heading", { name: "Pusaka #1" })).toBeVisible({ timeout: 30_000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("without a wallet, buy/lend actions offer to connect instead of failing", async ({ page }) => {
  await page.goto("/#/pusaka/3");
  await expect(page.locator(".actions")).toBeVisible({ timeout: 30_000 });
  const text = await page.locator(".actions").innerText();
  expect(text).toMatch(/Connect NEAR wallet|isn.t for sale|On sale through/);
});

test("relayer API refuses bad input", async ({ request }) => {
  expect((await request.get("/api/prove")).status()).toBe(405);
  const badId = await request.post("/api/prove", { data: { token_id: "../1" } });
  expect(badId.status()).toBe(400);
  const notDelegate = await request.post("/api/relay", { data: { signed_delegate: "AAAA" } });
  expect(notDelegate.status()).toBe(400);
  expect((await notDelegate.json()).error).toMatch(/SignedDelegate/);
});

test("the NFT image is drawn on-chain and follows verified BTC", async ({ request }) => {
  const rpc = await request.post("https://test.rpc.fastnear.com", { data: {
    jsonrpc: "2.0", id: 1, method: "query",
    params: { request_type: "call_function", finality: "optimistic", account_id: "pusaka-btc.testnet",
      method_name: "nft_token", args_base64: Buffer.from(JSON.stringify({ token_id: "4" })).toString("base64") },
  } });
  const token = JSON.parse(Buffer.from((await rpc.json()).result.result).toString());
  expect(token.metadata.media).toMatch(/^data:image\/svg\+xml;base64,/);
  const svg = Buffer.from(token.metadata.media.split(",")[1], "base64").toString();
  expect(svg).toContain("<svg");
  expect(token.metadata.description).toMatch(/BTC verified on NEAR/);
});

test("live prices reach the browser and show dollar values", async ({ page, request }) => {
  const p = await (await request.get("/api/prices")).json();
  expect(p.btcUsd).toBeGreaterThan(1000);
  expect(p.nearUsd).toBeGreaterThan(0);
  await page.goto("/#/pusaka/4");
  await expect(page.getByText(/at mainnet BTC prices/)).toBeVisible({ timeout: 30_000 });
});

test("home shows total BTC verified and the social card is served", async ({ page, request }) => {
  await page.goto("/#/");
  await expect(page.locator(".reserves")).toContainText(/BTC verified on NEAR across \d+ Pusaka/, { timeout: 30_000 });
  const og = await request.get("/og.png");
  expect(og.status()).toBe(200);
  expect(og.headers()["content-type"]).toContain("image/png");
  expect(await page.locator('meta[property="og:image"]').getAttribute("content")).toMatch(/og\.png$/);
});

test("a Pusaka on sale through an outside market shows it, and that its BTC is locked", async ({ page, request }) => {
  const rpc = await request.post("https://test.rpc.fastnear.com", { data: {
    jsonrpc: "2.0", id: 1, method: "query",
    params: { request_type: "call_function", finality: "optimistic", account_id: "pusaka-btc.testnet",
      method_name: "nft_tokens", args_base64: Buffer.from("{}").toString("base64") },
  } });
  const tokens = JSON.parse(Buffer.from((await rpc.json()).result.result).toString());
  const onMarket = tokens.find((t) => Object.keys(t.approved_account_ids ?? {}).length > 0);
  test.skip(!onMarket, "no Pusaka is approved on an outside market right now");
  await page.goto(`/#/pusaka/${onMarket.token_id}`);
  await expect(page.locator(".actions")).toContainText(/On sale through .*mintspace2\.testnet/, { timeout: 30_000 });
  await expect(page.locator(".actions")).toContainText(/Bitcoin is locked/);
});

test("home shows the latest contract transactions, linked to the explorer", async ({ page }) => {
  await page.goto("/#/");
  const links = page.locator(".activity a");
  await expect(links.first()).toBeVisible({ timeout: 30_000 });
  await expect(links.first()).toHaveAttribute("href", /near\.rocks\/tx\/[1-9A-HJ-NP-Za-km-z]{43,44}$/);
});
