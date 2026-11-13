// GET /api/badge?id=1[&contract=pusaka-btc.testnet] -> an SVG badge with the BTC verified inside that Pusaka; embed it anywhere.
import { CONTRACT, SIBLINGS } from "@pusaka/shared";
import { tokenReserve } from "./_reserves.mjs";

const esc = (s) => String(s).replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);

export function badge(id, sats) {
  const left = `Pusaka #${id}`;
  const right = `${(sats / 1e8).toFixed(8)} BTC verified`;
  const lw = 12 + left.length * 7, rw = 12 + right.length * 7;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${lw + rw}" height="22" role="img" aria-label="${esc(left)}: ${esc(right)}">
<title>${esc(left)}: ${esc(right)} on NEAR</title><rect width="${lw}" height="22" rx="4" fill="#0d0d0a"/><rect x="${lw}" width="${rw}" height="22" rx="4" fill="#d4690b"/>
<rect x="${lw - 4}" width="8" height="22" fill="#d4690b"/><g font-family="Verdana,sans-serif" font-size="12" fill="#fff">
<text x="6" y="15">${esc(left)}</text><text x="${lw + 6}" y="15">${esc(right)}</text></g></svg>`;
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") return res.status(405).json({ error: "GET only" });
  const id = String(req.query?.id ?? "").replace(/^0+(?=\d)/, ""); // "01" is token 1
  if (!/^\d{1,10}$/.test(id)) return res.status(400).json({ error: "?id=<token id>" });
  const c = String(req.query?.contract ?? CONTRACT);
  if (![CONTRACT, ...SIBLINGS].includes(c)) return res.status(400).json({ error: `contract must be one of ${[CONTRACT, ...SIBLINGS].join(", ")}` });
  try {
    const t = await tokenReserve(id, c);
    if (!t) return res.status(404).json({ error: `no Pusaka #${id}` });
    res.setHeader("content-type", "image/svg+xml");
    res.setHeader("cache-control", "public, s-maxage=300, stale-while-revalidate=3600");
    res.status(200).send(badge(id, t.verified_sats));
  } catch {
    res.status(502).json({ error: "NEAR RPC unavailable" });
  }
}
