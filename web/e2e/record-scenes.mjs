// Records the demo-video scenes (video/script.mjs) from the live app: one 1080p clip per scene in
// video/public/clips/<scene>.webm, plus <scene>.json with timed marks (what was clicked or shown, and where) that the
// video uses for zooms, highlight boxes and voice-over timing. Wallet popups are recorded too (<scene>.p1.webm ...).
//   node web/e2e/record-scenes.mjs <scene ...>          (no scene: lists them)
// Wallet scenes drive Intear Wallet in a persistent profile (WQ_PROFILE, default $TEMP/wq/profile) with the accounts
// already imported (`node web/e2e/record-scenes.mjs import <.keys/x.json>` adds one). Keys are typed into the
// wallet, never printed. Testnet only.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const URL = process.env.E2E_URL ?? "https://pusaka-two.vercel.app";
const TOKEN = process.env.CLIP_TOKEN ?? "11"; // the Pusaka the core story buys
// the core story runs on the frozen classic contract (its Pusakas hold most of the BTC); "" for the main contract
const Q = process.env.CLIP_Q ?? "?contract=pusaka-btc.testnet";
const LIQUIDATOR = process.env.CLIP_LIQUIDATOR ?? "pusaka-admin.testnet", LIQ_TOKEN = process.env.CLIP_LIQ_TOKEN ?? "1"; // Smart Pusaka #1, pledged to the pool
const BUYER = process.env.CLIP_BUYER ?? "pusaka-w-mvzhtaw8.testnet"; // recorder wallet
const WITHDRAW_TO = process.env.CLIP_WITHDRAW_TO ?? "tb1q4jyg3kjgre5r59fukjsrxmf5fjgcxq9pxfw3vj"; // Pusaka #3, also the recorder's
const HEIR_TOKEN = process.env.CLIP_HEIR_TOKEN ?? "3", HEIR = process.env.CLIP_HEIR ?? "pusaka-seller.testnet";
const GIFT_TOKEN = process.env.CLIP_GIFT_TOKEN ?? "3", GIFTER = process.env.CLIP_GIFTER ?? HEIR; // the heir gives #3 on
const V2_TOKEN = process.env.CLIP_V2 ?? "7", V2_HOLDER = process.env.CLIP_V2_HOLDER ?? "pusaka-seller.testnet";
// vault + covered call: Smart Pusakas #1 / #2 held by V2_OWNER; the Bitcoin-strike payment proven earlier on #5
const V2_OWNER = process.env.CLIP_V2_OWNER ?? "pusaka-admin.testnet", VAULT_TOKEN = process.env.CLIP_VAULT ?? "1", VAULT_RECOVERY = process.env.CLIP_RECOVERY ?? HEIR;
const CALL_TOKEN = process.env.CLIP_CALL ?? "2", CALL_BUYER = process.env.CLIP_CALL_BUYER ?? BUYER, CALL_PAY_TO = process.env.CLIP_PAY_TO ?? WITHDRAW_TO;
const CALL_PROOF_TX = "2tzxAe31dPPanqq7YVxzz4kCYq8o6YWrC5DFEDGWexDV", CALL_BTC_TX = "0b856ff69009bfa82c1da65b9946f955304ab79d2acd3bcf7451281b9e626a89";
const KEYS = path.join(import.meta.dirname, "..", "..", ".keys");
const PROFILE = process.env.WQ_PROFILE ?? path.join(os.tmpdir(), "wq", "profile");
const OUT = path.join(import.meta.dirname, "..", "..", "video", "public", "clips");
const VIEW = { width: 1920, height: 1080 }, SCALE = 1; // recordVideo captures CSS px, so pages are zoomed instead (ZOOM)
const ZOOM = process.env.CLIP_ZOOM ?? "1.25"; // larger text in the video; the wallet keeps its own size
const redact = (s) => String(s).replace(/ed25519:\w+/g, "[key]");

// A visible cursor and click ripple: headless video has no pointer.
const CURSOR = (ZOOM) => {
  const add = () => {
    // zoom the app (#root) rather than the page, so the wallet picker's iframes keep their own size and clicks land
    if (/pusaka|near\.rocks|mempool/.test(location.hostname)) (document.getElementById("root") ?? document.documentElement).style.zoom = ZOOM;
    if (document.getElementById("__rec_cursor") || !document.documentElement) return;
    // secrets never reach the recording: a gift link (one-time key) and a new account's key are blurred in the page
    const hide = document.createElement("style");
    hide.textContent = ".gift-link code { filter: blur(9px); }";
    document.documentElement.appendChild(hide);
    const c = document.createElement("div");
    c.id = "__rec_cursor";
    c.style.cssText = "position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;transform:translate(-200px,-200px);transition:none";
    c.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,.45))"><path d="M4 2l16 9.5-7 1.6-3.6 6.9z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.documentElement.appendChild(c);
    const pos = sessionStorage.getItem("__rec_pos");
    if (pos) c.style.transform = pos;
    addEventListener("mousemove", (e) => { const z = Number(document.documentElement.style.zoom) || 1; c.style.transform = `translate(${e.clientX / z - 3}px,${e.clientY / z - 2}px)`; sessionStorage.setItem("__rec_pos", c.style.transform); }, true);
    addEventListener("mousedown", (e) => {
      const r = document.createElement("div");
      r.style.cssText = `position:fixed;left:${e.clientX / (Number(document.documentElement.style.zoom) || 1) - 18}px;top:${e.clientY / (Number(document.documentElement.style.zoom) || 1) - 18}px;width:36px;height:36px;border-radius:50%;border:3px solid #f7931a;z-index:2147483646;pointer-events:none;transition:transform .45s ease-out,opacity .45s ease-out`;
      document.documentElement.appendChild(r);
      requestAnimationFrame(() => { r.style.transform = "scale(1.9)"; r.style.opacity = "0"; });
      setTimeout(() => r.remove(), 600);
    }, true);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", add); else add();
};

