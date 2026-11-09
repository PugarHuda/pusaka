// NEAR AI Cloud verification: the response-signature checks against a key we control, then the live attestation
// of the gateway and the model (public, no API key): Intel TDX quote, nonce and signer binding, config, RTMR3, GPU.
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import { sha256 } from "@noble/hashes/sha2.js";
import { checkSignature, attest, NEARAI_MODEL } from "./_nearai.mjs";

const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const tee = privateKeyToAccount("0x" + "11".repeat(32)), other = privateKeyToAccount("0x" + "22".repeat(32));
const enc = new TextEncoder(), reqBytes = enc.encode('{"model":"m"}'), resBytes = enc.encode('{"id":"chat-1"}');
const text = `m:${hex(sha256(reqBytes))}:${hex(sha256(resBytes))}`;
const sig = async (who, t = text, kind = "provider_tee") => ({ signature_kind: kind, text: t, signing_address: who.address, signature: await who.signMessage({ message: t }) });
const all = (checks) => checks.every((c) => c.ok);
const ctx = { model: "m", reqBytes, resBytes, verifiedSigners: [tee.address.toLowerCase()] };

assert.ok(all(await checkSignature(await sig(tee), ctx)));
assert.ok(!all(await checkSignature(await sig(other), ctx)));                                         // not the attested model
assert.ok(!all(await checkSignature(await sig(tee, text.replace(/.$/, "0")), ctx)));                  // other bytes
assert.ok(!all(await checkSignature(await sig(tee, text, "gateway"), ctx)));                          // gateway-only signature
assert.ok(!all(await checkSignature({ ...(await sig(tee)), signing_address: other.address }, ctx)));  // claims another signer
assert.ok(!all(await checkSignature(null, ctx)));                                                       // none recorded
assert.ok(!all(await checkSignature(await sig(tee), { ...ctx, verifiedSigners: [tee.address.toLowerCase(), tee.address.toLowerCase()] }))); // ambiguous
console.log("response signatures: accepted only from the one attested model key over our exact bytes");

const { verifyNearReport } = await import("./_nearai.mjs");
const junk = await verifyNearReport({ intel_quote: "00".repeat(100), signing_address: tee.address, signing_algo: "ecdsa", request_nonce: "00".repeat(32) }, "00".repeat(32));
assert.equal(junk.ok, false); assert.equal(junk.signer, null); // fail closed: no verified TD report, no signer
console.log("a quote that doesn't verify yields no signer");

const a = await attest();
for (const [name, r] of [["gateway", a.gateway], ...a.models.map((m, i) => [`model ${i}`, m])]) {
  for (const c of r.checks) console.log(`  ${c.ok ? "✓" : "✗"} ${name}: ${c.what}`);
  assert.ok(r.ok, `${name} attestation failed`);
}
assert.ok(a.models.length > 0, "no model attestation returned");
for (const m of a.models) { console.log(`  ${m.gpu.ok ? "✓" : "✗"} ${m.gpu.what}`); assert.ok(m.gpu.ok); }
for (const w of [a.gateway, ...a.models].flatMap((r) => r.warnings)) console.log(`  ! ${w}`);
console.log(`NEAR AI Cloud ${NEARAI_MODEL}: gateway and ${a.models.length} model report(s) verified for nonce ${a.nonce.slice(0, 12)}…`);
