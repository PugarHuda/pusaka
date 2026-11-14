// Pusaka constants + Bitcoin helpers shared by the scripts (Node) and the web app (browser).
import * as bitcoin from "bitcoinjs-lib";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { mainnet, sepolia, base, baseSepolia, arbitrum, arbitrumSepolia } from "viem/chains";
import { ed25519 } from "@noble/curves/ed25519.js";
import { base58, base64 } from "@scure/base";
// Deployed accounts: deployments/<network>.json records them (code hash, deploy tx, accounts); read here.
import TESTNET from "../deployments/testnet.json" with { type: "json" };
import TESTNET_V2 from "../deployments/testnet-v2.json" with { type: "json" };

// One switch for everything network-specific. Node: PUSAKA_NETWORK=mainnet; Vite: VITE_NETWORK=mainnet.
const env = (k) => globalThis.process?.env?.[k] ?? import.meta.env?.[`VITE_${k.replace("PUSAKA_", "")}`];
export const NETWORK = env("PUSAKA_NETWORK") ?? "testnet";

const CONFIG = {
  testnet: {
    // One contract: Smart Pusaka (v2) does everything v1 did and more; v1 (pusaka-btc.testnet) stays on chain, frozen,
    // reachable as a sibling with ?contract=pusaka-btc.testnet, and its Pusakas can be wrapped into a v2 one.
    contract: TESTNET_V2.contract,
    mpc: TESTNET.uses.mpc,
    nearRpc: "https://test.rpc.fastnear.com",
    nearRpcFallbacks: ["https://near-testnet.drpc.org", "https://rpc.testnet.near.org"],
    nearExplorer: TESTNET.explorer,
    txApi: "https://tx.test.fastnear.com", // FastNear transactions API (CORS-enabled)
    btc: bitcoin.networks.testnet, // Bitcoin testnet3: the network btc-client-v4.testnet (light client) tracks
    mempool: "https://mempool.space/testnet",
    esploraFallback: "https://blockstream.info/testnet/api", // same Esplora API, CORS open
    // Same order as EVM_CHAINS in the contract. USDC: Circle's official testnet deployments.
    evm: [
      { chain: sepolia, rpc: "https://ethereum-sepolia-rpc.publicnode.com", explorer: "https://sepolia.etherscan.io", usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" },
      { chain: baseSepolia, rpc: "https://base-sepolia-rpc.publicnode.com", explorer: "https://sepolia.basescan.org", usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" },
      { chain: arbitrumSepolia, rpc: "https://arbitrum-sepolia-rpc.publicnode.com", explorer: "https://sepolia.arbiscan.io", usdc: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d" },
    ],
    sol: { rpc: "https://api.devnet.solana.com", explorer: (a) => `https://explorer.solana.com/${a}?cluster=devnet`, name: "Solana devnet" },
    market: TESTNET.uses.outside_market, // Mintbase
    nbtc: TESTNET.uses.nbtc, // Omni Bridge nBTC (NEP-141)
    btcConnector: TESTNET.uses.btc_connector,
    bridgeApi: "https://testnet.api.bridge.nearone.org",
  },
  mainnet: {
    contract: "pusaka.near", // placeholder until the mainnet account exists; override with PUSAKA_CONTRACT
    mpc: "v1.signer",
    nearRpc: "https://free.rpc.fastnear.com",
    nearRpcFallbacks: ["https://near.drpc.org", "https://rpc.mainnet.near.org"],
    nearExplorer: "https://near.rocks",
    txApi: "https://tx.main.fastnear.com",
    btc: bitcoin.networks.bitcoin,
    mempool: "https://mempool.space",
    esploraFallback: "https://blockstream.info/api",
    evm: [
      { chain: mainnet, rpc: "https://ethereum-rpc.publicnode.com", explorer: "https://etherscan.io", usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
      { chain: base, rpc: "https://base-rpc.publicnode.com", explorer: "https://basescan.org", usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
      { chain: arbitrum, rpc: "https://arbitrum-one-rpc.publicnode.com", explorer: "https://arbiscan.io", usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" },
    ],
    sol: { rpc: "https://api.mainnet-beta.solana.com", explorer: (a) => `https://explorer.solana.com/${a}`, name: "Solana" },
    market: "simple.market.mintbase1.near", // Mintbase
    nbtc: "nbtc.bridge.near",
    btcConnector: "btc-connector.bridge.near",
    bridgeApi: "https://mainnet.api.bridge.nearone.org",
  },
}[NETWORK];
if (!CONFIG) throw new Error(`unknown network ${NETWORK}`);

// The web app can open a known sibling deployment with ?contract=… (allowlisted, so a link can't point it at a lookalike).
export const SIBLINGS = { testnet: [TESTNET.contract], mainnet: [] }[NETWORK];
const fromUrl = (() => { try { const c = new URLSearchParams(globalThis.location?.search ?? "").get("contract"); return SIBLINGS.includes(c) ? c : null; } catch { return null; } })();
export const CONTRACT = env("PUSAKA_CONTRACT") ?? fromUrl ?? CONFIG.contract;
export const ORIGINAL = CONFIG.contract;
export const IS_SIBLING = CONTRACT !== ORIGINAL;
export const MPC = CONFIG.mpc;
export const NEAR_RPC = env("PUSAKA_NEAR_RPC") ?? CONFIG.nearRpc;
/** FastNear first (fast), then dRPC and NEAR's own RPC when one rate-limits (429) or is down. All send CORS headers. */
export const NEAR_RPCS = [NEAR_RPC, ...CONFIG.nearRpcFallbacks].filter((u, i, a) => a.indexOf(u) === i);

/** nearFetch(init), but on the first NEAR RPC that answers without a 429, a 5xx or a network error. */
export async function nearFetch(init) {
  let last;
  for (const url of NEAR_RPCS) {
    try {
      // a hung endpoint must fail over too, not hold the caller forever
      const r = await fetch(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(10_000) });
      if (r.status === 429 || r.status >= 500) { last = new Error(`${url}: HTTP ${r.status}`); continue; }
      // FastNear also reports rate limits inside a 200 body
      if ((await r.clone().json().catch(() => null))?.error?.code === -429) { last = new Error(`${url}: rate limited`); continue; }
      return r;
    } catch (e) { last = e; }
  }
  throw last;
}

/** near-api-js provider over NEAR_RPCS: two short retries per endpoint instead of 12 against one. Pass near-api-js in. */
export function nearProvider({ FailoverRpcProvider, JsonRpcProvider }) {
  // FailoverRpcProvider keeps one shared index and steps it on every error: twenty parallel reads failing
  // on a rate-limited RPC stepped it twenty times, round and round, back onto that RPC. Here each call
  // tries the endpoints in order, skipping any that failed in the last minute; only network-level
  // failures count against an endpoint, anything else (a contract panic) is the answer and is thrown.
  const downUntil = new Map();
  const networkError = (e) => e?.type === "RetriesExceeded" || e instanceof TypeError || e?.name === "AbortError" || e?.name === "TimeoutError"
    || /\b(429|50\d)\b|fetch|network|timed? ?out|rate.?limit/i.test(String(e?.message ?? e));
  // At most 8 reads in flight: a page that fires 45 at once used to send them all to a rate-limited RPC before the
  // first failure marked it down (FastNear answers 429 without CORS headers: one console error per call). Queued
  // reads pick their endpoint when they start, so they skip one that just failed. (QA 14 Nov)
  let active = 0;
  const queue = [];
  const slot = () => (active < 8 ? (active++, Promise.resolve()) : new Promise((r) => queue.push(r)));
  const release = () => { const next = queue.shift(); next ? next() : active--; };
  class Failover extends FailoverRpcProvider {
    async withBackoff(getResult) {
      await slot();
      try { return await this.tryInOrder(getResult); } finally { release(); }
    }
    async tryInOrder(getResult) {
      const now = Date.now();
      const order = this.providers.map((p, i) => i).sort((a, b) => ((downUntil.get(a) ?? 0) > now) - ((downUntil.get(b) ?? 0) > now));
      let last;
      for (const i of order) {
        try {
          // a hung endpoint fails over after 20 s instead of holding one of the 8 slots for minutes
          let timer;
          const r = await Promise.race([getResult(this.providers[i]), new Promise((_, no) => { timer = setTimeout(() => no(Object.assign(new Error("timed out"), { name: "TimeoutError" })), 20_000); })])
            .finally(() => clearTimeout(timer));
          downUntil.delete(i);
          return r;
        } catch (e) {
          if (!networkError(e)) throw e;
          last = e;
          downUntil.set(i, Date.now() + 60_000);
        }
      }
      throw last;
    }
  }
  // one attempt per endpoint: the failover across endpoints is the retry
  return new Failover(NEAR_RPCS.map((url) => new JsonRpcProvider({ url }, { retries: 1, wait: 400, backoff: 2 })));
}
export const NEAR_EXPLORER = CONFIG.nearExplorer;
export const MEMPOOL = `${CONFIG.mempool}/api`;
export const ESPLORA = [MEMPOOL, CONFIG.esploraFallback];

const downUntil = new Map(); // endpoint -> ms; a failed endpoint is tried last for a while
export const ESPLORA_COOLDOWN_MS = 5 * 60_000;

/**
 * Esplora request with failover (mempool.space, then Blockstream) on timeouts, 429 and 5xx.
 * A 4xx answer (bad tx, unknown address) is the answer: returned, not retried elsewhere.
 * An endpoint that fails goes to the back of the line for ESPLORA_COOLDOWN_MS, so a page making
 * twenty requests waits out one timeout, not twenty.
 */
export async function btcFetch(path, init = {}, timeoutMs = 10_000) {
  let last;
  const now = Date.now();
  const order = [...ESPLORA].sort((a, b) => ((downUntil.get(a) ?? 0) > now) - ((downUntil.get(b) ?? 0) > now));
  for (const base of order) {
    try {
      const r = await fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (r.status === 429 || r.status >= 500) throw new Error(`${new URL(base).host} answered ${r.status} for ${path}`);
      downUntil.delete(base);
      return r;
    } catch (e) { last = e; downUntil.set(base, Date.now() + ESPLORA_COOLDOWN_MS); }
  }
  throw last;
}
export const EXPLORER = CONFIG.mempool;
export const NET = CONFIG.btc;

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

/** The address an output script pays to, or null when it has none (OP_RETURN, bare scripts). */
export function scriptAddress(hex) {
  try { return bitcoin.address.fromOutputScript(fromHex(hex), NET); } catch { return null; }
}

export async function utxos(address) {
  const r = await btcFetch(`/address/${address}/utxo`);
  if (!r.ok) throw new Error(`Esplora answered ${r.status} for ${address}`);
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

/**
 * Everything `prove_deposit` needs for output `vout` of `txid`, from any Esplora API.
 * The contract re-derives the txid from `tx_hex` and the light client checks the proofs,
 * so a wrong answer from the API can only make the proof fail, never fake a deposit.
 */
export const BTC_LIGHT_CLIENT = NETWORK === "mainnet" ? "btc-client.bridge.near" : TESTNET.uses.btc_light_client;

/** Height of the last Bitcoin block NEAR's light client has accepted. */
export async function lightClientHeight() {
  const r = await nearFetch({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: {
      request_type: "call_function", finality: "optimistic", account_id: BTC_LIGHT_CLIENT,
      method_name: "get_last_block_height", args_base64: "e30=" } }),
  }).then((x) => x.json());
  if (!r.result?.result) throw new Error("Couldn't read NEAR's Bitcoin light client.");
  return Number(new TextDecoder().decode(new Uint8Array(r.result.result)));
}

export async function depositProof(txid, vout) {
  const get = (path, as = "json") => btcFetch(path).then((r) => {
    if (!r.ok) throw new Error(`Esplora answered ${r.status} for ${path}`);
    return as === "json" ? r.json() : r.text();
  });
  const status = await get(`/tx/${txid}/status`);
  if (!status.confirmed) throw new Error("This deposit has no Bitcoin confirmation yet. Try again after the next block.");
  // Relayers feed the light client a block or so behind; a proof for a block it hasn't seen would fail.
  const lc = await lightClientHeight();
  if (lc < status.block_height) {
    throw new Error(`NEAR's light client is at Bitcoin block ${lc} and this deposit is in block ${status.block_height}. Try again in a few minutes.`);
  }
  const tx = bitcoin.Transaction.fromHex(await get(`/tx/${txid}/hex`, "text"));
  tx.ins.forEach((i) => { i.witness = []; }); // non-witness serialization: its hash is the txid
  const [proof, coinbase] = await Promise.all([get(`/tx/${txid}/merkle-proof`), get(`/block/${status.block_hash}/txid/0`, "text")]);
  const coinbaseProof = await get(`/tx/${coinbase}/merkle-proof`);
  return {
    tx_hex: tx.toHex(), vout, block_hash: status.block_hash, tx_index: String(proof.pos),
    merkle_proof: proof.merkle, coinbase_txid: coinbase, coinbase_merkle_proof: coinbaseProof.merkle,
  };
}

// Proving a deposit: storage for one record, excess refunded.
export const PROVE_DEPOSIT = 10_000_000_000_000_000_000_000n; // 0.01 NEAR

export async function broadcast(txHex) {
  const r = await btcFetch("/tx", { method: "POST", body: txHex }, 20_000);
  const body = await r.text();
  if (!r.ok) throw new Error(`Bitcoin network rejected the transaction: ${body}`);
  return body; // txid
}

// ---------- EVM: the same MPC key also owns one address on every EVM chain ----------
import { keccak256, getAddress, serializeTransaction, recoverAddress, recoverMessageAddress, serializeSignature, toHex as viemHex, encodeFunctionData, erc20Abi } from "viem";
/** Every EVM chain the contract signs for (EVM_CHAINS). */
export const EVM_CHAINS = CONFIG.evm;
export const EVM = EVM_CHAINS[0];
const chainOf = (id) => EVM_CHAINS.find((c) => c.chain.id === Number(id ?? EVM.chain.id)) ?? (() => { throw new Error(`chain ${id} not supported`); })();
// viem's RPC client is ~75 kB gzipped: loaded on the first EVM read, not with the page
const clients = new Map();
const clientOf = (id) => {
  const c = chainOf(id);
  if (!clients.has(c.chain.id)) clients.set(c.chain.id, import("viem").then(({ createPublicClient, http }) => createPublicClient({ chain: c.chain, transport: http(c.rpc) })));
  return clients.get(c.chain.id);
};
/** An outside NEP-178/199 market Pusaka can be sold on (Mintbase). */
export const MARKET = CONFIG.market;
export const NBTC = CONFIG.nbtc;
export const BTC_CONNECTOR = CONFIG.btcConnector;

/** The Omni BTC connector address that mints nBTC to `recipient` (registered with Near-One's relayer, which verifies the deposit). */
export async function nbtcDepositAddress(recipient) {
  const r = await fetch(`${CONFIG.bridgeApi}/api/v3/utxo/get_user_deposit_address`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chain: "btc", recipient }), signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`bridge API ${r.status}`);
  return (await r.json()).address;
}

export function evmAddress(pubkeyHex) {
  const uncompressed = secp256k1.Point.fromHex(pubkeyHex).toBytes(false); // 65 bytes, 0x04 prefix
  return getAddress("0x" + keccak256(uncompressed.slice(1)).slice(-40));
}

/**
 * ETH a buyer can rely on. Every nonce below `floor` may have a signed tx in the wild,
 * so the balance only counts once the account's on-chain nonce has reached the floor.
 */
export async function evmBalances(address, floor, chainId) {
  const { usdc } = chainOf(chainId);
  const client = await clientOf(chainId);
  const [wei, nonce, usdcUnits] = await Promise.all([
    client.getBalance({ address }),
    // latest, not pending: a signed tx still sitting in the mempool must keep the ETH at risk
    client.getTransactionCount({ address, blockTag: "latest" }),
    client.readContract({ address: usdc, abi: erc20Abi, functionName: "balanceOf", args: [address] }),
  ]);
  // One nonce sequence covers ETH and every token on the chain, so the same floor clears both.
  const clear = nonce >= Number(floor);
  return { wei, nonce, usdc: usdcUnits, safe: clear ? wei : 0n, atRisk: clear ? 0n : wei, usdcSafe: clear ? usdcUnits : 0n, usdcAtRisk: clear ? 0n : usdcUnits };
}

/** ERC-20 transfers need more than 21k gas; `erc20` set means a USDC transfer. */
export async function evmTxParams(address, chainId, erc20) {
  const client = await clientOf(chainId);
  const [nonce, fees] = await Promise.all([
    client.getTransactionCount({ address, blockTag: "pending" }),
    client.estimateFeesPerGas(),
  ]);
  return { chainId: chainOf(chainId).chain.id, nonce, gas: erc20 ? 100_000n : 21000n, maxFeePerGas: fees.maxFeePerGas * 2n, maxPriorityFeePerGas: fees.maxPriorityFeePerGas };
}

/** Unsigned EIP-1559 tx with exactly the fields the contract hashed. With `erc20`, `value` is token units. */
export function evmTx({ chainId = EVM.chain.id, nonce, to, value, gas, maxFeePerGas, maxPriorityFeePerGas, erc20 }) {
  if (erc20) {
    const data = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, value] });
    return { type: "eip1559", chainId, nonce, to: getAddress(erc20), value: 0n, data, gas, maxFeePerGas, maxPriorityFeePerGas };
  }
  return { type: "eip1559", chainId, nonce, to, value, gas, maxFeePerGas, maxPriorityFeePerGas };
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

