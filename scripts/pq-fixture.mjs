// Regenerates contract/src/fixtures/pq.json: a real ML-DSA-65 key and unlock signatures for the unit tests.
import fs from "node:fs";
import { base64 } from "@scure/base";
import { pqKeys, pqMessage, pqSign } from "@pusaka/shared/pq";
const { publicKey, secretKey } = pqKeys(new Uint8Array(32).fill(7));
const sig = (n, owner = "alice.testnet") => pqSign(secretKey, pqMessage("pusaka.testnet", "1", owner, n));
const out = { public_key: base64.encode(publicKey), sig1: sig(1), sig2: sig(2), sig1_bob: sig(1, "bob.testnet") };
fs.writeFileSync(new URL("../contract/src/fixtures/pq.json", import.meta.url), JSON.stringify(out, null, 1));
console.log("pk", publicKey.length, "sig", base64.decode(out.sig1).length);
