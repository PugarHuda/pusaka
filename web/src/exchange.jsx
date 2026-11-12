// #/bids: the Pusaka market contract (market/, pusaka-market.testnet): standing bids priced per verified sat
// (Blur-style collection bids) and perpetual callable loans (Paradigm/Blur's Blend). #/reserves: proof of reserves,
// every Pusaka's light-client-proven Bitcoin, each re-checkable in the browser. Loaded on demand.
import { useEffect, useState } from "react";
import { CONTRACT, SIBLINGS, NEAR_EXPLORER, EXPLORER, btcAddress } from "@pusaka/shared";
import { callRaw, provider, view, near, yocto } from "./near.js";
import { SelfCheck } from "./extras.jsx";

export const MARKET = "pusaka-market.testnet";
const mview = (method, args = {}) => provider.callFunction({ contractId: MARKET, method, args, blockQuery: { finality: "optimistic" } });
const link = (h) => <a href={`${NEAR_EXPLORER}/tx/${h}`} target="_blank" rel="noreferrer">view transaction</a>;
const STORAGE = 10n ** 22n;
const per10k = (perSat) => near(BigInt(perSat) * 10_000n);
const pct = (bps) => `${(Number(bps) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
const marketLog = (o, event) => o.receipts_outcome.flatMap((r) => r.outcome.logs).filter((l) => l.includes("pusaka-market"))
  .map((l) => JSON.parse(l.slice(11))).find((e) => e.event === event);

export default function ExchangePage({ page, accountId }) {
  return page === "reserves" ? <Reserves /> : page === "verify" ? <Verify /> : <Bids accountId={accountId} />;
}

function useRun(reload) {
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState(null);
  const run = async (label, fn) => {
    setBusy(label); setMsg(null);
    try { setMsg({ ok: true, text: await fn() }); await reload(); } catch (e) { setMsg({ ok: false, text: e.message }); } finally { setBusy(""); }
  };
  return { busy, msg, run };
}

function Bids({ accountId }) {
  const [s, setS] = useState(null);
  const [tick, setTick] = useState(0);
  const reload = () => setTick((t) => t + 1);
  useEffect(() => {
    let live = true;
    (async () => {
      const [bids, offers, loans, reserves, toks] = await Promise.all([mview("bids", { limit: 100 }), mview("offers", { limit: 100 }),
        mview("loans", { limit: 100 }), mview("reserves"), view("nft_tokens", { from_index: "0", limit: 100 })]);
      const mine = accountId ? await Promise.all(toks.filter((t) => t.owner_id === accountId).map((t) => view("token_info", { token_id: t.token_id }))) : [];
      return { bids, offers, loans, reserves, mine };
    })().catch((e) => ({ error: e.message })).then((x) => live && setS(x));
    return () => { live = false; };
  }, [accountId, tick]);
  const { busy, msg, run } = useRun(reload);
  const [bid, setBid] = useState({ price: "0.3", min: "1000", max: "20000" });
  const [offer, setOffer] = useState({ principal: "0.2", rate: "20", min: "10000" });
  if (!s) return <section><h1>Bids and loans</h1><p className="muted">Reading the market…</p></section>;
  if (s.error) return <section><h1>Bids and loans</h1><p className="error">{s.error}</p></section>;
  const free = s.mine.filter((i) => !i.listing && !i.loan && !i.pending && !Object.keys(i.token.approved_account_ids ?? {}).length);
  return (
    <section className="exchange">
      <h1>Bids and loans</h1>
      <p className="muted">A second market contract, <a href={`${NEAR_EXPLORER}/account/${MARKET}`}>{MARKET}</a>, that works with any Pusaka through
        the NFT standards. Bids are priced <strong>per verified sat</strong>: the market reads each Pusaka's light-client-proven Bitcoin
        on-chain at the moment it fills, so the price follows what is really inside. Loans have no due date: a lender who wants out
        calls the loan, and a rate auction starts at 0%; another lender can take it over, or the first one takes the Pusaka when nobody does.</p>
      <p className="muted">Escrowed for bids {near(s.reserves.bids_escrow)} NEAR · for loan offers {near(s.reserves.offers_escrow)} NEAR · lent {near(s.reserves.loans_outstanding)} NEAR</p>

      <h2>Standing bids</h2>
      {s.bids.length ? <table className="ladder"><thead><tr><th>NEAR per 10,000 sats</th><th>For a Pusaka holding</th><th>Up to</th><th>Bidder</th><th /></tr></thead>
        <tbody>{s.bids.map((b) => <tr key={b.id}>
          <td>{per10k(b.price_per_sat)}</td><td>{Number(b.min_sats).toLocaleString()}–{Number(b.max_sats).toLocaleString()} sats</td>
          <td>{near(b.escrow)} NEAR</td><td>{b.bidder}</td>
          <td>{accountId === b.bidder && <button className="ghost" disabled={!!busy || b.filling} onClick={() => run(`c${b.id}`, async () =>
            <>Bid cancelled, escrow returned. {link((await callRaw("cancel_bid", { bid_id: b.id }, { tgas: 30, receiver: MARKET })).transaction.hash)}</>)}>Cancel</button>}
            {free.filter((i) => Number(i.verified_sats) >= Number(b.min_sats) && Number(i.verified_sats) <= Number(b.max_sats) && b.bidder !== accountId).map((i) =>
              <button key={i.token.token_id} disabled={!!busy || b.filling} onClick={() => run(`s${b.id}`, async () => {
                const o = await callRaw("nft_approve", { token_id: i.token.token_id, account_id: MARKET, msg: JSON.stringify({ bid_id: Number(b.id) }) }, { deposit: 10n ** 21n, tgas: 300 });
                const filled = marketLog(o, "bid_filled"), failed = marketLog(o, "bid_fill_failed");
                if (!filled) throw new Error(`The market didn't take it: ${failed?.data[0].reason ?? "no answer"}. Revoke the approval on the Pusaka's page.`);
                return <>Sold Pusaka #{i.token.token_id} for {near(filled.data[0].price)} NEAR. {link(o.transaction.hash)}</>;
              })}>Sell #{i.token.token_id} ({Number(i.verified_sats).toLocaleString()} sats) for {near(BigInt(i.verified_sats) * BigInt(b.price_per_sat))} NEAR</button>)}</td>
        </tr>)}</tbody></table> : <p className="muted">No bids yet.</p>}
      {accountId && <form className="stack" onSubmit={(e) => { e.preventDefault(); run("bid", async () => {
        const perSat = yocto(bid.price) / 10_000n, max = BigInt(bid.max);
        const o = await callRaw("place_bid", { price_per_sat_yocto: String(perSat), min_sats: bid.min, max_sats: bid.max, nft: CONTRACT }, { deposit: perSat * max + STORAGE, tgas: 30, receiver: MARKET });
        return <>Bid placed; {near(perSat * max)} NEAR escrowed (+0.01 storage, refunded). {link(o.transaction.hash)}</>;
      }); }}>
        <h3>Place a bid</h3>
        <label>NEAR per 10,000 verified sats <input type="number" min="0.0001" step="any" value={bid.price} onChange={(e) => setBid({ ...bid, price: e.target.value })} required /></label>
        <label className="row">For Pusakas holding <input type="number" min="1" value={bid.min} onChange={(e) => setBid({ ...bid, min: e.target.value })} required /> to
          <input type="number" min="1" value={bid.max} onChange={(e) => setBid({ ...bid, max: e.target.value })} required /> sats</label>
        <button disabled={!!busy}>{busy === "bid" ? "Placing…" : "Place the bid"}</button>
      </form>}

      <h2>Loan offers</h2>
      {s.offers.length ? <ul className="plain">{s.offers.map((o) => <li key={o.id}>
        <strong>{near(o.principal)} NEAR</strong> at {pct(o.rate_bps)} a year, no due date, against a Pusaka with at least {Number(o.min_sats).toLocaleString()} sats · {o.lender}{" "}
        {accountId === o.lender && <button className="ghost" disabled={!!busy} onClick={() => run(`co${o.id}`, async () =>
          <>Offer withdrawn. {link((await callRaw("cancel_offer", { offer_id: o.id }, { tgas: 30, receiver: MARKET })).transaction.hash)}</>)}>Withdraw</button>}
        {free.filter((i) => Number(i.verified_sats) >= Number(o.min_sats) && o.lender !== accountId).map((i) =>
          <button key={i.token.token_id} disabled={!!busy} onClick={() => run(`a${o.id}`, async () => {
            const r = await callRaw("nft_transfer_call", { receiver_id: MARKET, token_id: i.token.token_id, msg: JSON.stringify({ accept_offer: Number(o.id) }) }, { deposit: 1n, tgas: 150 });
            if (!marketLog(r, "loan_started")) throw new Error("The market gave the Pusaka back: the offer was taken or no longer fits.");
            return <>Borrowed {near(o.principal)} NEAR against Pusaka #{i.token.token_id}; the market holds it until you repay. {link(r.transaction.hash)}</>;
          })}>Borrow with #{i.token.token_id}</button>)}
      </li>)}</ul> : <p className="muted">No loan offers.</p>}
      {accountId && <form className="stack" onSubmit={(e) => { e.preventDefault(); run("offer", async () => {
        const p = yocto(offer.principal);
        const o = await callRaw("offer_loan", { principal: String(p), rate_bps_per_year: Math.round(Number(offer.rate) * 100), nft: CONTRACT, min_sats: offer.min }, { deposit: p + STORAGE, tgas: 30, receiver: MARKET });
        return <>Offer posted. {link(o.transaction.hash)}</>;
      }); }}>
        <h3>Offer a loan</h3>
        <label>Lend <span className="row"><input type="number" min="0.01" step="any" value={offer.principal} onChange={(e) => setOffer({ ...offer, principal: e.target.value })} required /> NEAR</span></label>
        <label>At <span className="row"><input type="number" min="0" max="1000" step="any" value={offer.rate} onChange={(e) => setOffer({ ...offer, rate: e.target.value })} required /> % a year</span></label>
        <label>Against a Pusaka with at least <span className="row"><input type="number" min="1" value={offer.min} onChange={(e) => setOffer({ ...offer, min: e.target.value })} required /> sats</span></label>
        <button disabled={!!busy}>{busy === "offer" ? "Posting…" : "Post the offer"}</button>
      </form>}

      <h2>Open loans</h2>
      {s.loans.length ? <ul className="plain">{s.loans.map(({ loan: l, debt, auction_rate_bps: rate, auction_ends_ms: ends }) => <li key={l.id}>
        Pusaka <a href={`#/pusaka/${l.token_id}`}>#{l.token_id}</a>: {l.borrower} owes {l.lender} <strong>{near(debt)} NEAR</strong> at {pct(l.rate_bps)} a year.{" "}
        {rate != null ? <>Called: anyone can take it over at up to <strong>{pct(rate)}</strong> until {new Date(Number(ends)).toLocaleTimeString()}.</>
          : ends ? <>The auction ended with no taker: the lender may take the Pusaka.</> : "No due date."}{" "}
        {accountId && <button disabled={!!busy || l.busy} onClick={() => run(`r${l.id}`, async () => {
          const o = await callRaw("repay", { loan_id: l.id }, { deposit: BigInt(debt) * 1001n / 1000n, tgas: 150, receiver: MARKET });
          return <>Repaid; Pusaka #{l.token_id} is back with {l.borrower}. {link(o.transaction.hash)}</>;
        })}>Repay</button>}
        {accountId === l.lender && !ends && <button className="ghost" disabled={!!busy} onClick={() => run(`k${l.id}`, async () =>
          <>Loan called: the rate auction is on. {link((await callRaw("call_loan", { loan_id: l.id }, { tgas: 30, receiver: MARKET })).transaction.hash)}</>)}>Call the loan</button>}
        {accountId && accountId !== l.lender && rate != null && <button className="ghost" disabled={!!busy} onClick={() => run(`f${l.id}`, async () => {
          const o = await callRaw("refinance", { loan_id: l.id, rate_bps: rate }, { deposit: BigInt(debt) * 1001n / 1000n + STORAGE, tgas: 30, receiver: MARKET });
          return <>You now lend {near(debt)} NEAR at {pct(rate)}. {link(o.transaction.hash)}</>;
        })}>Take it over at {pct(rate)}</button>}
        {accountId === l.lender && ends && rate == null && <button className="ghost" disabled={!!busy} onClick={() => run(`z${l.id}`, async () =>
          <>Pusaka #{l.token_id} is yours. {link((await callRaw("seize", { loan_id: l.id }, { tgas: 150, receiver: MARKET })).transaction.hash)}</>)}>Take the Pusaka</button>}
      </li>)}</ul> : <p className="muted">No open loans.</p>}
      {!accountId && <p className="muted">Connect a NEAR wallet to bid, sell into a bid, lend or borrow.</p>}
      {msg && <p className={msg.ok ? "ok" : "error"} role="status">{msg.text}</p>}
    </section>
  );
}

