// Cross-browser UI checks: Chromium, Firefox, WebKit, a tablet and a phone (see playwright.config.mjs).
// Reads the live testnet contract; failure cases are made with route interception, nothing is faked
// on the success path. Visual snapshots only cover pages whose pixels don't depend on live data.
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const NEAR_RPC = /test\.rpc\.fastnear\.com|near-testnet\.drpc\.org|rpc\.testnet\.near\.org/;
const ESPLORA = /mempool\.space|blockstream\.info/;
// a rate-limited or refused request to one Bitcoin explorer or NEAR RPC is the app failing over (tested on its own below)
// (WebKit words a refused cross-origin 429 without the host: "... Status code: 429", "... due to access control checks")
const ESPLORA_NOISE = /mempool\.space|blockstream\.info|rpc\.fastnear\.com|drpc\.org|rpc\.testnet\.near\.org|Status code: 429|due to access control checks/;

const errorsOf = (page) => {
  const errors = [];
  // WebKit reports a refused cross-origin load as a page error; only that network wording is let through
  page.on("pageerror", (e) => !/due to access control checks/.test(e.message) && errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !ESPLORA_NOISE.test(m.text() + (m.location()?.url ?? "")) && errors.push(m.text()));
  return errors;
};

// ---------- happy paths, every browser and viewport ----------

