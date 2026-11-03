import { useCallback, useEffect, useRef, useState } from "react";
import {
  CONTRACT, EXPLORER, MINT_DEPOSIT, WITHDRAW_DEPOSIT, MPC, NEAR_EXPLORER, NETWORK, NET,
  balances, broadcast, btcAddress, finalize, scriptHex, depositProof, PROVE_DEPOSIT, prices, loanStats, mintedTokenId,
  EVM, evmAddress, evmBalances, evmTxParams, evmTx, finalizeEth, broadcastEth,
} from "@pusaka/shared";
import { formatEther, parseEther, isAddress } from "viem";
import Emblem from "./Emblem.jsx";
import { call, callGasless, callRaw, connector, near, view, yocto } from "./near.js";

const btc = (sats) => (sats / 1e8).toFixed(8);
const eth6 = (wei) => Number(formatEther(wei)).toLocaleString(undefined, { maximumFractionDigits: 6 });
const usd = (x) => x.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: x < 100 ? 2 : 0 });
const pct = (x) => `${(x * 100).toLocaleString(undefined, { maximumFractionDigits: x < 0.1 ? 1 : 0 })}%`;

// One price fetch per page load; a failure just hides the dollar figures.
let pricePromise;
function usePrices() {
  const [p, setP] = useState(null);
  useEffect(() => {
    pricePromise ??= prices().catch(() => null);
    pricePromise.then(setP);
  }, []);
  return p;
}
const BTC_PREFIX = `${NET.bech32}1`; // "tb1" on testnet, "bc1" on mainnet

// ---------- data ----------

async function loadToken(id) {
  const info = await view("token_info", { token_id: id });
  if (!info) return null;
  const address = info.btc_pubkey ? btcAddress(info.btc_pubkey) : null;
  let bal = { safe: 0, pending: 0, atRisk: 0, spendable: [] };
  if (address) bal = await balances(address, info.signed_outpoints).catch(() => ({ ...bal, error: true }));
  let eth = null;
  if (info.btc_pubkey) {
    const ethAddr = evmAddress(info.btc_pubkey);
    const floor = await view("eth_nonce_floor", { token_id: id, chain_id: String(EVM.chain.id) });
    eth = await evmBalances(ethAddr, floor).then((b) => ({ ...b, address: ethAddr, floor })).catch(() => ({ address: ethAddr, error: true }));
  }
  return { id, info, address, bal, eth };
}

function useAccount() {
  const [accountId, setAccountId] = useState("");
  useEffect(() => {
    const on = ({ accounts }) => setAccountId(accounts[0]?.accountId ?? "");
    const off = () => setAccountId("");
    connector.on("wallet:signIn", on);
    connector.on("wallet:signOut", off);
    connector.getConnectedWallet().then((w) => setAccountId(w?.accounts[0]?.accountId ?? "")).catch(off);
    return () => { connector.off("wallet:signIn", on); connector.off("wallet:signOut", off); };
  }, []);
  return accountId;
}

function useRoute() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const f = () => { setHash(location.hash); window.scrollTo(0, 0); };
    addEventListener("hashchange", f);
    return () => removeEventListener("hashchange", f);
  }, []);
  return hash.match(/^#\/pusaka\/(\d+)/)?.[1] ?? null;
}

// ---------- app ----------

