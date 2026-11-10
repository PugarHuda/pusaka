// Live: a Pusaka v2 holds its own NEAR Intents balance, and the balance changes hands with the NFT (testnet).
//   PUSAKA_CONTRACT=pusaka-v2.testnet node scripts/v2-intents-balance.mjs <holder> <token_id> <new_holder> <usdc>
// USDC is deposited into the NEAR Intents verifier for the NFT's own account (`0s…`, no keys, obeys only the NFT
// contract). The NFT is then transferred: the old holder can no longer move that balance, the new one withdraws
// half of it through `account_call`. Nobody can give the NFT's account a signing key on the verifier (V2-9),
// so no one but the current holder can ever move it.
import fs from "node:fs";
import { pqKeys, pqSign } from "@pusaka/shared/pq";
import { account, callRaw, view, exists, keyFile, NEAR_EXPLORER } from "./lib.mjs";

const VERIFIER = "verifier.tidepool-sandbox.testnet", USDC = "usdc.tidepool-sandbox.testnet", CASH = `nep141:${USDC}`;
const [holder, token_id, next, usdc] = process.argv.slice(2);
const V2 = process.env.PUSAKA_CONTRACT;
if (V2 !== "pusaka-v2.testnet" || !usdc) throw new Error("PUSAKA_CONTRACT=pusaka-v2.testnet node v2-intents-balance.mjs <holder> <token_id> <new_holder> <usdc>");
const amount = BigInt(Math.round(Number(usdc) * 1e6));
const link = (o) => `${NEAR_EXPLORER}/tx/${o.transaction.hash}`;
const tx = (who, receiver, method, args, deposit = 1n, tgas = 100) => callRaw(account(who), method, args, { deposit, tgas, receiver });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64");
// the holder makes the NFT's account call the verifier
const viaNft = (who, method, args) => tx(who, V2, "account_call",
  { token_id, alias: false, receiver_id: VERIFIER, method_name: method, args: b64(args), deposit: "1", gas_tgas: 60 }, 1n, 150);

const acct = await view("account_of", { token_id }, V2);
if (!(await exists(acct))) await tx(holder, V2, "open_account", { token_id }, 10n ** 22n);
const before = BigInt(await view("mt_balance_of", { account_id: acct, token_id: CASH }, VERIFIER));
const dep = await tx(holder, USDC, "ft_transfer_call", { receiver_id: VERIFIER, amount: String(amount), msg: acct });
const held = BigInt(await view("mt_balance_of", { account_id: acct, token_id: CASH }, VERIFIER));
if (held - before !== amount) throw new Error("deposit did not land");
console.log(`Pusaka v2 #${token_id}'s account ${acct} holds ${Number(held) / 1e6} USDC in NEAR Intents: ${link(dep)}`);

// a post-quantum-locked Pusaka needs a fresh unlock signed with its ML-DSA-65 key (.keys/pq-<holder>-<id>.json)
const pq = await view("pq_key_of", { token_id }, V2);
if (pq && !pq.open) {
  const seed = JSON.parse(fs.readFileSync(keyFile(`pq-${holder}-${token_id}`), "utf8")).ml_dsa65_seed_hex;
  const signature = pqSign(pqKeys(Buffer.from(seed, "hex")).secretKey, pq.message_for_next_unlock);
  await tx(holder, V2, "pq_unlock", { token_id, nonce: String(Number(pq.nonce) + 1), signature }, 0n, 100);
}
const moved = await tx(holder, V2, "nft_transfer", { receiver_id: next, token_id });
console.log(`${holder} transferred the NFT to ${next}: ${link(moved)}`);
try {
  await viaNft(holder, "mt_transfer", { receiver_id: holder, token_id: CASH, amount: String(held) });
  throw new Error("the old holder moved the balance");
} catch (e) {
  if (!/NotOwner/.test(String(e.message ?? e))) throw e;
  console.log("refused: the old holder moves the NFT's Intents balance: NotOwner");
}

if (!(await view("storage_balance_of", { account_id: next }, USDC))) await tx(next, USDC, "storage_deposit", { account_id: next }, 1_250_000_000_000_000_000_000n);
const wallet0 = BigInt(await view("ft_balance_of", { account_id: next }, USDC));
const half = held / 2n;
const w = await viaNft(next, "ft_withdraw", { token: USDC, receiver_id: next, amount: String(half) });
const got = BigInt(await view("ft_balance_of", { account_id: next }, USDC)) - wallet0;
if (got !== half) throw new Error(`withdrew ${got}, expected ${half}`);
console.log(`${next}, the new holder, withdrew ${Number(half) / 1e6} USDC of it: ${link(w)}`);
console.log(`\nOK: ${Number(held - half) / 1e6} USDC stays in NEAR Intents under Pusaka v2 #${token_id}, movable only by its holder`);
