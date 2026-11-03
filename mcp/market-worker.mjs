// Pusaka appraiser on NEAR Agent Market (market.near.ai): buyers hire it to appraise a Pusaka
// before buying or lending. It polls its assignments, writes a due-diligence report from the
// live contract (verified BTC via the light client, USD value, ETH, listing premium, loan LTV/APR)
// and submits it.
//   AGENT_MARKET_TOKEN=aat_… node market-worker.mjs          run the loop
//   node market-worker.mjs --report 4                       print the report for Pusaka #4 (no token needed)
import { inspect } from "./tools.mjs";

const API = "https://market.near.ai/v1";
const usd = (x) => `$${x.toFixed(2)}`;

export async function report(ids) {
  const parts = ["# Pusaka appraisal", "", `Source: live contract on NEAR ${ids.length > 1 ? "for " + ids.map((i) => "#" + i).join(", ") : ""}. Prices: mempool.space (BTC), Rhea (NEAR), mainnet.`, ""];
  for (const id of ids) {
    let d;
    try { d = await inspect(id); } catch (e) {
      console.error(`inspect ${id}:`, e); // details stay local; the buyer gets a plain message
      parts.push(`## Pusaka #${id}`, "", "Couldn't read this Pusaka from the contract (it may not exist).", "");
      continue;
    }
    const btc = d.btc.verified_sats / 1e8;
    parts.push(`## Pusaka #${id}`, "",
      `- Owner: \`${d.owner}\``,
      `- Bitcoin verified on NEAR (light client, never signed for): **${btc.toFixed(8)} BTC**${d.usd ? ` ≈ ${usd(d.usd.btc_inside)}` : ""}`,
      `- Bitcoin address: \`${d.btc.address}\``,
      d.eth ? `- ETH on ${d.eth.chain}: ${Number(d.eth.safe_wei) / 1e18} safe, ${Number(d.eth.at_risk_wei) / 1e18} at risk` : "- ETH: none",
      `- Locked: ${Object.entries(d.locked).filter(([, v]) => v).map(([k]) => k).join(", ") || "no"}`,
      `- Sign epoch: ${d.sign_epoch} (pass this to \`buy\`/\`fund_loan\`; it fails if a signature is requested after you checked)`);
    if (d.listing) {
      const p = d.listing.premium_vs_btc;
      parts.push(`- For sale at **${d.listing.price_now_near} NEAR**${p != null ? `, ${Math.abs(p * 100).toFixed(1)}% ${p < 0 ? "below" : "above"} the BTC inside` : ""}`);
    }
    if (d.loan) {
      const l = d.loan;
      parts.push(`- Loan: ${l.principal_near} NEAR, repay ${l.repay_near} NEAR${l.lender ? `, funded by \`${l.lender}\`` : ", open request"}` +
        (l.ltv != null ? `; loan-to-value ${Number.isFinite(l.ltv) ? (l.ltv * 100).toFixed(1) + "%" : "no verified collateral"}, ${(l.apr * 100).toFixed(0)}% a year` : ""));
    }
    const verdict = d.btc.verified_sats === 0 ? "No verified BTC: don't pay or lend against it until a deposit is proven."
      : d.loan && !d.loan.lender && d.loan.ltv > 0.5 ? "Loan-to-value above 50%: risky collateral."
      : "Verified BTC backs this Pusaka; check the price against the BTC value above.";
    parts.push("", `**Verdict:** ${verdict}`, "");
  }
  return parts.join("\n");
}

async function api(path, init = {}) {
  const r = await fetch(`${API}${path}`, { ...init, headers: { authorization: `Bearer ${process.env.AGENT_MARKET_TOKEN}`, "content-type": "application/json", ...init.headers } });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

async function loop() {
  for (;;) {
    const rows = await api("/agents/me/assignments");
    for (const a of (rows.items ?? rows).filter((x) => !x.startedAt)) {
      await api(`/assignments/${a.id}/start`, { method: "POST" });
      const text = JSON.stringify(a);
      const ids = [...new Set([...text.matchAll(/(?:pusaka|token)\D{0,3}#?(\d{1,6})/gi)].map((m) => m[1]))];
      const body = ids.length ? await report(ids.slice(0, 10)) : "Please name the Pusaka to appraise, e.g. \"Pusaka #4\".";
      await api(`/assignments/${a.id}/submit`, { method: "POST", body: JSON.stringify({ deliverable: body }) });
      console.log(`submitted ${a.id} for ${ids.join(", ") || "no token"}`);
    }
    await new Promise((r) => setTimeout(r, 30_000));
  }
}

const i = process.argv.indexOf("--report");
if (i > 0) console.log(await report(process.argv.slice(i + 1)));
else if (!process.env.AGENT_MARKET_TOKEN) { console.error("set AGENT_MARKET_TOKEN (aat_…) from market.near.ai, or use --report <id…>"); process.exit(1); }
else await loop();
