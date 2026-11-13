// Deletes a CVM (not just stops it: a stopped CVM still bills storage). Run right after the evidence is on chain.
//   node shade/delete-cvm.mjs <cvm_id>
import { execSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

const cli = path.join(execSync("npm root -g").toString().trim(), "@neardefi/shade-agent-cli/dist/src/utils");
const { createClient } = await import(pathToFileURL(path.join(cli, "phala-deploy.js")).href);
const { getPhalaKey } = await import(pathToFileURL(path.join(cli, "keystore.js")).href);
const phala = createClient({ apiKey: await getPhalaKey() });
const id = process.argv[2];
if (!id) throw new Error("usage: node shade/delete-cvm.mjs <cvm_id>");
await phala.delete(`/cvms/${id}`);
console.log("deleted", id, "; CVMs left:", JSON.stringify(((await phala.get("/cvms").catch(() => [])) ?? []).map?.((c) => c.id ?? c.vm_uuid) ?? "?"));
