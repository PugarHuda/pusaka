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

1. **Account.** Create the contract account in a NEAR wallet (e.g. `pusaka.near` or a sub-account of the team's account). Fund it with ~7 NEAR: the 628 KB contract (measured 8 Nov) needs ~6.3 NEAR of storage, the rest covers gas.
2. **Build** with `--features mainnet`, run `cargo test` (327 tests) and `cargo test --features mainnet --no-run`.
3. **Deploy and init:** deploy the wasm, then call `new({"mpc": "v1.signer"})`.
4. **Smoke test with tiny amounts:** mint (0.1 NEAR deposit, mostly refunded), send ~10,000 sats to the Pusaka's `bc1…` address, list / buy between two accounts, withdraw ~2,000 sats. Mainnet MPC requests may carry a fee; check `v1.signer` before the first `withdraw`.
5. **Web:** set `VITE_NETWORK=mainnet` and `VITE_CONTRACT` in Vercel (a separate project or preview, so the testnet demo stays up for judges).
6. **Lock the code:** after the smoke test, delete the contract account's full-access key (`node scripts/upgrade.mjs lock`) and call `renounce_upgrades` from the upgrade admin, as done on testnet on 8 Nov. No DAO is needed for that.

## Paying with any asset via NEAR Intents (mainnet only)

NEAR Intents has no testnet (hackathon rule Q-007), which is why this waits for mainnet.

- **Flow:** the buyer picks an asset (USDC on Base, SOL, BTC…). The app asks the 1Click API for a quote whose output is the listing's current price in NEAR, delivered to the Pusaka contract with a memo naming the token. On settlement, the contract completes `buy` for that buyer.
- **Contract work:** a payment entry point that accepts the settled NEAR on behalf of a named buyer, bound to `expected_sign_epoch` like `buy`, and refunds if the listing changed.
- **Testing:** `dry: true` quotes first (Q-007), then one real purchase with a few dollars.
- **Notes:** without a 1Click JWT there is a 0.2% fee (Q-006). Register at partners.near-intents.org.

## Costs (measured 8 Nov 2026: NEAR $3.68, BTC $75,612, Bitcoin fees 1–3 sat/vB)

| Item | Amount | USD |
|---|---|---|
| Contract storage (628 KB wasm; never recoverable once the key is deleted and upgrades renounced) | ~6.3 NEAR | ~$23 |
| Account, deploy, init, gas for the smoke test | ~0.5 NEAR | ~$2 |
| Second account to buy/lend in the demo; 2 mints (0.1 NEAR deposit each, mostly refunded) | ~0.5 NEAR | ~$2 |
| Relayer gas balance for gas-free proofs (optional) | ~2 NEAR | ~$7 |
| BTC: 10,000 sats, the smallest deposit the relayer proves for free (6 confirmations) | 10,000 sats | ~$7.60 |
| Bitcoin fees: deposit + one withdrawal (~150 vB each at 1–3 sat/vB) | ~1,000 sats | < $1 |
| One real NEAR Intents exit (BTC → USDC), optional | min ~6,400 sats | ~$5 |
| **Minimum** (no relayer, no Intents) | ~7.3 NEAR + ~11,000 sats | **~$35** |
| **Full demo** | ~9.3 NEAR + ~17,000 sats | **~$47** |

Not counted: an exchange's own BTC withdrawal fee if the BTC comes from one. MPC signatures on `v1.signer` carry no separate deposit (`experimental_signature_deposit` doesn't exist there; checked 8 Nov).
