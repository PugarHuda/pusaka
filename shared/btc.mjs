// Pusaka constants + Bitcoin helpers shared by the scripts (Node) and the web app (browser).
import * as bitcoin from "bitcoinjs-lib";
import { secp256k1 } from "@noble/curves/secp256k1.js";

export const CONTRACT = "pusaka-btc.testnet";
export const MPC = "v1.signer-prod.testnet";
export const MEMPOOL = "https://mempool.space/testnet4/api";
export const EXPLORER = "https://mempool.space/testnet4";
export const NET = bitcoin.networks.testnet; // testnet4 shares testnet address params (tb1…)

// Withdraw: 1 yocto per MPC sign + storage for recorded outpoints; excess is refunded.
export const WITHDRAW_DEPOSIT = 20_000_000_000_000_000_000_000n; // 0.02 NEAR
// Mint: token + BTC key + bounded history storage; excess is refunded.
export const MINT_DEPOSIT = 100_000_000_000_000_000_000_000n; // 0.1 NEAR

const fromHex = (h) => Uint8Array.from(h.match(/../g), (b) => parseInt(b, 16));
const toHex = (u) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");

export function btcAddress(pubkeyHex) {
  return bitcoin.payments.p2wpkh({ pubkey: fromHex(pubkeyHex), network: NET }).address;
}

/** Throws on anything that isn't a valid testnet address. */
export function scriptHex(address) {
  return toHex(bitcoin.address.toOutputScript(address.trim(), NET));
}

export async function utxos(address) {
  const r = await fetch(`${MEMPOOL}/address/${address}/utxo`);
  if (!r.ok) throw new Error(`mempool.space answered ${r.status} for ${address}`);
  return r.json(); // [{txid, vout, value, status:{confirmed}}]
}

const key = (o) => `${o.txid.toLowerCase()}:${o.vout}`;

/**
 * Safe balance = unspent UTXOs that were never signed by the MPC for this token.
 * A signed-but-unspent UTXO could be swept by whoever requested that signature.
 */
export async function balances(address, signedOutpoints) {
  const list = await utxos(address);
  const signed = new Set(signedOutpoints.map(key));
  const safe = list.filter((u) => !signed.has(key(u)));
  const sum = (xs) => xs.reduce((a, u) => a + u.value, 0);
  return { safe: sum(safe), atRisk: sum(list) - sum(safe), utxos: safe };
}

const N = secp256k1.Point.CURVE().n;

/** MPC SignatureResponse JSON -> 64-byte compact (r||s) with low-S, as Bitcoin requires. */
export function compactSig(sig) {
  const r = BigInt("0x" + sig.big_r.affine_point.slice(2));
  let s = BigInt("0x" + sig.s.scalar);
  if (s > N / 2n) s = N - s;
  const hex = (x) => x.toString(16).padStart(64, "0");
  return fromHex(hex(r) + hex(s));
}

/**
 * Attaches P2WPKH witnesses to the contract's unsigned tx. Each signature is checked
 * locally against the BIP143 sighash before anything is broadcast.
 */
export function finalize(signed, inputValues) {
  const tx = bitcoin.Transaction.fromHex(signed.unsigned_tx);
  const pubkey = fromHex(signed.btc_pubkey);
  const script = bitcoin.payments.p2pkh({ pubkey, network: NET }).output;
  tx.ins.forEach((_, i) => {
    const sig = signed.signatures[i];
    if (!sig) throw new Error(`input ${i}: the MPC network returned no signature`);
    const compact = compactSig(sig);
    const hash = tx.hashForWitnessV0(i, script, BigInt(inputValues[i]), bitcoin.Transaction.SIGHASH_ALL);
    if (!secp256k1.verify(compact, hash, pubkey, { prehash: false, lowS: true, format: "compact" }))
      throw new Error(`input ${i}: signature does not match the transaction`);
    tx.setWitness(i, [bitcoin.script.signature.encode(compact, 0x01), pubkey]);
  });
  return tx;
}

export async function broadcast(txHex) {
  const r = await fetch(`${MEMPOOL}/tx`, { method: "POST", body: txHex });
  const body = await r.text();
  if (!r.ok) throw new Error(`Bitcoin network rejected the transaction: ${body}`);
  return body; // txid
}
