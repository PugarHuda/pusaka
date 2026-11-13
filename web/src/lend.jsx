// Pusaka lend (lend/, pusaka-lend.testnet): borrow the pool's stablecoin (pUSD, then Circle's testnet USDC) against a Pusaka's proven Bitcoin from a lender pool, priced
// by the median of three reporters and liquidated from 80% loan-to-value. Shown on every token page next to the
// NEAR loans (peer to peer, fixed term, no oracle), so a holder picks which risk they want.
import { useEffect, useState } from "react";
import { CONTRACT, NETWORK, NEAR_EXPLORER } from "@pusaka/shared";
import { callRaw, provider } from "./near.js";

export const LEND = NETWORK === "testnet" ? "pusaka-lend.testnet" : null;
const PUSD = "pusaka-usd.testnet"; // the test stablecoin with a faucet; the pool's own token is read from its config
const U = 1_000_000;
const v = (contractId, method, args = {}) => provider.callFunction({ contractId, method, args, blockQuery: { finality: "optimistic" } });
const usd = (x) => `${(Number(x) / U).toLocaleString(undefined, { maximumFractionDigits: 2 })} pUSD`;
const pct = (bps) => `${(Number(bps) / 100).toFixed(1)}%`;

async function ensureUsd(USD, accountId, need) {
  if (!(await v(USD, "storage_balance_of", { account_id: accountId })))
    await callRaw("storage_deposit", { account_id: accountId }, { receiver: USD, deposit: 1_250_000_000_000_000_000_000n, tgas: 30 });
  const have = BigInt(await v(USD, "ft_balance_of", { account_id: accountId }));
  if (USD !== PUSD) { if (have < BigInt(need)) throw new Error(`You need ${usd(need)} of this pool's USDC (Circle's testnet faucet: faucet.circle.com, network NEAR).`); return; }
  // testnet: pUSD has no value; the faucet tops the wallet up so the demo needs no bridge
  for (let short = BigInt(need) - have; short > 0n; short -= 1_000n * BigInt(U))
    await callRaw("faucet", { amount: String(short > 1_000n * BigInt(U) ? 1_000n * BigInt(U) : short) }, { receiver: USD, tgas: 30 });
}

