// Send nBTC (Omni Bridge NEP-141) held by a Pusaka's own NEAR account.
//   node withdraw-nbtc.mjs <owner.testnet> <token_id> <receiver.testnet> <sats> [--dry]
// The contract builds one ft_transfer on the nBTC contract (1 yoctoNEAR) from the Pusaka's implicit
// account and the MPC signs it with the token's Ed25519 key; gas comes from that account's NEAR.
// How nBTC gets there: withdraw the Pusaka's BTC to the Omni BTC connector's deposit address for
// its NEAR account (POST testnet.api.bridge.nearone.org/api/v3/utxo/get_user_deposit_address);
// Near-One's relayer verifies it through the same Bitcoin light client and mints nBTC.
import { account, call, view, nearAccount, nearTxParams, finalizeNear, broadcastNear, provider, NEAR_EXPLORER, NBTC } from "./lib.mjs";

const [ownerId, tokenId, receiver, sats] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!sats) throw new Error("usage: node withdraw-nbtc.mjs <owner.testnet> <token_id> <receiver.testnet> <sats> [--dry]");
const acct = await nearAccount(tokenId);
const bal = (who) => provider.callFunction({ contractId: NBTC, method: "ft_balance_of", args: { account_id: who } });
console.log(`Pusaka #${tokenId}'s NEAR account ${acct}: ${await bal(acct)} nBTC sats`);
// NEP-145: the receiver needs nBTC storage, or ft_transfer fails
if (!(await provider.callFunction({ contractId: NBTC, method: "storage_balance_of", args: { account_id: receiver } }))) {
  await call(account(ownerId), "storage_deposit", { account_id: receiver, registration_only: true }, { deposit: 1_250_000_000_000_000_000_000n, receiver: NBTC });
  console.log(`registered ${receiver} with ${NBTC}`);
}
const { nonce, blockHash } = await nearTxParams(acct);
const t0 = Date.now();
const signed = await call(account(ownerId), "withdraw_nbtc", { token_id: tokenId, receiver_id: receiver, sats: String(sats), nonce: String(nonce), block_hash: blockHash },
  { deposit: 10_000_000_000_000_000_000_000n, tgas: 300 });
if (signed.account !== acct) throw new Error(`contract signed for ${signed.account}, expected ${acct}`);
const tx = await finalizeNear(signed);
console.log(`MPC signed in ${((Date.now() - t0) / 1000).toFixed(1)}s; Ed25519 signature verifies for ${acct}`);
if (process.argv.includes("--dry")) process.exit(0);
console.log(`broadcast: ${NEAR_EXPLORER}/tx/${await broadcastNear(tx)}`);
await new Promise((r) => setTimeout(r, 3000));
console.log(`now: ${await bal(acct)} nBTC sats in the Pusaka, ${await bal(receiver)} with ${receiver}; floor ${await view("near_nonce_floor", { token_id: tokenId })}`);
