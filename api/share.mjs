// GET /p/<id> (rewritten here): the link to share for one Pusaka. Crawlers (X, Telegram, Discord) read its Open Graph
// tags and the /api/og card; people are sent on to the app's page for it.
import { card, tokenId } from "./_card.mjs";

const esc = (s) => String(s).replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

export default async function handler(req, res) {
  const id = tokenId(req.query?.id);
  if (!id) return res.status(400).send("not a Pusaka");
  const origin = `https://${req.headers["x-forwarded-host"] ?? req.headers.host}`;
  const c = await card(id).catch(() => null);
  if (!c) return res.status(404).send(`no Pusaka #${esc(id)}`);
  const title = `Pusaka #${id}: ${c.btc} inside, proven on NEAR`;
  const app = `/#/pusaka/${id}`;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader("cache-control", "public, s-maxage=300, stale-while-revalidate=3600");
  res.status(200).send(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${esc(title)}</title>
<meta name="description" content="${esc(c.description)}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(`${c.status}. ${c.description}`)}">
<meta property="og:image" content="${origin}/api/og?id=${id}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta property="og:url" content="${origin}/p/${id}"><meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${origin}/api/og?id=${id}">
<meta http-equiv="refresh" content="0; url=${app}"></head>
<body><a href="${app}">Open Pusaka #${esc(id)}</a></body></html>`);
}