/** One recording: a fresh (or wallet) context, helpers that log marks, then the files moved into video/public/clips. */
async function record(name, fn, { wallet = false } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rec-"));
  const opts = { viewport: VIEW, recordVideo: { dir: tmp, size: { width: 1920, height: 1080 } }, colorScheme: "light" };
  const browser = wallet ? null : await chromium.launch();
  const ctx = wallet ? await chromium.launchPersistentContext(PROFILE, { headless: true, ...opts }) : await browser.newContext(opts);
  await ctx.addInitScript(CURSOR, ZOOM);
  const t0 = Date.now();
  const p = ctx.pages()[0] ?? await ctx.newPage();
  const now = () => +((Date.now() - t0) / 1000).toFixed(2);
  const marks = {}, popups = [], log = [];
  ctx.on("page", (w) => {
    if (w !== p) { const e = { page: w, start: now(), end: null, size: null }; popups.push(e); w.waitForLoadState().then(() => { e.url = w.url(); return w.evaluate(() => [innerWidth, innerHeight]); }).then((s) => { e.size = s; }, () => {}); } w.on("close", () => { const e = popups.find((x) => x.page === w); if (e) e.end = now(); }); });
  const boxOf = async (loc, page = p) => {
    const b = await loc.boundingBox().catch(() => null);
    if (!b) return null;
    return [b.x, b.y, b.width, b.height].map((v) => Math.round(v * SCALE));
  };
  const h = {
    p, ctx, now,
    pause: (ms) => p.waitForTimeout(ms),
    /** Note a moment (and where `loc` is on screen) under `id`; video/script.mjs refers to it as "@id". */
    mark: async (id, loc, page = p) => {
      const m = { t: now() };
      if (loc) m.box = await boxOf(loc, page);
      const i = popups.findIndex((x) => x.page === page);
      if (i >= 0) m.popup = i;
      marks[id] = m; log.push(`${m.t}s ${id}${m.box ? " " + m.box.join(",") : ""}${i >= 0 ? " (popup " + (i + 1) + ")" : ""}`);
      return m;
    },
    /** Mark a heading's block (the heading and what follows it up to the next heading), for flat page layouts. */
    markBlock: async (id, head, page = p) => {
      const r = await head.first().evaluate((h) => {
        const lvl = Number(h.tagName[1]) || 6;
        let top = h.getBoundingClientRect(), box = { l: top.left, t: top.top, r: top.right, b: top.bottom };
        const host = h.closest("section, form, article") ?? h.parentElement;
        const hostR = host.getBoundingClientRect();
        if (hostR.height < 900 && host !== document.body && host.querySelectorAll("h1,h2,h3").length <= 1) return [hostR.left, hostR.top, hostR.width, hostR.height];
        for (let n = h.nextElementSibling; n && !(/^H[1-6]$/.test(n.tagName) && Number(n.tagName[1]) <= lvl); n = n.nextElementSibling) {
          const q = n.getBoundingClientRect();
          if (q.bottom - box.t > 900) break;
          box = { l: Math.min(box.l, q.left), t: box.t, r: Math.max(box.r, q.right), b: Math.max(box.b, q.bottom) };
        }
        return [box.l, box.t, box.r - box.l, box.b - box.t];
      });
      const m = { t: now(), box: r.map((v) => Math.round(v * SCALE)) };
      marks[id] = m; log.push(`${m.t}s ${id} ${m.box.join(",")} (block)`);
      return m;
    },
    /** Smoothly scroll `loc` to the middle of the screen. */
    scrollTo: async (loc, page = p) => {
      await loc.first().evaluate((e) => e.scrollIntoView({ behavior: "smooth", block: "center" }));
      await page.waitForTimeout(1300);
    },
    /** Glide the cursor onto `loc` (so viewers see where the click goes). */
    move: async (loc, page = p) => {
      const b = await loc.boundingBox();
      if (!b) return;
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 25 });
      await page.waitForTimeout(350);
    },
    click: async (id, loc, page = p) => {
      await loc.waitFor({ timeout: 60_000 });
      await loc.scrollIntoViewIfNeeded();
      await h.move(loc, page);
      await h.mark(id, loc, page);
      await loc.click();
    },
    type: async (id, loc, text, page = p) => {
      await h.click(id, loc, page);
      await loc.fill("");
      await loc.pressSequentially(text, { delay: 45 });
    },
    /** Click something that opens the wallet, show the popup, highlight and click its approve button. */
    approve: async (id, loc, button = /^(Confirm|Approve|Sign|Send|Continue)/) => {
      const pop = ctx.waitForEvent("page", { timeout: 60_000 });
      pop.catch(() => {}); // if the click itself fails, don't let this wait outlive the context
      await h.click(id, loc);
      const w = await pop;
      await w.waitForLoadState();
      await w.waitForTimeout(3500);
      const b = w.getByRole("button", { name: button }).first();
      await b.waitFor({ timeout: 60_000 });
      await h.mark(`${id}-wallet`, null, w);
      await w.waitForTimeout(2500); // let the viewer read what is being signed
      await h.click(`${id}-approve`, b, w);
      log.push(`  wallet: ${redact((await w.innerText("body").catch(() => "")).replace(/\s+/g, " ").slice(0, 160))}`);
      return w;
    },
    /** Click; if the wallet opens, approve it (some actions are signed messages or gas-free, some aren't). */
    maybeApprove: async (id, loc) => {
      const pop = ctx.waitForEvent("page", { timeout: 8000 }).catch(() => null);
      await h.click(id, loc);
      const w = await pop;
      if (!w) return null;
      await w.waitForLoadState(); await w.waitForTimeout(3000);
      const b = w.getByRole("button", { name: /^(Confirm|Approve|Sign|Send|Continue)/ }).first();
      await b.waitFor({ timeout: 60_000 });
      await h.mark(`${id}-wallet`, null, w);
      await w.waitForTimeout(2000);
      await h.click(`${id}-approve`, b, w);
      await h.followUps(id);
      return w;
    },
    /** Some actions need a second wallet approval (a letter: the MPC key request, then the letter): approve those too. */
    followUps: async (id) => {
      for (let n = 2; n < 5; n++) {
        const w = await ctx.waitForEvent("page", { timeout: 15_000 }).catch(() => null);
        if (!w) return;
        await w.waitForLoadState(); await w.waitForTimeout(3000);
        const b = w.getByRole("button", { name: /^(Confirm|Approve|Sign|Send|Continue)/ }).first();
        await b.waitFor({ timeout: 60_000 });
        await h.mark(`${id}-wallet${n}`, null, w);
        await w.waitForTimeout(1500);
        await h.click(`${id}-approve${n}`, b, w);
      }
    },
    /** Connect the app to `who` through Intear (picking the account if the wallet has several). */
    connect: async (who) => {
      if ((await p.locator("header").innerText()).includes(who)) return;
      const out = p.getByTitle("Disconnect wallet");
      if (await out.count()) { await out.click(); await p.waitForTimeout(2000); }
      await h.click("connect", p.getByRole("button", { name: /connect/i }).first());
      await p.waitForTimeout(2500);
      await h.click("connect-intear", p.getByText("Intear Wallet", { exact: true }));
      await p.waitForTimeout(3000); // near-connect loads Intear's connector iframe: Web / App / ...
      let web = null;
      for (let i = 0; i < 20 && !web; i++, await p.waitForTimeout(500)) for (const fr of p.frames()) { const b = fr.getByText("Web", { exact: true }); if (await b.count()) web = b.first(); }
      if (!web) throw new Error("Intear's connector shows no Web option");
      const pop = ctx.waitForEvent("page", { timeout: 60_000 });
      await h.click("connect-web", web);
      const w = await pop;
      await w.waitForLoadState(); await w.waitForTimeout(4000);
      const selected = await w.getByText("Selected Account").locator("..").innerText().catch(() => "");
      if (!selected.includes(who.slice(0, 14))) { // the wallet offers its current account first; pick ours
        await w.getByText("Selected Account").click(); await w.waitForTimeout(800);
        // the switcher shortens long names ("pusaka-w....testnet")
        const short = new RegExp(`^${who.slice(0, 8).replace(/[.-]/g, "\$&")}.*${who.split(".").at(-1)}$`);
        await w.getByText(short).last().click(); await w.waitForTimeout(800);
      }
      await h.click("connect-approve", w.getByRole("button", { name: "Connect", exact: true }), w);
      await p.waitForTimeout(5000);
      await h.mark("connected", p.locator("header"));
    },
    /** Wait for the newest status message of a section and mark it. */
    status: async (id, scope = p, re = /./, timeout = 180_000) => {
      const st = scope.getByRole("status").filter({ hasText: re }).last();
      await st.waitFor({ timeout });
      await h.scrollTo(st);
      await h.mark(id, st);
      log.push(`  status: ${redact((await st.innerText()).replace(/\s+/g, " ").slice(0, 200))}`);
      return st;
    },
    /** The newest transaction `signer` sent after `since` (ms), from FastNear's tx index. */
    lastTx: async (signer, since) => {
      for (let i = 0; i < 40; i++) {
        const r = await fetch("https://tx.test.fastnear.com/v0/account", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ account_id: signer, is_signer: true }) }).then((x) => x.json()).catch(() => null);
        const tx = r?.account_txs?.find((t) => t.is_signer && Number(BigInt(t.tx_block_timestamp) / 1_000_000n) >= since - 5000);
        if (tx) return tx.transaction_hash;
        await new Promise((ok) => setTimeout(ok, 3000));
      }
      throw new Error(`no new transaction from ${signer}`);
    },
    /** Open a NEAR transaction on the explorer and mark its status line. */
    explorer: async (id, hash) => {
      await p.goto(`https://testnet.near.rocks/tx/${hash}`);
      await p.waitForLoadState("networkidle").catch(() => {});
      await p.waitForTimeout(2500);
      await h.mark(id, p.locator("main").first());
      log.push(`  tx: ${hash}`);
    },
  };
  let error = null;
  try { await fn(h); } catch (e) { error = e; console.error(`✗ ${name}: ${redact(e.message.split("\n")[0])}`); await p.waitForTimeout(1500); }
  const files = [p, ...popups.map((x) => x.page)].map((pg) => pg.video());
  await ctx.close(); await browser?.close();
  fs.mkdirSync(OUT, { recursive: true });
  const main = path.join(OUT, `${name}.webm`);
  fs.renameSync(await files[0].path(), main);
  const pops = [];
  for (const [i, v] of files.slice(1).entries()) {
    const f = `${name}.p${i + 1}.webm`;
    fs.renameSync(await v.path(), path.join(OUT, f));
    pops.push({ file: f, start: popups[i].start, end: popups[i].end ?? now(), size: popups[i].size ?? [400, 700], url: popups[i].url, wallet: /intear/.test(popups[i].url ?? "") }); // the wallet's window, top-left of its video
  }
  fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify({ scale: SCALE, recorded: new Date().toISOString(), error: error && redact(error.message.split("\n")[0]), marks, popups: pops, log }, null, 1));
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`${error ? "✗" : "✓"} ${main} (${(fs.statSync(main).size / 1e6).toFixed(1)} MB, ${pops.length} wallet popup${pops.length === 1 ? "" : "s"})`);
  for (const l of log) console.log("   ", l);
}

