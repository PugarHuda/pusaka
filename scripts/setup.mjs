// One-time: create testnet accounts via faucet, deploy + init the contract.
// Usage: node setup.mjs   (idempotent; skips what already exists)
import fs from "node:fs";
import path from "node:path";
import { CONTRACT, MPC, account, exists, faucetAccount, keyFile, view } from "./lib.mjs";

const SELLER = process.env.SELLER ?? "pusaka-seller.testnet";
const BUYER = process.env.BUYER ?? "pusaka-buyer.testnet";

for (const id of [CONTRACT, SELLER, BUYER]) {
  if (fs.existsSync(keyFile(id))) console.log(`✓ ${id} (key on disk)`);
  else if (await exists(id)) throw new Error(`${id} exists but no key in .keys/ — pick another name`);
  else {
    await faucetAccount(id);
    console.log(`+ created ${id} via faucet`);
  }
}

const contract = account(CONTRACT);
const wasm = fs.readFileSync(path.join(import.meta.dirname, "../contract/target/near/pusaka.wasm"));
await contract.deployContract(wasm);
console.log(`✓ deployed ${wasm.length} bytes to ${CONTRACT}`);

try {
  await view("mpc_contract");
  console.log("✓ already initialised");
} catch {
  await contract.callFunction({ contractId: CONTRACT, methodName: "new", args: { mpc: MPC } });
  console.log(`✓ initialised with mpc=${MPC}`);
}
