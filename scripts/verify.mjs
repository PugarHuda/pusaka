// One command, no wallet, no key: checks the README's claims against the chains themselves.
//   node scripts/verify.mjs            (from the repo root, after `npm install`)
// Every line is a fact read live from NEAR, NEAR's MPC signer, NEAR's Bitcoin light client or Bitcoin; it
// exits 1 if any check fails. Nothing here is signed or sent.
import fs from "node:fs";
import path from "node:path";
import { base58 } from "@scure/base";
import {
  CONTRACT, MPC, NETWORK, BTC_LIGHT_CLIENT, btcAddress, btcFetch, lightClientHeight, nearFetch,
} from "@pusaka/shared";

const APP = process.env.PUSAKA_APP ?? "https://pusaka-two.vercel.app";
const README = fs.readFileSync(path.join(import.meta.dirname, "..", "README.md"), "utf8");
let failed = 0;
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
// A Bitcoin explorer that rate-limits isn't a wrong balance: retry with backoff, then report it as unreachable.
const btcTx = async (txid) => {
  for (let i = 0; i < 4; i++) {
    const tx = await btcFetch(`/tx/${txid}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (tx) return tx;
    await new Promise((ok) => setTimeout(ok, 1500 * 2 ** i));
  }
  return null;
};
for (const t of tokens) {
  const info = await view("token_info", { token_id: t.token_id });
  if (!info.btc_pubkey) continue;
  const raw = base58.decode((await view("derived_public_key", { path: info.btc_path, predecessor: CONTRACT, domain_id: 0 }, MPC)).split(":")[1]);
  const compressed = (raw[63] % 2 ? "03" : "02") + hex(raw.slice(0, 32));
  if (compressed !== info.btc_pubkey) mismatches.push(`#${t.token_id} key`);
  // 4. verified_sats = proven deposits never signed away, and each proven deposit is on Bitcoin, to this address
  const signed = new Set(info.signed_outpoints.map((o) => `${o.txid}:${o.vout}`));
  const sum = info.proven_utxos.filter((u) => !signed.has(`${u.txid}:${u.vout}`)).reduce((a, u) => a + Number(u.value), 0);
  if (sum !== Number(info.verified_sats)) mismatches.push(`#${t.token_id} sum ${sum} ≠ ${info.verified_sats}`);
  const addr = btcAddress(info.btc_pubkey);
  for (const u of info.proven_utxos) {
    const tx = await btcTx(u.txid);
    if (!tx) { unreachable.push(`#${t.token_id} ${u.txid.slice(0, 10)}:${u.vout}`); continue; }
    const out = tx.vout?.[u.vout];
    if (!out || out.scriptpubkey_address !== addr || out.value !== Number(u.value) || !tx.status?.confirmed || tx.status.block_height > lc) mismatches.push(`#${t.token_id} ${u.txid.slice(0, 10)}:${u.vout}`);
    utxoChecks++;
  }
  total += Number(info.verified_sats);
}
ok(!mismatches.some((m) => m.endsWith("key")), `all ${tokens.length} Pusaka BTC keys are the MPC's derivation for ${CONTRACT}`, `signer ${MPC}`);
ok(!mismatches.some((m) => !m.endsWith("key")) && !unreachable.length, `verified_sats = proven deposits never signed away; ${utxoChecks - unreachable.length} proven deposits found on Bitcoin, confirmed, paying the right address`,
  [mismatches.filter((m) => !m.endsWith("key")).join(", "), unreachable.length && `couldn't reach mempool.space or Blockstream for ${unreachable.join(", ")} (rate limit? run again)`].filter(Boolean).join("; ") || `light client ${BTC_LIGHT_CLIENT} at block ${lc}`);

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

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
