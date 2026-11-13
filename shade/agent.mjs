// Pusaka's deposit prover as a Shade Agent.
// Inside a Phala TEE it registers on the agent contract with a real TDX attestation (the contract
// checks the code measurements), then proves every confirmed BTC deposit of every Pusaka with its
// own TEE-born key, using the same code path as the Vercel relayer (api/_relayer.mjs).
// GET / shows what it has done. Nothing here can move anyone's assets: prove_deposit only records
// light-client-verified facts.
// Heirs' claims from attested code: at boot the agent makes a second key that never leaves the enclave and shows its
// public half at GET / (heir_key). An heir who adds it to their own account as a function-call key limited to
// claim_inheritance on a Pusaka contract, and lists their account in HEIR_ACCOUNTS, gets their inheritance claimed by
// this agent the moment the holder's silence runs out. The key can do nothing else, and dies with the enclave.
import { createServer } from "node:http";
import { Account, FailoverRpcProvider, JsonRpcProvider, KeyPair } from "near-api-js";
import { ShadeClient, sanitize } from "@neardefi/shade-agent-js";
import { CONTRACT, SIBLINGS, nearProvider } from "@pusaka/shared";
import { proveToken } from "../api/_relayer.mjs";

const need = (k) => process.env[k] || (() => { throw new Error(`missing ${k}`); })();
const EVERY_MS = 2 * 60_000;

const agent = await ShadeClient.create({
  networkId: "testnet",
  agentContractId: need("AGENT_CONTRACT_ID"),
  sponsor: { accountId: need("SPONSOR_ACCOUNT_ID"), privateKey: need("SPONSOR_PRIVATE_KEY") },
});
const status = { agent: agent.accountId(), agent_contract: process.env.AGENT_CONTRACT_ID, pusaka_contracts: [CONTRACT, ...SIBLINGS],
  registered_at: null, runs: 0, last_run: null, proofs: [], errors: [] };
const fail = (where, e) => { status.errors = [...status.errors.slice(-9), { where, at: new Date().toISOString(), error: String(sanitize(e)?.message ?? sanitize(e)) }]; console.error(where, sanitize(e)); };

createServer(async (req, res) => {
  res.setHeader("content-type", "application/json");
  res.setHeader("access-control-allow-origin", "*");
  const balance = await agent.balance().catch(() => null);
  res.end(JSON.stringify({ ...status, balance_near: balance }, null, 2));
}).listen(Number(process.env.PORT || 3000));
console.log("agent", status.agent);

// register() attaches more than 0.3 NEAR of prepaid gas: 0.3 alone failed with NotEnoughBalance (13 Nov)
if ((await agent.balance()) < 0.4) await agent.fund(0.5);

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
const prover = new Account(status.agent, nearProvider({ FailoverRpcProvider, JsonRpcProvider }), key);

// the heirs' claim key: born here, never exported; heirs grant it claim_inheritance only
const heirKey = KeyPair.fromRandom("ed25519");
const HEIRS = (process.env.HEIR_ACCOUNTS ?? "").split(",").map((x) => x.trim()).filter(Boolean);
status.heir_key = heirKey.getPublicKey().toString();
status.heirs = HEIRS;
status.claims = [];
const retryAt = new Map(); // "<contract>:<token>" -> no retry before this time

async function claimForHeirs() {
  if (!HEIRS.length) return;
  for (const c of [CONTRACT, ...SIBLINGS]) {
    const tokens = await prover.provider.callFunction({ contractId: c, method: "nft_tokens", args: { from_index: "0", limit: 100 } });
    for (const t of tokens) {
      const h = await prover.provider.callFunction({ contractId: c, method: "heir_of", args: { token_id: t.token_id } }).catch(() => null);
      // heir_of is null once the Pusaka changed hands, so a will from an earlier holder never shows up here
      if (!h || !HEIRS.includes(h.heir) || Date.now() < Number(h.claimable_from_ms)) continue;
      const k = `${c}:${t.token_id}`;
      if ((retryAt.get(k) ?? 0) > Date.now()) continue; // backed off after a failure
      // every condition claim_inheritance enforces, checked before the heir's key pays any gas
      const [g, info] = await Promise.all([
        prover.provider.callFunction({ contractId: c, method: "guardians_of", args: { token_id: t.token_id } }).catch(() => null),
        prover.provider.callFunction({ contractId: c, method: "token_info", args: { token_id: t.token_id } }).catch(() => null),
      ]);
      const now = Date.now();
      if (g && !((g.release_at_ms && Number(g.release_at_ms) <= now) || Number(g.backstop_from_ms) <= now)) continue; // guardians first
      if (!info || info.loan?.lender || info.pending) continue; // a funded loan's lender comes first; nothing mid-signature
      const recent = status.claims.filter((x) => x.heir === h.heir && now - Date.parse(x.at) < 3_600_000).length;
      if (recent >= 5) continue; // per-heir budget: at most 5 claims an hour on their key
      try {
        await new Account(h.heir, prover.provider, heirKey.toString()).callFunction({ contractId: c, methodName: "claim_inheritance", args: { token_id: t.token_id }, gas: 100_000_000_000_000n });
        status.claims = [...status.claims.slice(-19), { contract: c, token_id: t.token_id, heir: h.heir, at: new Date().toISOString() }];
        console.log("claimed", c, t.token_id, "for", h.heir);
      } catch (e) { retryAt.set(k, Date.now() + 30 * 60_000); fail(`claim ${c} #${t.token_id} for ${h.heir}`, e); }
    }
  }
}

async function round() {
  status.runs++; status.last_run = new Date().toISOString();
  try {
    // the main contract (Smart Pusakas) and its frozen classic sibling
    for (const c of [CONTRACT, ...SIBLINGS]) {
      const tokens = await prover.provider.callFunction({ contractId: c, method: "nft_tokens", args: { from_index: "0", limit: 100 } });
      for (const t of tokens) {
        try {
          const { results } = await proveToken(t.token_id, prover, c);
          for (const r of results) status.proofs = [...status.proofs.slice(-49), { contract: c, token_id: t.token_id, ...r, at: new Date().toISOString() }];
        } catch (e) { if (e.status !== 429) fail(`prove ${c} #${t.token_id}`, e); }
      }
    }
  } catch (e) { fail("round", e); }
  await claimForHeirs().catch((e) => fail("heirs", e));
}
await round();
setInterval(round, EVERY_MS);
