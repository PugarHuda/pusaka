// Node helpers for Pusaka scripts: NEAR accounts and contract calls. Bitcoin helpers live in shared/.
import { Account, JsonRpcProvider, KeyPair, teraToGas } from "near-api-js";
import { CONTRACT } from "@pusaka/shared";
import fs from "node:fs";
import path from "node:path";

export const RPC = process.env.NEAR_RPC ?? "https://rpc.testnet.near.org";

const KEYS = path.join(import.meta.dirname, "..", ".keys");
export const provider = new JsonRpcProvider({ url: RPC });

// ---------- NEAR ----------

export function keyFile(accountId) {
  return path.join(KEYS, `${accountId}.json`);
}

export function saveKey(accountId, keyPair) {
  fs.mkdirSync(KEYS, { recursive: true });
  fs.writeFileSync(
    keyFile(accountId),
    JSON.stringify({ account_id: accountId, private_key: keyPair.toString() }, null, 2),
  );
}

export function account(accountId) {
  const { private_key } = JSON.parse(fs.readFileSync(keyFile(accountId), "utf8"));
  return new Account(accountId, provider, private_key);
}

export async function exists(accountId) {
  try {
    await provider.viewAccount({ accountId, blockQuery: { finality: "final" } });
    return true;
  } catch {
    return false;
  }
}

/** Creates a funded testnet account through the public faucet helper (same one near-cli uses). */
export async function faucetAccount(accountId) {
  const kp = KeyPair.fromRandom("ed25519");
  const res = await fetch("https://helper.nearprotocol.com/account", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: kp.getPublicKey().toString() }),
  });
  if (!res.ok) throw new Error(`faucet ${res.status}: ${await res.text()}`);
  saveKey(accountId, kp);
  return kp;
}

export async function view(method, args = {}, contractId = CONTRACT) {
  return provider.callFunction({ contractId, method, args });
}

/** Calls the contract and returns the decoded return value of the whole receipt chain. */
export async function call(acct, method, args = {}, { deposit = 0n, tgas = 100 } = {}) {
  return acct.callFunction({
    contractId: CONTRACT,
    methodName: method,
    args,
    deposit,
    gas: teraToGas(tgas),
  });
}

export * from "@pusaka/shared";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
