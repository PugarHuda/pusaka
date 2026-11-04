// Pusaka's deposit prover as a Shade Agent.
// Inside a Phala TEE it registers on the agent contract with a real TDX attestation (the contract
// checks the code measurements), then proves every confirmed BTC deposit of every Pusaka with its
// own TEE-born key, using the same code path as the Vercel relayer (api/_relayer.mjs).
// GET / shows what it has done. Nothing here can move anyone's assets: prove_deposit only records
// light-client-verified facts.
import { createServer } from "node:http";
import { Account, JsonRpcProvider } from "near-api-js";
import { ShadeClient, sanitize } from "@neardefi/shade-agent-js";
import { CONTRACT, NEAR_RPC } from "@pusaka/shared";
import { proveToken } from "../api/_relayer.mjs";

const need = (k) => process.env[k] || (() => { throw new Error(`missing ${k}`); })();
const EVERY_MS = 2 * 60_000;

const agent = await ShadeClient.create({
  networkId: "testnet",
  agentContractId: need("AGENT_CONTRACT_ID"),
  sponsor: { accountId: need("SPONSOR_ACCOUNT_ID"), privateKey: need("SPONSOR_PRIVATE_KEY") },
  derivationPath: need("SPONSOR_PRIVATE_KEY"), // local mode only; in a TEE the key comes from the enclave
});
const status = { agent: agent.accountId(), agent_contract: process.env.AGENT_CONTRACT_ID, pusaka_contract: CONTRACT,
  registered_at: null, runs: 0, last_run: null, proofs: [], errors: [] };
const fail = (where, e) => { status.errors = [...status.errors.slice(-9), { where, at: new Date().toISOString(), error: String(sanitize(e)?.message ?? sanitize(e)) }]; console.error(where, sanitize(e)); };

createServer(async (req, res) => {
  res.setHeader("content-type", "application/json");
  res.setHeader("access-control-allow-origin", "*");
  const balance = await agent.balance().catch(() => null);
  res.end(JSON.stringify({ ...status, balance_near: balance }, null, 2));
}).listen(Number(process.env.PORT || 3000));
console.log("agent", status.agent);

if ((await agent.balance()) < 0.2) await agent.fund(0.3);

// Register before doing anything, so every proof on-chain comes from an attested agent.
while (!status.registered_at) {
  try {
    const wl = await agent.isWhitelisted(); // null in a TEE: the attestation decides
    if ((wl === null || wl) && (await agent.register())) status.registered_at = new Date().toISOString();
  } catch (e) { fail("register", e); }
  if (!status.registered_at) await new Promise((r) => setTimeout(r, 10_000));
}
console.log("registered", status.registered_at);
setInterval(() => agent.register().catch((e) => fail("re-register", e)), 6 * 24 * 3600_000);

// ponytail: the key is ephemeral (lost on reboot) and never leaves this process; it only pays for proofs.
const [key] = agent.getPrivateKeys({ acknowledgeRisk: true });
const prover = new Account(status.agent, new JsonRpcProvider({ url: NEAR_RPC }), key);

async function round() {
  status.runs++; status.last_run = new Date().toISOString();
  try {
    const tokens = await prover.provider.callFunction({ contractId: CONTRACT, method: "nft_tokens", args: { from_index: "0", limit: 100 } });
    for (const t of tokens) {
      try {
        const { results } = await proveToken(t.token_id, prover);
        for (const r of results) status.proofs = [...status.proofs.slice(-49), { token_id: t.token_id, ...r, at: new Date().toISOString() }];
      } catch (e) { fail(`prove #${t.token_id}`, e); }
    }
  } catch (e) { fail("round", e); }
}
await round();
setInterval(round, EVERY_MS);
