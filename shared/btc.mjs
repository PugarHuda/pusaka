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
 * What a buyer can rely on.
 * - safe:     confirmed UTXOs never signed by the MPC for this token
 * - pending:  unconfirmed UTXOs never signed (whoever funded them can still replace them via RBF)
 * - atRisk:   unspent UTXOs that some past request got a signature for
 * `spendable` (never signed, confirmed or not) is what the owner may withdraw.
 */
export async function balances(address, signedOutpoints) {
  const list = await utxos(address);
  const signed = new Set(signedOutpoints.map(key));
  const spendable = list.filter((u) => !signed.has(key(u)));
  const sum = (xs) => xs.reduce((a, u) => a + u.value, 0);
  const safe = sum(spendable.filter((u) => u.status?.confirmed));
  return { safe, pending: sum(spendable) - safe, atRisk: sum(list) - sum(spendable), spendable };
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

// ---------- EVM: the same MPC key also owns one address on every EVM chain ----------
import { createPublicClient, http, keccak256, getAddress, serializeTransaction, recoverAddress, toHex as viemHex } from "viem";
import { sepolia } from "viem/chains";

export const EVM = { chain: sepolia, rpc: "https://ethereum-sepolia-rpc.publicnode.com", explorer: "https://sepolia.etherscan.io" };
const evmClient = createPublicClient({ chain: EVM.chain, transport: http(EVM.rpc) });

export function evmAddress(pubkeyHex) {
  const uncompressed = secp256k1.Point.fromHex(pubkeyHex).toBytes(false); // 65 bytes, 0x04 prefix
  return getAddress("0x" + keccak256(uncompressed.slice(1)).slice(-40));
}

/**
 * ETH a buyer can rely on. Every nonce below `floor` may have a signed tx in the wild,
 * so the balance only counts once the account's on-chain nonce has reached the floor.
 */
export async function evmBalances(address, floor) {
  const [wei, nonce] = await Promise.all([
    evmClient.getBalance({ address }),
    evmClient.getTransactionCount({ address, blockTag: "pending" }),
  ]);
  const clear = nonce >= Number(floor);
  return { wei, nonce, safe: clear ? wei : 0n, atRisk: clear ? 0n : wei };
}

export async function evmTxParams(address) {
  const [nonce, fees] = await Promise.all([
    evmClient.getTransactionCount({ address, blockTag: "pending" }),
    evmClient.estimateFeesPerGas(),
  ]);
  return { nonce, gas: 21000n, maxFeePerGas: fees.maxFeePerGas * 2n, maxPriorityFeePerGas: fees.maxPriorityFeePerGas };
}

/** Unsigned EIP-1559 tx with exactly the fields the contract hashed. */
export function evmTx({ nonce, to, value, gas, maxFeePerGas, maxPriorityFeePerGas }) {
  return { type: "eip1559", chainId: EVM.chain.id, nonce, to, value, gas, maxFeePerGas, maxPriorityFeePerGas };
}

/**
 * Serialises the signed tx. Checks that the contract hashed the same tx we build here,
 * and that the MPC signature recovers to this Pusaka's address, before anything is sent.
 */
export async function finalizeEth(tx, signed, expectedFrom) {
  if (!signed.signature) throw new Error("the MPC network returned no signature");
  if (keccak256(serializeTransaction(tx)) !== "0x" + signed.sighash) throw new Error("contract signed a different transaction");
  const sig = signed.signature;
  let s = BigInt("0x" + sig.s.scalar), yParity = sig.recovery_id;
  if (s > N / 2n) { s = N - s; yParity ^= 1; }
  const signature = { r: viemHex(BigInt("0x" + sig.big_r.affine_point.slice(2)), { size: 32 }), s: viemHex(s, { size: 32 }), yParity };
  const from = await recoverAddress({ hash: "0x" + signed.sighash, signature });
  if (from !== expectedFrom) throw new Error(`signature recovers to ${from}, not ${expectedFrom}`);
  return serializeTransaction(tx, signature);
}

export async function broadcastEth(raw) {
  return evmClient.sendRawTransaction({ serializedTransaction: raw });
}
