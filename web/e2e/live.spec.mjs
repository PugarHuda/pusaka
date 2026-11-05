// End-to-end checks against the deployed app and the live testnet contract.
//   npm run e2e -w web                      (default: https://pusaka-two.vercel.app)
//   E2E_URL=http://localhost:5173 npm run e2e -w web
// Read-only: no wallet, no transactions. Wallet flows were exercised by hand with Meteor (see README).
import { test, expect } from "@playwright/test";
import { nearFetch } from "@pusaka/shared";

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
  await expect(page.getByRole("heading", { name: /Ether and USDC inside/ })).toBeVisible({ timeout: 30_000 });
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
  expect(p.crossChecked).toBe(true); // a second source (CoinGecko) agrees within 5%
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

test("each Pusaka shows its EVM chains with USDC, its SOL, and its own NEAR account", async ({ page }) => {
  const errors = errorsOf(page);
  await page.goto("/#/pusaka/5");
  await expect(page.locator("table.chains tbody tr")).toHaveCount(3, { timeout: 30_000 });
  await expect(page.locator("table.chains")).toContainText(/Sepolia.*Base Sepolia.*Arbitrum Sepolia/s);
  await expect(page.getByRole("heading", { name: /SOL inside/ })).toBeVisible();
  await expect(page.locator("a[href*='explorer.solana.com/address/']")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Its own NEAR account" })).toBeVisible();
  // the NEAR account is the hex of the same Ed25519 key that is the Solana address
  await expect(page.locator("a[href*='near.rocks/account/']").filter({ hasText: /^[0-9a-f]{64}$/ })).toHaveCount(1);
  await expect(page.locator(".ledger")).toContainText("Held by");
  expect(errors.filter((e) => !/manifest/i.test(e))).toEqual([]);
});

test("the holder room stays closed without the holder's signature", async ({ page, request }) => {
  await page.goto("/#/pusaka/5");
  await expect(page.getByRole("heading", { name: "Holder room" })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".holder-room")).toContainText(/Connect the wallet that holds this Pusaka|Only .* can open it|Sign in to open/);
  const noAuth = await request.post("/api/holder", { data: { token_id: "5" } });
  expect(noAuth.status()).toBe(400);
  const forged = await request.post("/api/holder", { data: { token_id: "5", auth: {
    accountId: "pusaka-seller.testnet", publicKey: "ed25519:12Ync8r3VbEUQXXZJCRmeE1kgB1AorEMm3ERuFxGt8vN",
    signature: Buffer.alloc(64).toString("base64"), nonce: Buffer.alloc(32).toString("base64"),
    at: Date.now(), message: `Open the holder room of Pusaka #5\nat ${Date.now()}` } } });
  expect([400, 401]).toContain(forged.status());
});

