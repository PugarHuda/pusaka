// Pusaka MCP tools: lets an AI agent inspect, buy, lend against, prove, and withdraw from
// Pusaka (NEAR NFTs holding native BTC). Talks to the live contract; nothing is simulated.
//
//   PUSAKA_ACCOUNT_ID=agent.testnet PUSAKA_PRIVATE_KEY=ed25519:… npx pusaka-mcp
//   PUSAKA_MAX_SPEND_NEAR=5   hard cap on NEAR this server will spend per session (default 5)
// Without an account it runs read-only (overview, inspect).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Account, JsonRpcProvider, teraToGas } from "near-api-js";
import {
  CONTRACT, NEAR_RPC, NETWORK, EXPLORER, EVM, MINT_DEPOSIT, WITHDRAW_DEPOSIT, PROVE_DEPOSIT,
  balances, btcAddress, depositProof, evmAddress, evmBalances, finalize, broadcast, loanStats,
  prices, scriptHex, lightClientHeight, mintedTokenId,
} from "@pusaka/shared";

const provider = new JsonRpcProvider({ url: NEAR_RPC });
const ACCOUNT_ID = process.env.PUSAKA_ACCOUNT_ID;
const account = ACCOUNT_ID && process.env.PUSAKA_PRIVATE_KEY
  ? new Account(ACCOUNT_ID, provider, process.env.PUSAKA_PRIVATE_KEY)
  : null;
const YOCTO = 10n ** 24n;
const toYocto = (near) => BigInt(Math.round(Number(near) * 1e6)) * 10n ** 18n;
const toNear = (y) => Number(BigInt(y) / 10n ** 18n) / 1e6;

// Spending guard: the agent can never move more NEAR than this in one session.
const CAP = toYocto(process.env.PUSAKA_MAX_SPEND_NEAR ?? "5");
let spent = 0n;
function spend(amount, what) {
  if (spent + amount > CAP) {
    throw new Error(`${what} needs ${toNear(amount)} NEAR but the session cap leaves ${toNear(CAP - spent)} NEAR (PUSAKA_MAX_SPEND_NEAR).`);
  }
  spent += amount;
}

const view = (method, args = {}) =>
  provider.callFunction({ contractId: CONTRACT, method, args, blockQuery: { finality: "optimistic" } });

async function call(method, args, { deposit = 0n, tgas = 100 } = {}) {
  if (!account) throw new Error("Read-only: set PUSAKA_ACCOUNT_ID and PUSAKA_PRIVATE_KEY to act.");
  return account.callFunction({ contractId: CONTRACT, methodName: method, args, deposit, gas: teraToGas(tgas) });
}

const ok = (data) => ({ content: [{ type: "text", text: JSON.stringify(data, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2) }] });
const fail = (e) => ({ content: [{ type: "text", text: `Error: ${e.message ?? e}` }], isError: true });
const tool = (fn) => async (args) => { try { return ok(await fn(args)); } catch (e) { return fail(e); } };

export async function inspect(token_id) {
  const info = await view("token_info", { token_id });
  if (!info) throw new Error(`No Pusaka #${token_id}`);
  const px = await prices().catch(() => null);
  const verified = Number(info.verified_sats);
  const out = {
    token_id, owner: info.token.owner_id, network: NETWORK,
    btc: { address: info.btc_pubkey ? btcAddress(info.btc_pubkey) : null, verified_sats: verified,
      note: "verified = proven by NEAR's Bitcoin light client and never signed for; safe to rely on without an indexer" },
    sign_epoch: info.sign_epoch, locked: { listed: !!info.listing, loan: !!info.loan, signing: info.pending },
  };
  if (px) out.usd = { btc_inside: (verified / 1e8) * px.btcUsd, btc_usd: px.btcUsd, near_usd: px.nearUsd, source: "mempool.space, Rhea (mainnet prices)" };
  if (info.listing) {
    const price = toNear(info.price_now);
    out.listing = { seller: info.listing.seller, price_now_near: price, floor_near: toNear(info.listing.floor), ends_ms: info.listing.end_ms };
    if (px && verified) out.listing.premium_vs_btc = (price * px.nearUsd) / ((verified / 1e8) * px.btcUsd) - 1;
  }
  if (info.loan) {
    const l = info.loan;
    out.loan = { borrower: l.borrower, lender: l.lender, principal_near: toNear(l.principal), repay_near: toNear(l.repay),
      duration_ms: l.duration_ms, due_ms: l.due_ms };
    if (px) Object.assign(out.loan, loanStats(l, verified, px));
  }
  if (info.btc_pubkey) {
    const addr = evmAddress(info.btc_pubkey);
    const floor = await view("eth_nonce_floor", { token_id, chain_id: String(EVM.chain.id) });
    const e = await evmBalances(addr, floor).catch(() => null);
    if (e) out.eth = { chain: EVM.chain.name, address: addr, safe_wei: e.safe, at_risk_wei: e.atRisk };
  }
  return out;
}

