// Pusaka constants + Bitcoin helpers shared by the scripts (Node) and the web app (browser).
import * as bitcoin from "bitcoinjs-lib";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { mainnet, sepolia } from "viem/chains";

// One switch for everything network-specific. Node: PUSAKA_NETWORK=mainnet; Vite: VITE_NETWORK=mainnet.
const env = (k) => globalThis.process?.env?.[k] ?? import.meta.env?.[`VITE_${k.replace("PUSAKA_", "")}`];
export const NETWORK = env("PUSAKA_NETWORK") ?? "testnet";

const CONFIG = {
  testnet: {
    contract: "pusaka-btc.testnet",
    mpc: "v1.signer-prod.testnet",
    nearRpc: "https://test.rpc.fastnear.com",
    nearExplorer: "https://testnet.near.rocks",
    txApi: "https://tx.test.fastnear.com", // FastNear transactions API (CORS-enabled)
    btc: bitcoin.networks.testnet, // Bitcoin testnet3: the network btc-client-v4.testnet (light client) tracks
    mempool: "https://mempool.space/testnet",
    evm: { chain: sepolia, rpc: "https://ethereum-sepolia-rpc.publicnode.com", explorer: "https://sepolia.etherscan.io" },
    market: "market-v2-beta.mintspace2.testnet", // Mintbase
  },
  mainnet: {
    contract: "pusaka.near", // placeholder until the mainnet account exists; override with PUSAKA_CONTRACT
    mpc: "v1.signer",
    nearRpc: "https://free.rpc.fastnear.com",
    nearExplorer: "https://near.rocks",
    txApi: "https://tx.main.fastnear.com",
    btc: bitcoin.networks.bitcoin,
    mempool: "https://mempool.space",
    evm: { chain: mainnet, rpc: "https://ethereum-rpc.publicnode.com", explorer: "https://etherscan.io" },
    market: "simple.market.mintbase1.near", // Mintbase
  },
}[NETWORK];
if (!CONFIG) throw new Error(`unknown network ${NETWORK}`);

export const CONTRACT = env("PUSAKA_CONTRACT") ?? CONFIG.contract;
export const MPC = CONFIG.mpc;
export const NEAR_RPC = env("PUSAKA_NEAR_RPC") ?? CONFIG.nearRpc;
export const NEAR_EXPLORER = CONFIG.nearExplorer;
export const MEMPOOL = `${CONFIG.mempool}/api`;
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

/**
 * Everything `prove_deposit` needs for output `vout` of `txid`, from any Esplora API.
 * The contract re-derives the txid from `tx_hex` and the light client checks the proofs,
 * so a wrong answer from the API can only make the proof fail, never fake a deposit.
 */
export const BTC_LIGHT_CLIENT = NETWORK === "mainnet" ? "btc-client.bridge.near" : "btc-client-v4.testnet";

/** Height of the last Bitcoin block NEAR's light client has accepted. */
export async function lightClientHeight() {
  const r = await fetch(NEAR_RPC, {
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
  const get = (path, as = "json") => fetch(`${MEMPOOL}${path}`).then((r) => {
    if (!r.ok) throw new Error(`mempool.space answered ${r.status} for ${path}`);
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
  const r = await fetch(`${MEMPOOL}/tx`, { method: "POST", body: txHex });
  const body = await r.text();
  if (!r.ok) throw new Error(`Bitcoin network rejected the transaction: ${body}`);
  return body; // txid
}

// ---------- EVM: the same MPC key also owns one address on every EVM chain ----------
import { createPublicClient, http, keccak256, getAddress, serializeTransaction, recoverAddress, toHex as viemHex } from "viem";
export const EVM = CONFIG.evm;
/** An outside NEP-178/199 market Pusaka can be sold on (Mintbase). */
export const MARKET = CONFIG.market;
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
    // latest, not pending: a signed tx still sitting in the mempool must keep the ETH at risk
    evmClient.getTransactionCount({ address, blockTag: "latest" }),
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
  const [btc, ref] = await Promise.all([
    fetch("https://mempool.space/api/v1/prices").then((r) => r.json()),
    fetch("https://api.ref.finance/list-token-price").then((r) => r.json()),
  ]);
  const near = Number(ref["wrap.near"]?.price);
  const eth = Number(ref[WETH_ON_NEAR]?.price);
  if (!btc?.USD || !near) throw new Error("price sources unavailable");
  return { btcUsd: btc.USD, nearUsd: near, ethUsd: eth || null, at: btc.time * 1000 };
}

/** Loan economics from contract terms and live prices. */
/**
 * Latest transactions touching the contract, newest first, from FastNear's indexer:
 * [{ hash, at, signer, by, method, ok }]. `by` is the account that signed a relayed (NEP-366)
 * call when a relayer paid for it.
 */
export async function recentActivity(n = 8) {
  const post = (p, body) => fetch(`${CONFIG.txApi}${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
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
  const r = await fetch(NEAR_RPC, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: {
      request_type: "call_function", finality: "optimistic", account_id: BTC_LIGHT_CLIENT,
      method_name: "verify_transaction_inclusion_v2", args_base64: btoa(String.fromCharCode(...args)) } }),
  }).then((x) => x.json());
  return !!r.result?.result && new TextDecoder().decode(new Uint8Array(r.result.result)) === "true";
}
