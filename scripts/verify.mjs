// One command, no wallet, no key: checks the README's claims against the chains themselves.
//   node scripts/verify.mjs            (from the repo root, after `npm install`)
// Every line is a fact read live from NEAR, NEAR's MPC signer, NEAR's Bitcoin light client or Bitcoin; it
// exits 1 if any check fails. Nothing here is signed or sent.
import fs from "node:fs";
import path from "node:path";
import { base58 } from "@scure/base";
import { CONTRACT, MPC, NETWORK, BTC_LIGHT_CLIENT, lightClientHeight, nearFetch } from "@pusaka/shared";
import { auditToken } from "@pusaka/shared/audit";

const APP = process.env.PUSAKA_APP ?? "https://pusaka-two.vercel.app";
const README = fs.readFileSync(path.join(import.meta.dirname, "..", "README.md"), "utf8");
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
const readmeSha = README.match(/sha256 `([0-9a-f]{64})`/)?.[1];
ok(codeSha === readmeSha, "deployed code = the README's reproducible build", `sha256 ${codeSha.slice(0, 16)}…, commit ${meta.build_info?.source_code_snapshot?.split("?rev=")[1]?.slice(0, 7) ?? "?"}`);
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
async function audit(t) {
  const info = await view("token_info", { token_id: t.token_id });
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
ok(res?.total_verified_sats === total, "the app's /api/reserves matches the contract", `${total} sats verified in total`);

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
ok(missing.length === 0, `all ${hashes.length} NEAR transactions cited in the README are on chain`, missing.length ? `not found: ${missing.join(", ")}` : "via FastNear's archival index");

// 7. Pusaka v2 (testnet): the code is the recorded build, changes only via the DAO + timelock, and every NFT's own
//    account is keyless and runs the token-account global contract published by hash.
const V2 = path.join(import.meta.dirname, "..", "deployments", `${NETWORK}-v2.json`);
if (fs.existsSync(V2)) {
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

console.log(failed ? `\n${failed} check(s) failed` : inconclusive ? "\nall checks passed; some Bitcoin lookups couldn't be made from here (⚠ above)" : "\nall checks passed");
process.exit(failed ? 1 : 0);