export function LendPanel({ id, info, accountId, isOwner, onDone }) {
  const [s, setS] = useState(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const load = () => Promise.all([v(LEND, "pool"), v(LEND, "loans", { limit: 100 }), v(LEND, "config")])
    .then(([pool, loans, cfg]) => setS({ pool, cfg, loan: loans.find((l) => l.loan.nft === CONTRACT && l.loan.token_id === String(id)) }), () => setS({ error: true }));
  useEffect(() => { if (LEND) load(); }, [id, info.token.owner_id]);
  if (!LEND || !s) return null;
  if (s.error) return <section><h2>Borrow from the pool</h2><p className="muted">Couldn't read the lending pool right now.</p></section>;
  const { pool, loan, cfg } = s, price = pool.price, USD = cfg.stable, sym = USD === PUSD ? "pUSD" : "USDC";
  const usd = (x) => `${(Number(x) / U).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${sym}`;
  const run = async (fn, ok) => {
    setBusy(true); setMsg(null);
    try { const o = await fn(); setMsg({ ok: true, text: <>{ok} {o?.transaction?.hash && <a href={`${NEAR_EXPLORER}/tx/${o.transaction.hash}`} target="_blank" rel="noreferrer">View on NEAR</a>}</> }); await load(); await onDone?.(); }
    catch (e) { setMsg({ ok: false, text: e.message }); } finally { setBusy(false); }
  };
  const sats = Number(info.verified_sats);
  const max = price ? Math.floor(sats * Number(price.low) / 1e8 * cfg.max_ltv_bps / 10_000) : 0;
  const free = !info.listing && !info.loan && !info.pending;

  return (
    <section className="lend" aria-labelledby="lend-h">
      <h2 id="lend-h">{loan ? `Collateral in the ${sym} pool` : `Borrow ${sym} from the pool`}</h2>
      <p className="muted">Two ways to borrow against this Bitcoin. <b>NEAR from a person</b> (above): fixed term, no oracle, so a price dip can never cost the
        borrower the Bitcoin. <b>{sym} from a pool</b> (here): up to {cfg.max_ltv_bps / 100}% of the BTC's value, repay any time, {cfg.rate_bps / 100}% a year; from {cfg.liq_ltv_bps / 100}% loan-to-value
        anyone can liquidate it, paying at least {cfg.liq_price_bps / 100}% of the BTC's value, and the borrower gets everything above the debt.</p>
      <p className="stats">Pool {usd(pool.assets)} ({usd(pool.cash)} free, {usd(pool.borrowed)} lent) ·{" "}
        {price ? <>BTC {usd(price.low)}{price.high !== price.low && <>–{usd(price.high)}</>}, median of 3 reporters (mempool.space, CoinGecko, Rhea nBTC)</>
          : <strong>no fresh price: borrowing and liquidation are paused until 2 of 3 reporters post</strong>}</p>
      {loan ? <>
        <p>{loan.loan.borrower} borrowed {usd(loan.loan.principal)}; owes <strong>{usd(loan.debt)}</strong> now against {Number(loan.loan.sats).toLocaleString()} sats
          {loan.value && <> worth {usd(loan.value)}: loan-to-value <strong>{pct(loan.ltv_bps)}</strong></>}.
          {loan.liquidatable ? <strong> Liquidatable now.</strong> : " Healthy."}</p>
        {accountId && <span className="row">
          <button disabled={busy || loan.loan.busy} onClick={() => run(async () => {
            const pay = BigInt(loan.debt) + BigInt(U / 100);
            await ensureUsd(USD, accountId, pay);
            return callRaw("ft_transfer_call", { receiver_id: LEND, amount: String(pay), msg: JSON.stringify({ repay: Number(loan.loan.id) }) }, { receiver: USD, deposit: 1n, tgas: 200 });
          }, `Repaid: the Pusaka is back with ${loan.loan.borrower}.`)}>Repay {usd(loan.debt)}</button>
          {loan.liquidatable && <button className="secondary" disabled={busy} onClick={() => run(async () => {
            const pay = BigInt(Math.max(Number(loan.debt), Math.ceil(Number(loan.value) * 0.95))) + BigInt(U);
            await ensureUsd(USD, accountId, pay);
            return callRaw("ft_transfer_call", { receiver_id: LEND, amount: String(pay), msg: JSON.stringify({ liquidate: Number(loan.loan.id) }) }, { receiver: USD, deposit: 1n, tgas: 250 });
          }, "Liquidated: the Pusaka and its Bitcoin are yours; the borrower got the rest.")}>Liquidate</button>}
        </span>}
      </> : isOwner && free && sats > 0 ? (
        <form className="stack" onSubmit={(e) => { e.preventDefault(); run(async () => {
          const n = Math.round(Number(amount) * U);
          if (!(n >= U && n <= max)) throw new Error(`Borrow between 1 and ${usd(max)}.`);
          await ensureUsd(USD, accountId, 0n); // registered, so the loan can be paid out
          const o = await callRaw("nft_transfer_call", { receiver_id: LEND, token_id: String(id), msg: JSON.stringify({ borrow: String(n) }) }, { deposit: 1n, tgas: 300 });
          const ev = o.receipts_outcome.flatMap((r) => r.outcome.logs).filter((l) => l.includes('"pusaka-lend"')).map((l) => JSON.parse(l.slice(11)));
          const no = ev.find((e) => e.event === "borrow_refused");
          if (no) throw new Error(`The pool refused (${no.data[0].reason}); the Pusaka came straight back.`);
          return o;
        }, `Borrowed: the ${sym} is in your wallet; the pool holds the Pusaka (and so its Bitcoin) until you repay.`); }}>
          <label>Borrow (up to {usd(max)}) <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="25" required /></label>
          <button disabled={busy || !price}>{busy ? "Signing…" : `Borrow ${sym}`}</button>
        </form>
      ) : null}
      {!loan && accountId && !isOwner && <p className="row">
        <button className="ghost" disabled={busy} onClick={() => run(async () => {
          const n = (USD === PUSD ? 100 : 10) * U;
          await ensureUsd(USD, accountId, BigInt(n));
          return callRaw("ft_transfer_call", { receiver_id: LEND, amount: String(n), msg: "supply" }, { receiver: USD, deposit: 1n, tgas: 100 });
        }, "You supplied to the pool; interest raises the value of your share.")}>Lend {USD === PUSD ? "100 pUSD" : "10 USDC"} to the pool</button></p>}
      {msg && <p className={msg.ok ? "ok" : "error"} role="status">{msg.text}</p>}
    </section>
  );
}
