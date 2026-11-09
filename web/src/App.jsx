import { useCallback, useEffect, useRef, useState } from "react";
import {
  CONTRACT, EXPLORER, MARKET, BTC_LIGHT_CLIENT, MINT_DEPOSIT, WITHDRAW_DEPOSIT, MPC, NEAR_EXPLORER, NETWORK, NET,
  balances, broadcast, btcAddress, finalize, scriptHex, depositProof, PROVE_DEPOSIT, prices, loanStats, mintedTokenId, recentActivity, refusals,
  EVM_CHAINS, evmAddress, evmBalances, evmTxParams, evmTx, finalizeEth, broadcastEth,
  SOL, solAddress, solBalances, solBlockhash, finalizeSol, broadcastSol, isSolAddress,
  nearAccount, nearBalances, nearTxParams, finalizeNear, broadcastNear, NBTC, nbtcDepositAddress, nbtcBalances, stakingPools, stakeBalances,
  exitQuote,
} from "@pusaka/shared";
import { formatEther, formatUnits, parseEther, parseUnits, isAddress } from "viem";
import { Account, KeyPair } from "near-api-js";
import Emblem from "./Emblem.jsx";
import Field from "./Field.jsx";
import { AuctionClock, BtcQr, Bell, GallerySkeleton, ProofTrail, OwnerChecklist, CommandPalette, ThemeToggle, WatchStar, Tilt } from "./extras.jsx";
import { celebrate, useNow, watched } from "./util.js";
import { flushSync } from "react-dom";
import { icsHref, googleHref } from "./ics.js";
import { call, callGasless, callRaw, connector, forgetViews, near, provider, view, yocto } from "./near.js";
import { loadInfos, loadMine } from "./mine.js";
import { explain } from "./errors.js";

const btc = (sats) => (sats / 1e8).toFixed(8);
const satsLabel = (sats) => `${Number(sats).toLocaleString("en-US")} sats`;
const eth6 = (wei) => Number(formatEther(wei)).toLocaleString(undefined, { maximumFractionDigits: 6 });
const usd = (x) => x.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: x < 100 ? 2 : 0 });
const pct = (x) => `${(x * 100).toLocaleString(undefined, { maximumFractionDigits: x < 0.1 ? 1 : 0 })}%`;

// One price fetch per page load; a failure just hides the dollar figures.
let pricePromise;
function usePrices() {
  const [p, setP] = useState(null);
  useEffect(() => {
    // one retry, and a failure isn't kept: the next page to ask tries again
    pricePromise ??= prices().catch(() => new Promise((r) => setTimeout(r, 2000)).then(prices)).catch(() => (pricePromise = null));
    pricePromise.then(setP);
  }, []);
  return p;
}
// One NEAR Intents quote per amount and address per page load, shared by the BTC and loan sections.
const quotes = new Map();
function useExitQuote(sats, evm) {
  const [q, setQ] = useState(null);
  useEffect(() => {
    if (!(sats > 0) || !evm) return;
    const k = `${sats}:${evm}`;
    if (!quotes.has(k)) quotes.set(k, exitQuote(sats, evm).catch((e) => ({ error: e.message })));
    let live = true;
    quotes.get(k).then((x) => live && setQ(x));
    return () => { live = false; };
  }, [sats, evm]);
  return q;
}
function ExitQuote({ sats, evm }) {
  const q = useExitQuote(sats, evm);
  if (!(sats > 0)) return null;
  if (!q) return <p className="muted exit-quote">Asking NEAR Intents solvers what this BTC would fetch…</p>;
  if (q.error) return <p className="muted exit-quote">No NEAR Intents quote right now ({q.error}).</p>;
  return (
    <p className="exit-quote">
      Exit value: swapped through <a href="https://docs.near-intents.org" target="_blank" rel="noreferrer">NEAR Intents</a>, this
      BTC fetches <strong>{q.usdc.toFixed(2)} USDC</strong> on Base (at least {q.minUsdc.toFixed(2)}), paid to this Pusaka's own
      EVM address in about {Math.round(q.seconds / 60)} min. <span className="muted">Live solver quote from 1Click (dry run on mainnet
      liquidity: nothing is sent).</span>
    </p>
  );
}

const BTC_PREFIX = `${NET.bech32}1`; // "tb1" on testnet, "bc1" on mainnet

// ---------- data ----------

const EMPTY_BAL = { safe: 0, pending: 0, atRisk: 0, spendable: [] };
/** The contract's own numbers only: enough to render the page while the chains answer. */
async function loadTokenQuick(id) {
  // one retry: a single slow RPC answer would otherwise leave the page waiting on every explorer's full load
  const info = await view("token_info", { token_id: id }).catch(() => new Promise((r) => setTimeout(r, 1500)).then(() => view("token_info", { token_id: id })));
  if (!info) return null;
  return { id, info, address: info.btc_pubkey ? btcAddress(info.btc_pubkey) : null, bal: { ...EMPTY_BAL, loading: true }, eth: null, sol: null, nearAcct: null };
}

async function loadToken(id) {
  const info = await view("token_info", { token_id: id });
  if (!info) return null;
  const address = info.btc_pubkey ? btcAddress(info.btc_pubkey) : null;
  const ethAddr = info.btc_pubkey && evmAddress(info.btc_pubkey);
  // every chain at once: a slow Bitcoin explorer no longer delays the EVM, SOL and NEAR reads
  const [bal, eth, sn] = await Promise.all([
    address ? balances(address, info.signed_outpoints).catch(() => ({ ...EMPTY_BAL, error: true })) : EMPTY_BAL,
    ethAddr ? Promise.all([
      Promise.all(EVM_CHAINS.map(async (c) => {
        const floor = await view("eth_nonce_floor", { token_id: id, chain_id: String(c.chain.id) });
        return evmBalances(ethAddr, floor, c.chain.id).then((b) => ({ ...b, c, floor })).catch(() => ({ c, error: true }));
      })),
      // USDC attested by NEAR MPC (foreign-tx verification), counted by the contract itself
      view("usdc_info", { token_id: id }).catch(() => []),
    ]).then(([chains, verified]) => ({ address: ethAddr, chains, verified })) : null,
    loadEd25519(id, info),
  ]);
  return { id, info, address, bal, eth, sol: sn[0], nearAcct: sn[1] };
}

