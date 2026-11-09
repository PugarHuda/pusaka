// Live: a file sealed for whoever holds a Pusaka, with the key NEAR MPC derives for its letter (CKD, domain 2).
//   node ckd-file.mjs [token_id=2]      the token must already have an MPC-sealed letter (ckd-letter.mjs makes one)
// 1. The holder asks for the key twice (two one-time keys, two letter_key transactions): both answers verify
//    against the MPC's public key and give the same file key, so a later request opens what an earlier one sealed.
// 2. A file is sealed with one and opened with the other; another token's id, the letter key and a flipped bit fail.
// 3. Anyone but the holder is refused a key: NotOwner.
import assert from "node:assert/strict";
import { getTransactionLastResult } from "near-api-js";
import { ckdAppId, ckdEphemeral, ckdSecret, ckdKey, LETTER_PURPOSE, FILE_PURPOSE, sealFileCkd, openFileCkd } from "@pusaka/shared/ckd";
import { account, callRaw, view, MPC, CONTRACT, NEAR_EXPLORER } from "./lib.mjs";

const ID = process.argv[2] ?? "2";
const token = await view("nft_token", { token_id: ID });
const extra = JSON.parse(token.metadata.extra ?? "{}");
assert.ok(extra.letter_path, `#${ID} has no MPC-sealed letter: run ckd-letter.mjs first`);
const holder = token.owner_id;
const mpcPk = await account(holder).provider.callFunction({ contractId: MPC, method: "public_key", args: { domain_id: 2 } });

async function keys(who) {
  const eph = ckdEphemeral();
  const outcome = await callRaw(account(who), "letter_key", { token_id: ID, app_public_key: eph.appPublicKey }, { deposit: 1n, tgas: 100 });
  const secret = ckdSecret(getTransactionLastResult(outcome), eph.a, ckdAppId(CONTRACT, extra.letter_path), mpcPk); // throws unless it verifies
  console.log(`  ${who}: key for ${extra.letter_path} (${NEAR_EXPLORER}/tx/${outcome.transaction.hash})`);
  return { file: ckdKey(secret, FILE_PURPOSE), letter: ckdKey(secret, LETTER_PURPOSE) };
}

console.log(`1. ${holder} asks NEAR MPC for #${ID}'s key, twice`);
const a = await keys(holder), b = await keys(holder);
assert.deepEqual(a.file, b.file);

const bytes = new TextEncoder().encode(`Recovery notes for whoever holds Pusaka #${ID}. Sealed ${new Date().toISOString()}.\n`.repeat(200));
const box = await sealFileCkd(a.file, ID, { name: "recovery-notes.txt", type: "text/plain", bytes });
const out = await openFileCkd(b.file, ID, box);
assert.equal(out.name, "recovery-notes.txt");
assert.deepEqual(out.bytes, bytes);
await assert.rejects(openFileCkd(b.file, String(Number(ID) + 1), box));
await assert.rejects(openFileCkd(b.letter, ID, box));
const flipped = box.slice(); flipped[50] ^= 1;
await assert.rejects(openFileCkd(b.file, ID, flipped));
console.log(`2. sealed ${bytes.length} bytes into ${box.length}; opened with the second key; another token, the letter key and a flipped bit are refused`);

const other = holder === "pusaka-seller.testnet" ? "pusaka-buyer.testnet" : "pusaka-seller.testnet";
await assert.rejects(keys(other), /NotOwner/);
console.log(`3. ${other} (not the holder) is refused the key: NotOwner`);
