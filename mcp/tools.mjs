// Pusaka MCP tools: lets an AI agent inspect, buy, lend against, prove, and withdraw from
// Pusaka (NEAR NFTs holding native BTC). Talks to the live contract; nothing is simulated.
//
//   PUSAKA_ACCOUNT_ID=agent.testnet PUSAKA_PRIVATE_KEY=ed25519:… npx pusaka-mcp
//   PUSAKA_MAX_SPEND_NEAR=5   hard cap on NEAR this server will spend per session (default 5)
//   PUSAKA_ALLOW_OUTFLOWS=1   needed for give / withdraw_* (off by default); PUSAKA_ALLOWED_RECIPIENTS=a,b limits where
// Without an account it runs read-only (overview, inspect).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Account, FailoverRpcProvider, JsonRpcProvider, teraToGas } from "near-api-js";
import {
  CONTRACT, NETWORK, EXPLORER, EVM_CHAINS, MINT_DEPOSIT, solAddress, solBalances, nearAccount, nearBalances, WITHDRAW_DEPOSIT, PROVE_DEPOSIT,
  balances, btcAddress, depositProof, evmAddress, evmBalances, finalize, broadcast, loanStats,
  prices, scriptHex, lightClientHeight, mintedTokenId,
  evmTx, evmTxParams, finalizeEth, broadcastEth, isSolAddress, solBlockhash, finalizeSol, broadcastSol, SOL,
  nearTxParams, finalizeNear, broadcastNear, NEAR_EXPLORER, NBTC, nbtcBalances, nearProvider,
} from "@pusaka/shared";
import { isAddress, parseEther, parseUnits } from "viem";

const provider = nearProvider({ FailoverRpcProvider, JsonRpcProvider });
const ACCOUNT_ID = process.env.PUSAKA_ACCOUNT_ID;
const account = ACCOUNT_ID && process.env.PUSAKA_PRIVATE_KEY
  ? new Account(ACCOUNT_ID, provider, process.env.PUSAKA_PRIVATE_KEY)
  : null;
const toYocto = (near) => BigInt(Math.round(Number(near) * 1e6)) * 10n ** 18n;
const toNear = (y) => Number(BigInt(y) / 10n ** 18n) / 1e6;

