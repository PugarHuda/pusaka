// Relayer logic shared by the Vercel functions (api/relay.mjs, api/prove.mjs) and local tests.
// The relayer account pays gas; users sign. Nothing here can move a user's NEAR.
import { Account, FailoverRpcProvider, JsonRpcProvider, SCHEMA, actions, encodeDelegateAction, teraToGas } from "near-api-js";
import { deserialize } from "borsh";
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base58 } from "@scure/base";
import {
  CONTRACT, ORIGINAL, SIBLINGS, PROVE_DEPOSIT, BTC_MIN_CONFIRMATIONS, balances, btcAddress, btcFetch, depositProof, lightClientHeight, preflightProof, nearProvider, nearFetch, usdcToProve, PROVE_USDC_DEPOSIT,
} from "@pusaka/shared";

/** Methods a user may run gas-free through NEP-366: none of them move money. */
/** The original contract and its allowlisted siblings (Smart Pusakas): same methods, same preflight, read from the delegate's own receiver. */
// ponytail: unique, and both deployments even when PUSAKA_CONTRACT points at the classic one (local runs, the Shade agent)
export const RELAY_CONTRACTS = [...new Set([CONTRACT, ORIGINAL, ...SIBLINGS])];
export const RELAY_METHODS = ["list", "cancel_listing", "request_loan", "cancel_loan_request", "claim_collateral", "still_here", "claim_inheritance", "accept_loan_offer", "approve_release"];
const MAX_TGAS = 100n;
/** list/cancel/loan-request ping-pong is free for the attacker; one relayed state change per token per minute caps it. */
export const RELAY_COOLDOWN_MS = 60_000;
const THROTTLED = new Set(["list", "cancel_listing", "request_loan", "cancel_loan_request", "accept_loan_offer"]);
/** A gas-free loan must be worth it: below this a self-dealing lender+borrower pair would just be farming relayer gas. */
export const MIN_RELAYED_PRINCIPAL = 10n ** 22n; // 0.01 NEAR
/** Relayer-paid USDC proofs per token: each leaves 0.002 NEAR of storage, so dust deposits can't drain the relayer. */
export const MAX_FREE_USDC_PROOFS = 4;
// ponytail: per-instance memory, not a shared store; Fluid Compute reuses instances so parallel
// duplicates mostly land here. A shared KV is the upgrade if someone scripts around it.
const inFlight = new Set();
const lastRelay = new Map(); // token_id -> ms of the last relayed state change sent from this instance
const lastProve = new Map();
const tooSoon = (msg) => Object.assign(new Error(msg), { status: 429 });

const provider = nearProvider({ FailoverRpcProvider, JsonRpcProvider });

let relayer;
/**
 * One relayer Account per instance, so concurrent requests share its nonce bookkeeping. RELAYER_PRIVATE_KEY may be a
 * NEP-611 gas key (scripts/gas-key.mjs): it pays gas from its own balance, and near-api-js spreads transactions over
 * its nonce lanes, so parallel relays don't queue behind one nonce. Each instance starts on a random lane so separate
 * instances rarely pick the same one (a clash is retried by near-api-js on a fresh nonce).
 */
export async function relayerAccount() {
  if (relayer) return relayer;
  const id = process.env.RELAYER_ACCOUNT_ID;
  const key = process.env.RELAYER_PRIVATE_KEY;
  if (!id || !key) throw Object.assign(new Error("relayer is not configured"), { status: 503 });
  const a = new Account(id, provider, key);
  const pk = (await a.getSigner().getPublicKey());
  const k = await provider.viewAccessKey({ accountId: id, publicKey: pk, finalityQuery: { finality: "final" } }).catch(() => null);
  const lanes = Number(k?.permission?.GasKeyFullAccess?.num_nonces ?? 0);
  // ponytail: seeds near-api-js's NonceManager state (unset lanes are fetched from chain on first use)
  if (lanes > 1) a.nonceManager.states[pk.toString()] = { nonces: Array(lanes).fill(undefined), nextLane: Math.floor(Math.random() * lanes) };
  return (relayer = a);
}