const tokenPage = async (h, id = TOKEN, base = "pusaka") => {
  await h.p.goto(`${URL}/${base === "v2" ? "" : Q}#/${base}/${id}`);
  await h.p.getByText(base === "v2" ? "Its own account" : "Bitcoin inside, verified on NEAR").first().waitFor({ timeout: 60_000 });
  await h.pause(2500);
};
const section = (p, heading) => p.locator("section, form").filter({ has: p.getByRole("heading", { name: heading, exact: true }) }).first();

const scenes = {
  // The home page: the gallery and the total verified on NEAR.
  landing: async (h) => {
    const { p } = h;
    await p.goto(`${URL}/#/`);
    const total = p.getByText(/verified on NEAR across/).first();
    await total.waitFor({ timeout: 60_000 });
    await h.pause(1500);
    await h.mark("hero", p.locator("h1").first());
    await h.pause(2500);
    await h.scrollTo(total); await h.move(total); await h.mark("total", total);
    await h.pause(3500);
    await p.evaluate(() => scrollTo({ top: 0, behavior: "smooth" })); await h.pause(1200);
    await h.click("market", p.getByRole("link", { name: "Open the market" }).or(p.getByRole("button", { name: "Open the market" })).first());
    await p.locator("section.gallery .piece").first().waitFor({ timeout: 60_000 });
    await h.pause(2500);
    await h.mark("stats", p.locator("dl.market-stats"));
    await h.pause(2500);
    await h.scrollTo(p.locator("section.gallery .piece").first());
    await h.mark("gallery", p.locator("section.gallery .piece").first());
    await h.pause(4000);
  },
  // One Pusaka: proven sats, its tb1 address, the proof trail.
  token: async (h) => {
    const { p } = h;
    await tokenPage(h);
    await h.mark("amount", p.getByText(/^\d\.\d{8} BTC$/).first());
    await h.pause(3000);
    const addr = p.getByText(/^tb1q[0-9a-z]{30,}$/).first();
    await h.move(addr); await h.mark("address", addr);
    await h.pause(3500);
    const proof = section(p, "Proof trail");
    await h.scrollTo(proof);
    await h.mark("proof", proof);
    await h.pause(5500);
  },
  // Connect a wallet and buy the Pusaka in one NEAR transaction, then the transaction on the explorer.
  buy: async (h) => {
    const { p } = h;
    await tokenPage(h);
    await h.mark("start");
    await h.connect(BUYER);
    const buy = p.locator("section.actions").getByRole("button", { name: /^Buy for/ });
    await buy.waitFor({ timeout: 60_000 });
    await h.scrollTo(buy);
    await h.mark("price", buy);
    await h.pause(1500);
    const since = Date.now();
    await h.approve("buy", buy);
    await h.status("owned", p.locator("section.actions"), /You own|./);
    await h.pause(2500);
    await p.evaluate(() => scrollTo({ top: 0, behavior: "smooth" })); await h.pause(1500);
    await h.mark("owner", p.getByText(/^Owned by/).first());
    await h.pause(3500);
    await h.explorer("explorer", await h.lastTx(BUYER, since));
    await h.pause(5000);
  },
  // Withdraw BTC: the contract builds the tx, NEAR MPC signs it, the page broadcasts it; then mempool.space.
  withdraw: async (h) => {
    const { p } = h;
    await tokenPage(h);
    await h.connect(BUYER);
    // the form itself: section() would match the whole holder panel that contains it
    const form = p.locator("form").filter({ has: p.getByRole("heading", { name: "Withdraw", exact: true }) }).first();
    await h.scrollTo(form);
    await h.mark("form", form);
    await h.type("to", form.locator("input").first(), WITHDRAW_TO);
    await h.type("amount", form.locator("input[type=number]").first(), "0.00003");
    await h.pause(800);
    await h.approve("withdraw", form.getByRole("button", { name: "Withdraw" }));
    await h.mark("signing", form.getByRole("button").first());
    const st = await h.status("sent", form.locator(".."), /Sent|rror|fail/i, 300_000);
    await h.pause(2500);
    const link = st.getByRole("link", { name: /Bitcoin transaction/ });
    if (await link.count()) {
      await h.move(link); await h.mark("open-btc", link);
      // mempool.space doesn't answer from the recording machine; Blockstream shows the same Bitcoin tx
      await p.goto((await link.getAttribute("href")).replace("https://mempool.space/testnet/", "https://blockstream.info/testnet/"));
      await p.waitForLoadState("networkidle").catch(() => {});
      await h.pause(3000);
      await h.mark("mempool", p.locator("body"));
      await h.pause(6000);
    }
  },
  // Real transactions the contracts refused, then one of them on the explorer.
  refused: async (h) => {
    const { p } = h;
    await p.goto(`${URL}/#/refused`);
    await p.locator("ol.refused li").first().waitFor({ timeout: 60_000 });
    await p.getByText(/Refused:/).first().waitFor({ timeout: 90_000 });
    await h.pause(1500);
    await h.mark("list", p.locator("ol.refused").first());
    await h.pause(2000);
    const first = p.locator("ol.refused li").first();
    await h.move(first); await h.mark("first", first);
    await h.pause(3500);
    for (let i = 0; i < 5; i++) { await p.mouse.wheel(0, 380); await h.pause(1300); }
    const a = p.locator("ol.refused a[href*='near.rocks/tx']").first();
    await h.scrollTo(a);
    await h.move(a); await h.mark("open", a);
    await h.pause(1200);
    const href = await a.getAttribute("href");
    await p.goto(href);
    await p.waitForLoadState("networkidle").catch(() => {});
    await h.pause(2500);
    await h.mark("explorer", p.locator("main").first());
    await h.pause(6000);
  },
  // "Check it yourself": the browser asks NEAR, its MPC signer, its light client and Bitcoin.
  check: async (h) => {
    const { p } = h;
    await tokenPage(h);
    const b = p.getByRole("button", { name: "Check it yourself" });
    await h.scrollTo(b);
    await h.click("click", b);
    const done = p.getByText(/checks passed|check\(s\) failed/).first();
    await done.waitFor({ timeout: 180_000 });
    await h.pause(800);
    await h.mark("done", done);
    await h.scrollTo(done);
    await h.mark("list", done.locator("..").locator(".."));
    await h.pause(5000);
  },
  // Borrow with no NEAR: take a lender's standing offer gas-free (relayer pays), then repay it.
  loan: async (h) => {
    const { p } = h;
    await tokenPage(h);
    await h.connect(BUYER);
    const offer = p.locator("p").filter({ has: p.getByRole("button", { name: "Accept offer" }) }).first();
    await h.scrollTo(offer); await h.mark("offer", offer); await h.pause(2500);
    await h.approve("accept", offer.getByRole("button", { name: "Accept offer" }));
    const actions = p.locator("section.actions");
    await h.status("taken", actions, /Loan taken|rror|fail/i);
    await h.pause(4000);
  },
  // ...and the borrower repays: the Pusaka unlocks.
  repay: async (h) => {
    const { p } = h;
    await tokenPage(h);
    await h.connect(BUYER);
    const actions = p.locator("section.actions");
    const repay = actions.getByRole("button", { name: /^Repay [\d.]+ NEAR$/ }).first();
    await repay.waitFor({ timeout: 90_000 });
    await h.scrollTo(actions.getByRole("heading", { name: "Loan" })); await h.pause(500);
    await h.markBlock("locked", actions.getByRole("heading", { name: "Loan" })); await h.pause(3000);
    await h.approve("repay", repay);
    await h.status("repaid", actions, /repaid|rror|fail/i);
    await h.pause(3500);
  },
  // Inheritance: name an heir with a 10-minute silence, then check in ("I'm still here").
  heir: async (h) => {
    const { p } = h;
    await tokenPage(h, HEIR_TOKEN);
    await h.connect(BUYER);
    const sec = section(p, "Heir");
    await h.scrollTo(sec); await h.mark("section", sec); await h.pause(1500);
    await h.type("heir-to", sec.locator("input").first(), HEIR);
    await h.type("after", sec.locator("input").nth(1), "0.007");
    await h.pause(600);
    await h.approve("name", sec.getByRole("button", { name: "Name heir" }));
    await h.status("named", sec, /./);
    await h.pause(1500);
    await h.mark("will", sec.locator("p").first()); await h.pause(4000);
    await h.pause(62_000); // the relayer pays for a check-in once per tenth of the silence (1 min here)
    await h.mark("later");
    await h.maybeApprove("still", sec.getByRole("button", { name: "I'm still here" }));
    await h.status("checked", sec, /Checked in|rror|fail/i);
    await h.pause(1500);
    await h.mark("will2", sec.locator("p").first()); await h.pause(4000);
  },
  // After the holder's silence, the heir connects and claims (gas-free).
  claim: async (h) => {
    const { p } = h;
    await tokenPage(h, HEIR_TOKEN);
    await h.mark("owner-before", p.getByText(/^Owned by/).first());
    await h.connect(HEIR);
    const sec = section(p, "Heir");
    await h.scrollTo(sec); await h.mark("section", sec); await h.pause(2500);
    await h.maybeApprove("claim", sec.getByRole("button", { name: "Claim inheritance" }));
    await h.status("claimed", sec, /yours|rror|fail/i);
    await h.pause(2500);
    await p.evaluate(() => scrollTo({ top: 0, behavior: "smooth" })); await h.pause(1500);
    await h.mark("owner", p.getByText(/^Owned by/).first()); await h.pause(4000);
  },
  // The holder room: a letter sealed with a key NEAR MPC derives for this Pusaka (CKD), readable by the holder only.
  letter: async (h) => {
    const { p } = h;
    await tokenPage(h);
    await h.connect(BUYER);
    const sec = section(p, "Holder room");
    await h.scrollTo(sec); await h.mark("section", sec); await h.pause(2000);
    await h.maybeApprove("open", sec.getByRole("button").first());
    const area = sec.locator("textarea");
    await area.waitFor({ timeout: 120_000 });
    await h.pause(1500);
    await h.type("write", area, `To whoever holds Pusaka #${TOKEN} next: the Bitcoin inside is yours now. Keep it safe.`);
    await h.maybeApprove("seal", sec.getByRole("button", { name: "Seal into this Pusaka" }));
    await h.status("sealed", sec, /./, 240_000);
    await h.pause(2500);
    await p.reload(); await tokenPage(h);
    await h.scrollTo(sec); await h.pause(1000);
    await h.maybeApprove("reopen", sec.getByRole("button").first());
    await sec.getByText(/To whoever holds/).first().waitFor({ timeout: 180_000 });
    await h.pause(1000);
    await h.mark("letter", sec.getByText(/To whoever holds/).first()); await h.pause(5000);
  },
  // A gift link: the holder makes it; the link (a one-time key) is saved to .keys/gifts/, never printed.
  gift: async (h) => {
    const { p } = h;
    await tokenPage(h, GIFT_TOKEN);
    await h.connect(GIFTER);
    const sec = section(p, "Gift it as a link");
    await h.scrollTo(sec); await h.mark("section", sec); await h.pause(2000);
    await h.approve("make", sec.getByRole("button", { name: "Make a gift link" }));
    const link = p.locator(".gift-link code").first();
    await link.waitFor({ timeout: 120_000 });
    await h.scrollTo(link); await h.pause(800);
    await h.mark("link", link);
    fs.mkdirSync(path.join(KEYS, "gifts"), { recursive: true });
    fs.writeFileSync(path.join(KEYS, "gifts", "video-gift.txt"), (await link.innerText()).trim());
    await h.pause(4000);
  },
  // ...and someone with no wallet opens it, picks a name, and gets a new NEAR account holding the Pusaka.
  "gift-claim": async (h) => {
    const { p } = h;
    await p.goto(fs.readFileSync(path.join(KEYS, "gifts", "video-gift.txt"), "utf8").trim());
    const intro = p.getByText(/sent you Pusaka #\d+/).first();
    await intro.waitFor({ timeout: 60_000 });
    await h.pause(1500);
    await h.mark("gift", intro); await h.pause(3000);
    const name = `pusaka-g${Date.now().toString(36)}`;
    await h.type("name", p.getByLabel(/Pick a name/), name);
    await h.click("create", p.getByRole("button", { name: "Create my account and claim" }));
    await h.status("claimed", p, /./, 120_000);
    const code = p.locator(".gift-link code").first();
    const key = (await code.innerText().catch(() => "")).trim();
    if (key.startsWith("ed25519:")) {
      fs.writeFileSync(path.join(KEYS, `${name}.testnet.json`), JSON.stringify({ account_id: `${name}.testnet`, private_key: key }));
      await h.mark("key", code); // redacted in the video
    }
    await h.pause(5000);
  },
  // Smart Pusaka (pusaka-v2.testnet): its own account, post-quantum lock, agent budget, rental, sale for BTC, vault, call.
  v2: async (h) => {
    const { p } = h;
    await tokenPage(h, V2_TOKEN, "v2");
    for (const [id, name] of [["account", "Its own account"], ["pq", "Post-quantum lock"], ["agent", "Agent budget"], ["btcsale", "For sale for Bitcoin"], ["rent", "Rented to"], ["vault", "Vault"], ["call", "Call option"], ["history", "History"]]) {
      const head = p.getByRole("heading", { name, exact: true }).first();
      if (!(await head.count())) continue;
      await h.scrollTo(head); await h.markBlock(id, head); await h.pause(3000);
    }
  },
  // As the holder of Smart Pusaka #7: sign in to a site as the NFT (EIP-4361), and prove its Bitcoin address (BIP-322).
  "v2-act": async (h) => {
    const { p } = h;
    await tokenPage(h, V2_TOKEN, "v2");
    await h.connect(V2_HOLDER);
    await tokenPage(h, V2_TOKEN, "v2");
    const signin = p.getByRole("button", { name: /^Sign in to .* as Smart Pusaka/ });
    await h.scrollTo(signin); await h.pause(1000);
    await h.approve("signin", signin);
    await h.status("signedin", p, /./);
    const siwe = p.locator("pre.siwe").first();
    if (await siwe.count()) { await h.scrollTo(siwe); await h.mark("siwe", siwe); }
    await h.pause(4000);
    const bip = p.getByRole("button", { name: "Sign a BIP-322 proof" });
    await h.scrollTo(bip); await h.pause(800);
    await h.approve("bip322", bip);
    await h.status("proof", p, /./);
    await h.pause(4000);
  },
  // Vault (F14) on a Smart Pusaka: the holder vaults it (1 min delay), its own action is refused (VaultLocked), it asks
  // for an unlock, and the recovery account claws it back during the delay.
  vault: async (h) => {
    const { p } = h;
    const below = (name) => p.getByRole("heading", { name, exact: true }).first().locator("xpath=following-sibling::*[1]");
    await tokenPage(h, VAULT_TOKEN, "v2");
    await h.connect(V2_OWNER);
    await tokenPage(h, VAULT_TOKEN, "v2");
    const vault = below("Vault");
    await h.scrollTo(vault); await h.mark("form", vault); await h.pause(1500);
    await h.type("recovery", vault.locator("input").first(), VAULT_RECOVERY);
    await h.type("delay", vault.locator("input[type=number]").first(), "1");
    await h.pause(600);
    await h.approve("vault", vault.getByRole("button", { name: "Put it in a vault" }));
    await h.status("vaulted", below("Vault"), /vault|rror|fail/i);
    await h.pause(1500);
    await h.mark("locked", below("Vault").locator("p").first()); await h.pause(3000);
    // the holder's own key tries an owner action at once (what a thief would do): refused on-chain
    const send = p.locator("form").filter({ has: p.getByRole("heading", { name: "Send NEAR from its account" }) }).first();
    await h.scrollTo(send); await h.mark("send-form", send);
    await h.type("send-to", send.locator("input").first(), VAULT_RECOVERY);
    await h.approve("send", send.getByRole("button", { name: "Send" }));
    await h.status("refused", p.locator(".v2 div.actions").first(), /VaultLocked|Sent|rror|fail/i);
    await h.pause(4000);
    await h.scrollTo(below("Vault")); await h.pause(500);
    await h.approve("unlock", below("Vault").getByRole("button", { name: "Request an unlock" }));
    await h.status("unlocking", below("Vault"), /Unlock requested|rror|fail/i);
    await h.pause(1000);
    await h.mark("pending", below("Vault").locator("p").first()); await h.pause(3500);
    // the recovery account, within the minute
    await h.connect(VAULT_RECOVERY);
    await tokenPage(h, VAULT_TOKEN, "v2");
    await h.scrollTo(below("Vault")); await h.pause(800);
    await h.approve("claw", below("Vault").getByRole("button", { name: "Claw it back to me" }));
    await h.status("clawed", below("Vault"), /Clawed|rror|fail/i);
    await h.pause(1500);
    await p.evaluate(() => scrollTo({ top: 0, behavior: "smooth" })); await h.pause(1500);
    await h.mark("owner", p.getByText(/^Held by/).first()); await h.pause(4000);
  },
  // Covered call (F15/F16) whose strike is paid in Bitcoin: the holder offers it, another account buys it and reserves a
  // Bitcoin exercise (the OP_RETURN to pay with); then a payment proven earlier on #5, on NEAR and on Bitcoin.
  call: async (h) => {
    const { p } = h;
    const below = (name) => p.getByRole("heading", { name, exact: true }).first().locator("xpath=following-sibling::*[1]");
    await tokenPage(h, CALL_TOKEN, "v2");
    await h.connect(V2_OWNER);
    await tokenPage(h, CALL_TOKEN, "v2");
    const call = below("Call option");
    await h.scrollTo(call); await h.mark("form", call); await h.pause(1500);
    await h.click("inbtc", call.locator("input[type=checkbox]").first());
    await h.pause(1200);
    await h.mark("btc-form", call);
    await h.type("sats", call.locator("input[type=number]").first(), "10000");
    await h.type("payto", call.locator("input:not([type])").first(), CALL_PAY_TO);
    await h.type("premium", call.locator("input[type=number]").nth(1), "0.01");
    await h.type("days", call.locator("input[type=number]").nth(2), "1");
    await h.pause(600);
    await h.approve("write", call.getByRole("button", { name: "Offer a call option" }));
    await h.status("written", below("Call option"), /offered|rror|fail/i);
    await h.pause(1500);
    await h.mark("offer", below("Call option").locator("p").first()); await h.pause(3000);
    await h.connect(CALL_BUYER);
    await tokenPage(h, CALL_TOKEN, "v2");
    await h.scrollTo(below("Call option")); await h.pause(800);
    await h.approve("buy", below("Call option").getByRole("button", { name: /^Buy the option/ }));
    await h.status("bought", below("Call option"), /yours|rror|fail/i);
    await h.pause(2000);
    await h.approve("reserve", below("Call option").getByRole("button", { name: /^Exercise: pay/ }));
    await h.status("reserved", below("Call option"), /Reserved|rror|fail/i);
    const pay = below("Call option").locator("p").filter({ hasText: "OP_RETURN" }).first();
    await pay.waitFor({ timeout: 60_000 });
    await h.scrollTo(pay); await h.mark("opreturn", pay); await h.pause(6000);
    // the same flow, paid and proven by script on Smart Pusaka #5
    await h.explorer("proof", CALL_PROOF_TX); await h.pause(5000);
    await p.goto(`https://blockstream.info/testnet/tx/${CALL_BTC_TX}`);
    await p.waitForLoadState("networkidle").catch(() => {});
    await h.pause(3000);
    await h.mark("btc", p.locator("body")); await h.pause(5000);
  },
  // The second market contract: standing bids per verified sat, buy pools, perpetual loans.
  bids: async (h) => {
    const { p } = h;
    await p.goto(`${URL}/#/bids`);
    await p.getByRole("heading", { name: "Standing bids" }).waitFor({ timeout: 60_000 });
    await h.pause(3000);
    for (const [id, name] of [["bids", "Standing bids"], ["offers", "Loan offers"], ["loans", "Open loans"]]) {
      const head = p.getByRole("heading", { name, exact: true }).first();
      if (!(await head.count())) continue;
      await h.scrollTo(head); await h.markBlock(id, head); await h.pause(3500);
    }
  },
  // For AI agents: the MCP tools, then the x402-paid audit endpoint answering 402 Payment Required.
  agents: async (h) => {
    const { p } = h;
    await p.goto(`${URL}/#/agents`);
    const tools = p.getByRole("heading", { name: /tools on this endpoint/ });
    await tools.waitFor({ timeout: 60_000 });
    await h.pause(2500);
    await h.mark("top", p.locator("h1").first()); await h.pause(3000);
    await h.scrollTo(tools); await h.markBlock("tools", tools); await h.pause(4000);
    // what an agent's HTTP client gets: 402 and the payment terms in the PAYMENT-REQUIRED header (shown decoded, as read)
    await p.evaluate(async (u) => {
      const r = await fetch(u);
      const terms = JSON.parse(atob(r.headers.get("payment-required")));
      const pre = document.createElement("pre");
      pre.textContent = `$ GET ${u}

HTTP ${r.status} Payment Required
PAYMENT-REQUIRED (base64 JSON, decoded):
${JSON.stringify(terms, null, 2)}`;
      pre.style.cssText = "font:20px/1.45 Consolas,monospace;padding:36px 48px;margin:0;white-space:pre-wrap;background:#0f1115;color:#e6e6e6;min-height:100vh";
      document.body.replaceChildren(pre); scrollTo(0, 0);
    }, `${URL}/api/audit?token_id=${TOKEN}`);
    await h.pause(1500);
    await h.mark("x402", p.locator("pre")); await h.pause(6000);
  },
  // No wallet: a passkey (WebAuthn PRF, here a virtual authenticator) becomes a NEAR account.
  passkey: async (h) => {
    const { p, ctx } = h;
    const cdp = await ctx.newCDPSession(p);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true } });
    await p.goto(`${URL}/#/`);
    await p.locator("h1").first().waitFor({ timeout: 60_000 });
    await h.pause(2500);
    await h.click("passkey", p.getByRole("button", { name: "Use a passkey" }));
    await h.status("account", p, /passkey|account/i, 60_000);
    await h.pause(2000);
    await h.mark("header", p.locator("header")); await h.pause(4000);
  },
  // The same MPC keys: ETH/USDC on EVM chains, SOL, its own NEAR account; everything moves with the NFT.
  // A Smart Pusaka's nBTC: counted as Bitcoin inside, its own Omni deposit address, and the live redeem to native BTC.
  nbtc: async (h) => {
    const { p } = h;
    await p.goto(`${URL}/#/pusaka/4`);
    const li = p.getByText(/sats of nBTC \(Omni Bridge\) in its account/).first();
    await li.waitFor({ timeout: 60_000 });
    await h.pause(1500);
    await h.scrollTo(li); await h.move(li); await h.mark("inside", li);
    await h.pause(4000);
    const dep = p.getByText(/^To add nBTC: send native BTC/).first();
    await h.scrollTo(dep); await h.mark("deposit", dep);
    await h.pause(4000);
    await p.goto("https://testnet.near.rocks/tx/3fh6naremmRQhwQciDiWWSUtPKDADcWDicRTHAdpK64y");
    await p.waitForLoadState("networkidle").catch(() => {});
    await h.pause(2500);
    await h.mark("redeem", p.locator("main").first());
    await h.pause(6000);
  },
  // Deposits proven by Pusaka's Shade Agent in a TEE: the badge in the proof trail of classic #1.
  tee: async (h) => {
    const { p } = h;
    await p.goto(`${URL}/?contract=pusaka-btc.testnet#/pusaka/1`);
    const badge = p.getByText(/Proven by Pusaka's attested TEE agent/).first();
    await badge.waitFor({ timeout: 90_000 });
    await h.pause(1500);
    await h.scrollTo(badge); await h.move(badge); await h.mark("badge", badge);
    await h.pause(5000);
  },
  // An exchange checks a Pusaka's BIP-322 proof of its Bitcoin address (made live by scripts/holderproof-live.mjs, PROOF_OUT).
  verify: async (h) => {
    const { p } = h;
    const proof = JSON.parse(fs.readFileSync(process.env.CLIP_PROOF ?? path.join(os.tmpdir(), "bip322.json"), "utf8"));
    await p.goto(`${URL}/#/verify`);
    const msg = p.getByLabel("Signed message");
    await msg.waitFor({ timeout: 60_000 });
    await h.pause(1500);
    await h.click("message", msg); await msg.fill(proof.message);
    await h.pause(1200);
    const w = p.getByLabel(/BIP-322 witness/);
    await h.click("witness", w); await w.fill(proof.witness);
    await h.pause(800);
    await h.click("check", p.getByRole("button", { name: "Verify" }));
    const ok = p.getByText(/✓ Valid/).first();
    await ok.waitFor({ timeout: 60_000 });
    await h.pause(600);
    await h.mark("valid", ok.locator("..").locator(".."));
    await h.scrollTo(ok);
    await h.pause(6000);
  },
  // Proof of reserves across both contracts, with nBTC listed apart.
  reserves: async (h) => {
    const { p } = h;
    await p.goto(`${URL}/#/reserves`);
    const total = p.getByText(/sats/).first();
    await total.waitFor({ timeout: 90_000 });
    await h.pause(3000);
    await h.mark("total", p.locator("main h1").first());
    await h.pause(3000);
    for (let i = 0; i < 4; i++) { await p.mouse.wheel(0, 380); await h.pause(1300); }
    await h.mark("rows", p.locator("main").first());
    await h.pause(3000);
  },
  // A buyer's view of a listed classic Pusaka: Clean to buy, then the two ways to borrow (NEAR from a person, pUSD from the pool).
  lend: async (h) => {
    const { p } = h;
    await p.goto(`${URL}/?contract=pusaka-btc.testnet#/pusaka/27`);
    const clean = p.locator("details.clean summary");
    await clean.waitFor({ timeout: 90_000 });
    await p.getByText(/✓ Clean to buy/).first().waitFor({ timeout: 90_000 }).catch(() => {});
    await h.pause(1200);
    await h.scrollTo(clean);
    await h.click("clean", clean);
    await h.pause(800);
    await h.mark("checks", p.locator("details.clean"));
    await h.pause(5000);
    const lend = p.locator("section.lend");
    await lend.waitFor({ timeout: 60_000 });
    await h.scrollTo(lend);
    await h.mark("lend", lend);
    await h.pause(4000);
    await h.mark("price", lend.locator("p.stats"));
    await h.pause(4000);
  },
  // The USDC pool, with real clicks: the holder borrows Circle USDC against the Pusaka from its page.
  "lend-borrow": async (h) => {
    const { p } = h;
    await tokenPage(h);
    await h.connect(BUYER);
    await tokenPage(h);
    const sec = p.locator("section.lend");
    await sec.waitFor({ timeout: 60_000 });
    await h.scrollTo(sec); await h.mark("pool", sec); await h.pause(3000);
    await h.mark("price", sec.locator("p.stats")); await h.pause(2500);
    await h.type("amount", sec.locator("input").first(), process.env.CLIP_BORROW ?? "1");
    await h.pause(600);
    await h.approve("borrow", sec.getByRole("button", { name: /^Borrow (USDC|pUSD)$/ }));
    await h.status("borrowed", sec, /Borrowed|refused|rror|fail/i, 240_000);
    await h.pause(2500);
    await tokenPage(h);
    const after = p.locator("section.lend");
    await h.scrollTo(after); await h.mark("collateral", after); await h.pause(5000);
  },
  // ...and repays it: the pool sends the NFT back.
  "lend-repay": async (h) => {
    const { p } = h;
    await tokenPage(h);
    await h.connect(BUYER);
    await tokenPage(h);
    const sec = p.locator("section.lend");
    const repay = sec.getByRole("button", { name: /^Repay / });
    await repay.waitFor({ timeout: 90_000 });
    await h.scrollTo(sec); await h.mark("loan", sec); await h.pause(3000);
    await h.approve("repay", repay);
    await h.status("repaid", sec, /Repaid|rror|fail/i, 240_000);
    await h.pause(2500);
    await p.evaluate(() => scrollTo({ top: 0, behavior: "smooth" })); await h.pause(1500);
    await h.mark("owner", p.getByText(/^Owned by/).first()); await h.pause(4000);
  },
  // A liquidation from the page, on the reporters' real price: anyone can, once the loan reaches 80%.
  liquidate: async (h) => {
    const { p } = h;
    const open = async () => { await p.goto(`${URL}/#/pusaka/${LIQ_TOKEN}`); await p.getByText("Bitcoin inside, verified on NEAR").first().waitFor({ timeout: 60_000 }); await h.pause(2000); };
    await open();
    await h.connect(LIQUIDATOR);
    await open();
    const sec = p.locator("section.lend");
    await sec.waitFor({ timeout: 60_000 });
    await h.scrollTo(sec); await h.mark("loan", sec); await h.pause(4000);
    await h.approve("liquidate", sec.getByRole("button", { name: "Liquidate" }));
    await h.status("liquidated", sec, /Liquidated|rror|fail/i, 240_000);
    await h.pause(2500);
    await p.evaluate(() => scrollTo({ top: 0, behavior: "smooth" })); await h.pause(1500);
    await h.mark("owner", p.getByText(/^Owned by/).first()); await h.pause(4000);
  },
  chains: async (h) => {
    const { p } = h;
    await tokenPage(h);
    for (const [id, name] of [["eth", "Ether and USDC inside"], ["sol", /^SOL inside/], ["near", "Its own NEAR account"], ["nbtc", "nBTC on NEAR"]]) {
      const head = p.getByRole("heading", { name }).first();
      if (!(await head.waitFor({ timeout: 20_000 }).then(() => true, () => false))) continue;
      await h.scrollTo(head); await h.markBlock(id, head); await h.pause(3000);
    }
  },
};