// Outflow guard: tools that move a Pusaka or its assets away (give, withdraw_*) are off unless the
// operator opts in, optionally to an allowlist of recipients. The NEAR cap below can't bound them:
// they move BTC/ETH/SOL or the NFT itself, not NEAR from the agent's account.
//   PUSAKA_ALLOW_OUTFLOWS=1   PUSAKA_ALLOWED_RECIPIENTS=alice.testnet,tb1q…,0xabc…
const ALLOWED = (process.env.PUSAKA_ALLOWED_RECIPIENTS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
function outflow(to) {
  if (process.env.PUSAKA_ALLOW_OUTFLOWS !== "1") throw new Error("Outflows are off: set PUSAKA_ALLOW_OUTFLOWS=1 (and ideally PUSAKA_ALLOWED_RECIPIENTS) to let this agent move a Pusaka or its assets.");
  if (ALLOWED.length && !ALLOWED.includes(String(to).trim().toLowerCase())) throw new Error(`${to} isn't in PUSAKA_ALLOWED_RECIPIENTS.`);
}

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
  const heir = await view("heir_of", { token_id }).catch(() => null);
  if (heir) out.heir = { ...heir, note: "if the holder doesn't check in by claimable_from_ms, this account can claim the Pusaka; a sale clears it" };
  if (px) out.usd = { btc_inside: (verified / 1e8) * px.btcUsd, btc_usd: px.btcUsd, near_usd: px.nearUsd, source: px.crossChecked ? "mempool.space, Rhea; cross-checked with CoinGecko (mainnet prices)" : "mempool.space, Rhea (mainnet prices; second source unavailable)" };
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
    out.evm = await Promise.all(EVM_CHAINS.map(async (c) => {
      const floor = await view("eth_nonce_floor", { token_id, chain_id: String(c.chain.id) });
      const e = await evmBalances(addr, floor, c.chain.id).catch(() => null);
      return e ? { chain: c.chain.name, chain_id: c.chain.id, address: addr, safe_wei: e.safe, at_risk_wei: e.atRisk, usdc_safe: e.usdcSafe, usdc_at_risk: e.usdcAtRisk }
        : { chain: c.chain.name, error: "unreachable" };
    }));
    // Attested by NEAR MPC (foreign-tx verification) and counted on-chain: needs no EVM RPC to trust.
    out.usdc_verified = (await view("usdc_info", { token_id }).catch(() => [])).map((x) => ({
      chain: x.chain, chain_id: Number(x.chain_id), verified_usdc: Number(x.verified) / 1e6, proven_deposits: x.deposits.length,
      note: "proven by NEAR MPC reading the chain, minus all USDC this contract ever signed out",
    }));
  }
  // The Ed25519 MPC key: a Solana address and the Pusaka's own NEAR implicit account.
  const [sol, nearAcct] = await Promise.all([
    solAddress(token_id).then((a) => solBalances(a, info.history).then((b) => ({ address: a, safe_lamports: b.safe, at_risk_lamports: b.atRisk }))).catch(() => null),
    nearAccount(token_id).then(async (a) => {
      const b = await nearBalances(a, await view("near_nonce_floor", { token_id }));
      const floor = await view("near_nonce_floor", { token_id });
      const n = await nbtcBalances(a, floor).catch(() => null);
      return { account: a, safe_yocto: b.safe, at_risk_yocto: b.atRisk, nbtc_safe_sats: n && Number(n.safe), nbtc_at_risk_sats: n && Number(n.atRisk) };
    }).catch(() => null),
  ]);
  if (sol) out.sol = sol;
  if (nearAcct) out.near_account = nearAcct;
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
  const px = await prices();
  if (!px.crossChecked) throw new Error("Prices could not be cross-checked against a second source; not funding on one source.");
  const st = loanStats(l, Number(info.verified_sats), px);
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
  outflow(to);
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

const accountExists = (accountId) => provider.viewAccount({ accountId, blockQuery: { finality: "final" } }).then(() => true, () => false);

reg("pusaka_give", {
  description: "Give your Pusaka to another NEAR account: the NFT and everything it controls (BTC, ETH, SOL, its NEAR account, the letter) move in one transaction. Refuses accounts that don't exist, since a Pusaka sent to an account nobody controls is lost.",
  inputSchema: { token_id: z.string(), to: z.string() },
}, tool(async ({ token_id, to }) => {
  outflow(to);
  const receiver = to.trim().toLowerCase();
  if (!(await accountExists(receiver))) throw new Error(`${receiver} doesn't exist on NEAR ${NETWORK}.`);
  await call("nft_transfer", { receiver_id: receiver, token_id, memo: "given by an agent through Pusaka MCP" }, { deposit: 1n, tgas: 50 });
  return { given: token_id, owner: (await view("token_info", { token_id })).token.owner_id };
}));

reg("pusaka_set_heir", {
  description: "Name an heir for your Pusaka: if you stay silent (no check-in) for `days`, the heir can claim the NFT and everything it controls. heir: null removes it. Selling or giving the Pusaka cancels it. Testnet minimum is 10 minutes (0.007 days), mainnet 30 days.",
  inputSchema: { token_id: z.string(), heir: z.string().nullable(), days: z.number().positive() },
}, tool(async ({ token_id, heir, days }) => {
  const to = heir?.trim().toLowerCase() ?? null;
  if (to) {
    outflow(to); // naming who may take the Pusaka is as strong as giving it
    if (!(await accountExists(to))) throw new Error(`${to} doesn't exist on NEAR ${NETWORK}.`);
  }
  await call("set_heir", { token_id, heir: to, after_ms: String(Math.round(days * 86_400_000)) }, { deposit: 10_000_000_000_000_000_000_000n });
  return { token_id, heir: await view("heir_of", { token_id }) };
}));

