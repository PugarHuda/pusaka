// node tools/warp.test.mjs — the retiming that keeps the voice gap-free
import assert from "node:assert/strict";
import { warper } from "./timeline.mjs";

const w = warper(30);
w.play(0.2, 0.2);                 // real time
w.play(8, 2);                     // 7.8 s of clip in 2 s: 3.9x
w.play(28, 2);                    // 20 s in 2 s: over 4x, so 4 s of it with a jump
w.play(29, 3);                    // 1 s of clip, 3 s of voice: real time, then still
assert.equal(w.s, 7.2);
const r = (p) => (p.u1 - p.u0) / (p.s1 - p.s0);
assert.ok(w.pieces.every((p) => r(p) <= 4 + 1e-9), "never faster than 4x");
assert.equal(w.at(8), 2.2);                    // each mark lands where its line starts
assert.equal(w.at(28), 4.2);
assert.equal(w.at(15), 3.2);                   // inside the jump: where the jump lands
assert.equal(w.pieces.at(-1).u0, w.pieces.at(-1).u1, "voice longer than clip: held still");
console.log("warp: marks land on their lines, <= 4x, jumps and holds");