export default function App() {
  const accountId = useAccount();
  const tokenId = useRoute();
  const [minting, setMinting] = useState("");

  async function mint() {
    setMinting("Confirm in your wallet…");
    try {
      const outcome = await callRaw("nft_mint", {}, { deposit: MINT_DEPOSIT });
      const id = mintedTokenId(outcome, accountId);
      location.hash = `#/pusaka/${id}`;
      setMinting("");
    } catch (e) {
      setMinting(e.message);
    }
  }

  return (
    <>
      <header className="bar">
        <a href="#/" className="wordmark">Pusaka</a>
        <span className="net">{NETWORK === "mainnet" ? "Mainnet" : "Testnet demo"}</span>
        {accountId ? (
          <div className="who">
            <button className="ghost" onClick={mint} disabled={!!minting && minting.endsWith("…")}>Mint a Pusaka</button>
            <button className="ghost" onClick={() => connector.disconnect()} title="Disconnect wallet">{accountId}</button>
          </div>
        ) : (
          <button onClick={() => connector.connect()}>Connect NEAR wallet</button>
        )}
      </header>
      {minting && <p className="toast" role="status">{minting}</p>}
      <main>{tokenId ? <Detail key={tokenId} id={tokenId} accountId={accountId} /> : <Home />}</main>
      <footer>
        <p>
          Contract <a href={`${NEAR_EXPLORER}/address/${CONTRACT}`}>{CONTRACT}</a>. Signatures by NEAR Chain
          Signatures (<code>{MPC}</code>). Built at NEAR HACKATHON.
        </p>
      </footer>
    </>
  );
}

// ---------- home ----------

function Home() {
  const [tokens, setTokens] = useState(null);
  const [error, setError] = useState("");
  const px = usePrices();
  useEffect(() => {
    view("nft_tokens", { from_index: "0", limit: 60 })
      // allSettled: one token that fails to load must not hide the rest of the gallery
      .then((ts) => Promise.allSettled(ts.map((t) => loadToken(t.token_id))))
      .then((rs) => setTokens(rs.filter((r) => r.status === "fulfilled" && r.value).map((r) => r.value).reverse()))
      .catch((e) => setError(`Couldn't read the contract: ${e.message}`));
  }, []);

  return (
    <>
      <section className="hero">
        <h1>NFTs that hold real Bitcoin.</h1>
        <p className="lede">
          Every Pusaka controls its own Bitcoin address. Sell the NFT and the Bitcoin goes with it in one NEAR
          transaction. No bridge, no wrapped BTC, no custodian, and no private key for the seller to keep.
        </p>
      </section>

      {tokens?.length > 0 && (() => {
        const sats = tokens.reduce((a, t) => a + Number(t.info.verified_sats), 0);
        return (
          <p className="reserves">
            <strong>{btc(sats)} BTC</strong> verified on NEAR across {tokens.length} Pusaka
            {px && <> (about {usd(sats / 1e8 * px.btcUsd)})</>}. Every satoshi is proven by NEAR's Bitcoin light client,
            not reported by us.
          </p>
        );
      })()}

      <section className="lifecycle" aria-label="How a Pusaka changes hands">
        <ol>
          <li><strong>Fill it.</strong> Send BTC to the Pusaka's address from any Bitcoin wallet.</li>
          <li><strong>Sell it.</strong> List it for NEAR. While listed, nobody can withdraw.</li>
          <li><strong>Own it.</strong> The buyer is now the only one who can move that BTC.</li>
        </ol>
      </section>

      <section className="gallery" aria-label="All Pusaka">
        {error && <p className="error">{error}</p>}
        {!tokens && !error && <p className="muted">Reading the contract…</p>}
        {tokens?.length === 0 && <p className="muted">No Pusaka yet. Connect a wallet and mint the first one.</p>}
        {tokens?.map((t) => (
          <a key={t.id} href={`#/pusaka/${t.id}`} className="piece">
            <Emblem pubkey={t.info.btc_pubkey} sats={Number(t.info.verified_sats)} locked={!!t.info.listing || !!t.info.loan || t.info.pending} size={168} />
            <span className="piece-name">Pusaka #{t.id}</span>
            <span className="piece-btc">{btc(Number(t.info.verified_sats))} BTC verified</span>
            {t.bal.safe + t.bal.pending > Number(t.info.verified_sats) && <span className="piece-pending">+{btc(t.bal.safe + t.bal.pending - Number(t.info.verified_sats))} not proven yet</span>}
            {t.info.listing && <span className="piece-price">For sale at {near(t.info.price_now ?? t.info.listing.price)} NEAR</span>}
            {t.info.loan && <span className="piece-price">{t.info.loan.lender ? "Collateral for a loan" : `Asking to borrow ${near(t.info.loan.principal)} NEAR`}</span>}
          </a>
        ))}
      </section>
    </>
  );
}

