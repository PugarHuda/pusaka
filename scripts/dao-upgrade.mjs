// Upgrades go through the Sputnik DAO that holds the contract's upgrade role, then through the contract's timelock.
//   node dao-upgrade.mjs propose <wasm> <council-member>      a FunctionCall proposal: pusaka.propose_upgrade(sha256)
//   node dao-upgrade.mjs vote <proposal-id> <member> [...]    VoteApprove; at the threshold the DAO makes the call
//   node dao-upgrade.mjs status                               the DAO's policy and last proposals
//   node dao-upgrade.mjs renounce <council-member>            a proposal to call renounce_upgrades: once approved, the
//                                                            code is final forever (planned after the last hackathon deploy)
// After the DAO's call, `node upgrade.mjs apply <wasm>` deploys the same bytes once the timelock has passed.
import crypto from "node:crypto";
import fs from "node:fs";
import { account, call, view, CONTRACT } from "./lib.mjs";

const [cmd, a1, ...rest] = process.argv.slice(2);
const up = await view("upgrade_status");
const DAO = up.admin;
if (!DAO?.endsWith(".sputnikv2.testnet") && !DAO?.endsWith(".sputnik-dao.near")) throw new Error(`the upgrade admin is ${DAO}, not a Sputnik DAO`);

if (cmd === "propose") {
  const sha = crypto.createHash("sha256").update(fs.readFileSync(a1)).digest("hex");
  const { proposal_bond } = await view("get_policy", {}, DAO);
  const id = await call(account(rest[0]), "add_proposal", { proposal: {
    description: `Announce new Pusaka contract code ${sha} (CI reproducible build). After approval it is deployable only once ${CONTRACT}'s ${Number(up.delay_ms) / 60_000}-minute timelock has passed.`,
    kind: { FunctionCall: { receiver_id: CONTRACT, actions: [{ method_name: "propose_upgrade",
      args: Buffer.from(JSON.stringify({ code_sha256: sha, migrate: null })).toString("base64"), deposit: "0", gas: "30000000000000" }] } },
  } }, { deposit: BigInt(proposal_bond), receiver: DAO });
  console.log(`proposal ${id} on ${DAO}: announce ${sha}`);
} else if (cmd === "renounce") {
  const { proposal_bond } = await view("get_policy", {}, DAO);
  const id = await call(account(a1), "add_proposal", { proposal: {
    description: `Renounce upgrades on ${CONTRACT}: after this the deployed code (sha256 ${(await view("contract_source_metadata")).build_info?.source_code_snapshot ?? "see NEP-330 metadata"}) can never change, by anyone.`,
    kind: { FunctionCall: { receiver_id: CONTRACT, actions: [{ method_name: "renounce_upgrades", args: Buffer.from("{}").toString("base64"), deposit: "0", gas: "30000000000000" }] } },
  } }, { deposit: BigInt(proposal_bond), receiver: DAO });
  console.log(`proposal ${id} on ${DAO}: renounce upgrades (irreversible once the council approves)`);
} else if (cmd === "vote") {
  for (const m of rest) {
    await call(account(m), "act_proposal", { id: Number(a1), action: "VoteApprove" }, { tgas: 300, receiver: DAO });
    const p = await view("get_proposal", { id: Number(a1) }, DAO);
    console.log(`${m} approved; proposal ${a1} is ${p.status}`);
  }
  console.log("contract upgrade_status:", JSON.stringify(await view("upgrade_status")));
} else if (cmd === "status") {
  const last = await view("get_last_proposal_id", {}, DAO);
  const ps = await view("get_proposals", { from_index: Math.max(0, last - 5), limit: 5 }, DAO);
  console.log(JSON.stringify({ dao: DAO, policy: (await view("get_policy", {}, DAO)).roles.map((r) => r.kind), proposals: ps.map((p) => ({ id: p.id, status: p.status, by: p.proposer, votes: p.votes })) }, null, 1));
} else {
  console.log("usage: node dao-upgrade.mjs propose <wasm> <member> | renounce <member> | vote <id> <member>... | status");
}