/** v2 F9: the MPC's answer to `sign_in` as a 65-byte personal_sign signature, checked to recover to the NFT's address. */
export async function signInSignature({ message, address, signature: sig }) {
  if (!sig) throw new Error("the MPC network returned no signature");
  let s = BigInt("0x" + sig.s.scalar), yParity = sig.recovery_id;
  if (s > N / 2n) { s = N - s; yParity ^= 1; }
  const signature = serializeSignature({ r: viemHex(BigInt("0x" + sig.big_r.affine_point.slice(2)), { size: 32 }), s: viemHex(s, { size: 32 }), yParity });
  const from = await recoverMessageAddress({ message, signature });
  if (from.toLowerCase() !== address.toLowerCase()) throw new Error(`signature recovers to ${from}, not ${address}`);
  return signature;
}

export async function broadcastEth(raw, chainId) {
  return (await clientOf(chainId)).sendRawTransaction({ serializedTransaction: raw });
}

// ---------- Solana: the token's Ed25519 MPC key (same path, domain 1) is a Solana address ----------
export const SOL = CONFIG.sol;
/** A Solana signature dies with its blockhash (~150 slots, about a minute); this leaves margin. */
export const SOL_SIGNATURE_TTL_MS = 3 * 60_000;
const solRpc = (method, params = []) => fetch(SOL.rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(15_000) })
  .then((r) => r.json()).then((j) => { if (j.error) throw new Error(`Solana: ${j.error.message}`); return j.result; });

