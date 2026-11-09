// NEAR AI Cloud: private inference in a TEE, checked instead of trusted (https://docs.near.ai/cloud/verification).
// Before a completion: fetch the gateway's and the model's attestation with our own fresh nonce and verify each
// Intel TDX quote (Phala's dcap-qvl, Intel collateral), not in debug mode, report data = signer || our nonce, the
// measured config (MRCONFIGID) and the RTMR3 event log; NVIDIA's NRAS checks the GPU evidence. After it: fetch the
// response signature and require text = model:sha256(request bytes):sha256(response bytes), signed (EIP-191) by the
// verified model's own key. Anything short of that is reported as unverified, never shown as verified.
import { getCollateralAndVerify } from "@phala/dcap-qvl";
import { sha256, sha384 } from "@noble/hashes/sha2.js";
import { recoverMessageAddress } from "viem";

export const NEARAI = "https://cloud-api.near.ai/v1";
export const NEARAI_MODEL = process.env.NEARAI_MODEL ?? "Qwen/Qwen3.8-27B"; // a TEE ("verifiable") model, priced low
const ACCEPTED_TCB = new Set(["UpToDate", "SWHardeningNeeded"]);

const enc = new TextEncoder();
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const unhex = (s) => Uint8Array.from((s.replace(/^0x/, "").match(/../g) ?? []).map((x) => parseInt(x, 16)));
const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const json = (v) => (typeof v === "string" ? JSON.parse(v) : v);
const cat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let i = 0; for (const p of parts) { out.set(p, i); i += p.length; } return out; };

/** RTMR3 from the event log: SHA-384 chain over each imr-3 event's recomputed digest. */
export function replayRtmr3(eventLog) {
  let rtmr = new Uint8Array(48);
  for (const e of json(eventLog)) {
    if (e.imr !== 3) continue;
    const type = new Uint8Array(4); new DataView(type.buffer).setUint32(0, e.event_type, true);
    const digest = sha384(cat(type, enc.encode(":"), enc.encode(e.event), enc.encode(":"), unhex(e.event_payload ?? "")));
    if (e.digest && !eq(unhex(e.digest), digest)) throw new Error(`event ${e.event}: digest mismatch`);
    rtmr = sha384(cat(rtmr, digest));
  }
  return rtmr;
}

