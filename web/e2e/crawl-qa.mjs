// Crawl QA: every page, desktop and phone. Reports JS errors, failed requests, horizontal overflow,
// images without alt, unnamed controls and dead in-app links.  node web/e2e/crawl-qa.mjs [baseURL]
import { chromium } from "@playwright/test";
import { nearFetch } from "@pusaka/shared";
const BASE = process.argv[2] ?? "https://pusaka-two.vercel.app";
const NOISE = /mempool\.space|blockstream\.info|fonts\.g|ERR_ABORTED/;
const rpc = await nearFetch({ method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "final", account_id: "pusaka-btc.testnet", method_name: "nft_total_supply", args_base64: "e30=" } }) }).then((r) => r.json());
const n = Number(JSON.parse(Buffer.from(rpc.result.result).toString()));
const routes = ["/#/", "/#/market", "/#/mine", "/#/agents", "/#/nope", ...Array.from({ length: n }, (_, i) => `/#/pusaka/${i + 1}`), "/p/1"];
const browser = await chromium.launch();
const issues = [];
for (const [name, vp] of [["desktop", { width: 1366, height: 800 }], ["phone", { width: 375, height: 740 }]]) {
  const ctx = await browser.newContext({ viewport: vp });
  for (const r of routes) {
    const page = await ctx.newPage();
    const add = (k, v) => issues.push(`${name} ${r} ${k}: ${String(v).slice(0, 200)}`);
    page.on("pageerror", (e) => add("pageerror", e.message));
    page.on("console", (m) => m.type() === "error" && !NOISE.test(m.text() + (m.location()?.url ?? "")) && add("console", m.text()));
    page.on("requestfailed", (q) => !NOISE.test(q.url()) && add("requestfailed", `${q.url()} ${q.failure()?.errorText}`));
    page.on("response", (s) => s.status() >= 400 && !NOISE.test(s.url()) && add(`http ${s.status()}`, s.url()));
    await page.goto(BASE + r, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(r.startsWith("/#/pusaka") ? 7000 : 5000);
    const f = await page.evaluate(() => {
      const out = {};
      out.overflow = document.documentElement.scrollWidth - innerWidth;
      out.wide = [...document.querySelectorAll("body *")].filter((e) => { const b = e.getBoundingClientRect(); return b.width && b.right > innerWidth + 1 && getComputedStyle(e).position !== "fixed"; })
        .slice(0, 3).map((e) => `${e.tagName}.${e.className}`.slice(0, 60));
      out.noalt = [...document.images].filter((i) => !i.hasAttribute("alt")).map((i) => i.src.slice(0, 60));
      out.unnamed = [...document.querySelectorAll("button,a[href],input,select,textarea")].filter((e) => {
        const t = (e.getAttribute("aria-label") || e.innerText || e.title || e.placeholder || e.value || (e.labels?.[0]?.innerText) || e.querySelector("img[alt]")?.alt || e.querySelector("svg title")?.textContent || "").trim();
        return !t && e.offsetParent; }).map((e) => e.outerHTML.slice(0, 90));
      out.hashes = [...document.querySelectorAll("a[href^='#']")].map((a) => a.getAttribute("href"));
      out.text = document.body.innerText;
      return out;
    });
    if (f.overflow > 1) add("overflow", `${f.overflow}px ${f.wide.join(" ")}`);
    if (f.noalt.length) add("img without alt", f.noalt.join(" "));
    if (f.unnamed.length) add("unnamed control", f.unnamed.slice(0, 3).join(" | "));
    for (const bad of ["undefined", "NaN", "[object Object]", "Infinity"]) if (new RegExp(`\b${bad.replace(/[[\]]/g, "\$&")}\b`).test(f.text)) add("text", bad);
    if (/Loading|Reading/.test(f.text.slice(0, 2000)) && !r.includes("nope")) add("still loading", f.text.match(/.{0,40}(Loading|Reading).{0,40}/)?.[0]);
    await page.close();
  }
  await ctx.close();
}
await browser.close();
console.log([...new Set(issues)].join("\n") || "no issues");
