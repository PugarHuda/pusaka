// Relayer logic shared by the Vercel functions (api/relay.mjs, api/prove.mjs) and local tests.
// The relayer account pays gas; users sign. Nothing here can move a user's NEAR.
import { Account, FailoverRpcProvider, JsonRpcProvider, SCHEMA, actions, encodeDelegateAction, teraToGas } from "near-api-js";
import { deserialize } from "borsh";
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base58 } from "@scure/base";
import {
  CONTRACT, PROVE_DEPOSIT, BTC_MIN_CONFIRMATIONS, balances, btcAddress, depositProof, lightClientHeight, preflightProof, nearProvider, nearFetch, usdcToProve, PROVE_USDC_DEPOSIT,
} from "@pusaka/shared";

/** Methods a user may run gas-free through NEP-366: none of them move money. */
export const RELAY_METHODS = ["list", "cancel_listing", "request_loan", "cancel_loan_request", "claim_collateral", "still_here", "claim_inheritance"];
const MAX_TGAS = 100n;
/** list/cancel/loan-request ping-pong is free for the attacker; one relayed state change per token per minute caps it. */
export const RELAY_COOLDOWN_MS = 60_000;
const THROTTLED = new Set(["list", "cancel_listing", "request_loan", "cancel_loan_request"]);
/** Relayer-paid USDC proofs per token: each leaves 0.002 NEAR of storage, so dust deposits can't drain the relayer. */
export const MAX_FREE_USDC_PROOFS = 4;
// ponytail: per-instance memory, not a shared store; Fluid Compute reuses instances so parallel
// duplicates mostly land here. A shared KV is the upgrade if someone scripts around it.
const inFlight = new Set();
const lastProve = new Map();
const tooSoon = (msg) => Object.assign(new Error(msg), { status: 429 });

const provider = nearProvider({ FailoverRpcProvider, JsonRpcProvider });

export function relayerAccount() {
  const id = process.env.RELAYER_ACCOUNT_ID;
  const key = process.env.RELAYER_PRIVATE_KEY;
  if (!id || !key) throw Object.assign(new Error("relayer is not configured"), { status: 503 });
  return new Account(id, provider, key);
}

/** Decodes and checks a base64 borsh SignedDelegate; throws a 400 with the reason if it isn't allowed. */
export function checkDelegate(b64) {
  const bad = (m) => Object.assign(new Error(m), { status: 400 });
  let sd;
  try { sd = deserialize(SCHEMA.SignedDelegate, Buffer.from(b64, "base64")); } catch { throw bad("not a borsh SignedDelegate"); }
  const d = sd.delegateAction;
  if (d.receiverId !== CONTRACT) throw bad(`only calls to ${CONTRACT} are relayed`);
  if (d.actions.length !== 1) throw bad("exactly one action per relayed call");
  for (const a of d.actions) {
    const fc = a.functionCall;
    if (!fc) throw bad("only function calls are relayed");
    if (!RELAY_METHODS.includes(fc.methodName)) throw bad(`${fc.methodName} is not relayed; allowed: ${RELAY_METHODS.join(", ")}`);
    if (BigInt(fc.deposit) !== 0n) throw bad("relayed calls can't attach a deposit");
    if (BigInt(fc.gas) > MAX_TGAS * 10n ** 12n) throw bad(`gas above ${MAX_TGAS} TGas`);
  }
  return sd;
}