// ---------- detail ----------

function Detail({ id, accountId }) {
  const [t, setT] = useState(null);
  const [missing, setMissing] = useState(false);
  const refresh = useCallback(() => loadToken(id).then((x) => (x ? setT(x) : setMissing(true))), [id]);
  useEffect(() => { refresh(); }, [refresh]);
  const px = usePrices(); // hooks before any early return

  if (missing) return <p className="error">There is no Pusaka #{id}. <a href="#/">See all Pusaka</a></p>;
  if (!t) return <p className="muted">Loading Pusaka #{id}…</p>;

  const { info, address, bal } = t;
  const owner = info.token.owner_id;
  const isOwner = accountId === owner;
  const locked = !!info.listing || !!info.loan || info.pending;

  return (
    <article className="detail">
      <div className="detail-face">
        <Emblem pubkey={info.btc_pubkey} sats={Number(info.verified_sats)} locked={locked} size={320} />
        <h1>Pusaka #{id}</h1>
        <p className="muted">Owned by <strong>{isOwner ? "you" : owner}</strong></p>
      </div>

      <div className="detail-body">
        <section>
          <h2>Bitcoin inside, verified on NEAR</h2>
          <p className="amount"><span>{btc(Number(info.verified_sats))}</span> BTC</p>
          {px && Number(info.verified_sats) > 0 && <p className="muted">About {usd(Number(info.verified_sats) / 1e8 * px.btcUsd)} at mainnet BTC prices.</p>}
          <p className="muted">
            {Number(info.verified_sats) > 0
              ? <>{Number(info.verified_sats).toLocaleString()} sats proven by the Bitcoin light client on NEAR and never signed
                for. No indexer needed: only this contract can spend from the address, and it records every signature.</>
              : <>Nothing proven yet. Send BTC to the address below; after one confirmation anyone can prove it on NEAR.</>}
          </p>
          <ProveDeposits t={t} accountId={accountId} onDone={refresh} />
          {bal.atRisk > 0 && (
            <p className="warn">
              A signature already exists that can spend {bal.atRisk.toLocaleString()} more sats, so they're left out of
              the amount above. They stop counting as at risk once that transaction lands on Bitcoin.
            </p>
          )}
          {bal.error && <p className="error">mempool.space didn't answer, so the balance may be out of date.</p>}
          {address ? (
            <p className="addr">
              <a href={`${EXPLORER}/address/${address}`} target="_blank" rel="noreferrer">{address}</a>
              <CopyButton text={address} />
              <a className="link-btn" href={`bitcoin:${address}?label=${encodeURIComponent(`Pusaka #${id}`)}`}>Open in a Bitcoin wallet</a>
            </p>
          ) : (
            <p className="muted">The Bitcoin key is still being derived by the NEAR MPC network.</p>
          )}
        </section>

        {t.eth && <EthSection t={t} canWithdraw={isOwner && !info.listing && !info.loan && !info.pending} onDone={refresh} />}

        <Actions t={t} accountId={accountId} isOwner={isOwner} onDone={refresh} px={px} />

        <details className="why">
          <summary>Why the seller can't keep the Bitcoin</summary>
          <ul>
            <li>The key behind <code>{info.btc_path}</code> belongs to the NEAR MPC network and can only be used by the
              Pusaka contract. The contract only asks for a signature when the current owner requests it.</li>
            <li>Listing a Pusaka locks withdrawals until it sells or the listing is cancelled.</li>
            <li>While a signature is being produced, the Pusaka can't be listed or transferred.</li>
            <li>Every coin ever signed for is recorded on NEAR ({info.signed_outpoints.length} so far). Those coins don't
              count toward the amount you see until they're spent, and a purchase fails if that record changed after
              you checked.</li>
          </ul>
        </details>

        <section>
          <h2>History</h2>
          <ol className="history">
            {[...info.history].reverse().map((h, i) => (
              <li key={i}>
                <time>{new Date(Number(h.at_ms)).toLocaleString()}</time>
                <span>{describe(h.event)}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </article>
  );
}

/** Deposits mempool.space sees as confirmed that aren't proven on NEAR yet; anyone can prove them. */
function ProveDeposits({ t, accountId, onDone }) {
  const { id, info, bal } = t;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const proven = (u) => info.proven_utxos.some((p) => p.txid === u.txid && p.vout === u.vout);
  const todo = bal.spendable.filter((u) => u.status?.confirmed && !proven(u));
  const unconfirmed = bal.spendable.filter((u) => !u.status?.confirmed);
  // Proving costs the visitor nothing (the relayer pays), so start as soon as a deposit is ready.
  const auto = useRef(false);
  useEffect(() => {
    if (todo.length && !auto.current) { auto.current = true; proveFree(true); }
  }, [todo.length]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!todo.length && !unconfirmed.length && !msg) return null;
  const sum = (xs) => xs.reduce((a, u) => a + u.value, 0);

  async function proveFree(automatic = false) {
    setBusy("free"); setMsg(automatic ? { ok: true, text: "Proving the new deposit on NEAR, gas paid by Pusaka's relayer…" } : null);
    try {
      const r = await fetch("/api/prove", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token_id: id }) });
      const body = await r.json().catch(() => ({}));
      if (r.status === 503) throw new Error("The relayer isn't set up on this deployment. Connect a wallet and prove from it instead.");
      if (!r.ok) throw new Error(body.error ?? `relayer answered ${r.status}`);
      const n = body.results.filter((x) => x.proven).length;
      if (!body.results.length) throw new Error(`Nothing the light client can prove yet (it's at Bitcoin block ${body.light_client_height}).`);
      setMsg({ ok: n === body.results.length, text: `${n} of ${body.results.length} deposit${body.results.length === 1 ? "" : "s"} proven on NEAR, gas paid by the relayer.` });
      await onDone();
    } catch (e) { setMsg({ ok: automatic, text: automatic ? `Not proven yet: ${e.message}` : e.message }); }
    finally { setBusy(false); }
  }

  async function prove() {
    setBusy(true); setMsg(null);
    try {
      let n = 0;
      for (const u of todo) {
        const ok = await call("prove_deposit", { token_id: id, ...(await depositProof(u.txid, u.vout)) }, { deposit: PROVE_DEPOSIT, tgas: 100 });
        if (!ok) throw new Error(`The light client didn't accept the proof for ${u.txid.slice(0, 10)}…`);
        n++;
      }
      setMsg({ ok: true, text: `${n} deposit${n === 1 ? "" : "s"} proven on NEAR.` });
      await onDone();
    } catch (e) { setMsg({ ok: false, text: e.message }); }
    finally { setBusy(false); }
  }

  return (
    <div className="prove">
      {todo.length > 0 && <>
        <p>{sum(todo).toLocaleString()} sats are confirmed on Bitcoin but not proven on NEAR yet.</p>
        <span className="row">
          <button className="ghost" disabled={busy} onClick={proveFree}>{busy === "free" ? "Proving with the light client…" : "Prove for free"}</button>
          {accountId && <button className="link" disabled={!!busy} onClick={prove}>or prove from my wallet</button>}
        </span>
        <p className="muted">Anyone can prove a deposit. "For free" uses Pusaka's relayer, which pays the NEAR gas.</p>
      </>}
      {unconfirmed.length > 0 && <p className="muted">{sum(unconfirmed).toLocaleString()} sats are waiting for a Bitcoin confirmation before they can be proven.</p>}
      {msg && <p className={msg.ok ? "ok" : "error"} role="status">{msg.text}</p>}
    </div>
  );
}

function EthSection({ t, canWithdraw, onDone }) {
  const { id, eth } = t;
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  async function send(e) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      if (!isAddress(to)) throw new Error("That isn't an Ethereum address (0x followed by 40 hex characters).");
      const tx = evmTx({ ...(await evmTxParams(eth.address)), to, value: parseEther(amount) });
      const signed = await call("withdraw_eth", {
        token_id: id, chain_id: String(tx.chainId), nonce: String(tx.nonce), to: tx.to,
        value_wei: String(tx.value), gas_limit: String(tx.gas),
        max_fee_per_gas: String(tx.maxFeePerGas), max_priority_fee_per_gas: String(tx.maxPriorityFeePerGas),
      }, { deposit: WITHDRAW_DEPOSIT, tgas: 150 });
      const hash = await broadcastEth(await finalizeEth(tx, signed, eth.address));
      setMsg({ ok: true, text: <>Sent. <a href={`${EVM.explorer}/tx/${hash}`} target="_blank" rel="noreferrer">View on Etherscan</a></> });
      await onDone();
    } catch (err) { setMsg({ ok: false, text: err.shortMessage ?? err.message }); }
    finally { setBusy(false); }
  }

  return (
    <section>
      <h2>Ether inside ({EVM.chain.name})</h2>
      <p className="muted">The same key also controls an address on every EVM chain.</p>
      {eth.error ? <p className="error">Couldn't reach {EVM.chain.name}, so the ETH balance is unknown.</p> : <>
        <p className="amount small"><span>{eth6(eth.safe)}</span> ETH</p>
        {eth.atRisk > 0n && <p className="warn">{eth6(eth.atRisk)} ETH is at risk: a signed transaction for nonce {eth.nonce} hasn't been used on {EVM.chain.name} yet, so it could still spend it.</p>}
      </>}
      <p className="addr"><a href={`${EVM.explorer}/address/${eth.address}`} target="_blank" rel="noreferrer">{eth.address}</a> <CopyButton text={eth.address} /></p>
      {canWithdraw && eth.wei > 0n && (
        <form onSubmit={send} className="stack">
          <label>Send ETH to <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="0x…" required spellCheck="false" /></label>
          <label>Amount <span className="row"><input type="number" min="0" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} required /> ETH</span></label>
          <button disabled={busy}>{busy ? "Signing with NEAR MPC…" : "Withdraw ETH"}</button>
        </form>
      )}
      {msg && <p className={msg.ok ? "ok" : "error"} role="status">{msg.text}</p>}
    </section>
  );
}

