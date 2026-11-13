// "Clean to buy" (web token pages, verify.mjs, POST /api/verify): whether anything the seller already signed could still move what a buyer pays for, chain by chain.
// Built from what the token page already read (token_info, the Bitcoin explorer, each chain's nonce against the
// contract's signing floor). A check is { ok, what, detail }; ok === null means that chain couldn't be read.

/** `t`: the token page's state ({ info, bal, eth, sol, nearAcct }). */
export function cleanChecks({ info, bal, eth, sol, nearAcct }) {
  const out = [];
  const signed = info.signed_outpoints?.length ?? 0;
  out.push({ ok: !info.pending, what: "No Bitcoin signature in progress", detail: info.pending ? "the contract is signing a withdrawal right now" : "nothing being signed" });
  // a signed Bitcoin tx not yet on Bitcoin can only spend coins already left out of verified_sats: shown, not a risk
  const unspent = bal?.atRisk > 0 ? `; ${bal.atRisk.toLocaleString()} sats at its address have a signature out and aren't counted` : "";
  out.push({ ok: true, what: "Every coin it ever signed for is left out of the BTC shown", detail: `${signed} signed so far, recorded on NEAR${unspent}; a purchase fails if that record changes after you looked` });
  // a chain this Pusaka has a key on but that wasn't read yet is "unknown", never clean (fail closed)
  const unread = (what) => out.push({ ok: null, what, detail: "not read yet" });
  if (bal?.loading || bal?.error) out.push({ ok: null, what: "Its Bitcoin address read", detail: bal.loading ? "still reading Bitcoin" : "the Bitcoin explorers didn't answer" });
  if (info.btc_pubkey && !eth) unread("No signed EVM transaction still unused (ETH, USDC)");
  if (info.btc_pubkey && !sol) unread("No SOL transfer signed in the last few minutes");
  if (info.btc_pubkey && !nearAcct) unread("No signed transaction from its NEAR account still unused (NEAR, nBTC)");
  if (eth) {
    const bad = (eth.chains ?? []).filter((b) => b.atRisk > 0n || b.usdcAtRisk > 0n).map((b) => b.c.chain.name);
    const unknown = !eth.chains?.length || eth.chains.some((b) => b.error);
    out.push({ ok: bad.length ? false : unknown ? null : true, what: "No signed EVM transaction still unused (ETH, USDC)", detail: bad.length ? `pending on ${bad.join(", ")}` : unknown ? "some chains didn't answer" : `${eth.chains.length} chains checked` });
  }
  if (sol) out.push({ ok: sol.error ? null : !(sol.atRisk > 0n), what: "No SOL transfer signed in the last few minutes", detail: sol.error ? "Solana didn't answer" : sol.atRisk > 0n ? "one is still valid" : "none" });
  if (nearAcct) out.push({ ok: nearAcct.error ? null : !(nearAcct.atRisk > 0n), what: "No signed transaction from its NEAR account still unused (NEAR, nBTC)", detail: nearAcct.error ? "NEAR didn't answer" : nearAcct.atRisk > 0n ? `nonce ${nearAcct.floor} not used yet` : "none" });
  out.push({ ok: !info.loan?.lender, what: "Not collateral for a loan", detail: info.loan?.lender ? `the lender ${info.loan.lender} can claim it if it isn't repaid` : "no funded loan" });
  const approvals = Object.keys(info.token.approved_account_ids ?? {});
  out.push({ ok: true, what: "Approvals and the heir end at the sale", detail: approvals.length ? `${approvals.join(", ")} approved now; the contract clears every approval and the heir on transfer` : "the contract clears them on every transfer" });
  return out;
}

/** "clean" | "risk" | "unknown" */
export const verdict = (checks) => checks.some((c) => c.ok === false) ? "risk" : checks.some((c) => c.ok === null) ? "unknown" : "clean";

/**
 * The same checks, read straight from the chains (Node or browser): what an exchange, a CLI or a buyer's script gets.
 * `view(method, args, contract)` reads NEAR. Returns { verdict, checks, verified_sats, listed }.
 */
export async function cleanOf(token_id, contract, view) {
  const { balances, btcAddress, evmAddress, evmBalances, EVM_CHAINS, solAddress, solBalances, nearAccount, nearBalances } = await import("./btc.mjs");
  const info = await view("token_info", { token_id }, contract);
  if (!info) throw new Error(`no Pusaka #${token_id} on ${contract}`);
  const ethAddr = info.btc_pubkey && evmAddress(info.btc_pubkey);
  const [bal, chains, sol, nearAcct] = await Promise.all([
    info.btc_pubkey ? balances(btcAddress(info.btc_pubkey), info.signed_outpoints).catch(() => ({ error: true })) : { atRisk: 0 },
    ethAddr ? Promise.all(EVM_CHAINS.map(async (c) => {
      const floor = await view("eth_nonce_floor", { token_id, chain_id: String(c.chain.id) }, contract);
      return evmBalances(ethAddr, floor, c.chain.id).then((b) => ({ ...b, c })).catch(() => ({ c, error: true }));
    })).catch(() => null) : null,
    solAddress(token_id, contract).then((a) => solBalances(a, info.history)).catch(() => ({ error: true })),
    nearAccount(token_id, contract).then(async (a) => {
      const floor = await view("near_nonce_floor", { token_id }, contract);
      return { ...(await nearBalances(a, floor)), floor };
    }).catch(() => ({ error: true })),
  ]);
  const checks = cleanChecks({ info, bal, eth: chains && { chains }, sol, nearAcct });
  return { verdict: verdict(checks), checks, verified_sats: Number(info.verified_sats), listed: !!info.listing };
}
