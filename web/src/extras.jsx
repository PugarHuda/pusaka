// Small UI pieces around the core flows: the Dutch auction clock, the deposit QR code, the holder's notifications,
// and loading skeletons. All of them read the contract; nothing here is decorative data.
import { useEffect, useMemo, useRef, useState } from "react";
import { renderSVG } from "uqr";
import { near, view } from "./near.js";
import { loadInfos } from "./mine.js";
import { useNow, watched, WATCH_KEY } from "./util.js";

const span = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h ${m}m ${s % 60}s` : h ? `${h}h ${m}m ${s % 60}s` : `${m}m ${s % 60}s`;
};

/** A listing's price right now: the same straight line from price to floor that the contract's price_at follows. */
function priceAt(l, now) {
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
  const [perm, setPerm] = useState(() => (typeof Notification === "undefined" ? "unsupported" : Notification.permission));
  useBrowserAlerts(items, seen);
  return (
    <details className="bell" onToggle={(e) => { if (e.currentTarget.open && items?.length) { localStorage.setItem(key, String(items[0].at)); setTimeout(() => setSeen(items[0].at), 4000); } }}>
      <summary aria-label={unread ? `${unread} new notifications` : "Notifications"}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 3a6 6 0 0 0-6 6v3.6L4.4 15.5A1 1 0 0 0 5.3 17h13.4a1 1 0 0 0 .9-1.5L18 12.6V9a6 6 0 0 0-6-6Zm0 19a2.5 2.5 0 0 0 2.4-2h-4.8a2.5 2.5 0 0 0 2.4 2Z" fill="currentColor" /></svg>
        {unread > 0 && <b>{unread}</b>}
      </summary>
      <div className="bell-panel">
        <p className="bell-title">Notifications
          {perm === "default" && <button type="button" className="link" onClick={() => Notification.requestPermission().then(setPerm)}>Alert me in this browser</button>}
          {perm === "granted" && <span className="muted"> · browser alerts on</span>}
        </p>
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

// ---------- proof trail, owner checklist, command palette ----------

/** Each counted deposit, step by step: sent on Bitcoin, proven by NEAR's light client, counted (or signed away). */
export function ProofTrail({ info, explorer, nearExplorer, lightClient }) {
  const signed = new Set(info.signed_outpoints.map((o) => `${o.txid}:${o.vout}`));
  if (!info.proven_utxos.length) return null;
  return (
    <section className="trail" aria-label="Proof trail">
      <h2>Proof trail</h2>
      <p className="muted">Where each satoshi above comes from. Every step is public; none of it is our word.</p>
      <ol>{info.proven_utxos.map((u) => {
        const out = signed.has(`${u.txid}:${u.vout}`);
        return (
          <li key={`${u.txid}:${u.vout}`}>
            <span className="trail-amt">{Number(u.value).toLocaleString("en-US")} sats</span>
            <span className="trail-steps">
              <a href={`${explorer}/tx/${u.txid}`} target="_blank" rel="noreferrer"><i className="ok" />Sent on Bitcoin <code>{u.txid.slice(0, 10)}…:{u.vout}</code></a>
              <a href={`${nearExplorer}/account/${lightClient}`} target="_blank" rel="noreferrer"><i className="ok" />Merkle proof checked by NEAR's light client</a>
              <span>{out ? <><i className="out" />Signed away by the holder: no longer counted</> : <><i className="ok" />Counted in this Pusaka's verified Bitcoin</>}</span>
            </span>
          </li>
        );
      })}</ol>
    </section>
  );
}

/** For the holder: what's done and what's next with this Pusaka, read from the contract. */
export function OwnerChecklist({ info, letter, pendingSats }) {
  const sats = Number(info.verified_sats);
  const [heir, setHeir] = useState(false);
  useEffect(() => { view("heir_of", { token_id: info.token.token_id }).then((h) => setHeir(!!h), () => {}); }, [info]);
  const steps = [
    { done: sats > 0 || pendingSats > 0, text: "Fill it: send Bitcoin to its address", hint: "Use the address or QR code above." },
    { done: sats > 0, text: "Prove it on NEAR", hint: pendingSats > 0 ? "A deposit is waiting: press Prove for free once it has a confirmation." : "Happens after the first confirmation; free with the relayer." },
    { done: !!(info.listing || info.loan || Object.keys(info.token.approved_account_ids ?? {}).length), text: "Put it to work: sell it or borrow against it", hint: "List it below, ask for a loan, or take a standing offer." },
    { done: heir, text: "Name an heir", hint: "If you go silent, it passes on with everything inside." },
    { done: letter, text: "Seal a letter for the next holder", hint: "Only whoever holds it can read it." },
  ];
  const n = steps.filter((s) => s.done).length;
  return (
    <section className="checklist" aria-label="Your Pusaka checklist">
      <h2>Your Pusaka: {n} of {steps.length} done</h2>
      <ol>{steps.map((s) => (
        <li key={s.text} className={s.done ? "is-done" : ""}><strong>{s.text}</strong>{!s.done && <span className="muted">{s.hint}</span>}</li>
      ))}</ol>
    </section>
  );
}

/** Ctrl/Cmd+K: jump to any page or Pusaka. A native <dialog>, so focus and Escape work without code. */
export function CommandPalette({ accountId }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [ids, setIds] = useState([]);
  const [sel, setSel] = useState(0);
  useEffect(() => {
    const k = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); } };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, []);
  useEffect(() => { if (open && !ids.length) loadInfos().then((x) => setIds(x.map((i) => i.token.token_id).sort((a, b) => a - b))).catch(() => {}); }, [open, ids.length]);
  const pages = [["Home", "#/"], ["Market", "#/market"], ...(accountId ? [["Your Pusakas", "#/mine"]] : []), ["For AI agents", "#/agents"]];
  const items = [...pages.map(([label, href]) => ({ label, href })), ...ids.map((id) => ({ label: `Pusaka #${id}`, href: `#/pusaka/${id}` }))]
    .filter((x) => x.label.toLowerCase().includes(q.toLowerCase().replace(/^#/, "")));
  if (/^#?\d+$/.test(q.trim()) && !items.some((x) => x.label === `Pusaka #${q.trim().replace("#", "")}`)) items.unshift({ label: `Pusaka #${q.trim().replace("#", "")}`, href: `#/pusaka/${q.trim().replace("#", "")}` });
  const go = (x) => { if (!x) return; location.hash = x.href.slice(1); setOpen(false); setQ(""); };
  if (!open) return null;
  return (
    <div className="palette-backdrop" onClick={() => setOpen(false)}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Go to" onClick={(e) => e.stopPropagation()}>
        <input autoFocus value={q} placeholder="Go to a page or Pusaka #…" aria-label="Go to"
          onChange={(e) => { setQ(e.target.value); setSel(0); }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
            if (e.key === "Enter") go(items[sel]);
          }} />
        <ul role="listbox">{items.slice(0, 9).map((x, i) => (
          <li key={x.href} role="option" aria-selected={i === sel} className={i === sel ? "is-sel" : ""} onMouseEnter={() => setSel(i)} onClick={() => go(x)}>{x.label}</li>
        ))}</ul>
        <p className="muted">Enter to open, Esc to close, Ctrl+K anywhere</p>
      </div>
    </div>
  );
}

// ---------- theme, celebration, watchlist, browser alerts, 3D tilt ----------

export function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === "dark");
  // until the person picks a theme here, follow the system, also when it changes while the page is open
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const follow = () => {
      let chosen = null;
      try { chosen = localStorage.getItem("pusaka:theme"); } catch { /* storage blocked: follow the system */ }
      if (chosen) return;
      document.documentElement.dataset.theme = mq.matches ? "dark" : "light";
      setDark(mq.matches);
    };
    mq.addEventListener("change", follow);
    return () => mq.removeEventListener("change", follow);
  }, []);
  const flip = () => {
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("pusaka:theme", next); } catch { /* storage blocked: this visit only */ }
    setDark(!dark);
  };
  return (
    <button type="button" className="theme-toggle" onClick={flip} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"} title={dark ? "Light mode" : "Dark mode"}>
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">{dark
        ? <path fill="currentColor" d="M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm0-5 1.2 3h-2.4L12 2Zm0 20-1.2-3h2.4L12 22ZM2 12l3-1.2v2.4L2 12Zm20 0-3 1.2v-2.4L22 12ZM4.9 4.9l3 1.3-1.7 1.7-1.3-3Zm14.2 14.2-3-1.3 1.7-1.7 1.3 3Zm0-14.2-1.3 3-1.7-1.7 3-1.3ZM4.9 19.1l1.3-3 1.7 1.7-3 1.3Z" />
        : <path fill="currentColor" d="M20.5 14.6A8.5 8.5 0 0 1 9.4 3.5a8.5 8.5 0 1 0 11.1 11.1Z" />}</svg>
    </button>
  );
}

