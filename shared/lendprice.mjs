// BTC/USD for the lending pool (lend/, pusaka-lend.testnet): three reporters, each posting one independent source.
// The contract takes the 2 middle fresh reports (low side for borrowing, high side for liquidation); see lend/src/lib.rs.
// Used by scripts/lend.mjs (CLI, CI cron) and POST /api/prices (reports on use, so the price is fresh whenever someone
// opens a token page to borrow or liquidate).
export const LEND = "pusaka-lend.testnet";

const j = async (u) => { const r = await fetch(u, { signal: AbortSignal.timeout(10_000) }); if (!r.ok) throw new Error(`${new URL(u).host}: HTTP ${r.status}`); return r.json(); };

/** reporter account -> [source name, () => USD per BTC] */
export const SOURCES = {
  "pusaka-relayer.testnet": ["mempool.space", async () => (await j("https://mempool.space/api/v1/prices")).USD],
  "pusaka-admin.testnet": ["CoinGecko", async () => (await j("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd")).bitcoin.usd],
  "pusaka-seller.testnet": ["Rhea nBTC", async () => Number((await j("https://api.ref.finance/list-token-price"))["nbtc.bridge.near"].price)],
};

/** A source's answer, refused when implausible (a broken API must not become a price). */
export async function sourcePrice(reporter) {
  const p = await SOURCES[reporter][1]();
  if (!(p > 1000 && p < 10_000_000)) throw new Error(`implausible ${p}`);
  return Math.round(p * 1e6); // stablecoin units (6 decimals) per BTC
}