function CopyButton({ text }) {
  const [done, setDone] = useState(false);
  return (
    <button className="link" onClick={() => navigator.clipboard.writeText(text).then(() => setDone(true))}>
      {done ? "Copied" : "Copy"}
    </button>
  );
}

function describe(e) {
  switch (e.kind) {
    case "Mint": return `Minted by ${e.owner}`;
    case "Listed": return `Listed from ${near(e.price)} NEAR`;
    case "Unlisted": return "Listing cancelled";
    case "Sale": return `Sold by ${e.from} to ${e.to} for ${near(e.price)} NEAR`;
    case "Transfer": return `Given by ${e.from} to ${e.to}`;
    case "Withdraw": return `Withdrew ${Number(e.amount_sat).toLocaleString()} sats (${e.signed}/${e.inputs} inputs signed)`;
    case "LoanRequested": return `Asked to borrow ${near(e.principal)} NEAR, repaying ${near(e.repay)} within ${days(e.duration_ms)}`;
    case "LoanCancelled": return "Loan request cancelled";
    case "LoanFunded": return `Loan funded by ${e.lender}, due ${when(e.due_ms)}`;
    case "LoanRepaid": return `Loan repaid: ${near(e.amount)} NEAR to ${e.lender}`;
    case "WithdrawEth": return `Withdrew ${formatEther(BigInt(e.value_wei))} ETH on chain ${e.chain_id} (nonce ${e.nonce}${e.signed ? "" : ", signature failed"})`;
    case "LoanDefaulted": return `Loan not repaid. ${e.lender} took the Pusaka and its BTC`;
    default: return e.kind;
  }
}