const WALLET_SCENES = ["buy", "withdraw", "loan", "repay", "heir", "claim", "letter", "gift", "v2-act", "vault", "call", "lend-borrow", "lend-repay", "liquidate"];
const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "import") { // add an account from .keys/<id>.json to the recorder's Intear profile (key typed, never printed)
  const k = JSON.parse(fs.readFileSync(rest[0], "utf8"));
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless: true, viewport: { width: 1200, height: 900 } });
  const p = ctx.pages()[0] ?? await ctx.newPage();
  await p.goto("https://wallet.intear.tech/"); await p.waitForTimeout(6000);
  const fresh = await p.getByRole("button", { name: "I already have a NEAR wallet" }).isVisible().catch(() => false);
  if (fresh) await p.getByRole("button", { name: "I already have a NEAR wallet" }).click();
  else { // add to the existing wallet: account switcher -> Add -> Log in with Existing Account
    await p.getByRole("button", { name: "Add", exact: true }).click().catch(async () => { await p.mouse.click(338, 68); await p.waitForTimeout(1500); await p.getByRole("button", { name: "Add", exact: true }).click(); });
    await p.waitForTimeout(2500);
    await p.getByRole("button", { name: "Log in with Existing Account" }).click();
  }
  await p.waitForTimeout(1500);
  await p.locator("text=Private Key").last().click(); await p.waitForTimeout(1200);
  // Intear only looks the key up once its terms are accepted, so accept first, then type the key
  for (const cb of await p.locator("input[type=checkbox]").all()) if (!(await cb.isChecked())) await cb.evaluate((e) => e.click());
  await p.locator("input[type=text]:visible").first().fill(k.private_key);
  await p.getByText(k.account_id, { exact: true }).first().click({ timeout: 60_000 });
  await p.getByRole("button", { name: /^Import/ }).last().click();
  await p.waitForTimeout(6000);
  console.log("wallet now shows:", redact((await p.innerText("body")).replace(/\s+/g, " ").slice(0, 160)));
  await ctx.close();
} else if (!cmd) console.log(`scenes: ${Object.keys(scenes).join(" ")}\nwallet profile: ${PROFILE}`);
else for (const name of [cmd, ...rest]) {
  if (!scenes[name]) { console.error(`no scene ${name}; scenes: ${Object.keys(scenes).join(" ")}`); continue; }
  await record(name, scenes[name], { wallet: WALLET_SCENES.includes(name) });
}
