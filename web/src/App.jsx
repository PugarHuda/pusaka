import { useCallback, useEffect, useState } from "react";
import {
  CONTRACT, EXPLORER, MINT_DEPOSIT, WITHDRAW_DEPOSIT,
  balances, broadcast, btcAddress, finalize, scriptHex,
} from "@pusaka/shared";
import Emblem from "./Emblem.jsx";
import { call, connector, near, view, yocto } from "./near.js";

const btc = (sats) => (sats / 1e8).toFixed(8);

// ---------- data ----------

async function loadToken(id) {
  const info = await view("token_info", { token_id: id });
  if (!info) return null;
  const address = info.btc_pubkey ? btcAddress(info.btc_pubkey) : null;
  let bal = { safe: 0, pending: 0, atRisk: 0, spendable: [] };
  if (address) bal = await balances(address, info.signed_outpoints).catch(() => ({ ...bal, error: true }));
  return { id, info, address, bal };
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
      await call("nft_mint", {}, { deposit: MINT_DEPOSIT });
      const id = String(await view("nft_total_supply"));
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
        <span className="net">Testnet demo</span>
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
          Contract <a href={`https://testnet.nearblocks.io/address/${CONTRACT}`}>{CONTRACT}</a>. Signatures by NEAR Chain
          Signatures (<code>v1.signer-prod.testnet</code>). Built at NEAR HACKATHON.
        </p>
      </footer>
    </>
  );
}

// ---------- home ----------

