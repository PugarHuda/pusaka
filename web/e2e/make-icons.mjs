// Renders the PWA icons from public/favicon.svg.  node web/e2e/make-icons.mjs
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
const pub = path.join(import.meta.dirname, "..", "public");
const svg = fs.readFileSync(path.join(pub, "favicon.svg"), "utf8");
const browser = await chromium.launch();
for (const [size, pad, name] of [[192, 0, "icon-192.png"], [512, 0, "icon-512.png"], [512, 0.1, "icon-maskable.png"]]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  const inner = Math.round(size * (1 - 2 * pad));
  await page.setContent(`<body style="margin:0;background:#14213d;display:grid;place-items:center;height:${size}px">${svg.replace("<svg ", `<svg width="${inner}" height="${inner}" `)}</body>`);
  await page.screenshot({ path: path.join(pub, name), omitBackground: pad === 0 });
  console.log(name);
}
await browser.close();
