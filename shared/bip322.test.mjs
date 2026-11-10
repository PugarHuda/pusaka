// BIP-322 against the spec's own vectors (bitcoin/bips bip-0322/basic-test-vectors.json): message hashes, the
// virtual transactions, and the spec's signatures verifying (and a changed message or key failing).
import assert from "node:assert/strict";
import { hex } from "@scure/base";
import { messageHash, toSpendTxid, toSignTxid, verify, hash160 } from "./bip322.mjs";

const pk = hex.decode("02c7f12003196442943d8588e01aee840423cc54fc1521526a3b85c2b0cbd58872");
const pkh = hash160(pk); // bc1q9vza2e8x573nczrlzms0wvx3gsqjx7vavgkx0l
for (const [msg, mh, spend, sign] of [
  ["", "c90c269c4f8fcbe6880f72a721ddfbf1914268a794cbb21cfafee13770ae19f1",
    "c5680aa69bb8d860bf82d4e9cd3504b55dde018de765a91bb566283c545a99a7", "1e9654e951a5ba44c8604c4de6c67fd78a27e81dcadcfe1edf638ba3aaebaed6"],
  ["Hello World", "f0eb03b1a75ac6d9847f55c624a99169b5dccba2a31f5b23bea77ba270de0a7a",
    "b79d196740ad5217771c1098fc4a4b51e0535c32236c71f1ea4d61a2d603352b", "88737ae86f2077145f93cc4b153ae9a1cb8d56afa511988c149c5c8c9d93bddf"],
]) {
  assert.equal(hex.encode(messageHash(msg)), mh);
  assert.equal(toSpendTxid(pkh, msg), spend);
  assert.equal(toSignTxid(pkh, msg), sign);
}
const sig = "smpAkcwRAIgZRfIY3p7/DoVTty6YZbWS71bc5Vct9p9Fia83eRmw2QCICK/ENGfwLtptFluMGs2KsqoNSk89pO7F29zJLUx9a/sASECx/EgAxlkQpQ9hYjgGu6EBCPMVPwVIVJqO4XCsMvViHI=";
assert.ok(verify(pkh, "Hello World", sig), "the spec's signature verifies");
assert.ok(verify(pkh, "", "AkcwRAIgM2gBAQqvZX15ZiysmKmQpDrG83avLIT492QBzLnQIxYCIBaTpOaD20qRlEylyxFSeEA2ba9YOixpX8z46TSDtS40ASECx/EgAxlkQpQ9hYjgGu6EBCPMVPwVIVJqO4XCsMvViHI="));
assert.ok(!verify(pkh, "Hello World!", sig), "another message fails");
assert.ok(!verify(new Uint8Array(20), "Hello World", sig), "another address fails");
console.log("bip322: ok");