/** Every check on one NEAR-operated report (gateway or model). Returns { ok, signer, tcb, checks: [{ ok, what }] }. */
export async function verifyNearReport(report, nonceHex) {
  const checks = [];
  const add = (ok, what) => { checks.push({ ok: !!ok, what }); return ok; };
  let td = null, tcb = null;
  try {
    const v = await getCollateralAndVerify(unhex(report.intel_quote));
    tcb = v.status;
    td = v.report.asTd10() ?? v.report.asTd15()?.base ?? null;
    add(ACCEPTED_TCB.has(tcb), `Intel TDX quote verified against Intel's collateral (TCB ${tcb})`);
  } catch (e) { add(false, `Intel TDX quote verification failed: ${String(e.message ?? e).slice(0, 120)}`); }
  let images = [], bindsSigner = false;
  if (!td) add(false, "the quote is a TDX TD report"); // fail closed: no TD report, no other check can stand
  if (td) {
    add(!(td.tdAttributes[0] & 1), "not a debug-mode TD");
    const id = unhex(report.signing_address);
    add(report.signing_algo === "ecdsa" && id.length === 20, "signer is an ECDSA (Ethereum-style) address");
    const bound = cat(id, new Uint8Array(32 - id.length), unhex(nonceHex));
    bindsSigner = add(eq(td.reportData, bound), "quote's report data = this signer + our fresh nonce");
    add(report.request_nonce?.toLowerCase() === nonceHex, "the report echoes our nonce");
    const compose = json(report.info?.tcb_info)?.app_compose;
    add(typeof compose === "string" && eq(td.mrConfigId, cat(Uint8Array.of(1), sha256(enc.encode(compose)), new Uint8Array(15))),
      "MRCONFIGID = sha256 of the measured app config");
    // Image provenance is our policy to apply (docs.near.ai, image provenance). Reported, not enforced: each image in the
    // measured config should be an immutable @sha256 digest; one that an environment variable can replace at runtime
    // (${VAR:-default}) is listed as a warning. Sigstore provenance of the digests is not checked here.
    const refs = [...String(compose ?? "").matchAll(/image:\s*(\$\{[^}]*\}|[^\s\\"]+)/g)].map((m) => m[1]);
    images = refs.map((ref) => ({ ref, pinned: /^[^$]*@sha256:[0-9a-f]{64}$/.test(ref) }));
    try { add(eq(replayRtmr3(report.event_log), td.rtMr3), "event log replays to the quote's RTMR3"); }
    catch (e) { add(false, `event log: ${e.message}`); }
  }
  const ok = !!td && checks.length >= 7 && checks.every((c) => c.ok);
  // a signer is only returned when the quote itself binds it
  const unpinned = images.filter((i) => !i.pinned).map((i) => i.ref);
  const warnings = unpinned.length ? [`${unpinned.length} of ${images.length} image(s) in the measured config aren't fixed digests: ${unpinned.join(", ").slice(0, 300)}`] : [];
  return { ok, signer: ok && bindsSigner ? report.signing_address?.toLowerCase() : null, tcb, checks, images, warnings };
}

/** NVIDIA's attestation service on the model's GPU evidence (when the report carries any). */
export async function verifyGpu(report, nonceHex) {
  if (!report.nvidia_payload) return { ok: false, what: "no GPU evidence in the report" };
  const payload = json(report.nvidia_payload);
  if (String(payload.nonce).toLowerCase() !== nonceHex) return { ok: false, what: "GPU evidence nonce isn't ours" };
  const r = await fetch("https://nras.attestation.nvidia.com/v3/attest/gpu", {
    method: "POST", headers: { accept: "application/json", "content-type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(30_000),
  });
  const body = await r.json().catch(() => null);
  const jwt = Array.isArray(body) && body[0]?.[0] === "JWT" ? body[0][1] : null;
  const claims = jwt ? JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString()) : null;
  return { ok: claims?.["x-nvidia-overall-att-result"] === true, what: `NVIDIA NRAS: GPU attestation ${claims?.["x-nvidia-overall-att-result"] === true ? "passed" : "not passed"}` };
}

/** Preflight: the gateway's and the model's attestation for a fresh nonce, all verified. No API key needed. */
export async function attest(model = NEARAI_MODEL) {
  const nonce = hex(globalThis.crypto.getRandomValues(new Uint8Array(32)));
  const url = `${NEARAI}/attestation/report?${new URLSearchParams({ model, provider: "near", include_tls_fingerprint: "false", signing_algo: "ecdsa", nonce })}`;
  const r = await fetch(url, { headers: { accept: "application/json", "x-no-aliasing": "true" }, signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`NEAR AI attestation: HTTP ${r.status}`);
  const rep = await r.json();
  const gateway = await verifyNearReport(rep.gateway_attestation, nonce);
  const models = await Promise.all((rep.model_attestations ?? []).map(async (m) => ({ ...(await verifyNearReport(m, nonce)), gpu: await verifyGpu(m, nonce).catch((e) => ({ ok: false, what: `NVIDIA NRAS unreachable: ${e.message}` })) })));
  return { model, nonce, at: new Date().toISOString(), gateway, models };
}

/** The response-signature checks, on their own so they can be tested without a key (api/_nearai.test.mjs). */
export async function checkSignature(sig, { model, reqBytes, resBytes, verifiedSigners }) {
  const expected = `${model}:${hex(sha256(reqBytes))}:${hex(sha256(resBytes))}`;
  const checks = [{ ok: !!sig?.signature, what: sig?.signature ? `signature recorded (${sig.signature_kind ?? "kind not given"})` : "no response signature available" }];
  if (!sig?.signature) return checks;
  const recovered = (await recoverMessageAddress({ message: sig.text, signature: sig.signature }).catch(() => "")).toLowerCase();
  checks.push({ ok: sig.signature_kind === "provider_tee", what: "signed by the model's TEE, not only the gateway" });
  checks.push({ ok: sig.text === expected, what: "signed text = model : sha256(our request bytes) : sha256(the response bytes)" });
  checks.push({ ok: !!recovered && recovered === sig.signing_address?.toLowerCase(), what: "EIP-191 signature recovers to the stated signer" });
  checks.push({ ok: verifiedSigners.filter((s) => s === recovered).length === 1, what: "that signer is exactly one model report verified before the request" });
  return checks;
}

/**
 * A completion whose bytes are bound to the attested model: send the exact request, keep the exact response,
 * then check the gateway's record of the model TEE's signature over both hashes. Needs NEARAI_API_KEY.
 */
export async function verifiedCompletion(messages, { apiKey = process.env.NEARAI_API_KEY, model = NEARAI_MODEL, maxTokens = 600 } = {}) {
  if (!apiKey) throw new Error("NEARAI_API_KEY is not set");
  const pre = await attest(model);
  const verifiedModels = pre.models.filter((m) => m.ok && m.gpu?.ok); // CPU TEE and GPU evidence both
  const reqBytes = enc.encode(JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: 0.2, stream: false, chat_template_kwargs: { enable_thinking: false } }));
  const r = await fetch(`${NEARAI}/chat/completions`, {
    method: "POST", body: reqBytes, signal: AbortSignal.timeout(90_000),
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", accept: "application/json", "accept-encoding": "identity", "x-no-aliasing": "true" },
  });
  const resBytes = new Uint8Array(await r.arrayBuffer());
  if (!r.ok) throw new Error(`NEAR AI completion: HTTP ${r.status} ${new TextDecoder().decode(resBytes).slice(0, 200)}`);
  const completion = JSON.parse(new TextDecoder().decode(resBytes));
  // the signature can take a moment to be recorded
  let sig = null;
  for (let i = 0; i < 5 && !sig?.signature; i++) {
    if (i) await new Promise((ok) => setTimeout(ok, 1500));
    sig = await fetch(`${NEARAI}/signature/${encodeURIComponent(completion.id)}?signing_algo=ecdsa`, { headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" } })
      .then((x) => (x.ok ? x.json() : null)).catch(() => null);
  }
  const checks = await checkSignature(sig, { model, reqBytes, resBytes, verifiedSigners: verifiedModels.map((m) => m.signer) });
  const text = completion.choices?.[0]?.message?.content?.trim() ?? "";
  checks.push({ ok: text.length > 0, what: "the model returned an answer (not only reasoning)" });
  return {
    model, text, usage: completion.usage, id: completion.id,
    verified: pre.gateway.ok && verifiedModels.length > 0 && checks.every((c) => c.ok),
    attestation: pre, signature: sig && { kind: sig.signature_kind, text: sig.text, signature: sig.signature, signer: sig.signing_address },
    checks, request_sha256: hex(sha256(reqBytes)), response_sha256: hex(sha256(resBytes)),
  };
}
