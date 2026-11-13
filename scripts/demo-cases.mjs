// More real on-chain demo history, case by case (classic contract pusaka-btc.testnet), each step printing its tx.
//   PUSAKA_CONTRACT=pusaka-btc.testnet node scripts/demo-cases.mjs
// A step that doesn't apply any more (already done, state moved on) says so and the rest go on.
import { account, call, callRaw, view, NEAR_EXPLORER } from "./lib.mjs";

const C = "pusaka-btc.testnet";
const BUYER = "pusaka-buyer.testnet", SELLER = "pusaka-seller.testnet", HOLDER11 = "pusaka-w-mvzhtaw8.testnet";
const link = (o) => `${NEAR_EXPLORER}/tx/${o.transaction.hash}`;
const failed = (o) => JSON.stringify(o.receipts_outcome.map((r) => r.outcome.status)).match(/Failure[^}]*}/)?.[0];
const info = (id) => view("token_info", { token_id: id }, C);
const step = async (name, fn) => {
  try { console.log(`✓ ${name}: ${await fn()}`); } catch (e) { console.log(`· ${name}: skipped (${String(e.message ?? e).split("\n")[0].slice(0, 160)})`); }
};

// 1. A lender funds a standing loan request: the NEAR goes straight to the borrower, the Pusaka is locked as collateral.
await step("pusaka-seller funds #14's loan request", async () => {
  const i = await info("14");
  if (!i.loan || i.loan.lender) throw new Error("no open request on #14");
  const o = await callRaw(account(SELLER), "fund_loan", { token_id: "14", expected_sign_epoch: i.sign_epoch, principal: i.loan.principal,
    repay: i.loan.repay, duration_ms: i.loan.duration_ms }, { deposit: BigInt(i.loan.principal), receiver: C });
  return `${Number(BigInt(i.loan.principal) / 10n ** 21n) / 1000} NEAR lent against 10,000 sats ${failed(o) ?? link(o)}`;
});

// 2. A borrower repays in full: the lender is paid, the Pusaka unlocks.
await step("pusaka-buyer repays #12's loan", async () => {
  const i = await info("12");
  if (!i.loan?.lender) throw new Error("no funded loan on #12");
  const rest = BigInt(i.loan.repay) - BigInt(i.loan.repaid ?? 0);
  const o = await callRaw(account(BUYER), "repay_loan", { token_id: "12" }, { deposit: rest, receiver: C });
  return `${Number(rest / 10n ** 21n) / 1000} NEAR to ${i.loan.lender} ${failed(o) ?? link(o)}`;
});

// 3. A sale from the listing, then a sale into a standing bid on the per-sat market, then listed again.
await step("pusaka-seller buys #27 from its listing", async () => {
  const i = await info("27");
  if (!i.listing) throw new Error("#27 isn't listed");
  const price = BigInt(i.price_now ?? i.listing.price);
  const o = await callRaw(account(SELLER), "buy", { token_id: "27", expected_sign_epoch: i.sign_epoch }, { deposit: price, receiver: C });
  return `${Number(price / 10n ** 21n) / 1000} NEAR for 11,000 sats ${failed(o) ?? link(o)}`;
});

// 4. The USDC pool refuses collateral that can't cover its minimum loan; the NFT comes straight back.
await step("the USDC pool refuses #11 (1,400 sats) as collateral for 1 USDC", async () => {
  const usd = (await view("config", {}, "pusaka-lend.testnet")).stable;
  if (!(await view("storage_balance_of", { account_id: HOLDER11 }, usd)))
    await callRaw(account(HOLDER11), "storage_deposit", { account_id: HOLDER11, registration_only: true }, { deposit: 1_250_000_000_000_000_000_000n, receiver: usd, tgas: 30 });
  const o = await callRaw(account(HOLDER11), "nft_transfer_call", { receiver_id: "pusaka-lend.testnet", token_id: "11", msg: JSON.stringify({ borrow: "1000000" }) },
    { deposit: 1n, tgas: 300, receiver: C });
  const ev = o.receipts_outcome.flatMap((r) => r.outcome.logs).filter((l) => l.includes('"pusaka-lend"')).map((l) => JSON.parse(l.slice(11)));
  const no = ev.find((e) => e.event === "borrow_refused");
  const back = (await info("11")).token.owner_id === HOLDER11;
  return `${no ? `refused (${no.data[0].reason})` : "NOT refused"}, NFT back with its holder: ${back} ${link(o)}`;
});

// 5. An heir: if #11's holder goes silent for 30 days, pusaka-seller can claim it.
await step("#11's holder names an heir (30 days of silence)", async () => {
  const o = await callRaw(account(HOLDER11), "set_heir", { token_id: "11", heir: SELLER, after_ms: String(30 * 24 * 3600 * 1000) },
    { deposit: 10_000_000_000_000_000_000_000n, receiver: C });
  return `${failed(o) ?? link(o)}`;
});
