import { NearConnector } from "@hot-labs/near-connect";
import { JsonRpcProvider, getTransactionLastResult } from "near-api-js";
import { CONTRACT, NETWORK, NEAR_RPC } from "@pusaka/shared";

export const provider = new JsonRpcProvider({ url: NEAR_RPC });
export const connector = new NearConnector({ network: NETWORK, providers: { [NETWORK]: [NEAR_RPC] } });

// optimistic: right after a wallet transaction the UI must see its result, not a block or two behind
export const view = (method, args = {}) =>
  provider.callFunction({ contractId: CONTRACT, method, args, blockQuery: { finality: "optimistic" } });

/** Signs with the connected wallet and returns the decoded result of the whole receipt chain. */
export async function call(method, args = {}, { deposit = 0n, tgas = 100 } = {}) {
  const wallet = await connector.wallet();
  const outcome = await wallet.signAndSendTransaction({
    receiverId: CONTRACT,
    actions: [{
      type: "FunctionCall",
      params: { methodName: method, args, gas: (BigInt(tgas) * 10n ** 12n).toString(), deposit: deposit.toString() },
    }],
  });
  const failure = outcome?.status?.Failure ?? outcome?.receipts_outcome?.find((r) => r.outcome.status.Failure)?.outcome.status.Failure;
  if (failure) throw new Error(contractError(failure));
  return getTransactionLastResult(outcome);
}

/** Pulls the panic message (e.g. "NotOwner") out of a NEAR failure object. */
function contractError(f) {
  const s = JSON.stringify(f);
  return s.match(/Smart contract panicked: ([^"\\]+)/)?.[1] ?? s.match(/"(\w+Error[^"]*)"/)?.[1] ?? "The transaction failed on NEAR.";
}

export const yocto = (near) => BigInt(Math.round(Number(near) * 1e6)) * 10n ** 18n;
export const near = (y) => (Number(BigInt(y) / 10n ** 18n) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 4 });