/** Asks the MPC contract which Solana address belongs to this token. */
export async function solAddress(tokenId, contract = CONTRACT) {
  const args = { path: `pusaka-${tokenId}`, predecessor: contract, domain_id: 1 };
  const r = await nearFetch({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: {
    request_type: "call_function", finality: "optimistic", account_id: MPC, method_name: "derived_public_key",
    args_base64: base64.encode(new TextEncoder().encode(JSON.stringify(args))) } }) }).then((x) => x.json());
  if (!r.result?.result) throw new Error("MPC key lookup failed");
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(r.result.result))).replace("ed25519:", "");
}

/**
 * SOL a buyer can rely on. Signatures can't outlive their blockhash and the contract only
 * signs plain transfers (no durable nonce), so a few minutes after the last SOL signature
 * nothing signed can still land.
 */
export async function solBalances(address, history = []) {
  const { value: lamports } = await solRpc("getBalance", [address, { commitment: "confirmed" }]);
  const last = Math.max(0, ...history.filter((h) => h.event.kind === "WithdrawSol").map((h) => Number(h.at_ms)));
  const clear = Date.now() - last > SOL_SIGNATURE_TTL_MS;
  return { lamports: BigInt(lamports), safe: clear ? BigInt(lamports) : 0n, atRisk: clear ? 0n : BigInt(lamports), clearAt: clear ? null : last + SOL_SIGNATURE_TTL_MS };
}

