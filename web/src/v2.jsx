// #/v2: Pusaka v2 (pusaka-v2.testnet). The NFT's own account (NEP-616 `0s…`), its name (t<id>.pusaka-v2.testnet)
// and the post-quantum lock (ML-DSA-65, verified on-chain). Loaded on demand: nothing here is in the main bundle.
import { useEffect, useState } from "react";
import { MINT_DEPOSIT, NEAR_EXPLORER, mintedTokenId, signInSignature } from "@pusaka/shared";
import { pqKeys, pqSign } from "@pusaka/shared/pq";
import { base64, hex } from "@scure/base";
import { callRaw, connector, near, provider, yocto } from "./near.js";

export const V2 = "pusaka-v2.testnet";
const view = (method, args = {}, contractId = V2) => provider.callFunction({ contractId, method, args, blockQuery: { finality: "optimistic" } });
// NEAR Intents on testnet: NEAR's unmodified `defuse` verifier, as Tidepool deploys it (README)
const VERIFIER = "verifier.tidepool-sandbox.testnet", USDC = "usdc.tidepool-sandbox.testnet";
const amountOf = (t, a) => t === `nep141:${USDC}` ? `${Number(a) / 1e6} USDC` : `${a} ${t}`;
/** What the NFT's own account holds inside NEAR Intents: [[token, amount]]. */
async function intentsOf(account) {
  const ids = (await view("mt_tokens_for_owner", { account_id: account, limit: 20 }, VERIFIER)).map((t) => t.token_id);
  const amounts = ids.length ? await view("mt_batch_balance_of", { account_id: account, token_ids: ids }, VERIFIER) : [];
  return ids.map((t, i) => [t, amounts[i]]).filter(([, a]) => a !== "0");
}
const accountOf = (id) => provider.viewAccount({ accountId: id, blockQuery: { finality: "optimistic" } }).catch(() => null);
const link = (h) => <a href={`${NEAR_EXPLORER}/tx/${h}`} target="_blank" rel="noreferrer">view transaction</a>;
const acctLink = (a) => <a href={`${NEAR_EXPLORER}/account/${a}`} target="_blank" rel="noreferrer"><code>{a}</code></a>;

export default function V2Page({ id, accountId }) {
  return id ? <V2Token key={id} id={id} accountId={accountId} /> : <V2List accountId={accountId} />;
}

