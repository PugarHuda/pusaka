import { NearConnector } from "@hot-labs/near-connect";
import { FailoverRpcProvider, JsonRpcProvider, getTransactionLastResult } from "near-api-js";
import { CONTRACT, NETWORK, NEAR_RPCS, nearProvider } from "@pusaka/shared";

// near-api-js would retry one endpoint 12 times (~2 min of "Loading…" when FastNear rate-limits).
export const provider = nearProvider({ FailoverRpcProvider, JsonRpcProvider });
export const connector = new NearConnector({ network: NETWORK, providers: { [NETWORK]: NEAR_RPCS } });

// optimistic: right after a wallet transaction the UI must see its result, not a block or two behind
export const view = (method, args = {}) =>
  provider.callFunction({ contractId: CONTRACT, method, args, blockQuery: { finality: "optimistic" } });

/** Signs with the connected wallet and returns the decoded result of the whole receipt chain. */
export async function call(method, args = {}, opts = {}) {
  return getTransactionLastResult(await callRaw(method, args, opts));
}

/** Like call(), but returns the full outcome (logs, receipts). */
export async function callRaw(method, args = {}, { deposit = 0n, tgas = 100, receiver = CONTRACT } = {}) {
  const wallet = await connector.wallet();
  const outcome = await wallet.signAndSendTransaction({
    receiverId: receiver,
    actions: [{
      type: "FunctionCall",
      params: { methodName: method, args, gas: (BigInt(tgas) * 10n ** 12n).toString(), deposit: deposit.toString() },
    }],
  });
  const failure = outcome?.status?.Failure ?? outcome?.receipts_outcome?.find((r) => r.outcome.status.Failure)?.outcome.status.Failure;
  if (failure) throw new Error(contractError(failure));
  return outcome;
}

/** Pulls the panic message (e.g. "NotOwner") out of a NEAR failure object. */
function contractError(f) {
  const s = JSON.stringify(f);
  return s.match(/Smart contract panicked: ([^"\\]+)/)?.[1] ?? s.match(/"(\w+Error[^"]*)"/)?.[1] ?? "The transaction failed on NEAR.";
}

export const yocto = (near) => BigInt(Math.round(Number(near) * 1e6)) * 10n ** 18n;
export const near = (y) => (Number(BigInt(y) / 10n ** 18n) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 4 });

/** Calls Pusaka allows through the relayer (no deposit, nothing that moves money). */
const GASLESS = new Set(["list", "cancel_listing", "request_loan", "cancel_loan_request", "claim_collateral", "still_here", "claim_inheritance"]);

/**
 * NEP-366: if the wallet can sign delegate actions, the user signs and Pusaka's relayer pays
 * the gas. Otherwise this is a normal call(). Returns { gasless } so the UI can say which happened.
 */
export async function callGasless(method, args = {}) {
  const wallet = await connector.wallet();
  const fallback = async () => { await call(method, args); return { gasless: false }; };
  if (!GASLESS.has(method) || typeof wallet.signDelegateActions !== "function") return fallback();
  // The runtime manifest doesn't always advertise the feature, so just ask; wallets that
  // can't sign delegate actions throw, and we fall back. A user rejection is not retried.
  let signedDelegateActions;
  try {
    ({ signedDelegateActions } = await wallet.signDelegateActions({
      delegateActions: [{
        receiverId: CONTRACT,
        actions: [{ type: "FunctionCall", params: { methodName: method, args, gas: (50n * 10n ** 12n).toString(), deposit: "0" } }],
      }],
    }));
  } catch (e) {
    if (/reject|cancel|denied|closed/i.test(String(e?.message ?? e))) throw e;
    return fallback();
  }
  if (!signedDelegateActions?.[0]) return fallback();
  const r = await fetch("/api/relay", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ signed_delegate: signedDelegateActions[0] }),
  });
  const body = await r.json().catch(() => ({}));
  if (r.status === 429) return fallback(); // relayer's free quota used up: the user pays their own gas
  if (!r.ok) throw new Error(body.error ?? `relayer answered ${r.status}`);
  return { gasless: true, tx: body.tx };
}