export async function solBlockhash() {
  return (await solRpc("getLatestBlockhash", [{ commitment: "finalized" }])).value.blockhash;
}

/** Checks the MPC signature against the token's key and the message, then builds the wire tx (base64). */
export function finalizeSol(signed) {
  if (!signed.signature) throw new Error("the MPC network returned no signature");
  const raw = signed.signature.signature ?? signed.signature;
  const sig = typeof raw === "string" ? fromHex(raw) : Uint8Array.from(raw);
  const message = base64.decode(signed.message);
  if (!ed25519.verify(sig, message, base58.decode(signed.from))) throw new Error("signature doesn't verify for this Pusaka's Solana key");
  return base64.encode(Uint8Array.from([1, ...sig, ...message]));
}

export async function broadcastSol(b64) {
  return solRpc("sendTransaction", [b64, { encoding: "base64", preflightCommitment: "confirmed" }]);
}

export const isSolAddress = (a) => { try { return base58.decode(a.trim()).length === 32; } catch { return false; } };

// ---------- Prices: real market data, for valuing collateral and listings ----------
// BTC/USD from mempool.space; NEAR and ETH from Rhea (Ref Finance), i.e. NEAR DEX prices.
// NEAR's on-chain oracles (pyth-oracle.near/.testnet, priceoracle.near) were stale when checked.
const WETH_ON_NEAR = "c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2.factory.bridge.near";

