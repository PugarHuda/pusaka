// Live: a Pusaka, with the Bitcoin it holds, sold for USDC through NEAR Intents (testnet).
//   node scripts/intents-nft-sale.mjs <seller> <token_id> <buyer> <usdc>       (keys from .keys/)
// The verifier is NEAR's unmodified `defuse` (v0.4.5, Tidepool's testnet deployment). Seller and buyer each sign a
// NEP-413 `token_diff`: -1 Pusaka +USDC, and +1 Pusaka -USDC. The seller's `nft_transfer_call` deposits the NFT
// and executes both intents in the same transaction (`refund_if_fails`): either the swap settles or the NFT comes
// back. First a mismatched pair (the seller asks one USDC more than the buyer signed) is refused that way.
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import { KeyPair, baseEncode } from "near-api-js";
import { account, callRaw, view, keyFile, CONTRACT, NEAR_EXPLORER } from "./lib.mjs";

const VERIFIER = "verifier.tidepool-sandbox.testnet";
const USDC = "usdc.tidepool-sandbox.testnet";
const [seller, token_id, buyer, usdc] = process.argv.slice(2);
if (!usdc) throw new Error("usage: intents-nft-sale.mjs <seller> <token_id> <buyer> <usdc>");
const price = BigInt(Math.round(Number(usdc) * 1e6)); // USDC has 6 decimals
const NFT = `nep171:${CONTRACT}:${token_id}`, CASH = `nep141:${USDC}`;
const keyOf = (id) => KeyPair.fromString(JSON.parse(fs.readFileSync(keyFile(id), "utf8")).private_key);
const link = (o) => `${NEAR_EXPLORER}/tx/${o.transaction.hash}`;
const tx = (who, receiver, method, args, deposit = 1n, tgas = 100) => callRaw(account(who), method, args, { deposit, tgas, receiver });
const bal = async (id, t) => BigInt(await view("mt_balance_of", { account_id: id, token_id: t }, VERIFIER));

// NEP-413: sha256(borsh(2^31 + 413) ++ borsh({ message, nonce, recipient, callback_url: None }))
function nep413(signer, intents) {
  const message = JSON.stringify({ signer_id: signer, deadline: new Date(Date.now() + 10 * 60_000).toISOString(), intents });
  const nonce = randomBytes(32);
  const str = (s) => { const b = Buffer.from(s); const n = Buffer.alloc(4); n.writeUInt32LE(b.length); return [n, b]; };
  const tag = Buffer.alloc(4); tag.writeUInt32LE(2 ** 31 + 413);
  const hash = createHash("sha256").update(Buffer.concat([tag, ...str(message), nonce, ...str(VERIFIER), Buffer.from([0])])).digest();
  const kp = keyOf(signer);
  return { standard: "nep413", payload: { message, nonce: nonce.toString("base64"), recipient: VERIFIER },
    public_key: kp.getPublicKey().toString(), signature: `ed25519:${baseEncode(kp.sign(hash).signature)}` };
}
const diff = (signer, d) => nep413(signer, [{ intent: "token_diff", diff: Object.fromEntries(Object.entries(d).map(([k, v]) => [k, String(v)])) }]);

// Named accounts sign intents with a key they registered on the verifier.
for (const id of [seller, buyer]) {
  const public_key = keyOf(id).getPublicKey().toString();
  if (!(await view("has_public_key", { account_id: id, public_key }, VERIFIER))) await tx(id, VERIFIER, "add_public_key", { public_key });
}
// The buyer's USDC, deposited into the verifier.
if ((await bal(buyer, CASH)) < price) {
  const o = await tx(buyer, USDC, "ft_transfer_call", { receiver_id: VERIFIER, amount: String(price), msg: "" }, 1n, 100);
  console.log(`buyer deposited ${usdc} USDC into NEAR Intents: ${link(o)}`);
}
const info = await view("token_info", { token_id });
if (info.listing) await tx(seller, CONTRACT, "cancel_listing", { token_id }, 0n);
const sats = info.verified_sats;

const sell = (ask) => tx(seller, CONTRACT, "nft_transfer_call", { receiver_id: VERIFIER, token_id, msg: JSON.stringify({
  receiver_id: seller, refund_if_fails: true,
  execute_intents: [diff(seller, { [NFT]: -1, [CASH]: ask }), diff(buyer, { [NFT]: 1, [CASH]: -price })],
}) }, 1n, 300);

// 1. The seller asks for one USDC more than the buyer signed: the verifier refuses, the NFT comes back.
const bad = await sell(price + 1_000_000n);
const back = (await view("nft_token", { token_id })).owner_id;
if (back !== seller) throw new Error(`mismatched swap: NFT is with ${back}`);
console.log(`refused: the seller asked for more than the buyer signed; Pusaka #${token_id} back with ${seller}: ${link(bad)}`);

// 2. Matching intents: one transaction deposits the NFT and settles the swap.
const cash0 = await bal(seller, CASH);
const ok = await sell(price);
if ((await bal(buyer, NFT)) !== 1n || (await bal(seller, CASH)) - cash0 !== price) throw new Error("swap did not settle");
console.log(`sold: Pusaka #${token_id} (${sats} verified sats) for ${usdc} USDC in NEAR Intents: ${link(ok)}`);

// 3. Out of the verifier: the buyer takes the NFT, the seller the USDC.
const nw = await tx(buyer, VERIFIER, "nft_withdraw", { token: CONTRACT, receiver_id: buyer, token_id }, 1n, 100);
if (!(await view("storage_balance_of", { account_id: seller }, USDC))) await tx(seller, USDC, "storage_deposit", { account_id: seller }, 1_250_000_000_000_000_000_000n);
const fw = await tx(seller, VERIFIER, "ft_withdraw", { token: USDC, receiver_id: seller, amount: String(price) }, 1n, 100);
const after = await view("token_info", { token_id });
if (after.token.owner_id !== buyer || after.verified_sats !== sats) throw new Error("withdraw did not land");
console.log(`buyer withdrew the NFT: ${link(nw)}\nseller withdrew the USDC: ${link(fw)}`);
console.log(`\nOK: ${buyer} holds Pusaka #${token_id} with its ${sats} sats; ${seller} got ${usdc} USDC, settled by NEAR Intents`);
