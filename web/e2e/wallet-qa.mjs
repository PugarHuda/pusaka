// Real-wallet QA: drives the live app with Intear Wallet (a web wallet, no extension) in a persistent
// Chromium profile. Keys are read from .keys/ and typed into the wallet, never printed (redacted).
//   node wallet-qa.mjs <profileDir> import-form <.keys/holder.json>   import the holder (pusaka-buyer)
//   node wallet-qa.mjs <profileDir> connect                           connect it to the app (Pusaka #2)
//   node wallet-qa.mjs <profileDir> heir                              name heir, free + paid check-in, remove
//   node wallet-qa.mjs <profileDir> add-form <.keys/heir.json>        add the heir (pusaka-seller)
//   node wallet-qa.mjs <profileDir> claim                             reconnect as the heir and claim, once due
//   node wallet-qa.mjs <profileDir> judge <buyId> <lendId>            the README's try-it path: Buy one, Lend on another
//   node wallet-qa.mjs <profileDir> offer <account> <id>              post a standing loan offer through the form, then cancel it
import fs from "node:fs";
import { chromium } from "playwright";
const [profile, step, keyFile, arg2] = process.argv.slice(2);
const redact = (s) => s.replace(/ed25519:\w+/g, "[key]");
const dump = (p) => p.evaluate(() => [...document.querySelectorAll("input,textarea,button,label,h1,h2,h3,p,[role=dialog]")]
  .filter((e) => e.offsetParent).map((e) => `${e.tagName}|${(e.placeholder || e.innerText || e.type || "").slice(0, 120)}${e.disabled ? " [disabled]" : ""}`).join("\n"));