export async function prices() {
  // Browsers can't call Rhea's API (no CORS); the app's own /api/prices fetches it server-side.
  if (typeof window !== "undefined" && !globalThis.process?.versions?.node) {
    const r = await fetch("/api/prices");
    if (!r.ok) throw new Error("price sources unavailable");
    return r.json();
  }
  // one retry per primary source; a source that still fails is named, never a bare "fetch failed"
  const get = async (url, name) => {
    for (let i = 0; ; i++) {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return await r.json();
      } catch (e) {
        if (i) throw new Error(`price source ${name} unavailable (${e.message})`);
        await new Promise((ok) => setTimeout(ok, 800));
      }
    }
  };
  const [btc, ref, cg] = await Promise.all([
    get("https://mempool.space/api/v1/prices", "mempool.space").catch((e) => ({ down: e })),
    get("https://api.ref.finance/list-token-price", "Rhea"),
    // independent second source; a lender's LTV guard shouldn't rest on one HTTP API
    fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,near,ethereum&vs_currencies=usd", { signal: AbortSignal.timeout(8000) })
      .then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  const near = Number(ref["wrap.near"]?.price);
  const eth = Number(ref[WETH_ON_NEAR]?.price);
  // mempool.space down: CoinGecko's BTC price stands in, marked as not cross-checked (guards that need two sources still refuse)
  if (btc?.down && !(cg?.bitcoin?.usd && near)) throw btc.down; // no stand-in either: name the source that is down
  if (!btc?.USD && cg?.bitcoin?.usd && near) return { btcUsd: cg.bitcoin.usd, nearUsd: near, ethUsd: eth || cg.ethereum?.usd || null, at: Date.now(), crossChecked: false, source: "CoinGecko (mempool.space unavailable)" };
  if (!btc?.USD || !near) throw new Error("price sources unavailable");
  return crossCheck({ btcUsd: btc.USD, nearUsd: near, ethUsd: eth || null, at: btc.time * 1000 }, cg);
}

export const MAX_PRICE_SPREAD = 0.05;
/** Compare primary prices with CoinGecko's; throws if BTC or NEAR differ by more than 5%. */
export function crossCheck(px, cg) {
  const second = { btcUsd: cg?.bitcoin?.usd, nearUsd: cg?.near?.usd, ethUsd: cg?.ethereum?.usd };
  if (!second.btcUsd || !second.nearUsd) return { ...px, crossChecked: false };
  for (const k of ["btcUsd", "nearUsd", "ethUsd"]) {
    if (!px[k] || !second[k]) continue;
    const spread = Math.abs(px[k] - second[k]) / second[k];
    if (spread > MAX_PRICE_SPREAD) throw new Error(`price sources disagree on ${k}: ${px[k]} vs ${second[k]} (CoinGecko)`);
  }
  return { ...px, crossChecked: true, secondSource: "CoinGecko" };
}

/**
 * What the contract refused in each of these transactions, read from FastNear's archival index:
 * Map(hash → { signer, method, panic, at }) for every hash whose call into the contract panicked.
 * A hash that is missing from the map was not found or did not fail: callers show that, never a refusal.
 */
export async function refusals(hashes, contracts = [CONTRACT]) {
  // FastNear takes at most 20 hashes per request
  const pages = await Promise.all(Array.from({ length: Math.ceil(hashes.length / 20) }, async (_, i) => {
    const r = await fetch(`${CONFIG.txApi}/v0/transactions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tx_hashes: hashes.slice(i * 20, i * 20 + 20) }), signal: AbortSignal.timeout(15_000) });
    if (!r.ok) throw new Error(`FastNear ${r.status}`);
    return (await r.json()).transactions;
  }));
  const out = new Map();
  for (const t of pages.flat()) {
    for (const rc of t.receipts) {
      const err = rc.execution_outcome.outcome.status.Failure?.ActionError?.kind?.FunctionCallError?.ExecutionError;
      if (!err || !contracts.includes(rc.receipt.receiver_id)) continue;
      const a = rc.receipt.receipt?.Action?.actions?.[0];
      out.set(t.transaction.hash, {
        signer: t.transaction.signer_id,
        method: a?.FunctionCall?.method_name ?? a?.Delegate?.delegate_action?.actions?.[0]?.FunctionCall?.method_name,
        panic: err.replace(/^Smart contract panicked: /, "").replace(/^panicked at \S+\n?/, "").trim(),
        at: Math.round(t.execution_outcome.block_timestamp / 1e6),
      });
      break;
    }
  }
  return out;
}

/** Loan economics from contract terms and live prices. */
/**
 * Latest transactions touching the contract, newest first, from FastNear's indexer:
 * [{ hash, at, signer, by, method, ok }]. `by` is the account that signed a relayed (NEP-366)
 * call when a relayer paid for it.
 */
export async function recentActivity(n = 8) {
  const post = (p, body) => fetch(`${CONFIG.txApi}${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) })
    .then((r) => { if (!r.ok) throw new Error(`FastNear ${r.status}`); return r.json(); });
  const { account_txs } = await post("/v0/account", { account_id: CONTRACT });
  const latest = account_txs.slice(0, n);
  const { transactions } = await post("/v0/transactions", { tx_hashes: latest.map((t) => t.transaction_hash) });
  const byHash = new Map(transactions.map((t) => [t.transaction.hash, t.transaction]));
  return latest.map((a) => {
    const tx = byHash.get(a.transaction_hash);
    const act = tx?.actions?.[0] ?? {};
    const inner = act.Delegate?.delegate_action;
    const fc = (inner?.actions?.[0] ?? act).FunctionCall;
    const method = fc?.method_name ?? Object.keys(inner?.actions?.[0] ?? act)[0] ?? "?";
    return {
      hash: a.transaction_hash,
      at: Number(BigInt(a.tx_block_timestamp) / 1_000_000n),
      signer: tx?.signer_id,
      by: inner?.sender_id,
      receiver: inner?.receiver_id ?? tx?.receiver_id,
      method: typeof method === "string" ? method : "?",
      ok: a.is_success,
    };
  });
}

export function loanStats({ principal, repay, duration_ms }, collateralSats, p) {
  const yocto = (y) => Number(BigInt(y) / 10n ** 18n) / 1e6; // NEAR, 6 dp
  const principalUsd = yocto(principal) * p.nearUsd;
  const collateralUsd = (collateralSats / 1e8) * p.btcUsd;
  const days = Number(duration_ms) / 86_400_000;
  const interest = yocto(repay) / yocto(principal) - 1;
  return {
    principalUsd, collateralUsd,
    ltv: collateralUsd ? principalUsd / collateralUsd : Infinity,
    apr: days > 0 ? (interest * 365) / days : 0,
  };
}

/**
 * Token id minted by *this* transaction, read from its NEP-297 nft_mint event. Never infer it
 * from nft_total_supply: a concurrent mint would hand back someone else's token and BTC address.
 */
export function mintedTokenId(outcome, owner) {
  const logs = (outcome?.receipts_outcome ?? []).flatMap((r) => r.outcome.logs ?? []);
  for (const l of logs) {
    if (!l.startsWith("EVENT_JSON:")) continue;
    const e = JSON.parse(l.slice("EVENT_JSON:".length));
    if (e.standard !== "nep171" || e.event !== "nft_mint") continue;
    const d = e.data.find((x) => x.owner_id === owner);
    if (d?.token_ids?.length) return d.token_ids[0];
  }
  throw new Error("mint transaction has no nft_mint event for this account");
}

export const BTC_MIN_CONFIRMATIONS = NETWORK === "mainnet" ? 6 : 1;

/**
 * Free dry run of a deposit proof: asks the light client (as a view call) exactly what the
 * contract will ask. Only submit `prove_deposit` when this is true, so nobody pays for a proof
 * that would fail.
 */
export async function preflightProof(p) {
  const tx = bitcoin.Transaction.fromHex(p.tx_hex);
  const rev = (h) => Uint8Array.from(h.match(/../g).reverse(), (b) => parseInt(b, 16));
  const u64 = (n) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(n), true); return b; };
  const vec = (hs) => { const n = new Uint8Array(4); new DataView(n.buffer).setUint32(0, hs.length, true); return [n, ...hs.map(rev)]; };
  const parts = [rev(tx.getId()), rev(p.block_hash), u64(p.tx_index), ...vec(p.merkle_proof), rev(p.coinbase_txid),
    ...vec(p.coinbase_merkle_proof), u64(BTC_MIN_CONFIRMATIONS)];
  const args = new Uint8Array(parts.reduce((a, x) => a + x.length, 0));
  parts.reduce((o, x) => (args.set(x, o), o + x.length), 0);
  const r = await nearFetch({
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: {
      request_type: "call_function", finality: "optimistic", account_id: BTC_LIGHT_CLIENT,
      method_name: "verify_transaction_inclusion_v2", args_base64: btoa(String.fromCharCode(...args)) } }),
  }).then((x) => x.json());
  return !!r.result?.result && new TextDecoder().decode(new Uint8Array(r.result.result)) === "true";
}

