// Live, Pusaka v2 (testnet): the NFT's Bitcoin key proves its address (BIP-322), a renter signs in as the NFT, and a
// Pusaka is listed for native Bitcoin and reserved by a buyer.
//   PUSAKA_CONTRACT=pusaka-v2.testnet node scripts/v2-bitcoin.mjs proof  <holder> <token_id> <stranger>
//   PUSAKA_CONTRACT=pusaka-v2.testnet node scripts/v2-bitcoin.mjs rent   <holder> <token_id> <renter> <stranger>
//   PUSAKA_CONTRACT=pusaka-v2.testnet node scripts/v2-bitcoin.mjs btc-list <seller> <token_id> <price_sats> <pay_to_tb1_address>
//   PUSAKA_CONTRACT=pusaka-v2.testnet node scripts/v2-bitcoin.mjs reserve <buyer> <token_id>
//   PUSAKA_CONTRACT=pusaka-v2.testnet node scripts/v2-bitcoin.mjs payer | pay <token_id> | prove <who> <token_id> <txid> | prove-exercise <who> <token_id> <txid>
// The BIP-322 witness is rebuilt and verified by shared/bip322.mjs, an implementation independent of the contract's
// Rust (both checked against the BIP's test vectors). The Bitcoin payment for a reserved sale is made from any wallet:
// pay the price to the listed address with the printed OP_RETURN, then anyone calls prove_btc_purchase with
// depositProof(txid) (it needs a Bitcoin explorer reachable from where it runs).
import { randomBytes } from "node:crypto";
import { hex } from "@scure/base";
import { witnessFromMpc, verify } from "@pusaka/shared/bip322";
import fs from "node:fs";
import * as bitcoin from "bitcoinjs-lib";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { account, callRaw, view, btcAddress, scriptHex, NEAR_EXPLORER, NET, btcFetch, broadcast, depositProof } from "./lib.mjs";
const PAYER = new URL("../.keys/btc-payer.json", import.meta.url);

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
} else if (step === "payer") {
  // a plain Bitcoin testnet key that pays like any outside wallet (a Pusaka's own withdraw always writes
  // "pusaka:<id>" as its OP_RETURN, so it can't carry a reservation's)
  if (!fs.existsSync(PAYER)) fs.writeFileSync(PAYER, JSON.stringify({ priv: hex.encode(randomBytes(32)) }));
  console.log(`payer address ${payer().address} (key in .keys/, never printed)`);
} else if (step === "pay") {
  const [token_id] = a;
  // a reserved Bitcoin purchase (F12) or a reserved Bitcoin exercise of a call (F16)
  const sale = await view("btc_listing_of", { token_id }, V2), call = await view("call_of", { token_id }, V2);
  const l = sale?.op_return ? sale : call?.op_return ? { price_sats: call.strike_sats, pay_to_script: call.pay_to_script, op_return: call.op_return, reserved_until_ms: call.btc_reserved_until_ms } : null;
  if (!l) throw new Error("not reserved, or the time to pay is over");
  // paying after the reservation's time to pay risks the sats: refuse with a margin for the Bitcoin block
  if (Date.now() > Number(l.reserved_until_ms) - 30 * 60_000) throw new Error("less than 30 minutes left to pay; reserve again later instead");
  const p = payer();
  const utxos = await (await btcFetch(`/address/${p.address}/utxo`)).json(); // unconfirmed is fine: both can confirm in one block
  const total = utxos.reduce((s, u) => s + u.value, 0), price = Number(l.price_sats), fee = 400;
  if (total < price + fee) throw new Error(`payer holds ${total} sats; needs ${price + fee}`);
  const psbt = new bitcoin.Psbt({ network: NET });
  for (const u of utxos) psbt.addInput({ hash: u.txid, index: u.vout, witnessUtxo: { script: p.output, value: BigInt(u.value) } });
  psbt.addOutput({ script: hex.decode(l.pay_to_script), value: BigInt(price) }); // pay_vout 0
  psbt.addOutput({ script: bitcoin.script.compile([bitcoin.opcodes.OP_RETURN, hex.decode(l.op_return)]), value: 0n }); // memo_vout 1
  if (total - price - fee >= 546) psbt.addOutput({ script: p.output, value: BigInt(total - price - fee) });
  psbt.signAllInputs(p.signer).finalizeAllInputs();
  console.log(`paid ${price} sats for #${token_id}, OP_RETURN ${l.op_return}: txid ${await broadcast(psbt.extractTransaction().toHex())}`);
} else if (step === "prove") {
  const [who, token_id, txid] = a;
  const { vout: _vout, ...proof } = await depositProof(txid, 0); // the purchase method takes pay_vout instead
  const o = await tx(who, "prove_btc_purchase", { token_id, ...proof, pay_vout: 0, memo_vout: 1 }, 0n, 300);
  console.log(`proved; #${token_id} now held by ${(await view("nft_token", { token_id }, V2)).owner_id}: ${link(o)}`);
} else if (step === "prove-exercise") {
  const [who, token_id, txid] = a;
  const { vout: _vout, ...proof } = await depositProof(txid, 0); // the purchase method takes pay_vout instead
  const o = await tx(who, "prove_btc_exercise", { token_id, ...proof, pay_vout: 0, memo_vout: 1 }, 0n, 300);
  console.log(`proved; #${token_id} now held by ${(await view("nft_token", { token_id }, V2)).owner_id}: ${link(o)}`);
} else throw new Error("step: proof | rent | btc-list | reserve | payer | pay | prove | prove-exercise");

function payer() {
  const priv = hex.decode(JSON.parse(fs.readFileSync(PAYER, "utf8")).priv);
  const pub = secp256k1.getPublicKey(priv, true);
  const { address, output } = bitcoin.payments.p2wpkh({ pubkey: pub, network: NET });
  const signer = { publicKey: pub, sign: (h) => secp256k1.sign(h, priv, { prehash: false, lowS: true }) };
  return { address, output, signer };
}
