// Relayer logic shared by the Vercel functions (api/relay.mjs, api/prove.mjs) and local tests.
// The relayer account pays gas; users sign. Nothing here can move a user's NEAR.
import { Account, JsonRpcProvider, SCHEMA, actions, teraToGas } from "near-api-js";
import { deserialize } from "borsh";
import {
  CONTRACT, NEAR_RPC, PROVE_DEPOSIT, balances, btcAddress, depositProof, lightClientHeight,
} from "@pusaka/shared";

/** Methods a user may run gas-free through NEP-366: none of them move money. */
export const RELAY_METHODS = ["list", "cancel_listing", "request_loan", "cancel_loan_request", "claim_collateral"];
const MAX_TGAS = 100n;

const provider = new JsonRpcProvider({ url: NEAR_RPC });

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
  if (!d.actions.length) throw bad("no actions");
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
export async function relay(b64) {
  const sd = checkDelegate(b64);
  const res = await relayerAccount().signAndSendTransaction({
    receiverId: sd.delegateAction.senderId,
    actions: [actions.signedDelegate({ delegateAction: sd.delegateAction, signature: sd.signature })],
    waitUntil: "EXECUTED_OPTIMISTIC",
  });
  const failure = res.receipts_outcome?.find((r) => r.outcome.status.Failure)?.outcome.status.Failure;
  if (failure) throw Object.assign(new Error(JSON.stringify(failure).match(/Smart contract panicked: ([^"\\]+)/)?.[1] ?? "relayed call failed"), { status: 422 });
  return { tx: res.transaction.hash, sender: sd.delegateAction.senderId, methods: sd.delegateAction.actions.map((a) => a.functionCall.methodName) };
}

/** Proves every confirmed, unproven deposit of a token, paid by the relayer. */
export async function proveToken(tokenId) {
  if (!/^\d{1,9}$/.test(String(tokenId))) throw Object.assign(new Error("bad token id"), { status: 400 });
  const info = await provider.callFunction({ contractId: CONTRACT, method: "token_info", args: { token_id: String(tokenId) } });
  if (!info?.btc_pubkey) throw Object.assign(new Error("no such Pusaka"), { status: 404 });
  const lc = await lightClientHeight();
  const bal = await balances(btcAddress(info.btc_pubkey), info.signed_outpoints);
  const todo = bal.spendable.filter((u) => u.value >= 10_000 && u.status?.confirmed && u.status.block_height <= lc
    && !info.proven_utxos.some((p) => p.txid === u.txid && p.vout === u.vout)).slice(0, 4);
  const relayer = relayerAccount();
  const results = [];
  for (const u of todo) {
    const ok = await relayer.callFunction({ contractId: CONTRACT, methodName: "prove_deposit",
      args: { token_id: String(tokenId), ...(await depositProof(u.txid, u.vout)) }, deposit: PROVE_DEPOSIT, gas: teraToGas(100) });
    results.push({ txid: u.txid, vout: u.vout, sats: u.value, proven: ok });
  }
  return { light_client_height: lc, results };
}

export async function handle(res, fn) {
  try { res.status(200).json(await fn()); }
  catch (e) { res.status(e.status ?? 500).json({ error: e.message }); }
}
