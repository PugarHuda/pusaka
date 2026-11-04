// Live: a letter sealed with a NEAR MPC confidential key (CKD), no server involved.
//   node ckd-letter.mjs            fresh faucet accounts and a new Pusaka (works from a clean clone)
// 1. The writer asks the contract for a key (letter_key with a write nonce). The contract forwards
//    to the MPC under path letter:<id>:<writer>:<nonce>; the answer is encrypted to a one-time key
//    only this process holds, and verified against the MPC's public key before use.
// 2. The letter is sealed (AES-GCM) here and stored with set_letter.
// 3. The Pusaka is given to the reader, who gets the same key (letter_key, no nonce) and opens it.
// 4. The writer, no longer the owner, is refused any key.
import assert from "node:assert/strict";
import { account, callRaw, freshSetup, view, MPC, CONTRACT, NEAR_EXPLORER,
  ckdAppId, ckdEphemeral, ckdSecret, ckdKey, sealCkd, openCkd, LETTER_PURPOSE } from "./lib.mjs";
import { getTransactionLastResult } from "near-api-js";

const { ids: [writer, reader], tokenId } = await freshSetup(["w", "r"]);
const mpcPk = await account(writer).provider.callFunction({ contractId: MPC, method: "public_key", args: { domain_id: 2 } });

async function letterKey(who, writeNonce) {
  const eph = ckdEphemeral();
  const t0 = Date.now();
  const outcome = await callRaw(account(who), "letter_key", { token_id: tokenId, app_public_key: eph.appPublicKey, ...(writeNonce && { write_nonce: writeNonce }) },
    { deposit: 1n, tgas: 100 });
  const answer = getTransactionLastResult(outcome);
  const extra = JSON.parse((await view("nft_token", { token_id: tokenId })).metadata.extra ?? "{}");
  const path = writeNonce ? `letter:${tokenId}:${who}:${writeNonce}` : extra.letter_path;
  // ckdSecret throws unless the MPC's answer verifies against its domain-2 public key
  const key = ckdKey(ckdSecret(answer, eph.a, ckdAppId(CONTRACT, path), mpcPk), LETTER_PURPOSE);
  console.log(`  ${who} got the key for ${path} in ${((Date.now() - t0) / 1000).toFixed(1)}s (${NEAR_EXPLORER}/tx/${outcome.transaction.hash})`);
  return { key, path };
}

const text = `For whoever holds Pusaka #${tokenId}: only you can read this. Written ${new Date().toISOString()}.`;
console.log("1. writer asks NEAR MPC for a new letter key");
const w = await letterKey(writer, Date.now().toString(36));
const sealed = await sealCkd(w.key, tokenId, text);
await callRaw(account(writer), "set_letter", { token_id: tokenId, sealed, path: w.path }, { deposit: 10_000_000_000_000_000_000_000n });
console.log(`2. sealed on-chain (${sealed.length} chars, no server saw the key)`);

await callRaw(account(writer), "nft_transfer", { receiver_id: reader, token_id: tokenId }, { deposit: 1n });
console.log(`3. #${tokenId} given to ${reader}; it reads the letter with its own key request`);
const r = await letterKey(reader);
assert.equal(r.path, w.path);
assert.equal(await openCkd(r.key, tokenId, sealed), text);
console.log("   opened:", (await openCkd(r.key, tokenId, sealed)).slice(0, 70) + "…");

await assert.rejects(letterKey(writer), /NotOwner/);
console.log("4. the writer, no longer the owner, is refused a key: NotOwner");
