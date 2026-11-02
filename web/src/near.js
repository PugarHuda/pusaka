import { NearConnector } from "@hot-labs/near-connect";
import { JsonRpcProvider, getTransactionLastResult } from "near-api-js";
import { CONTRACT } from "@pusaka/shared";

const RPC = "https://test.rpc.fastnear.com";
export const provider = new JsonRpcProvider({ url: RPC });
export const connector = new NearConnector({ network: "testnet", providers: { testnet: [RPC] } });

export const view = (method, args = {}) => provider.callFunction({ contractId: CONTRACT, method, args });

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