// ---------- NEAR: the same Ed25519 key is the Pusaka's own NEAR implicit account ----------
const nearRpc = (method, params) => nearFetch({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })
  .then((r) => r.json()).then((j) => { if (j.error) throw Object.assign(new Error(j.error.cause?.name ?? j.error.message), { rpc: j.error }); return j.result; });

/** The Pusaka's NEAR account: hex of its Ed25519 MPC key. */
export async function nearAccount(tokenId, contract = CONTRACT) {
  return toHex(base58.decode(await solAddress(tokenId, contract)));
}

/**
 * NEAR a buyer can rely on. Every nonce up to `floor` may have a signed transaction in the wild,
 * so the balance only counts once the account's access-key nonce has reached the floor.
 * An account that doesn't exist yet holds nothing and has no key.
 */
export async function nearBalances(account, floor) {
  const pk = `ed25519:${base58.encode(fromHex(account))}`;
  const [acc, key] = await Promise.all([
    nearRpc("query", { request_type: "view_account", finality: "final", account_id: account }).catch((e) => { if (e.rpc?.cause?.name === "UNKNOWN_ACCOUNT" || /UNKNOWN_ACCOUNT|does not exist/.test(e.message)) return null; throw e; }),
    nearRpc("query", { request_type: "view_access_key", finality: "final", account_id: account, public_key: pk }).catch(() => null),
  ]);
  const yocto = BigInt(acc?.amount ?? 0);
  const nonce = BigInt(key?.nonce ?? 0);
  const clear = nonce >= BigInt(floor);
  return { exists: !!acc, yocto, nonce, publicKey: pk, safe: clear ? yocto : 0n, atRisk: clear ? 0n : yocto };
}