function useWatch(id) {
  const [on, setOn] = useState(() => watched().has(String(id)));
  const toggle = (e) => {
    e?.preventDefault(); e?.stopPropagation();
    const w = watched();
    if (w.has(String(id))) w.delete(String(id)); else w.add(String(id));
    localStorage.setItem(WATCH_KEY, JSON.stringify([...w]));
    setOn(w.has(String(id)));
    dispatchEvent(new Event("pusaka:watch"));
  };
  return [on, toggle];
}
export function WatchStar({ id }) {
  const [on, toggle] = useWatch(id);
  return (
    <button type="button" className={`star${on ? " is-on" : ""}`} onClick={toggle} aria-pressed={on} aria-label={on ? `Stop watching Pusaka #${id}` : `Watch Pusaka #${id}`} title={on ? "Watching" : "Watch"}>
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>
    </button>
  );
}

/** Browser alerts for new notifications while Pusaka is open in a tab (the Notification API; no server keeps your address). */
function useBrowserAlerts(items, seen) {
  const shown = useRef(new Set());
  useEffect(() => {
    if (!items || typeof Notification === "undefined" || Notification.permission !== "granted") return;
    for (const x of items) {
      const k = `${x.id}:${x.at}:${x.text}`;
      if (x.at > seen && !shown.current.has(k) && Date.now() - x.at < 10 * 60_000) {
        shown.current.add(k);
        new Notification("Pusaka", { body: x.text, icon: "/icon-192.png", tag: k });
      }
    }
  }, [items, seen]);
}

