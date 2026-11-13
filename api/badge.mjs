// GET /api/badge?id=1[&contract=pusaka-btc.testnet][&clean=1] -> an SVG badge with the BTC verified inside that Pusaka;
// embed it anywhere. With clean=1 it also says whether anything the holder already signed could still move what's
// inside (shared/clean.mjs, every chain checked when the badge is drawn, cached at most a minute, its time on the badge): a seller can paste a
// "proof of clean" next to a listing on any marketplace, and it stays honest because it is redrawn from the chains.
import { CONTRACT, SIBLINGS } from "@pusaka/shared";
import { cleanOf } from "@pusaka/shared/clean";
import { viewFinal } from "@pusaka/shared/audit";
import { tokenReserve } from "./_reserves.mjs";

const esc = (s) => String(s).replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);

const CLEAN = { clean: ["clean", "#2e7d32"], risk: ["not clean", "#c62828"], unknown: ["clean: unchecked", "#6b6b6b"] };

/** `verdict`: "clean" | "risk" | "unknown" adds a third segment; `at`: when the chains were read. */
export function badge(id, sats, verdict, at) {
  const left = `Pusaka #${id}`;
  const right = `${(sats / 1e8).toFixed(8)} BTC verified`;
  const [word, color] = verdict ? CLEAN[verdict] ?? CLEAN.unknown : [];
  // the check time is in the visible text: an embedded badge says how old its answer is
  const third = word && (at ? `${word} @${new Date(at).toISOString().slice(11, 16)}Z` : word);
  const lw = 12 + left.length * 7, rw = 12 + right.length * 7, cw = third ? 12 + third.length * 7 : 0;
  const label = `${left}: ${right}${third ? `, ${third}` : ""}`;
  const when = at ? ` (checked ${new Date(at).toISOString().slice(0, 16).replace("T", " ")} UTC)` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${lw + rw + cw}" height="22" role="img" aria-label="${esc(label)}">
<title>${esc(label)} on NEAR${esc(when)}</title><rect width="${lw}" height="22" rx="4" fill="#0d0d0a"/><rect x="${lw}" width="${rw}" height="22" rx="4" fill="#d4690b"/>
<rect x="${lw - 4}" width="8" height="22" fill="#d4690b"/>${third ? `<rect x="${lw + rw - 4}" width="${cw + 4}" height="22" rx="4" fill="${color}"/><rect x="${lw + rw - 4}" width="8" height="22" fill="${color}"/>` : ""}<g font-family="Verdana,sans-serif" font-size="12" fill="#fff">
<text x="6" y="15">${esc(left)}</text><text x="${lw + 6}" y="15">${esc(right)}</text>${third ? `<text x="${lw + rw + 6}" y="15">${esc(third)}</text>` : ""}</g></svg>`;
}

/** The same answer as JSON (docs/PROOF-OF-CLEAN.md, "pusaka-clean/1"): anything but a full clean check is not clean. */
export function attestation(id, contract, sats, clean, at) {
  const verdict = ["clean", "risk"].includes(clean?.verdict) ? clean.verdict : "unknown";
  return {
    standard: "pusaka-clean", version: "1", chain: "near", contract, token_id: id,
    verified_sats: String(sats), verdict, checked_at: new Date(at).toISOString(), valid_for_s: 60,
    checks: (clean?.checks ?? []).map(({ ok, what, detail }) => ({ ok, what, detail })),
  };
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
    // a chain that doesn't answer makes it "unchecked", never clean (fail closed)
    const json = req.query?.format === "json";
    const clean = req.query?.clean === "1" || json ? await cleanOf(id, c, viewFinal).catch(() => ({ verdict: "unknown" })) : null;
    if (json) {
      res.setHeader("cache-control", "public, s-maxage=60, max-age=0, must-revalidate");
      res.setHeader("access-control-allow-origin", "*");
      return res.status(200).json(attestation(id, c, t.verified_sats, clean, Date.now()));
    }
    res.setHeader("content-type", "image/svg+xml");
    // a clean verdict goes stale the moment something is signed: a minute at most, never served stale
    res.setHeader("cache-control", clean ? "public, s-maxage=60, max-age=0, must-revalidate" : "public, s-maxage=300, stale-while-revalidate=3600");
    res.status(200).send(badge(id, t.verified_sats, clean?.verdict, clean && Date.now()));
  } catch {
    res.status(502).json({ error: "NEAR RPC unavailable" });
  }
}