/** Decodes and checks a base64 borsh SignedDelegate; throws a 400 with the reason if it isn't allowed. */
export function checkDelegate(b64) {
  const bad = (m) => Object.assign(new Error(m), { status: 400 });
  let sd;
  try { sd = deserialize(SCHEMA.SignedDelegate, Buffer.from(b64, "base64")); } catch { throw bad("not a borsh SignedDelegate"); }
  const d = sd.delegateAction;
  if (!RELAY_CONTRACTS.includes(d.receiverId)) throw bad(`only calls to ${RELAY_CONTRACTS.join(" or ")} are relayed`);
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
  if (fc && (fc.receiver_id !== d.receiverId || (fc.method_names.length && !fc.method_names.includes(method)))) throw fail(401, `that key of ${d.senderId} can’t call ${method} on ${d.receiverId}`);
  if (BigInt(d.nonce) <= BigInt(key.nonce)) throw fail(409, "this delegate’s nonce was already used");
  if (!block || BigInt(d.maxBlockHeight) < BigInt(block.header.height)) throw fail(410, "this delegate expired; sign it again");
}

const offerById = async (c, id) => {
  if (!/^\d{1,19}$/.test(String(id))) return null;
  const r = await provider.callFunction({ contractId: c, method: "loan_offers", args: { from: String(id), limit: "1" } });
  return r?.offers?.find((x) => x.id === String(id))?.offer ?? null;
};

/**
 * A BTC holder with no NEAR can take a loan gas-free: the offer's principal is already escrowed and each
 * offer can be taken once, so this can't be farmed. Mirrors the contract's checks so the relayer never pays
 * for a doomed call; a refinance is relayed only when the offer alone pays off the current loan (no deposit).
 * Also throttled per token like list/cancel, and only for offers of at least MIN_RELAYED_PRINCIPAL.
 */
export function acceptWouldSucceed(info, offer, who, args) {
  if (typeof args.token_id !== "string" || typeof args.offer_id !== "string" || !Number.isInteger(args.expected_sign_epoch)) return false;
  if (Object.keys(args).length !== 3) return false;
  // assert_free: key derived, no signature or transfer_call in flight (pending), not listed, no NEP-178 approval
  if (!info || !offer || offer.lender === who || !info.btc_pubkey || info.listing || info.pending) return false;
  if (Object.keys(info.token?.approved_account_ids ?? {}).length) return false;
  if (BigInt(offer.principal) < MIN_RELAYED_PRINCIPAL) return false;
  if (args.expected_sign_epoch !== info.sign_epoch) return false;
  if (info.loan && !(info.loan.lender && info.loan.borrower === who && BigInt(info.loan.repay) <= BigInt(offer.principal))) return false;
  return offer.token_id != null
    ? offer.token_id === String(args.token_id) && offer.sign_epoch === info.sign_epoch
    : Number(info.verified_sats) >= Number(offer.min_verified_sats);
}

const guardiansOf = (c, token_id) => provider.callFunction({ contractId: c, method: "guardians_of", args: { token_id: String(token_id) } }).catch(() => null);

