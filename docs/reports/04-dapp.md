# 04 — dApp & integrations (Full-Stack Engineer)

Reference: `01-tech-lead.md` (A3–A12, A14), `02-strategy.md`.

## Fixed findings
| ID | Fix | Verification |
|---|---|---|
| A4 | 4 s cache + dedupe of view calls, discarded after every tx (`forgetViews`) | market 96 → 44 RPC calls (QA crawl) |
| A5 | per-call RPC failover with a 60 s cooldown; contract panics are not retried | `shared/failover.test.mjs` |
| A6 | landing/market/token: message + Try again when RPC is down | `ui.spec` route interception (5 browsers) |
| A7 | prices: retry per source, the error names the source, MCP refuses clearly | `shared/prices.test.mjs` |
| A10/A11 | token page LCP 8.4 → 2.7 s; viem RPC client lazy | production Lighthouse, `ui.spec` |
| A12 | 1Click: 30 s timeout; honest fallback tested | `live.spec` |
| A14 | `.env.example` | — |
| A18 | contract panic → sentence (`web/src/errors.js`), epoch ms → date | `web/src/errors.test.mjs`; matched against real failed tx `6PrmsY8y…` (NotOwner), `wS4qnqmc…` (Listed), `3GN75VgG…` (Collateralised), `ANbwMLtn…` (NotDueYet), `CoteHaM8…` (claim_inheritance) |

## Wallet & transactions (NEAR)
| Requested | Implementation |
|---|---|
| connect / switch account / disconnect / reconnect | `@hot-labs/near-connect` (Meteor, Intear, HOT, MyNearWallet…), session restored on load |
| switch network | not relevant the way it is on EVM: the build fixes testnet/mainnet (`VITE_NETWORK`), NEAR wallets sign per network |
| tx status: signature → pending → final/failed, explorer link | `callRaw` waits for FINAL, success message with a NEAR Rocks link; contract panics are translated into human sentences (`NotOwner` → "Only the holder…") |
| simulation before sending | preflight views (`acceptWouldSucceed`, `buy` with `expected_sign_epoch`, the relayer checks the light client before `prove_deposit`) |
| double submit | button disabled during the tx; the contract binds to `sign_epoch`/nonce so a duplicate submission fails |
| nonce / replacement | NEAR: key nonce managed by the wallet; for cross-chain tx the contract records a nonce floor (T10, T14) |
| EVM tx built by the contract | `finalizeEth` checks that the sighash matches and the signature recovers to the Pusaka address before broadcast |

## On-chain data
- NEAR RPC: FastNear → dRPC → rpc.testnet.near.org (per-call failover). Bitcoin: mempool.space → Blockstream. EVM: publicnode per chain (viem, lazy).
- Events: per-NFT History is read from contract events; the cache is discarded after a tx.
- API/indexer data validation: Esplora answers are only used to build a **proof** that the light client verifies ("a wrong answer from the API can only make the proof fail"); prices need two sources that differ by < 5 % (`crossCheck`). Zod is not installed: critical validation happens on-chain.

## Integration inventory (before → after this round)
| Integration | Before | After |
|---|---|---|
| Chain Signatures (secp256k1 + Ed25519 + CKD + foreign-tx) | Deep | Deep + generic FunctionCall for staking |
| Bitcoin light client | Medium | Deep: withdrawal change proven |
| NEAR RPC | simple failover | per call + cooldown + cache |
| NEAR Intents 1Click | dry-run quote | + correct timeout, tested fallback |
| Staking pool | — | Deep: stake/unstake/withdraw, UI + MCP + scripts |
| Playwright | 1 browser | 5 projects, axe, visual, interception |

## How to try the new features
- Staking: open https://pusaka-two.vercel.app/#/pusaka/2 → the *Staked NEAR* section; or `node scripts/stake.mjs x 2 status`.
- Free change proof: `#/pusaka/10` → History shows the proof by `pusaka-relayer.testnet`.
- 1Click fallback: `#/pusaka/12` while 1Click is down shows "No NEAR Intents quote right now (…)", with no number.
