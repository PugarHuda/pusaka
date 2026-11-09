// Re-checks one Pusaka against the chains themselves, with no server of ours in between: NEAR (the contract),
// NEAR's MPC signer, NEAR's Bitcoin light client, and Bitcoin (mempool.space, Blockstream as fallback).
// Used by the web app's "Check it yourself" and by scripts/verify.mjs for every token. Reads only.
import { base58, base64 } from "@scure/base";
import { CONTRACT, MPC, BTC_LIGHT_CLIENT, btcAddress, btcFetch, lightClientHeight, nearFetch } from "./btc.mjs";

const enc = new TextEncoder(), dec = new TextDecoder();
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

async function rpc(method, params) {
  const j = await (await nearFetch({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json();
  if (j.error) throw new Error(JSON.stringify(j.error).slice(0, 200));
  return j.result;
}

/** A view call at final finality, straight to a NEAR RPC. */
export async function viewFinal(method, args = {}, account_id = CONTRACT) {
  const r = await rpc("query", { request_type: "call_function", finality: "final", account_id, method_name: method, args_base64: base64.encode(enc.encode(JSON.stringify(args))) });
  if (!r.result) throw new Error(r.error ?? `${method} failed`);
  return JSON.parse(dec.decode(new Uint8Array(r.result)));
}

/** The compressed secp256k1 key NEAR's MPC derives for `path` when this contract asks. */
export async function mpcKeyFor(path) {
  const raw = base58.decode((await viewFinal("derived_public_key", { path, predecessor: CONTRACT, domain_id: 0 }, MPC)).split(":")[1]);
  return (raw[63] % 2 ? "03" : "02") + hex(raw.slice(0, 32));
}

// A Bitcoin explorer that rate-limits isn't a wrong balance: retry with backoff, then report it as unreachable.
async function btcTx(txid) {
  for (let i = 0; i < 4; i++) {
    const tx = await btcFetch(`/tx/${txid}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (tx) return tx;
    await new Promise((ok) => setTimeout(ok, 1500 * 2 ** i));
  }
  return null;
}

/**
 * Every check for one token, in order. Each is { ok, what, detail }; `ok` is null when a source couldn't be
 * reached (not the same as wrong). `lc` (light-client height) can be passed in when auditing many tokens.
 */
export async function auditToken(tokenId, { lc, info } = {}) {
  info ??= await viewFinal("token_info", { token_id: String(tokenId) });
  if (!info?.btc_pubkey) return [{ ok: false, what: "this Pusaka has a Bitcoin key", detail: "no key recorded yet" }];
  lc ??= await lightClientHeight();
  const checks = [];
  const mpcKey = await mpcKeyFor(info.btc_path);
  const addr = btcAddress(info.btc_pubkey);
  checks.push({ ok: mpcKey === info.btc_pubkey, what: "its Bitcoin key is the one NEAR's MPC derives for this contract",
    detail: `${MPC} derived_public_key("${info.btc_path}", ${CONTRACT}) → ${addr}` });

  const signed = new Set(info.signed_outpoints.map((o) => `${o.txid}:${o.vout}`));
  const sum = info.proven_utxos.filter((u) => !signed.has(`${u.txid}:${u.vout}`)).reduce((a, u) => a + Number(u.value), 0);
  checks.push({ ok: sum === Number(info.verified_sats), what: "verified_sats = proven deposits it never signed away",
    detail: `${info.proven_utxos.length} proven, ${signed.size} outpoint(s) ever signed: ${sum} = ${info.verified_sats} sats` });

  for (const u of info.proven_utxos) {
    const tx = await btcTx(u.txid);
    const what = `deposit ${u.txid.slice(0, 10)}…:${u.vout} is on Bitcoin, confirmed, ${Number(u.value)} sats to ${addr.slice(0, 10)}…`;
    if (!tx) { checks.push({ ok: null, what, detail: "couldn't reach mempool.space or Blockstream (rate limit? try again)", txid: u.txid }); continue; }
    const out = tx.vout?.[u.vout];
    const good = !!out && out.scriptpubkey_address === addr && out.value === Number(u.value) && !!tx.status?.confirmed && tx.status.block_height <= lc;
    checks.push({ ok: good, what, txid: u.txid,
      detail: good ? `block ${tx.status.block_height}, light client ${BTC_LIGHT_CLIENT} at ${lc}` : `found ${out ? `${out.value} sats to ${out.scriptpubkey_address}` : "no such output"}, ${tx.status?.confirmed ? `block ${tx.status.block_height}` : "unconfirmed"}` });
  }
  return checks;
}

/** The contract-level facts behind every token: no access key, code final. */
export async function auditContract() {
  const keys = (await rpc("query", { request_type: "view_access_key_list", finality: "final", account_id: CONTRACT })).keys;
  const full = keys.filter((k) => k.access_key.permission === "FullAccess").length;
  const up = await viewFinal("upgrade_status").catch(() => ({}));
  return [
    { ok: full === 0, what: "nobody holds a full-access key to the contract", detail: `${CONTRACT}: ${full} full-access key(s)` },
    { ok: !!up.renounced, what: "the contract's code can never change", detail: up.renounced ? "upgrades renounced" : "upgrades still possible" },
  ];
}
