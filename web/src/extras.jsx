// Small UI pieces around the core flows: the Dutch auction clock, the deposit QR code, the holder's notifications,
// and loading skeletons. All of them read the contract; nothing here is decorative data.
import { useEffect, useMemo, useState } from "react";
import { renderSVG } from "uqr";
import { near } from "./near.js";
import { loadInfos } from "./mine.js";

function useNow(ms = 1000, on = true) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms, on]);
  return now;
}

const span = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h ${m}m ${s % 60}s` : h ? `${h}h ${m}m ${s % 60}s` : `${m}m ${s % 60}s`;
};

/** A listing's price right now: the same straight line from price to floor that the contract's price_at follows. */
export function priceAt(l, now) {
  const [p, f, s, e] = [BigInt(l.price), BigInt(l.floor), BigInt(l.start_ms), BigInt(l.end_ms)];
  const t = BigInt(Math.floor(now));
  if (t >= e || e <= s) return f;
  if (t <= s) return p;
  return p - ((p - f) * (t - s)) / (e - s);
}

// six decimals, so the falling price visibly moves every second or so
const fine = (y) => (Number(BigInt(y) / 10n ** 15n) / 1e9).toFixed(6);

/** Dutch auction: the price ticking down to its floor, and how long until it gets there. */
export function AuctionClock({ listing }) {
  const falling = listing.floor !== listing.price && Number(listing.end_ms) > Number(listing.start_ms);
  const now = useNow(1000, falling);
  if (!falling) return null;
  const left = Number(listing.end_ms) - now;
  const done = Math.min(1, Math.max(0, (now - Number(listing.start_ms)) / (Number(listing.end_ms) - Number(listing.start_ms))));
  return (
    <div className="auction" role="timer" aria-live="off">
      <div className="auction-row">
        <span>Dutch auction: <strong>{fine(priceAt(listing, now))} NEAR</strong> now</span>
        <span className="muted">{left > 0 ? `${near(listing.floor)} NEAR in ${span(left)}` : `at its floor, ${near(listing.floor)} NEAR`}</span>
      </div>
      <div className="auction-bar"><i style={{ width: `${(done * 100).toFixed(2)}%` }} /></div>
    </div>
  );
}

/** BIP21 QR for the Pusaka's Bitcoin address: scan it with any phone wallet to fill the vessel. */
export function BtcQr({ address, label }) {
  const uri = `bitcoin:${address}?label=${encodeURIComponent(label)}`;
  const svg = useMemo(() => renderSVG(uri, { border: 1, ecc: "M" }), [uri]);
  return (
    <details className="qr">
      <summary>Show QR code</summary>
      <img className="qr-box" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} alt={`QR code for ${address}`} width="200" height="200" />
      <p className="muted">Scan with a Bitcoin wallet (testnet). Once it confirms, anyone can prove it on NEAR.</p>
    </details>
  );
}

// ---------- notifications ----------

/** What happened to an account, from every Pusaka's on-chain history (the contract also mirrors these to NEAR Social). */
function noticeFor(me, id, e) {
  const k = e.kind;
  if (k === "Sale" && e.from === me) return `You sold Pusaka #${id} for ${near(e.price)} NEAR`;
  if (k === "Sale" && e.to === me) return `You bought Pusaka #${id} for ${near(e.price)} NEAR`;
  if (k === "Transfer" && e.to === me) return `You received Pusaka #${id} from ${e.from}`;
  if (k === "Transfer" && e.from === me) return `You gave Pusaka #${id} to ${e.to}`;
  if (k === "Inherited" && e.to === me) return `You inherited Pusaka #${id} from ${e.from}`;
  if (k === "HeirSet" && e.heir === me) return `You were named heir of Pusaka #${id}`;
  if ((k === "LoanFunded" || k === "LoanOfferAccepted") && e.lender === me) return `Your loan on Pusaka #${id} is running`;
  if (k === "LoanRepaid" && e.lender === me) return `Your loan on Pusaka #${id} was repaid: ${near(e.amount)} NEAR`;
  if (k === "LoanDefaulted" && e.lender === me) return `You took Pusaka #${id} as collateral`;
  if (k === "LoanRefinanced" && e.from === me) return `Your loan on Pusaka #${id} was paid off by a refinance`;
  return null;
}

export function Bell({ accountId }) {
  const [items, setItems] = useState(null);
  const key = `pusaka:seen:${accountId}`;
  const [seen, setSeen] = useState(() => Number(localStorage.getItem(key) ?? 0));
  useEffect(() => {
    let live = true;
    const load = () => loadInfos().then((infos) => {
      const out = [];
      for (const i of infos) for (const h of i.history ?? []) {
        const text = noticeFor(accountId, i.token.token_id, h.event);
        if (text) out.push({ at: Number(h.at_ms), text, id: i.token.token_id });
      }
      if (live) setItems(out.sort((a, b) => b.at - a.at).slice(0, 20));
    }).catch(() => live && setItems([]));
    load();
    const t = setInterval(load, 60_000);
    return () => { live = false; clearInterval(t); };
  }, [accountId]);
  const unread = items?.filter((x) => x.at > seen).length ?? 0;
  return (
    <details className="bell" onToggle={(e) => { if (e.currentTarget.open && items?.length) { localStorage.setItem(key, String(items[0].at)); setTimeout(() => setSeen(items[0].at), 4000); } }}>
      <summary aria-label={unread ? `${unread} new notifications` : "Notifications"}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 3a6 6 0 0 0-6 6v3.6L4.4 15.5A1 1 0 0 0 5.3 17h13.4a1 1 0 0 0 .9-1.5L18 12.6V9a6 6 0 0 0-6-6Zm0 19a2.5 2.5 0 0 0 2.4-2h-4.8a2.5 2.5 0 0 0 2.4 2Z" fill="currentColor" /></svg>
        {unread > 0 && <b>{unread}</b>}
      </summary>
      <div className="bell-panel">
        <p className="bell-title">Notifications</p>
        {!items ? <p className="muted">Reading the contract…</p> : !items.length ? <p className="muted">Nothing yet. Sales, transfers, loans and heirs that involve {accountId} show up here.</p> : (
          <ul>{items.map((x) => (
            <li key={`${x.id}:${x.at}:${x.text}`} className={x.at > seen ? "is-new" : ""}>
              <a href={`#/pusaka/${x.id}`}>{x.text}</a>
              <small className="muted">{new Date(x.at).toLocaleString()}</small>
            </li>
          ))}</ul>
        )}
      </div>
    </details>
  );
}

/** Placeholder tiles while the contract is read, shaped like the gallery so nothing jumps when it arrives. */
export function GallerySkeleton({ n = 10 }) {
  return Array.from({ length: n }, (_, i) => (
    <div key={i} className="piece piece-skeleton" aria-hidden="true"><span className="sk-orb" /><span className="sk-line" /><span className="sk-line short" /></div>
  ));
}