function Intro() {
  return (
    <p className="muted">
      Pusaka v2 runs beside the original contract, which is final and can't change. Same Bitcoin, loans and inheritance,
      plus: <strong>the NFT owns a NEAR account</strong> (an address fixed before it exists, with no keys,
      answering only to the current holder), <strong>a readable name</strong> for it, an optional{" "}
      <strong>post-quantum lock</strong> (ML-DSA-65, checked on-chain), an AI agent's daily budget, signing in as the NFT,
      and its own NEAR Intents balance. Contract {acctLink(V2)}, upgraded through a DAO vote and a 10-minute timelock;
      until its deploy key is deleted on 13 Nov, the team can also change it directly.
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
          {[...toks].sort((a, b) => (b.owner_id === accountId) - (a.owner_id === accountId)).map((t) => <li key={t.token_id}><a href={`#/v2/${t.token_id}`}>Pusaka v2 #{t.token_id}</a> <span className="muted">held by {t.owner_id === accountId ? <strong>you</strong> : t.owner_id}</span></li>)}
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
      const [acct, alias, pq, ag] = await Promise.all([view("account_of", { token_id: id }), view("alias_of", { token_id: id }), view("pq_key_of", { token_id: id }), view("agent_of", { token_id: id })]);
      const [a, b, intents] = await Promise.all([accountOf(acct), accountOf(alias), intentsOf(acct).catch(() => null)]);
      return { info, acct, alias, pq, ag, a, b, intents };
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
      <p><a className="pill pill-soft" href={`${location.pathname}?contract=${V2}#/pusaka/${id}`}>Open #{id} in the full app: Bitcoin, sale, loans, heir</a></p>
      <h2>Its own account</h2>
      <dl className="v2-accounts">
        <dt>Account (NEP-616)</dt><dd>{acctLink(s.acct)}: {bal(s.a)}{s.a && <span className="muted"> · no access keys · code: the token-account global contract</span>}</dd>
        <dt>Name</dt><dd>{acctLink(s.alias)}: {bal(s.b)}</dd>
      </dl>
      <p className="muted">The address is fixed by its content before it exists, so anyone can send NEAR or tokens to it. Only the
        current holder can move them, through the contract, and only while the Pusaka isn't for sale, pledged or signing.
        When it changes hands, the account goes with it.</p>
      <h2>Its NEAR Intents balance</h2>
      {s.intents?.length ? <p>{s.intents.map(([t, a]) => amountOf(t, a)).join(", ")}, held by its account inside NEAR Intents.</p>
        : <p className="muted">{s.intents ? "Nothing yet." : "Couldn't read the verifier."} Anyone can deposit into NEAR Intents for its account
          (<code>ft_transfer_call</code> to <code>{VERIFIER}</code> with <code>msg</code> = the account above).</p>}
      <p className="muted">The balance changes hands with the NFT. The account has no keys and the contract refuses to give it a signing
        key on the verifier, so only the current holder can move it.</p>
      <h2>Post-quantum lock</h2>
      {s.pq ? <p>On: every action by the holder needs a fresh unlock signed with their ML-DSA-65 key and checked on-chain
        {s.pq.open ? <> (<strong>open now</strong>, until block {s.pq.unlocked_until_block})</> : <> (<strong>locked</strong>)</>}. Unlocks used: {s.pq.nonce}.</p>
        : <p className="muted">Off. The holder can register an ML-DSA-65 key; from then on a stolen NEAR key alone can't move or drain this Pusaka.</p>}
      <p className="muted">It guards the NEAR side. The Bitcoin, EVM and Solana keys are NEAR MPC keys, which have no post-quantum scheme yet.</p>
      <h2>Agent budget</h2>
      {s.ag ? <p><strong>{s.ag.agent}</strong> may send up to {near(s.ag.daily)} NEAR a day from its account
        {s.ag.to.length ? <> to {s.ag.to.join(", ")} only</> : <> to anyone</>}; <strong>{near(s.ag.left_today)} NEAR left today</strong>.</p>
        : <p className="muted">None. The holder can give an AI agent a daily budget from the NFT's account.</p>}
      <p className="muted">The contract enforces the budget, not the agent's software: a hacked agent loses at most a day's budget,
        only to the listed accounts, never while the Pusaka is for sale or pledged, and the budget ends when it changes hands.</p>
      {isOwner && <Owner id={id} s={s} owner={owner} reload={reload} />}
      {!isOwner && s.ag && accountId === s.ag.agent && <AgentSend id={id} s={s} reload={reload} />}
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
  const [seed, setSeed] = useState(""); // memory only, never web storage: the key file is the copy
  const [newSeed, setNewSeed] = useState(null);
  const [agent, setAgent] = useState(s.ag?.agent ?? "");
  const [daily, setDaily] = useState("0.05");
  const [agentTo, setAgentTo] = useState("");
  const [signedIn, setSignedIn] = useState(null);

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
      <form className="stack" onSubmit={(e) => { e.preventDefault(); run("agent", async () => {
        const off = !Number(daily);
        const o = await tx("set_agent", { token_id: id, agent: agent.trim().toLowerCase(), daily: off ? null : yocto(daily).toString(),
          to: off ? [] : agentTo.split(/[\s,]+/).filter(Boolean).map((x) => x.toLowerCase()) }, yocto(0.01), 30);
        return <>{off ? "Agent budget revoked." : `${agent} may now spend up to ${daily} NEAR a day.`} {link(o.transaction.hash)}</>;
      }); }}>
        <h3>Give an agent a daily budget</h3>
        <label>Agent account <input value={agent} onChange={(e) => setAgent(e.target.value)} placeholder="my-agent.testnet" required spellCheck="false" autoCapitalize="none" /></label>
        <label>Per day <span className="row"><input type="number" min="0" step="any" value={daily} onChange={(e) => setDaily(e.target.value)} required /> NEAR (0 revokes)</span></label>
        <label>Only to (optional, up to 5) <input value={agentTo} onChange={(e) => setAgentTo(e.target.value)} placeholder="shop.testnet, rent.testnet" spellCheck="false" autoCapitalize="none" /></label>
        <button disabled={!!busy}>{busy === "agent" ? "Saving…" : "Save the budget (0.01 NEAR storage)"}</button>
      </form>
      {s.intents?.some(([t]) => t === `nep141:${USDC}`) && <button className="ghost" disabled={!!busy} onClick={() => run("intents", async () => {
        const [, all] = s.intents.find(([t]) => t === `nep141:${USDC}`);
        if (!(await view("storage_balance_of", { account_id: owner }, USDC))) throw new Error(`Register ${owner} with ${USDC} first (storage_deposit), or the verifier refunds the withdrawal.`);
        const args = base64.encode(new TextEncoder().encode(JSON.stringify({ token: USDC, receiver_id: owner, amount: all })));
        const o = await tx("account_call", { token_id: id, alias: false, receiver_id: VERIFIER, method_name: "ft_withdraw", args, deposit: "1", gas_tgas: 60 }, 1n, 150);
        return <>Withdrew {amountOf(`nep141:${USDC}`, all)} from its NEAR Intents balance to you. {link(o.transaction.hash)}</>;
      })}>{busy === "intents" ? "Withdrawing…" : "Withdraw its Intents USDC to me"}</button>}
      <div className="stack">
        <h3>Sign in as this Pusaka</h3>
        <p className="muted">Its own EVM key (the NEAR MPC key that holds its Bitcoin) signs a standard Sign-In with Ethereum message
          naming you as the holder, valid for an hour. Any site that accepts it sees the Pusaka's address as the user. While it's
          valid you can't list this Pusaka or approve a market, so it can't outlive a sale.</p>
        <button disabled={!!busy} onClick={() => run("signin", async () => {
          const nonce = hex.encode(crypto.getRandomValues(new Uint8Array(8)));
          const o = await tx("sign_in", { token_id: id, domain: location.host, uri: location.href.split("#")[0], chain_id: "1", nonce }, 1n);
          const signed = JSON.parse(new TextDecoder().decode(base64.decode(o.status.SuccessValue)));
          setSignedIn({ ...signed, signature: await signInSignature(signed) });
          return <>Signed in as {signed.address}; the signature recovers to it. {link(o.transaction.hash)}</>;
        })}>{busy === "signin" ? "Signing…" : `Sign in to ${location.host} as Pusaka v2 #${id}`}</button>
        {signedIn && <pre className="siwe">{`${signedIn.message}\n\n${signedIn.signature}`}</pre>}
      </div>
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
          {s.pq.open && <button type="button" className="ghost" disabled={!!busy} onClick={() => run("pqoff", async () => {
            const o = await tx("set_pq_key", { token_id: id, public_key: null }, 0n);
            return <>Post-quantum lock off: your NEAR key alone controls this Pusaka again. {link(o.transaction.hash)}</>;
          })}>{busy === "pqoff" ? "Turning off…" : "Turn the lock off (needs the unlock above)"}</button>}
        </form>
      )}
      {msg && <p className={msg.ok ? "ok" : "error"} role="status">{msg.text}</p>}
    </div>
  );
}

function AgentSend({ id, s, reload }) {
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("0.01");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  return (
    <form className="stack actions" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true); setMsg(null);
      try {
        const o = await callRaw("agent_send", { token_id: id, receiver_id: to.trim().toLowerCase(), amount: yocto(amount).toString() }, { deposit: 0n, tgas: 100, receiver: V2 });
        setMsg({ ok: true, text: <>Sent {amount} NEAR within your budget. {link(o.transaction.hash)}</> }); await reload();
      } catch (err) { setMsg({ ok: false, text: err.message }); } finally { setBusy(false); }
    }}>
      <h3>You are this Pusaka's agent: send within your budget</h3>
      <label>To <input value={to} onChange={(e) => setTo(e.target.value)} required spellCheck="false" autoCapitalize="none" /></label>
      <label>Amount <span className="row"><input type="number" min="0.001" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} required /> NEAR</span></label>
      <button disabled={busy}>{busy ? "Sending…" : `Send (${near(s.ag.left_today)} NEAR left today)`}</button>
      {msg && <p className={msg.ok ? "ok" : "error"} role="status">{msg.text}</p>}
    </form>
  );
}
