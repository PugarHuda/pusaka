// node shared/failover.test.mjs: parallel reads skip a rate-limited RPC instead of cycling back onto it,
// and a contract error is returned at once, not retried on every endpoint.
import assert from "node:assert/strict";
import { FailoverRpcProvider } from "near-api-js";
import { nearProvider } from "./btc.mjs";

const calls = [];
class Fake {
  constructor({ url }) { this.url = url; }
  async callFunction({ method }) {
    calls.push(this.url);
    if (method === "panics") throw Object.assign(new Error("Smart contract panicked: NoToken"), { type: "UntypedError" });
    if (this.url.includes("fastnear")) throw Object.assign(new Error("Exceeded 10 attempts"), { type: "RetriesExceeded" });
    return this.url;
  }
}
const p = nearProvider({ FailoverRpcProvider, JsonRpcProvider: Fake });
const answers = await Promise.all(Array.from({ length: 20 }, () => p.callFunction({ method: "token_info" })));
assert.ok(answers.every((a) => a.includes("drpc")), `all 20 answered by the next RPC: ${[...new Set(answers)]}`);
calls.length = 0;
assert.equal(await p.callFunction({ method: "token_info" }), answers[0]);
assert.deepEqual(calls, [answers[0]], "a rate-limited RPC is skipped for a minute, not asked first again");
calls.length = 0;
await assert.rejects(p.callFunction({ method: "panics" }), /NoToken/);
assert.equal(calls.length, 1, "a contract panic is the answer: no failover");
console.log("failover ok");
