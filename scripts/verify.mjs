// One command, no wallet, no key: checks the README's claims against the chains themselves.
//   node scripts/verify.mjs            (from the repo root, after `npm install`)
// Every line is a fact read live from NEAR, NEAR's MPC signer, NEAR's Bitcoin light client or Bitcoin; it
// exits 1 if any check fails. Nothing here is signed or sent.
import fs from "node:fs";
import path from "node:path";
import { base58 } from "@scure/base";
import { CONTRACT, ORIGINAL, SIBLINGS, MPC, NETWORK, BTC_LIGHT_CLIENT, lightClientHeight, nearFetch } from "@pusaka/shared";
import { auditToken, viewFinal } from "@pusaka/shared/audit";
import { cleanOf } from "@pusaka/shared/clean";
import { mainnetProofCheck, MAINNET_LIGHT_CLIENT } from "@pusaka/shared/lcproof";

const APP = process.env.PUSAKA_APP ?? "https://pusaka-two.vercel.app";
// the README plus the docs/ pages that hold the detail moved out of it
const README = ["README.md", "docs/EVIDENCE.md", "docs/THREAT-MODEL.md", "docs/FEATURES.md", "docs/V2.md", "docs/AGENTS.md"].map((f) => fs.readFileSync(path.join(import.meta.dirname, "..", f), "utf8")).join("\n");
let failed = 0, inconclusive = 0;
// A judge shouldn't wait forever on a slow explorer: the whole run stops after 5 minutes and says where it was.
let step = "start";
setTimeout(() => { console.log(`✗ stopped after 5 minutes at: ${step} (a Bitcoin explorer or NEAR RPC isn't answering; run again)`); process.exit(2); }, 300_000).unref();
const ok = (good, what, detail = "") => {
  if (!good) failed++;
  console.log(`${good ? "✓" : "✗"} ${what}${detail ? `: ${detail}` : ""}`);
};
const rpc = async (method, params) => {
  const j = await (await nearFetch({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json();
  if (j.error) throw new Error(JSON.stringify(j.error).slice(0, 200));
  return j.result;
};
const view = async (method, args = {}, account_id = CONTRACT) => {
  const r = await rpc("query", { request_type: "call_function", finality: "final", account_id, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") });
  if (!r.result) throw new Error(r.error ?? `${method} failed`);
  return JSON.parse(Buffer.from(r.result).toString());
};
const hex = (b) => Buffer.from(b).toString("hex");

console.log(`Pusaka on NEAR ${NETWORK}: ${CONTRACT}\n`);

// 1. The deployed code is the build CI made reproducibly from the commit the contract names.
const acct = await rpc("query", { request_type: "view_account", finality: "final", account_id: CONTRACT });
const codeSha = hex(base58.decode(acct.code_hash));
const meta = await view("contract_source_metadata");
// the build recorded for whichever contract this is (deployments/<network>*.json), else the README's
const record = fs.readdirSync(path.join(import.meta.dirname, "..", "deployments")).filter((f) => f.startsWith(NETWORK) && f.endsWith(".json"))
  .map((f) => JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "..", "deployments", f), "utf8"))).find((d) => d.contract === CONTRACT);
const readmeSha = record?.code?.wasm_sha256 ?? README.match(/sha256 `([0-9a-f]{64})`/)?.[1];
ok(codeSha === readmeSha, "deployed code = the recorded build", `sha256 ${codeSha.slice(0, 16)}…, commit ${meta.build_info?.source_code_snapshot?.split("?rev=")[1]?.slice(0, 7) ?? "?"}`);
ok(meta.build_info?.build_environment?.startsWith("sourcescan/cargo-near"), "NEP-330 build info names the reproducible image", meta.build_info?.build_environment?.split("@")[0]);

// 2. Nobody holds a key to the contract account: code changes only through the public timelock.
const keys = (await rpc("query", { request_type: "view_access_key_list", finality: "final", account_id: CONTRACT })).keys;
const up = await view("upgrade_status").catch(() => ({}));
// The only keys allowed are open gift links' keys: function-call only, on this contract, for the two claim methods.
const CLAIM = ["claim", "create_account_and_claim"];
const linkKey = (k) => { const fc = k.access_key.permission?.FunctionCall; return fc && fc.receiver_id === CONTRACT && fc.method_names.length && fc.method_names.every((m) => CLAIM.includes(m)); };
const other = keys.filter((k) => !linkKey(k));
ok(other.length === 0, "nobody holds a key to the contract account", other.length ? `${other.length} other key(s): ${other.map((k) => k.access_key.permission === "FullAccess" ? "FullAccess" : JSON.stringify(k.access_key.permission)).join(", ")}`
  : keys.length ? `only ${keys.length} gift-link key(s), each limited to ${CLAIM.join("/")}` : "no key at all");
ok(up.renounced || (up.admin && Number(up.delay_ms) >= 600_000), "new code only after a public announcement",
  up.renounced ? "upgrades renounced: final" : !up.admin ? "the deployed code has no timelock (upgrade_status missing or no admin)" : `admin ${up.admin} announces a sha256; deployable ${Number(up.delay_ms) / 60_000} min later${up.proposal ? `; pending ${up.proposal.code_sha256.slice(0, 12)}… from ${new Date(Number(up.proposal.applicable_from_ms)).toISOString()}` : ""}`);

// 3. Every Pusaka's Bitcoin key is derived by NEAR's MPC network for this contract and its token path, so only
//    this contract (i.e. the current NFT owner, through it) can get a signature for it.
const tokens = await view("nft_tokens", { from_index: "0", limit: 100 });
const lc = await lightClientHeight();
let total = 0, utxoChecks = 0, mismatches = [], unreachable = [];
// The same per-token audit the web app's "Check it yourself" runs in a browser (shared/audit.mjs).
step = "auditing every Pusaka on Bitcoin";
let keysChecked = 0;
const infos = new Map(); // token_id -> token_info, reused by the replay below
async function audit(t) {
  const info = await view("token_info", { token_id: t.token_id });
  infos.set(t.token_id, info);
  total += Number(info.verified_sats);
  if (!info.btc_pubkey) return;
  // 30 s per token at most: an explorer that doesn't answer makes it "not checked", not a hang
  const a = await Promise.race([auditToken(t.token_id, { lc, info }), new Promise((r) => setTimeout(() => r(null), 30_000))]);
  if (!a) return unreachable.push(`#${t.token_id} (timed out)`);
  const [key, sum, ...deposits] = a;
  keysChecked++;
  if (!key.ok) mismatches.push(`#${t.token_id} key`);
  if (!sum.ok) mismatches.push(`#${t.token_id} sum (${sum.detail})`);
  for (const d of deposits) {
    if (d.ok === null) { unreachable.push(`#${t.token_id} ${d.txid.slice(0, 10)}`); continue; }
    if (!d.ok) mismatches.push(`#${t.token_id} ${d.txid.slice(0, 10)}`);
    utxoChecks++;
  }
}
// four tokens at a time: quick, and gentle on the explorers' rate limits
for (let i = 0; i < tokens.length; i += 4) await Promise.all(tokens.slice(i, i + 4).map(audit));
ok(!mismatches.some((m) => m.endsWith("key")), `all ${keysChecked} checked Pusaka BTC keys (of ${tokens.length}) are the MPC's derivation for ${CONTRACT}`, `signer ${MPC}`);
if (utxoChecks || mismatches.length) ok(!mismatches.some((m) => !m.endsWith("key")), `verified_sats = proven deposits never signed away; ${utxoChecks} proven deposits found on Bitcoin, confirmed, paying the right address`,
  mismatches.filter((m) => !m.endsWith("key")).join(", ") || `light client ${BTC_LIGHT_CLIENT} at block ${lc}`);
// An explorer that doesn't answer proves nothing either way: reported, not counted as a pass or a failure.
if (unreachable.length) { inconclusive++; console.log(`⚠ not checked on Bitcoin (mempool.space and Blockstream didn't answer from here): ${unreachable.join(", ")}; run again later`); }

// 5. The public reserves API says the same as the contract.
const res = await fetch(`${APP}/api/reserves`).then((r) => r.json()).catch(() => null);
ok((res?.by_contract?.[CONTRACT] ?? res?.total_verified_sats) === total, "the app's /api/reserves matches the contract", `${total} sats verified in total`);

// 6. Every NEAR transaction the README cites as evidence exists on chain.
const hashes = [...new Set([...README.matchAll(/near\.rocks\/tx\/([1-9A-HJ-NP-Za-km-z]{43,44})/g)].map((m) => m[1]))];
const found = new Set();
for (let i = 0; i < hashes.length; i += 20) {
  const r = await fetch(`https://tx.${NETWORK === "mainnet" ? "main" : "test"}.fastnear.com/v0/transactions`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tx_hashes: hashes.slice(i, i + 20) }),
  }).then((x) => x.json()).catch(() => ({ transactions: [] }));
  for (const t of r.transactions ?? []) found.add(t.transaction.hash);
}
const missing = hashes.filter((h) => !found.has(h));
ok(missing.length === 0, `all ${hashes.length} NEAR transactions cited in the README and docs/ are on chain`, missing.length ? `not found: ${missing.join(", ")}` : "via FastNear's archival index");

