// "Clean to buy": whether anything the seller already signed could still move what a buyer pays for, chain by chain.
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
  if (eth) {
    const bad = eth.chains.filter((b) => b.atRisk > 0n || b.usdcAtRisk > 0n).map((b) => b.c.chain.name);
    const unknown = eth.chains.some((b) => b.error);
    out.push({ ok: bad.length ? false : unknown ? null : true, what: "No signed EVM transaction still unused (ETH, USDC)", detail: bad.length ? `pending on ${bad.join(", ")}` : unknown ? "some chains didn't answer" : `${eth.chains.length} chains checked` });
  }
  if (sol) out.push({ ok: sol.error ? null : !(sol.atRisk > 0n), what: "No SOL transfer signed in the last few minutes", detail: sol.error ? "Solana didn't answer" : sol.atRisk > 0n ? "one is still valid" : "none" });
  if (nearAcct) out.push({ ok: nearAcct.error ? null : !(nearAcct.atRisk > 0n), what: "No signed transaction from its NEAR account still unused (NEAR, nBTC)", detail: nearAcct.error ? "NEAR didn't answer" : nearAcct.atRisk > 0n ? `nonce ${nearAcct.floor} not used yet` : "none" });
  out.push({ ok: !info.loan?.lender, what: "Not collateral for a loan", detail: info.loan?.lender ? `the lender ${info.loan.lender} can claim it if it isn't repaid` : "no funded loan" });
  const approvals = Object.keys(info.token.approved_account_ids ?? {});
  out.push({ ok: true, what: "Approvals, heir and agent end at the sale", detail: approvals.length ? `${approvals.join(", ")} approved now; the contract clears every approval and the heir on transfer` : "the contract clears them on every transfer" });
  return out;
}

/** "clean" | "risk" | "unknown" */
export const verdict = (checks) => checks.some((c) => c.ok === false) ? "risk" : checks.some((c) => c.ok === null) ? "unknown" : "clean";
