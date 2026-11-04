// Deploy the agent to Phala on a dstack image the Shade CLI doesn't know yet, then approve the
// measurements the running TEE actually reports.
//   node shade/deploy-tee.mjs            deploy a new CVM, wait for its attestation, approve it
//   node shade/deploy-tee.mjs <cvm_id>   only (re)approve the measurements of an existing CVM
// Why: Shade CLI 2.4.0 ships measurement tables for dstack 0.5.7/0.5.8 only, and Phala disabled both
// images (Nov 2026; 0.5.12 and 0.6.1 remain). The app-compose hash is still computed locally from
// docker-compose.yaml and must match the one in the TEE's event log; only the OS/firmware RTMRs are
// taken from the quote. Everything else (shade deploy for contract, PPIDs) is the stock CLI.
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Account, JsonRpcProvider } from "near-api-js";

const DSTACK = "0.5.12";
const here = path.dirname(fileURLToPath(import.meta.url));
process.chdir(here);
const cli = path.join(execSync("npm root -g").toString().trim(), "@neardefi/shade-agent-cli/dist/src/utils");
const load = (f) => import(pathToFileURL(path.join(cli, f)).href);
const { deployToPhala, createClient } = await load("phala-deploy.js");
const { calculateAppComposeHash } = await load("measurements.js");
const { getPhalaKey, getNearCredentials } = await load("keystore.js");

const cfg = { compose: "./docker-compose.yaml", env: "./.env", instanceType: "tdx.small", publicLogs: true, publicSysinfo: true };
const apiKey = await getPhalaKey();
const phala = createClient({ apiKey });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let cvmId = process.argv[2];
if (!cvmId) {
  const allowed = [...fs.readFileSync(cfg.compose, "utf8").matchAll(/\$\{(\w+)\}/g)].map((m) => m[1]);
  const r = await deployToPhala({ appName: "pusaka-agent", apiKey, composePath: cfg.compose, envFilePath: cfg.env,
    allowedEnvKeys: allowed, dstackVersion: DSTACK, instanceType: cfg.instanceType, publicLogs: cfg.publicLogs, publicSysinfo: cfg.publicSysinfo });
  cvmId = r.vm_uuid;
  console.log("CVM", cvmId, r.dashboard_url ?? "");
}

// Wait for the booted TEE to publish its quote + event log.
let att;
for (let i = 0; i < 60; i++) {
  att = await phala.get(`/cvms/${cvmId}/attestation`).catch((e) => ({ error: e.message }));
  if (att?.app_certificates?.length || att?.tcb_info) break;
  await sleep(10_000);
}
const tcb = typeof att.tcb_info === "string" ? JSON.parse(att.tcb_info) : att.tcb_info ?? att.app_certificates?.[0]?.quote?.tcb_info;
if (!tcb?.mrtd) { console.log("no tcb_info yet:", JSON.stringify(att).slice(0, 400)); process.exit(1); }
const ev = (name) => tcb.event_log?.find((e) => e.event === name);
const composeHash = calculateAppComposeHash(cfg.compose, { publicLogs: cfg.publicLogs, publicSysinfo: cfg.publicSysinfo });
const reported = ev("compose-hash")?.event_payload;
if (reported && reported !== composeHash) throw new Error(`compose hash mismatch: TEE ${reported}, local ${composeHash}`);
const measurements = {
  rtmrs: { mrtd: tcb.mrtd, rtmr0: tcb.rtmr0, rtmr1: tcb.rtmr1, rtmr2: tcb.rtmr2 },
  key_provider_event_digest: ev("key-provider")?.digest,
  app_compose_hash_payload: composeHash,
};
console.log("measurements", JSON.stringify(measurements, null, 1));

const { accountId, privateKey } = await getNearCredentials("testnet");
const owner = new Account(accountId, new JsonRpcProvider({ url: "https://test.rpc.fastnear.com" }), privateKey);
const contractId = fs.readFileSync(cfg.env, "utf8").match(/AGENT_CONTRACT_ID=(\S+)/)[1];
await owner.callFunction({ contractId, methodName: "approve_measurements", args: { measurements }, gas: 30_000_000_000_000n });
console.log(`approved on ${contractId}; the agent retries register() every 10 s`);
