// Verifies what a Pusaka signs for outside NEAR, the way a website or exchange would: a Sign-In with Ethereum message
// (F9) or a BIP-322 proof of its Bitcoin address (F10). Each answer is { valid, ...facts, checks: [{ ok, what, detail }] }:
// the signature is right, the address is the one NEAR's MPC holds for that Pusaka, and the holder it names still holds it.
import { recoverMessageAddress } from "viem";
import { hex } from "@scure/base";
import { ORIGINAL, SIBLINGS, btcAddress } from "./btc.mjs";
import { hash160, verify as bip322Verify } from "./bip322.mjs";
import { viewFinal } from "./audit.mjs";

const CONTRACTS = [ORIGINAL, ...SIBLINGS];
const result = (facts, checks) => ({ valid: checks.length > 0 && checks.every((c) => c.ok), ...facts, checks });
const owner = async (contract, token_id) => (await viewFinal("nft_token", { token_id }, contract))?.owner_id ?? null;

const SIWE = /^(\S+) wants you to sign in with your Ethereum account:\n(0x[0-9a-fA-F]{40})\n\nSign in as Pusaka #(\d{1,9}) \(([a-z0-9._-]+)\), held by ([a-z0-9._-]+?)(?:, used by ([a-z0-9._-]+) \(rented\))?\.\n/;

/** `expectedDomain`: the verifying site's own host; a sign-in made for another site is refused. */
export async function verifySignIn({ message, signature, expectedDomain, now = Date.now() }) {
  const m = typeof message === "string" && message.match(SIWE);
  if (!m) return result({}, [{ ok: false, what: "it is a Pusaka sign-in message (EIP-4361)", detail: "the text doesn't match what the contract writes" }]);
  const [, domain, address, token_id, contract, holder, user] = m;
  const facts = { kind: "sign-in", domain, address, token_id, contract, holder, user: user ?? null };
  if (!CONTRACTS.includes(contract)) return result(facts, [{ ok: false, what: "it names a Pusaka contract", detail: `${contract} is not one of ${CONTRACTS.join(", ")}` }]);
  const checks = [];
  const recovered = await recoverMessageAddress({ message, signature }).catch(() => null);
  checks.push({ ok: recovered?.toLowerCase() === address.toLowerCase(), what: "the signature is by the address in the message", detail: `recovered ${recovered ?? "nothing"}` });
  const [onchain, holderNow, rental] = await Promise.all([
    viewFinal("evm_address", { token_id }, contract).catch(() => null),
    owner(contract, token_id),
    user ? viewFinal("user_of", { token_id }, contract).catch(() => null) : null,
  ]);
  checks.push({ ok: onchain?.toLowerCase() === address.toLowerCase(), what: `the address is Pusaka #${token_id}'s own (NEAR MPC key, recorded by ${contract})`, detail: `on chain: ${onchain ?? "none"}` });
  checks.push({ ok: holderNow === holder, what: "the holder it names still holds the Pusaka", detail: `holder now: ${holderNow ?? "nobody"}` });
  if (user) checks.push({ ok: rental?.user === user, what: "the renter it names still rents it", detail: `renter now: ${rental?.user ?? "nobody"}` });
  const exp = message.match(/\nExpiration Time: (\S+)$/m)?.[1];
  checks.push({ ok: !!exp && Date.parse(exp) > now, what: "it hasn't expired", detail: `expires ${exp ?? "never (refused)"}` });
  if (expectedDomain) checks.push({ ok: domain === expectedDomain, what: `it was made for ${expectedDomain}`, detail: `made for ${domain}` });
  return result(facts, checks);
}

const BIP = /^Pusaka #(\d{1,9}) \(([a-z0-9._-]+)\), held by ([a-z0-9._-]+) at NEAR block (\d+): /;

/** A BIP-322 "simple" proof from `sign_btc_message`; `witness` base64. */
export async function verifyBtcProof({ message, witness }) {
  const m = typeof message === "string" && message.match(BIP);
  if (!m) return result({}, [{ ok: false, what: "it is a Pusaka BIP-322 message", detail: "the text doesn't start the way the contract writes it" }]);
  const [, token_id, contract, holder, block] = m;
  const facts = { kind: "bip322", token_id, contract, holder, near_block: Number(block) };
  if (!CONTRACTS.includes(contract)) return result(facts, [{ ok: false, what: "it names a Pusaka contract", detail: `${contract} is not one of ${CONTRACTS.join(", ")}` }]);
  const [info, holderNow] = await Promise.all([viewFinal("token_info", { token_id }, contract).catch(() => null), owner(contract, token_id)]);
  if (!info?.btc_pubkey) return result(facts, [{ ok: false, what: `Pusaka #${token_id} exists with a Bitcoin key`, detail: "no such token or key" }]);
  const address = btcAddress(info.btc_pubkey);
  const pkh = hash160(hex.decode(info.btc_pubkey));
  return result({ ...facts, address }, [
    { ok: bip322Verify(pkh, message, String(witness ?? "")), what: `the BIP-322 signature is by Pusaka #${token_id}'s Bitcoin address`, detail: address },
    { ok: holderNow === holder, what: "the holder it names still holds the Pusaka", detail: `holder now: ${holderNow ?? "nobody"}` },
  ]);
}
