// One Pusaka as a share card: its on-chain image (the contract draws it), the BTC inside and what it's doing.
// Used by api/og.mjs (the PNG) and api/share.mjs (the page crawlers read).
import { FailoverRpcProvider, JsonRpcProvider } from "near-api-js";
import { CONTRACT, nearProvider } from "@pusaka/shared";

const provider = nearProvider({ FailoverRpcProvider, JsonRpcProvider });
const view = (method, args) => provider.callFunction({ contractId: CONTRACT, method, args, blockQuery: { finality: "final" } });
const near = (y) => (Number(BigInt(y) / 10n ** 18n) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 4 });

/** "07" is token 7; anything else that isn't a token number is null. */
export const tokenId = (raw) => {
  const id = String(raw ?? "").replace(/^0+(?=\d)/, "");
  return /^\d{1,10}$/.test(id) ? id : null;
};

export async function card(id) {
  const [info, token] = await Promise.all([view("token_info", { token_id: id }), view("nft_token", { token_id: id })]);
  if (!info || !token) return null;
  const sats = Number(info.verified_sats);
  const status = info.listing ? `For sale at ${near(info.price_now ?? info.listing.price)} NEAR`
    : info.loan?.lender ? "Collateral for a loan"
    : info.loan ? `Asking to borrow ${near(info.loan.principal)} NEAR`
    : Object.keys(info.token.approved_account_ids ?? {}).length ? "On sale on Mintbase"
    : `Held by ${info.token.owner_id}`;
  return {
    id, sats, status, owner: info.token.owner_id,
    btc: `${(sats / 1e8).toFixed(8)} BTC`,
    image: token.metadata?.media ?? null, // data:image/svg+xml;base64,... drawn by the contract
    description: token.metadata?.description ?? "",
  };
}