/** Next nonce and a recent block hash for a withdrawal from the Pusaka's NEAR account. */
export async function nearTxParams(account) {
  const b = await nearBalances(account, 0);
  if (!b.exists) throw new Error("this Pusaka's NEAR account is empty; send it some NEAR first");
  const block = await nearRpc("block", { finality: "final" });
  return { nonce: b.nonce + 1n, blockHash: block.header.hash };
}

/** Checks the MPC signature over sha256(tx) for the account's key, then returns the signed tx (base64). */
export async function finalizeNear(signed) {
  if (!signed.signature) throw new Error("the MPC network returned no signature");
  const raw = signed.signature.signature ?? signed.signature;
  const sig = typeof raw === "string" ? fromHex(raw) : Uint8Array.from(raw);
  const tx = base64.decode(signed.transaction);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", tx));
  if (!ed25519.verify(sig, hash, fromHex(signed.account))) throw new Error("signature doesn't verify for this Pusaka's NEAR key");
  return base64.encode(Uint8Array.from([...tx, 0, ...sig]));
}

export async function broadcastNear(b64) {
  const r = await nearRpc("send_tx", { signed_tx_base64: b64, wait_until: "EXECUTED_OPTIMISTIC" });
  if (r.status?.Failure) throw new Error(`NEAR rejected it: ${JSON.stringify(r.status.Failure).slice(0, 200)}`);
  return r.transaction.hash;
}
// ---------- staking: the Pusaka's own NEAR account delegates to validators ----------
/** Pools from the network's official staking-pool factory; the contract accepts no other (POOL_SUFFIX). */
const POOL_DUST = 10n ** 21n;
export const POOL_SUFFIX = NETWORK === "mainnet" ? ".poolv1.near" : TESTNET.uses.staking_pool_suffix;

/** The current validators that are factory pools, with their fee, lowest fee first. */
export async function stakingPools() {
  const v = await nearRpc("validators", [null]);
  const ids = v.current_validators.map((x) => x.account_id).filter((a) => a.endsWith(POOL_SUFFIX));
  const fees = await Promise.all(ids.map((id) => poolView(id, "get_reward_fee_fraction").catch(() => null)));
  return ids.map((id, i) => ({ pool: id, fee: fees[i] ? fees[i].numerator / fees[i].denominator : null }))
    .filter((p) => p.fee !== null).sort((a, b) => a.fee - b.fee);
}

const poolView = async (pool, method, args = {}) => {
  const r = await nearRpc("query", { request_type: "call_function", finality: "final", account_id: pool, method_name: method,
    args_base64: base64.encode(new TextEncoder().encode(JSON.stringify(args))) });
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(r.result)));
};