const DAY_MS = 86_400_000;
const days = (ms) => { const d = Number(ms) / DAY_MS; return d >= 1 ? `${+d.toFixed(2)} day${d === 1 ? "" : "s"}` : `${Math.round(Number(ms) / 60_000)} min`; };
const when = (ms) => new Date(Number(ms)).toLocaleString();

// ---------- actions ----------

function Actions({ t, accountId, isOwner, onDone, px }) {
  const { id, info } = t;
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState(null);
  const [now] = useState(() => Date.now()); // render-stable "now" for due dates

  async function run(label, fn) {
    setBusy(label); setMsg(null);
    try { setMsg({ ok: true, text: await fn() }); await onDone(); }
    catch (e) { setMsg({ ok: false, text: e.message }); }
    finally { setBusy(""); }
  }

  if (info.pending) return <section className="actions"><p className="warn">The NEAR MPC network is signing a withdrawal. The Pusaka is locked until it finishes.</p></section>;

  const status = msg && <p className={msg.ok ? "ok" : "error"} role="status">{msg.text}</p>;
  const loan = info.loan;
  const act = (label, idle, busyText, fn, ghost) => !accountId ? (
    <button onClick={() => connector.connect()}>Connect NEAR wallet to {idle.charAt(0).toLowerCase() + idle.slice(1)}</button>
  ) : (
    <button className={ghost ? "ghost" : undefined} disabled={!!busy} onClick={() => run(label, fn)}>
      {busy === label ? busyText : idle}
    </button>
  );

  if (loan) {
    const funded = !!loan.lender;
    const due = funded && Number(loan.due_ms);
    const overdue = funded && now >= due;
    const terms = <>borrow <strong>{near(loan.principal)} NEAR</strong>, repay <strong>{near(loan.repay)} NEAR</strong> within {days(loan.duration_ms)}</>;
    return (
      <section className="actions">
        <h2>Loan</h2>
        {!funded && <p>{isOwner ? "You asked to" : `${loan.borrower} asks to`} {terms}, with this Pusaka and its {btc(Number(info.verified_sats))} verified BTC as collateral.</p>}
        {px && (() => {
          const st = loanStats(loan, Number(info.verified_sats), px);
          return (
            <p className="stats">
              Loan {usd(st.principalUsd)}, collateral {usd(st.collateralUsd)}: loan-to-value <strong>{Number.isFinite(st.ltv) ? pct(st.ltv) : "no verified collateral"}</strong>,
              interest <strong>{pct(st.apr)} a year</strong>. Mainnet prices from mempool.space and Rhea.
            </p>
          );
        })()}
        {funded && <p>{loan.borrower} borrowed {near(loan.principal)} NEAR from {loan.lender}. {near(loan.repay)} NEAR {overdue ? "was" : "is"} due {when(due)}.</p>}
        {!funded && isOwner && act("cancel-loan", "Cancel loan request", "Cancelling…", async () => {
          await callGasless("cancel_loan_request", { token_id: id });
          return "Loan request cancelled. The Pusaka is unlocked.";
        }, true)}
        {!funded && !isOwner && <>
          {act("lend", `Lend ${near(loan.principal)} NEAR`, "Lending…", async () => {
            await call("fund_loan", { token_id: id, expected_sign_epoch: info.sign_epoch, principal: loan.principal, repay: loan.repay, duration_ms: loan.duration_ms }, { deposit: BigInt(loan.principal) });
            return "Loan funded. The NEAR went to the borrower.";
          })}
          <p className="muted">If {near(loan.repay)} NEAR isn't repaid in time, you can take the Pusaka and the {btc(Number(info.verified_sats))} verified BTC inside it. While the loan runs, nobody can withdraw, sell or move it.</p>
        </>}
        {funded && accountId !== loan.lender && act("repay", `Repay ${near(loan.repay)} NEAR`, "Repaying…", async () => {
          await call("repay_loan", { token_id: id }, { deposit: BigInt(loan.repay) });
          return "Loan repaid. The Pusaka is unlocked.";
        })}
        {funded && accountId === loan.lender && (overdue
          ? act("claim", "Take the Pusaka", "Claiming…", async () => {
            await callGasless("claim_collateral", { token_id: id });
            return `Pusaka #${id} and its BTC are yours.`;
          })
          : <p className="muted">If it isn't repaid by then, you can take the Pusaka here.</p>)}
        {status}
      </section>
    );
  }

  if (!isOwner) {
    if (!info.listing) return <section className="actions"><p className="muted">This Pusaka isn't for sale or asking for a loan.</p></section>;
    const now = info.price_now ?? info.listing.price;
    const falling = info.listing.floor !== info.listing.price;
    return (
      <section className="actions">
        {act("buy", `Buy for ${near(now)} NEAR`, "Buying…", async () => {
          // A Dutch auction price only falls, so paying today's price always covers it; the rest is refunded.
          await call("buy", { token_id: id, expected_sign_epoch: info.sign_epoch }, { deposit: BigInt(now) });
          return `You own Pusaka #${id} and the ${btc(Number(info.verified_sats))} BTC inside it.`;
        })}
        {px && Number(info.verified_sats) > 0 && (() => {
          const paid = Number(BigInt(now) / 10n ** 18n) / 1e6 * px.nearUsd;
          const inside = Number(info.verified_sats) / 1e8 * px.btcUsd;
          const diff = paid / inside - 1;
          return <p className="stats">You pay about {usd(paid)} for {usd(inside)} of BTC: {diff < 0 ? `${pct(-diff)} below` : `${pct(diff)} above`} its value at mainnet prices.</p>;
        })()}
        <p className="muted">
          You get {btc(Number(info.verified_sats))} BTC (verified on NEAR). The NEAR goes to {info.listing.seller}.
          {falling && <> Price falls to {near(info.listing.floor)} NEAR by {when(info.listing.end_ms)}.</>}
        </p>
        {status}
      </section>
    );
  }

  if (info.listing) return (
    <section className="actions">
      <p>Listed at <strong>{near(info.price_now ?? info.listing.price)} NEAR</strong>
        {info.listing.floor !== info.listing.price && <>, falling to {near(info.listing.floor)} NEAR by {when(info.listing.end_ms)}</>}.
        Withdrawals are locked while it's for sale.</p>
      {act("cancel", "Cancel listing", "Cancelling…", async () => {
        await callGasless("cancel_listing", { token_id: id });
        return "Listing cancelled. You can withdraw again.";
      }, true)}
      {status}
    </section>
  );

  return <OwnerForms t={t} busy={busy} run={run} status={status} />;
}

function OwnerForms({ t, busy, run, status }) {
  const { id, bal } = t;
  const [price, setPrice] = useState("1");
  const [floor, setFloor] = useState("");
  const [hours, setHours] = useState("24");
  const [principal, setPrincipal] = useState("1");
  const [repay, setRepay] = useState("1.1");
  const [loanDays, setLoanDays] = useState("7");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const FEE = 300;
  const spendableSats = bal.safe + bal.pending;

  function sell(e) {
    e.preventDefault();
    const auction = floor !== "" && Number(floor) < Number(price);
    run("list", async () => {
      await callGasless("list", {
        token_id: id,
        price: yocto(price).toString(),
        ...(auction && { floor: yocto(floor).toString(), duration_ms: String(Math.round(Number(hours) * 3_600_000)) }),
      });
      return auction ? `Listed at ${price} NEAR, falling to ${floor} NEAR over ${hours} h.` : `Listed for ${price} NEAR.`;
    });
  }

  function borrow(e) {
    e.preventDefault();
    run("borrow", async () => {
      await callGasless("request_loan", {
        token_id: id,
        principal: yocto(principal).toString(),
        repay: yocto(repay).toString(),
        duration_ms: String(Math.round(Number(loanDays) * DAY_MS)),
      });
      return "Loan request posted. The Pusaka is locked until it's cancelled, repaid or claimed.";
    });
  }

  function withdraw(e) {
    e.preventDefault();
    run("withdraw", async () => {
      const sats = Math.round(Number(amount) * 1e8);
      let script;
      try { script = scriptHex(to); } catch { // checked before anything is signed
        throw new Error(`That isn't a Bitcoin ${NETWORK} address. It should start with ${BTC_PREFIX}.`);
      }
      const ins = [...bal.spendable].sort((a, b) => b.value - a.value).slice(0, 8);
      const signed = await call("withdraw", {
        token_id: id,
        utxos: ins.map((u) => ({ txid: u.txid, vout: u.vout, value: String(u.value) })),
        to_script_hex: script, amount_sat: String(sats), fee_sat: String(FEE),
      }, { deposit: WITHDRAW_DEPOSIT, tgas: 300 });
      const txid = await broadcast(finalize(signed, ins.map((u) => u.value)).toHex());
      return <>Sent. <a href={`${EXPLORER}/tx/${txid}`} target="_blank" rel="noreferrer">View the Bitcoin transaction</a></>;
    });
  }

  return (
    <section className="actions">
      <form onSubmit={sell} className="stack">
        <h2>Sell</h2>
        <label>Price
          <span className="row"><input type="number" min="0.01" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} required /> NEAR</span>
        </label>
        <label>Lower it over time to (optional)
          <span className="row">
            <input type="number" min="0.01" step="0.01" max={price} value={floor} onChange={(e) => setFloor(e.target.value)} placeholder="no auction" /> NEAR over
            <input type="number" min="0.1" step="0.1" value={hours} onChange={(e) => setHours(e.target.value)} disabled={floor === ""} /> h
          </span>
        </label>
        <button disabled={!!busy}>{busy === "list" ? "Listing…" : "List for sale"}</button>
      </form>
      <form onSubmit={borrow} className="stack">
        <h2>Borrow against it</h2>
        <label>Borrow
          <span className="row"><input type="number" min="0.01" step="0.01" value={principal} onChange={(e) => setPrincipal(e.target.value)} required /> NEAR</span>
        </label>
        <label>Repay
          <span className="row"><input type="number" min={principal} step="0.01" value={repay} onChange={(e) => setRepay(e.target.value)} required /> NEAR within
            <input type="number" min="0.001" step="any" value={loanDays} onChange={(e) => setLoanDays(e.target.value)} required /> days</span>
        </label>
        {Number(t.info.verified_sats) === 0 && <p className="warn">This Pusaka has no BTC verified on NEAR, so lenders will see no collateral.</p>}
        <button disabled={!!busy}>{busy === "borrow" ? "Posting…" : "Ask for a loan"}</button>
        <p className="muted">A lender sends you the NEAR. If you don't repay in time, they take this Pusaka and its BTC.</p>
      </form>
      <form onSubmit={withdraw} className="stack">
        <h2>Withdraw</h2>
        <label>Send Bitcoin to
          <input value={to} onChange={(e) => setTo(e.target.value)} placeholder={`${BTC_PREFIX}q…`} required spellCheck="false" />
        </label>
        <label>Amount
          <span className="row"><input type="number" min="0.00000546" step="0.00000001" max={(spendableSats - FEE) / 1e8}
            value={amount} onChange={(e) => setAmount(e.target.value)} required /> BTC</span>
        </label>
        <button disabled={!!busy || spendableSats === 0}>{busy === "withdraw" ? "Signing with NEAR MPC… (about 15 s)" : "Withdraw"}</button>
        <p className="muted">Network fee {FEE} sats. Change goes back into this Pusaka.</p>
      </form>
      {status}
    </section>
  );
}
