// GET /api/og?id=4 -> a 1200x630 PNG share card for one Pusaka: the vessel the contract draws on-chain, the
// Bitcoin proven inside and its state. Used as og:image by /p/<id> (api/share.mjs), so a post on X shows it.
// The card is plain SVG rasterised by resvg, with Inter (OFL) shipped in api/fonts.
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { card, tokenId } from "./_card.mjs";

const FONT = path.join(import.meta.dirname, "fonts", "Inter.ttf");
const esc = (s) => String(s).replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function cardSvg(c) {
  const pill = 30 * 0.56 * c.status.length + 56;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1200" height="630" viewBox="0 0 1200 630">
<defs>
<radialGradient id="a" cx=".08" cy=".1" r=".55"><stop offset="0" stop-color="#9fd3f7"/><stop offset="1" stop-color="#9fd3f7" stop-opacity="0"/></radialGradient>
<radialGradient id="b" cx=".92" cy=".18" r=".5"><stop offset="0" stop-color="#d9c6fa"/><stop offset="1" stop-color="#d9c6fa" stop-opacity="0"/></radialGradient>
<radialGradient id="c" cx=".5" cy="1.1" r=".6"><stop offset="0" stop-color="#f8d6b0"/><stop offset="1" stop-color="#f8d6b0" stop-opacity="0"/></radialGradient>
<clipPath id="r"><rect x="72" y="95" width="440" height="440" rx="40"/></clipPath>
</defs>
<rect width="1200" height="630" fill="#eef0f8"/><rect width="1200" height="630" fill="url(#a)"/><rect width="1200" height="630" fill="url(#b)"/><rect width="1200" height="630" fill="url(#c)"/>
${c.image ? `<image x="72" y="95" width="440" height="440" clip-path="url(#r)" xlink:href="${c.image}" href="${c.image}"/>` : ""}
<g font-family="Inter" fill="#0d0d0a">
<text x="580" y="190" font-size="30" fill="#5f6064">Pusaka, an NFT that holds real Bitcoin</text>
<text x="576" y="290" font-size="92" font-weight="700" letter-spacing="-3">Pusaka #${esc(c.id)}</text>
<text x="580" y="370" font-size="50" font-weight="700" fill="#d4690b">${esc(c.btc)}</text>
<text x="580" y="418" font-size="28" fill="#5f6064">proven on NEAR by its Bitcoin light client</text>
<rect x="580" y="452" width="${Math.min(560, pill).toFixed(0)}" height="62" rx="31" fill="#0d0d0a"/>
<text x="608" y="494" font-size="28" fill="#ffffff">${esc(c.status.length > 34 ? `${c.status.slice(0, 33)}…` : c.status)}</text>
</g></svg>`;
}

export function cardPng(c) {
  return new Resvg(cardSvg(c), { font: { fontFiles: [FONT], loadSystemFonts: false, defaultFontFamily: "Inter" }, fitTo: { mode: "width", value: 1200 } }).render().asPng();
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") return res.status(405).json({ error: "GET only" });
  const id = tokenId(req.query?.id);
  if (!id) return res.status(400).json({ error: "?id=<token id>" });
  try {
    const c = await card(id);
    if (!c) return res.status(404).json({ error: `no Pusaka #${id}` });
    res.setHeader("content-type", "image/png");
    res.setHeader("cache-control", "public, s-maxage=600, stale-while-revalidate=86400");
    res.status(200).send(Buffer.from(cardPng(c)));
  } catch (e) {
    res.status(502).json({ error: "couldn't draw the card", detail: String(e.message ?? e).slice(0, 160) });
  }
}
