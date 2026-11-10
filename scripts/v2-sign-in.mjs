// Live: sign in as a Pusaka v2 (F9). The NFT's own EVM key, NEAR MPC's secp256k1 key that also holds its Bitcoin,
// signs an EIP-4361 "Sign-In with Ethereum" message naming the current holder (testnet, pusaka-v2.testnet).
//   PUSAKA_CONTRACT=pusaka-v2.testnet node scripts/v2-sign-in.mjs <holder> <token_id> <stranger>
// Checked the way any SIWE site checks it (viem: parse, validate, recover the address); a stranger is refused,
// and so is the holder making the NFT's account register a signing key on the NEAR Intents verifier (V2-9).
import { randomBytes } from "node:crypto";
import { parseSiweMessage, validateSiweMessage } from "viem/siwe";
import { account, callRaw, view, signInSignature, NEAR_EXPLORER } from "./lib.mjs";

const [holder, token_id, stranger] = process.argv.slice(2);
const V2 = process.env.PUSAKA_CONTRACT;
if (V2 !== "pusaka-v2.testnet") throw new Error("PUSAKA_CONTRACT=pusaka-v2.testnet");
const domain = "pusaka-two.vercel.app", nonce = randomBytes(8).toString("hex");
const args = { token_id, domain, uri: `https://${domain}/#/v2/${token_id}`, chain_id: "1", nonce };

const out = await account(holder).callFunctionRaw({ contractId: V2, methodName: "sign_in", args, deposit: 1n, gas: 300_000_000_000_000n });
const signed = JSON.parse(Buffer.from(out.status.SuccessValue, "base64").toString());
const signature = await signInSignature(signed);
const fields = parseSiweMessage(signed.message);
if (!validateSiweMessage({ message: fields, domain, nonce })) throw new Error("not a valid sign-in for this site");
if (fields.address.toLowerCase() !== (await view("evm_address", { token_id }, V2))) throw new Error("not the NFT's address");
console.log(`${signed.message}\n\nsignature ${signature}\nsigned in as ${fields.address}, expires ${fields.expirationTime.toISOString()}: ${NEAR_EXPLORER}/tx/${out.transaction.hash}`);

async function refused(what, who, method, a, deposit, why) {
  try { await callRaw(account(who), method, a, { deposit, tgas: 100, receiver: V2 }); } catch (e) {
    const m = String(e.message ?? e);
    if (!why.test(m)) throw e;
    return console.log(`refused: ${what}: ${m.match(why)[0]}`);
  }
  throw new Error(`${what} should have been refused`);
}
await refused("a stranger signs in as the NFT", stranger, "sign_in", args, 1n, /NotOwner/);
const pk = Buffer.from(JSON.stringify({ public_key: "ed25519:11111111111111111111111111111111" })).toString("base64");
await refused("the holder gives the NFT's account a key on the NEAR Intents verifier", holder, "account_call",
  { token_id, alias: false, receiver_id: "verifier.tidepool-sandbox.testnet", method_name: "add_public_key", args: pk, deposit: "1", gas_tgas: 10 }, 1n, /AccountGrant/);
console.log("OK: signed in as the NFT; both refused on-chain");