/** NEP-366: submit the user's signed delegate action, paying the gas. */
const rpc = async (method, params) => {
  const j = await (await nearFetch({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json();
  return j.result ?? null;
};

/**
 * NEAR checks all of this too, but only after the relayer has paid for the transaction, so a forged
 * or stale delegate naming any (public) token owner would drain the relayer. Check first: the ed25519
 * signature over the NEP-366 hash, that the key is an access key of the sender allowed to make this
 * call, an unused nonce, and that it hasn’t expired.
 */
export async function verifyDelegate(sd) {
  const fail = (status, m) => Object.assign(new Error(m), { status });
  const d = sd.delegateAction;
  const pk = d.publicKey?.ed25519Key?.data, sig = sd.signature?.ed25519Signature?.data;
  if (!pk || !sig) throw fail(400, "only ed25519 delegates are relayed");
  if (!ed25519.verify(Uint8Array.from(sig), sha256(encodeDelegateAction(d)), Uint8Array.from(pk))) throw fail(401, "the signature doesn’t match this delegate action");
  const public_key = "ed25519:" + base58.encode(Uint8Array.from(pk));
  const [key, block] = await Promise.all([
    rpc("query", { request_type: "view_access_key", finality: "final", account_id: d.senderId, public_key }),
    rpc("block", { finality: "final" }),
  ]);
  if (!key?.permission) throw fail(401, `${public_key} isn’t an access key of ${d.senderId}`);
  const fc = key.permission.FunctionCall;
  const method = d.actions[0].functionCall.methodName;
  if (fc && (fc.receiver_id !== CONTRACT || (fc.method_names.length && !fc.method_names.includes(method)))) throw fail(401, `that key of ${d.senderId} can’t call ${method} on ${CONTRACT}`);
  if (BigInt(d.nonce) <= BigInt(key.nonce)) throw fail(409, "this delegate’s nonce was already used");
  if (!block || BigInt(d.maxBlockHeight) < BigInt(block.header.height)) throw fail(410, "this delegate expired; sign it again");
}

export async function relay(b64) {
  const sd = checkDelegate(b64);
  await verifyDelegate(sd);
  // Only relay what would succeed for this sender: they must own the token they're acting on
  // (claim_collateral: its lender; claim_inheritance: its heir, once due). Saves the relayer from paying for doomed calls.
  const fc = sd.delegateAction.actions[0].functionCall;
  let args;
  try { args = JSON.parse(Buffer.from(fc.args).toString()); } catch { throw Object.assign(new Error("function call args must be JSON"), { status: 400 }); }
  const info = await provider.callFunction({ contractId: CONTRACT, method: "token_info", args: { token_id: String(args.token_id) } });
  const who = sd.delegateAction.senderId;
  let allowed = info?.token?.owner_id === who;
  // only once overdue: before that the call panics on-chain and the relayer pays for nothing
  if (fc.methodName === "claim_collateral") allowed = info?.loan?.lender === who && !!info.loan.due_ms && Number(info.loan.due_ms) <= Date.now();
  if (THROTTLED.has(fc.methodName)) {
    const last = Number(info?.history?.at(-1)?.at_ms ?? 0);
    if (Date.now() - last < RELAY_COOLDOWN_MS) throw tooSoon(`Pusaka #${args.token_id} changed ${Math.round((Date.now() - last) / 1000)} s ago; gas-free again in ${Math.ceil((RELAY_COOLDOWN_MS - (Date.now() - last)) / 1000)} s`);
  }
  if (fc.methodName === "still_here") {
    // the relayer pays: one free check-in per hour (or per tenth of the silence) is plenty;
    // more often than that the holder can still check in by paying their own gas
    const h = await provider.callFunction({ contractId: CONTRACT, method: "heir_of", args: { token_id: String(args.token_id) } });
    const gap = h && Math.min(3_600_000, Number(h.after_ms) / 10);
    if (h && Date.now() - Number(h.last_seen_ms) < gap) {
      throw Object.assign(new Error(`checked in ${Math.round((Date.now() - Number(h.last_seen_ms)) / 60_000)} min ago; the next gas-free check-in opens in ${Math.ceil((gap - (Date.now() - Number(h.last_seen_ms))) / 60_000)} min`), { status: 429 });
    }
  }
  if (fc.methodName === "claim_inheritance") {
    // only the named heir, and only once the holder's silence has run out
    const h = await provider.callFunction({ contractId: CONTRACT, method: "heir_of", args: { token_id: String(args.token_id) } });
    allowed = h?.heir === who && Number(h.claimable_from_ms) <= Date.now();
  }
  if (!allowed) throw Object.assign(new Error(`${who} can't ${fc.methodName} Pusaka #${args.token_id}`), { status: 403 });
  // the same signed delegate posted N times in parallel would pass every check above N times
  const key = `${who}:${sd.delegateAction.nonce}`;
  if (inFlight.has(key)) throw Object.assign(new Error("this signed action is already being relayed"), { status: 409 });
  inFlight.add(key);
  let res;
  try {
    res = await relayerAccount().signAndSendTransaction({
      receiverId: sd.delegateAction.senderId,
      actions: [actions.signedDelegate({ delegateAction: sd.delegateAction, signature: sd.signature })],
      waitUntil: "FINAL", // the app re-reads views at final; answering earlier shows the user stale state
    });
  } finally { inFlight.delete(key); }
  const failure = res.receipts_outcome?.find((r) => r.outcome.status.Failure)?.outcome.status.Failure;
  if (failure) throw Object.assign(new Error(JSON.stringify(failure).match(/Smart contract panicked: ([^"\\]+)/)?.[1] ?? "relayed call failed"), { status: 422 });
  return { tx: res.transaction.hash, sender: sd.delegateAction.senderId, methods: sd.delegateAction.actions.map((a) => a.functionCall.methodName) };
}

/** Proves every confirmed, unproven deposit of a token, paid by `relayer` (the TEE agent passes its own account). */
export async function proveToken(tokenId, relayer) {
  // typeof first: String(["1"]) is "1"
  if (!["string", "number"].includes(typeof tokenId) || !/^\d{1,9}$/.test(String(tokenId))) throw Object.assign(new Error("token_id must be a number"), { status: 400 });
  const info = await provider.callFunction({ contractId: CONTRACT, method: "token_info", args: { token_id: String(tokenId) } });
  if (!info?.btc_pubkey) throw Object.assign(new Error("no such Pusaka"), { status: 404 });
  const lc = await lightClientHeight();
  const bal = await balances(btcAddress(info.btc_pubkey), info.signed_outpoints);
  const todo = bal.spendable.filter((u) => u.value >= 10_000 && u.status?.confirmed
    && u.status.block_height + BTC_MIN_CONFIRMATIONS - 1 <= lc
    && !info.proven_utxos.some((p) => p.txid === u.txid && p.vout === u.vout)).slice(0, 4);
  // USDC on Base/Arbitrum, attested by NEAR MPC: only finalized logs (the MPC reads finalized blocks)
  const proved = (await provider.callFunction({ contractId: CONTRACT, method: "usdc_info", args: { token_id: String(tokenId) } }).catch(() => []))
    .reduce((n, x) => n + x.deposits.length, 0);
  const usdc = proved >= MAX_FREE_USDC_PROOFS ? [] // past the cap the holder proves (and pays) themselves
    : (await usdcToProve(tokenId).catch(() => [])).filter((d) => d.finalized).slice(0, Math.min(2, MAX_FREE_USDC_PROOFS - proved));
  if (!todo.length && !usdc.length) return { light_client_height: lc, results: [], usdc: [] };
  // two proofs of the same token at once would both pay; the contract only dedupes in the callback
  if (Date.now() - (lastProve.get(String(tokenId)) ?? 0) < 30_000) throw tooSoon("a proof for this Pusaka was just sent; try again in a minute");
  lastProve.set(String(tokenId), Date.now());
  relayer ??= relayerAccount();
  const results = [];
  for (const u of todo) {
    const proof = await depositProof(u.txid, u.vout);
    // Free dry run against the light client first; the relayer only pays for proofs that pass.
    if (!(await preflightProof(proof))) { results.push({ txid: u.txid, vout: u.vout, sats: u.value, proven: false, skipped: "preflight failed" }); continue; }
    const ok = await relayer.callFunction({ contractId: CONTRACT, methodName: "prove_deposit",
      args: { token_id: String(tokenId), ...proof }, deposit: PROVE_DEPOSIT, gas: teraToGas(100) });
    results.push({ txid: u.txid, vout: u.vout, sats: u.value, proven: ok });
  }
  const usdcResults = [];
  for (const d of usdc) {
    const ok = await relayer.callFunction({ contractId: CONTRACT, methodName: "prove_usdc_deposit", args: d.args, deposit: PROVE_USDC_DEPOSIT, gas: teraToGas(150) });
    usdcResults.push({ chain: d.chain, tx: d.args.tx_hash, log_index: Number(d.args.log_index), usdc: d.usdc, proven: ok });
  }
  return { light_client_height: lc, results, usdc: usdcResults };
}

/** req.body, but a malformed JSON body is the client’s mistake (400), not ours. */
export function body(req) {
  const bad = () => Object.assign(new Error("the body must be JSON"), { status: 400 });
  let b;
  try { b = req.body ?? {}; } catch { throw bad(); }
  // Vercel hands over an unparseable JSON body as the raw string instead of throwing
  if (typeof b === "string") { try { b = JSON.parse(b); } catch { throw bad(); } }
  if (typeof b !== "object" || b === null || Array.isArray(b)) throw bad();
  return b;
}

export async function handle(res, fn) {
  try { res.status(200).json(await fn()); }
  catch (e) {
    if (!e.status) console.error(e); // ours: log it, don’t echo internals
    res.status(e.status ?? 500).json({ error: e.status ? e.message : "internal error" });
  }
}