// The Ed25519 key (MPC domain 1) is both a Solana address and a NEAR implicit account.
function loadEd25519(id, info) {
  return Promise.all([
    solAddress(id).then((a) => solBalances(a, info.history).then((b) => ({ ...b, address: a })).catch(() => ({ address: a, error: true }))).catch(() => null),
    nearAccount(id).then(async (a) => {
      const floor = await view("near_nonce_floor", { token_id: id });
      return nearBalances(a, floor).then((b) => ({ ...b, address: a, floor })).catch(() => ({ address: a, floor, error: true }));
    }).catch(() => null),
  ]);
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
    // a new page: back to the top, and focus on it so a screen reader announces it instead of staying on the old link
    const go = () => { setHash(location.hash); window.scrollTo(0, 0); document.querySelector("main")?.focus({ preventScroll: true }); };
    const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const f = () => {
      if (!document.startViewTransition || calm) return go();
      // a second navigation before the first animates skips or aborts it: expected, not an error
      const t = document.startViewTransition(() => flushSync(go));
      for (const p of [t.ready, t.finished, t.updateCallbackDone]) p?.catch(() => {});
    };
    addEventListener("hashchange", f);
    return () => removeEventListener("hashchange", f);
  }, []);
  if (/^#?\/?$/.test(hash)) return null; // home
  if (/^#\/mine\/?$/.test(hash)) return "mine";
  if (/^#\/agents\/?$/.test(hash)) return "agents";
  if (/^#\/refused\/?$/.test(hash)) return "refused";
  if (/^#\/market\/?$/.test(hash)) return "market";
  const gift = hash.match(/^#\/gift\/(ed25519:[1-9A-HJ-NP-Za-km-z]{40,100})$/);
  if (gift) return `gift:${gift[1]}`;
  const m = hash.match(/^#\/pusaka\/(\d{1,30})\/?$/);
  return m ? String(BigInt(m[1])) : "bad"; // "007" is #7; "1abc", "-1" and "#/x" aren't pages
}

// ---------- app ----------

export default function App() {
  const accountId = useAccount();
  const tokenId = useRoute();
  useEffect(() => {
    document.title = tokenId === "mine" ? "Your Pusakas — Pusaka" : tokenId === "agents" ? "For AI agents — Pusaka" : tokenId === "refused" ? "What the contract refused — Pusaka" : tokenId === "market" ? "Market — Pusaka" : tokenId?.startsWith("gift:") ? "A Pusaka for you — Pusaka" : tokenId && tokenId !== "bad" ? `Pusaka #${tokenId} — an NFT that holds real Bitcoin` : "Pusaka — NFTs that hold real Bitcoin";
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
    <div className="sheet">
      {/* not href="#main": the hash is the router */}
      <a className="skip" href="#/" onClick={(e) => { e.preventDefault(); document.querySelector("main")?.focus(); }}>Skip to content</a>
      <header className="bar">
        <a href="#/" className="wordmark">Pusaka</a>
        <span className="net">{NETWORK === "mainnet" ? "Mainnet" : "Testnet demo"}</span>
        <nav className="nav" aria-label="Pusaka">
          <a href="#/market" className={`nav-link${tokenId === "market" ? " is-here" : ""}`}>Market</a>
          {accountId && <a href="#/mine" className={`nav-link${tokenId === "mine" ? " is-here" : ""}`}>Your Pusakas</a>}
          <a href="#/agents" className={`nav-link${tokenId === "agents" ? " is-here" : ""}`}>For AI agents</a>
          <a href="#/refused" className={`nav-link${tokenId === "refused" ? " is-here" : ""}`}>Refused</a>
        </nav>
        <ThemeToggle />
        {accountId ? (
          <div className="who">
            <Bell accountId={accountId} />
            <button className="ghost" onClick={mint} disabled={!!minting && minting.endsWith("…")}>Mint a Pusaka</button>
            <button className="ghost" onClick={() => connector.disconnect()} title="Disconnect wallet">{accountId}</button>
          </div>
        ) : (
          <button onClick={() => connector.connect()}>Connect NEAR wallet</button>
        )}
      </header>
      {minting && <p className="toast" role="status">{minting}</p>}
      <CommandPalette accountId={accountId} />
      <main tabIndex={-1}>{tokenId === "bad"
        ? <section><h1>Page not found</h1><p className="error">There's nothing at {location.hash}. <a href="#/">See all Pusaka</a></p></section>
        : tokenId === "mine" ? <Mine accountId={accountId} />
        : tokenId === "agents" ? <Agents />
        : tokenId === "refused" ? <Refused />
        : tokenId === "market" ? <Market accountId={accountId} />
        : tokenId?.startsWith("gift:") ? <GiftClaim secret={tokenId.slice(5)} accountId={accountId} />
        : tokenId ? <Detail key={tokenId} id={tokenId} accountId={accountId} /> : <Home />}</main>
      <footer>
        <p>
          Contract <a href={`${NEAR_EXPLORER}/account/${CONTRACT}`}>{CONTRACT}</a>. Signatures by NEAR Chain
          Signatures (<code>{MPC}</code>). Built at NEAR HACKATHON.
        </p>
      </footer>
    </div>
  );
}

// ---------- home: three landscapes, each carrying a live reading from the contract ----------

function Spark({ points, w = 104, h = 40 }) {
  if (points.length < 2) return null;
  const max = Math.max(...points), min = Math.min(...points), span = max - min || 1;
  const xy = points.map((p, i) => [(i / (points.length - 1)) * w, 4 + (1 - (p - min) / span) * (h - 8)]);
  const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <defs><linearGradient id="spk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#b48cf0" stopOpacity="0.55" /><stop offset="1" stopColor="#b48cf0" stopOpacity="0" /></linearGradient></defs>
      <path d={`${line} L${w} ${h} L0 ${h} Z`} fill="url(#spk)" />
      <path d={line} fill="none" stroke="#9a6fe6" strokeWidth="1.6" />
    </svg>
  );
}

function Ring({ share }) {
  const c = 2 * Math.PI * 34;
  return (
    <svg className="ring" viewBox="0 0 80 80" aria-hidden="true">
      <circle cx="40" cy="40" r="34" className="ring-track" />
      <circle cx="40" cy="40" r="34" className="ring-fill" strokeDasharray={`${(share * c).toFixed(1)} ${c.toFixed(1)}`} transform="rotate(-90 40 40)" />
    </svg>
  );
}

/** A Dutch auction's price over its run, from the listing's own terms (the same line price_at follows on-chain). */
function auctionCurve(l) {
  const p = Number(BigInt(l.price) / 10n ** 18n), f = Number(BigInt(l.floor) / 10n ** 18n);
  if (!(Number(l.end_ms) > Number(l.start_ms)) || p === f) return [p, p];
  return Array.from({ length: 16 }, (_, i) => p - ((p - f) * i) / 15);
}

function Scenes({ tokens, px, sats }) {
  const now = useNow(60_000);
  const infos = tokens?.map((t) => t.info) ?? [];
  const holding = infos.filter((i) => Number(i.verified_sats) > 0);
  const busy = (i) => !!i.listing || !!i.loan;
  const forSale = infos.filter((i) => i.listing && i.price_now).sort((a, b) => (BigInt(a.price_now) < BigInt(b.price_now) ? -1 : 1));
  const best = forSale[0];
  const ready = tokens?.length > 0;
  const curve = best && auctionCurve(best.listing);
  // the vessels in the backdrops are real Pusakas, fullest first
  const v = [...infos].sort((a, b) => Number(b.verified_sats) - Number(a.verified_sats));
  const empty = infos.filter((i) => !Number(i.verified_sats));
  return (
    <section className="scenes" aria-label="Live from the contract">
      <figure className="scene">
        <Field mesh="sky" spots={[{ info: v[1], x: -8, y: -10, size: 46 }, { info: v[2], x: 68, y: 60, size: 40 }, { info: empty[0], x: 74, y: -6, size: 22, blur: true }]} />
        <div className="widget">
          <div className="widget-head"><span>Bitcoin proven on NEAR</span><span className="chip chip-lav">Light client</span></div>
          <div className="cells">
            <div><small>Verified</small><b>{ready ? satsLabel(sats) : "…"}</b></div>
            <div><small>{px ? "Worth" : "In BTC"}</small><b>{!ready ? "…" : px ? usd((sats / 1e8) * px.btcUsd) : (sats / 1e8).toFixed(5)}</b></div>
          </div>
          <p className="bar-ok">{ready ? `${holding.length} Pusaka hold proven Bitcoin` : "Reading the contract…"}</p>
        </div>
      </figure>
      <figure className="scene scene-main">
        <Field mesh="dawn" spots={[{ info: v[0], x: 31, y: -20, size: 38 }, { info: v[3], x: -9, y: 60, size: 33 }, { info: v[4], x: 79, y: 64, size: 29 }, { info: empty[1], x: 86, y: 2, size: 15, blur: true }, { info: empty[2], x: 3, y: 4, size: 12, blur: true }]} />
        <div className="widget widget-wide">
          <div className="widget-left">
            <div className="widget-head"><span>Pusaka</span><span className="chip chip-live">Live</span></div>
            <div className="ring-box"><Ring share={ready ? holding.length / infos.length : 0} /><b>{ready ? pct(holding.length / infos.length) : "…"}</b></div>
            <small className="muted">hold Bitcoin</small>
          </div>
          <div className="widget-right">
            <div className="tiles">{infos.map((i) => (
              <a key={i.token.token_id} href={`#/pusaka/${i.token.token_id}`} aria-label={`Pusaka #${i.token.token_id}: ${stateOf(i, now)}`}
                title={`Pusaka #${i.token.token_id}: ${stateOf(i, now)}`}
                className={`tile ${busy(i) ? "tile-busy" : Number(i.verified_sats) > 0 ? "tile-full" : ""}`}><span /></a>
            ))}</div>
            <p className="legend"><span><i className="tile-busy" /> for sale or lent</span> <span><i className="tile-full" /> holds Bitcoin</span> <span><i /> empty</span></p>
          </div>
        </div>
      </figure>
      <figure className="scene">
        <Field mesh="mint" spots={[{ info: best ?? v[5], x: 56, y: -16, size: 52 }, { info: v[6], x: -10, y: 66, size: 36 }]} />
        <div className="widget">
          <div className="widget-head"><span>{best ? `Pusaka #${best.token.token_id} for sale` : "For sale"}</span>{best && (curve.length > 2 ? <Spark points={curve} /> : <span className="chip chip-leaf">Fixed price</span>)}</div>
          {best ? <>
            {curve.length > 2 && <span className="chip chip-lav">Dutch auction, falling to {near(best.listing.floor)} NEAR</span>}
            <div className="cells cells-line">
              <div><small>Price now</small><b>{near(best.price_now)} NEAR</b></div>
              <div><small>Bitcoin inside</small><b>{px ? usd((Number(best.verified_sats) / 1e8) * px.btcUsd) : satsLabel(best.verified_sats)}</b></div>
            </div>
          </> : <p className="muted">{ready ? "Nothing listed right now." : "…"}</p>}
        </div>
      </figure>
    </section>
  );
}

// ---------- home ----------

/** Every Pusaka from the contract, newest first; Bitcoin balances from Esplora fill in after, so a slow explorer
 * never blanks the gallery or the verified total. */
function useTokens() {
  const [tokens, setTokens] = useState(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    loadInfos()
      .then((infos) => {
        const ts = infos.map((info) => ({
          id: info.token.token_id, info, address: info.btc_pubkey ? btcAddress(info.btc_pubkey) : null, bal: null,
        })).sort((a, b) => Number(b.id) - Number(a.id)); // nft_tokens is in string order ("10" < "2")
        setTokens(ts);
        ts.forEach((t) => t.address && balances(t.address, t.info.signed_outpoints).then((bal) =>
          setTokens((cur) => cur.map((x) => (x.id === t.id ? { ...x, bal } : x)))).catch(() => {}));
      })
      .catch((e) => setError(`Couldn't read the contract: ${e.message}`));
  }, [attempt]);
  return { tokens, error, retry: () => { setError(""); setAttempt((n) => n + 1); } };
}

/** The landing page: what a Pusaka is, with live readings; the market itself is #/market. */
function Home() {
  const { tokens, error, retry } = useTokens();
  const px = usePrices();
  const now = useNow(60_000);
  const sats = tokens?.reduce((a, t) => a + Number(t.info.verified_sats), 0);
  return (
    <>
      <div className="fold">
      <section className="hero">
        <h1>NFTs that hold real Bitcoin.</h1>
        <p className="lede">
          Every Pusaka controls its own Bitcoin address. Sell the NFT and the Bitcoin goes with it in one NEAR transaction:
          no bridge, no custodian, no key left with the seller.
        </p>
        <p className="cta-row">
          <a className="pill" href="#/market">Open the market</a>
          <a className="pill pill-soft" href="#/agents">Connect an AI agent</a>
          <a className="pill pill-soft" href="#/refused">See what the contract refused</a>
        </p>
      </section>

      {error && <p className="error" role="alert">{error} <button type="button" onClick={retry}>Try again</button></p>}
      <Scenes tokens={tokens} px={px} sats={sats} />
      </div>

      {tokens?.length > 0 && (
        <p className="reserves">
          <strong>{btc(sats)} BTC</strong> verified on NEAR across {tokens.length} Pusaka
          {px && <> (about {usd(sats / 1e8 * px.btcUsd)})</>}. Every satoshi is proven by NEAR's Bitcoin light client,
          not reported by us.
        </p>
      )}

      <section className="feature" aria-label="How a Pusaka changes hands">
        <div className="feature-card">
          <div className="feature-copy">
            <span className="chip">How it changes hands</span>
            <h2>Sell the NFT, and the Bitcoin goes with it.</h2>
            <p className="muted">The Bitcoin address belongs to the token, not to a person. NEAR's MPC network signs for it only when
              the contract says the current holder asked, so the moment a Pusaka changes hands, so does every satoshi inside.</p>
            {tokens?.[0] && <a className="pill" href={`#/pusaka/${tokens.find((t) => t.info.listing)?.id ?? tokens[0].id}`}>Open a Pusaka for sale</a>}
          </div>
          <div className="feature-panel lifecycle">
            <ol>
              <li><strong>Fill it.</strong> Send BTC to the Pusaka's address from any Bitcoin wallet.</li>
              <li><strong>Sell it.</strong> List it for NEAR. While listed, nobody can withdraw.</li>
              <li><strong>Own it.</strong> The buyer is now the only one who can move that BTC.</li>
            </ol>
          </div>
        </div>
      </section>

      <section className="closing">
        <h2>Hand your Bitcoin down<br />like an heirloom.</h2>
        <p className="muted">Name an heir on any Pusaka you hold. If you stay silent for as long as you choose, they can claim it,
          with everything inside. One check-in, gas-free, restarts the clock.</p>
        <a className="pill" href="#/mine">Name an heir</a>
        {tokens?.length > 0 && (
          <div className="shelf" aria-label="Every Pusaka, as the vessel it is">
            {[...tokens].sort((a, b) => Number(a.id) - Number(b.id)).map((t) => (
              <a key={t.id} href={`#/pusaka/${t.id}`} title={`Pusaka #${t.id}: ${stateOf(t.info, now)}`}>
                <Emblem pubkey={t.info.btc_pubkey} sats={Number(t.info.verified_sats)} letter={hasLetter(t.info)} size={72} label={`Pusaka #${t.id}`} />
              </a>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

const hasLetter = (info) => (info.token.metadata?.extra ?? "").includes('"letter"');

/** Share one Pusaka: /p/<id> carries its Open Graph card (api/share.mjs, api/og.mjs), so the post shows the vessel. */
function ShareLinks({ id, btcText }) {
  const url = `${location.origin}/p/${id}`;
  const text = `Pusaka #${id} holds ${btcText}, proven on NEAR. Sell the NFT and the Bitcoin goes with it. Built at NEAR HACKATHON @NEARProtocol #NEARHackathon`;
  return (
    <p className="share">
      <CopyButton text={url} label="Copy share link" what="share link" />
      <a className="link-btn" href={`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`} target="_blank" rel="noreferrer">Post on X</a>
    </p>
  );
}

/** The detail page's vessel: everything inside it, as the contract draws it (verified USDC and the heir are separate views). */
function Vessel({ id, info, locked }) {
  const [x, setX] = useState({ usdc: 0, heir: false });
  useEffect(() => {
    Promise.all([view("usdc_info", { token_id: id }).catch(() => []), view("heir_of", { token_id: id }).catch(() => null)])
      .then(([u, h]) => setX({ usdc: u.reduce((a, c) => a + Number(c.verified), 0), heir: !!h }));
  }, [id, info]);
  return <Emblem pubkey={info.btc_pubkey} sats={Number(info.verified_sats)} usdc={x.usdc} heir={x.heir} letter={hasLetter(info)} locked={locked} size={320} />;
}

/** The market: every Pusaka with its state, standing loan offers, and the latest on-chain activity. */
const FILTERS = {
  all: ["All", () => true],
  sale: ["For sale", (i) => !!i.listing || Object.keys(i.token.approved_account_ids ?? {}).length > 0],
  borrow: ["Asking to borrow", (i) => !!i.loan && !i.loan.lender],
  lent: ["Lent against", (i) => !!i.loan?.lender],
  btc: ["Holds Bitcoin", (i) => Number(i.verified_sats) > 0],
  empty: ["Empty", (i) => !Number(i.verified_sats)],
  watch: ["Watching", (i) => watched().has(i.token.token_id)],
};
const SORTS = {
  new: ["Newest", (a, b) => Number(b.id) - Number(a.id)],
  btc: ["Most Bitcoin", (a, b) => Number(b.info.verified_sats) - Number(a.info.verified_sats)],
  cheap: ["Cheapest for sale", (a, b) => (a.info.price_now ? Number(BigInt(a.info.price_now) / 10n ** 18n) : Infinity) - (b.info.price_now ? Number(BigInt(b.info.price_now) / 10n ** 18n) : Infinity)],
};

function Market({ accountId }) {
  const { tokens: all, error, retry } = useTokens();
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("new");
  const [, bump] = useState(0);
  useEffect(() => { const f = () => bump((n) => n + 1); addEventListener("pusaka:watch", f); return () => removeEventListener("pusaka:watch", f); }, []);
  const tokens = all;
  const shown = all?.filter((t) => FILTERS[filter][1](t.info)).sort(SORTS[sort][1]);
  const px = usePrices();
  const sats = tokens?.reduce((a, t) => a + Number(t.info.verified_sats), 0);
  const count = (f) => tokens?.filter((t) => f(t.info)).length ?? 0;
  return (
    <div className="market">
      <header className="market-head">
        <h1>Market</h1>
        <p className="muted">Every Pusaka, the Bitcoin proven inside it, and what you can do with it now: buy one for sale, lend against one asking for a loan, or take a standing offer.</p>
        {tokens?.length > 0 && (
          <dl className="market-stats">
            <div><dt>Pusaka</dt><dd>{tokens.length}</dd></div>
            <div><dt>Bitcoin proven</dt><dd>{(sats / 1e8).toFixed(5)} BTC{px && <small> {usd((sats / 1e8) * px.btcUsd)}</small>}</dd></div>
            <div><dt>For sale</dt><dd>{count(FILTERS.sale[1])}</dd></div>
            <div><dt>Asking to borrow</dt><dd>{count((i) => i.loan && !i.loan.lender)}</dd></div>
          </dl>
        )}
      </header>
      <div className="market-tools" role="toolbar" aria-label="Filter and sort">
        <div className="chips">{Object.entries(FILTERS).map(([k, [label, f]]) => (
          <button key={k} type="button" className={`chip-btn${filter === k ? " is-on" : ""}`} aria-pressed={filter === k} onClick={() => setFilter(k)}>
            {label}{all && <span>{all.filter((t) => f(t.info)).length}</span>}
          </button>
        ))}</div>
        <label className="sort">Sort <select value={sort} onChange={(e) => setSort(e.target.value)}>
          {Object.entries(SORTS).map(([k, [label]]) => <option key={k} value={k}>{label}</option>)}
        </select></label>
      </div>

      <section className="gallery" aria-label="All Pusaka">
        {error && <p className="error" role="alert">{error} <button type="button" onClick={retry}>Try again</button></p>}
        {!tokens && !error && <GallerySkeleton />}
        {tokens?.length === 0 && <p className="muted">No Pusaka yet. Connect a wallet and mint the first one.</p>}
        {shown?.length === 0 && <p className="muted">No Pusaka match this filter.</p>}
        {shown?.map((t) => (
          <div key={t.id} className="piece-wrap">
          <WatchStar id={t.id} />
          <a href={`#/pusaka/${t.id}`} className="piece">
            <Emblem pubkey={t.info.btc_pubkey} sats={Number(t.info.verified_sats)} letter={hasLetter(t.info)} locked={!!t.info.listing || !!t.info.loan || t.info.pending || Object.keys(t.info.token.approved_account_ids ?? {}).length > 0} size={168} />
            <span className="piece-name">Pusaka #{t.id}</span>
            <span className="piece-btc">{btc(Number(t.info.verified_sats))} BTC verified</span>
            {t.bal && t.bal.safe + t.bal.pending > Number(t.info.verified_sats) && <span className="piece-pending">+{btc(t.bal.safe + t.bal.pending - Number(t.info.verified_sats))} not proven yet</span>}
            {t.info.listing && <span className="piece-price">For sale at {near(t.info.price_now ?? t.info.listing.price)} NEAR</span>}
            {!t.info.listing && Object.keys(t.info.token.approved_account_ids ?? {}).length > 0 && <span className="piece-price">On sale on Mintbase</span>}
            {t.info.loan && <span className="piece-price">{t.info.loan.lender ? "Collateral for a loan" : `Asking to borrow ${near(t.info.loan.principal)} NEAR`}</span>}
          </a>
          </div>
        ))}
      </section>
      <div className="market-side">
        <OfferBook infos={tokens?.map((t) => t.info)} accountId={accountId} />
        <Activity />
      </div>


    </div>
  );
}

// ---------- your pusakas ----------

/** One line on where a Pusaka stands, from its token_info. */
function stateOf(info, now) {
  if (info.pending) return "Locked while NEAR MPC signs";
  if (info.listing) return `For sale at ${near(info.price_now ?? info.listing.price)} NEAR`;
  if (info.loan?.lender) return `Collateral: ${near(info.loan.repay)} NEAR ${now >= Number(info.loan.due_ms) ? "was" : "is"} due ${when(info.loan.due_ms)}`;
  if (info.loan) return `Asking to borrow ${near(info.loan.principal)} NEAR`;
  if (Object.keys(info.token.approved_account_ids ?? {}).length > 0) return "On sale on Mintbase";
  return "Not for sale";
}

function MineRow({ info, note, now }) {
  const id = info.token.token_id;
  return (
    <li>
      <a href={`#/pusaka/${id}`}>Pusaka #{id}</a>
      <span className="mine-btc">{btc(Number(info.verified_sats))} BTC verified</span>
      <span className="muted">{note ?? stateOf(info, now)}</span>
    </li>
  );
}

function Mine({ accountId }) {
  const [got, setGot] = useState(null); // { accountId, mine } or { accountId, error }, so a switched wallet never shows the old one's
  const [now] = useState(() => Date.now());
  useEffect(() => {
    if (!accountId) return;
    let live = true;
    loadMine(accountId).then((mine) => live && setGot({ accountId, mine }))
      .catch((e) => live && setGot({ accountId, error: `Couldn't read the contract: ${e.message}` }));
    return () => { live = false; };
  }, [accountId]);
  const cur = got?.accountId === accountId ? got : null;
  const m = cur?.mine, error = cur?.error;

  if (!accountId) return (
    <section className="mine">
      <h1>Your Pusakas</h1>
      <p>Connect your NEAR wallet to see the Pusakas you hold, your loans and the ones that name you as heir.</p>
      <button onClick={() => connector.connect()}>Connect NEAR wallet</button>
    </section>
  );
  return (
    <section className="mine">
      <h1>Your Pusakas</h1>
      <p className="muted">Read from {CONTRACT} for {accountId}.</p>
      {error && <p className="error">{error}</p>}
      {!m && !error && <p className="muted">Reading the contract…</p>}
      {m && <>
        <h2>You hold</h2>
        {m.held.length ? <ul>{m.held.map((i) => <MineRow key={i.token.token_id} info={i} now={now} />)}</ul>
          : <p className="muted">You don't hold a Pusaka yet. <a href="#/">See all Pusaka</a>, or mint one from the header.</p>}
        {m.others?.length > 0 && <p className="muted">This account also holds NFTs from: {m.others.join(", ")}.</p>}

        <h2>Loans</h2>
        {m.loans.length ? <ul>{m.loans.map((i) => <MineRow key={i.token.token_id} info={i} now={now}
          note={!i.loan.lender ? stateOf(i, now) : `${i.loan.lender === accountId ? `You lent ${near(i.loan.principal)} NEAR to ${i.loan.borrower}` : `You borrowed ${near(i.loan.principal)} NEAR from ${i.loan.lender}`}. ${stateOf(i, now)}`} />)}</ul>
          : <p className="muted">No loans. You haven't borrowed against a Pusaka or lent against one.</p>}

        <OfferBook infos={m.infos} accountId={accountId} mineOnly />

        <h2>You are the heir</h2>
        {m.heirOf.length ? <ul>{m.heirOf.map(({ info, heir }) => <MineRow key={info.token.token_id} info={info} now={now}
          note={now >= Number(heir.claimable_from_ms) ? `Claimable now from ${info.token.owner_id}` : `Claimable from ${when(heir.claimable_from_ms)} if ${info.token.owner_id} stays silent`} />)}</ul>
          : <p className="muted">No Pusaka names you as its heir.</p>}
      </>}
    </section>
  );
}

/** Standing loan offers: who lends what, at what yearly rate, and which Pusakas could take each one now. */
function OfferBook({ infos, accountId, mineOnly }) {
  const [offers, setOffers] = useState(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const load = () => allOffers().then(setOffers, () => setOffers([]));
  useEffect(() => { load(); }, []);
  const shown = (offers ?? []).filter(({ offer: o }) => !mineOnly || o.lender === accountId);
  if (!mineOnly && !shown.length) return null;
  const apr = (o) => (Number(o.repay) / Number(o.principal) - 1) * 365 * DAY_MS / Number(o.duration_ms);
  // a listed one can take it once bought (the demo path: buy, then borrow); one with a loan request can't
  const takers = (o) => (infos ?? []).filter((i) => !i.loan && Number(i.verified_sats) >= Number(o.min_verified_sats));
  const cancel = async (oid) => {
    setBusy(oid); setMsg("");
    try { await call("cancel_loan_offer", { offer_id: oid }); setMsg("Offer cancelled. Your NEAR is on its way back."); await load(); }
    catch (e) { setMsg(e.message); } finally { setBusy(""); }
  };
  return (
    <section className="offers" aria-label={mineOnly ? "Your loan offers" : "Loan offers"}>
      <h2>{mineOnly ? "Your loan offers" : "Loan offers"}</h2>
      {!mineOnly && <p className="muted">Lenders' NEAR, already escrowed in the contract. A holder takes one in a single transaction, gas-free.</p>}
      {offers === null ? <p className="muted">Reading offers…</p> : !shown.length
        ? <p className="muted">No standing offers from you. Offer one from any Pusaka's page; the NEAR stays in the contract until it's taken or you cancel.</p>
        : <ul>{shown.map(({ id, offer: o }) => {
          const t = o.token_id ? [] : takers(o);
          return <li key={id}>
            {o.lender} lends <strong>{near(o.principal)} NEAR</strong>, repay {near(o.repay)} within {days(o.duration_ms)} ({(apr(o) * 100).toFixed(1)}% a year){" "}
            {o.token_id ? <>for <a href={`#/pusaka/${o.token_id}`}>Pusaka #{o.token_id}</a></>
              : <>to any Pusaka with {btc(Number(o.min_verified_sats))} BTC verified{t.length > 0 && <>: {t.slice(0, 6).map((i, k) =>
                <span key={i.token.token_id}>{k ? ", " : ""}<a href={`#/pusaka/${i.token.token_id}`}>#{i.token.token_id}</a>{i.listing && " (for sale)"}</span>)}{t.length > 6 && ` and ${t.length - 6} more`} qualify</>}</>}.
            {o.lender === accountId && <> <button className="ghost" disabled={!!busy} onClick={() => cancel(id)}>{busy === id ? "Cancelling…" : "Cancel"}</button></>}
          </li>;
        })}</ul>}
      {msg && <p role="status">{msg}</p>}
    </section>
  );
}

const ACTIVITY = {
  nft_mint: "minted a Pusaka", list: "listed one for sale", cancel_listing: "took one off sale", buy: "bought one",
  withdraw: "withdrew BTC", withdraw_eth: "withdrew ETH", prove_deposit: "proved a BTC deposit",
  request_loan: "asked for a loan", cancel_loan_request: "cancelled a loan request", fund_loan: "funded a loan",
  repay_loan: "repaid a loan", claim_collateral: "claimed collateral", set_heir: "named an heir", still_here: "checked in as holder",
  claim_inheritance: "inherited one", nft_approve: "listed one on Mintbase",
  nft_revoke_all: "stopped selling on Mintbase", offer_loan: "offered a loan", cancel_loan_offer: "withdrew a loan offer",
  accept_loan_offer: "took a loan offer", repay_partial: "repaid part of a loan",
  letter_key: "opened a sealed letter", set_letter: "sealed a letter for the next holder",
  propose_extension: "offered a loan extension", accept_extension: "extended a loan", nft_transfer: "transferred one", migrate: "upgraded the contract",
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
  const refresh = useCallback(() => {
    let full = false;
    // contract data renders first; balances from Bitcoin, EVM, Solana and NEAR fill in when they answer
    loadTokenQuick(id).then((x) => { if (!full) { if (x) setT(x); else setMissing(true); } }).catch(() => {});
    return loadToken(id)
      .then((x) => { full = true; setFailed(false); if (x) setT(x); else setMissing(true); })
      .catch(() => setFailed(true));
  }, [id]);
  useEffect(() => { refresh(); }, [refresh]);
  const px = usePrices(); // hooks before any early return

  if (missing) return <section><h1>No Pusaka #{id}</h1><p className="error">There is no Pusaka #{id} yet. <a href="#/">See all Pusaka</a></p></section>;
  if (!t && failed) return <p className="error">Couldn't reach NEAR to load Pusaka #{id}. <button onClick={refresh}>Try again</button></p>;
  if (!t) return <article className="detail"><div className="detail-face"><h1>Pusaka #{id}</h1><p className="muted">Loading Pusaka #{id}…</p></div></article>;

  const { info, address, bal } = t;
  const owner = info.token.owner_id;
  const isOwner = accountId === owner;
  const locked = !!info.listing || !!info.loan || info.pending || Object.keys(info.token.approved_account_ids ?? {}).length > 0;

  return (
    <article className="detail">
      <div className="detail-face">
        <Tilt><Vessel id={id} info={info} locked={locked} /></Tilt>
        <h1>Pusaka #{id}</h1>
        <p className="muted">Owned by <strong>{isOwner ? "you" : owner}</strong> <WatchStar id={id} /></p>
        <ShareLinks id={id} btcText={`${btc(Number(info.verified_sats))} BTC`} />
      </div>

      <div className="detail-body">
        {isOwner && <OwnerChecklist info={info} letter={hasLetter(info)} pendingSats={bal ? Math.max(0, bal.safe + bal.pending - Number(info.verified_sats)) : 0} />}
        <section>
          <h2>Bitcoin inside, verified on NEAR</h2>
          <p className="amount"><span>{btc(Number(info.verified_sats))}</span> BTC</p>
          {px && Number(info.verified_sats) > 0 && <p className="muted">About {usd(Number(info.verified_sats) / 1e8 * px.btcUsd)} at mainnet BTC prices.</p>}
          <ExitQuote sats={Number(info.verified_sats)} evm={evmAddress(info.btc_pubkey)} />
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
          {bal.error && <p className="error">Neither Bitcoin explorer (mempool.space, Blockstream) answered, so the balance may be out of date.</p>}
          {address ? (<>
            <p className="addr">
              <a href={`${EXPLORER}/address/${address}`} target="_blank" rel="noreferrer">{address}</a>
              <CopyButton text={address} what="Bitcoin address" />
              <a className="link-btn" href={`bitcoin:${address}?label=${encodeURIComponent(`Pusaka #${id}`)}`}>Open in a Bitcoin wallet</a>
            </p>
            <BtcQr address={address} label={`Pusaka #${id}`} />
          </>) : (
            <p className="muted">The Bitcoin key is still being derived by the NEAR MPC network.</p>
          )}
          <p className="badge-line">
            <img src={`/api/badge?id=${id}`} alt={`Pusaka #${id}: ${btc(Number(info.verified_sats))} BTC verified`} height="22" />
            <CopyButton label="Copy badge for a README or post" text={`[![Pusaka #${id}](${location.origin}/api/badge?id=${id})](${location.origin}/#/pusaka/${id})`} />
          </p>
        </section>

        <ProofTrail info={info} explorer={EXPLORER} nearExplorer={NEAR_EXPLORER} lightClient={BTC_LIGHT_CLIENT} />

        {t.eth && <EthSection t={t} canWithdraw={isOwner && !locked} onDone={refresh} />}
        {t.sol && <SolSection t={t} canWithdraw={isOwner && !locked} onDone={refresh} />}
        {t.nearAcct && <NearAccountSection t={t} canWithdraw={isOwner && !locked} onDone={refresh} />}
        {t.nearAcct && <NbtcSection t={t} canWithdraw={isOwner && !locked} onDone={refresh} />}
        {t.nearAcct && <StakeSection t={t} canStake={isOwner && !locked} onDone={refresh} />}

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

        <HeirSection id={id} owner={owner} accountId={accountId} isOwner={isOwner} onDone={refresh} />

        <HolderRoom key={`${id}:${accountId}`} id={id} owner={owner} accountId={accountId} canSeal={isOwner && !locked} onDone={refresh} extra={info.token.metadata?.extra} />

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
      forgetViews();
      const body = await r.json().catch(() => ({}));
      if (r.status === 503) throw new Error("The relayer isn't set up on this deployment. Connect a wallet and prove from it instead.");
      if (r.status === 429) throw new Error("Too many free proofs from your network in the last minute. Try again shortly, or connect a wallet and prove it yourself.");
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
      <p className="addr"><span>{eth.address}</span> <CopyButton text={eth.address} what="EVM address" /></p>
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
      <p className="addr"><a href={SOL.explorer(`address/${sol.address}`)} target="_blank" rel="noreferrer">{sol.address}</a> <CopyButton text={sol.address} what="Solana address" /></p>
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
        can move it, and only through transactions the contract builds (transfers, nBTC transfers and staking calls), so no one
        can add a key and keep it after a sale.</p>
      {a.error ? <p className="error">Couldn't read the account.</p> : <>
        <p className="amount small"><span>{near(a.safe)}</span> NEAR</p>
        {a.atRisk > 0n && <p className="warn">{near(a.atRisk)} NEAR is at risk: a signed transfer for nonce {a.floor} hasn't been used yet.</p>}
        {!a.exists && <p className="muted">Empty so far. Send NEAR to the account below to create it.</p>}
      </>}
      <p className="addr"><a href={`${NEAR_EXPLORER}/account/${a.address}`} target="_blank" rel="noreferrer">{a.address}</a> <CopyButton text={a.address} what="NEAR account" /></p>
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

/**
 * Staking: the Pusaka's NEAR account delegates to a validator from the official pool factory. The stake and its
 * rewards belong to that account, so they move with the NFT; only the current holder can unstake or withdraw.
 */
function StakeSection({ t, canStake, onDone }) {
  const { id, nearAcct: a } = t;
  const [stakes, setStakes] = useState(null);
  const [pools, setPools] = useState(null);
  const [pool, setPool] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState(null);
  const addr = a?.address;
  const load = useCallback(() => view("staking_pools_of", { token_id: id })
    .then((ps) => stakeBalances(addr, ps)).then(setStakes, () => setStakes([])), [id, addr]);
  useEffect(() => { if (addr) load(); }, [load, addr]);
  useEffect(() => { if (canStake && a?.yocto > 0n && !pools) stakingPools().then((ps) => { setPools(ps); setPool((x) => x || ps[0]?.pool || ""); }, () => setPools([])); }, [canStake, a?.yocto, pools]);
  if (!a?.address || (!stakes?.length && !(canStake && a.yocto > 0n))) return null;

  async function act(action, p, amountYocto = 0n) {
    setBusy(`${action}:${p}`); setMsg(null);
    try {
      const { nonce, blockHash } = await nearTxParams(a.address);
      const signed = await call("stake_near", {
        token_id: id, pool: p, action, amount: amountYocto.toString(), nonce: String(nonce), block_hash: blockHash,
      }, { deposit: 10_000_000_000_000_000_000_000n, tgas: 300 });
      if (signed.account !== a.address) throw new Error("The contract signed for a different account.");
      const hash = await broadcastNear(await finalizeNear(signed));
      const done = { stake: "Staked", unstake: "Unstaking started; withdraw it after about 4 epochs (2 days on mainnet)", withdraw: "Withdrawn to its NEAR account" }[action];
      setMsg({ ok: true, text: <>{done}. <a href={`${NEAR_EXPLORER}/tx/${hash}`} target="_blank" rel="noreferrer">View on NEAR</a></> });
      setAmount("");
      await onDone(); await load();
    } catch (err) { setMsg({ ok: false, text: err.message }); }
    finally { setBusy(""); }
  }

  const total = (stakes ?? []).reduce((n, s) => n + s.staked + s.unstaked, 0n);
  return (
    <section aria-label="Staking">
      <h2>Staked NEAR</h2>
      <p className="muted">Its NEAR account can delegate to a validator (only pools from NEAR's official staking-pool factory).
        The stake and its rewards belong to the account, so they move with the NFT: a buyer gets them, and only the holder can unstake.</p>
      {stakes === null ? <p className="muted">Reading the pools…</p> : stakes.length > 0 && <>
        <p className="amount small"><span>{near(total)}</span> NEAR at validators</p>
        <ul className="stakes">
          {stakes.map((s) => (
            <li key={s.pool}>
              <a href={`${NEAR_EXPLORER}/account/${s.pool}`} target="_blank" rel="noreferrer">{s.pool}</a>: {near(s.staked)} staked
              {s.unstaked > 0n && <>, {near(s.unstaked)} unstaked {s.withdrawable ? "(ready)" : "(waiting out the unstake period)"}</>}
              {canStake && <span className="row">
                {s.staked > 0n && <button type="button" className="secondary" disabled={!!busy} onClick={() => act("unstake", s.pool, s.staked)}>
                  {busy === `unstake:${s.pool}` ? "Signing with NEAR MPC…" : "Unstake all"}</button>}
                {s.withdrawable && <button type="button" disabled={!!busy} onClick={() => act("withdraw", s.pool)}>
                  {busy === `withdraw:${s.pool}` ? "Signing with NEAR MPC…" : "Withdraw"}</button>}
              </span>}
            </li>
          ))}
        </ul>
      </>}
      {canStake && a.yocto > 0n && (
        <form onSubmit={(e) => { e.preventDefault(); act("stake", pool, yocto(amount)); }} className="stack">
          <label>Validator <select value={pool} onChange={(e) => setPool(e.target.value)} required>
            {(pools ?? []).map((p) => <option key={p.pool} value={p.pool}>{p.pool} ({(p.fee * 100).toFixed(0)}% fee)</option>)}
          </select></label>
          <label>Amount <span className="row"><input type="number" min="1" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} required /> NEAR</span></label>
          <p className="muted">Leave a little NEAR in the account for gas. Pools take at least 1 NEAR.</p>
          <button disabled={!!busy || !pools?.length}>{busy.startsWith("stake:") ? "Signing with NEAR MPC…" : "Stake from its NEAR account"}</button>
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
      {state.deposit && <p className="addr"><span>{state.deposit}</span> <CopyButton text={state.deposit} label="Copy deposit address" what="Omni Bridge deposit address" /></p>}
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

/**
 * Heirloom: the holder names an heir who may claim the Pusaka (and everything it controls) after
 * a stretch of silence. Shown to everyone, since a buyer should know; a sale clears it.
 */
// same rule as api/_relayer.mjs: one free check-in per hour (or tenth of the silence), decided at click time
const freeCheckIn = (h) => Date.now() - Number(h.last_seen_ms) >= Math.min(3_600_000, Number(h.after_ms) / 10);

/** A deadline worth a calendar entry: an .ics with an alarm before it, or straight into Google Calendar. */
function Reminder({ uid, title, at, details, alarmMin, label = "Remind me" }) {
  const ev = { uid: `${uid}@pusaka-two.vercel.app`, title, at, details, url: location.href, alarmMin: Math.max(1, Math.round(alarmMin)) };
  return <p className="reminder">{label}:{" "}
    <a href={icsHref(ev)} download={`pusaka-${uid}.ics`}>add to calendar (.ics)</a> ·{" "}
    <a href={googleHref(ev)} target="_blank" rel="noreferrer">Google Calendar</a></p>;
}

function HeirSection({ id, owner, accountId, isOwner, onDone }) {
  const [h, setH] = useState(undefined);
  const [heir, setHeir] = useState("");
  const [after, setAfter] = useState("30");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [g, setG] = useState(null);
  const [guards, setGuards] = useState("");
  const [threshold, setThreshold] = useState("2");
  const load = useCallback(() => Promise.all([
    view("heir_of", { token_id: id }).then((v) => setH(v && { ...v, due: Date.now() >= Number(v.claimable_from_ms) })).catch(() => setH(null)),
    view("guardians_of", { token_id: id }).then(setG, () => setG(null)),
  ]), [id]);
  useEffect(() => { load(); }, [load, owner]);
  if (h === undefined) return null;
  const due = h?.due;
  const isHeir = h && accountId === h.heir;
  const isGuardian = !!g && g.guardians.includes(accountId);
  const now = Date.now();
  // with guardians the heir waits for their quorum's waiting period, or for the backstop if they never answer
  const claimable = due && (!g || (g.release_at_ms && Number(g.release_at_ms) <= now) || Number(g.backstop_from_ms) <= now);
  function guard(e) {
    e.preventDefault();
    const list = [...new Set(guards.split(/[\s,]+/).map((x) => x.trim().toLowerCase()).filter(Boolean))];
    const t = Number(threshold);
    if (!list.length || list.length > 5) return setMsg({ ok: false, text: "Name 1 to 5 guardians, separated by commas." });
    if (!(t >= 1 && t <= list.length)) return setMsg({ ok: false, text: `The approvals needed must be between 1 and ${list.length}.` });
    run(`Guardians named: ${t} of ${list.length} must approve`, async () => {
      for (const a of list) if (!(await provider.viewAccount({ accountId: a, blockQuery: { finality: "final" } }).then(() => true, () => false))) throw new Error(`${a} doesn't exist on NEAR ${NETWORK}.`);
      return call("set_guardians", { token_id: id, guardians: list, threshold: t }, { deposit: 10_000_000_000_000_000_000_000n });
    });
  }

  async function run(what, fn) {
    setBusy(true); setMsg(null);
    // refresh first, so the message never shows next to the old owner or the old date
    try { const r = await fn(); await Promise.all([load(), onDone()]); setMsg({ ok: true, text: `${what}${r?.gasless ? " (gas paid by Pusaka's relayer)" : ""}.` }); if (what === "It's yours now") celebrate(); }
    catch (err) { setMsg({ ok: false, text: err.message }); }
    finally { setBusy(false); }
  }
  function name(e) {
    e.preventDefault();
    const to = heir.trim().toLowerCase();
    const ms = Math.round(Number(after) * DAY_MS);
    if (!to || to === owner) return setMsg({ ok: false, text: "Name another NEAR account as heir." });
    if (!(ms > 0)) return setMsg({ ok: false, text: "Enter how many days of silence, e.g. 30 (0.007 is 10 minutes, the testnet minimum)." });
    run(`${to} is now the heir`, async () => {
      const exists = await provider.viewAccount({ accountId: to, blockQuery: { finality: "final" } }).then(() => true, () => false);
      if (!exists) throw new Error(`${to} doesn't exist on NEAR ${NETWORK}.`);
      return call("set_heir", { token_id: id, heir: to, after_ms: String(ms) }, { deposit: 10_000_000_000_000_000_000_000n });
    });
  }

  return (
    <section>
      <h2>Heir</h2>
      {h ? (
        <p>
          If {owner} stays silent until <strong>{when(h.claimable_from_ms)}</strong> ({days(h.after_ms)} after their last action),
          {" "}<strong>{h.heir}</strong> can claim this Pusaka with everything it holds, and read its sealed letter. Anything the holder does with it (a check-in, a withdrawal, a listing, a letter) restarts the clock; selling or giving it away cancels this.
        </p>
      ) : <p className="muted">No heir named. A holder can name one: if they go silent for long enough, the heir claims the Pusaka, its BTC, ETH, USDC, SOL and NEAR account. No lawyer, no custodian: the contract enforces it, and a funded loan's lender still comes first.</p>}
      {isOwner && h && (
        <p className="row">
          <button disabled={busy} onClick={() => run("Checked in; the clock restarted", () => (freeCheckIn(h) ? callGasless : call)("still_here", { token_id: id }))}>I'm still here</button>
          <button className="secondary" disabled={busy} onClick={() => run("Heir removed", () => call("set_heir", { token_id: id, heir: null, after_ms: "0" }))}>Remove heir</button>
        </p>
      )}
      {isOwner && h && !due && <Reminder uid={`heir-${id}-${h.claimable_from_ms}`} at={Number(h.claimable_from_ms)} label="Don't let it pass by accident"
        alarmMin={Math.min(1440, Number(h.after_ms) / 60_000 / 4)} title={`Check in on Pusaka #${id}, or ${h.heir} can claim it`}
        details={`Press "I'm still here" (or do anything with the Pusaka) before this, or ${h.heir} can claim it with everything it holds.`} />}
      {isOwner && (
        <form onSubmit={name} className="stack">
          <label>{h ? "Change heir" : "Heir"} <input value={heir} onChange={(e) => setHeir(e.target.value)} placeholder="family.testnet" required spellCheck="false" autoCapitalize="none" /></label>
          <label>After <span className="row"><input value={after} onChange={(e) => setAfter(e.target.value.trim())} inputMode="decimal" required /> days of silence</span></label>
          <button disabled={busy}>{busy ? "Waiting for the wallet…" : "Name heir"}</button>
        </form>
      )}
      {h && g && (
        <div className="guardians">
          <p><strong>Guardians:</strong> {g.guardians.join(", ")}. {g.threshold} of {g.guardians.length} must agree the holder is gone before {h.heir} can
            claim; then {owner} still has {days(g.release_wait_ms)} to show up and cancel it. Guardians can only release it to the named heir, never take it.</p>
          <p className="muted">{g.release_at_ms ? `Quorum reached: the heir can claim from ${when(g.release_at_ms)}.`
            : `Approvals for this silence: ${g.approvals.length} of ${g.threshold}${g.approvals.length ? ` (${g.approvals.join(", ")})` : ""}.`}
            {" "}If the guardians never answer, the heir can claim alone from {when(g.backstop_from_ms)}.</p>
        </div>
      )}
      {isGuardian && due && !g.approvals.includes(accountId) && (
        <button disabled={busy} onClick={() => run("Release approved", () => callGasless("approve_release", { token_id: id }))}>Approve the release to {h.heir}</button>
      )}
      {isGuardian && !due && <p className="muted">You are a guardian of this will. You can approve a release only after {owner} has been silent until {when(h.claimable_from_ms)}.</p>}
      {isOwner && h && (
        <form onSubmit={guard} className="stack">
          <label>{g ? "Change guardians" : "Guardians (optional)"} <input value={guards} onChange={(e) => setGuards(e.target.value)} placeholder="sister.testnet, notary.testnet, friend.testnet" spellCheck="false" autoCapitalize="none" required /></label>
          <label>Approvals needed <span className="row"><input value={threshold} onChange={(e) => setThreshold(e.target.value.trim())} inputMode="numeric" required /> of them</span></label>
          <span className="row">
            <button disabled={busy}>{g ? "Update guardians" : "Name guardians"}</button>
            {g && <button type="button" className="secondary" disabled={busy} onClick={() => run("Guardians removed", () => call("set_guardians", { token_id: id, guardians: [], threshold: 0 }))}>Remove guardians</button>}
          </span>
        </form>
      )}
      {isHeir && (claimable
        ? <button disabled={busy} onClick={() => run("It's yours now", () => callGasless("claim_inheritance", { token_id: id }))}>Claim inheritance</button>
        : due && g ? <p className="muted">You are the heir. {owner} has been silent long enough; now {g.threshold} of the guardians must approve ({g.approvals.length} so far), then a waiting period runs. Or claim alone from {when(g.backstop_from_ms)}.</p>
        : <><p className="muted">You are the heir. You can claim from {when(h.claimable_from_ms)} if {owner} doesn't check in before then.</p>
          <Reminder uid={`claim-${id}-${h.claimable_from_ms}`} at={Number(h.claimable_from_ms)} alarmMin={0} label="Remind me when it opens"
            title={`Pusaka #${id} can be claimed`} details={`${owner} has been silent long enough: you can claim the Pusaka now, unless they check in first.`} /></>)}
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
    // BLS12-381 is only needed here, so it loads on first use instead of with every page
    const { ckdAppId, ckdEphemeral, ckdSecret, ckdKey, LETTER_PURPOSE } = await import("@pusaka/shared/ckd");
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
      const { openCkd } = await import("@pusaka/shared/ckd");
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
      const { sealCkd } = await import("@pusaka/shared/ckd");
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
    if (e.kind === "Inherited") { hold(e.from); hold(e.to); }
    if (e.kind === "Royalty") royalties += BigInt(e.amount);
    if (e.kind === "LoanFunded" || e.kind === "LoanOfferAccepted") borrowed += 1n;
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

// ---------- gift links: the contract's NEP-452 linkdrop ----------

const GIFT_DEPOSIT = 250_000_000_000_000_000_000_000n; // 0.25 NEAR: claim-key allowance, the recipient's first NEAR, storage

/** The owner turns the Pusaka into a one-use link; whoever opens it gets the NFT and the Bitcoin it controls. */
function GiftLink({ id, busy, run }) {
  const [open, setOpen] = useState(undefined);
  const [link, setLink] = useState("");
  useEffect(() => { view("gift_of", { token_id: id }).then(setOpen, () => setOpen(null)); }, [id, link]);
  if (open === undefined) return null;
  if (open) return <div className="stack">
    <h2>Gift link open</h2>
    <p>This Pusaka is waiting for whoever opens its gift link{link ? "" : " (only you had the link)"}. Until then it can't be sold, lent against or withdrawn from.</p>
    {link && <p className="gift-link"><code>{link}</code> <CopyButton text={link} label="Copy link" what="gift link" /></p>}
    <button type="button" className="secondary" disabled={!!busy} onClick={() => run("cancel-gift", async () => {
      await call("cancel_gift", { token_id: id }); setLink(""); return "Gift cancelled. The Pusaka is yours to use again.";
    })}>{busy === "cancel-gift" ? "Cancelling…" : "Cancel gift"}</button>
  </div>;
  return <div className="stack">
    <h2>Gift it as a link</h2>
    <p className="muted">Send this Pusaka, with its Bitcoin, to someone who has no NEAR account yet: they open the link and claim it, and a new account is made for them. A NEAR linkdrop (NEP-452) built into the contract. Costs 0.25 NEAR; 0.13 of it becomes their first NEAR, enough for their first transactions.</p>
    <button type="button" disabled={!!busy} onClick={() => run("gift", async () => {
      const kp = KeyPair.fromRandom("ed25519");
      await call("gift", { token_id: id, public_key: kp.getPublicKey().toString() }, { deposit: GIFT_DEPOSIT });
      setLink(`${location.origin}/#/gift/${kp.toString()}`);
      return "Gift link made. Anyone with it can claim this Pusaka: send it privately.";
    })}>{busy === "gift" ? "Making the link…" : "Make a gift link"}</button>
  </div>;
}

/** #/gift/<key>: the recipient's page. Claiming is signed with the link's own key, so it needs no wallet and no NEAR. */
function GiftClaim({ secret, accountId }) {
  const [g, setG] = useState(undefined);
  const [info, setInfo] = useState(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState(null);
  const [newKey, setNewKey] = useState(null);
  const [tokenId, setTokenId] = useState("");
  const pk = KeyPair.fromString(secret).getPublicKey().toString();
  useEffect(() => {
    view("gift_for_key", { public_key: pk }).then(async (x) => {
      setG(x);
      if (x) { setTokenId(x.token_id); setInfo(await view("token_info", { token_id: x.token_id })); }
    }, () => setG(null));
  }, [pk]);
  const linkAccount = () => new Account(CONTRACT, provider, secret);
  const claim = (label, fn) => async (e) => {
    e?.preventDefault();
    setBusy(label); setMsg(null);
    try { setMsg({ ok: true, text: await fn() }); setG(null); celebrate(); }
    catch (err) { setMsg({ ok: false, text: String(err.message ?? err).slice(0, 300) }); }
    finally { setBusy(""); }
  };
  const suffix = NETWORK === "mainnet" ? ".near" : ".testnet";
  if (g === undefined) return <section><h1>A Pusaka for you</h1><p className="muted">Opening the gift…</p></section>;
  return (
    <section className="gift">
      <h1>A Pusaka for you</h1>
      {!g && !msg && <p className="error">This link opens no gift: it was already claimed or the giver cancelled it.</p>}
      {g && <>
        <p><strong>{g.from}</strong> sent you <a href={`#/pusaka/${g.token_id}`}>Pusaka #{g.token_id}</a>{info && <>, an NFT that controls its own Bitcoin
          address holding <strong>{btc(Number(info.verified_sats))} BTC</strong> proven on NEAR</>}. Claim it and the NFT, with everything it holds, is yours.</p>
        {accountId && <button disabled={!!busy} onClick={claim("mine", async () => {
          await linkAccount().callFunction({ contractId: CONTRACT, methodName: "claim", args: { account_id: accountId }, gas: 100_000_000_000_000n });
          return `It's yours: Pusaka #${g.token_id} is now held by ${accountId}.`;
        })}>{busy === "mine" ? "Claiming…" : `Claim into ${accountId}`}</button>}
        <form className="stack" onSubmit={claim("new", async () => {
          const kp = KeyPair.fromRandom("ed25519");
          const id = `${name.trim().toLowerCase()}${suffix}`;
          await linkAccount().callFunction({ contractId: CONTRACT, methodName: "create_account_and_claim",
            args: { new_account_id: id, new_public_key: kp.getPublicKey().toString() }, gas: 100_000_000_000_000n });
          const owner = (await view("token_info", { token_id: g.token_id })).token.owner_id;
          if (owner !== id) throw new Error(`${id} couldn't be created (taken?). The link still works: try another name.`);
          setNewKey({ id, key: kp.toString() });
          return `Created ${id} and gave it Pusaka #${g.token_id}.`;
        })}>
          <h2>{accountId ? "Or claim it as a new account" : "Claim it: no wallet needed"}</h2>
          <label>Pick a name <span className="row"><input value={name} onChange={(e) => setName(e.target.value)} pattern="[a-z0-9][a-z0-9_\-]{1,40}" required spellCheck="false" autoCapitalize="none" placeholder="ana" />{suffix}</span></label>
          <button disabled={!!busy}>{busy === "new" ? "Creating your account…" : "Create my account and claim"}</button>
          <p className="muted">The account is created on NEAR {NETWORK} with 0.13 NEAR to start. Its key is made in this browser and shown once below.</p>
        </form>
      </>}
      {msg && <p className={msg.ok ? "ok" : "error"} role="status">{msg.text}</p>}
      {newKey && <div className="stack">
        <h2>Save your key now</h2>
        <p>This private key is the only way into <strong>{newKey.id}</strong>. Import it into a NEAR wallet (Meteor, Intear or MyNearWallet: import an account with a private key). It isn't stored anywhere else.</p>
        <p className="gift-link"><code>{newKey.key}</code> <CopyButton text={newKey.key} label="Copy key" what="private key" /></p>
        <p><a href={`#/pusaka/${tokenId}`}>See your Pusaka</a></p>
      </div>}
    </section>
  );
}

// ---------- #/refused: attacks the deployed contract turned down, read live from NEAR ----------

/** Real transactions on testnet. Only the hashes are fixed here: who sent them, what they called and why the contract
 * said no are read from NEAR's archive on every visit, so a card can't claim a refusal that didn't happen. */
const REFUSED = [
  { hash: "6PrmsY8yFfFJvkCWNuySZoaLvdqgYTXcvfvwMyDcCBe6", attack: "The seller tries to withdraw the Bitcoin after selling the NFT", test: "seller_cannot_withdraw_after_sale" },
  { hash: "wS4qnqmcM3YqXPwXFcJzcVLGnfGt6okL9ubnCuLrVZi", attack: "The seller tries to empty the Pusaka while it is listed (the token-bound wallet “drain before sale”)", test: "t1_withdraw_while_listed_fails" },
  { hash: "Hq9ojtmWBPTsta4Stb4pSNrGk2rN1oMjzTiXj4zHf9NJ", attack: "A signature was requested between the counterparty's check and their transaction (front-running)", test: "t4_buy_with_stale_count_fails" },
  { hash: "2ZNyhGMG4cn1gS897XC24RVrqiaUJCCuQ4XyCYk9gGam", attack: "A withdrawal while an outside marketplace still holds an approval to sell it", test: "m1_withdraw_while_approved_fails" },
  { hash: "3GN75VgGEtyFgdm7yQS7k5ZaLZnXmwofXgmDTeV7n5A8", attack: "A borrower tries to withdraw the Bitcoin pledged as loan collateral", test: "l1_borrower_cannot_withdraw_collateral" },
  { hash: "ANbwMLtnfYMbMvtvbhwix6gd5LrVCAV9pDUk6AK7q1Um", attack: "A lender tries to seize the collateral before the loan is due", test: "l3_lender_cannot_claim_before_due" },
  { hash: "BGbWaeD2UZEeZEorpeV9AfKbWuuFhMM6r9iU68VDfcwU", attack: "Loan terms changed after the borrower read them", test: "o14_borrower_accepts_only_the_extension_they_saw" },
  { hash: "CoteHaM8auJ2AVqLqP67yEWcaDpnDUT7NgVpwRkN2Rfh", attack: "An heir claims while the holder is still around", test: "h9_any_holder_action_is_proof_of_life" },
  { hash: "2nimDRKnoTmddgnfTytjWPXySts41iktJhJPZg248Ywp", attack: "Dust sent to farm proof fees from the relayer", test: "ch2_the_same_small_amount_from_any_other_transaction_is_dust" },
  { hash: "EHX5b1cpU4pzpfu4DA5TEZL3db95dQ5NqSRRdgtQuqoh", attack: "New contract code deployed before its public delay ran out", test: "up3_announced_code_waits_for_the_delay" },
  { hash: "25pi2EER5uaAZ93Ph5eCnwboPiTmi1ocd8SEr5gD5ZEX", attack: "Different code deployed in place of the announced bytes", test: "up4_only_the_announced_bytes_deploy" },
];

function Refused() {
  const [seen, setSeen] = useState(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    refusals(REFUSED.map((r) => r.hash)).then(setSeen, (e) => setSeen({ error: e.message }));
  }, [attempt]);
  return (
    <section className="mine">
      <h1>What the contract refused</h1>
      <p className="lede">Real attempts against <code>{CONTRACT}</code>, each turned down by the contract itself. Who sent it, what it called and the contract's reason are read from NEAR just now, not stored on this page.</p>
      <p className="muted">The contract holds no key and its code is final (upgrades renounced 8 Nov), so these rules can't be switched off. Each one also has a test named after the attack in <code>contract/src/tests.rs</code>.</p>
      {!seen ? <p className="muted">Reading NEAR…</p>
        : seen.error ? <p className="error" role="alert">Couldn't read NEAR's archive: {seen.error}. <button className="ghost" onClick={() => { setSeen(null); setAttempt((n) => n + 1); }}>Try again</button></p>
        : <ol className="refused">{REFUSED.map((r) => {
          const x = seen.get(r.hash);
          return (
            <li key={r.hash}>
              <h2>{r.attack}</h2>
              {x ? <p><strong>Refused:</strong> {explain(x.panic)}</p> : <p className="error">Couldn't confirm a refusal in this transaction.</p>}
              <p className="muted">
                {x && <><code>{x.method}</code> from {x.signer}, {new Date(x.at).toLocaleString()} · </>}
                <a href={`${NEAR_EXPLORER}/tx/${r.hash}`} target="_blank" rel="noreferrer">{r.hash.slice(0, 8)}… on NEAR</a> · test <code>{r.test}</code>
              </p>
            </li>
          );
        })}</ol>}
    </section>
  );
}

// ---------- #/agents: the MCP server, listed live from the deployed endpoint ----------

const MCP_URL = `${location.origin}/api/mcp`;
const mcp = (method, params) => fetch("/api/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params && { params }) }) })
  .then((r) => r.json()).then((j) => { if (j.error) throw new Error(j.error.message); return j.result; });

function Agents() {
  const [d, setD] = useState(null);
  useEffect(() => {
    Promise.all([mcp("tools/list"), mcp("prompts/list"), mcp("resources/templates/list"), mcp("tools/call", { name: "pusaka_contract_trust", arguments: {} })])
      .then(([t, p, r, c]) => setD({ tools: t.tools, prompts: p.prompts, templates: r.resourceTemplates, trust: JSON.parse(c.content[0].text) }), (e) => setD({ error: e.message }));
  }, []);
  const add = `claude mcp add --transport http pusaka ${MCP_URL}`;
  return (
    <section className="mine">
      <h1>For AI agents</h1>
      <p className="lede">Pusaka speaks the Model Context Protocol. Any MCP host (Claude, an IDE, your own agent) can check the contract, audit a Pusaka's Bitcoin, read a borrower's record and find Bitcoin selling under its exit value, live, with no key.</p>
      <p><code>{add}</code> <CopyButton text={add} label="Copy" what="command" /></p>
      <p className="muted">Trading runs on your machine with your own key: <code>mcp/server.mjs</code> in the repo adds 30 more tools (buy, lend, borrow, gift links, sealed letters, withdrawals to Bitcoin, EVM, Solana and NEAR), each NEAR spend capped and, in hosts that support it, approved by you before it is signed.</p>
      {!d ? <p className="muted">Asking the server…</p> : d.error ? <p className="error">The MCP endpoint didn't answer: {d.error}</p> : <>
        <h2>Asked just now: <code>pusaka_contract_trust</code></h2>
        <p>{d.trust.keys.verdict}. Code changes: {d.trust.upgrades.final ? "none, ever (renounced)" : `a ${d.trust.upgrades.governance.kind ?? "single admin"} vote, then a ${d.trust.upgrades.timelock_minutes}-minute timelock`}.</p>
        <h2>{d.tools.length} tools on this endpoint</h2>
        <ul>{d.tools.map((t) => <li key={t.name}><code>{t.name}</code><span className="muted">{t.description.split(/(?<=\.)\s/)[0]}</span></li>)}</ul>
        <h2>Prompts</h2>
        <ul>{d.prompts.map((p) => <li key={p.name}><code>{p.name}</code><span className="muted">{p.title}</span></li>)}</ul>
        <h2>Resources</h2>
        <ul><li><code>pusaka://contract</code></li>{d.templates.map((r) => <li key={r.uriTemplate}><code>{r.uriTemplate}</code><span className="muted">{r.title}</span></li>)}</ul>
      </>}
    </section>
  );
}

function CopyButton({ text, label = "Copy", what = "address" }) {
  const [done, setDone] = useState(false);
  return (
    <button className="link" aria-label={done ? `Copied ${what}` : `Copy ${what}`} onClick={() => navigator.clipboard.writeText(text).then(() => setDone(true))}>
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
    case "Staking": return `Signed ${e.action === "withdraw" ? "a withdrawal of unstaked NEAR" : `${e.action === "stake" ? "a stake" : "an unstake"} of ${near(e.amount)} NEAR`} at ${e.pool}${e.signed ? "" : " (signature failed)"}`;
    case "WithdrawNbtc": return `Signed a transfer of ${Number(e.sats).toLocaleString()} nBTC sats from its own account${e.signed ? "" : " (signature failed)"}`;
    case "Royalty": return `Royalty of ${near(e.amount)} NEAR paid to its creator ${e.creator}`;
    case "HeirSet": return e.heir ? `Named an heir, ${e.heir}, who may claim it after ${days(e.after_ms)} of silence` : "Removed its heir";
    case "StillHere": return "Holder checked in: still here";
    case "Inherited": return `Inherited by ${e.to} after ${e.from} stayed silent`;
    case "Approved": return `Approved ${e.account} to sell it`;
    case "ApprovalsRevoked": return "Stopped selling on outside markets";
    case "LoanOfferAccepted": return `Took ${e.lender}'s loan offer #${e.offer_id}, due ${when(e.due_ms)}`;
    case "LoanRefinanced": return `Loan refinanced: ${e.to} paid off ${e.from}; repay ${near(e.repay)} NEAR by ${when(e.due_ms)}`;
    case "LoanPartRepaid": return `Repaid ${near(e.amount)} NEAR of the loan; ${near(e.remaining)} NEAR left`;
    case "ExtensionProposed": return `Lender offered ${days(e.extra_ms)} more for ${near(e.fee)} NEAR`;
    case "LoanExtended": return `Loan extended to ${when(e.due_ms)} for ${near(e.fee)} NEAR`;
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
  const exit = useExitQuote(info.loan ? Number(info.verified_sats) : 0, evmAddress(info.btc_pubkey)); // shared with the BTC section

  async function run(label, fn) {
    setBusy(label); setMsg(null);
    try { setMsg({ ok: true, text: await fn() }); if (["buy", "claim", "fund", "accept-offer"].includes(label)) celebrate(); await onDone(); }
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
              interest <strong>{pct(st.apr)} a year</strong>. Mainnet prices from mempool.space and Rhea, {px.crossChecked ? "within 5% of CoinGecko" : "not cross-checked (CoinGecko unavailable)"}.
              {exit?.usdc > 0 && <> If the lender takes the collateral, NEAR Intents solvers pay <strong>{usd(exit.usdc)}</strong> for its BTC
                right now, {(exit.usdc / st.principalUsd).toFixed(1)}× the loan.</>}
            </p>
          );
        })()}
        {funded && <p>{loan.borrower} borrowed {near(loan.principal)} NEAR from {loan.lender}. {near(loan.repay)} NEAR {overdue ? "was" : "is"} due {when(due)}.</p>}
        {funded && !overdue && (accountId === loan.borrower || accountId === loan.lender) && <Reminder uid={`loan-${id}-${due}`} at={due}
          alarmMin={Math.min(1440, (due - now) / 60_000 / 4)}
          title={accountId === loan.borrower ? `Repay Pusaka #${id}: ${near(loan.repay)} NEAR to ${loan.lender}` : `Pusaka #${id} loan to ${loan.borrower} is due`}
          details={accountId === loan.borrower ? `If ${near(loan.repay)} NEAR isn't repaid by then, ${loan.lender} can take the Pusaka and its ${btc(Number(info.verified_sats))} BTC.`
            : `If ${loan.borrower} hasn't repaid ${near(loan.repay)} NEAR by then, you can claim the Pusaka and its BTC.`} />}
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
        {funded && <LoanMarket t={t} accountId={accountId} isOwner={isOwner} busy={busy} run={run} />}
        {status}
      </section>
    );
  }

  if (!isOwner) {
    const markets = Object.keys(info.token.approved_account_ids ?? {});
    if (!info.listing && markets.length > 0) return (
      <section className="actions"><p>On sale through <code>{markets.join(", ")}</code>. While it is, its Bitcoin is locked:
        the owner can't withdraw it before the sale.</p><LoanMarket t={t} accountId={accountId} isOwner={isOwner} busy={busy} run={run} />{status}</section>
    );
    if (!info.listing) return <section className="actions"><p className="muted">This Pusaka isn't for sale or asking for a loan.</p><LoanMarket t={t} accountId={accountId} isOwner={isOwner} busy={busy} run={run} />{status}</section>;
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
        </p>
        {falling && <AuctionClock listing={info.listing} />}
        <LoanMarket t={t} accountId={accountId} isOwner={isOwner} busy={busy} run={run} />
        {status}
      </section>
    );
  }

  if (info.listing) return (
    <section className="actions">
      <p>Listed at <strong>{near(info.price_now ?? info.listing.price)} NEAR</strong>
        {info.listing.floor !== info.listing.price && <>, falling to {near(info.listing.floor)} NEAR by {when(info.listing.end_ms)}</>}.
        Withdrawals are locked while it's for sale.</p>
      <AuctionClock listing={info.listing} />
      {act("cancel", "Cancel listing", "Cancelling…", async () => {
        await callGasless("cancel_listing", { token_id: id });
        return "Listing cancelled. You can withdraw again.";
      }, true)}
      {status}
    </section>
  );

  return <OwnerForms t={t} busy={busy} run={run} status={status} market={<LoanMarket t={t} accountId={accountId} isOwner={isOwner} busy={busy} run={run} />} />;
}

function OwnerForms({ t, busy, run, status, market }) {
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
      {market}
      <GiftLink id={id} busy={busy} run={run} />
      <form onSubmit={sell} className="stack">
        <h2>Sell</h2>
        <label>Price
          <span className="row"><input type="number" min="0.01" step="any" value={price} onChange={(e) => setPrice(e.target.value)} required /> NEAR</span>
        </label>
        <label>Lower it over time to (optional)
          <span className="row">
            <input type="number" min="0.01" step="any" max={price} value={floor} onChange={(e) => setFloor(e.target.value)} placeholder="no auction" /> NEAR over
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
          <span className="row"><input type="number" min="0.01" step="any" value={principal} onChange={(e) => setPrincipal(e.target.value)} required /> NEAR</span>
        </label>
        <label>Repay
          <span className="row"><input type="number" min={principal} step="any" value={repay} onChange={(e) => setRepay(e.target.value)} required /> NEAR within
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

// ---------- loan market: standing offers (which also refinance a funded loan), part repayment, extensions ----------

const OFFER_STORAGE = 10n ** 22n; // 0.01 NEAR; the contract refunds what the entry doesn't use

async function allOffers() {
  const out = [];
  // one retry per page: a single rate-limited RPC answer used to hide the whole offer book
  const page = (from) => view("loan_offers", { from: String(from), limit: "100" })
    .catch(() => new Promise((r) => setTimeout(r, 2000)).then(() => view("loan_offers", { from: String(from), limit: "100" })));
  for (let from = 0, next = 1; from < next; from += 100) {
    const r = await page(from);
    next = Number(r.next_id);
    out.push(...r.offers);
  }
  return out;
}

function LoanMarket({ t, accountId, isOwner, busy, run }) {
  const { id, info } = t;
  const loan = info.loan;
  const funded = !!loan?.lender;
  const now = useNow(60_000);
  const [offers, setOffers] = useState([]);
  const [ext, setExt] = useState(null);
  const [a, setA] = useState(""); // principal / new repay / part / extra days
  const [b, setB] = useState(""); // repay / new days / fee
  const [c, setC] = useState("7"); // days
  useEffect(() => {
    if (!loan || funded) allOffers().then(setOffers, () => setOffers([]));
    if (funded) view("loan_extension", { token_id: id }).then(setExt, () => setExt(null));
  }, [id, info]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!accountId || (loan && !funded)) return null;
  const btn = (label, idle, busyText, fn) => (
    <button type="button" disabled={!!busy} onClick={() => run(label, fn)}>{busy === label ? busyText : idle}</button>
  );
  const form = (label, fn, children) => (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); run(label, fn); }}>{children}</form>
  );
  const sats = Number(info.verified_sats);
  const due = Number(loan?.due_ms);
  if (funded && now >= due) return null;
  const borrower = accountId === loan?.borrower, lender = accountId === loan?.lender;
  const owed = funded ? BigInt(loan.repay) : 0n; // a refinance pays this to the current lender first

  // Standing offers that fit this Pusaka. With a funded loan, taking one refinances it.
  const fits = offers
    .filter(({ offer: o }) => o.token_id === id || (o.min_verified_sats != null && sats >= Number(o.min_verified_sats)));
  const offerList = fits.length > 0 && <div className="stack">
    <h2>{funded ? "Refinance offers" : "Loan offers"}</h2>
    {fits.map(({ id: oid, offer: o }) => {
      const short = owed > BigInt(o.principal) ? owed - BigInt(o.principal) : 0n;
      const left = BigInt(o.principal) > owed ? BigInt(o.principal) - owed : 0n;
      return <p key={oid}>
        {o.lender} lends <strong>{near(o.principal)} NEAR</strong>, repay <strong>{near(o.repay)} NEAR</strong> within {days(o.duration_ms)}
        {o.token_id ? " (for this Pusaka)" : ` (any Pusaka with ${btc(Number(o.min_verified_sats))} BTC verified)`}.
        {funded && <> Pays off the {near(owed)} NEAR owed to {loan.lender}{short ? `; you add ${near(short)} NEAR` : `; ${near(left)} NEAR comes to you`}.</>}{" "}
        {isOwner && (!funded || borrower) && btn(`accept-${oid}`, funded ? "Refinance with this offer" : "Accept offer", "Accepting…", async () => {
          const args = { token_id: id, offer_id: oid, expected_sign_epoch: info.sign_epoch };
          // no top-up: the relayer pays the gas, so a BTC holder with no NEAR at all can borrow
          if (short) await call("accept_loan_offer", args, { deposit: short }); else await callGasless("accept_loan_offer", args);
          return funded ? `Refinanced: ${loan.lender} is paid off, ${o.lender} is your lender now. Repay ${near(o.repay)} NEAR within ${days(o.duration_ms)}.`
            : `Loan taken: ${near(o.principal)} NEAR is on its way to you. The Pusaka is collateral until you repay.`;
        })}
        {o.lender === accountId && btn(`cancel-${oid}`, "Cancel my offer", "Cancelling…", async () => {
          await call("cancel_loan_offer", { offer_id: oid });
          return "Offer cancelled. Your NEAR is on its way back.";
        })}
      </p>;
    })}
  </div>;
  const offerForm = !isOwner && !lender && form("offer", async () => {
    await call("offer_loan", { token_id: id, principal: yocto(a).toString(), repay: yocto(b).toString(), duration_ms: String(Math.round(Number(c) * DAY_MS)) },
      { deposit: yocto(a) + OFFER_STORAGE });
    return "Offer posted. Your NEAR waits in the contract until the owner accepts or you cancel.";
  }, <>
    <h2>{funded ? "Offer to refinance" : "Offer a loan"}</h2>
    <label>Lend <span className="row"><input type="number" min="0.01" step="any" value={a} onChange={(e) => setA(e.target.value)} required /> NEAR, repay
      <input type="number" min={a} step="any" value={b} onChange={(e) => setB(e.target.value)} required /> NEAR within
      <input type="number" min="0.001" step="any" value={c} onChange={(e) => setC(e.target.value)} required /> days</span></label>
    <button disabled={!!busy}>{busy === "offer" ? "Offering…" : "Offer a loan"}</button>
    <p className="muted">The NEAR is held by the contract. {funded
      ? `If the borrower takes it, it first pays ${loan.lender} the ${near(owed)} NEAR owed and you become the lender.`
      : "If the owner accepts, it goes to them and this Pusaka becomes your collateral."}</p>
  </>);

  if (!loan) return <>{offerList}{offerForm}</>;
  return <>
    {offerList}
    {offerForm}
    {borrower && form("part", async () => {
      await call("repay_partial", { token_id: id }, { deposit: yocto(a) });
      return `Paid ${a} NEAR to ${loan.lender}.`;
    }, <>
      <label>Repay part <span className="row"><input type="number" min="0.0001" step="any" value={a} onChange={(e) => setA(e.target.value)} required /> NEAR now</span></label>
      <button disabled={!!busy}>{busy === "part" ? "Paying…" : "Repay part"}</button>
    </>)}
    {borrower && ext && <p>{loan.lender} offers {days(ext.extra_ms)} more for {near(ext.fee)} NEAR.{" "}
      {btn("extend", "Accept extension", "Extending…", async () => {
        await call("accept_extension", { token_id: id, extra_ms: ext.extra_ms }, { deposit: BigInt(ext.fee) });
        return `Extended. Now due ${when(due + Number(ext.extra_ms))}.`;
      })}</p>}
    {lender && form("propose", async () => {
      await call("propose_extension", { token_id: id, extra_ms: String(Math.round(Number(a) * DAY_MS)), fee: yocto(b || 0).toString() }, { deposit: OFFER_STORAGE });
      return "Extension offered. The borrower can take it before the due date.";
    }, <>
      <label>Propose extension <span className="row">+<input type="number" min="0.001" step="any" value={a} onChange={(e) => setA(e.target.value)} required /> days for
        <input type="number" min="0" step="any" value={b} onChange={(e) => setB(e.target.value)} placeholder="0" /> NEAR</span></label>
      <button disabled={!!busy}>{busy === "propose" ? "Proposing…" : "Propose extension"}</button>
    </>)}
  </>;
}