/** Read-only tools are safe to expose publicly (remote MCP); the rest need the agent's own key. */
export const READ_TOOLS = new Set(["pusaka_overview", "pusaka_inspect"]);

export function createServer({ readOnly = false } = {}) {
  const server = new McpServer({ name: "pusaka", version: "1.0.0" });
  const reg = (name, ...rest) => (readOnly && !READ_TOOLS.has(name) ? null : server.registerTool(name, ...rest));


reg("pusaka_overview", {
  description: "List every Pusaka: owner, BTC verified on NEAR, current sale price, and loan status.",
  inputSchema: {},
}, tool(async () => {
  const toks = await view("nft_tokens", { from_index: "0", limit: 100 });
  const rows = await Promise.all(toks.map(async (t) => {
    const i = await view("token_info", { token_id: t.token_id });
    return { token_id: t.token_id, owner: i.token.owner_id, verified_sats: Number(i.verified_sats),
      for_sale_near: i.price_now ? toNear(i.price_now) : null,
      loan: i.loan ? (i.loan.lender ? "funded" : `asking ${toNear(i.loan.principal)} NEAR`) : null };
  }));
  return { contract: CONTRACT, network: NETWORK, agent: ACCOUNT_ID ?? "read-only", spend_cap_near: toNear(CAP), spent_near: toNear(spent), pusaka: rows };
}));

reg("pusaka_inspect", {
  description: "Full due diligence on one Pusaka: verified BTC and its USD value, ETH (safe vs at risk), listing premium, loan LTV and APR, sign epoch.",
  inputSchema: { token_id: z.string() },
}, tool(({ token_id }) => inspect(token_id)));

reg("pusaka_buy", {
  description: "Buy a listed Pusaka (and the BTC inside). Fails if the current price exceeds max_price_near, the spend cap, or if any signature was requested since inspection.",
  inputSchema: { token_id: z.string(), max_price_near: z.number().positive() },
}, tool(async ({ token_id, max_price_near }) => {
  const info = await view("token_info", { token_id });
  if (!info?.listing) throw new Error("Not for sale.");
  const price = BigInt(info.price_now);
  if (price > toYocto(max_price_near)) throw new Error(`Price ${toNear(price)} NEAR is above your max ${max_price_near}.`);
  spend(price, "buy");
  await call("buy", { token_id, expected_sign_epoch: info.sign_epoch }, { deposit: price });
  return { bought: token_id, paid_near: toNear(price), verified_sats: Number(info.verified_sats) };
}));

reg("pusaka_fund_loan", {
  description: "Fund an open loan request. The Pusaka and its BTC become collateral. Refuses if loan-to-value exceeds max_ltv (default 0.5), or the spend cap.",
  inputSchema: { token_id: z.string(), max_ltv: z.number().positive().max(1).optional() },
}, tool(async ({ token_id, max_ltv = 0.5 }) => {
  const info = await view("token_info", { token_id });
  const l = info?.loan;
  if (!l || l.lender) throw new Error("No open loan request.");
  const st = loanStats(l, Number(info.verified_sats), await prices());
  if (!Number.isFinite(st.ltv)) throw new Error("No BTC is verified inside this Pusaka, so the loan has no collateral.");
  if (st.ltv > max_ltv) throw new Error(`Loan-to-value ${(st.ltv * 100).toFixed(1)}% is above ${max_ltv * 100}%.`);
  spend(BigInt(l.principal), "fund_loan");
  await call("fund_loan", { token_id, expected_sign_epoch: info.sign_epoch, principal: l.principal, repay: l.repay, duration_ms: l.duration_ms },
    { deposit: BigInt(l.principal) });
  return { funded: token_id, principal_near: toNear(l.principal), repay_near: toNear(l.repay), ltv: st.ltv, apr: st.apr };
}));

reg("pusaka_repay_loan", {
  description: "Repay the loan on a Pusaka (usually as the borrower).",
  inputSchema: { token_id: z.string() },
}, tool(async ({ token_id }) => {
  const l = (await view("token_info", { token_id }))?.loan;
  if (!l?.lender) throw new Error("No funded loan.");
  spend(BigInt(l.repay), "repay_loan");
  await call("repay_loan", { token_id }, { deposit: BigInt(l.repay) });
  return { repaid: token_id, amount_near: toNear(l.repay) };
}));

reg("pusaka_claim_collateral", {
  description: "As the lender, take the Pusaka (and its BTC) after the due date if the loan wasn't repaid.",
  inputSchema: { token_id: z.string() },
}, tool(async ({ token_id }) => {
  await call("claim_collateral", { token_id });
  return { claimed: token_id, owner: (await view("token_info", { token_id })).token.owner_id };
}));

reg("pusaka_list", {
  description: "List your Pusaka for sale. Optional floor_near + hours make it a Dutch auction falling to the floor.",
  inputSchema: { token_id: z.string(), price_near: z.number().positive(), floor_near: z.number().positive().optional(), hours: z.number().positive().optional() },
}, tool(async ({ token_id, price_near, floor_near, hours }) => {
  await call("list", { token_id, price: toYocto(price_near).toString(),
    ...(floor_near && { floor: toYocto(floor_near).toString(), duration_ms: String(Math.round((hours ?? 24) * 3_600_000)) }) });
  return { listed: token_id, price_near, floor_near: floor_near ?? price_near };
}));

reg("pusaka_cancel_listing", {
  description: "Take your Pusaka off the market.",
  inputSchema: { token_id: z.string() },
}, tool(async ({ token_id }) => { await call("cancel_listing", { token_id }); return { cancelled: token_id }; }));

reg("pusaka_request_loan", {
  description: "Ask to borrow NEAR against your Pusaka. It stays locked until cancelled, repaid, or claimed.",
  inputSchema: { token_id: z.string(), principal_near: z.number().positive(), repay_near: z.number().positive(), days: z.number().positive() },
}, tool(async ({ token_id, principal_near, repay_near, days }) => {
  await call("request_loan", { token_id, principal: toYocto(principal_near).toString(), repay: toYocto(repay_near).toString(),
    duration_ms: String(Math.round(days * 86_400_000)) });
  return { requested: token_id, principal_near, repay_near, days };
}));

reg("pusaka_prove_deposits", {
  description: "Prove confirmed BTC deposits into a Pusaka through NEAR's on-chain Bitcoin light client, so they count as verified.",
  inputSchema: { token_id: z.string() },
}, tool(async ({ token_id }) => {
  const info = await view("token_info", { token_id });
  const addr = btcAddress(info.btc_pubkey);
  const lc = await lightClientHeight();
  const bal = await balances(addr, info.signed_outpoints);
  const todo = bal.spendable.filter((u) => u.status?.confirmed && u.status.block_height <= lc
    && !info.proven_utxos.some((p) => p.txid === u.txid && p.vout === u.vout));
  const results = [];
  for (const u of todo) {
    spend(PROVE_DEPOSIT, "prove_deposit");
    results.push({ txid: u.txid, vout: u.vout, sats: u.value,
      proven: await call("prove_deposit", { token_id, ...(await depositProof(u.txid, u.vout)) }, { deposit: PROVE_DEPOSIT }) });
  }
  return { light_client_height: lc, results, verified_sats: Number((await view("token_info", { token_id })).verified_sats) };
}));

reg("pusaka_withdraw_btc", {
  description: "Send BTC out of your Pusaka to a Bitcoin address. The contract builds the transaction, NEAR MPC signs it, this server verifies and broadcasts it.",
  inputSchema: { token_id: z.string(), to: z.string(), amount_btc: z.number().positive(), fee_sats: z.number().int().positive().optional() },
}, tool(async ({ token_id, to, amount_btc, fee_sats = 300 }) => {
  const info = await view("token_info", { token_id });
  const bal = await balances(btcAddress(info.btc_pubkey), info.signed_outpoints);
  const ins = [...bal.spendable].sort((a, b) => b.value - a.value).slice(0, 8);
  spend(WITHDRAW_DEPOSIT, "withdraw");
  const signed = await call("withdraw", {
    token_id, utxos: ins.map((u) => ({ txid: u.txid, vout: u.vout, value: String(u.value) })),
    to_script_hex: scriptHex(to), amount_sat: String(Math.round(amount_btc * 1e8)), fee_sat: String(fee_sats),
  }, { deposit: WITHDRAW_DEPOSIT, tgas: 300 });
  const txid = await broadcast(finalize(signed, ins.map((u) => u.value)).toHex());
  return { txid, explorer: `${EXPLORER}/tx/${txid}` };
}));

reg("pusaka_mint", {
  description: "Mint a new Pusaka. Returns its id and native Bitcoin address.",
  inputSchema: {},
}, tool(async () => {
  if (!account) throw new Error("Read-only: set PUSAKA_ACCOUNT_ID and PUSAKA_PRIVATE_KEY to act.");
  spend(MINT_DEPOSIT, "mint");
  const outcome = await account.callFunctionRaw({ contractId: CONTRACT, methodName: "nft_mint", args: {}, deposit: MINT_DEPOSIT, gas: teraToGas(100) });
  const id = mintedTokenId(outcome, ACCOUNT_ID);
  const info = await view("token_info", { token_id: id });
  if (info.token.owner_id !== ACCOUNT_ID) throw new Error(`token ${id} isn't owned by ${ACCOUNT_ID}`);
  return { token_id: id, btc_address: info.btc_pubkey ? btcAddress(info.btc_pubkey) : "deriving…" };
}));
  return server;
}
