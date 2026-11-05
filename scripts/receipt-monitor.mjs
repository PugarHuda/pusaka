// Alert on every failed callback receipt (NEAR security checklist) and on signing locks left open.
// Read-only, no keys:  node scripts/receipt-monitor.mjs [--hours 6]
//   1. Every receipt of every transaction touching the contract or the relayer in the last N hours (FastNear tx API).
//      A failed receipt the contract sent to itself (on_key, on_signed*, on_deposit_proven, on_usdc_proven,
//      nft_resolve_transfer, ...) is an alert: state the call meant to settle may be left half-done.
//      A user's own call panicking (a buy refused with StateChanged, a refused withdraw) is that caller's failed
//      transaction, not a broken callback: counted as info.
//   2. Every token whose `pending` signing lock was already set PENDING_TIMEOUT_BLOCKS (600) blocks ago, i.e. a
//      callback never cleared it and the owner now needs unlock_stale.
// Exits 1 when it finds either.
import { CONTRACT, NETWORK, NEAR_EXPLORER } from "@pusaka/shared";
import { provider, view } from "./lib.mjs";
import assert from "node:assert/strict";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const HOURS = Number(arg("hours", 6));
const RELAYER = process.env.PUSAKA_RELAYER ?? (NETWORK === "mainnet" ? "pusaka-relayer.near" : "pusaka-relayer.testnet");
const TX_API = `https://tx.${NETWORK === "mainnet" ? "main" : "test"}.fastnear.com`;
const PENDING_TIMEOUT_BLOCKS = 600; // contract/src/lib.rs

