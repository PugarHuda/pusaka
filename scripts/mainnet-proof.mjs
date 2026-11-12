// Mainnet readiness, free: the exact proof Pusaka sends to NEAR's Bitcoin light client, built for a real Bitcoin
// *mainnet* transaction and checked by the mainnet light client (btc-client.bridge.near) as a view call. No wallet,
// no NEAR spent. Then the same proof with one merkle hash flipped, which the light client must reject.
//   node scripts/mainnet-proof.mjs [txid]       (default: a transaction 6 blocks below the light client's tip)
// The bytes are built exactly as contract/src/btc.rs `proof_args_borsh` builds them, with 6 confirmations
// (the contract's mainnet setting, cargo feature `mainnet`).
import assert from "node:assert/strict";

const ESPLORA = process.env.BTC_MAINNET_ESPLORA ?? "https://mempool.emzy.de/api"; // mempool.space-compatible
const RPC = "https://free.rpc.fastnear.com", LC = "btc-client.bridge.near", CONFIRMATIONS = 6n;
// public explorers rate-limit (429): back off and retry rather than fail the check
const get = async (p, text = false) => {
  for (let k = 1; ; k++) {
    const r = await fetch(ESPLORA + p, { signal: AbortSignal.timeout(20_000) });
    if (r.ok) return text ? r.text() : r.json();
    if (r.status !== 429 || k === 6) throw new Error(`${p}: ${r.status}`);
    await new Promise((x) => setTimeout(x, 2000 * k));
  }
};
const view = async (method, args) => {
  const j = await (await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query",
    params: { request_type: "call_function", finality: "final", account_id: LC, method_name: method, args_base64: Buffer.from(args).toString("base64") } }) })).json();
  if (j.error || j.result?.error) return { error: JSON.stringify(j.error ?? j.result.error).slice(0, 160) };
  return { value: JSON.parse(Buffer.from(j.result.result).toString()) };
};
const internal = (hex) => Buffer.from(hex, "hex").reverse(); // display order -> internal byte order
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const hashes = (hs) => Buffer.concat([u32(hs.length), ...hs.map(internal)]);

const lcHeight = (await view("get_last_block_height", Buffer.from("{}"))).value;
let txid = process.argv[2];
if (!txid) {
  const hash = await get(`/block-height/${lcHeight - 6}`, true);
  txid = (await get(`/block/${hash}/txids`))[1]; // the first transaction after the coinbase
}
const status = await get(`/tx/${txid}/status`);
const [proof, coinbase] = await Promise.all([get(`/tx/${txid}/merkle-proof`), get(`/block/${status.block_hash}/txid/0`, true)]);
const coinbaseProof = await get(`/tx/${coinbase}/merkle-proof`);
const args = (merkle) => Buffer.concat([internal(txid), internal(status.block_hash), u64(proof.pos), hashes(merkle),
  internal(coinbase), hashes(coinbaseProof.merkle), u64(CONFIRMATIONS)]);

console.log(`NEAR mainnet light client ${LC} is at Bitcoin block ${lcHeight}`);
console.log(`Bitcoin mainnet tx ${txid} in block ${status.block_height} (${lcHeight - status.block_height + 1} confirmations), position ${proof.pos}, ${proof.merkle.length}-step merkle proof`);
const good = await view("verify_transaction_inclusion_v2", args(proof.merkle));
console.log(`verify_transaction_inclusion_v2 -> ${JSON.stringify(good.value ?? good.error)}`);
assert.equal(good.value, true, "the light client should accept the real proof");
const bad = proof.merkle.slice(); bad[0] = bad[0].replace(/^./, (c) => (c === "0" ? "1" : "0"));
const forged = await view("verify_transaction_inclusion_v2", args(bad));
console.log(`same proof with one merkle hash changed -> ${JSON.stringify(forged.value ?? forged.error)}`);
assert.notEqual(forged.value, true, "a forged proof must not pass");
console.log("✓ Pusaka's proof format is accepted by NEAR's mainnet Bitcoin light client, and a forged one is not");
