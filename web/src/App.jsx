import { useCallback, useEffect, useRef, useState } from "react";
import {
  CONTRACT, EXPLORER, MARKET, MINT_DEPOSIT, WITHDRAW_DEPOSIT, MPC, NEAR_EXPLORER, NETWORK, NET,
  balances, broadcast, btcAddress, finalize, scriptHex, depositProof, PROVE_DEPOSIT, prices, loanStats, mintedTokenId, recentActivity,
  EVM_CHAINS, evmAddress, evmBalances, evmTxParams, evmTx, finalizeEth, broadcastEth,
  SOL, solAddress, solBalances, solBlockhash, finalizeSol, broadcastSol, isSolAddress,
  nearAccount, nearBalances, nearTxParams, finalizeNear, broadcastNear, NBTC, nbtcDepositAddress, nbtcBalances,
  ckdAppId, ckdEphemeral, ckdSecret, ckdKey, sealCkd, openCkd, LETTER_PURPOSE,
} from "@pusaka/shared";
import { formatEther, formatUnits, parseEther, parseUnits, isAddress } from "viem";
import Emblem from "./Emblem.jsx";
import { call, callGasless, callRaw, connector, near, provider, view, yocto } from "./near.js";

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

/** `light`: what a gallery card shows (contract state + BTC), without the EVM, SOL and NEAR lookups (~9 RPC calls each). */
async function loadToken(id, { light = false } = {}) {
  const info = await view("token_info", { token_id: id });
  if (!info) return null;
  const address = info.btc_pubkey ? btcAddress(info.btc_pubkey) : null;
  let bal = { safe: 0, pending: 0, atRisk: 0, spendable: [] };
  if (address) bal = await balances(address, info.signed_outpoints).catch(() => ({ ...bal, error: true }));
  if (light) return { id, info, address, bal };
  let eth = null;
  if (info.btc_pubkey) {
    const ethAddr = evmAddress(info.btc_pubkey);
    eth = {
      address: ethAddr,
      chains: await Promise.all(EVM_CHAINS.map(async (c) => {
        const floor = await view("eth_nonce_floor", { token_id: id, chain_id: String(c.chain.id) });
        return evmBalances(ethAddr, floor, c.chain.id).then((b) => ({ ...b, c, floor })).catch(() => ({ c, error: true }));
      })),
      // USDC attested by NEAR MPC (foreign-tx verification), counted by the contract itself
      verified: await view("usdc_info", { token_id: id }).catch(() => []),
    };
  }
  // The Ed25519 key (MPC domain 1) is both a Solana address and a NEAR implicit account.
  const [sol, nearAcct] = await Promise.all([
    solAddress(id).then((a) => solBalances(a, info.history).then((b) => ({ ...b, address: a })).catch(() => ({ address: a, error: true }))).catch(() => null),
    nearAccount(id).then(async (a) => {
      const floor = await view("near_nonce_floor", { token_id: id });
      return nearBalances(a, floor).then((b) => ({ ...b, address: a, floor })).catch(() => ({ address: a, floor, error: true }));
    }).catch(() => null),
  ]);
  return { id, info, address, bal, eth, sol, nearAcct };
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
  if (/^#?\/?$/.test(hash)) return null; // home
  const m = hash.match(/^#\/pusaka\/(\d{1,30})\/?$/);
  return m ? String(BigInt(m[1])) : "bad"; // "007" is #7; "1abc", "-1" and "#/x" aren't pages
}

// ---------- app ----------

export default function App() {
  const accountId = useAccount();
  const tokenId = useRoute();
  useEffect(() => {
    document.title = tokenId && tokenId !== "bad" ? `Pusaka #${tokenId} — an NFT that holds real Bitcoin` : "Pusaka — NFTs that hold real Bitcoin";
  }, [tokenId]);
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
      <main>{tokenId === "bad"
        ? <section><h2>Page not found</h2><p className="error">There's nothing at {location.hash}. <a href="#/">See all Pusaka</a></p></section>
        : tokenId ? <Detail key={tokenId} id={tokenId} accountId={accountId} /> : <Home />}</main>
      <footer>
        <p>
          Contract <a href={`${NEAR_EXPLORER}/account/${CONTRACT}`}>{CONTRACT}</a>. Signatures by NEAR Chain
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
      .then((ts) => Promise.allSettled(ts.map((t) => loadToken(t.token_id, { light: true }))))
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

      <Activity />

      <section className="gallery" aria-label="All Pusaka">
        {error && <p className="error">{error}</p>}
        {!tokens && !error && <p className="muted">Reading the contract…</p>}
        {tokens?.length === 0 && <p className="muted">No Pusaka yet. Connect a wallet and mint the first one.</p>}
        {tokens?.map((t) => (
          <a key={t.id} href={`#/pusaka/${t.id}`} className="piece">
            <Emblem pubkey={t.info.btc_pubkey} sats={Number(t.info.verified_sats)} locked={!!t.info.listing || !!t.info.loan || t.info.pending || Object.keys(t.info.token.approved_account_ids ?? {}).length > 0} size={168} />
            <span className="piece-name">Pusaka #{t.id}</span>
            <span className="piece-btc">{btc(Number(t.info.verified_sats))} BTC verified</span>
            {t.bal.safe + t.bal.pending > Number(t.info.verified_sats) && <span className="piece-pending">+{btc(t.bal.safe + t.bal.pending - Number(t.info.verified_sats))} not proven yet</span>}
            {t.info.listing && <span className="piece-price">For sale at {near(t.info.price_now ?? t.info.listing.price)} NEAR</span>}
            {!t.info.listing && Object.keys(t.info.token.approved_account_ids ?? {}).length > 0 && <span className="piece-price">On sale on Mintbase</span>}
            {t.info.loan && <span className="piece-price">{t.info.loan.lender ? "Collateral for a loan" : `Asking to borrow ${near(t.info.loan.principal)} NEAR`}</span>}
          </a>
        ))}
      </section>
    </>
  );
}

const ACTIVITY = {
  nft_mint: "minted a Pusaka", list: "listed one for sale", cancel_listing: "took one off sale", buy: "bought one",
  withdraw: "withdrew BTC", withdraw_eth: "withdrew ETH", prove_deposit: "proved a BTC deposit",
  request_loan: "asked for a loan", cancel_loan_request: "cancelled a loan request", fund_loan: "funded a loan",
  repay_loan: "repaid a loan", claim_collateral: "claimed collateral", nft_approve: "listed one on Mintbase",
  nft_revoke_all: "stopped selling on Mintbase", nft_transfer: "transferred one", migrate: "upgraded the contract",
  DeployContract: "upgraded the contract",
};

/** Latest contract transactions from FastNear's indexer, each linking to the explorer. */
function Activity() {
  const [rows, setRows] = useState(null);
  const [now] = useState(() => Date.now());
  useEffect(() => { recentActivity(6).then(setRows).catch(() => setRows([])); }, []);
  if (!rows?.length) return null;
  const ago = (ms) => { const m = Math.max(0, Math.round((now - ms) / 60_000)); return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
  return (
    <section className="activity" aria-label="Latest on-chain activity">
      <h2>Latest on NEAR</h2>
      <ul>
        {rows.map((r) => (
          <li key={r.hash}>
            <a href={`${NEAR_EXPLORER}/tx/${r.hash}`} target="_blank" rel="noreferrer">
              {String(r.by ?? r.signer)} {r.receiver === MARKET && r.method === "buy" ? "bought one on Mintbase"
                : Object.hasOwn(ACTIVITY, r.method) ? ACTIVITY[r.method] : `called ${String(r.method).slice(0, 40)}`}
            </a>
            {r.by && <span className="muted"> (gas paid by {String(r.signer)})</span>}
            {!r.ok && <span className="muted"> (failed)</span>}
            <span className="muted"> · {ago(r.at)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------- detail ----------

function Detail({ id, accountId }) {
  const [t, setT] = useState(null);
  const [missing, setMissing] = useState(false);
  const [failed, setFailed] = useState(false);
  const refresh = useCallback(() => loadToken(id)
    .then((x) => { setFailed(false); if (x) setT(x); else setMissing(true); })
    .catch(() => setFailed(true)), [id]);
  useEffect(() => { refresh(); }, [refresh]);
  const px = usePrices(); // hooks before any early return

  if (missing) return <p className="error">There is no Pusaka #{id}. <a href="#/">See all Pusaka</a></p>;
  if (!t && failed) return <p className="error">Couldn't reach NEAR to load Pusaka #{id}. <button onClick={refresh}>Try again</button></p>;
  if (!t) return <p className="muted">Loading Pusaka #{id}…</p>;

  const { info, address, bal } = t;
  const owner = info.token.owner_id;
  const isOwner = accountId === owner;
  const locked = !!info.listing || !!info.loan || info.pending || Object.keys(info.token.approved_account_ids ?? {}).length > 0;

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
          <p className="badge-line">
            <img src={`/api/badge?id=${id}`} alt={`Pusaka #${id}: ${btc(Number(info.verified_sats))} BTC verified`} height="22" />
            <CopyButton label="Copy badge for a README or post" text={`[![Pusaka #${id}](${location.origin}/api/badge?id=${id})](${location.origin}/#/pusaka/${id})`} />
          </p>
        </section>

        {t.eth && <EthSection t={t} canWithdraw={isOwner && !locked} onDone={refresh} />}
        {t.sol && <SolSection t={t} canWithdraw={isOwner && !locked} onDone={refresh} />}
        {t.nearAcct && <NearAccountSection t={t} canWithdraw={isOwner && !locked} onDone={refresh} />}
        {t.nearAcct && <NbtcSection t={t} canWithdraw={isOwner && !locked} onDone={refresh} />}

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

        <HolderRoom id={id} owner={owner} accountId={accountId} canSeal={isOwner && !locked} onDone={refresh} extra={info.token.metadata?.extra} />

        <section>
          <h2>History</h2>
          <Ledger history={info.history} />
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
  const [chainId, setChainId] = useState(String(EVM_CHAINS[0].chain.id));
  const [asset, setAsset] = useState("ETH");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const c = EVM_CHAINS.find((x) => String(x.chain.id) === chainId);
  const funded = eth.chains.some((b) => b.wei > 0n);

  async function send(e) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const dest = to.trim(); // pasted addresses often carry a space or newline
      if (!isAddress(dest, { strict: false })) throw new Error("That isn't an Ethereum address (0x followed by 40 hex characters).");
      if (!isAddress(dest)) throw new Error("That address's mixed-case checksum doesn't match: it may have a typo. Check it, or paste it all in lower case.");
      const erc20 = asset === "USDC" ? c.usdc : undefined;
      const value = erc20 ? parseUnits(amount, 6) : parseEther(amount);
      // parseUnits rounds below the token's precision: 0.0000001 USDC is 0, which would only burn a nonce
      if (value <= 0n) throw new Error(`Enter more than 0 ${asset}${erc20 ? " (USDC has 6 decimals)" : ""}.`);
      const tx = evmTx({ ...(await evmTxParams(eth.address, c.chain.id, erc20)), to: dest, value, erc20 });
      const signed = await call("withdraw_eth", {
        token_id: id, chain_id: String(c.chain.id), nonce: String(tx.nonce), to: dest,
        value_wei: String(value), gas_limit: String(tx.gas),
        max_fee_per_gas: String(tx.maxFeePerGas), max_priority_fee_per_gas: String(tx.maxPriorityFeePerGas),
        ...(erc20 && { erc20 }),
      }, { deposit: WITHDRAW_DEPOSIT, tgas: 150 });
      const hash = await broadcastEth(await finalizeEth(tx, signed, eth.address), c.chain.id);
      setMsg({ ok: true, text: <>Sent. <a href={`${c.explorer}/tx/${hash}`} target="_blank" rel="noreferrer">View on {c.chain.name}</a></> });
      await onDone();
    } catch (err) { setMsg({ ok: false, text: err.shortMessage ?? err.message }); }
    finally { setBusy(false); }
  }

  return (
    <section>
      <h2>Ether and USDC inside</h2>
      <p className="muted">The same key controls one address on every EVM chain. Pusaka signs for these:</p>
      <table className="chains">
        <thead><tr><th>Chain</th><th>ETH</th><th>USDC</th><th>USDC verified on NEAR</th></tr></thead>
        <tbody>{eth.chains.map((b) => (
          <tr key={b.c.chain.id}>
            <td><a href={`${b.c.explorer}/address/${eth.address}`} target="_blank" rel="noreferrer">{b.c.chain.name}</a></td>
            {b.error ? <td colSpan="2" className="error">unreachable</td> : <>
              <td>{eth6(b.safe)}{b.atRisk > 0n && <span className="warn-inline"> +{eth6(b.atRisk)} at risk</span>}</td>
              <td>{formatUnits(b.usdcSafe, 6)}{b.usdcAtRisk > 0n && <span className="warn-inline"> +{formatUnits(b.usdcAtRisk, 6)} at risk</span>}</td>
            </>}
            {(() => {
              const v = eth.verified.find((x) => Number(x.chain_id) === b.c.chain.id);
              return <td>{v ? formatUnits(BigInt(v.verified), 6) : <span className="muted" title="NEAR MPC doesn't verify this chain">n/a</span>}</td>;
            })()}
          </tr>))}
        </tbody>
      </table>
      <p className="muted">USDC verified on NEAR: deposits the NEAR MPC network read on a finalized block and attested (foreign-transaction verification), minus every USDC this contract ever signed out. Trust it without any EVM RPC.</p>
      {eth.chains.some((b) => b.atRisk > 0n || b.usdcAtRisk > 0n) && <p className="warn">Amounts marked at risk have a signed transaction that hasn't been used on that chain yet, so it could still move them.</p>}
      <p className="addr"><span>{eth.address}</span> <CopyButton text={eth.address} /></p>
      {canWithdraw && funded && (
        <form onSubmit={send} className="stack">
          <label>From <span className="row">
            <select value={chainId} onChange={(e) => setChainId(e.target.value)}>{EVM_CHAINS.map((x) => <option key={x.chain.id} value={x.chain.id}>{x.chain.name}</option>)}</select>
            <select value={asset} onChange={(e) => setAsset(e.target.value)}><option>ETH</option><option>USDC</option></select>
          </span></label>
          <label>Send to <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="0x…" required spellCheck="false" /></label>
          <label>Amount <span className="row"><input type="number" min="0" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} required /> {asset}</span></label>
          <button disabled={busy}>{busy ? "Signing with NEAR MPC…" : `Withdraw ${asset}`}</button>
        </form>
      )}
      {msg && <p className={msg.ok ? "ok" : "error"} role="status">{msg.text}</p>}
    </section>
  );
}

const sol9 = (l) => (Number(l) / 1e9).toLocaleString(undefined, { maximumFractionDigits: 9 });

function SolSection({ t, canWithdraw, onDone }) {
  const { id, sol } = t;
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  async function send(e) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      if (!isSolAddress(to)) throw new Error("That isn't a Solana address.");
      const signed = await call("withdraw_sol", {
        token_id: id, to: to.trim(), lamports: String(BigInt(Math.round(Number(amount) * 1e9))), recent_blockhash: await solBlockhash(),
      }, { deposit: 1n, tgas: 300 });
      if (signed.from !== sol.address) throw new Error("The contract signed for a different address.");
      const sig = await broadcastSol(finalizeSol(signed));
      setMsg({ ok: true, text: <>Sent. <a href={SOL.explorer(`tx/${sig}`)} target="_blank" rel="noreferrer">View on Solana Explorer</a></> });
      await onDone();
    } catch (err) { setMsg({ ok: false, text: err.message }); }
    finally { setBusy(false); }
  }

  return (
    <section>
      <h2>SOL inside ({SOL.name})</h2>
      <p className="muted">A second MPC key, Ed25519, belongs to this Pusaka too. It is a Solana address.</p>
      {sol.error ? <p className="error">Couldn't reach {SOL.name}, so the SOL balance is unknown.</p> : <>
        <p className="amount small"><span>{sol9(sol.safe)}</span> SOL</p>
        {sol.atRisk > 0n && <p className="warn">{sol9(sol.atRisk)} SOL is at risk until {new Date(sol.clearAt).toLocaleTimeString()}: a SOL transfer was signed in the last few minutes, and it stays valid until its blockhash expires.</p>}
      </>}
      <p className="addr"><a href={SOL.explorer(`address/${sol.address}`)} target="_blank" rel="noreferrer">{sol.address}</a> <CopyButton text={sol.address} /></p>
      {canWithdraw && sol.lamports > 0n && (
        <form onSubmit={send} className="stack">
          <label>Send SOL to <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="Solana address" required spellCheck="false" /></label>
          <label>Amount <span className="row"><input type="number" min="0.000000001" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} required /> SOL</span></label>
          <button disabled={busy}>{busy ? "Signing with NEAR MPC…" : "Withdraw SOL"}</button>
        </form>
      )}
      {msg && <p className={msg.ok ? "ok" : "error"} role="status">{msg.text}</p>}
    </section>
  );
}

function NearAccountSection({ t, canWithdraw, onDone }) {
  const { id, nearAcct: a } = t;
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  async function send(e) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const { nonce, blockHash } = await nearTxParams(a.address);
      const signed = await call("withdraw_near", {
        token_id: id, receiver_id: to.trim(), amount: yocto(amount).toString(), nonce: String(nonce), block_hash: blockHash,
      }, { deposit: 10_000_000_000_000_000_000_000n, tgas: 300 });
      if (signed.account !== a.address) throw new Error("The contract signed for a different account.");
      const hash = await broadcastNear(await finalizeNear(signed));
      setMsg({ ok: true, text: <>Sent. <a href={`${NEAR_EXPLORER}/tx/${hash}`} target="_blank" rel="noreferrer">View on NEAR</a></> });
      await onDone();
    } catch (err) { setMsg({ ok: false, text: err.message }); }
    finally { setBusy(false); }
  }

  return (
    <section>
      <h2>Its own NEAR account</h2>
      <p className="muted">The Ed25519 key is also a NEAR account. Anyone can send it NEAR; only the holder of this NFT
        can move it, and only as plain transfers, so no one can add a key and keep it after a sale.</p>
      {a.error ? <p className="error">Couldn't read the account.</p> : <>
        <p className="amount small"><span>{near(a.safe)}</span> NEAR</p>
        {a.atRisk > 0n && <p className="warn">{near(a.atRisk)} NEAR is at risk: a signed transfer for nonce {a.floor} hasn't been used yet.</p>}
        {!a.exists && <p className="muted">Empty so far. Send NEAR to the account below to create it.</p>}
      </>}
      <p className="addr"><a href={`${NEAR_EXPLORER}/account/${a.address}`} target="_blank" rel="noreferrer">{a.address}</a> <CopyButton text={a.address} /></p>
      {canWithdraw && a.yocto > 0n && (
        <form onSubmit={send} className="stack">
          <label>Send NEAR to <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="name.testnet" required spellCheck="false" /></label>
          <label>Amount <span className="row"><input type="number" min="0.0001" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} required /> NEAR</span></label>
          <button disabled={busy}>{busy ? "Signing with NEAR MPC…" : "Withdraw NEAR"}</button>
        </form>
      )}
      {msg && <p className={msg.ok ? "ok" : "error"} role="status">{msg.text}</p>}
    </section>
  );
}

/** nBTC (Omni Bridge) in the Pusaka's NEAR account: native BTC sent to the Omni connector becomes NEP-141 nBTC there. */
function NbtcSection({ t, canWithdraw, onDone }) {
  const { id, nearAcct: a } = t;
  const [state, setState] = useState(null);
  const [to, setTo] = useState("");
  const [sats, setSats] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  useEffect(() => {
    if (!a?.address) return;
    Promise.all([
      // the floor straight from the contract: a missing floor must never read as "no signature out"
      view("near_nonce_floor", { token_id: id }).then((floor) => nbtcBalances(a.address, floor)).catch(() => null),
      nbtcDepositAddress(a.address).catch(() => null),
    ]).then(([b, deposit]) => setState(b ? { balance: b.sats, safe: b.safe, atRisk: b.atRisk, deposit } : { unknown: true, balance: 0n, deposit }));
  }, [a?.address, id]);
  if (!a?.address || !state) return null;

  async function send(e) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const receiver = to.trim().toLowerCase();
      if (!/^\d+$/.test(sats) || BigInt(sats) <= 0n || BigInt(sats) > state.balance) throw new Error(`Enter whole sats, up to ${state.balance}.`);
      if (!(await provider.callFunction({ contractId: NBTC, method: "storage_balance_of", args: { account_id: receiver } }))) {
        throw new Error(`${receiver} isn't registered with ${NBTC} yet (NEP-145 storage_deposit), so nBTC can't be sent there.`);
      }
      const { nonce, blockHash } = await nearTxParams(a.address);
      const signed = await call("withdraw_nbtc", { token_id: id, receiver_id: receiver, sats, nonce: String(nonce), block_hash: blockHash },
        { deposit: 10_000_000_000_000_000_000_000n, tgas: 300 });
      if (signed.account !== a.address) throw new Error("The contract signed for a different account.");
      const hash = await broadcastNear(await finalizeNear(signed));
      setMsg({ ok: true, text: <>Sent. <a href={`${NEAR_EXPLORER}/tx/${hash}`} target="_blank" rel="noreferrer">View on NEAR</a></> });
      await onDone();
    } catch (err) { setMsg({ ok: false, text: err.message }); }
    finally { setBusy(false); }
  }

  return (
    <section>
      <h2>nBTC on NEAR</h2>
      {state.unknown
        ? <p className="error">Couldn't read its nBTC or its signing record right now; nothing here is counted as safe.</p>
        : <p className="amount small"><span>{state.safe.toLocaleString()}</span> nBTC sats in its NEAR account</p>}
      {state.atRisk > 0n && <p className="warn">{state.atRisk.toLocaleString()} nBTC sats are at risk: a transaction signed from this account (nonce {String(a.floor)}) hasn't been used yet, so it could still move them.</p>}
      <p className="muted">Withdraw this Pusaka's BTC to the Omni Bridge address below and Near-One's relayer, checking it against
        the same Bitcoin light client, mints nBTC (NEP-141) into the Pusaka's own NEAR account. It moves with the NFT, and
        only its holder can send it: the contract signs one `ft_transfer` on {NBTC}, nothing else.</p>
      {state.deposit && <p className="addr"><span>{state.deposit}</span> <CopyButton text={state.deposit} label="Copy deposit address" /></p>}
      {canWithdraw && state.balance > 0n && (
        <form onSubmit={send} className="stack">
          <label>Send nBTC to <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="name.testnet" required spellCheck="false" autoCapitalize="none" /></label>
          <label>Amount <span className="row"><input value={sats} onChange={(e) => setSats(e.target.value.trim())} inputMode="numeric" placeholder={String(state.balance)} required /> sats</span></label>
          <button disabled={busy}>{busy ? "Signing with NEAR MPC…" : "Send nBTC"}</button>
        </form>
      )}
      {msg && <p className={msg.ok ? "ok" : "error"} role="status">{msg.text}</p>}
    </section>
  );
}