export async function relay(b64) {
  const sd = checkDelegate(b64);
  await verifyDelegate(sd);
  // Only relay what would succeed for this sender: they must own the token they're acting on
  // (claim_collateral: its lender; claim_inheritance: its heir, once due). Saves the relayer from paying for doomed calls.
  const fc = sd.delegateAction.actions[0].functionCall;
  let args;
  try { args = JSON.parse(Buffer.from(fc.args).toString()); } catch { throw Object.assign(new Error("function call args must be JSON"), { status: 400 }); }
  const c = sd.delegateAction.receiverId; // checked against RELAY_CONTRACTS above; every read below is from it
  const info = await provider.callFunction({ contractId: c, method: "token_info", args: { token_id: String(args.token_id) } });
  const who = sd.delegateAction.senderId;
  const slot = `${c}:${args.token_id}`; // throttles per contract: #5 on one deployment isn't #5 on the other
  let allowed = info?.token?.owner_id === who;
  // only once overdue: before that the call panics on-chain and the relayer pays for nothing
  if (fc.methodName === "claim_collateral") allowed = info?.loan?.lender === who && !!info.loan.due_ms && Number(info.loan.due_ms) <= Date.now();
  if (THROTTLED.has(fc.methodName)) {
    // on-chain history lags the send; this instance's own reservation covers parallel delegates (any nonce)
    const last = Math.max(Number(info?.history?.at(-1)?.at_ms ?? 0), lastRelay.get(slot) ?? 0);
    if (Date.now() - last < RELAY_COOLDOWN_MS) throw tooSoon(`Pusaka #${args.token_id} changed ${Math.round((Date.now() - last) / 1000)} s ago; gas-free again in ${Math.ceil((RELAY_COOLDOWN_MS - (Date.now() - last)) / 1000)} s`);
  }
  if (fc.methodName === "still_here") {
    // the relayer pays: one free check-in per hour (or per tenth of the silence) is plenty;
    // more often than that the holder can still check in by paying their own gas
    const h = await provider.callFunction({ contractId: c, method: "heir_of", args: { token_id: String(args.token_id) } });
    const gap = h && Math.min(3_600_000, Number(h.after_ms) / 10);
    if (h && Date.now() - Number(h.last_seen_ms) < gap) {
      throw Object.assign(new Error(`checked in ${Math.round((Date.now() - Number(h.last_seen_ms)) / 60_000)} min ago; the next gas-free check-in opens in ${Math.ceil((gap - (Date.now() - Number(h.last_seen_ms))) / 60_000)} min`), { status: 429 });
    }
  }
  if (fc.methodName === "claim_inheritance") {
    // only the named heir, and only once the holder's silence has run out
    const h = await provider.callFunction({ contractId: c, method: "heir_of", args: { token_id: String(args.token_id) } });
    allowed = h?.heir === who && Number(h.claimable_from_ms) <= Date.now();
    // with guardians: only once their quorum's waiting period is over, or the backstop has passed
    const g = allowed && await guardiansOf(c, args.token_id);
    if (g) allowed = (g.release_at_ms != null && Number(g.release_at_ms) <= Date.now()) || Number(g.backstop_from_ms) <= Date.now();
  }
  if (fc.methodName === "approve_release") {
    // only a named guardian who hasn't approved yet, once the holder's silence has run out
    const [h, g] = await Promise.all([
      provider.callFunction({ contractId: c, method: "heir_of", args: { token_id: String(args.token_id) } }),
      guardiansOf(c, args.token_id),
    ]);
    allowed = !!h && !!g && g.guardians.includes(who) && !g.approvals.includes(who) && Number(h.claimable_from_ms) <= Date.now();
    // one relayed approval per guardian per token per 10 minutes, reserved before sending: parallel delegates with
    // different nonces would all pass the check above before the first lands, and each failed one costs the relayer
    const k = `approve:${slot}:${who}`;
    if (allowed && Date.now() - (lastRelay.get(k) ?? 0) < 10 * 60_000) throw tooSoon("this guardian's approval was just relayed; it lands in a few seconds");
    if (allowed) lastRelay.set(k, Date.now());
  }
  if (fc.methodName === "accept_loan_offer") allowed = allowed && acceptWouldSucceed(info, await offerById(c, args.offer_id), who, args);
  if (!allowed) throw Object.assign(new Error(`${who} can't ${fc.methodName} Pusaka #${args.token_id}`), { status: 403 });
  // the same signed delegate posted N times in parallel would pass every check above N times
  const key = `${who}:${sd.delegateAction.nonce}`;
  if (inFlight.has(key)) throw Object.assign(new Error("this signed action is already being relayed"), { status: 409 });
  inFlight.add(key);
  if (THROTTLED.has(fc.methodName)) lastRelay.set(slot, Date.now()); // reserve before awaiting
  let res;
  try {
    res = await (await relayerAccount()).signAndSendTransaction({
      receiverId: sd.delegateAction.senderId,
      actions: [actions.signedDelegate({ delegateAction: sd.delegateAction, signature: sd.signature })],
      waitUntil: "FINAL", // the app re-reads views at final; answering earlier shows the user stale state
    });
  } finally { inFlight.delete(key); }
  const failure = res.receipts_outcome?.find((r) => r.outcome.status.Failure)?.outcome.status.Failure;
  if (failure) throw Object.assign(new Error(JSON.stringify(failure).match(/Smart contract panicked: ([^"\\]+)/)?.[1] ?? "relayed call failed"), { status: 422 });
  return { tx: res.transaction.hash, sender: sd.delegateAction.senderId, methods: sd.delegateAction.actions.map((a) => a.functionCall.methodName) };
}

/** Free proofs below this need to be the Pusaka's own change; anyone could otherwise make the relayer pay for dust. */
export const MIN_FREE_PROOF_SATS = 10_000;
const MIN_CHANGE_SATS = 1_000;

/**
 * Likely a withdrawal's change (output 1 of a transaction spending outpoints the contract signed for this token).
 * A cheap pre-check so the relayer doesn't pay for dust; the contract itself only accepts output 1 of a transaction
 * it built (`ch:<txid>`), so a lookalike fails there.
 */
export function isOwnChange(tx, signedOutpoints) {
  const signed = new Set(signedOutpoints.map((o) => `${o.txid.toLowerCase()}:${o.vout}`));
  return !!tx?.vin?.some((i) => signed.has(`${String(i.txid).toLowerCase()}:${i.vout}`));
}

/** Proves every confirmed, unproven deposit of a token, paid by `relayer` (the TEE agent passes its own account).
 * `c`: the original contract or an allowlisted sibling (Smart Pusakas); USDC proofs only on the original. */
export async function proveToken(tokenId, relayer, c = CONTRACT) {
  if (!RELAY_CONTRACTS.includes(c)) throw Object.assign(new Error(`contract must be one of ${RELAY_CONTRACTS.join(", ")}`), { status: 400 });
  // typeof first: String(["1"]) is "1"
  if (!["string", "number"].includes(typeof tokenId) || !/^\d{1,9}$/.test(String(tokenId))) throw Object.assign(new Error("token_id must be a number"), { status: 400 });
  const info = await provider.callFunction({ contractId: c, method: "token_info", args: { token_id: String(tokenId) } });
  if (!info?.btc_pubkey) throw Object.assign(new Error("no such Pusaka"), { status: 404 });
  const lc = await lightClientHeight();
  const bal = await balances(btcAddress(info.btc_pubkey), info.signed_outpoints);
  const ready = bal.spendable.filter((u) => u.value >= MIN_CHANGE_SATS && u.status?.confirmed
    && u.status.block_height + BTC_MIN_CONFIRMATIONS - 1 <= lc
    && !info.proven_utxos.some((p) => p.txid === u.txid && p.vout === u.vout));
  const todo = [];
  for (const u of ready) {
    if (todo.length === 4) break;
    if (u.value >= MIN_FREE_PROOF_SATS || (u.vout === 1 && isOwnChange(await btcFetch(`/tx/${u.txid}`).then((r) => r.json()).catch(() => null), info.signed_outpoints))) todo.push(u);
  }
  // USDC on Base/Arbitrum, attested by NEAR MPC: only finalized logs (the MPC reads finalized blocks)
  const proved = c !== CONTRACT ? MAX_FREE_USDC_PROOFS : (await provider.callFunction({ contractId: CONTRACT, method: "usdc_info", args: { token_id: String(tokenId) } }).catch(() => []))
    .reduce((n, x) => n + x.deposits.length, 0);
  const usdc = proved >= MAX_FREE_USDC_PROOFS ? [] // past the cap the holder proves (and pays) themselves
    : (await usdcToProve(tokenId).catch(() => [])).filter((d) => d.finalized).slice(0, Math.min(2, MAX_FREE_USDC_PROOFS - proved));
  if (!todo.length && !usdc.length) return { light_client_height: lc, results: [], usdc: [] };
  // two proofs of the same token at once would both pay; the contract only dedupes in the callback
  if (Date.now() - (lastProve.get(`${c}:${tokenId}`) ?? 0) < 30_000) throw tooSoon("a proof for this Pusaka was just sent; try again in a minute");
  lastProve.set(`${c}:${tokenId}`, Date.now());
  relayer ??= await relayerAccount();
  const results = [];
  for (const u of todo) {
    const proof = await depositProof(u.txid, u.vout);
    // Free dry run against the light client first; the relayer only pays for proofs that pass.
    if (!(await preflightProof(proof))) { results.push({ txid: u.txid, vout: u.vout, sats: u.value, proven: false, skipped: "preflight failed" }); continue; }
    const ok = await relayer.callFunction({ contractId: c, methodName: "prove_deposit",
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
