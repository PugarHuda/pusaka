// Which deposit proofs came from Pusaka's Shade Agent: accounts registered on the agent contract (their TDX quote and
// code measurements were checked on-chain at register_agent), and the proofs they landed, read from FastNear's archival
// transaction index. Browser- and Node-safe (fetch only).
import { NETWORK } from "./btc.mjs";

export const AGENT_CONTRACT = NETWORK === "testnet" ? "pusaka-agent.testnet" : null;
const TX_API = `https://tx.${NETWORK === "mainnet" ? "main" : "test"}.fastnear.com`;
const TRUE = "dHJ1ZQ=="; // base64("true")
const post = (p, body) => fetch(`${TX_API}${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  .then((r) => { if (!r.ok) throw new Error(`FastNear ${r.status}`); return r.json(); });
const b64json = (s) => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0))));

/**
 * Map "<contract>:<token_id>:<txid>:<vout>" -> { agent, tx } for every deposit an attested agent proved: a transaction
 * signed by a registered agent whose on_deposit_proven callback returned true. `view(method, args, contract)` reads NEAR.
 */
export async function teeProofs(view) {
  const out = new Map();
  if (!AGENT_CONTRACT) return out;
  const agents = (await view("get_agents", {}, AGENT_CONTRACT)).map((a) => a.account_id);
  for (const agent of agents) {
    const { account_txs = [] } = await post("/v0/account", { account_id: agent });
    const hashes = account_txs.map((t) => t.transaction_hash);
    for (let i = 0; i < hashes.length; i += 20) {
      const { transactions = [] } = await post("/v0/transactions", { tx_hashes: hashes.slice(i, i + 20) });
      for (const t of transactions) {
        if (t.transaction.signer_id !== agent) continue;
        for (const r of t.receipts ?? []) {
          const o = r.execution_outcome.outcome, fc = r.receipt?.receipt?.Action?.actions?.[0]?.FunctionCall;
          if (fc?.method_name !== "on_deposit_proven" || o.status?.SuccessValue !== TRUE) continue;
          const a = b64json(fc.args);
          out.set(`${o.executor_id}:${a.token_id}:${a.txid}:${a.vout}`, { agent, tx: t.transaction.hash });
        }
      }
    }
  }
  return out;
}
