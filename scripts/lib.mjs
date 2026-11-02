// Shared helpers for Pusaka scripts: NEAR accounts, contract calls, Bitcoin testnet4.
import { Account, JsonRpcProvider, KeyPair, teraToGas } from "near-api-js";
import * as bitcoin from "bitcoinjs-lib";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import fs from "node:fs";
import path from "node:path";

export const RPC = process.env.NEAR_RPC ?? "https://rpc.testnet.near.org";
export const CONTRACT = process.env.PUSAKA_CONTRACT ?? "pusaka-btc.testnet";
export const MPC = "v1.signer-prod.testnet";
export const MEMPOOL = "https://mempool.space/testnet4/api";
export const NET = bitcoin.networks.testnet; // testnet4 shares testnet address params (tb1…)

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

// ---------- Bitcoin ----------

export function btcAddress(pubkeyHex) {
  return bitcoin.payments.p2wpkh({ pubkey: Buffer.from(pubkeyHex, "hex"), network: NET }).address;
}

export function scriptHex(address) {
  return Buffer.from(bitcoin.address.toOutputScript(address, NET)).toString("hex");
}

export async function utxos(address) {
  const r = await fetch(`${MEMPOOL}/address/${address}/utxo`);
  if (!r.ok) throw new Error(`mempool utxo ${r.status}`);
  return r.json(); // [{txid, vout, value, status:{confirmed}}]
}

export async function outspend(txid, vout) {
  const r = await fetch(`${MEMPOOL}/tx/${txid}/outspend/${vout}`);
  return r.ok ? (await r.json()).spent : false;
}

/**
 * Safe balance = unspent UTXOs that were never signed by the MPC for this token.
 * A signed-but-unspent UTXO could be swept by whoever requested that signature.
 */
export async function balances(address, signedOutpoints) {
  const list = await utxos(address);
  const signed = new Set(signedOutpoints.map((o) => `${o.txid}:${o.vout}`));
  let safe = 0, atRisk = 0;
  for (const u of list) (signed.has(`${u.txid}:${u.vout}`) ? (atRisk += u.value) : (safe += u.value));
  return { safe, atRisk, utxos: list.filter((u) => !signed.has(`${u.txid}:${u.vout}`)) };
}

const N = secp256k1.Point.CURVE().n;

/** MPC SignatureResponse JSON -> 64-byte compact (r||s) with low-S, as Bitcoin requires. */
export function compactSig(sig) {
  const r = BigInt("0x" + sig.big_r.affine_point.slice(2));
  let s = BigInt("0x" + sig.s.scalar);
  if (s > N / 2n) s = N - s;
  const hex = (x) => x.toString(16).padStart(64, "0");
  return Buffer.from(hex(r) + hex(s), "hex");
}

/**
 * Attaches P2WPKH witnesses to the contract's unsigned tx. Each signature is checked
 * locally against the BIP143 sighash before anything is broadcast.
 */
export function finalize(signed, inputValues) {
  const tx = bitcoin.Transaction.fromHex(signed.unsigned_tx);
  const pubkey = Buffer.from(signed.btc_pubkey, "hex");
  const script = bitcoin.payments.p2pkh({ pubkey, network: NET }).output;
  tx.ins.forEach((_, i) => {
    const sig = signed.signatures[i];
    if (!sig) throw new Error(`input ${i}: MPC signature missing`);
    const compact = compactSig(sig);
    const hash = tx.hashForWitnessV0(i, script, BigInt(inputValues[i]), bitcoin.Transaction.SIGHASH_ALL);
    if (!secp256k1.verify(compact, hash, pubkey, { prehash: false, lowS: true, format: "compact" }))
      throw new Error(`input ${i}: signature does not verify against the sighash`);
    tx.setWitness(i, [Buffer.from(bitcoin.script.signature.encode(compact, 0x01)), pubkey]);
  });
  return tx;
}

export async function broadcast(txHex) {
  const r = await fetch(`${MEMPOOL}/tx`, { method: "POST", body: txHex });
  const body = await r.text();
  if (!r.ok) throw new Error(`broadcast ${r.status}: ${body}`);
  return body; // txid
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
