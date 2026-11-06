// NEP-611 gas keys for the relayer: a key with its own NEAR balance for gas and many independent nonce lanes, so
// parallel serverless instances sending at once don't collide on one nonce. near-api-js picks the lanes itself.
//   node gas-key.mjs setup <account> [lanes=16] [fund_near=2]   new key, saved to .keys/<account>.gaskey.json (never printed)
//   node gas-key.mjs status <account>                            balance and lanes, from the chain
//   node gas-key.mjs burst <account> [n=8]                       n transactions signed at the same moment with the gas key
//   node gas-key.mjs fund <account> <near>                       top the gas balance up
import fs from "node:fs";
import { Account, KeyPair } from "near-api-js";
import { account, provider, keyFile } from "./lib.mjs";

const [cmd, id, a, b] = process.argv.slice(2);
const file = (x) => keyFile(x).replace(/\.json$/, ".gaskey.json");
const yocto = (near) => BigInt(Math.round(Number(near) * 1e6)) * 10n ** 18n;
const gasKey = (x) => JSON.parse(fs.readFileSync(file(x), "utf8")).private_key;
const pub = (x) => KeyPair.fromString(gasKey(x)).getPublicKey();
const status = async (x) => {
  const params = { accountId: x, publicKey: pub(x), finalityQuery: { finality: "final" } };
  const k = await provider.viewAccessKey(params);
  const { nonces } = await provider.viewGasKeyNonces(params);
  const p = k.permission?.GasKeyFullAccess ?? k.permission?.GasKeyFunctionCall ?? k.permission;
  return { public_key: pub(x).toString(), permission: Object.keys(k.permission ?? {})[0] ?? k.permission, gas_balance_near: p?.balance !== undefined ? Number(BigInt(p.balance)) / 1e24 : undefined, lanes: nonces.length, nonces: nonces.map(String) };
};

if (cmd === "setup") {
  if (fs.existsSync(file(id))) throw new Error(`${file(id)} exists already`);
  const kp = KeyPair.fromRandom("ed25519");
  fs.writeFileSync(file(id), JSON.stringify({ account_id: id, private_key: kp.toString() }), { mode: 0o600, flag: "wx" }); // owner-only, never overwrite
  const owner = account(id);
  const add = await owner.addFullAccessGasKey(kp.getPublicKey(), Number(a ?? 16));
  const fund = await owner.transferToGasKey(id, kp.getPublicKey(), yocto(b ?? 2));
  console.log(`gas key added (tx ${add.transaction.hash}) and funded (tx ${fund.transaction.hash})`, await status(id));
} else if (cmd === "status") {
  console.log(await status(id));
} else if (cmd === "fund") {
  const r = await account(id).transferToGasKey(id, pub(id), yocto(a));
  console.log(`funded: tx ${r.transaction.hash}`, await status(id));
} else if (cmd === "burst") {
  // ponytail: 1-yocto transfers to itself; each lands on its own lane, none waits for another's nonce
  const acct = new Account(id, provider, gasKey(id));
  const t0 = Date.now();
  const r = await Promise.allSettled(Array.from({ length: Number(a ?? 8) }, () => acct.transfer({ receiverId: id, amount: 1n })));
  const okd = r.filter((x) => x.status === "fulfilled");
  console.log(`${okd.length}/${r.length} landed in ${((Date.now() - t0) / 1000).toFixed(1)} s`, okd.map((x) => x.value.transaction.hash.slice(0, 8)).join(" "));
  r.filter((x) => x.status === "rejected").forEach((x) => console.log("failed:", String(x.reason?.message ?? x.reason).slice(0, 200)));
  console.log(await status(id));
} else {
  console.log("usage: node gas-key.mjs setup|status|burst|fund <account> …");
}