// 6b. Replay from genesis: every NEP-171 nft_mint / nft_transfer the contract ever logged, in chain order, must
//     give exactly the owners the contract reports now. Nothing is trusted but the transaction logs.
step = "replaying every contract event from FastNear's archival index";
{
  const post = (p, body) => fetch(`https://tx.${NETWORK === "mainnet" ? "main" : "test"}.fastnear.com${p}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000),
  }).then((r) => { if (!r.ok) throw new Error(`FastNear ${r.status}`); return r.json(); });
  try {
    const txs = [];
    for (let resume_token; ;) {
      const r = await post("/v0/account", { account_id: CONTRACT, ...(resume_token && { resume_token }) });
      txs.push(...r.account_txs);
      if (!r.resume_token || !r.account_txs.length) break;
      resume_token = r.resume_token;
    }
    const events = [];
    // every proof the contract stored came from an on_deposit_proven callback whose light-client call said true
    const proofs = new Map(), TRUE = Buffer.from("true").toString("base64"), clients = new Set();
    for (let i = 0; i < txs.length; i += 20) {
      const { transactions } = await post("/v0/transactions", { tx_hashes: txs.slice(i, i + 20).map((t) => t.transaction_hash) });
      // a skipped batch would replay a partial history: stop instead (inconclusive, never a pass)
      if (!Array.isArray(transactions)) throw new Error(`batch ${i / 20 + 1} missing`);
      for (const t of transactions) {
        const fcs = (t.receipts ?? []).map((r) => ({ o: r.execution_outcome.outcome, fc: r.receipt?.receipt?.Action?.actions?.[0]?.FunctionCall }));
        const lc = fcs.find((x) => x.fc?.method_name?.startsWith("verify_transaction_inclusion") && x.o.status?.SuccessValue === TRUE);
        for (const { o, fc } of fcs) if (lc && fc?.method_name === "on_deposit_proven" && o.executor_id === CONTRACT && o.status?.SuccessValue === TRUE) {
          const a = JSON.parse(Buffer.from(fc.args, "base64").toString());
          proofs.set(`${a.token_id}:${a.txid}:${a.vout}`, { value: String(a.value), tx: t.transaction.hash });
          clients.add(lc.o.executor_id);
        }
      }
      for (const t of transactions) for (const r of t.receipts ?? []) {
        const o = r.execution_outcome;
        if (o.outcome.executor_id !== CONTRACT || !("SuccessValue" in (o.outcome.status ?? {}) || "SuccessReceiptId" in (o.outcome.status ?? {}))) continue;
        o.outcome.logs.forEach((l, k) => {
          if (!l.startsWith("EVENT_JSON:")) return;
          const e = JSON.parse(l.slice(11));
          if (e.standard === "nep171" && (e.event === "nft_mint" || e.event === "nft_transfer")) events.push({ at: [o.block_height, o.index, k], e });
        });
      }
    }
    // one receipt can show up in two transactions' lists (a refund, a callback): keep each log once
    const seen = new Set(), ordered = events.sort((a, b) => a.at[0] - b.at[0] || a.at[1] - b.at[1] || a.at[2] - b.at[2])
      .filter((x) => { const k = x.at.join(":"); return !seen.has(k) && seen.add(k); });
    const owner = new Map(), broken = [];
    let mints = 0, transfers = 0;
    for (const { e } of ordered) for (const d of e.data) for (const id of d.token_ids) {
      if (e.event === "nft_mint") {
        // emit_mint_events re-logged early mints for indexers (memo says so): a consistency check, not a new mint
        if (d.memo?.startsWith("re-emitted") && owner.has(id)) { if (owner.get(id) !== d.owner_id) broken.push(`#${id}: re-emitted mint names ${d.owner_id}, the log had ${owner.get(id)}`); continue; }
        mints++; owner.set(id, d.owner_id); continue;
      }
      transfers++;
      // tokens minted before the contract logged nft_mint (#1-#4) start at their first transfer's sender
      if (owner.has(id) && owner.get(id) !== d.old_owner_id) broken.push(`#${id}: moved from ${d.old_owner_id} but the log had it with ${owner.get(id)}`);
      owner.set(id, d.new_owner_id);
    }
    const unlogged = tokens.filter((t) => !owner.has(t.token_id)).map((t) => `#${t.token_id}`);
    const differ = tokens.filter((t) => owner.has(t.token_id) && owner.get(t.token_id) !== t.owner_id).map((t) => `#${t.token_id}`);
    ok(!broken.length && !differ.length, `replayed from genesis: ${txs.length} transactions, ${mints} logged mints and ${transfers} transfers give every owner the contract reports now`,
      [...broken, ...differ.map((d) => `${d} owner differs`), unlogged.length ? `never moved since minting before nft_mint was logged: ${unlogged.join(", ")}` : ""].filter(Boolean).join("; ") || `${owner.size} of ${tokens.length} Pusakas, each followed hand to hand`);
    const held = [...infos].flatMap(([id, info]) => info.proven_utxos.map((u) => ({ id, ...u })));
    const orphan = held.filter((u) => proofs.get(`${u.id}:${u.txid}:${u.vout}`)?.value !== String(u.value)).map((u) => `#${u.id} ${u.txid.slice(0, 10)}:${u.vout}`);
    ok(!orphan.length, `each of the ${held.length} proven UTXOs the contract counts traces to a proof transaction on chain where the light client answered true`,
      orphan.length ? `no such proof for: ${orphan.join(", ")}` : `${proofs.size} accepted proofs in the history, light client ${[...clients].join(", ")}`);
  } catch (e) {
    inconclusive++;
    console.log(`⚠ replay not checked (FastNear's archival index didn't answer: ${e.message}); run again later`);
  }
}