test("proof of reserves and embeddable badges come straight from the contract", async ({ request }) => {
  const r = await (await request.get("/api/reserves")).json();
  expect(r.contract).toBe("pusaka-btc.testnet");
  expect(r.tokens.length).toBeGreaterThanOrEqual(5);
  expect(r.total_verified_sats).toBe(r.tokens.reduce((s, t) => s + t.verified_sats, 0));
  const b = await request.get("/api/badge?id=1");
  expect(b.headers()["content-type"]).toContain("image/svg+xml");
  expect(await b.text()).toMatch(/Pusaka #1.*BTC verified/s);
  expect((await request.get("/api/badge?id=x")).status()).toBe(400);
});

test("the app is installable: manifest and icons are served", async ({ request }) => {
  const m = await (await request.get("/manifest.webmanifest")).json();
  expect(m.display).toBe("standalone");
  for (const i of m.icons) expect((await request.get(i.src)).status()).toBe(200);
});

test("routes: leading zeros open the token, junk shows a not-found page, titles follow the page", async ({ page }) => {
  await page.goto("/#/pusaka/004");
  await expect(page.locator("h1, h2").filter({ hasText: /Pusaka #4\b/ }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveTitle(/Pusaka #4/);
  for (const bad of ["#/pusaka/abc", "#/pusaka/1abc", "#/pusaka/-1", "#/nonsense"]) {
    await page.goto(`/${bad}`);
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  }
});

test("a ledger built from the capped on-chain history says so instead of 'in total'", async ({ page, request }) => {
  const rpc = await request.post("https://near-testnet.drpc.org", { data: { jsonrpc: "2.0", id: 1, method: "query",
    params: { request_type: "call_function", finality: "optimistic", account_id: "pusaka-btc.testnet", method_name: "token_info",
      args_base64: Buffer.from('{"token_id":"1"}').toString("base64") } } });
  const info = JSON.parse(Buffer.from((await rpc.json()).result.result).toString());
  test.skip(info.history[0].event.kind === "Mint", "#1's full history still fits");
  await page.goto("/#/pusaka/1");
  await expect(page.locator(".ledger")).toContainText(/in its last \d+ events|no sale in its last/, { timeout: 30_000 });
  await expect(page.locator(".ledger")).toContainText("NEP-297 logs");
});

test("security headers: the wallet page can't be framed", async ({ request }) => {
  const r = await request.get("/");
  expect(r.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(r.headers()["x-frame-options"]).toBe("DENY");
  expect(r.headers()["x-content-type-options"]).toBe("nosniff");
});

test("APIs answer bad input with 4xx, never 500 or internals", async ({ request }) => {
  for (const path of ["/api/prove", "/api/relay", "/api/holder"]) {
    const r = await request.post(path, { headers: { "content-type": "application/json" }, data: "{bad json" });
    expect(r.status(), path).toBe(400);
    expect((await r.json()).error).toBe("the body must be JSON");
  }
  const arr = await request.post("/api/prove", { data: { token_id: ["1"] } });
  expect(arr.status()).toBe(400);
  for (const path of ["/api/badge?id=1", "/api/reserves", "/api/prices"]) expect((await request.post(path, { data: {} })).status(), path).toBe(405);
  expect((await request.get("/api/badge?id=01")).status()).toBe(200);
});

test("the remote MCP endpoint works from a browser (CORS) and returns JSON-RPC parse errors", async ({ request }) => {
  const pre = await request.fetch("/api/mcp", { method: "OPTIONS", headers: { origin: "https://example.com", "access-control-request-method": "POST" } });
  expect(pre.status()).toBe(204);
  expect(pre.headers()["access-control-allow-origin"]).toBe("*");
  const bad = await request.post("/api/mcp", { headers: { "content-type": "application/json" }, data: "{bad" });
  expect(bad.status()).toBe(400);
  expect((await bad.json()).error.code).toBe(-32700);
});

test("a Pusaka shows the nBTC in its own NEAR account and its Omni Bridge deposit address", async ({ page }) => {
  await page.goto("/#/pusaka/5");
  const sec = page.locator("section").filter({ has: page.getByRole("heading", { name: "nBTC on NEAR" }) });
  await expect(sec).toBeVisible({ timeout: 40_000 });
  await expect(sec).toContainText(/[1-9][\d,]* nBTC sats/); // #5's account holds nBTC minted by the Omni connector
  await expect(sec.locator(".addr")).toContainText(/^tb1q[0-9a-z]{38,}/);
});

test("every Pusaka has an heir section; the will is read from the contract", async ({ page }) => {
  await page.goto("/#/pusaka/1");
  const s = page.locator("section", { has: page.getByRole("heading", { name: "Heir" }) });
  await expect(s).toBeVisible({ timeout: 30_000 });
  await expect(s.getByText(/No heir named|can claim this Pusaka/)).toBeVisible();
});

// Monitoring as much as testing: CI runs this every 6 hours, so it fails before a judge finds an empty shelf.
test("the README's try-it stock is there and the relayer can pay for it", async () => {
  // through the app's own RPC failover (FastNear, dRPC, NEAR): one rate-limited RPC must not page us
  const rpc = async (params) => {
    const body = await (await nearFetch({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { finality: "final", ...params } }) })).json();
    if (!body.result) throw new Error(`RPC: ${JSON.stringify(body.error ?? body).slice(0, 200)}`);
    return body.result;
  };
  const relayer = await rpc({ request_type: "view_account", account_id: "pusaka-relayer.testnet" });
  expect(Number(BigInt(relayer.amount) / 10n ** 21n) / 1000, "relayer NEAR (top it up)").toBeGreaterThan(2);
  const view = async (method, args) => JSON.parse(Buffer.from((await rpc({ request_type: "call_function", account_id: "pusaka-btc.testnet", method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") })).result).toString());
  const n = Number(await view("nft_total_supply", {}));
  const infos = await Promise.all(Array.from({ length: n }, (_, i) => view("token_info", { token_id: String(i + 1) })));
  const backed = infos.filter((t) => +t.verified_sats >= 10_000);
  expect(backed.filter((t) => t.listing).length, "Pusakas for sale (run scripts/restock.mjs)").toBeGreaterThanOrEqual(1);
  expect(backed.filter((t) => t.loan && !t.loan.lender).length, "loan requests (run scripts/restock.mjs)").toBeGreaterThanOrEqual(1);
});

test("a Pusaka's BTC has a live NEAR Intents exit quote, and a loan says how often it covers the loan", async ({ page }) => {
  await page.goto("/#/pusaka/12");
  await expect(page.locator(".exit-quote")).toContainText(/fetches [\d.]+ USDC on Base \(at least [\d.]+\)/, { timeout: 40_000 });
  await expect(page.locator(".actions .stats")).toContainText(/NEAR Intents solvers pay \$[\d.,]+ for its BTC right now, [\d.]+× the loan/, { timeout: 40_000 });
});

test("Your Pusakas without a wallet asks to connect, and fits a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/mine");
  await expect(page.getByRole("heading", { name: "Your Pusakas", level: 1 })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".mine")).toContainText("Connect your NEAR wallet to see the Pusakas you hold");
  await expect(page.locator(".mine").getByRole("button", { name: "Connect NEAR wallet" })).toBeVisible();
  await expect(page).toHaveTitle(/Your Pusakas/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});