function Home() {
  const [tokens, setTokens] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    view("nft_tokens", { from_index: "0", limit: 60 })
      .then((ts) => Promise.all(ts.map((t) => loadToken(t.token_id))))
      .then((list) => setTokens(list.filter(Boolean).reverse()))
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
            <Emblem pubkey={t.info.btc_pubkey} sats={t.bal.safe} locked={!!t.info.listing || t.info.pending} size={168} />
            <span className="piece-name">Pusaka #{t.id}</span>
            <span className="piece-btc">{btc(t.bal.safe)} BTC</span>
            {t.info.listing && <span className="piece-price">For sale at {near(t.info.listing.price)} NEAR</span>}
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

  if (missing) return <p className="error">There is no Pusaka #{id}. <a href="#/">See all Pusaka</a></p>;
  if (!t) return <p className="muted">Loading Pusaka #{id}…</p>;

  const { info, address, bal } = t;
  const owner = info.token.owner_id;
  const isOwner = accountId === owner;
  const locked = !!info.listing || info.pending;

  return (
    <article className="detail">
      <div className="detail-face">
        <Emblem pubkey={info.btc_pubkey} sats={bal.safe} locked={locked} size={320} />
        <h1>Pusaka #{id}</h1>
        <p className="muted">Owned by <strong>{isOwner ? "you" : owner}</strong></p>
      </div>

      <div className="detail-body">
        <section>
          <h2>Bitcoin inside</h2>
          <p className="amount"><span>{btc(bal.safe)}</span> BTC</p>
          <p className="muted">{bal.safe.toLocaleString()} sats you can count on</p>
          {bal.atRisk > 0 && (
            <p className="warn">
              A signature already exists that can spend {bal.atRisk.toLocaleString()} more sats, so they're left out of
              the amount above. They stop counting as at risk once that transaction lands on Bitcoin.
            </p>
          )}
          {bal.pending > 0 && (
            <p className="muted">
              {bal.pending.toLocaleString()} more sats are waiting for a Bitcoin confirmation. Until then whoever sent
              them could still replace that transaction, so they aren't counted yet.
            </p>
          )}
          {bal.error && <p className="error">mempool.space didn't answer, so the balance may be out of date.</p>}
          {address ? (
            <p className="addr">
              <a href={`${EXPLORER}/address/${address}`} target="_blank" rel="noreferrer">{address}</a>
              <CopyButton text={address} />
            </p>
          ) : (
            <p className="muted">The Bitcoin key is still being derived by the NEAR MPC network.</p>
          )}
        </section>

        <Actions t={t} accountId={accountId} isOwner={isOwner} onDone={refresh} />

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
    case "Listed": return `Listed for ${near(e.price)} NEAR`;
    case "Unlisted": return "Listing cancelled";
    case "Sale": return `Sold by ${e.from} to ${e.to} for ${near(e.price)} NEAR`;
    case "Transfer": return `Given by ${e.from} to ${e.to}`;
    case "Withdraw": return `Withdrew ${Number(e.amount_sat).toLocaleString()} sats (${e.signed}/${e.inputs} inputs signed)`;
    default: return e.kind;
  }
}

// ---------- actions ----------

function Actions({ t, accountId, isOwner, onDone }) {
  const { id, info, bal } = t;
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState(null);

  async function run(label, fn) {
    setBusy(label); setMsg(null);
    try { setMsg({ ok: true, text: await fn() }); await onDone(); }
    catch (e) { setMsg({ ok: false, text: e.message }); }
    finally { setBusy(""); }
  }

  if (!accountId) return (
    <section className="actions">
      <button onClick={() => connector.connect()}>Connect NEAR wallet</button>
      <p className="muted">Connect to buy this Pusaka or manage your own.</p>
    </section>
  );

  if (info.pending) return <section className="actions"><p className="warn">The NEAR MPC network is signing a withdrawal. The Pusaka is locked until it finishes.</p></section>;

  const status = msg && <p className={msg.ok ? "ok" : "error"} role="status">{msg.text}</p>;

  if (!isOwner) {
    if (!info.listing) return <section className="actions"><p className="muted">This Pusaka isn't for sale.</p></section>;
    return (
      <section className="actions">
        <button disabled={!!busy} onClick={() => run("buy", async () => {
          await call("buy", { token_id: id, expected_signed_count: info.signed_outpoints.length }, { deposit: BigInt(info.listing.price) });
          return `You own Pusaka #${id} and the ${btc(bal.safe)} BTC inside it.`;
        })}>{busy === "buy" ? "Buying…" : `Buy for ${near(info.listing.price)} NEAR`}</button>
        <p className="muted">You get {btc(bal.safe)} BTC. The NEAR goes to {info.listing.seller}.</p>
        {status}
      </section>
    );
  }

  if (info.listing) return (
    <section className="actions">
      <p>Listed for <strong>{near(info.listing.price)} NEAR</strong>. Withdrawals are locked while it's for sale.</p>
      <button className="ghost" disabled={!!busy} onClick={() => run("cancel", async () => {
        await call("cancel_listing", { token_id: id });
        return "Listing cancelled. You can withdraw again.";
      })}>{busy === "cancel" ? "Cancelling…" : "Cancel listing"}</button>
      {status}
    </section>
  );

  return <OwnerForms t={t} busy={busy} run={run} status={status} />;
}

function OwnerForms({ t, busy, run, status }) {
  const { id, bal } = t;
  const [price, setPrice] = useState("1");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const FEE = 300;
  const spendableSats = bal.safe + bal.pending;

  function sell(e) {
    e.preventDefault();
    run("list", async () => {
      await call("list", { token_id: id, price: yocto(price).toString() });
      return `Listed for ${price} NEAR.`;
    });
  }

  function withdraw(e) {
    e.preventDefault();
    run("withdraw", async () => {
      const sats = Math.round(Number(amount) * 1e8);
      let script;
      try { script = scriptHex(to); } catch { // checked before anything is signed
        throw new Error("That isn't a Bitcoin testnet address. It should start with tb1.");
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
      <form onSubmit={sell} className="row">
        <label>Sell for
          <input type="number" min="0.01" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} required /> NEAR
        </label>
        <button disabled={!!busy}>{busy === "list" ? "Listing…" : "List for sale"}</button>
      </form>
      <form onSubmit={withdraw} className="stack">
        <label>Send Bitcoin to
          <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="tb1q…" required spellCheck="false" />
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