function Reserves() {
  const [s, setS] = useState(null);
  const [open, setOpen] = useState(null);
  const [all, setAll] = useState(null); // id -> "…" | { ok, failed: [what] }
  // every row, one after another, from this browser: NEAR, its MPC signer, its light client and Bitcoin itself
  async function checkAll() {
    const { auditToken } = await import("@pusaka/shared/audit");
    const res = {};
    for (const r of s.filter((x) => x.sats > 0)) {
      setAll({ ...res, [r.key]: "…" });
      try {
        const checks = await auditToken(r.id, { contract: r.c });
        res[r.key] = { ok: checks.every((c) => c.ok), failed: checks.filter((c) => !c.ok).map((c) => c.what) };
      } catch (e) { res[r.key] = { ok: false, failed: [e.message] }; }
      setAll({ ...res });
    }
  }
  useEffect(() => {
    (async () => {
      // the main contract and its frozen classic sibling: a classic Pusaka wrapped in a Smart one is counted once, here
      const rows = (await Promise.all([CONTRACT, ...SIBLINGS].map(async (c) => {
        const toks = await provider.callFunction({ contractId: c, method: "nft_tokens", args: { from_index: "0", limit: 100 } });
        return Promise.all(toks.map(async (t) => ({ c, i: await provider.callFunction({ contractId: c, method: "token_info", args: { token_id: t.token_id } }) })));
      }))).flat();
      return rows.filter(({ i }) => i.btc_pubkey).map(({ c, i }) => ({ c, key: `${c}:${i.token.token_id}`, id: i.token.token_id, owner: i.token.owner_id, sats: Number(i.verified_sats), addr: btcAddress(i.btc_pubkey), deposits: i.proven_utxos.length }))
        .sort((a, b) => b.sats - a.sats);
    })().catch((e) => ({ error: e.message })).then(setS);
  }, []);
  if (!s) return <section><h1>Proof of reserves</h1><p className="muted">Reading every Pusaka…</p></section>;
  if (s.error) return <section><h1>Proof of reserves</h1><p className="error">{s.error}</p></section>;
  const total = s.reduce((a, r) => a + r.sats, 0);
  return (
    <section className="por">
      <h1>Proof of reserves</h1>
      <p><strong>{(total / 1e8).toFixed(8)} BTC</strong> verified across {s.length} Pusakas on <code>{CONTRACT}</code>{SIBLINGS.length ? <> and the classic <code>{SIBLINGS.join(", ")}</code></> : null}.</p>
      <p><button onClick={checkAll} disabled={all && Object.values(all).includes("…")}>Re-check every Pusaka from this browser</button></p>
      <p className="muted">Each check asks NEAR, its MPC signer, its Bitcoin light client and Bitcoin itself, not our server. Also as JSON: <a href="/api/reserves">/api/reserves</a>. <a href="#/docs">How it works</a></p>
      <table className="ladder"><thead><tr><th>Pusaka</th><th>Verified</th><th>Bitcoin address</th><th>Holder</th><th>Checked</th><th /></tr></thead>
        <tbody>{s.map((r) => <tr key={r.key}>
          <td><a href={r.c === CONTRACT ? `#/pusaka/${r.id}` : `${location.pathname}?contract=${r.c}#/pusaka/${r.id}`}>{r.c === CONTRACT ? "Smart " : ""}#{r.id}</a></td><td>{r.sats.toLocaleString()} sats ({r.deposits} deposit{r.deposits === 1 ? "" : "s"})</td>
          <td><a href={`${EXPLORER}/address/${r.addr}`} target="_blank" rel="noreferrer"><code>{r.addr.slice(0, 14)}…</code></a></td>
          <td>{r.owner}</td>
          <td>{!all?.[r.key] ? "" : all[r.key] === "…" ? "checking…" : all[r.key].ok ? "✓ all checks" : <span className="error" title={all[r.key].failed.join("; ")}>✗ {all[r.key].failed.length} failed</span>}</td>
          <td><button className="ghost" onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? "Close" : "Check"}</button></td>
        </tr>)}</tbody></table>
      {open && <><h2>Pusaka #{open}</h2><SelfCheck id={open} explorer={EXPLORER} /></>}
    </section>
  );
}

