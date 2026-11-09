// Post-quantum (ML-DSA-65, FIPS 204 / NEP-645) helpers for Pusaka v2's `set_pq_key` and `pq_unlock`.
// The contract verifies with `env::ml_dsa_verify` (pure ML-DSA, empty context, message not pre-hashed).
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import { base64 } from "@scure/base";

/** A key pair from a 32-byte seed (keep the seed: it is the post-quantum key). */
export const pqKeys = (seed) => ml_dsa65.keygen(seed);

/** Exactly what the contract's `pq_message` builds. */
export const pqMessage = (contract, tokenId, owner, nonce) => `pusaka-pq-unlock:${contract}:${tokenId}:${owner}:${nonce}`;

/** Base64 signature for `pq_unlock`. */
export const pqSign = (secretKey, message) => base64.encode(ml_dsa65.sign(new TextEncoder().encode(message), secretKey));

export const pqVerify = (publicKey, message, sigB64) => ml_dsa65.verify(base64.decode(sigB64), new TextEncoder().encode(message), publicKey);
