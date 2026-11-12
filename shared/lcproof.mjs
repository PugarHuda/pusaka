// Pusaka's light-client proof, checked against NEAR *mainnet*, for free: the exact bytes the contract sends to
// `verify_transaction_inclusion_v2` (contract/src/btc.rs `proof_args_borsh`) for a real Bitcoin mainnet transaction,
// asked of the mainnet light client as a view call; then the same proof with one merkle hash changed. Runs in Node
// and in a browser (no Buffer): scripts/mainnet-proof.mjs, scripts/verify.mjs and the web app all use this.

export const MAINNET_LIGHT_CLIENT = "btc-client.bridge.near";
const CONFIRMATIONS = 6n; // the contract's mainnet setting (cargo feature `mainnet`)

const hexToInternal = (h) => Uint8Array.from(h.match(/../g).map((x) => parseInt(x, 16)).reverse()); // display -> internal order
const le = (bytes, n, set) => { const b = new Uint8Array(bytes); set(new DataView(b.buffer), n); return b; };
const u32 = (n) => le(4, n, (d, v) => d.setUint32(0, v, true));
const u64 = (n) => le(8, n, (d, v) => d.setBigUint64(0, BigInt(v), true));
const cat = (...a) => { const o = new Uint8Array(a.reduce((s, x) => s + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
const hashes = (hs) => cat(u32(hs.length), ...hs.map(hexToInternal));
const b64 = (bytes) => { let s = ""; for (const x of bytes) s += String.fromCharCode(x); return btoa(s); };

/** Borsh args for verify_transaction_inclusion_v2, exactly as the contract builds them. */
export function proofArgs({ txid, blockHash, pos, merkle, coinbase, coinbaseMerkle, confirmations = CONFIRMATIONS }) {
  return cat(hexToInternal(txid), hexToInternal(blockHash), u64(pos), hashes(merkle), hexToInternal(coinbase), hashes(coinbaseMerkle), u64(confirmations));
}

/**
 * { lc, txid, height, steps, accepted, forgedAccepted }: a transaction 6 blocks below the light client's tip, its proof
 * accepted (must be true) and the forged one (must be false). `esplora`: a mempool.space-compatible mainnet API.
 */
export async function mainnetProofCheck({ esplora = "https://mempool.space/api", rpc = "https://free.rpc.fastnear.com", txid } = {}) {
  const get = async (p, text = false) => {
    for (let k = 1; ; k++) { // public explorers rate-limit (429): back off rather than fail
      const r = await fetch(esplora + p, { signal: AbortSignal.timeout(20_000) });
      if (r.ok) return text ? r.text() : r.json();
      if (r.status !== 429 || k === 5) throw new Error(`Bitcoin explorer answered ${r.status} for ${p}`);
      await new Promise((x) => setTimeout(x, 2000 * k));
    }
  };
  const view = async (method, bytes) => {
    const j = await (await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "final",
        account_id: MAINNET_LIGHT_CLIENT, method_name: method, args_base64: b64(bytes) } }) })).json();
    if (j.error || j.result?.error) return { error: JSON.stringify(j.error ?? j.result.error).slice(0, 200) };
    return { value: JSON.parse(new TextDecoder().decode(new Uint8Array(j.result.result))) };
  };
  const lc = (await view("get_last_block_height", new TextEncoder().encode("{}"))).value;
  if (typeof lc !== "number") throw new Error("NEAR mainnet RPC didn't answer");
  if (!txid) txid = (await get(`/block/${await get(`/block-height/${lc - 6}`, true)}/txids`))[1]; // first tx after the coinbase
  const status = await get(`/tx/${txid}/status`);
  const [proof, coinbase] = await Promise.all([get(`/tx/${txid}/merkle-proof`), get(`/block/${status.block_hash}/txid/0`, true)]);
  const coinbaseMerkle = (await get(`/tx/${coinbase}/merkle-proof`)).merkle;
  const base = { txid, blockHash: status.block_hash, pos: proof.pos, coinbase, coinbaseMerkle };
  const good = await view("verify_transaction_inclusion_v2", proofArgs({ ...base, merkle: proof.merkle }));
  const forged = proof.merkle.slice(); forged[0] = (forged[0][0] === "0" ? "1" : "0") + forged[0].slice(1);
  const bad = await view("verify_transaction_inclusion_v2", proofArgs({ ...base, merkle: forged }));
  return { lc, txid, height: status.block_height, steps: proof.merkle.length, accepted: good.value === true, forgedAccepted: bad.value === true, error: good.error };
}
