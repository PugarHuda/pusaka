// Prove a Pusaka's USDC deposits on Base / Arbitrum through NEAR MPC foreign-transaction verification.
//   node prove-usdc.mjs <payer.testnet> <token_id>
// Finds Circle USDC Transfer logs paying the token's EVM address (shared usdcToProve), waits until
// their block is finalized, then calls prove_usdc_deposit: the contract hashes the log, the MPC
// network reads the chain itself and confirms it, and the deposit counts as verified on NEAR.
import { account, call, view, usdcToProve, PROVE_USDC_DEPOSIT } from "./lib.mjs";

const [payer, tokenId] = process.argv.slice(2);
if (!payer || !tokenId) throw new Error("usage: node prove-usdc.mjs <payer.testnet> <token_id>");
if (!(await view("evm_address", { token_id: tokenId }))) await call(account(payer), "evm_key", { token_id: tokenId }, { tgas: 30 });
let todo = await usdcToProve(tokenId);
console.log(`Pusaka #${tokenId}: ${todo.length} USDC deposit(s) not proven yet`);
while (todo.some((d) => !d.finalized)) {
  console.log("  waiting for the blocks to finalize (the MPC reads finalized blocks only)…");
  await new Promise((r) => setTimeout(r, 20_000));
  todo = await usdcToProve(tokenId);
}
for (const d of todo) {
  const t0 = Date.now();
  const ok = await call(account(payer), "prove_usdc_deposit", d.args, { deposit: PROVE_USDC_DEPOSIT, tgas: 150 });
  console.log(`  ${d.chain} ${d.args.tx_hash} log ${d.args.log_index}: ${d.usdc} USDC, attested by NEAR MPC: ${ok} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}
for (const v of await view("usdc_info", { token_id: tokenId })) {
  console.log(`verified USDC on ${v.chain}: ${Number(v.verified) / 1e6} (proven ${Number(v.proven) / 1e6}, signed out ${Number(v.signed_out) / 1e6})`);
}