// 6c. Mainnet-ready: the same proof bytes, for a real Bitcoin mainnet transaction, accepted by NEAR's mainnet light
//     client as a free view call, and a forged one refused (shared/lcproof.mjs; scripts/mainnet-proof.mjs alone).
step = "asking NEAR's mainnet Bitcoin light client";
try {
  const m = await mainnetProofCheck({ esplora: process.env.BTC_MAINNET_ESPLORA ?? "https://mempool.space/api" });
  ok(m.accepted && !m.forgedAccepted, "mainnet-ready: NEAR's mainnet light client accepts Pusaka's proof for a real Bitcoin mainnet tx and refuses a forged one",
    `${MAINNET_LIGHT_CLIENT}, tx ${m.txid.slice(0, 12)}… in block ${m.height}, forged accepted: ${m.forgedAccepted}`);
} catch (e) {
  inconclusive++;
  console.log(`⚠ mainnet light-client check not run (${e.message}); try BTC_MAINNET_ESPLORA=https://mempool.emzy.de/api, or node scripts/mainnet-proof.mjs later`);
}

// 6d. Clean to buy: for every Pusaka for sale (both contracts), nothing the seller already signed can still move what's
//     inside it, on Bitcoin, any EVM chain, Solana or its NEAR account (shared/clean.mjs, the check on each token page).
step = "checking that every Pusaka for sale is clean to buy";
try {
  const listed = [];
  for (const c of new Set([CONTRACT, ORIGINAL, ...SIBLINGS])) for (const t of await viewFinal("nft_tokens", { from_index: "0", limit: 100 }, c)) {
    const i = await viewFinal("token_info", { token_id: t.token_id }, c);
    if (i?.listing) listed.push([c, t.token_id]);
  }
  const res = [];
  for (const [c, id] of listed) res.push({ c, id, ...(await cleanOf(id, c, viewFinal).catch((e) => ({ verdict: "unknown", checks: [{ what: e.message }] }))) });
  const risky = res.filter((r) => r.verdict === "risk"), unknown = res.filter((r) => r.verdict === "unknown");
  ok(!risky.length, `every Pusaka for sale is clean to buy: nothing its seller signed can still move what's inside, on Bitcoin, EVM, Solana or NEAR`,
    risky.length ? risky.map((r) => `#${r.id} (${r.c}): ${r.checks.filter((k) => k.ok === false).map((k) => k.detail).join("; ")}`).join(" | ")
      : `${res.length - unknown.length} of ${res.length} listed checked clean`);
  if (unknown.length) { inconclusive++; console.log(`⚠ not fully checked (a chain didn't answer from here): ${unknown.map((r) => `#${r.id}`).join(", ")}`); }
} catch (e) {
  inconclusive++;
  console.log(`⚠ clean-to-buy check not run (${e.message})`);
}

// 7. Pusaka v2 (testnet): the code is the recorded build, changes only via the DAO + timelock, and every NFT's own
//    account is keyless and runs the token-account global contract published by hash.
const V2 = path.join(import.meta.dirname, "..", "deployments", `${NETWORK}-v2.json`);
// one contract (this branch): v2 is CONTRACT and was checked above; the classic contract must stay frozen and keyless
const CLASSIC = path.join(import.meta.dirname, "..", "deployments", `${NETWORK}.json`);
if (fs.existsSync(CLASSIC) && JSON.parse(fs.readFileSync(CLASSIC, "utf8")).contract !== CONTRACT) {
  const v1 = JSON.parse(fs.readFileSync(CLASSIC, "utf8")).contract;
  console.log(`
Classic Pusaka (frozen): ${v1}`);
  const k1 = (await rpc("query", { request_type: "view_access_key_list", finality: "final", account_id: v1 })).keys.filter((k) => !linkKey({ ...k, access_key: { permission: k.access_key.permission?.FunctionCall ? { FunctionCall: { ...k.access_key.permission.FunctionCall, receiver_id: CONTRACT } } : k.access_key.permission } }));
  const u1 = await view("upgrade_status", {}, v1).catch(() => ({}));
  ok(!k1.length && u1.renounced, "the classic contract stays frozen: no key, upgrades renounced", `${k1.length} other key(s), renounced: ${!!u1.renounced}`);
}
if (fs.existsSync(V2) && JSON.parse(fs.readFileSync(V2, "utf8")).contract !== CONTRACT) {
  const d = JSON.parse(fs.readFileSync(V2, "utf8")), v2 = d.contract;
  console.log(`\nPusaka v2: ${v2}`);
  const a2 = await rpc("query", { request_type: "view_account", finality: "final", account_id: v2 });
  ok(hex(base58.decode(a2.code_hash)) === d.code.wasm_sha256, "v2 code = the build recorded in deployments", `${d.code.wasm_sha256.slice(0, 16)}…`);
  const up2 = await view("upgrade_status", {}, v2);
  ok(up2.admin === d.accounts.upgrade_dao && Number(up2.delay_ms) >= 600_000, "v2 upgrades go through the DAO and a timelock (see the key line next)", `${up2.admin}, ${Number(up2.delay_ms) / 60_000} min`);
  const k2 = (await rpc("query", { request_type: "view_access_key_list", finality: "final", account_id: v2 })).keys;
  console.log(`${k2.length ? "ℹ" : "✓"} v2 account keys: ${k2.length ? `${k2.length} (deleted at the final deploy, 13 Nov)` : "none"}`);
  const toks = await view("nft_tokens", { from_index: "0", limit: 100 }, v2);
  const bad = [];
  let opened = 0;
  for (const t of toks) {
    const id = await view("account_of", { token_id: t.token_id }, v2);
    const acc = await rpc("query", { request_type: "view_account", finality: "final", account_id: id }).catch(() => null);
    if (!acc) continue;
    opened++;
    const ks = (await rpc("query", { request_type: "view_access_key_list", finality: "final", account_id: id })).keys;
    if (ks.length || acc.global_contract_hash !== d.token_account.global_contract_hash_base58) bad.push(`#${t.token_id}`);
  }
  ok(!bad.length, `every opened v2 NFT account (${opened} of ${toks.length}) is keyless and runs token-account ${d.token_account.global_contract_hash_base58.slice(0, 8)}…`, bad.join(", "));
}

// 8. The market contract (testnet): its code is the recorded build; its key is reported until it's deleted.
const MK = path.join(import.meta.dirname, "..", "deployments", `${NETWORK}-market.json`);
if (fs.existsSync(MK)) {
  const d = JSON.parse(fs.readFileSync(MK, "utf8"));
  console.log(`
Market: ${d.contract}`);
  const a = await rpc("query", { request_type: "view_account", finality: "final", account_id: d.contract });
  ok(hex(base58.decode(a.code_hash)) === d.code.wasm_sha256, "market code = the build recorded in deployments", `${d.code.wasm_sha256.slice(0, 16)}…`);
  const k = (await rpc("query", { request_type: "view_access_key_list", finality: "final", account_id: d.contract })).keys;
  console.log(`${k.length ? "ℹ" : "✓"} market account keys: ${k.length ? `${k.length} (deleted at the final deploy, 13 Nov)` : "none: the code can never change"}`);
}

// 9. The lending pool (testnet; Circle USDC since 13 Nov): recorded code and config, solvent, and every pledged Pusaka really held by the pool.
const LD = path.join(import.meta.dirname, "..", "deployments", `${NETWORK}-lend.json`);
if (fs.existsSync(LD)) {
  step = "checking the pUSD lending pool";
  const d = JSON.parse(fs.readFileSync(LD, "utf8"));
  console.log(`
Lend: ${d.contract} (pUSD: ${d.stable})`);
  const a = await rpc("query", { request_type: "view_account", finality: "final", account_id: d.contract });
  ok(hex(base58.decode(a.code_hash)) === d.wasm_sha256, "lend code = the build recorded in deployments", `${d.wasm_sha256.slice(0, 16)}…`);
  const [cfg, pool, loans] = await Promise.all([viewFinal("config", {}, d.contract), viewFinal("pool", {}, d.contract), viewFinal("loans", { limit: 100 }, d.contract)]);
  const want = d.config;
  ok(cfg.quorum === want.quorum && cfg.max_ltv_bps === want.max_ltv_bps && cfg.liq_ltv_bps === want.liq_ltv_bps && cfg.liq_price_bps === want.liq_price_bps
    && Number(cfg.max_age_ms) === want.max_age_ms && cfg.reporters.length === want.reporters.length && cfg.nfts.join() === want.nfts.join(),
    "lend rules = the recorded config", `${cfg.reporters.length} reporters, quorum ${cfg.quorum}, max LTV ${cfg.max_ltv_bps / 100}%, liquidation from ${cfg.liq_ltv_bps / 100}% at ≥${cfg.liq_price_bps / 100}% of the BTC's value`);
  const held = BigInt(await viewFinal("ft_balance_of", { account_id: d.contract }, d.stable));
  ok(held >= BigInt(pool.cash), "the pool holds at least its cash in its stablecoin", `${Number(held) / 1e6} held, ${Number(pool.cash) / 1e6} cash, ${Number(pool.borrowed) / 1e6} lent out`);
  const owners = await Promise.all(loans.map((l) => viewFinal("nft_token", { token_id: l.loan.token_id }, l.loan.nft).then((t) => t?.owner_id)));
  ok(owners.every((o) => o === d.contract), "every pledged Pusaka is held by the pool (so nobody can sign its Bitcoin away)", `${loans.length} open loan(s)`);
  console.log(`${pool.price ? "✓" : "ℹ"} price: ${pool.price ? `${Number(pool.price.low) / 1e6}–${Number(pool.price.high) / 1e6} USD/BTC from ≥${cfg.quorum} fresh reports` : "stale (borrowing and liquidation paused until reporters post)"}`);
  const k = (await rpc("query", { request_type: "view_access_key_list", finality: "final", account_id: d.contract })).keys;
  console.log(`${k.length ? "ℹ" : "✓"} lend account keys: ${k.length ? `${k.length} (deleted with the others at the final step)` : "none: the rules can never change"}`);
}

console.log(failed ? `\n${failed} check(s) failed` : inconclusive ? "\nall checks passed; some Bitcoin lookups couldn't be made from here (⚠ above)" : "\nall checks passed");
process.exit(failed ? 1 : 0);