// For a website or exchange handed a Pusaka's signature: checked from this browser against NEAR (shared/holderproof.mjs).
function Verify() {
  const [f, setF] = useState({ message: "", sig: "", domain: "" });
  const [r, setR] = useState(null);
  async function check(e) {
    e.preventDefault();
    setR("…");
    try {
      const { verifySignIn, verifyBtcProof } = await import("@pusaka/shared/holderproof");
      const sig = f.sig.trim(), message = f.message.replace(/\r\n/g, "\n").trim();
      setR(/^0x[0-9a-f]+$/i.test(sig) ? await verifySignIn({ message, signature: sig, expectedDomain: f.domain.trim() || undefined })
        : await verifyBtcProof({ message, witness: sig }));
    } catch (err) { setR({ error: err.message }); }
  }
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <section>
      <h1>Verify a Pusaka's signature</h1>
      <p className="muted">A holder can sign in to a website as their Pusaka (Sign-In with Ethereum) or prove its Bitcoin address (BIP-322).
        Paste what they gave you: this page checks the signature, that the address is the Pusaka's own NEAR MPC key, and that the holder it names
        still holds it, straight from NEAR in your browser. Servers can POST the same to <code>/api/verify</code>.</p>
      <form onSubmit={check} className="stack">
        <label>Signed message<textarea rows={8} value={f.message} onChange={set("message")} required /></label>
        <label>Signature (0x… for a sign-in) or BIP-322 witness (base64)<input value={f.sig} onChange={set("sig")} required /></label>
        <label>Your site's domain (sign-ins only, optional)<input value={f.domain} onChange={set("domain")} placeholder="example.com" /></label>
        <button disabled={r === "…"}>{r === "…" ? "Checking…" : "Verify"}</button>
      </form>
      {r && r !== "…" && (r.error ? <p className="error">{r.error}</p> : <>
        <p><strong>{r.valid ? "✓ Valid" : "✗ Not valid"}</strong>{r.token_id && <> · Pusaka #{r.token_id} on <code>{r.contract}</code>, held by {r.holder}{r.address && <> · <code>{r.address}</code></>}</>}</p>
        <ul>{r.checks.map((c) => <li key={c.what}>{c.ok ? "✓" : "✗"} {c.what} <span className="muted">({c.detail})</span></li>)}</ul>
      </>)}
    </section>
  );
}
