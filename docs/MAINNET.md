# Moving Pusaka to mainnet

Everything network-specific lives in `shared/btc.mjs` (`CONFIG`) and one Rust feature. Nothing else changes.

| | Testnet (today) | Mainnet |
|---|---|---|
| Switch (scripts) | default | `PUSAKA_NETWORK=mainnet PUSAKA_CONTRACT=<account>` |
| Switch (web, Vercel env) | default | `VITE_NETWORK=mainnet`, `VITE_CONTRACT=<account>` |
| Contract build | `cargo near build non-reproducible-wasm --no-abi` | add `--features mainnet` (EVM_CHAINS = Ethereum) |
| MPC signer | `v1.signer-prod.testnet` | `v1.signer` |
| Bitcoin | testnet3, `tb1…` | mainnet, `bc1…` |
| EVM | Sepolia (11155111) | Ethereum (1) |
| Bitcoin light client | `btc-client-v4.testnet` (testnet3), 1 confirmation | `btc-client.bridge.near`, 6 confirmations |
| NEAR RPC | test.rpc.fastnear.com | free.rpc.fastnear.com |

## Steps

1. **Account.** Create the contract account in a NEAR wallet (e.g. `pusaka.near` or a sub-account of the team's account). Fund it with ~4 NEAR: the 363 KB contract needs ~3.7 NEAR of storage, the rest covers gas.
2. **Build** with `--features mainnet`, run `cargo test` (211 tests) and `cargo test --features mainnet --no-run`.
3. **Deploy and init:** deploy the wasm, then call `new({"mpc": "v1.signer"})`.
4. **Smoke test with tiny amounts:** mint (0.1 NEAR deposit, mostly refunded), send ~10,000 sats to the Pusaka's `bc1…` address, list / buy between two accounts, withdraw ~2,000 sats. Mainnet MPC requests may carry a fee; check `v1.signer` before the first `withdraw`.
5. **Web:** set `VITE_NETWORK=mainnet` and `VITE_CONTRACT` in Vercel (a separate project or preview, so the testnet demo stays up for judges).
6. **Lock the code:** after the smoke test, remove the contract account's full-access key (or hand it to a DAO) so the code can't be swapped under owners' BTC. Until then, say so plainly in the README.

## Paying with any asset via NEAR Intents (mainnet only)

NEAR Intents has no testnet (hackathon rule Q-007), which is why this waits for mainnet.

- **Flow:** the buyer picks an asset (USDC on Base, SOL, BTC…). The app asks the 1Click API for a quote whose output is the listing's current price in NEAR, delivered to the Pusaka contract with a memo naming the token. On settlement, the contract completes `buy` for that buyer.
- **Contract work:** a payment entry point that accepts the settled NEAR on behalf of a named buyer, bound to `expected_sign_epoch` like `buy`, and refunds if the listing changed.
- **Testing:** `dry: true` quotes first (Q-007), then one real purchase with a few dollars.
- **Notes:** without a 1Click JWT there is a 0.2% fee (Q-006). Register at partners.near-intents.org.

## Costs (rough)

| Item | Amount |
|---|---|
| Contract storage | ~3.4 NEAR (recoverable if the contract is deleted) |
| Smoke-test mints, gas | < 0.5 NEAR |
| BTC for the demo | ~10,000 sats + Bitcoin fees |
| One Intents test purchase | a few USD |
