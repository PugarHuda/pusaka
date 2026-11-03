// Withdraw SOL held by a Pusaka. Its Ed25519 MPC key (domain 1) is a Solana address.
//   node withdraw-sol.mjs <owner.testnet> <token_id> <to base58> <sol> [--dry]
// --dry: get the MPC signature and verify it, but don't broadcast.
import { account, call, solAddress, solBalances, solBlockhash, finalizeSol, broadcastSol, view, SOL } from "./lib.mjs";

const [ownerId, tokenId = "1", to, sol = "0.01"] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const dry = process.argv.includes("--dry");
const from = await solAddress(tokenId);
const info = await view("token_info", { token_id: tokenId });
const bal = await solBalances(from, info.history);
console.log(`Pusaka #${tokenId} on ${SOL.name}: ${from}  ${bal.lamports} lamports (safe ${bal.safe})`);

const lamports = BigInt(Math.round(Number(sol) * 1e9));
const t0 = Date.now();
const signed = await call(account(ownerId), "withdraw_sol", {
  token_id: tokenId, to, lamports: String(lamports), recent_blockhash: await solBlockhash(),
}, { deposit: 1n, tgas: 300 });
if (signed.from !== from) throw new Error(`contract signed for ${signed.from}, expected ${from}`);
const tx = finalizeSol(signed);
console.log(`MPC signed in ${((Date.now() - t0) / 1000).toFixed(1)}s; Ed25519 signature verifies for ${from}`);
if (dry) console.log("dry run: not broadcast");
else console.log(`broadcast: ${SOL.explorer(`tx/${await broadcastSol(tx)}`)}`);
