// Withdraw ETH or USDC held by a Pusaka on any EVM chain it supports. The same MPC key that holds its BTC signs.
//   node withdraw-eth.mjs <owner.testnet> <token_id> <to 0x…> <amount> [--chain=84532] [--usdc] [--dry]
// amount is ETH, or USDC with --usdc. --dry: get the MPC signature and verify it, but don't broadcast.
import { parseEther, parseUnits } from "viem";
import {
  account, call, view, evmAddress, evmBalances, evmTxParams, evmTx, finalizeEth, broadcastEth, EVM_CHAINS,
} from "./lib.mjs";

const flag = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];
const [ownerId, tokenId = "1", to, amount = "0"] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const dry = process.argv.includes("--dry");
const usdc = process.argv.includes("--usdc");
const c = EVM_CHAINS.find((x) => x.chain.id === Number(flag("chain") ?? EVM_CHAINS[0].chain.id));
if (!c) throw new Error(`--chain must be one of ${EVM_CHAINS.map((x) => x.chain.id)}`);
const chainId = c.chain.id;

const owner = account(ownerId);
const info = await view("token_info", { token_id: tokenId });
const from = evmAddress(info.btc_pubkey);
const floor = await view("eth_nonce_floor", { token_id: tokenId, chain_id: String(chainId) });
const bal = await evmBalances(from, floor, chainId);
console.log(`Pusaka #${tokenId} on ${c.chain.name}: ${from}  ${bal.wei} wei, ${bal.usdc} USDC units, nonce ${bal.nonce}, floor ${floor}`);

const erc20 = usdc ? c.usdc : undefined;
const p = await evmTxParams(from, chainId, erc20);
const tx = evmTx({ ...p, erc20, to: to ?? from, value: usdc ? parseUnits(amount, 6) : parseEther(amount) });
const t0 = Date.now();
const signed = await call(owner, "withdraw_eth", {
  token_id: tokenId, chain_id: String(chainId), nonce: String(tx.nonce), to: to ?? from,
  value_wei: String(usdc ? parseUnits(amount, 6) : tx.value), gas_limit: String(tx.gas),
  max_fee_per_gas: String(tx.maxFeePerGas), max_priority_fee_per_gas: String(tx.maxPriorityFeePerGas),
  ...(erc20 && { erc20 }),
}, { deposit: 20_000_000_000_000_000_000_000n, tgas: 150 });
const raw = await finalizeEth(tx, signed, from);
console.log(`MPC signed in ${((Date.now() - t0) / 1000).toFixed(1)}s; sighash matches viem; signature recovers to ${from}`);
console.log(`new nonce floor: ${await view("eth_nonce_floor", { token_id: tokenId, chain_id: String(chainId) })}`);
if (dry) console.log("dry run: not broadcast");
else console.log(`broadcast: ${c.explorer}/tx/${await broadcastEth(raw, chainId)}`);
