// Node helpers for Pusaka scripts: NEAR accounts and contract calls. Bitcoin helpers live in shared/.
import { Account, FailoverRpcProvider, JsonRpcProvider, KeyPair, teraToGas } from "near-api-js";
import { CONTRACT, NETWORK, NEAR_RPC, MINT_DEPOSIT, mintedTokenId, nearProvider } from "@pusaka/shared";
import fs from "node:fs";
import path from "node:path";

export const RPC = NEAR_RPC;

const KEYS = path.join(import.meta.dirname, "..", ".keys");
export const provider = nearProvider({ FailoverRpcProvider, JsonRpcProvider });

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
  if (NETWORK !== "testnet") throw new Error(`no faucet on ${NETWORK}: create and fund ${accountId} yourself`);
  const kp = KeyPair.fromRandom("ed25519");
  const res = await fetch("https://helper.nearprotocol.com/account", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: kp.getPublicKey().toString() }),
  });
  if (!res.ok) throw new Error(`faucet ${res.status}: ${await res.text()}${res.status === 429 ? " (the NEAR testnet faucet limits each IP; pass existing accounts whose keys are in .keys/ instead)" : ""}`);
  saveKey(accountId, kp);
  return kp;
}

export async function ensureAccount(id) {
  if (!fs.existsSync(keyFile(id))) await faucetAccount(id);
  return account(id);
}

/** For scripts that must run from a clean clone: faucet accounts pusaka-<role>-<tag>.testnet; the first mints a Pusaka. */
export async function freshSetup(roles) {
  const tag = Date.now().toString(36);
  const ids = [];
  for (const r of roles) { ids.push(`pusaka-${r}-${tag}.testnet`); await ensureAccount(ids.at(-1)); }
  const tokenId = mintedTokenId(await callRaw(account(ids[0]), "nft_mint", {}, { deposit: MINT_DEPOSIT }), ids[0]);
  console.log(`fresh accounts ${ids.join(", ")}; ${ids[0]} minted Pusaka #${tokenId}`);
  return { ids, tokenId };
}

export async function view(method, args = {}, contractId = CONTRACT) {
  return provider.callFunction({ contractId, method, args, blockQuery: { finality: "optimistic" } });
}

/** Full outcome (logs, receipts) of a contract call. */
export async function callRaw(acct, method, args = {}, { deposit = 0n, tgas = 100, receiver = CONTRACT } = {}) {
  return acct.callFunctionRaw({ contractId: receiver, methodName: method, args, deposit, gas: teraToGas(tgas) });
}

/** Calls the contract and returns the decoded return value of the whole receipt chain. */
export async function call(acct, method, args = {}, { deposit = 0n, tgas = 100, receiver = CONTRACT } = {}) {
  return acct.callFunction({
    contractId: receiver,
    methodName: method,
    args,
    deposit,
    gas: teraToGas(tgas),
  });
}

export * from "@pusaka/shared";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
