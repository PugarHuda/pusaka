import { CONTRACT, NETWORK } from "@pusaka/shared";
import { view } from "./near.js";

// FastNear's free NFT indexer (CORS-enabled); only used for the "also holds NFTs from" line
const NFT_API = NETWORK === "mainnet" ? "https://api.fastnear.com" : "https://test.api.fastnear.com";

/** Every Pusaka's token_info, oldest first. allSettled: one token that fails to load must not hide the rest. */
export async function loadInfos() {
  const ts = await view("nft_tokens", { from_index: "0", limit: 60 });
  const rs = await Promise.allSettled(ts.map((t) => view("token_info", { token_id: t.token_id })));
  return rs.filter((r) => r.status === "fulfilled" && r.value).map((r) => r.value);
}

/**
 * What one account has to do with Pusaka: the tokens it holds (NEP-181, from the contract), loans it
 * borrowed or lent, tokens naming it as heir, and other NEAR NFT contracts it holds (FastNear, or null).
 */
export async function loadMine(accountId) {
  const [owned, infos, others] = await Promise.all([
    view("nft_tokens_for_owner", { account_id: accountId, from_index: "0", limit: 100 }),
    loadInfos(),
    fetch(`${NFT_API}/v1/account/${encodeURIComponent(accountId)}/nft`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`FastNear answered ${r.status}`))))
      .then((j) => [...new Set(j.tokens.map((t) => t.contract_id))].filter((c) => c !== CONTRACT))
      .catch(() => null),
  ]);
  const byId = new Map(infos.map((i) => [i.token.token_id, i]));
  // ponytail: one heir_of per token, fine at tens of tokens; a contract index of heirs if it grows to thousands
  const heirs = await Promise.allSettled(infos.map((i) => view("heir_of", { token_id: i.token.token_id })));
  const num = (a, b) => Number(a.token.token_id) - Number(b.token.token_id);
  return {
    // nft_tokens_for_owner is the authority; a token past the gallery's first page is read on its own
    held: (await Promise.all(owned.map((t) => byId.get(t.token_id) ?? view("token_info", { token_id: t.token_id })))).filter(Boolean).sort(num),
    loans: infos.filter((i) => i.loan && (i.loan.borrower === accountId || i.loan.lender === accountId)).sort(num),
    heirOf: infos.flatMap((info, k) => (heirs[k].status === "fulfilled" && heirs[k].value?.heir === accountId ? [{ info, heir: heirs[k].value }] : [])),
    others,
    infos,
  };
}
