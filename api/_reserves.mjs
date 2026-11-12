// Proof of reserves straight from the contract: every Pusaka, its BTC address and the deposits
// NEAR's Bitcoin light client proved. Shared by api/reserves.mjs and api/badge.mjs.
import { FailoverRpcProvider, JsonRpcProvider } from "near-api-js";
import { CONTRACT, SIBLINGS, NBTC, NETWORK, BTC_LIGHT_CLIENT, btcAddress, nearProvider } from "@pusaka/shared";

const provider = nearProvider({ FailoverRpcProvider, JsonRpcProvider });
const view = (method, args, contractId = CONTRACT) => provider.callFunction({ contractId, method, args, blockQuery: { finality: "final" } });

export async function tokenReserve(id, c = CONTRACT) {
  const i = await view("token_info", { token_id: String(id) }, c);
  if (!i) return null;
  return {
    contract: c,
    token_id: i.token.token_id,
    owner: i.token.owner_id,
    btc_address: i.btc_pubkey ? btcAddress(i.btc_pubkey) : null,
    verified_sats: Number(i.verified_sats),
    proven_utxos: i.proven_utxos,
    signed_outpoints: i.signed_outpoints.length,
    locked: !!(i.listing || i.loan || i.pending || Object.keys(i.token.approved_account_ids ?? {}).length),
  };
}

/** The main contract and its frozen classic sibling(s): the Bitcoin of a classic Pusaka wrapped in a Smart one is listed once, under the classic contract. */
export async function reserves() {
  const list = [];
  for (const c of [CONTRACT, ...SIBLINGS]) {
    const tokens = await view("nft_tokens", { from_index: "0", limit: 100 }, c);
    list.push(...(await Promise.all(tokens.map((t) => tokenReserve(t.token_id, c)))).filter(Boolean));
  }
  const sum = (xs) => xs.reduce((s, t) => s + t.verified_sats, 0);
  // nBTC (Omni Bridge) in Smart Pusakas' own accounts: Bitcoin on NEAR they can redeem to their own address. Listed apart:
  // it rests on the Omni connector, not on this contract's light-client proofs.
  const nbtc = SIBLINGS.length ? (await Promise.all(list.filter((t) => t.contract === CONTRACT).map(async (t) => {
    const acct = await view("account_of", { token_id: t.token_id }).catch(() => null);
    const sats = acct ? Number(await view("ft_balance_of", { account_id: acct }, NBTC).catch(() => 0)) : 0;
    return sats ? { token_id: t.token_id, account: acct, nbtc_sats: sats } : null;
  }))).filter(Boolean) : [];
  return {
    network: NETWORK, contract: CONTRACT, siblings: SIBLINGS, light_client: BTC_LIGHT_CLIENT, at: new Date().toISOString(),
    total_verified_sats: sum(list),
    nbtc: { total_sats: nbtc.reduce((s, x) => s + x.nbtc_sats, 0), token: NBTC, accounts: nbtc },
    by_contract: Object.fromEntries([CONTRACT, ...SIBLINGS].map((c) => [c, sum(list.filter((t) => t.contract === c))])),
    how_to_check: "verified_sats counts only deposits proven by the light client and never signed for; recompute with view token_info on the contract",
    tokens: list,
  };
}
