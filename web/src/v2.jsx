// #/v2: Smart Pusakas (contract pusaka-v2.testnet): the NFT's own account (NEP-616 `0s…`), its name, the post-quantum
// lock, an agent budget, sign-in, BIP-322, rental, Bitcoin sale, vault and call options. How each works: #/docs.
// Loaded on demand: nothing here is in the main bundle.
import { useEffect, useState } from "react";
import { ORIGINAL, SIBLINGS, nbtcDepositAddress, MINT_DEPOSIT, NEAR_EXPLORER, EXPLORER, NBTC, mintedTokenId, signInSignature, btcAddress, scriptHex, scriptAddress } from "@pusaka/shared";
import { redeemPlan } from "@pusaka/shared/nbtc";
import { witnessFromMpc } from "@pusaka/shared/bip322";
import { pqKeys, pqSign } from "@pusaka/shared/pq";
import { base64, hex } from "@scure/base";
import { callRaw, connector, near, provider, yocto } from "./near.js";

export const V2 = "pusaka-v2.testnet";
/** A Smart Pusaka's page in the full app (Bitcoin, sale, loans, heir, and its own features in one place). */
const smartHref = (id) => `${location.pathname}${V2 === ORIGINAL ? "" : `?contract=${V2}`}#/pusaka/${id}`;
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
/** Everything a buyer of the NFT also gets: Pusakas (v1 or v2) its account holds, with their proven Bitcoin, and its USDC. */
async function insideOf(account) {
  const pusakas = [];
  for (const c of [...new Set([ORIGINAL, V2, ...SIBLINGS])]) for (const t of await view("nft_tokens_for_owner", { account_id: account, from_index: "0", limit: 20 }, c).catch(() => []))
    pusakas.push({ c, id: t.token_id, sats: Number((await view("token_info", { token_id: t.token_id }, c)).verified_sats) });
  const usdc = Number(await view("ft_balance_of", { account_id: account }, USDC).catch(() => 0)) / 1e6;
  const nbtc = Number(await view("ft_balance_of", { account_id: account }, NBTC).catch(() => 0));
  return { pusakas, usdc, nbtc };
}
const accountOf = (id) => provider.viewAccount({ accountId: id, blockQuery: { finality: "optimistic" } }).catch(() => null);
const link = (h) => <a href={`${NEAR_EXPLORER}/tx/${h}`} target="_blank" rel="noreferrer">view transaction</a>;
const acctLink = (a) => <a href={`${NEAR_EXPLORER}/account/${a}`} target="_blank" rel="noreferrer"><code>{a}</code></a>;

export default function V2Page({ id, accountId }) {
  return id ? <V2Token key={id} id={id} accountId={accountId} /> : <V2List accountId={accountId} />;
}