/** A gentle 3D tilt that follows the pointer: the vessel turns in the light. */
export function Tilt({ children, className = "" }) {
  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
    e.currentTarget.style.setProperty("--rx", `${(-y * 16).toFixed(2)}deg`);
    e.currentTarget.style.setProperty("--ry", `${(x * 16).toFixed(2)}deg`);
    e.currentTarget.style.setProperty("--gx", `${((x + 0.5) * 100).toFixed(0)}%`);
    e.currentTarget.style.setProperty("--gy", `${((y + 0.5) * 100).toFixed(0)}%`);
  };
  const reset = (e) => { for (const k of ["--rx", "--ry"]) e.currentTarget.style.setProperty(k, "0deg"); };
  return <div className={`tilt ${className}`} onPointerMove={onMove} onPointerLeave={reset}>{children}<span className="tilt-glare" aria-hidden="true" /></div>;
}

/**
 * "Don't trust this page": re-checks the Pusaka in the visitor's own browser, straight against NEAR, its MPC
 * signer, its Bitcoin light client and Bitcoin explorers (shared/audit.mjs, the same code as scripts/verify.mjs).
 */
export function SelfCheck({ id, explorer }) {
  const [state, setState] = useState(null); // null | "running" | { checks } | { error }
  async function run() {
    setState("running");
    try {
      const { auditContract, auditToken } = await import("@pusaka/shared/audit");
      const [contract, token] = await Promise.all([auditContract(), auditToken(id)]);
      setState({ checks: [...contract, ...token] });
    } catch (e) { setState({ error: e.message }); }
  }
  const checks = state?.checks;
  const bad = checks?.filter((c) => c.ok === false).length ?? 0, unknown = checks?.filter((c) => c.ok === null).length ?? 0;
  return (
    <div className="self-check">
      <button type="button" className="ghost" onClick={run} disabled={state === "running"}>
        {state === "running" ? "Checking against NEAR and Bitcoin…" : checks ? "Check again" : "Check it yourself"}
      </button>
      <span className="muted"> Your browser asks NEAR, its MPC signer, its Bitcoin light client and Bitcoin directly. No Pusaka server in between.</span>
      <div aria-live="polite">
        {state?.error && <p className="error" role="alert">Couldn't finish: {state.error} <button type="button" onClick={run}>Try again</button></p>}
        {checks && <>
          <p className={bad ? "error" : "stats"}>{bad ? `${bad} check(s) failed` : unknown ? `${checks.length - unknown} of ${checks.length} checks passed; ${unknown} source(s) didn't answer` : `All ${checks.length} checks passed`}</p>
          <ul className="checks">{checks.map((c, i) => (
            <li key={i} className={c.ok ? "ok" : c.ok === null ? "unknown" : "bad"}>
              <span aria-hidden="true">{c.ok ? "✓" : c.ok === null ? "?" : "✗"}</span>{" "}
              <strong>{c.what}</strong>
              <small>{c.detail}{c.txid && <> · <a href={`${explorer}/tx/${c.txid}`} target="_blank" rel="noreferrer">tx</a></>}</small>
            </li>
          ))}</ul>
        </>}
      </div>
    </div>
  );
}
