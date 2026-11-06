// Give a Pusaka, with all the Bitcoin it controls, as a link: the contract's built-in NEAR linkdrop (NEP-452 `claim` /
// `create_account_and_claim`). The person who opens the link needs no NEAR account and no wallet: claiming creates one.
//   node gift.mjs create <owner> <token_id>          one-use key; the link is written to .keys/gifts/, never printed
//   node gift.mjs claim <link-file> <new-account>    claim it as a brand-new account (its key saved in .keys/)
//   node gift.mjs claim <link-file> <existing>       or into an account that already exists
//   node gift.mjs cancel <owner> <token_id>          take it back
// (Keypom, the reference NEP-452 contract, sizes key allowances for an older gas price; its 100 TGas claims are
// refused on today's testnet, so Pusaka carries the linkdrop itself: contract/src/gift.rs.)
import fs from "node:fs";
import path from "node:path";
import { Account, KeyPair } from "near-api-js";
import { account, call, view, provider, keyFile, CONTRACT } from "./lib.mjs";

const APP = process.env.PUSAKA_APP ?? "https://pusaka-two.vercel.app";
const GIFTS = path.join(import.meta.dirname, "..", ".keys", "gifts");
const GIFT_DEPOSIT = 170_000_000_000_000_000_000_000n; // 0.17 NEAR (contract's GIFT_DEPOSIT)
const [cmd, a1, a2] = process.argv.slice(2);

if (cmd === "create") {
  const [owner, token_id] = [a1, a2];
  const kp = KeyPair.fromRandom("ed25519");
  await call(account(owner), "gift", { token_id, public_key: kp.getPublicKey().toString() }, { deposit: GIFT_DEPOSIT });
  fs.mkdirSync(GIFTS, { recursive: true });
  const file = path.join(GIFTS, `pusaka-${token_id}.txt`);
  fs.writeFileSync(file, `${APP}/#/gift/${kp.toString()}\n`);
  console.log(`Pusaka #${token_id} is a gift link now: ${JSON.stringify(await view("gift_of", { token_id }))}; the link is in ${file}`);
} else if (cmd === "claim") {
  const secret = fs.readFileSync(a1, "utf8").trim().split("#/gift/")[1];
  const pk = KeyPair.fromString(secret).getPublicKey().toString();
  const gift = await view("gift_for_key", { public_key: pk });
  if (!gift) throw new Error("this link opens no gift (claimed or cancelled)");
  const link = new Account(CONTRACT, provider, secret); // the link's key: a function-call key on the contract account
  const exists = await provider.viewAccount({ accountId: a2, finalityQuery: { finality: "final" } }).then(() => true, () => false);
  let r;
  if (exists) {
    r = await link.callFunctionRaw({ contractId: CONTRACT, methodName: "claim", args: { account_id: a2 }, gas: 100_000_000_000_000n });
  } else {
    const kp = KeyPair.fromRandom("ed25519");
    fs.writeFileSync(keyFile(a2), JSON.stringify({ account_id: a2, private_key: kp.toString() }));
    r = await link.callFunctionRaw({ contractId: CONTRACT, methodName: "create_account_and_claim", args: { new_account_id: a2, new_public_key: kp.getPublicKey().toString() }, gas: 100_000_000_000_000n });
  }
  const owner = (await view("token_info", { token_id: gift.token_id })).token.owner_id;
  console.log(`${exists ? "claimed into" : "created"} ${a2}: tx ${r.transaction.hash}; Pusaka #${gift.token_id} is now held by ${owner}`);
} else if (cmd === "cancel") {
  await call(account(a1), "cancel_gift", { token_id: a2 });
  console.log(`gift on Pusaka #${a2} cancelled`);
} else {
  console.log("usage: node gift.mjs create <owner> <token_id> | claim <link-file> <account> | cancel <owner> <token_id>");
}