test("landing → market → a Pusaka → back and forward keep the right page", async ({ page }) => {
  const errors = errorsOf(page);
  await page.goto("/#/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("NFTs that hold real Bitcoin");
  await page.goto("/#/market");
  const first = page.locator("a[href^='#/pusaka/']").first();
  await expect(first).toBeVisible({ timeout: 30_000 });
  const href = await first.getAttribute("href");
  await first.click();
  await expect(page).toHaveURL(new RegExp(`${href.replace(/[#/]/g, "\\$&")}$`));
  await expect(page.getByRole("heading", { name: /Pusaka #\d+/ }).first()).toBeVisible({ timeout: 30_000 });
  await page.goBack();
  await expect(page).toHaveURL(/#\/market$/);
  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`${href.replace(/[#/]/g, "\\$&")}$`));
  expect(errors.filter((e) => !/manifest|Failed to load resource/i.test(e))).toEqual([]);
});

test("deep links: a token by leading zeros, a missing token, and junk routes", async ({ page }) => {
  await page.goto("/#/pusaka/0002");
  await expect(page.getByRole("heading", { name: /Pusaka #2\b/ }).first()).toBeVisible({ timeout: 30_000 });
  await page.goto("/#/pusaka/999999");
  await expect(page.getByText(/There is no Pusaka #999999/)).toBeVisible({ timeout: 30_000 });
  await page.goto("/#/pusaka/-1");
  await expect(page.getByText(/nothing at/i)).toBeVisible();
  await page.goto(`/#/${"x".repeat(5000)}`);
  await expect(page.getByText(/nothing at/i)).toBeVisible();
  await page.goto("/#/pusaka/%3Cscript%3Ealert(1)%3C%2Fscript%3E");
  await expect(page.locator("script:text('alert(1)')")).toHaveCount(0);
});

test("pages that need a wallet ask to connect instead of failing", async ({ page }) => {
  await page.goto("/#/mine");
  await expect(page.getByRole("button", { name: /connect/i }).first()).toBeVisible({ timeout: 30_000 });
});

test("no horizontal scroll on any key page", async ({ page }) => {
  for (const r of ["/#/", "/#/market", "/#/pusaka/2", "/#/agents", "/#/mine", "/#/refused"]) {
    await page.goto(r);
    if (r === "/#/refused") await page.locator(".refused li, [role=alert]").first().waitFor({ timeout: 30_000 }); // cards hold long account names and hashes
    await page.waitForTimeout(3000);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(over, `${r} overflows by ${over}px`).toBeLessThanOrEqual(1);
  }
});

test("command palette: odd and huge input never breaks it, Escape closes it", async ({ page }) => {
  await page.goto("/#/market");
  await expect(page.locator("a[href^='#/pusaka/']").first()).toBeVisible({ timeout: 30_000 }); // the app is up and listening
  await page.keyboard.press("Control+k");
  const box = page.getByRole("textbox", { name: "Go to" });
  await expect(box).toBeVisible();
  for (const q of ["", "  ", "<img src=x onerror=alert(1)>", "%00", "💥🧱", "#".repeat(2000), "-1", "1e309"]) await box.fill(q);
  await box.fill("market");
  await expect(page.getByRole("option", { name: /Market/ }).first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(box).toBeHidden();
});

// ---------- failure paths (route interception) ----------

test("NEAR RPC down: the token page says so and recovers with Try again", async ({ page }) => {
  let down = true;
  await page.route(NEAR_RPC, (r) => (down ? r.fulfill({ status: 503, body: "down" }) : r.continue()));
  await page.goto("/#/pusaka/2");
  const retry = page.getByRole("button", { name: "Try again" });
  await expect(retry).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText(/Couldn't reach NEAR to load Pusaka #2/)).toBeVisible();
  down = false;
  await retry.click();
  await expect(page.getByRole("heading", { name: /Pusaka #2\b/ }).first()).toBeVisible({ timeout: 30_000 });
});

test("NEAR RPC down: the market and the landing page say they can't read the contract, and Try again recovers", async ({ page }) => {
  let down = true;
  await page.route(NEAR_RPC, (r) => (down ? r.fulfill({ status: 503, body: "down" }) : r.continue()));
  await page.goto("/#/market");
  await expect(page.getByRole("alert").filter({ hasText: /Couldn't read the contract/ })).toBeVisible({ timeout: 45_000 });
  await page.goto("/#/");
  await page.reload(); // a fresh landing page, not the market's leftover message
  const alert = page.getByRole("alert").filter({ hasText: /Couldn't read the contract/ });
  await expect(alert).toBeVisible({ timeout: 45_000 });
  down = false;
  await alert.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText(/Pusaka hold proven Bitcoin/)).toBeVisible({ timeout: 30_000 });
  await expect(alert).toBeHidden();
});

test("both Bitcoin explorers down: the page still shows the NEAR-verified sats and warns", async ({ page }) => {
  await page.route(ESPLORA, (r) => r.fulfill({ status: 502, body: "bad gateway" }));
  await page.goto("/#/pusaka/1");
  await expect(page.getByText(/Neither Bitcoin explorer/)).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText(/verified/i).first()).toBeVisible();
});

test("price API failing hides dollar figures instead of showing NaN", async ({ page }) => {
  await page.route(/\/api\/prices/, (r) => r.fulfill({ status: 500, body: "{}" }));
  await page.goto("/#/pusaka/4");
  await expect(page.getByRole("heading", { name: /Pusaka #4\b/ }).first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(3000);
  await expect(page.locator("body")).not.toContainText(/NaN|\$undefined|Infinity/);
});

test("going offline mid-session doesn't blank the page; back online, navigation works", async ({ page, context }) => {
  await page.goto("/#/market");
  await expect(page.locator("a[href^='#/pusaka/']").first()).toBeVisible({ timeout: 30_000 });
  await context.setOffline(true);
  await page.goto("/#/pusaka/3").catch(() => {}); // hash navigation needs no network
  await expect(page.getByText(/Couldn't reach NEAR|Pusaka #3/).first()).toBeVisible({ timeout: 45_000 });
  await context.setOffline(false);
  await page.goto("/#/pusaka/3");
  await expect(page.getByRole("heading", { name: /Pusaka #3\b/ }).first()).toBeVisible({ timeout: 30_000 });
});

// ---------- accessibility (axe-core) ----------

for (const [name, path, ready] of [
  ["landing", "/#/", "h1"],
  ["market", "/#/market", "a[href^='#/pusaka/']"],
  ["a Pusaka", "/#/pusaka/2", "section[aria-label='Staking'], .ledger"],
  ["for AI agents", "/#/agents", "h1, h2"],
  ["refused", "/#/refused", ".refused li, [role=alert]"],
  ["not found", "/#/nope", "text=nothing at"],
]) {
  test(`axe: no serious or critical accessibility violations on ${name}`, async ({ page }) => {
    await page.goto(path);
    await page.locator(ready).first().waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1500);
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    const bad = r.violations.filter((v) => ["serious", "critical"].includes(v.impact))
      .map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
    expect(bad).toEqual([]);
  });
}

test("axe: dark mode has no serious or critical violations either (contrast included)", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  for (const [path, ready] of [["/#/", "h1"], ["/#/market", "a[href^='#/pusaka/']"], ["/#/pusaka/2", ".ledger"]]) {
    await page.goto(path);
    await page.locator(ready).first().waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1500);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    const bad = r.violations.filter((v) => ["serious", "critical"].includes(v.impact))
      .map((v) => `${path} ${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
    expect(bad).toEqual([]);
  }
});

// ---------- visual regression (pages whose pixels don't depend on live data) ----------

test("visual: not-found page", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
  await page.goto("/#/nothing-here");
  await expect(page.getByText(/nothing at/i)).toBeVisible();
  await expect(page).toHaveScreenshot("not-found.png", { fullPage: true, maxDiffPixelRatio: 0.02, mask: [page.locator(".bell, header .live")] });
});

test("visual: Your Pusakas without a wallet, light, then dark when the system switches while it's open", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
  await page.goto("/#/mine");
  await expect(page.getByRole("button", { name: /connect/i }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("main")).toHaveScreenshot("mine-light.png", { maxDiffPixelRatio: 0.02 });
  await page.emulateMedia({ colorScheme: "dark" }); // no reload: the page has to follow the system by itself
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("button", { name: "Switch to light mode" })).toBeVisible();
  await expect(page.locator("main")).toHaveScreenshot("mine-dark.png", { maxDiffPixelRatio: 0.02 });
});
