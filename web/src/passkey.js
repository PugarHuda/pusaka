// A NEAR key from a passkey, for people with no wallet: the WebAuthn PRF extension gives the same 32 secret bytes every
// time this passkey is used on this site; they are the ed25519 seed of a NEAR implicit account (hex of the public key).
// The key is re-derived for every signature and never stored; only the (public) account id is remembered.
// It signs NEP-366 delegate actions only, so the relayer pays the gas, within its allowlist (api/_relayer.mjs).
import { Account, KeyPairEd25519, KeyPairSigner, actions, baseEncode, encodeSignedDelegate, teraToGas } from "near-api-js";
import { ed25519 } from "@noble/curves/ed25519.js";
import { CONTRACT } from "@pusaka/shared";

const SALT = new TextEncoder().encode("pusaka/near-ed25519/v1".padEnd(32, "\0")); // ponytail: fixed salt; bump v1 to rotate every key
const SAVED = "pusaka-passkey";
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/** PRF output (32 bytes) -> { keyPair, accountId }. Pure; web/src/passkey.test.mjs pins it. */
export function keyFromPrf(prf) {
  const seed = new Uint8Array(prf);
  if (seed.length !== 32) throw new Error("the passkey's PRF output must be 32 bytes");
  const pub = ed25519.getPublicKey(seed);
  return { keyPair: new KeyPairEd25519(baseEncode(new Uint8Array([...seed, ...pub]))), accountId: hex(pub) };
}

export const passkeyId = () => { try { return localStorage.getItem(SAVED) || ""; } catch { return ""; } };
const remember = (id) => { try { if (id) localStorage.setItem(SAVED, id); else localStorage.removeItem(SAVED); } catch { /* private mode */ } dispatchEvent(new Event(SAVED)); };
export const forgetPasskey = () => remember("");
export const onPasskey = (fn) => { addEventListener(SAVED, fn); return () => removeEventListener(SAVED, fn); };

const noPrf = () => new Error("This browser or passkey can't derive a key (no WebAuthn PRF support). Use a NEAR wallet instead, or try Chrome/Safari with a recent passkey provider.");
const challenge = () => crypto.getRandomValues(new Uint8Array(32));

/** One passkey assertion with PRF -> the key. */
async function derive() {
  const cred = await navigator.credentials.get({ publicKey: { challenge: challenge(), userVerification: "required", extensions: { prf: { eval: { first: SALT } } } } });
  const prf = cred?.getClientExtensionResults().prf?.results?.first;
  if (!prf) throw noPrf();
  return keyFromPrf(prf);
}

/** Sign in with an existing passkey, or make one if there is none. Returns the implicit account id. */
export async function signInWithPasskey() {
  if (!window.PublicKeyCredential) throw noPrf();
  const caps = await PublicKeyCredential.getClientCapabilities?.().catch(() => null);
  if (caps && caps["extension:prf"] === false) throw noPrf();
  try { const { accountId } = await derive(); remember(accountId); return accountId; } catch (e) {
    if (e.name !== "NotAllowedError" || passkeyId()) throw e; // a remembered account's passkey must not be replaced silently
  }
  const cred = await navigator.credentials.create({ publicKey: {
    rp: { name: "Pusaka" },
    user: { id: challenge().slice(0, 16), name: `Pusaka ${new Date().toISOString().slice(0, 10)}`, displayName: "Pusaka (NEAR key)" },
    challenge: challenge(),
    pubKeyCredParams: [{ type: "public-key", alg: -8 }, { type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
    extensions: { prf: { eval: { first: SALT } } },
  } });
  const ext = cred.getClientExtensionResults().prf;
  if (!ext?.enabled && !ext?.results) throw noPrf();
  const { accountId } = ext.results?.first ? keyFromPrf(ext.results.first) : await derive(); // most only evaluate PRF on get
  remember(accountId);
  return accountId;
}

/** The passkey's NEAR account, able to sign (one passkey prompt). */
export async function passkeyAccount(provider) {
  const { keyPair, accountId } = await derive();
  return new Account(accountId, provider, new KeyPairSigner(keyPair));
}

/** NEP-366: sign `method(args)` on Pusaka with the passkey and have the relayer pay the gas. */
export async function passkeyGasless(provider, method, args) {
  const id = passkeyId();
  if (!(await provider.viewAccount({ accountId: id, finalityQuery: { finality: "final" } }).then(() => true, () => false))) {
    throw new Error(`Your passkey account ${id} isn't on NEAR yet: send it any amount of NEAR to open it, then try again.`);
  }
  const acct = await passkeyAccount(provider);
  if (acct.accountId !== id) throw new Error(`That passkey opens ${acct.accountId}, not ${id}. Sign out and use the passkey you want.`);
  const { signedDelegate } = await acct.createSignedMetaTransaction({ receiverId: CONTRACT, actions: [actions.functionCall(method, args, teraToGas(50), 0n)] });
  const r = await fetch("/api/relay", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ signed_delegate: btoa(String.fromCharCode(...encodeSignedDelegate(signedDelegate))) }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error ?? `relayer answered ${r.status}`); // no wallet to fall back to, even on 429
  return { gasless: true, tx: body.tx };
}