const post = (p, body) => fetch(`${TX_API}${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) })
  .then((r) => { if (!r.ok) throw new Error(`FastNear ${p}: HTTP ${r.status}`); return r.json(); });

/** Transaction hashes touching `account_id` since `cutoffNs`, newest first (pages through resume_token). */
async function hashesSince(account_id, cutoffNs) {
  const out = [];
  for (let resume_token; ;) {
    const page = await post("/v0/account", { account_id, ...(resume_token && { resume_token }) });
    for (const t of page.account_txs) if (BigInt(t.tx_block_timestamp) >= cutoffNs) out.push(t.transaction_hash);
    if (!page.resume_token || !page.account_txs.length || BigInt(page.account_txs.at(-1).tx_block_timestamp) < cutoffNs) return out;
    resume_token = page.resume_token;
  }
}

const method = (receipt) => {
  const a = receipt.receipt?.Action?.actions?.[0] ?? {};
  const inner = a.Delegate?.delegate_action?.actions?.[0];
  if (inner) return `delegate:${inner.FunctionCall?.method_name ?? Object.keys(inner)[0]}`;
  return a.FunctionCall?.method_name ?? Object.keys(a)[0] ?? "?";
};
const errorText = (f) => {
  const k = f.ActionError?.kind;
  return (k?.FunctionCallError?.ExecutionError ?? JSON.stringify(k ?? f)).replace(/\s+/g, " ");
};

/** Failed receipts of one FastNear transaction, each classified callback | user | other. */
export function failures(tx, contract = CONTRACT) {
  const first = tx.execution_outcome?.outcome.receipt_ids[0]; // the signer's own call (e.g. the contract's deploy + migrate)
  return tx.receipts.filter((r) => r.execution_outcome.outcome.status.Failure).map((r) => {
    const { predecessor_id: from, receiver_id: to } = r.receipt;
    const kind = from === contract && to === contract && r.receipt.receipt_id !== first ? "callback" // contract -> itself
      : to === contract ? "user" // someone's call into the contract panicked: their failed tx
        : "other"; // e.g. a cross-contract call the contract made (its callback sees the error), a relayed delegate
    return { kind, hash: tx.transaction.hash, at: r.receipt.block_timestamp, from, to, method: method(r.receipt), error: errorText(r.execution_outcome.outcome.status.Failure) };
  });
}

if (process.argv.includes("--self-test")) {
  const rcpt = (from, to, name) => ({ receipt: { predecessor_id: from, receiver_id: to, block_timestamp: 0, receipt: { Action: { actions: [{ FunctionCall: { method_name: name } }] } } },
    execution_outcome: { outcome: { status: { Failure: { ActionError: { kind: { FunctionCallError: { ExecutionError: "Smart contract panicked: x" } } } } } } } });
  const ok = { receipt: { predecessor_id: "a", receiver_id: "c" }, execution_outcome: { outcome: { status: { SuccessValue: "" } } } };
  const f = failures({ transaction: { hash: "h" }, execution_outcome: { outcome: { receipt_ids: ["r0"] } }, receipts: [ok, rcpt("c", "c", "on_signed"), rcpt("alice", "c", "buy"), rcpt("c", "v1.signer", "sign")] }, "c");
  assert.equal(f.map((x) => `${x.kind}:${x.method}`).join(), "callback:on_signed,user:buy,other:sign");
  const own = { ...rcpt("c", "c", "migrate"), receipt: { ...rcpt("c", "c", "migrate").receipt, receipt_id: "r0" } }; // contract-signed tx
  assert.equal(failures({ transaction: { hash: "h" }, execution_outcome: { outcome: { receipt_ids: ["r0"] } }, receipts: [own] }, "c")[0].kind, "user");
  assert.equal(f[0].error, "Smart contract panicked: x");
  console.log("self-test ok");
  process.exit(0);
}

const cutoffNs = BigInt(Date.now() - HOURS * 3_600_000) * 1_000_000n;
const hashes = [...new Set([...(await hashesSince(CONTRACT, cutoffNs)), ...(await hashesSince(RELAYER, cutoffNs))])];
const found = [];
for (let i = 0; i < hashes.length; i += 20) {
  const { transactions } = await post("/v0/transactions", { tx_hashes: hashes.slice(i, i + 20) });
  for (const tx of transactions) if (tx) found.push(...failures(tx));
}
const link = (h) => `${NEAR_EXPLORER}/tx/${h}`;
const line = (f) => `  ${new Date(Number(BigInt(f.at) / 1_000_000n)).toISOString()} ${f.method} (${f.from} -> ${f.to}): ${f.error}\n    ${link(f.hash)}`;
const callbacks = found.filter((f) => f.kind === "callback"), users = found.filter((f) => f.kind === "user"), other = found.filter((f) => f.kind === "other");
console.log(`${CONTRACT} + ${RELAYER}, last ${HOURS} h: ${hashes.length} transactions, ${found.length} failed receipts`);
if (users.length) console.log(`info: ${users.length} user calls panicked (the caller's failed tx): ${Object.entries(Object.groupBy(users, (f) => `${f.method}: ${f.error.replace("Smart contract panicked: ", "")}`)).map(([k, v]) => `${k} x${v.length}`).join("; ")}`);
if (other.length) console.log(`info: ${other.length} other failed receipts (outgoing calls, relayed delegates):\n${other.map(line).join("\n")}`);

// stale signing locks: pending now and already pending PENDING_TIMEOUT_BLOCKS ago (eligible for unlock_stale)
// ponytail: a lock released and re-taken inside that window reads as stale; check token history if it ever alerts
const head = (await provider.viewBlock({ finality: "final" })).header.height;
const stale = [];
for (let id = 1; id <= Number(await view("nft_total_supply")); id++) {
  if (!(await view("token_info", { token_id: String(id) }))?.pending) continue;
  const then = await provider.callFunction({ contractId: CONTRACT, method: "token_info", args: { token_id: String(id) }, blockQuery: { blockId: head - PENDING_TIMEOUT_BLOCKS } }).catch(() => null);
  if (then?.pending) stale.push(id); else console.log(`info: #${id} is signing (lock under ${PENDING_TIMEOUT_BLOCKS} blocks old)`);
}

if (callbacks.length) console.error(`ALERT: ${callbacks.length} failed callback receipts:\n${callbacks.map(line).join("\n")}`);
if (stale.length) console.error(`ALERT: signing lock older than ${PENDING_TIMEOUT_BLOCKS} blocks on ${stale.map((i) => "#" + i).join(", ")}: a callback never cleared it; the owner can call unlock_stale`);
if (callbacks.length || stale.length) process.exit(1);
console.log("ok: no failed callbacks, no stale signing locks");
