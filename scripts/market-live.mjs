// Live: the Pusaka market (pusaka-market.testnet) against the original contract (pusaka-btc.testnet), testnet.
//   node scripts/market-live.mjs bid <bidder> <seller> <token_id> <near_per_10k_sats>
//       the bidder posts a standing bid per verified sat; first a bid the token can't meet (min above its sats) is
//       tried and refused on-chain by the market, then the seller sells into the real one with nft_approve
//   node scripts/market-live.mjs loan <lender> <borrower> <token_id> <principal_near> <rate_bps>
//       a perpetual loan: the borrower takes the lender's offer with nft_transfer_call; the market holds the NFT
//   node scripts/market-live.mjs call <lender> <loan_id>          the lender calls it: a 30-minute refinancing auction
//   node scripts/market-live.mjs refinance <new_lender> <loan_id> the new lender takes it over at the auction's rate
//   node scripts/market-live.mjs repay <payer> <loan_id>          principal + interest; the NFT goes back to the borrower
//   node scripts/market-live.mjs seize <lender> <loan_id>         after an auction nobody took: the NFT goes to the lender
import { account, callRaw, view, NEAR_EXPLORER } from "./lib.mjs";

const MARKET = process.env.PUSAKA_MARKET ?? "pusaka-market.testnet";
const NFT = "pusaka-btc.testnet";
const near = (n) => BigInt(Math.round(Number(n) * 1e6)) * 10n ** 18n;
const STORAGE = 10n ** 22n;
const link = (o) => `${NEAR_EXPLORER}/tx/${o.transaction.hash}`;
const ret = (o) => JSON.parse(Buffer.from(o.status.SuccessValue ?? "bnVsbA==", "base64").toString() || "null");
const logs = (o) => o.receipts_outcome.flatMap((r) => r.outcome.logs).filter((l) => l.includes("pusaka-market")).map((l) => JSON.parse(l.slice(11)));
const owner = async (id) => (await view("nft_token", { token_id: id }, NFT)).owner_id;
const [step, ...args] = process.argv.slice(2);

if (step === "bid") {
  const [bidder, seller, token_id, per10k] = args;
  const info = await view("token_info", { token_id }, NFT);
  const sats = BigInt(info.verified_sats);
  const perSat = near(per10k) / 10_000n;
  const place = async (min, max) => {
    const o = await callRaw(account(bidder), "place_bid", { price_per_sat_yocto: String(perSat), min_sats: String(min), max_sats: String(max), nft: NFT },
      { deposit: perSat * max + STORAGE, tgas: 30, receiver: MARKET });
    return { id: ret(o), o };
  };
  // 1. a bid only a fuller Pusaka could fill: the market reads verified_sats on-chain and refuses
  const high = await place(sats + 1n, sats * 2n);
  const a1 = await callRaw(account(seller), "nft_approve", { token_id, account_id: MARKET, msg: JSON.stringify({ bid_id: high.id }) }, { deposit: 10n ** 21n, tgas: 300, receiver: NFT });
  const why = logs(a1).find((e) => e.event === "bid_fill_failed");
  if (!why || (await owner(token_id)) !== seller) throw new Error("the out-of-range bid should not have filled");
  console.log(`refused: #${token_id} holds ${sats} sats, bid ${high.id} wants more than that: ${why.data[0].reason}: ${link(a1)}`);
  await callRaw(account(seller), "nft_revoke_all", { token_id }, { deposit: 1n, tgas: 30, receiver: NFT });
  await callRaw(account(bidder), "cancel_bid", { bid_id: high.id }, { tgas: 30, receiver: MARKET });
  // 2. the real bid: any Pusaka with 1,000 to 2x these sats, priced per sat
  const bid = await place(1_000n, sats * 2n);
  console.log(`bid ${bid.id}: ${per10k} NEAR per 10,000 verified sats, escrowed: ${link(bid.o)}`);
  const a2 = await callRaw(account(seller), "nft_approve", { token_id, account_id: MARKET, msg: JSON.stringify({ bid_id: bid.id }) }, { deposit: 10n ** 21n, tgas: 300, receiver: NFT });
  const filled = logs(a2).find((e) => e.event === "bid_filled");
  if (!filled || (await owner(token_id)) !== bidder) throw new Error(`bid did not fill: ${JSON.stringify(logs(a2))}`);
  console.log(`sold into the bid: #${token_id} (${sats} sats) to ${bidder} for ${Number(BigInt(filled.data[0].price)) / 1e24} NEAR: ${link(a2)}`);
} else if (step === "loan") {
  const [lender, borrower, token_id, principal, rate] = args;
  const sats = (await view("token_info", { token_id }, NFT)).verified_sats;
  const off = await callRaw(account(lender), "offer_loan", { principal: String(near(principal)), rate_bps_per_year: Number(rate), nft: NFT, min_sats: sats },
    { deposit: near(principal) + STORAGE, tgas: 30, receiver: MARKET });
  const offer_id = ret(off);
  console.log(`offer ${offer_id}: ${principal} NEAR at ${rate / 100}%/yr, no due date, against >= ${sats} sats: ${link(off)}`);
  const t = await callRaw(account(borrower), "nft_transfer_call", { receiver_id: MARKET, token_id, msg: JSON.stringify({ accept_offer: offer_id }) },
    { deposit: 1n, tgas: 150, receiver: NFT });
  const started = logs(t).find((e) => e.event === "loan_started");
  if (!started || (await owner(token_id)) !== MARKET) throw new Error(`loan did not start: ${JSON.stringify(logs(t))}`);
  console.log(`loan ${started.data[0].loan.id}: the market holds #${token_id} (its BTC can't move), ${borrower} got ${principal} NEAR: ${link(t)}`);
} else {
  const [who, id] = args;
  const loan = await view("loan", { loan_id: id }, MARKET);
  if (!loan) throw new Error(`no loan ${id}`);
  const m = { call: ["call_loan", {}, 0n], seize: ["seize", {}, 0n],
    refinance: ["refinance", { rate_bps: loan.auction_rate_bps }, BigInt(loan.debt) * 101n / 100n + STORAGE],
    repay: ["repay", {}, BigInt(loan.debt) * 101n / 100n] }[step];
  if (!m) throw new Error("step: bid | loan | call | refinance | repay | seize");
  const o = await callRaw(account(who), m[0], { loan_id: id, ...m[1] }, { deposit: m[2], tgas: 150, receiver: MARKET });
  console.log(`${step} loan ${id}: ${logs(o).map((e) => e.event).join(", ")}; #${loan.loan.token_id} is with ${await owner(loan.loan.token_id)}: ${link(o)}`);
  console.log(JSON.stringify(await view("loan", { loan_id: id }, MARKET)));
}