const ctx = await chromium.launchPersistentContext(profile, { headless: true, viewport: { width: 1200, height: 900 } });
const p = ctx.pages()[0] ?? await ctx.newPage();
// Some networks can't reach the Bitcoin explorers from a browser (ISP blocks); Node can. Same requests, real answers.
if (process.env.QA_PROXY_BTC) await ctx.route((u) => ["mempool.space", "blockstream.info"].includes(u.hostname), async (route) => {
  const r = route.request();
  try {
    const res = await fetch(r.url(), { method: r.method(), body: r.postData() ?? undefined, signal: AbortSignal.timeout(20_000) });
    await route.fulfill({ status: res.status, headers: { "access-control-allow-origin": "*", "content-type": res.headers.get("content-type") ?? "text/plain" }, body: Buffer.from(await res.arrayBuffer()) });
  } catch { await route.abort(); }
});
try {
  if (step === "import-form") {
    await p.goto("https://wallet.intear.tech/");
    await p.getByRole("button", { name: "I already have a NEAR wallet" }).click();
    await p.locator("text=Private Key").click();
    await p.locator("input[type=text]:visible").first().fill(JSON.parse(fs.readFileSync(keyFile, "utf8")).private_key);
    for (const cb of await p.locator("input[type=checkbox]:visible").all()) await cb.check();
    await p.waitForTimeout(4000);
    await p.getByRole("button", { name: /pusaka-buyer\.testnet/ }).click();
    await p.getByRole("button", { name: "Import Account" }).click();
    await p.waitForTimeout(6000);
  }
  if (step === "connect") {
    await p.goto("https://pusaka-two.vercel.app/#/pusaka/2");
    await p.waitForTimeout(5000);
    await p.getByRole("button", { name: /connect/i }).first().click();
    await p.waitForTimeout(4000);
    await p.screenshot({ path: `${profile}-picker.png` });
    for (const fr of p.frames()) console.log("FRAME", fr.url().slice(0, 120));
    console.log("SHADOW", await p.evaluate(() => [...document.querySelectorAll("*")].filter((e) => e.shadowRoot).map((e) => e.tagName + ":" + e.shadowRoot.textContent.slice(0, 300)).join(" || ")));
    const popup = ctx.waitForEvent("page", { timeout: 30_000 }).catch(() => null);
    await p.getByText("Intear Wallet", { exact: true }).click();
    await p.waitForTimeout(2000);
    const pop2 = ctx.waitForEvent("page", { timeout: 30_000 }).catch(() => null);
    let clicked = false;
    for (const fr of p.frames()) { const b = fr.getByText("Web", { exact: true }); if (await b.count()) { await b.first().click(); clicked = true; break; } }
    console.log("clicked Web:", clicked, p.frames().length);
    const w = (await popup) ?? (await pop2);
    if (w) {
      await w.waitForLoadState(); await w.waitForTimeout(5000);
      console.log("POPUP", w.url().slice(0, 80)); console.log(redact(await dump(w)));
      await w.screenshot({ path: `${profile}-popup.png` });
      await w.getByRole("button", { name: "Connect", exact: true }).click();
      await p.waitForTimeout(6000);
      console.log("HEADER:", await p.locator("header").innerText().catch(() => "?"));
    }
    await p.waitForTimeout(3000);
    console.log("PAGE:", redact(await p.evaluate(() => document.body.innerText.slice(-600))));
  }
  if (step === "add-form") {
    await p.goto("https://wallet.intear.tech/");
    await p.waitForTimeout(4000);
    await p.screenshot({ path: `${profile}-wallet.png` });
    await p.mouse.click(338, 68); // account switcher (people icon)
    await p.waitForTimeout(1500);
    await p.screenshot({ path: `${profile}-switcher.png` });
    await p.getByRole("button", { name: "Add", exact: true }).click();
    await p.waitForTimeout(3000);
    await p.getByRole("button", { name: "Log in with Existing Account" }).click();
    await p.waitForTimeout(1500);
    if (keyFile) {
      await p.locator("text=Private Key").last().click();
      await p.locator("input[type=text]:visible").first().fill(JSON.parse(fs.readFileSync(keyFile, "utf8")).private_key);
      await p.waitForTimeout(4000);
      await p.getByRole("button", { name: /pusaka-seller.testnet/ }).last().click();
      for (const cb of await p.locator("input[type=checkbox]:visible").all()) await cb.check();
      await p.getByRole("button", { name: /^Import/ }).last().click();
      await p.waitForTimeout(6000);
    }
  }
  if (step === "claim") {
    const heirSection = () => p.locator("section", { has: p.getByRole("heading", { name: "Heir" }) });
    await p.goto("https://pusaka-two.vercel.app/#/pusaka/2");
    await heirSection().waitFor({ timeout: 30_000 });
    await p.waitForTimeout(4000);
    // switch the app to the heir's account: disconnect, connect again choosing pusaka-seller
    const acct = p.getByTitle("Disconnect wallet");
    if (await acct.count()) { await acct.click(); await p.waitForTimeout(2000); }
    await p.getByRole("button", { name: /connect/i }).first().click();
    await p.waitForTimeout(3000);
    await p.getByText("Intear Wallet", { exact: true }).click();
    await p.waitForTimeout(2000);
    const pop = ctx.waitForEvent("page", { timeout: 30_000 });
    for (const fr of p.frames()) { const b = fr.getByText("Web", { exact: true }); if (await b.count()) { await b.first().click(); break; } }
    const w = await pop;
    await w.waitForLoadState(); await w.waitForTimeout(4000);
    console.log("connect popup:", (await w.getByRole("button").allInnerTexts()).join(" / ").replace(/\s+/g, " ").slice(-200));
    await w.screenshot({ path: `${profile}-connect-as.png` });
    if (!(await w.getByText("pusaka-seller.testnet").count())) throw new Error("wallet doesn't offer pusaka-seller");
    await w.getByRole("button", { name: "Connect", exact: true }).click();
    await p.waitForTimeout(6000);
    console.log("HEADER:", (await p.locator("header").innerText()).replace(/\s+/g, " "));
    console.log("heir view ->", (await heirSection().innerText()).replace(/\s+/g, " ").slice(0, 300));
    const claim = heirSection().getByRole("button", { name: "Claim inheritance" });
    if (await claim.count()) {
      const wp = ctx.waitForEvent("page", { timeout: 20_000 }).catch(() => null);
      await claim.click();
      const w2 = await wp;
      if (w2) { await w2.waitForLoadState(); await w2.waitForTimeout(4000); await w2.getByRole("button", { name: /^(Approve|Confirm|Sign)/ }).first().click(); }
      for (let i = 0; i < 90 && !(await heirSection().getByRole("status").count()); i++) await p.waitForTimeout(1000);
      await p.waitForTimeout(4000);
      console.log("claim ->", (await heirSection().getByRole("status").allInnerTexts()).join(" "));
      console.log("owner line:", await p.getByText(/^Owned by/).innerText());
    }
  }
  if (step === "heir") {
    const heirSection = () => p.locator("section", { has: p.getByRole("heading", { name: "Heir" }) });
    const status = async () => (await heirSection().innerText()).replace(/\s+/g, " ").slice(0, 400);
    // a wallet action: click, approve whatever the wallet opens, then read the section's message
    const act = async (label, click) => {
      const prior = (await heirSection().getByRole("status").allInnerTexts()).join(" ");
      const pop = ctx.waitForEvent("page", { timeout: 20_000 }).catch(() => null);
      await click();
      const w = await pop;
      if (w) {
        await w.waitForLoadState(); await w.waitForTimeout(4000);
        const btn = w.getByRole("button", { name: /^(Confirm|Approve|Sign|Send|Continue)/ });
        console.log(`  [${label}] wallet: ${w.url().slice(0, 60)} buttons: ${(await w.getByRole("button").allInnerTexts()).join(" / ").slice(0, 200)}`);
        await btn.first().click();
      } else console.log(`  [${label}] no wallet popup`);
      const msg = async () => (await heirSection().getByRole("status").allInnerTexts()).join(" ");
      const before = prior;
      const settled = async () => { const m = await msg().catch(() => ""); return m && m !== before && !(await heirSection().locator("button:disabled").count()); };
      for (let i = 0; i < 90 && !(await settled()); i++) await p.waitForTimeout(1000);
      await p.waitForTimeout(3000);
      console.log(`${label} -> [${await msg()}]`, (await status()).slice(0, 140));
    };
    await p.goto("https://pusaka-two.vercel.app/#/pusaka/2");
    await heirSection().waitFor({ timeout: 30_000 });
    await p.waitForTimeout(4000);
    console.log("before ->", await status());
    await act("name heir", async () => {
      await heirSection().locator("input").first().fill("pusaka-seller.testnet");
      await heirSection().locator("input").nth(1).fill("0.007");
      await heirSection().getByRole("button", { name: "Name heir" }).click();
    });
    await p.waitForTimeout(65_000); // past the relayer's free check-in gap (a tenth of 10 min)
    await act("still here", () => heirSection().getByRole("button", { name: "I'm still here" }).click());
    await act("still here again (relayer quota used: holder pays)", () => heirSection().getByRole("button", { name: "I'm still here" }).click());
    await act("remove heir", () => heirSection().getByRole("button", { name: "Remove heir" }).click());
    const hist = await p.locator("ol.history").innerText();
    console.log("history:", hist.split("\n").filter((l) => /heir|still here/i.test(l)).slice(0, 5).join(" | "));
  }
  if (step === "repay") { // switch the app to the borrower (arg: account) and repay the loan on token arg2
    const [who, id] = [keyFile, arg2];
    await p.goto(`https://pusaka-two.vercel.app/#/pusaka/${id}`);
    await p.waitForTimeout(5000);
    const acct = p.getByTitle("Disconnect wallet");
    if (await acct.count()) { await acct.click(); await p.waitForTimeout(2000); }
    await p.getByRole("button", { name: /connect/i }).first().click();
    await p.waitForTimeout(3000);
    await p.getByText("Intear Wallet", { exact: true }).click();
    await p.waitForTimeout(2000);
    const pop = ctx.waitForEvent("page", { timeout: 30_000 });
    for (const fr of p.frames()) { const b = fr.getByText("Web", { exact: true }); if (await b.count()) { await b.first().click(); break; } }
    const w = await pop;
    await w.waitForLoadState(); await w.waitForTimeout(4000);
    await w.screenshot({ path: `${profile}-repay-connect.png` });
    console.log("connect popup:", (await w.getByRole("button").allInnerTexts()).join(" / ").replace(/\s+/g, " ").slice(0, 300));
    await w.getByText("Selected Account").click(); await w.waitForTimeout(1000); // open the account dropdown
    await w.getByText(who, { exact: true }).last().click();
    await w.waitForTimeout(1000);
    await w.getByRole("button", { name: "Connect", exact: true }).click();
    await p.waitForTimeout(6000);
    console.log("account:", (await p.locator("header").innerText()).replace(/\s+/g, " "));
    const actions = p.locator("section.actions");
    const btn = actions.getByRole("button", { name: /^Repay/ });
    await btn.waitFor({ timeout: 40_000 });
    const wp = ctx.waitForEvent("page", { timeout: 20_000 });
    const t0 = Date.now();
    await btn.click();
    const w2 = await wp; await w2.waitForLoadState(); await w2.waitForTimeout(4000);
    await w2.getByRole("button", { name: /^(Confirm|Approve|Sign|Send|Continue)/ }).first().click();
    for (let i = 0; i < 90 && !(await actions.getByRole("status").count()); i++) await p.waitForTimeout(1000);
    console.log(`repay #${id} -> [${(await actions.getByRole("status").allInnerTexts()).join(" ")}] in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    await p.waitForTimeout(3000);
    console.log("after:", (await actions.innerText()).replace(/\s+/g, " ").slice(0, 200));
  }
  if (step === "offer") { // as account keyFile, post a standing loan offer on token arg2 through the form, then cancel it
    const [who, id] = [keyFile, arg2];
    await p.goto(`https://pusaka-two.vercel.app/#/pusaka/${id}`);
    await p.waitForTimeout(5000);
    if (!(await p.locator("header").innerText()).includes(who)) {
      const acct = p.getByTitle("Disconnect wallet");
      if (await acct.count()) { await acct.click(); await p.waitForTimeout(2000); }
      await p.getByRole("button", { name: /connect/i }).first().click();
      await p.waitForTimeout(3000);
      await p.getByText("Intear Wallet", { exact: true }).click();
      await p.waitForTimeout(2000);
      const pop = ctx.waitForEvent("page", { timeout: 30_000 });
      for (const fr of p.frames()) { const b = fr.getByText("Web", { exact: true }); if (await b.count()) { await b.first().click(); break; } }
      const w = await pop;
      await w.waitForLoadState(); await w.waitForTimeout(4000);
      await w.getByText("Selected Account").click(); await w.waitForTimeout(1000);
      await w.getByText(who, { exact: true }).last().click();
      await w.waitForTimeout(1000);
      await w.getByRole("button", { name: "Connect", exact: true }).click();
      await p.waitForTimeout(6000);
    }
    console.log("account:", (await p.locator("header").innerText()).replace(/\s+/g, " "));
    const sign = async (label, click) => {
      const wp = ctx.waitForEvent("page", { timeout: 20_000 });
      const t0 = Date.now();
      await click();
      const w = await wp; await w.waitForLoadState(); await w.waitForTimeout(4000);
      console.log(`  [${label}] wallet: ${(await w.innerText("body")).replace(/\s+/g, " ").slice(0, 220)}`);
      await w.getByRole("button", { name: /^(Confirm|Approve|Sign|Send|Continue)/ }).first().click();
      const status = p.locator("section.actions").getByRole("status");
      for (let i = 0; i < 90 && !(await status.count()); i++) await p.waitForTimeout(1000);
      console.log(`${label} -> [${(await status.allInnerTexts()).join(" ")}] in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    };
    const form = p.locator("form").filter({ has: p.getByRole("heading", { name: /^Offer (a loan|to refinance)$/ }) });
    await form.waitFor({ timeout: 40_000 });
    const [lend, repay, days] = await form.locator("input").all();
    await lend.fill("0.01"); await repay.fill("0.0101"); await days.fill("1");
    await sign(`offer on #${id}`, () => form.getByRole("button", { name: "Offer a loan" }).click());
    await p.reload(); await p.waitForTimeout(6000);
    const mine = p.locator("p").filter({ hasText: who }).filter({ has: p.getByRole("button", { name: "Cancel my offer" }) });
    console.log("listed:", (await mine.first().innerText()).replace(/\s+/g, " "));
    await sign("cancel offer", () => mine.first().getByRole("button", { name: "Cancel my offer" }).click());
  }
  if (step === "judge") {
    const [buyId, lendId] = [keyFile, arg2];
    const actions = () => p.locator("section.actions");
    // click, approve in the wallet, then wait for the section's result message
    const act = async (label, button) => {
      await button.waitFor({ timeout: 40_000 });
      const pop = ctx.waitForEvent("page", { timeout: 20_000 }).catch(() => null);
      const t0 = Date.now();
      await button.click();
      const w = await pop;
      if (!w) throw new Error(`${label}: no wallet popup`);
      await w.waitForLoadState(); await w.waitForTimeout(4000);
      console.log(`  [${label}] wallet buttons: ${(await w.getByRole("button").allInnerTexts()).join(" / ").replace(/\s+/g, " ").slice(0, 200)}`);
      await w.getByRole("button", { name: /^(Confirm|Approve|Sign|Send|Continue)/ }).first().click();
      for (let i = 0; i < 90 && !(await actions().getByRole("status").count()); i++) await p.waitForTimeout(1000);
      console.log(`${label} -> [${(await actions().getByRole("status").allInnerTexts()).join(" ")}] in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    };
    await p.goto(`https://pusaka-two.vercel.app/#/pusaka/${buyId}`);
    await p.waitForTimeout(4000);
    console.log("account:", (await p.locator("header").innerText()).replace(/\s+/g, " "));
    await act(`buy #${buyId}`, actions().getByRole("button", { name: /^Buy for/ }));
    await p.waitForTimeout(3000);
    console.log("owner line:", await p.getByText(/^Owned by/).innerText().catch(() => "?"), "| actions:", (await actions().innerText()).replace(/\s+/g, " ").slice(0, 200));
    await p.goto(`https://pusaka-two.vercel.app/#/pusaka/${lendId}`);
    await p.waitForTimeout(5000);
    console.log("loan before:", (await actions().innerText()).replace(/\s+/g, " ").slice(0, 300));
    await act(`lend on #${lendId}`, actions().getByRole("button", { name: /^Lend/ }));
    await p.waitForTimeout(3000);
    console.log("loan after:", (await actions().innerText()).replace(/\s+/g, " ").slice(0, 300));
  }
  console.log(redact(await dump(p)).split("\n").slice(-3).join("\n"));
  await p.screenshot({ path: `${profile}-${step}.png` });
} finally { await ctx.close(); }
