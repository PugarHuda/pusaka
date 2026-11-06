// Timelocked upgrades for a contract account with no access key (contract/src/upgrade.rs).
//   node upgrade.mjs status                         admin, pending announcement, the contract account's keys
//   node upgrade.mjs set-admin <admin>              once, signed by the contract account itself (needs its key)
//   node upgrade.mjs propose <wasm> [migrate]       the admin announces the wasm's sha256; deployable after the delay
//   node upgrade.mjs apply <wasm> [account]         anyone deploys the announced bytes once the delay has passed
//   node upgrade.mjs lock                           delete every access key of the contract account (irreversible)
// Keys come from ../.keys; the admin is read from the contract.
import crypto from "node:crypto";
import fs from "node:fs";
import { actions, teraToGas } from "near-api-js";
import { account, call, view, provider, CONTRACT } from "./lib.mjs";

const [cmd, a1, a2] = process.argv.slice(2);
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const keys = async () => (await provider.viewAccessKeyList({ accountId: CONTRACT, finalityQuery: { finality: "final" } })).keys;
const st = await view("upgrade_status").catch(() => null);

if (cmd === "status") {
  console.log(JSON.stringify({ contract: CONTRACT, upgrade_status: st, access_keys: (await keys()).map((k) => ({ key: k.public_key, permission: k.access_key.permission })) }, null, 2));
} else if (cmd === "set-admin") {
  await call(account(CONTRACT), "set_upgrade_admin", { admin: a1 });
  console.log(await view("upgrade_status"));
} else if (cmd === "propose") {
  if (!st?.admin) throw new Error("no upgrade admin set");
  const p = await call(account(st.admin), "propose_upgrade", { code_sha256: sha(a1), migrate: a2 ?? null });
  console.log(`announced ${p.code_sha256}; deployable from ${new Date(Number(p.applicable_from_ms)).toISOString()}`);
} else if (cmd === "apply") {
  const p = st?.proposal;
  if (!p) throw new Error("nothing announced");
  if (sha(a1) !== p.code_sha256) throw new Error(`${a1} is ${sha(a1)}, not the announced ${p.code_sha256}`);
  const wait = Number(p.applicable_from_ms) - Date.now();
  if (wait > 0) throw new Error(`too early: ${Math.ceil(wait / 1000)} s to go`);
  const r = await account(a2 ?? st.admin).signAndSendTransaction({
    receiverId: CONTRACT, actions: [actions.functionCall("apply_upgrade", fs.readFileSync(a1), teraToGas(300), 0n)],
  });
  console.log(`applied: tx ${r.transaction.hash}; status ${JSON.stringify(r.status).slice(0, 80)}`);
  const code = (await provider.viewAccount({ accountId: CONTRACT, finalityQuery: { finality: "final" } })).code_hash;
  console.log(`code_hash now ${code} (base58 of the sha256 above)`);
} else if (cmd === "lock") {
  // refuse to lock a contract nobody could ever fix: the upgrade path must be in place first
  if (!st?.admin) throw new Error("set an upgrade admin (and test an apply) before deleting the keys");
  const ks = await keys();
  if (!ks.length) { console.log("already keyless"); process.exit(0); }
  const r = await account(CONTRACT).signAndSendTransaction({ receiverId: CONTRACT, actions: ks.map((k) => actions.deleteKey(k.public_key)) });
  console.log(`deleted ${ks.length} key(s): tx ${r.transaction.hash}; keys left: ${(await keys()).length}`);
} else {
  console.log("usage: node upgrade.mjs status | set-admin <admin> | propose <wasm> [migrate] | apply <wasm> [account] | lock");
}
