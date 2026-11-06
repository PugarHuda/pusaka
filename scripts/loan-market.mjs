// The loan market, live: a lender posts a standing offer for any Pusaka with >= 10,000 verified sats; a holder takes
// it; a third party offers better terms and the borrower refinances into them; the borrower repays part, takes an
// extension, then repays the rest.
//   node loan-market.mjs <lender> <borrower> <refinancer> <token_id>
// The token must be the borrower's, free (not listed, no loan) and hold >= 10,000 verified sats.
import { parseNearAmount } from "near-api-js";
import { account, call, callRaw, view, NEAR_EXPLORER } from "./lib.mjs";

const [lenderId, borrowerId, refiId, tokenId] = process.argv.slice(2);
if (!tokenId) throw new Error("usage: node loan-market.mjs <lender> <borrower> <refinancer> <token_id>");
const [lender, borrower, refi] = [lenderId, borrowerId, refiId].map(account);
const N = (x) => BigInt(parseNearAmount(x));
const tx = (o) => `${NEAR_EXPLORER}/tx/${o.transaction.hash}`;
const refused = async (label, p, re) => {
  try { await p; throw new Error(`UNEXPECTED: ${label} went through`); }
  catch (e) { if (e.message.startsWith("UNEXPECTED")) throw e; if (!re.test(e.message)) throw e; console.log(`refused ${label}: ${e.message.match(re)[0]}`); }
};

// 1. a standing offer: any Pusaka with at least 10,000 sats proven by the light client
const o = await callRaw(lender, "offer_loan", { min_verified_sats: "10000", principal: N("0.3").toString(), repay: N("0.31").toString(), duration_ms: String(86_400_000) }, { deposit: N("0.31") });
const offers = (await view("loan_offers", {})).offers;
const offer = offers.at(-1);
console.log(`1. ${lenderId} offers 0.3 NEAR (repay 0.31 in 1 day) to any Pusaka with >= 10,000 verified sats, offer ${offer.id}: ${tx(o)}`);

// 2. the holder takes it
let info = await view("token_info", { token_id: tokenId });
await refused("accept with a stale sign epoch", call(borrower, "accept_loan_offer", { token_id: tokenId, offer_id: offer.id, expected_sign_epoch: info.sign_epoch + 1 }), /StateChanged|EpochChanged|sign epoch|epoch/i);
const a = await callRaw(borrower, "accept_loan_offer", { token_id: tokenId, offer_id: offer.id, expected_sign_epoch: info.sign_epoch });
info = await view("token_info", { token_id: tokenId });
console.log(`2. ${borrowerId} took it for #${tokenId}: lender ${info.loan.lender}, due ${new Date(Number(info.loan.due_ms)).toISOString()}: ${tx(a)}`);
await refused("the same offer twice", call(borrower, "accept_loan_offer", { token_id: tokenId, offer_id: offer.id, expected_sign_epoch: info.sign_epoch }), /NoOffer/);

// 3. a third party offers cheaper, longer terms; the borrower refinances into them, paying the first lender in full
const ro = await callRaw(refi, "offer_loan", { token_id: tokenId, principal: N("0.3").toString(), repay: N("0.305").toString(), duration_ms: String(2 * 86_400_000) }, { deposit: N("0.31") });
const better = (await view("loan_offers", {})).offers.at(-1);
info = await view("token_info", { token_id: tokenId });
await refused("a refinance that doesn't pay off the 0.31 owed", call(borrower, "accept_loan_offer", { token_id: tokenId, offer_id: better.id, expected_sign_epoch: info.sign_epoch }), /doesn't cover[^"]*/);
const r = await callRaw(borrower, "accept_loan_offer", { token_id: tokenId, offer_id: better.id, expected_sign_epoch: info.sign_epoch }, { deposit: N("0.01") });
info = await view("token_info", { token_id: tokenId });
console.log(`3. ${refiId} offered 0.3 for 0.305 over 2 days (${tx(ro)}); ${borrowerId} refinanced into it, adding 0.01 so ${lenderId} got 0.31: lender ${info.loan.lender}, due ${new Date(Number(info.loan.due_ms)).toISOString()}: ${tx(r)}`);

// 4. part repayment, then an extension the new lender proposes
const p = await callRaw(borrower, "repay_partial", { token_id: tokenId }, { deposit: N("0.1") });
info = await view("token_info", { token_id: tokenId });
console.log(`4. ${borrowerId} repaid 0.1: ${Number(BigInt(info.loan.repay) / 10n ** 21n) / 1000} NEAR left: ${tx(p)}`);
const x = await callRaw(refi, "propose_extension", { token_id: tokenId, extra_ms: String(86_400_000), fee: N("0.001").toString() }, { deposit: N("0.01") });
await refused("an extension the borrower didn't see", call(borrower, "accept_extension", { token_id: tokenId, extra_ms: String(7 * 86_400_000) }, { deposit: N("0.001") }), /TermsChanged/);
const ax = await callRaw(borrower, "accept_extension", { token_id: tokenId, extra_ms: String(86_400_000) }, { deposit: N("0.001") });
info = await view("token_info", { token_id: tokenId });
console.log(`5. ${refiId} proposed +1 day for 0.001 (${tx(x)}); ${borrowerId} accepted, due ${new Date(Number(info.loan.due_ms)).toISOString()}: ${tx(ax)}`);

// 6. repay the rest: the Pusaka is free again
const rest = BigInt(info.loan.repay);
const f = await callRaw(borrower, "repay_loan", { token_id: tokenId }, { deposit: rest });
info = await view("token_info", { token_id: tokenId });
console.log(`6. ${borrowerId} repaid the rest; loan: ${info.loan}: ${tx(f)}`);