const accessMessage = (id, at) => `Open the holder room of Pusaka #${id}\nat ${at}`; // same text as api/_holder.mjs

/** Gated: only the current holder, proven by a NEP-413 signed message, gets the room's content. */
function HolderRoom({ id, owner, accountId, canSeal, onDone, extra: extraJson }) {
  const [room, setRoom] = useState(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState(null);
  useEffect(() => { setRoom(null); }, [id, accountId]);

  const ask = async (body) => {
    const r = await fetch("/api/holder", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error ?? `holder room answered ${r.status}`);
    return j;
  };

  async function enter() {
    setBusy("open"); setMsg(null);
    try {
      const wallet = await connector.wallet();
      const at = Date.now();
      const nonce = crypto.getRandomValues(new Uint8Array(32));
      const message = accessMessage(id, at);
      const s = await wallet.signMessage({ message, recipient: location.host, nonce });
      const a = { accountId: s.accountId, publicKey: s.publicKey, signature: s.signature, message, at,
        nonce: btoa(String.fromCharCode(...nonce)) };
      setRoom(await ask({ token_id: id, auth: a }));
    } catch (e) { setMsg({ ok: false, text: e.message }); }
    finally { setBusy(""); }
  }

  const extra = (() => { try { return JSON.parse(extraJson ?? "{}"); } catch { return {}; } })();
  const ckdLetter = extra.letter?.startsWith("ckd1:");

  /** One wallet call: the contract asks NEAR MPC for the key, encrypted to a one-time key only this tab holds. */
  async function mpcKey(writeNonce) {
    const eph = ckdEphemeral();
    const [answer, mpcPk] = await Promise.all([
      call("letter_key", { token_id: id, app_public_key: eph.appPublicKey, ...(writeNonce && { write_nonce: writeNonce }) }, { deposit: 1n, tgas: 100 }),
      provider.callFunction({ contractId: MPC, method: "public_key", args: { domain_id: 2 } }),
    ]);
    const path = writeNonce ? `letter:${id}:${accountId}:${writeNonce}` : extra.letter_path;
    // throws unless the answer verifies against the MPC's public key
    return { key: ckdKey(ckdSecret(answer, eph.a, ckdAppId(CONTRACT, path), mpcPk), LETTER_PURPOSE), path };
  }

  async function openWithMpc() {
    setBusy("open"); setMsg(null);
    try {
      const { key } = await mpcKey();
      setRoom({ letter: await openCkd(key, id, extra.letter), creator: extra.creator ?? null, ckd: true });
    } catch (e) { setMsg({ ok: false, text: e.message }); }
    finally { setBusy(""); }
  }

  async function sealLetter(e) {
    e.preventDefault();
    setBusy("seal"); setMsg(null);
    try {
      // Sealed in this tab with a NEAR MPC confidential key: the server never sees the key or the text.
      const { key, path } = await mpcKey(Date.now().toString(36));
      const sealed = await sealCkd(key, id, text);
      await call("set_letter", { token_id: id, sealed, path }, { deposit: 10_000_000_000_000_000_000_000n });
      setRoom({ letter: text, creator: extra.creator ?? null, ckd: true });
      setText("");
      setMsg({ ok: true, text: "Sealed with a NEAR MPC key into the Pusaka. Only whoever holds it can get that key." });
      await onDone();
    } catch (err) { setMsg({ ok: false, text: err.message }); }
    finally { setBusy(""); }
  }

  const isHolder = accountId === owner;
  return (
    <section className="holder-room">
      <h2>Holder room</h2>
      <p className="muted">Each Pusaka carries a sealed letter that only its current holder can read. Sell it and the
        letter goes with it; the old holder is locked out the moment the NFT moves. New letters are sealed with a NEAR MPC
        confidential key that the contract only hands to the current holder: no server can read them.</p>
      {!room && (isHolder
        ? (ckdLetter || !extra.letter)
          ? <button onClick={ckdLetter ? openWithMpc : () => setRoom({ letter: null, creator: extra.creator ?? null })} disabled={!!busy}>
            {busy ? "Waiting for your wallet and NEAR MPC…" : ckdLetter ? "Open with the NEAR MPC key" : "Open"}</button>
          : <button onClick={enter} disabled={!!busy}>{busy ? "Waiting for your wallet…" : "Sign in to open"}</button>
        : <p className="muted">{accountId ? `Only ${owner} can open it.` : "Connect the wallet that holds this Pusaka to open it."}</p>)}
      {room && <>
        {room.letter ? <blockquote className="letter">{room.letter}</blockquote> : <p className="muted">No letter sealed in this Pusaka yet.</p>}
        {room.ckd && <p className="muted">Decrypted in this tab with a key from NEAR MPC (confidential key derivation), checked against the MPC's public key.</p>}
        {room.creator && <p className="muted">Created by {room.creator}. They receive a 2.5% royalty on every resale.</p>}
        {canSeal && (
          <form onSubmit={sealLetter} className="stack">
            <label>{room.letter ? "Replace the letter" : "Write a letter for the next holder"}
              <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} rows={4} required /></label>
            <button disabled={!!busy}>{busy === "seal" ? "Sealing…" : "Seal into this Pusaka"}</button>
          </form>
        )}
      </>}
      {msg && <p className={msg.ok ? "ok" : "error"} role="status">{msg.text}</p>}
    </section>
  );
}

/** Per-NFT ledger from its on-chain history: who held it, what it earned its holders, what went out. */
function Ledger({ history }) {
  const holders = [];
  let earned = 0n, royalties = 0n, borrowed = 0n;
  const out = [];
  for (const { event: e } of history) {
    const hold = (a) => { if (a && holders.at(-1) !== a) holders.push(a); };
    if (e.kind === "Mint") hold(e.owner);
    if (e.kind === "Sale") { hold(e.from); hold(e.to); earned += BigInt(e.price); }
    if (e.kind === "Transfer") { hold(e.from); hold(e.to); }
    if (e.kind === "LoanDefaulted") hold(e.lender);
    if (e.kind === "Royalty") royalties += BigInt(e.amount);
    if (e.kind === "LoanFunded") borrowed += 1n;
    if (e.kind === "Withdraw") out.push(`${Number(e.amount_sat).toLocaleString()} sats`);
    if (e.kind === "WithdrawEth" && e.signed && BigInt(e.value_wei) > 0n) out.push(`${formatEther(BigInt(e.value_wei))} ETH`);
    if (e.kind === "WithdrawErc20" && e.signed) out.push(`${formatUnits(BigInt(e.amount), 6)} USDC`);
    if (e.kind === "WithdrawSol" && e.signed) out.push(`${sol9(e.lamports)} SOL`);
    if (e.kind === "WithdrawNear" && e.signed) out.push(`${near(e.amount)} NEAR`);
    if (e.kind === "WithdrawNbtc" && e.signed) out.push(`${Number(e.sats).toLocaleString()} nBTC sats`);
  }
  // The contract keeps the latest 32 events; past that, the full record is in NEAR's NEP-297 logs.
  const partial = history.length > 0 && history[0].event.kind !== "Mint";
  const span = partial ? `in its last ${history.length} events` : "in total";
  return (
    <dl className="ledger">
      <dt>Held by</dt><dd>{partial && "… → "}{holders.join(" → ") || "—"}</dd>
      <dt>Sold for</dt><dd>{earned > 0n ? `${near(earned)} NEAR ${span}` : partial ? `no sale in its last ${history.length} events` : "never sold"}{royalties > 0n && `, of which ${near(royalties)} NEAR went to its creator`}</dd>
      <dt>Paid out</dt><dd>{out.length ? `${out.join(", ")} (signed by NEAR MPC${partial ? `, last ${history.length} events` : ""})` : "nothing yet"}</dd>
      {borrowed > 0n && <><dt>Loans</dt><dd>{String(borrowed)} funded against it{partial && " recently"}</dd></>}
      {partial && <><dt>Older</dt><dd>Earlier events are in the contract's <a href={`${NEAR_EXPLORER}/account/${CONTRACT}`} target="_blank" rel="noreferrer">NEP-297 logs on NEAR</a>.</dd></>}
    </dl>
  );
}

function CopyButton({ text, label = "Copy" }) {
  const [done, setDone] = useState(false);
  return (
    <button className="link" onClick={() => navigator.clipboard.writeText(text).then(() => setDone(true))}>
      {done ? "Copied" : label}
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
    case "WithdrawErc20": return `Signed a withdrawal of ${formatUnits(BigInt(e.amount), 6)} USDC on chain ${e.chain_id} (nonce ${e.nonce}${e.signed ? "" : ", signature failed"})`;
    case "WithdrawSol": return `Signed a withdrawal of ${sol9(e.lamports)} SOL${e.signed ? "" : " (signature failed)"}`;
    case "WithdrawNear": return `Signed a transfer of ${near(e.amount)} NEAR from its own account${e.signed ? "" : " (signature failed)"}`;
    case "WithdrawNbtc": return `Signed a transfer of ${Number(e.sats).toLocaleString()} nBTC sats from its own account${e.signed ? "" : " (signature failed)"}`;
    case "Royalty": return `Royalty of ${near(e.amount)} NEAR paid to its creator ${e.creator}`;
    case "Approved": return `Approved ${e.account} to sell it`;
    case "ApprovalsRevoked": return "Stopped selling on outside markets";
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

  const status = msg && <p className={msg.ok ? "ok" : "error"} role="status">{msg.text}</p>;

  if (info.pending) return (
    <section className="actions">
      <p className="warn">The NEAR MPC network is signing a withdrawal. The Pusaka is locked until it finishes.</p>
      {isOwner && <>
        {/* The contract enforces the timeout (~600 blocks); outpoints and nonce floors were recorded before signing. */}
        <p className="muted">Stuck for more than about 10 minutes? The callback may have run out of gas. You can release the lock; anything that was signed stays recorded.</p>
        <button className="ghost" disabled={!!busy} onClick={() => run("unlock", async () => {
          await call("unlock_stale", { token_id: id });
          return "Lock released.";
        })}>{busy === "unlock" ? "Releasing…" : "Release the lock"}</button>
        {status}
      </>}
    </section>
  );
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
    const markets = Object.keys(info.token.approved_account_ids ?? {});
    if (!info.listing && markets.length > 0) return (
      <section className="actions"><p>On sale through <code>{markets.join(", ")}</code>. While it is, its Bitcoin is locked:
        the owner can't withdraw it before the sale.</p></section>
    );
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
  const [heir, setHeir] = useState("");
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

  const approved = Object.keys(t.info.token.approved_account_ids ?? {});

  function sellOnMintbase(e) {
    e.preventDefault();
    run("mintbase", async () => {
      // Mintbase wants storage for the listing, then a NEP-178 approval carrying the price.
      await callRaw("deposit_storage", {}, { deposit: 10n ** 22n, receiver: MARKET });
      await call("nft_approve", { token_id: id, account_id: MARKET, msg: JSON.stringify({ price: yocto(price).toString() }) },
        { deposit: 10n ** 22n, tgas: 150 });
      return `Listed on Mintbase for ${price} NEAR. Bitcoin withdrawals and loans are locked until it sells or you stop.`;
    });
  }

  function stopElsewhere() {
    run("revoke", async () => {
      await call("nft_revoke_all", { token_id: id }, { deposit: 1n });
      return "No other market can sell this Pusaka now. Withdrawals are open again.";
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

  function give(e) {
    e.preventDefault();
    run("give", async () => {
      const receiver = heir.trim().toLowerCase();
      if (receiver === t.info.token.owner_id) throw new Error("That's you already.");
      // NEP-171 accepts any valid account id, even one nobody controls: a typo would lose the heirloom.
      const exists = await provider.viewAccount({ accountId: receiver, blockQuery: { finality: "final" } }).then(() => true, () => false);
      if (!exists) throw new Error(`${receiver} doesn't exist on NEAR ${NETWORK}. Check the name; a Pusaka given to an account nobody controls is lost.`);
      await call("nft_transfer", { receiver_id: receiver, token_id: id, memo: "given through Pusaka" }, { deposit: 1n, tgas: 50 });
      return `Pusaka #${id} now belongs to ${receiver}, with everything inside it.`;
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
        <button disabled={!!busy || approved.length > 0}>{busy === "list" ? "Listing…" : "List for sale"}</button>
        {MARKET && approved.length === 0 && (
          <button type="button" className="secondary" disabled={!!busy} onClick={sellOnMintbase}>
            {busy === "mintbase" ? "Listing on Mintbase…" : "List on Mintbase instead"}</button>
        )}
        {approved.length > 0 && (
          <div className="warn">
            <p>On sale through {approved.join(", ")}. Its Bitcoin can't be withdrawn or borrowed against until it sells or you stop.</p>
            <button type="button" disabled={!!busy} onClick={stopElsewhere}>{busy === "revoke" ? "Stopping…" : "Stop selling elsewhere"}</button>
          </div>
        )}
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
          <span className="row"><input type="number" min="0.00000546" step="0.00000001" max={Math.max(0, spendableSats - FEE) / 1e8}
            value={amount} onChange={(e) => setAmount(e.target.value)} required /> BTC</span>
        </label>
        <button disabled={!!busy || spendableSats <= FEE}>{busy === "withdraw" ? "Signing with NEAR MPC… (about 15 s)" : "Withdraw"}</button>
        <p className="muted">Network fee {FEE} sats. Change goes back into this Pusaka.</p>
      </form>
      <form onSubmit={give} className="stack">
        <h2>Give it to someone</h2>
        <label>Their NEAR account
          <input value={heir} onChange={(e) => setHeir(e.target.value)} placeholder={NETWORK === "mainnet" ? "name.near" : "name.testnet"} required spellCheck="false" autoCapitalize="none" />
        </label>
        <button disabled={!!busy}>{busy === "give" ? "Giving…" : "Give this Pusaka"}</button>
        <p className="muted">Everything inside moves with it, BTC, ETH, SOL, its NEAR account and the letter, in one NEAR transaction. No sale, no royalty.</p>
      </form>
      {status}
    </section>
  );
}
