// Mainnet readiness, free: the exact proof Pusaka sends to NEAR's Bitcoin light client, built for a real Bitcoin
// *mainnet* transaction and checked by the mainnet light client (btc-client.bridge.near) as a view call. No wallet,
// no NEAR spent. Then the same proof with one merkle hash flipped, which the light client must reject.
//   node scripts/mainnet-proof.mjs [txid]       (default: a transaction 6 blocks below the light client's tip)
// The bytes are built exactly as contract/src/btc.rs `proof_args_borsh` builds them (shared/lcproof.mjs).
import assert from "node:assert/strict";
import { mainnetProofCheck, MAINNET_LIGHT_CLIENT } from "@pusaka/shared/lcproof";

let r;
try { r = await mainnetProofCheck({ esplora: process.env.BTC_MAINNET_ESPLORA, txid: process.argv[2] }); }
catch (e) { console.log(`⚠ couldn't run the check from this network: ${e.message}`); process.exit(2); }
console.log(`NEAR mainnet light client ${MAINNET_LIGHT_CLIENT} is at Bitcoin block ${r.lc}`);
console.log(`Bitcoin mainnet tx ${r.txid} in block ${r.height} (${r.lc - r.height + 1} confirmations), ${r.steps}-step merkle proof`);
console.log(`verify_transaction_inclusion_v2 -> ${r.accepted}${r.error ? ` (${r.error})` : ""}`);
console.log(`same proof with one merkle hash changed -> ${r.forgedAccepted}`);
assert.ok(r.accepted, "the light client should accept the real proof");
assert.ok(!r.forgedAccepted, "a forged proof must not pass");
console.log("✓ Pusaka's proof format is accepted by NEAR's mainnet Bitcoin light client, and a forged one is not");