/** What `account` has at each pool: staked (earning), unstaked (waiting or ready), and whether it can be withdrawn now. */
export async function stakeBalances(account, pools) {
  return Promise.all(pools.map(async (pool) => {
    const [staked, unstaked, ready] = await Promise.all([
      poolView(pool, "get_account_staked_balance", { account_id: account }),
      poolView(pool, "get_account_unstaked_balance", { account_id: account }),
      poolView(pool, "is_account_unstaked_balance_available", { account_id: account }),
    ]);
    // pools leave a few yocto of rounding behind as "unstaked": below 0.001 NEAR it is dust, not something to withdraw
    const u = BigInt(unstaked) >= POOL_DUST ? BigInt(unstaked) : 0n;
    return { pool, staked: BigInt(staked), unstaked: u, withdrawable: ready && u > 0n };
  }));
}

export * from "./ckd.mjs";
export * from "./intents.mjs";

// ---------- verified USDC: deposits NEAR MPC attests (foreign-transaction verification) ----------
const contractView = async (method, args, contractId = CONTRACT) => {
  const r = await (await nearFetch({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query",
    params: { request_type: "call_function", finality: "optimistic", account_id: contractId, method_name: method, args_base64: base64.encode(new TextEncoder().encode(JSON.stringify(args))) } }) })).json();
  if (!r.result?.result) throw new Error(r.error?.cause?.name ?? r.result?.error ?? "view failed");
  return JSON.parse(new TextDecoder().decode(new Uint8Array(r.result.result)));
};
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/**
 * USDC Transfer logs paying a Pusaka that the contract hasn't counted yet, on every chain NEAR MPC
 * verifies (usdc_info lists them), with the prove_usdc_deposit args ready. `finalized` says whether
 * the MPC can read it yet. Scans the last `blocks` blocks (public RPCs cap eth_getLogs ranges).
 */
export async function usdcToProve(tokenId, { blocks = 45_000 } = {}) {
  const [to, info] = await Promise.all([contractView("evm_address", { token_id: String(tokenId) }), contractView("usdc_info", { token_id: String(tokenId) })]);
  if (!to) return [];
  const out = [];
  for (const v of info) {
    const c = EVM_CHAINS.find((x) => x.chain.id === Number(v.chain_id));
    if (!c) continue;
    const rpc = (method, params) => fetch(c.rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(15_000) })
      .then((r) => r.json()).then((j) => { if (j.error) throw new Error(j.error.message); return j.result; });
    const [head, fin] = await Promise.all([rpc("eth_blockNumber", []).then((h) => parseInt(h)), rpc("eth_getBlockByNumber", ["finalized", false]).then((b) => parseInt(b.number))]);
    for (let b = Math.max(0, head - blocks); b <= head; b += 9_000) {
      const logs = await rpc("eth_getLogs", [{ address: v.usdc, topics: [TRANSFER_TOPIC, null, "0x" + to.slice(2).padStart(64, "0")],
        fromBlock: "0x" + b.toString(16), toBlock: "0x" + Math.min(b + 8_999, head).toString(16) }]);
      for (const l of logs) {
        if (BigInt(l.data) < MIN_PROVEN_USDC) continue; // the contract refuses dust; don't pay to try
        if (await contractView("usdc_is_proven", { token_id: String(tokenId), chain_id: String(c.chain.id), tx: l.transactionHash, log_index: String(parseInt(l.logIndex)) })) continue;
        out.push({ chain: c.chain.name, chain_id: c.chain.id, usdc: Number(BigInt(l.data)) / 1e6, finalized: parseInt(l.blockNumber) <= fin, args: {
          token_id: String(tokenId), chain_id: String(c.chain.id), tx_hash: l.transactionHash, log_index: String(parseInt(l.logIndex)),
          transaction_index: String(parseInt(l.transactionIndex)), block_hash: l.blockHash, block_number: String(parseInt(l.blockNumber)), data: l.data, topics: l.topics } });
      }
    }
  }
  return out;
}
/** Storage deposit for one proven USDC deposit (refunded if the MPC doesn't attest it). */
export const PROVE_USDC_DEPOSIT = 2_000_000_000_000_000_000_000n;
/** Same floor as the contract (0.01 USDC). */
export const MIN_PROVEN_USDC = 10_000n;

/**
 * nBTC a buyer can rely on in a Pusaka's NEAR account. A signed ft_transfer (withdraw_nbtc) may be
 * held back and broadcast after a sale, so, like the account's NEAR, it only counts once the
 * access-key nonce has reached the contract's near_nonce_floor.
 */
export async function nbtcBalances(account, floor) {
  const [raw, b] = await Promise.all([contractView("ft_balance_of", { account_id: account }, NBTC).catch(() => "0"), nearBalances(account, floor)]);
  const sats = BigInt(raw ?? 0);
  const clear = b.nonce >= BigInt(floor);
  return { sats, safe: clear ? sats : 0n, atRisk: clear ? 0n : sats };
}
