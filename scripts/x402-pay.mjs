// An agent pays per call over x402 for a Pusaka proof-of-reserves audit: GET /api/audit answers 402, we sign a NEP-366
// ft_transfer of wNEAR (no gas needed: the server's relayer submits it) and retry; prints the NEAR tx of the payment.
//   node scripts/x402-pay.mjs <token_id> [--url https://…/api/audit] [--from pusaka-buyer.testnet] [--max-yocto 10000000000000000000000]
// Without --url it serves api/audit.mjs locally, with pusaka-relayer.testnet (from .keys/) as the settling relayer.
import http from "node:http";
import fs from "node:fs";
import { createNearPaymentFetch } from "@fastnear/x402";
import { createLocalNearSigner } from "@fastnear/x402/node";
import { decodePaymentRequiredHeader, decodePaymentResponseHeader } from "@x402/core/http";
import { NETWORK, RPC, account, call, keyFile, view } from "./lib.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const tokenId = process.argv[2];
if (!/^\d+$/.test(tokenId ?? "")) throw new Error("usage: node scripts/x402-pay.mjs <token_id> [--url …] [--from …]");
const from = arg("--from", "pusaka-buyer.testnet");
const max = BigInt(arg("--max-yocto", "10000000000000000000000")); // 0.01 wNEAR: refuse anything pricier
const key = (id) => JSON.parse(fs.readFileSync(keyFile(id), "utf8")).private_key;

let url = arg("--url"), server;
if (!url) {
  process.env.RELAYER_ACCOUNT_ID ??= "pusaka-relayer.testnet";
  process.env.RELAYER_PRIVATE_KEY ??= key(process.env.RELAYER_ACCOUNT_ID);
  const { default: handler } = await import("../api/audit.mjs");
  // ponytail: the three Vercel response helpers the handler uses, nothing more
  server = http.createServer((req, res) => {
    res.status = (s) => ((res.statusCode = s), res);
    res.json = (b) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(b)); };
    handler(req, res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${server.address().port}/api/audit`;
}
const target = `${url}?token_id=${tokenId}`;

// 1. unpaid call: read the price before agreeing to it
const first = await fetch(target);
if (first.status !== 402) throw new Error(`expected 402, got ${first.status}: ${await first.text()}`);
const [req] = decodePaymentRequiredHeader(first.headers.get("payment-required")).accepts;
console.log(`402: ${req.amount} of ${req.asset} to ${req.payTo} on ${req.network}`);
if (req.network !== `near:${NETWORK}`) throw new Error(`refusing ${req.network}`);
if (BigInt(req.amount) > max) throw new Error(`price ${req.amount} is over --max-yocto ${max}`);

// 2. the payer needs the token, not NEAR for gas; wNEAR is just wrapped NEAR, so wrap a little if short
const bal = BigInt(await view("ft_balance_of", { account_id: from }, req.asset));
if (bal < BigInt(req.amount)) {
  if (!req.asset.startsWith("wrap.")) throw new Error(`${from} holds ${bal} of ${req.asset}, needs ${req.amount}`);
  const payer = account(from);
  if (!(await view("storage_balance_of", { account_id: from }, req.asset))) await call(payer, "storage_deposit", {}, { receiver: req.asset, deposit: 1_250_000_000_000_000_000_000n, tgas: 30 });
  await call(payer, "near_deposit", {}, { receiver: req.asset, deposit: BigInt(req.amount) * 5n, tgas: 30 });
  console.log(`wrapped ${BigInt(req.amount) * 5n} yocto NEAR for ${from}`);
}

// 3. paid call: x402 signs the delegate, retries with PAYMENT-SIGNATURE, the server settles before answering
const signer = createLocalNearSigner({ accountId: from, secretKey: key(from), rpcUrls: { [`near:${NETWORK}`]: RPC } });
const res = await createNearPaymentFetch({ signer, network: `near:${NETWORK}` })(target);
const body = await res.json();
server?.close();
if (!res.ok) throw new Error(`paid call failed ${res.status}: ${JSON.stringify(body).slice(0, 300)} ${res.headers.get("payment-required") ? decodePaymentRequiredHeader(res.headers.get("payment-required")).error : ""}`);
const receipt = decodePaymentResponseHeader(res.headers.get("payment-response"));
console.log(`Pusaka #${body.token_id}: ${body.verdict} (${body.checks.filter((c) => c.ok).length}/${body.checks.length} checks pass)`);
console.log(`paid by ${receipt.payer}, NEAR tx ${receipt.transaction}`);
console.log(`https://${NETWORK === "mainnet" ? "" : "testnet."}nearblocks.io/txns/${receipt.transaction}`);
