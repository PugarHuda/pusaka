// The contract panics with short codes ("NotOwner"); people get a sentence, with the code kept for support.
// Codes that already carry an explanation ("Approved: call nft_revoke_all first") pass through unchanged.
const SAY = {
  NotOwner: "Only the current holder of this Pusaka can do that.",
  PqLocked: "This Pusaka has a post-quantum lock: sign an unlock with its ML-DSA-65 key first.",
  PqBadSignature: "That unlock isn't signed by the post-quantum key registered for this Pusaka.",
  NoAgent: "This Pusaka has no agent budget (none set, or the holder revoked it).",
  AgentBudget: "That's more than the agent's budget has left today.",
  NotAgent: "Only the agent the holder named can spend this budget.",
  AgentReceiver: "The holder's budget only allows paying the accounts they listed.",
  NoToken: "There is no such Pusaka.",
  TokenNotFound: "There is no such Pusaka.",
  Listed: "This Pusaka is listed for sale; cancel the listing first.",
  NotListed: "This Pusaka isn't for sale any more.",
  SignPending: "A signature for this Pusaka is still in flight; wait a few seconds and try again.",
  TransferCallPending: "This Pusaka is waiting for a receiving contract to answer; try again shortly.",
  Collateralised: "This Pusaka is collateral for a loan; repay the loan first.",
  KeyNotReady: "This Pusaka's MPC key isn't ready yet; wait a moment and reload.",
  KeyAlreadySet: "This Pusaka already has its key.",
  NoKey: "This Pusaka has no key for that chain yet.",
  InsufficientDeposit: "The NEAR attached doesn't cover this; the price or deposit has changed. Reload and try again.",
  SelfBuy: "You already own this Pusaka.",
  SelfLoan: "You can't lend to yourself.",
  NoLoan: "There is no loan on this Pusaka.",
  LoanNotFunded: "Nobody has funded this loan yet.",
  LoanAlreadyFunded: "Someone has already funded this loan.",
  NotLender: "Only the lender of this loan can do that.",
  NotBorrower: "Only the borrower can do that.",
  NotDueYet: "The loan isn't overdue yet.",
  NoOffer: "That loan offer is gone (taken or cancelled).",
  OfferForAnotherToken: "That loan offer is for a different Pusaka.",
  BelowSatsFloor: "This Pusaka holds less verified Bitcoin than the offer requires.",
  NoExtension: "There is no extension proposal to accept.",
  NoCkdLetter: "This Pusaka has no sealed letter.",
  NotPending: "Nothing is stuck on this Pusaka.",
  EvmAddressKnown: "This Pusaka's EVM address is already recorded.",
  NotUpgradeAdmin: "Only the upgrade council can do that.",
  NoUpgradeProposed: "No upgrade has been announced.",
  OnlyTheContractItself: "Only the contract itself can call that.",
};

/** "NotOwner" → "Only the current holder… (NotOwner)"; anything else is returned as it came. */
export function explain(message) {
  const code = /^[A-Z][A-Za-z]+$/.test(message) ? message : null;
  if (code && SAY[code]) return `${SAY[code]} (${code})`;
  // "claimable from 1793986788279 ms" → a date a person can read
  return message.replace(/\b(\d+) yoctoNEAR\b/g, (_, y) => `${Number(y) / 1e24} NEAR`).replace(/\b(\d{13}) ms\b/g, (_, ms) => new Date(Number(ms)).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }));
}
