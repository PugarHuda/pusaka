// Live, Pusaka v2 (testnet): the NFT's Bitcoin key proves its address (BIP-322), a renter signs in as the NFT, and a
// Pusaka is listed for native Bitcoin and reserved by a buyer.
//   PUSAKA_CONTRACT=pusaka-v2.testnet node scripts/v2-bitcoin.mjs proof  <holder> <token_id> <stranger>
//   PUSAKA_CONTRACT=pusaka-v2.testnet node scripts/v2-bitcoin.mjs rent   <holder> <token_id> <renter> <stranger>
//   PUSAKA_CONTRACT=pusaka-v2.testnet node scripts/v2-bitcoin.mjs btc-list <seller> <token_id> <price_sats> <pay_to_tb1_address>
//   PUSAKA_CONTRACT=pusaka-v2.testnet node scripts/v2-bitcoin.mjs reserve <buyer> <token_id>
// The BIP-322 witness is rebuilt and verified by shared/bip322.mjs, an implementation independent of the contract's
// Rust (both checked against the BIP's test vectors). The Bitcoin payment for a reserved sale is made from any wallet:
// pay the price to the listed address with the printed OP_RETURN, then anyone calls prove_btc_purchase with
// depositProof(txid) (it needs a Bitcoin explorer reachable from where it runs).
import { randomBytes } from "node:crypto";
import { hex } from "@scure/base";
import { witnessFromMpc, verify } from "@pusaka/shared/bip322";
import { account, callRaw, view, btcAddress, scriptHex, NEAR_EXPLORER } from "./lib.mjs";

const V2 = process.env.PUSAKA_CONTRACT;
if (V2 !== "pusaka-v2.testnet") throw new Error("PUSAKA_CONTRACT=pusaka-v2.testnet");
const [step, ...a] = process.argv.slice(2);
const link = (o) => `${NEAR_EXPLORER}/tx/${o.transaction.hash}`;
const ret = (o) => JSON.parse(Buffer.from(o.status.SuccessValue, "base64").toString());
const tx = (who, method, args, deposit = 0n, tgas = 100) => callRaw(account(who), method, args, { deposit, tgas, receiver: V2 });
async function refused(what, why, f) {
  try { await f(); } catch (e) {
    const m = String(e.message ?? e);
    if (!why.test(m)) throw e;
    return console.log(`refused: ${what}: ${m.match(why)[0]}`);
  }
  throw new Error(`${what} should have been refused`);
}

if (step === "proof") {
  const [holder, token_id, stranger] = a;
  const o = await tx(holder, "sign_btc_message", { token_id, message: "proof of reserves" }, 1n, 300);
  const signed = ret(o);
  const witness = witnessFromMpc(signed);
  const address = btcAddress(signed.pubkey);
  if (!verify(hex.decode(signed.address_pkh), signed.message, witness)) throw new Error("doesn't verify");
  console.log(`address ${address}\nmessage ${signed.message}\nBIP-322 signature (simple) smp${witness}\nverified by shared/bip322.mjs: ${link(o)}`);
  await refused("a stranger proves the address as theirs", /NotOwner/, () => tx(stranger, "sign_btc_message", { token_id, message: "mine" }, 1n, 300));
} else if (step === "rent") {
  const [holder, token_id, renter, stranger] = a;
  const until = Date.now() + 60 * 60_000;
  const s = await tx(holder, "set_user", { token_id, user: renter, expires_ms: String(until) }, 10n ** 22n);
  console.log(`${holder} rented #${token_id} to ${renter} for an hour (sign in only; it can't move the NFT): ${link(s)}`);
  const args = { token_id, domain: "pusaka-two.vercel.app", uri: "https://pusaka-two.vercel.app/", chain_id: "1", nonce: randomBytes(8).toString("hex") };
  const si = await tx(renter, "sign_in", args, 1n, 300);
  console.log(`the renter signed in as the NFT: "${ret(si).message.split("\n")[3]}": ${link(si)}`);
  await refused("a stranger signs in as it", /NotOwner/, () => tx(stranger, "sign_in", args, 1n, 300));
  await refused("the renter lists it for sale", /NotOwner|SignedIn/, () => tx(renter, "list", { token_id, price: "1000000000000000000000000", floor: null, duration_ms: null }));
  const end = await tx(holder, "set_user", { token_id, user: null, expires_ms: "0" });
  console.log(`rental ended: ${link(end)}; user_of = ${JSON.stringify(await view("user_of", { token_id }, V2))}`);
} else if (step === "btc-list") {
  const [seller, token_id, price_sats, payTo] = a;
  const o = await tx(seller, "list_for_btc", { token_id, price_sats, pay_to_script: scriptHex(payTo) }, 10n ** 22n);
  console.log(`#${token_id} listed for ${price_sats} sats, paid on Bitcoin to ${payTo}: ${link(o)}`);
  await refused("the seller withdraws or relists while it's listed for Bitcoin", /Listed/, () => tx(seller, "list", { token_id, price: "1000000000000000000000000", floor: null, duration_ms: null }));
} else if (step === "reserve") {
  const [buyer, token_id] = a;
  const o = await tx(buyer, "reserve_btc_purchase", { token_id }, 10n ** 23n);
  const l = await view("btc_listing_of", { token_id }, V2);
  console.log(`${buyer} reserved #${token_id} until ${new Date(Number(l.reserved_until_ms)).toISOString()}: ${link(o)}`);
  console.log(`pay ${l.price_sats} sats to script ${l.pay_to_script} with OP_RETURN ${l.op_return}`);
  // a payment that pays the seller but carries another reservation's OP_RETURN is refused before any light-client call
  const fake = "02000000" + "01" + "42".repeat(32) + "00000000" + "00" + "ffffffff" + "02"
    + BigInt(l.price_sats).toString(16).padStart(16, "0").match(/../g).reverse().join("") + (l.pay_to_script.length / 2).toString(16).padStart(2, "0") + l.pay_to_script
    + "0000000000000000" + "16" + "6a14" + "00".repeat(20) + "00000000";
  await refused("a Bitcoin payment carrying someone else's OP_RETURN", /OP_RETURN isn't this reservation's/, () => tx(buyer, "prove_btc_purchase",
    { token_id, tx_hex: fake, pay_vout: 0, memo_vout: 1, block_hash: "00".repeat(32), tx_index: "0", merkle_proof: [], coinbase_txid: "00".repeat(32), coinbase_merkle_proof: [] }));
} else throw new Error("step: proof | rent | btc-list | reserve");
