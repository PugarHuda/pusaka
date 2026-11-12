// proofArgs must produce the same bytes as contract/src/btc.rs proof_args_borsh: compared here with a Buffer-based
// reference written straight from the Rust (the version the mainnet light client accepted on 12 Nov).
//   node --test shared/lcproof.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { proofArgs } from "./lcproof.mjs";

const ref = ({ txid, blockHash, pos, merkle, coinbase, coinbaseMerkle, confirmations }) => {
  const internal = (h) => Buffer.from(h, "hex").reverse();
  const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
  const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
  const hs = (l) => Buffer.concat([u32(l.length), ...l.map(internal)]);
  return Buffer.concat([internal(txid), internal(blockHash), u64(pos), hs(merkle), internal(coinbase), hs(coinbaseMerkle), u64(confirmations)]);
};
const h = (c) => c.repeat(64);

test("proofArgs = proof_args_borsh bytes", () => {
  const p = { txid: h("a1").slice(0, 64), blockHash: "00000000000000000001" + h("b").slice(20), pos: 1, merkle: [h("c"), h("d"), "0123456789abcdef".repeat(4)],
    coinbase: h("e"), coinbaseMerkle: [h("f")], confirmations: 6n };
  assert.deepEqual(Buffer.from(proofArgs(p)), ref(p));
  assert.equal(proofArgs({ ...p, merkle: [] }).length, 32 + 32 + 8 + 4 + 32 + 4 + 32 + 8);
});
