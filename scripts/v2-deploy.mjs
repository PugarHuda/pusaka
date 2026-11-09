// One-time: Pusaka v2 on testnet. Creates the account, deploys and initialises the contract, publishes the
// token-account global contract (by hash), and hands code changes to the DAO (upgrade admin, timelock).
//   PUSAKA_CONTRACT=pusaka-v2.testnet node v2-deploy.mjs <funder1> [funder2 …]   (keys in .keys/; idempotent)
import fs from "node:fs";
import path from "node:path";
import { KeyPair } from "near-api-js";
import { CONTRACT, MPC, account, call, exists, keyFile, saveKey, view, provider } from "./lib.mjs";

const funders = process.argv.slice(2);
if (CONTRACT === "pusaka-btc.testnet") throw new Error("set PUSAKA_CONTRACT to the v2 account");
const DAO = "pusaka-council.sputnikv2.testnet";
const NEAR = (n) => BigInt(Math.round(n * 1000)) * 10n ** 21n;
const balance = async (id) => Number(BigInt((await provider.viewAccount({ accountId: id, blockQuery: { finality: "final" } })).amount) / 10n ** 21n) / 1000;

if (!(await exists(CONTRACT))) {
  const kp = KeyPair.fromRandom("ed25519");
  saveKey(CONTRACT, kp); // before the call, so a timeout can't lose the key
  await call(account(funders[0]), "create_account", { new_account_id: CONTRACT, new_public_key: kp.getPublicKey().toString() },
    { receiver: "testnet", deposit: NEAR(8), tgas: 100 });
  console.log(`+ created ${CONTRACT}`);
}
for (const f of funders.slice(1)) if ((await balance(CONTRACT)) < 14) {
  await account(f).transfer({ receiverId: CONTRACT, amount: NEAR(8) });
  console.log(`+ 8 NEAR from ${f}`);
}
console.log(`${CONTRACT}: ${await balance(CONTRACT)} NEAR`);

const wasm = fs.readFileSync(path.join(import.meta.dirname, "../contract/target/near/pusaka.wasm"));
const me = account(CONTRACT);
const code = await provider.viewContractCode?.({ accountId: CONTRACT }).catch(() => null);
await me.deployContract(wasm);
console.log(`✓ deployed ${wasm.length} bytes (sha256 ${(await import("node:crypto")).createHash("sha256").update(wasm).digest("hex")})`);
try { await view("mpc_contract"); console.log("✓ already initialised"); }
catch { await call(me, "new", { mpc: MPC }); console.log(`✓ initialised, mpc=${MPC}`); }

const ta = await view("token_account_code");
console.log(`token-account: sha256 ${ta.sha256}, ${ta.bytes} bytes, publishing burns ${Number(BigInt(ta.publish_cost_yocto) / 10n ** 21n) / 1000} NEAR`);
if (!process.env.SKIP_PUBLISH) {
  await call(me, "publish_account_code", {}, { deposit: BigInt(ta.publish_cost_yocto), tgas: 300 });
  console.log("✓ token-account published as a global contract (by hash)");
}
const admin = await view("upgrade_status").catch(() => null);
console.log("upgrade:", JSON.stringify(admin));
void code;