reg("pusaka_still_here", {
  description: "Check in as the holder of a Pusaka with an heir: restarts the heir's waiting period. Run it on a schedule to keep a Pusaka from passing on while you are around.",
  inputSchema: { token_id: z.string() },
}, tool(async ({ token_id }) => {
  await call("still_here", { token_id });
  return { token_id, heir: await view("heir_of", { token_id }) };
}));

reg("pusaka_claim_inheritance", {
  description: "Claim a Pusaka you were named heir of, once its holder has been silent past claimable_from_ms. Its open listing or loan request is withdrawn; a funded loan's lender comes first.",
  inputSchema: { token_id: z.string() },
}, tool(async ({ token_id }) => {
  const h = await view("heir_of", { token_id });
  if (!h) throw new Error(`Pusaka #${token_id} has no heir.`);
  if (Date.now() < Number(h.claimable_from_ms)) throw new Error(`Not yet: claimable from ${new Date(Number(h.claimable_from_ms)).toISOString()}.`);
  await call("claim_inheritance", { token_id });
  return { inherited: token_id, owner: (await view("token_info", { token_id })).token.owner_id };
}));

reg("pusaka_withdraw_eth", {
  description: `Send ETH or USDC out of your Pusaka on an EVM chain (${EVM_CHAINS.map((c) => `${c.chain.id} ${c.chain.name}`).join(", ")}). The contract builds the EIP-1559 transaction, NEAR MPC signs it with the same key that holds the BTC, this server checks the signature recovers to the Pusaka's address and broadcasts.`,
  inputSchema: { token_id: z.string(), to: z.string(), amount: z.number().positive(), chain_id: z.number().int().optional(), usdc: z.boolean().optional() },
}, tool(async ({ token_id, to, amount, chain_id = EVM_CHAINS[0].chain.id, usdc = false }) => {
  outflow(to);
  const c = EVM_CHAINS.find((x) => x.chain.id === chain_id);
  if (!c) throw new Error(`chain_id must be one of ${EVM_CHAINS.map((x) => x.chain.id).join(", ")}`);
  to = to.trim();
  if (!isAddress(to)) throw new Error(`${to} isn't an EVM address (or its mixed-case checksum is wrong)`);
  const info = await view("token_info", { token_id });
  const from = evmAddress(info.btc_pubkey);
  const erc20 = usdc ? c.usdc : undefined;
  const value = usdc ? parseUnits(String(amount), 6) : parseEther(String(amount));
  if (value <= 0n) throw new Error(`${amount} rounds to 0 ${usdc ? "USDC (6 decimals)" : "ETH"}`);
  const bal = await evmBalances(from, await view("eth_nonce_floor", { token_id, chain_id: String(chain_id) }), chain_id);
  if (usdc ? BigInt(bal.usdc) < value : BigInt(bal.wei) < value) throw new Error(`Pusaka #${token_id} holds ${usdc ? `${bal.usdc} USDC units` : `${bal.wei} wei`} on ${c.chain.name}`);
  const tx = evmTx({ ...(await evmTxParams(from, chain_id, erc20)), erc20, to, value });
  const deposit = 20_000_000_000_000_000_000_000n;
  spend(deposit, "withdraw_eth");
  const signed = await call("withdraw_eth", {
    token_id, chain_id: String(chain_id), nonce: String(tx.nonce), to, value_wei: String(value), gas_limit: String(tx.gas),
    max_fee_per_gas: String(tx.maxFeePerGas), max_priority_fee_per_gas: String(tx.maxPriorityFeePerGas), ...(erc20 && { erc20 }),
  }, { deposit, tgas: 150 });
  const hash = await broadcastEth(await finalizeEth(tx, signed, from), chain_id);
  return { tx: hash, explorer: `${c.explorer}/tx/${hash}`, from };
}));

