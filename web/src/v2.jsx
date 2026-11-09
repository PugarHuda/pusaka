// #/v2: Pusaka v2 (pusaka-v2.testnet). The NFT's own account (NEP-616 `0s…`), its name (t<id>.pusaka-v2.testnet)
// and the post-quantum lock (ML-DSA-65, verified on-chain). Loaded on demand: nothing here is in the main bundle.
import { useEffect, useState } from "react";
import { MINT_DEPOSIT, NEAR_EXPLORER, mintedTokenId } from "@pusaka/shared";
import { pqKeys, pqSign } from "@pusaka/shared/pq";
import { base64, hex } from "@scure/base";
import { callRaw, connector, near, provider, yocto } from "./near.js";

export const V2 = "pusaka-v2.testnet";
const view = (method, args = {}) => provider.callFunction({ contractId: V2, method, args, blockQuery: { finality: "optimistic" } });
const accountOf = (id) => provider.viewAccount({ accountId: id, blockQuery: { finality: "optimistic" } }).catch(() => null);
const SEED_KEY = (id, owner) => `pusaka-v2-pq:${owner}:${id}`; // this session only: the file is the real copy
const link = (h) => <a href={`${NEAR_EXPLORER}/tx/${h}`} target="_blank" rel="noreferrer">view transaction</a>;
const acctLink = (a) => <a href={`${NEAR_EXPLORER}/account/${a}`} target="_blank" rel="noreferrer"><code>{a}</code></a>;

export default function V2Page({ id, accountId }) {
  return id ? <V2Token key={id} id={id} accountId={accountId} /> : <V2List accountId={accountId} />;
}

function Intro() {
  return (
    <p className="muted">
      Pusaka v2 runs beside the original contract, which is final and can't change. Same Bitcoin, loans and inheritance,
      plus three things: <strong>the NFT owns a NEAR account</strong> (an address fixed before it exists, with no keys,
      answering only to the current holder), <strong>a readable name</strong> for it, and an optional{" "}
      <strong>post-quantum lock</strong> (ML-DSA-65, checked on-chain). Contract {acctLink(V2)}, upgradeable only
      through a DAO vote and a 10-minute timelock.
    </p>
  );
}