function Intro() {
  return <p className="muted">Everything a Pusaka does, plus its own NEAR account, a vault, call options and more. <a href="#/docs">How it works</a></p>;
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
    <section className="mine wide">
      <h1>Smart Pusakas</h1>
      <Intro />
      {accountId ? <button disabled={msg.endsWith("…")} onClick={mint}>Mint a Smart Pusaka</button> : <button onClick={() => connector.connect()}>Connect NEAR wallet to mint</button>}
      {msg && <p className="muted" role="status">{msg}</p>}
      {!toks ? <p className="muted">Reading {V2}…</p> : toks.error ? <p className="error">Couldn't read {V2}: {toks.error}</p> : (
        <ul className="card-grid v2-grid">
          {[...toks].sort((a, b) => (b.owner_id === accountId) - (a.owner_id === accountId)).map((t) => (
            <li key={t.token_id}><a href={smartHref(t.token_id)} aria-label={`Smart Pusaka #${t.token_id}, held by ${t.owner_id === accountId ? "you" : t.owner_id}`}><span className="v2-num">#{t.token_id}</span><span className="v2-name">Smart Pusaka</span>
              <span className="muted">held by {t.owner_id === accountId ? <strong>you</strong> : t.owner_id}</span></a></li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** A Smart Pusaka's own features. `embedded`: inside the main token page (#/pusaka/<id>), which already has the title and history. */
export function V2Token({ id, accountId, embedded = false }) {
  const [s, setS] = useState(null);
  const [tick, setTick] = useState(0);
  const reload = () => setTick((t) => t + 1);
  useEffect(() => {
    let live = true;
    (async () => {
      const info = await view("token_info", { token_id: id });
      if (!info) return { error: `There is no Smart Pusaka #${id}.` };
      const [acct, alias, pq, ag, user, btcSale, vault, call] = await Promise.all([view("account_of", { token_id: id }), view("alias_of", { token_id: id }), view("pq_key_of", { token_id: id }),
        view("agent_of", { token_id: id }), view("user_of", { token_id: id }), view("btc_listing_of", { token_id: id }),
        view("vault_of", { token_id: id }).catch(() => null), view("call_of", { token_id: id }).catch(() => null)]);
      const [a, b, intents, inside, nbtcIn] = await Promise.all([accountOf(acct), accountOf(alias), intentsOf(acct).catch(() => null), insideOf(acct).catch(() => null),
        nbtcDepositAddress(acct).catch(() => null)]);
      return { info, acct, alias, pq, ag, user, btcSale, vault, call, a, b, intents, inside, nbtcIn };
    })().catch((e) => ({ error: e.message })).then((x) => live && setS(x));
    return () => { live = false; };
  }, [id, tick]);
  if (!s) return <section><p className="muted">Reading Smart Pusaka #{id}…</p></section>;
  if (s.error) return <section><h1>Smart Pusaka #{id}</h1><p className="error">{s.error}</p><a href="#/v2">All Smart Pusakas</a></section>;
  const owner = s.info.token.owner_id, isOwner = accountId === owner;
  const bal = (x) => x ? `${near(x.amount)} NEAR` : "not created yet";
  return (
    <section className={embedded ? "v2 v2-embedded" : "v2"}>
      {!embedded && <>
        <p><a href="#/v2">← All Smart Pusakas</a></p>
        <h1>Smart Pusaka #{id}</h1>
        <p>Held by <strong>{owner}</strong>{isOwner && " (you)"}.</p>
        <p><a className="pill pill-soft" href={smartHref(id)}>Open #{id} in the full app: Bitcoin, sale, loans, heir</a></p>
      </>}
      <h2>Its own account</h2>
      <dl className="v2-accounts">
        <dt>Account (NEP-616)</dt><dd>{acctLink(s.acct)}: {bal(s.a)}{s.a && <span className="muted"> · no access keys · code: the token-account global contract</span>}</dd>
        <dt>Name</dt><dd>{acctLink(s.alias)}: {bal(s.b)}</dd>
      </dl>
      <h2>Its NEAR Intents balance</h2>
      {s.intents?.length ? <p>{s.intents.map(([t, a]) => amountOf(t, a)).join(", ")}, held by its account inside NEAR Intents.</p>
        : <p className="muted">{s.intents ? "Nothing yet." : "Couldn't read the verifier."}</p>}
      <h2>What a buyer also gets</h2>
      {!s.inside ? <p className="muted">Couldn't read its account's holdings.</p>
        : !s.inside.pusakas.length && !s.inside.usdc && !s.inside.nbtc ? <p className="muted">Nothing besides the above. Put a Pusaka or tokens into its account and they're sold with it.</p>
        : <ul className="v2-inside">
            {s.inside.pusakas.map((p) => <li key={p.c + p.id}><a href={`${location.pathname}${p.c === ORIGINAL ? "" : `?contract=${p.c}`}#/pusaka/${p.id}`}>{p.c === V2 ? "Smart Pusaka" : "Classic Pusaka"} #{p.id}</a>: {p.sats.toLocaleString()} sats of Bitcoin proven inside</li>)}
            {s.inside.nbtc > 0 && <li>{s.inside.nbtc.toLocaleString()} sats of nBTC (Omni Bridge) in its account: Bitcoin on NEAR, redeemable to this Pusaka's own Bitcoin address</li>}
            {s.inside.usdc > 0 && <li>{s.inside.usdc} USDC in its account</li>}
            <li className="muted">All of it changes hands with this NFT and leaves only through its holder; the account can move assets, never sign for them, so nothing can be kept back after a sale.</li>
          </ul>}
      {s.nbtcIn && <p className="muted">To add nBTC: send native BTC (at least 2,500 sats) to the Omni Bridge address <code className="addr">{s.nbtcIn}</code>.
        Near-One's relayer checks the deposit against NEAR's Bitcoin light client and mints nBTC (less a 200-sat fee) into this Pusaka's own account.</p>}
      <h2>Post-quantum lock</h2>
      {s.pq ? <p>On: every action by the holder needs a fresh unlock signed with their ML-DSA-65 key and checked on-chain
        {s.pq.open ? <> (<strong>open now</strong>, until block {s.pq.unlocked_until_block})</> : <> (<strong>locked</strong>)</>}. Unlocks used: {s.pq.nonce}.</p>
        : <p className="muted">Off.</p>}
      <h2>Agent budget</h2>
      {s.ag ? <p><strong>{s.ag.agent}</strong> may send up to {near(s.ag.daily)} NEAR a day from its account
        {s.ag.to.length ? <> to {s.ag.to.join(", ")} only</> : <> to anyone</>}; <strong>{near(s.ag.left_today)} NEAR left today</strong>.</p>
        : <p className="muted">None.</p>}
      <h2>For sale for Bitcoin</h2>
      {s.btcSale ? <BtcSale id={id} sale={s.btcSale} accountId={accountId} reload={reload} />
        : <p className="muted">Not for sale for Bitcoin.</p>}
      <h2>Rented to</h2>
      {s.user ? <p><strong>{s.user.user}</strong> may use it (sign in as it, not move it or what it holds) until {new Date(Number(s.user.expires_ms)).toLocaleString()}.</p>
        : <p className="muted">Nobody.</p>}
      <h2>Vault</h2>
      <Vault id={id} s={s} accountId={accountId} reload={reload} />
      <h2>Call option</h2>
      <Call id={id} s={s} accountId={accountId} isOwner={isOwner} reload={reload} />
      {isOwner && <Owner id={id} s={s} owner={owner} reload={reload} />}
      {!isOwner && s.ag && accountId === s.ag.agent && <AgentSend id={id} s={s} reload={reload} />}
      {!embedded && <><h2>History</h2>
      <ol className="v2-history">{s.info.history.map((e, i) => <li key={i}>{e.event.kind}</li>)}</ol></>}
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
  const [proof, setProof] = useState(null);
  const [renter, setRenter] = useState("");
  const [hours, setHours] = useState("24");
  const [btc, setBtc] = useState({ sats: "5000", to: "" });

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
      {s.inside?.nbtc > 0 && <button className="ghost" disabled={!!busy} onClick={() => run("redeem", async () => {
        // nBTC back to native Bitcoin, paid to this Pusaka's own address: one connector coin spent whole (shared/nbtc.mjs)
        const p = await redeemPlan({ have: s.inside.nbtc, to: btcAddress(s.info.btc_pubkey), view });
        const o = await tx("account_call", { token_id: id, alias: false, ...p.call }, 1n);
        return <>Redeeming {Number(p.total).toLocaleString()} nBTC: {p.sats.toLocaleString()} sats come back to this Pusaka's Bitcoin address once Near-One's relayer has NEAR MPC sign the payout (minutes). {link(o.transaction.hash)}</>;
      })}>{busy === "redeem" ? "Redeeming…" : `Redeem its nBTC to its own Bitcoin address`}</button>}
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
        <button disabled={!!busy} onClick={() => run("signin", async () => {
          const nonce = hex.encode(crypto.getRandomValues(new Uint8Array(8)));
          const o = await tx("sign_in", { token_id: id, domain: location.host, uri: location.href.split("#")[0], chain_id: "1", nonce }, 1n);
          const signed = JSON.parse(new TextDecoder().decode(base64.decode(o.status.SuccessValue)));
          setSignedIn({ ...signed, signature: await signInSignature(signed) });
          return <>Signed in as {signed.address}; the signature recovers to it. {link(o.transaction.hash)}</>;
        })}>{busy === "signin" ? "Signing…" : `Sign in to ${location.host} as Smart Pusaka #${id}`}</button>
        {signedIn && <pre className="siwe">{`${signedIn.message}\n\n${signedIn.signature}`}</pre>}
      </div>
      <div className="stack">
        <h3>Prove its Bitcoin address (BIP-322)</h3>
        <p className="muted">Proves this Pusaka controls {btcAddress(s.info.btc_pubkey)}.</p>
        <button className="ghost" disabled={!!busy} onClick={() => run("bip322", async () => {
          const o = await tx("sign_btc_message", { token_id: id, message: "proof of reserves" }, 1n);
          const signed = JSON.parse(new TextDecoder().decode(base64.decode(o.status.SuccessValue)));
          setProof({ ...signed, witness: `smp${witnessFromMpc(signed)}` });
          return <>Signed and verified. {link(o.transaction.hash)}</>;
        })}>{busy === "bip322" ? "Signing…" : "Sign a BIP-322 proof"}</button>
        {proof && <pre className="siwe">{`Address: ${btcAddress(proof.pubkey)}\nMessage: ${proof.message}\nSignature: ${proof.witness}`}</pre>}
      </div>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); run("rent", async () => {
        const o = await tx("set_user", { token_id: id, user: renter.trim().toLowerCase() || null, expires_ms: String(Date.now() + Number(hours) * 3_600_000) }, yocto(0.01), 30);
        return <>{renter ? `${renter} may use it for ${hours} h.` : "Rental ended."} {link(o.transaction.hash)}</>;
      }); }}>
        <h3>Rent its use</h3>
        <label>Renter <input value={renter} onChange={(e) => setRenter(e.target.value)} placeholder="empty ends a rental" spellCheck="false" autoCapitalize="none" /></label>
        <label>For <span className="row"><input type="number" min="1" value={hours} onChange={(e) => setHours(e.target.value)} required /> hours</span></label>
        <button disabled={!!busy}>{busy === "rent" ? "Saving…" : "Save (0.01 NEAR storage)"}</button>
      </form>
      {!s.btcSale && <form className="stack" onSubmit={(e) => { e.preventDefault(); run("btclist", async () => {
        const o = await tx("list_for_btc", { token_id: id, price_sats: btc.sats, pay_to_script: scriptHex(btc.to.trim()) }, yocto(0.01), 30);
        return <>Listed for {btc.sats} sats. {link(o.transaction.hash)}</>;
      }); }}>
        <h3>Sell it for Bitcoin</h3>
        <label>Price <span className="row"><input type="number" min="1000" value={btc.sats} onChange={(e) => setBtc({ ...btc, sats: e.target.value })} required /> sats</span></label>
        <label>Paid to (your Bitcoin address) <input value={btc.to} onChange={(e) => setBtc({ ...btc, to: e.target.value })} placeholder="tb1q…" required spellCheck="false" autoCapitalize="none" /></label>
        <button disabled={!!busy}>{busy === "btclist" ? "Listing…" : "List for Bitcoin"}</button>
      </form>}
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

/** A Bitcoin sale: the price, where to pay, the reservation; a reserve button for buyers and a cancel button for the seller. */
function BtcSale({ id, sale, accountId, reload }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [now] = useState(() => Date.now()); // read once per render of this sale
  // what the buyer is looking at; checked again just before the bond is paid, and the contract refuses the reservation
  // if the sign epoch moved since (review R6-1: a seller could unlist, withdraw and relist in between)
  const [seen, setSeen] = useState(null);
  useEffect(() => { view("token_info", { token_id: id }).then((t) => t && setSeen({ epoch: t.sign_epoch, sats: t.verified_sats })).catch(() => {}); }, [id]);
  const reserved = sale.buyer && Number(sale.proof_until_ms ?? sale.reserved_until_ms) > now;
  const act = async (fn) => { setBusy(true); setMsg(null); try { setMsg({ ok: true, text: await fn() }); await reload(); } catch (e) { setMsg({ ok: false, text: e.message }); } finally { setBusy(false); } };
  return (
    <div className="stack">
      <p><strong>{Number(sale.price_sats).toLocaleString()} sats</strong>, paid on Bitcoin to {scriptAddress(sale.pay_to_script) ? <><code>{scriptAddress(sale.pay_to_script)}</code> (script </> : "script "}<code>{sale.pay_to_script}</code>{scriptAddress(sale.pay_to_script) && ")"}.
        {reserved ? <> Reserved by <strong>{sale.buyer}</strong>: pay by {new Date(Number(sale.reserved_until_ms)).toLocaleString()}, proven by {new Date(Number(sale.proof_until_ms ?? sale.reserved_until_ms)).toLocaleString()}.</> : " Open: reserve it to buy."}</p>
      {reserved && accountId === sale.buyer && <p>Pay {Number(sale.price_sats).toLocaleString()} sats to that address in one Bitcoin transaction that also has an
        OP_RETURN output carrying <code>{sale.op_return}</code>. Once it confirms and NEAR's light client has the block, anyone submits
        <code> prove_btc_purchase</code> with its proof (this app has no button for it yet: <code>node scripts/v2-bitcoin.mjs</code> does it; don't pay unless you or someone can run it before the deadline) and the Pusaka is yours (find the txid on <a href={EXPLORER} target="_blank" rel="noreferrer">a Bitcoin explorer</a>).</p>}
      {!reserved && accountId && accountId !== sale.seller && <button disabled={busy} onClick={() => act(async () => {
        const t = await view("token_info", { token_id: id });
        if (!seen || t.sign_epoch !== seen.epoch) throw new Error(`Something was signed for this Pusaka since you opened the page (verified sats now ${Number(t.verified_sats).toLocaleString()}${seen ? `, were ${Number(seen.sats).toLocaleString()}` : ""}). Nothing was reserved: reload and check before paying a bond.`);
        const o = await callRaw("reserve_btc_purchase", { token_id: id, expected_sign_epoch: seen.epoch }, { deposit: yocto(0.1), tgas: 30, receiver: V2 });
        return <>Reserved: 6 hours to pay, 6 more to prove it (0.1 NEAR bond, back when you buy). {link(o.transaction.hash)}</>;
      })}>Reserve to buy with Bitcoin (0.1 NEAR bond)</button>}
      {accountId === sale.seller && !reserved && <button className="ghost" disabled={busy} onClick={() => act(async () =>
        <>Bitcoin listing ended. {link((await callRaw("cancel_btc_listing", { token_id: id }, { tgas: 30, receiver: V2 })).transaction.hash)}</>)}>End the Bitcoin listing</button>}
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

/** One button that runs a transaction and shows its outcome. */
function useRun(reload) {
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState(null);
  const run = async (label, fn) => {
    setBusy(label); setMsg(null);
    try { setMsg({ ok: true, text: await fn() }); await reload(); } catch (e) { setMsg({ ok: false, text: e.message }); } finally { setBusy(""); }
  };
  return { busy, run, out: msg && <p className={msg.ok ? "ok" : "error"} role="status">{msg.text}</p> };
}
const tx2 = (method, args, deposit = 0n, tgas = 100) => callRaw(method, args, { deposit, tgas, receiver: V2 });
const when = (ms) => new Date(Number(ms)).toLocaleString();

/** The vault: owner actions wait out a delay, during which the recovery account can take the Pusaka back. */
function Vault({ id, s, accountId, reload }) {
  const { busy, run, out } = useRun(reload);
  const [f, setF] = useState({ recovery: "", minutes: "60" });
  const owner = s.info.token.owner_id, v = s.vault;
  if (!v) return accountId !== owner ? <p className="muted">Not in a vault.</p> : (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); run("vault", async () => {
      const o = await tx2("set_vault", { token_id: id, recovery: f.recovery.trim().toLowerCase(), delay_ms: String(Number(f.minutes) * 60_000) }, yocto(0.01), 30);
      return <>In the vault. {link(o.transaction.hash)}</>;
    }); }}>
      <p className="muted">Not in a vault. With one, every action on this Pusaka waits out a delay first, and your recovery account can take it back in the meantime.</p>
      <label>Recovery account (your cold wallet) <input value={f.recovery} onChange={(e) => setF({ ...f, recovery: e.target.value })} required spellCheck="false" autoCapitalize="none" /></label>
      <label>Delay <span className="row"><input type="number" min="1" value={f.minutes} onChange={(e) => setF({ ...f, minutes: e.target.value })} required /> minutes</span></label>
      <button disabled={!!busy}>{busy ? "Saving…" : "Put it in a vault"}</button>
      {out}
    </form>
  );
  const pending = Number(v.ready_ms) > 0;
  return (
    <div className="stack">
      <p>In a vault: recovery <strong>{v.recovery}</strong>, delay {Number(v.delay_ms) / 60_000} min.{" "}
        {v.open ? <strong>Open now.</strong> : pending ? <>Unlock requested: opens {when(v.ready_ms)}.</> : "Locked."}</p>
      {accountId === owner && <button className="ghost" disabled={!!busy} onClick={() => run("unlock", async () =>
        <>Unlock requested. {link((await tx2("request_unlock", { token_id: id })).transaction.hash)}</>)}>Request an unlock</button>}
      {accountId === owner && v.open && <button className="ghost" disabled={!!busy} onClick={() => run("off", async () =>
        <>Out of the vault. {link((await tx2("set_vault", { token_id: id, recovery: null, delay_ms: "0" }, 1n, 30)).transaction.hash)}</>)}>Take it out of the vault</button>}
      {accountId === v.recovery && <button disabled={!!busy} onClick={() => run("claw", async () =>
        <>Clawed back. {link((await tx2("vault_clawback", { token_id: id })).transaction.hash)}</>)}>Claw it back to me</button>}
      {out}
    </div>
  );
}

/** A covered call: the holder sells the right to buy this Pusaka at a fixed price until a date. */
function Call({ id, s, accountId, isOwner, reload }) {
  const { busy, run, out } = useRun(reload);
  const [f, setF] = useState({ strike: "5", premium: "0.1", days: "7", inBtc: false, sats: "10000", to: "" });
  const c = s.call;
  if (!c) return !isOwner ? <p className="muted">None.</p> : (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); run("write", async () => {
      const expires_ms = String(Date.now() + Number(f.days) * 86_400_000), premium = yocto(f.premium).toString();
      const o = f.inBtc
        ? await tx2("write_btc_call", { token_id: id, strike_sats: f.sats, pay_to_script: scriptHex(f.to.trim()), premium, expires_ms }, yocto(0.01), 30)
        : await tx2("write_call", { token_id: id, strike: yocto(f.strike).toString(), premium, expires_ms }, yocto(0.01), 30);
      return <>Call option offered. {link(o.transaction.hash)}</>;
    }); }}>
      <p className="muted">None. Sell someone the right to buy this Pusaka at a fixed price until a date; you keep the premium either way.</p>
      <label className="row"><input type="checkbox" checked={f.inBtc} onChange={(e) => setF({ ...f, inBtc: e.target.checked })} /> they pay that price in Bitcoin</label>
      {f.inBtc ? <>
        <label>Price they may buy at <span className="row"><input type="number" min="1000" value={f.sats} onChange={(e) => setF({ ...f, sats: e.target.value })} required /> sats</span></label>
        <label>Paid to (your Bitcoin address) <input value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} placeholder="tb1q…" required spellCheck="false" autoCapitalize="none" /></label>
      </> : <label>Price they may buy at <span className="row"><input type="number" min="0.01" step="any" value={f.strike} onChange={(e) => setF({ ...f, strike: e.target.value })} required /> NEAR</span></label>}
      <label>Premium for the option <span className="row"><input type="number" min="0.001" step="any" value={f.premium} onChange={(e) => setF({ ...f, premium: e.target.value })} required /> NEAR</span></label>
      <label>For <span className="row"><input type="number" min="1" value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })} required /> days</span></label>
      <button disabled={!!busy}>{busy ? "Offering…" : "Offer a call option"}</button>
      {out}
    </form>
  );
  return (
    <div className="stack">
      <p>The right to buy it for <strong>{c.strike_sats ? `${Number(c.strike_sats).toLocaleString()} sats, paid on Bitcoin` : `${near(c.strike)} NEAR`}</strong> until {when(c.expires_ms)}, premium {near(c.premium)} NEAR.{" "}
        {c.holder ? <>Held by <strong>{c.holder === accountId ? "you" : c.holder}</strong>.</> : "For sale."}</p>
      {!c.holder && accountId && !isOwner && <button disabled={!!busy} onClick={() => run("buy", async () =>
        <>The option is yours. {link((await tx2("buy_call", { token_id: id, expected_sign_epoch: s.info.sign_epoch }, BigInt(c.premium))).transaction.hash)}</>)}>
        Buy the option ({near(c.premium)} NEAR)</button>}
      {c.holder === accountId && !c.strike_sats && <button disabled={!!busy} onClick={() => run("ex", async () =>
        <>Exercised: the Pusaka is yours. {link((await tx2("exercise_call", { token_id: id }, BigInt(c.strike), 100)).transaction.hash)}</>)}>
        Exercise: buy it for {near(c.strike)} NEAR</button>}
      {c.strike_sats && c.btc_reserved_until_ms && !c.op_return && <p className="warn">The time to pay on Bitcoin is over; don't pay now. A payment made in time can still be proven until {when(c.btc_proof_until_ms)}.</p>}
      {c.holder === accountId && c.strike_sats && !c.btc_reserved_until_ms && <button disabled={!!busy} onClick={() => run("res", async () =>
        <>Reserved: 6 hours to pay on Bitcoin. {link((await tx2("reserve_btc_exercise", { token_id: id })).transaction.hash)}</>)}>
        Exercise: pay {Number(c.strike_sats).toLocaleString()} sats on Bitcoin</button>}
      {c.op_return && <p>Pay {Number(c.strike_sats).toLocaleString()} sats to {scriptAddress(c.pay_to_script) ? <><code>{scriptAddress(c.pay_to_script)}</code> (script </> : "script "}<code>{c.pay_to_script}</code>{scriptAddress(c.pay_to_script) && ")"} in one Bitcoin transaction with an
        OP_RETURN output carrying <code>{c.op_return}</code>, by {when(c.btc_reserved_until_ms)}. Once it confirms, anyone submits
        <code> prove_btc_exercise</code> with its proof and the Pusaka goes to {c.holder === accountId ? "you" : c.holder}.</p>}
      {isOwner && !c.holder && <button className="ghost" disabled={!!busy} onClick={() => run("cancel", async () =>
        <>Withdrawn. {link((await tx2("cancel_call", { token_id: id })).transaction.hash)}</>)}>Withdraw the offer</button>}
      {out}
    </div>
  );
}
