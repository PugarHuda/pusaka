// scriptAddress is scriptHex's inverse; scripts with no address give null.  node shared/scriptaddr.test.mjs
import assert from "node:assert/strict";
import { scriptHex, scriptAddress } from "./btc.mjs";
const a = "tb1qqsqwx6akxk2japg7ljma28cswrxe5wsrmns8t3";
assert.equal(scriptAddress(scriptHex(a)), a);
assert.equal(scriptAddress("6a0474657374"), null); // OP_RETURN
assert.equal(scriptAddress("zz"), null);
console.log("scriptaddr ok");
