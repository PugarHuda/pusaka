// Withdraw ETH (Sepolia) held by a Pusaka. The same MPC key that holds its BTC signs.
//   node withdraw-eth.mjs <owner.testnet> <token_id> <to 0x…> <value_eth> [--dry]
// --dry: get the MPC signature and verify it, but don't broadcast (works with 0 ETH).
import { parseEther } from "viem";
import {
  account, call, view, evmAddress, evmBalances, evmTxParams, evmTx, finalizeEth, broadcastEth, EVM,
} from "./lib.mjs";

const [ownerId, tokenId = "1", to, valueEth = "0"] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const dry = process.argv.includes("--dry");
const owner = account(ownerId);
const info = await view("token_info", { token_id: tokenId });
const from = evmAddress(info.btc_pubkey);
const floor = await view("eth_nonce_floor", { token_id: tokenId, chain_id: String(EVM.chain.id) });
const bal = await evmBalances(from, floor);
console.log(`Pusaka #${tokenId} on ${EVM.chain.name}: ${from}  balance ${bal.wei} wei, nonce ${bal.nonce}, floor ${floor}`);

const p = await evmTxParams(from);
const tx = evmTx({ ...p, to: to ?? from, value: parseEther(valueEth) });
const t0 = Date.now();
const signed = await call(owner, "withdraw_eth", {
  token_id: tokenId, chain_id: String(tx.chainId), nonce: String(tx.nonce), to: tx.to,
  value_wei: String(tx.value), gas_limit: String(tx.gas),
  max_fee_per_gas: String(tx.maxFeePerGas), max_priority_fee_per_gas: String(tx.maxPriorityFeePerGas),
}, { deposit: 20_000_000_000_000_000_000_000n, tgas: 150 });
const raw = await finalizeEth(tx, signed, from);
console.log(`MPC signed in ${((Date.now() - t0) / 1000).toFixed(1)}s; sighash matches viem; signature recovers to ${from}`);
console.log(`new nonce floor: ${await view("eth_nonce_floor", { token_id: tokenId, chain_id: String(EVM.chain.id) })}`);
if (dry) console.log("dry run: not broadcast");
else console.log(`broadcast: ${EVM.explorer}/tx/${await broadcastEth(raw)}`);