function V2List({ accountId }) {
  const [toks, setToks] = useState(null);
  const [msg, setMsg] = useState("");
  useEffect(() => { view("nft_tokens", { from_index: "0", limit: 100 }).then(setToks, (e) => setToks({ error: e.message })); }, []);
  async function mint() {
    setMsg("Confirm in your wallet…");
    try {
      const o = await callRaw("nft_mint", {}, { deposit: MINT_DEPOSIT, tgas: 300, receiver: V2 });
      location.hash = `#/v2/${mintedTokenId(o, accountId)}`;
    } catch (e) { setMsg(e.message); }
  }
  return (
    <section>
      <h1>Pusaka v2</h1>
      <Intro />
      {accountId ? <button onClick={mint}>Mint a v2 Pusaka</button> : <button onClick={() => connector.connect()}>Connect NEAR wallet to mint</button>}
      {msg && <p className="muted" role="status">{msg}</p>}
      {!toks ? <p className="muted">Reading {V2}…</p> : toks.error ? <p className="error">Couldn't read {V2}: {toks.error}</p> : (
        <ul className="v2-list">
          {toks.map((t) => <li key={t.token_id}><a href={`#/v2/${t.token_id}`}>Pusaka v2 #{t.token_id}</a> <span className="muted">held by {t.owner_id}</span></li>)}
        </ul>
      )}
    </section>
  );
}

function V2Token({ id, accountId }) {
  const [s, setS] = useState(null);
  const [tick, setTick] = useState(0);
  const reload = () => setTick((t) => t + 1);
  useEffect(() => {
    let live = true;
    (async () => {
      const info = await view("token_info", { token_id: id });
      if (!info) return { error: `There is no Pusaka v2 #${id}.` };
      const [acct, alias, pq] = await Promise.all([view("account_of", { token_id: id }), view("alias_of", { token_id: id }), view("pq_key_of", { token_id: id })]);
      const [a, b] = await Promise.all([accountOf(acct), accountOf(alias)]);
      return { info, acct, alias, pq, a, b };
    })().catch((e) => ({ error: e.message })).then((x) => live && setS(x));
    return () => { live = false; };
  }, [id, tick]);
  if (!s) return <section><p className="muted">Reading Pusaka v2 #{id}…</p></section>;
  if (s.error) return <section><h1>Pusaka v2 #{id}</h1><p className="error">{s.error}</p><a href="#/v2">All v2 Pusakas</a></section>;
  const owner = s.info.token.owner_id, isOwner = accountId === owner;
  const bal = (x) => x ? `${near(x.amount)} NEAR` : "not created yet";
  return (
    <section className="v2">
      <p><a href="#/v2">← All v2 Pusakas</a></p>
      <h1>Pusaka v2 #{id}</h1>
      <p>Held by <strong>{owner}</strong>{isOwner && " (you)"}.</p>
      <h2>Its own account</h2>
      <dl className="v2-accounts">
        <dt>Account (NEP-616)</dt><dd>{acctLink(s.acct)}: {bal(s.a)}{s.a && <span className="muted"> · no access keys · code: the token-account global contract</span>}</dd>
        <dt>Name</dt><dd>{acctLink(s.alias)}: {bal(s.b)}</dd>
      </dl>
      <p className="muted">The address is fixed by its content before it exists, so anyone can send NEAR or tokens to it. Only the
        current holder can move them, through the contract, and only while the Pusaka isn't for sale, pledged or signing.
        When it changes hands, the account goes with it.</p>
      <h2>Post-quantum lock</h2>
      {s.pq ? <p>On: every action by the holder needs a fresh unlock signed with their ML-DSA-65 key and checked on-chain
        {s.pq.open ? <> (<strong>open now</strong>, until block {s.pq.unlocked_until_block})</> : <> (<strong>locked</strong>)</>}. Unlocks used: {s.pq.nonce}.</p>
        : <p className="muted">Off. The holder can register an ML-DSA-65 key; from then on a stolen NEAR key alone can't move or drain this Pusaka.</p>}
      <p className="muted">It guards the NEAR side. The Bitcoin, EVM and Solana keys are NEAR MPC keys, which have no post-quantum scheme yet.</p>
      {isOwner && <Owner id={id} s={s} owner={owner} reload={reload} />}
      <h2>History</h2>
      <ol className="v2-history">{s.info.history.map((e, i) => <li key={i}>{e.event.kind}</li>)}</ol>
    </section>
  );
}

function Owner({ id, s, owner, reload }) {
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState(null);
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("0.01");
  const [useAlias, setUseAlias] = useState(false);
  const [seed, setSeed] = useState(() => { try { return sessionStorage.getItem(SEED_KEY(id, owner)) ?? ""; } catch { return ""; } });
  const [newSeed, setNewSeed] = useState(null);

  async function run(label, fn) {
    setBusy(label); setMsg(null);
    try { setMsg({ ok: true, text: await fn() }); await reload(); }
    catch (e) { setMsg({ ok: false, text: e.message }); }
    finally { setBusy(""); }
  }
  const tx = (method, args, deposit, tgas = 300) => callRaw(method, args, { deposit, tgas, receiver: V2 });
  const keysFrom = (seedHex) => {
    if (!/^[0-9a-f]{64}$/i.test(seedHex.trim())) throw new Error("The post-quantum key is 64 hex characters (from the file you saved).");
    return pqKeys(hex.decode(seedHex.trim().toLowerCase()));
  };

  function createKey() {
    const sd = hex.encode(crypto.getRandomValues(new Uint8Array(32)));
    setNewSeed(sd);
    try { sessionStorage.setItem(SEED_KEY(id, owner), sd); } catch { /* the file is the copy that matters */ }
    setSeed(sd);
  }
  const download = (sd) => URL.createObjectURL(new Blob([JSON.stringify({ pusaka: V2, token_id: id, holder: owner, ml_dsa65_seed_hex: sd }, null, 2)], { type: "application/json" }));

  return (
    <div className="actions">
      {!s.a && <button disabled={!!busy} onClick={() => run("open", async () => link((await tx("open_account", { token_id: id }, yocto(0.01))).transaction.hash))}>
        {busy === "open" ? "Creating…" : "Create its account (0.01 NEAR)"}</button>}
      {!s.b && <button className="ghost" disabled={!!busy} onClick={() => run("name", async () => link((await tx("name_account", { token_id: id }, yocto(0.05))).transaction.hash))}>
        {busy === "name" ? "Naming…" : `Give it the name t${id}.${V2} (0.05 NEAR)`}</button>}
      <form className="stack" onSubmit={(e) => { e.preventDefault(); run("send", async () => {
        const o = await tx("account_call", { token_id: id, alias: useAlias, receiver_id: to.trim().toLowerCase(), method_name: "", args: "", deposit: yocto(amount).toString(), gas_tgas: 0 }, 1n);
        return <>Sent {amount} NEAR from the Pusaka's {useAlias ? "named" : ""} account. {link(o.transaction.hash)}</>;
      }); }}>
        <h3>Send NEAR from its account</h3>
        <label>To <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="name.testnet" required spellCheck="false" autoCapitalize="none" /></label>
        <label>Amount <span className="row"><input type="number" min="0.001" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} required /> NEAR</span></label>
        <label className="row"><input type="checkbox" checked={useAlias} onChange={(e) => setUseAlias(e.target.checked)} /> from the named account</label>
        <button disabled={!!busy}>{busy === "send" ? "Sending…" : "Send"}</button>
      </form>
      {!s.pq ? (
        <div className="stack">
          <h3>Turn on the post-quantum lock</h3>
          {!newSeed ? <button className="ghost" onClick={createKey}>Create an ML-DSA-65 key</button> : <>
            <p className="warn">Save this file now. Without it you can't unlock this Pusaka, so you couldn't sell, give or withdraw it.</p>
            <a className="pill" href={download(newSeed)} download={`pusaka-v2-${id}-pq-key.json`}>Download the key file</a>
            <button disabled={!!busy} onClick={() => run("pqset", async () => {
              const o = await tx("set_pq_key", { token_id: id, public_key: base64.encode(keysFrom(newSeed).publicKey) }, yocto(0.03));
              return <>Post-quantum lock on. {link(o.transaction.hash)}</>;
            })}>{busy === "pqset" ? "Registering…" : "I saved it: register the key (0.03 NEAR)"}</button>
          </>}
        </div>
      ) : (
        <form className="stack" onSubmit={(e) => { e.preventDefault(); run("unlock", async () => {
          const k = keysFrom(seed);
          if (base64.encode(k.publicKey) !== s.pq.public_key) throw new Error("That key isn't the one registered for this Pusaka.");
          const nonce = String(Number(s.pq.nonce) + 1);
          const o = await tx("pq_unlock", { token_id: id, nonce, signature: pqSign(k.secretKey, s.pq.message_for_next_unlock) }, 0n);
          return <>Unlocked for about 2 minutes, signature checked on-chain by <code>ml_dsa_verify</code>. {link(o.transaction.hash)}</>;
        }); }}>
          <h3>Unlock with your post-quantum key</h3>
          <label>Key (from your key file: <code>ml_dsa65_seed_hex</code>)
            <input value={seed} onChange={(e) => setSeed(e.target.value)} required spellCheck="false" autoComplete="off" pattern="[0-9a-fA-F]{64}" />
          </label>
          <button disabled={!!busy}>{busy === "unlock" ? "Signing…" : "Sign an unlock"}</button>
          <p className="muted">Signed in this browser; only the signature leaves it.</p>
        </form>
      )}
      {msg && <p className={msg.ok ? "ok" : "error"} role="status">{msg.text}</p>}
    </div>
  );
}
