// Live on testnet: Pusaka v2's NFT-owned account (F5), its named alias (F7) and post-quantum unlocks (F6).
//   PUSAKA_CONTRACT=pusaka-v2.testnet node v2-live.mjs <holder> <stranger>      (keys in .keys/)
// Every refusal below is a real failed transaction on chain, printed with its hash.
import assert from "node:assert/strict";
import fs from "node:fs";
import { randomBytes } from "node:crypto";
import { base64 } from "@scure/base";
import { pqKeys, pqSign } from "@pusaka/shared/pq";
import { MINT_DEPOSIT, NEAR_EXPLORER, account, callRaw, view, provider, mintedTokenId, sleep, keyFile } from "./lib.mjs";

const [holder, stranger] = process.argv.slice(2);
const NEAR = (n) => BigInt(Math.round(n * 1e6)) * 10n ** 18n;
const bal = async (id) => provider.viewAccount({ accountId: id, blockQuery: { finality: "final" } }).then((a) => BigInt(a.amount), () => null);
const tx = (o) => `${NEAR_EXPLORER}/tx/${o.transaction.hash}`;
const failed = (o) => JSON.stringify(o.receipts_outcome.map((r) => r.outcome.status)).match(/"(?:ExecutionError|FunctionCallError)":.{0,160}/)?.[0];
async function act(who, method, args, opts = {}) {
  // a refused call throws; its outcome (with the tx hash) rides on the error
  const o = await callRaw(account(who), method, args, { tgas: 300, ...opts })
    .catch((e) => Object.values(e).find((v) => v?.transaction_outcome) ?? Promise.reject(e));
  const err = failed(o);
  console.log(`  ${err ? "✗ refused" : "✓"} ${who.split(".")[0]} ${method} ${tx(o)}${err ? `\n      ${err}` : ""}`);
  return { o, err };
}
const callArgs = (id, alias, to, yocto) => ({ token_id: id, alias, receiver_id: to, method_name: "", args: "", deposit: String(yocto), gas_tgas: 0 });

// mint a v2 Pusaka
const mint = await callRaw(account(holder), "nft_mint", {}, { deposit: MINT_DEPOSIT, tgas: 300 });
const id = mintedTokenId(mint, holder);
console.log(`Pusaka v2 #${id} minted by ${holder}: ${tx(mint)}`);

// F5: its own account, known before it exists
const acct = await view("account_of", { token_id: id });
console.log(`\nF5  #${id}'s account: ${acct} (exists: ${(await bal(acct)) !== null})`);
await act(holder, "open_account", { token_id: id }, { deposit: NEAR(0.01) });
const seen = async (who) => { for (let i = 0; i < 20; i++) { const a = await provider.viewAccount({ accountId: who, blockQuery: { finality: "final" } }).catch(() => null); if (a) return a; await sleep(2000); } throw new Error(`${who} never appeared`); };
const va = await seen(acct);
console.log(`  on chain: code ${JSON.stringify(va.global_contract_hash ?? va.code_hash)}, ${va.storage_usage} bytes, keys: none`);
await account(holder).transfer({ receiverId: acct, amount: NEAR(0.2) });
console.log(`  funded with 0.2 NEAR`);
const before = await bal(stranger);
await act(holder, "account_call", callArgs(id, false, stranger, NEAR(0.05)), { deposit: 1n });
await sleep(3000);
console.log(`  ${stranger} received ${Number((await bal(stranger)) - before) / 1e24} NEAR from the NFT's account`);
const r1 = await act(stranger, "account_call", callArgs(id, false, stranger, NEAR(0.05)), { deposit: 1n });
assert.match(r1.err ?? "", /NotOwner/);

// F7: a name for the same NFT
const alias = await view("alias_of", { token_id: id });
console.log(`\nF7  named alias ${alias}`);
await act(holder, "name_account", { token_id: id }, { deposit: NEAR(0.05) });
console.log(`  on chain: code ${JSON.stringify((await seen(alias)).global_contract_hash)}`);
await account(holder).transfer({ receiverId: alias, amount: NEAR(0.1) });
await act(holder, "account_call", callArgs(id, true, stranger, NEAR(0.01)), { deposit: 1n });

// F6: post-quantum key
const seed = randomBytes(32);
fs.writeFileSync(keyFile(`pq-${holder}-${id}`), JSON.stringify({ ml_dsa65_seed_hex: seed.toString("hex") })); // the holder's PQ secret
const { publicKey, secretKey } = pqKeys(seed);
console.log(`\nF6  ML-DSA-65 key (${publicKey.length} bytes)`);
await act(holder, "set_pq_key", { token_id: id, public_key: base64.encode(publicKey) }, { deposit: NEAR(0.03) });
await sleep(2000);
const r2 = await act(holder, "account_call", callArgs(id, false, stranger, NEAR(0.01)), { deposit: 1n });
assert.match(r2.err ?? "", /PqLocked/);
const k = await view("pq_key_of", { token_id: id });
const bad = await act(holder, "pq_unlock", { token_id: id, nonce: "1", signature: pqSign(pqKeys(randomBytes(32)).secretKey, k.message_for_next_unlock) });
assert.match(bad.err ?? "", /PqBadSignature/);
const ok = await act(holder, "pq_unlock", { token_id: id, nonce: "1", signature: pqSign(secretKey, k.message_for_next_unlock) });
assert.ok(!ok.err);
console.log(`  pq_unlock gas burnt: ${(ok.o.receipts_outcome.reduce((a, r) => a + Number(r.outcome.gas_burnt), 0) / 1e12).toFixed(2)} TGas`);
await act(holder, "account_call", callArgs(id, false, stranger, NEAR(0.01)), { deposit: 1n });
const replay = await act(holder, "pq_unlock", { token_id: id, nonce: "1", signature: pqSign(secretKey, k.message_for_next_unlock) });
assert.match(replay.err ?? "", /nonce must be higher/);

// the NFT changes hands: the account follows it, the old holder's PQ key and control don't
console.log(`\nhandover`);
await act(holder, "nft_transfer", { receiver_id: stranger, token_id: id }, { deposit: 1n });
assert.equal(await view("pq_key_of", { token_id: id }), null);
await act(stranger, "account_call", callArgs(id, false, holder, NEAR(0.01)), { deposit: 1n });
const r3 = await act(holder, "account_call", callArgs(id, false, holder, NEAR(0.01)), { deposit: 1n });
assert.match(r3.err ?? "", /NotOwner/);
console.log(`\n#${id}'s account ${acct} now answers to ${stranger}. History:`);
console.log("  " + (await view("token_info", { token_id: id })).history.map((e) => e.event.kind).join(" → "));