reg("pusaka_withdraw_sol", {
  description: "Send SOL out of your Pusaka (its Ed25519 MPC key is a Solana address). The contract builds a plain System transfer, NEAR MPC signs it, this server broadcasts.",
  inputSchema: { token_id: z.string(), to: z.string(), sol: z.number().positive() },
}, tool(async ({ token_id, to, sol }) => {
  outflow(to);
  if (!isSolAddress(to)) throw new Error(`${to} isn't a Solana address`);
  const from = await solAddress(token_id);
  const info = await view("token_info", { token_id });
  const lamports = BigInt(Math.round(sol * 1e9));
  const bal = await solBalances(from, info.history);
  if (BigInt(bal.lamports) < lamports) throw new Error(`Pusaka #${token_id} holds ${bal.lamports} lamports`);
  spend(1n, "withdraw_sol");
  const signed = await call("withdraw_sol", { token_id, to, lamports: String(lamports), recent_blockhash: await solBlockhash() }, { deposit: 1n, tgas: 300 });
  if (signed.from !== from) throw new Error(`contract signed for ${signed.from}, expected ${from}`);
  const sig = await broadcastSol(finalizeSol(signed));
  return { tx: sig, explorer: SOL.explorer(`tx/${sig}`), from };
}));

reg("pusaka_withdraw_near", {
  description: "Send NEAR out of your Pusaka's own NEAR account (an implicit account of its Ed25519 MPC key). The contract only ever signs a single Transfer from it.",
  inputSchema: { token_id: z.string(), to: z.string(), near: z.number().positive() },
}, tool(async ({ token_id, to, near }) => {
  outflow(to);
  const receiver = to.trim().toLowerCase();
  if (!(await accountExists(receiver))) throw new Error(`${receiver} doesn't exist on NEAR ${NETWORK}.`);
  const acct = await nearAccount(token_id);
  const { nonce, blockHash } = await nearTxParams(acct);
  const deposit = 10_000_000_000_000_000_000_000n;
  spend(deposit, "withdraw_near");
  const signed = await call("withdraw_near", { token_id, receiver_id: receiver, amount: toYocto(near).toString(), nonce: String(nonce), block_hash: blockHash },
    { deposit, tgas: 300 });
  if (signed.account !== acct) throw new Error(`contract signed for ${signed.account}, expected ${acct}`);
  const hash = await broadcastNear(await finalizeNear(signed));
  return { tx: hash, explorer: `${NEAR_EXPLORER}/tx/${hash}`, from: acct };
}));

reg("pusaka_withdraw_nbtc", {
  description: `Send nBTC (Omni Bridge NEP-141) from your Pusaka's own NEAR account. The contract signs one ft_transfer on ${NBTC}; the receiver must be registered with it.`,
  inputSchema: { token_id: z.string(), to: z.string(), sats: z.number().int().positive() },
}, tool(async ({ token_id, to, sats }) => {
  outflow(to);
  const receiver = to.trim().toLowerCase();
  if (!(await provider.callFunction({ contractId: NBTC, method: "storage_balance_of", args: { account_id: receiver } }))) throw new Error(`${receiver} isn't registered with ${NBTC}`);
  const acct = await nearAccount(token_id);
  const have = BigInt(await provider.callFunction({ contractId: NBTC, method: "ft_balance_of", args: { account_id: acct } }));
  if (have < BigInt(sats)) throw new Error(`Pusaka #${token_id} holds ${have} nBTC sats`);
  const { nonce, blockHash } = await nearTxParams(acct);
  const deposit = 10_000_000_000_000_000_000_000n;
  spend(deposit, "withdraw_nbtc");
  const signed = await call("withdraw_nbtc", { token_id, receiver_id: receiver, sats: String(sats), nonce: String(nonce), block_hash: blockHash }, { deposit, tgas: 300 });
  if (signed.account !== acct) throw new Error(`contract signed for ${signed.account}, expected ${acct}`);
  const hash = await broadcastNear(await finalizeNear(signed));
  return { tx: hash, explorer: `${NEAR_EXPLORER}/tx/${hash}`, from: acct };
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
