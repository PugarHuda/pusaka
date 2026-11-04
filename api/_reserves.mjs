// Proof of reserves straight from the contract: every Pusaka, its BTC address and the deposits
// NEAR's Bitcoin light client proved. Shared by api/reserves.mjs and api/badge.mjs.
import { FailoverRpcProvider, JsonRpcProvider } from "near-api-js";
import { CONTRACT, NETWORK, BTC_LIGHT_CLIENT, btcAddress, nearProvider } from "@pusaka/shared";

const provider = nearProvider({ FailoverRpcProvider, JsonRpcProvider });
const view = (method, args) => provider.callFunction({ contractId: CONTRACT, method, args, blockQuery: { finality: "final" } });

export async function tokenReserve(id) {
  const i = await view("token_info", { token_id: String(id) });
  if (!i) return null;
  return {
    token_id: i.token.token_id,
    owner: i.token.owner_id,
    btc_address: i.btc_pubkey ? btcAddress(i.btc_pubkey) : null,
    verified_sats: Number(i.verified_sats),
    proven_utxos: i.proven_utxos,
    signed_outpoints: i.signed_outpoints.length,
    locked: !!(i.listing || i.loan || i.pending || Object.keys(i.token.approved_account_ids ?? {}).length),
  };
}

export async function reserves() {
  const tokens = await view("nft_tokens", { from_index: "0", limit: 100 });
  const list = (await Promise.all(tokens.map((t) => tokenReserve(t.token_id)))).filter(Boolean);
  return {
    network: NETWORK, contract: CONTRACT, light_client: BTC_LIGHT_CLIENT, at: new Date().toISOString(),
    total_verified_sats: list.reduce((s, t) => s + t.verified_sats, 0),
    how_to_check: "verified_sats counts only deposits proven by the light client and never signed for; recompute with view token_info on the contract",
    tokens: list,
  };
}
