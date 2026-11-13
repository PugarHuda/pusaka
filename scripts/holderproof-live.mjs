// Live: what a website or exchange does with a Pusaka's off-NEAR signatures (shared/holderproof.mjs, also POST /api/verify
// and the #/verify page). The holder signs in as the NFT (EIP-4361) and proves its Bitcoin address (BIP-322); both verify;
// a tampered text, another site's sign-in, another Pusaka's proof and a holder who no longer holds it are all refused.
//   node scripts/holderproof-live.mjs [holder] [token_id]     (default pusaka-seller.testnet 1, on pusaka-v2.testnet)
// PROOF_OUT=<file> also saves the BIP-322 { message, witness } (the demo video pastes it into #/verify).
// Spends ~0.0001 NEAR of gas; the sign-in keeps the Pusaka unlistable for an hour (V2-10).
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { account, view, signInSignature } from "./lib.mjs";
import { witnessFromMpc } from "../shared/bip322.mjs";
import { verifySignIn, verifyBtcProof } from "../shared/holderproof.mjs";

const [holder = "pusaka-seller.testnet", token_id = "1"] = process.argv.slice(2);
const V2 = "pusaka-v2.testnet";
const tx = async (method, args) => {
  const out = await account(holder).callFunctionRaw({ contractId: V2, methodName: method, args, deposit: 1n, gas: 300_000_000_000_000n });
  return JSON.parse(Buffer.from(out.status.SuccessValue, "base64").toString());
};
const show = (label, r) => console.log(`${r.valid ? "VALID  " : "refused"} ${label}${r.valid ? "" : `: ${r.checks.filter((c) => !c.ok).map((c) => c.what).join("; ")}`}`);

if (!(await view("evm_address", { token_id }, V2))) {
  await account(holder).callFunctionRaw({ contractId: V2, methodName: "evm_key", args: { token_id }, gas: 300_000_000_000_000n });
}
const domain = "exchange.example";
const signed = await tx("sign_in", { token_id, domain, uri: `https://${domain}/login`, chain_id: "1", nonce: randomBytes(8).toString("hex") });
const signature = await signInSignature(signed);
const si = await verifySignIn({ message: signed.message, signature, expectedDomain: domain });
show(`sign-in as Pusaka #${token_id} for ${domain}`, si);
assert.ok(si.valid);
const other = await verifySignIn({ message: signed.message, signature, expectedDomain: "phish.example" });
show("the same sign-in shown to another site", other);
assert.ok(!other.valid);
const forged = await verifySignIn({ message: signed.message.replace(`held by ${holder}`, "held by attacker.testnet"), signature, expectedDomain: domain });
show("the sign-in with the holder's name changed", forged);
assert.ok(!forged.valid);

const b = await tx("sign_btc_message", { token_id, message: `withdrawal whitelist for ${domain}` });
const witness = witnessFromMpc(b);
const bp = await verifyBtcProof({ message: b.message, witness });
show(`BIP-322 proof of ${bp.address}`, bp);
assert.ok(bp.valid);
if (process.env.PROOF_OUT) (await import("node:fs")).writeFileSync(process.env.PROOF_OUT, JSON.stringify({ message: b.message, witness }));
const elsewhere = await verifyBtcProof({ message: b.message.replace(`Pusaka #${token_id} `, `Pusaka #${token_id === "1" ? "2" : "1"} `), witness });
show("the same proof claimed for another Pusaka", elsewhere);
assert.ok(!elsewhere.valid);
const stale = await verifyBtcProof({ message: b.message.replace(`held by ${holder}`, "held by pusaka-buyer.testnet"), witness });
show("a proof naming someone who doesn't hold it", stale);
assert.ok(!stale.valid);
console.log("OK: real signatures verify; tampered, misdirected and misattributed ones are refused");
