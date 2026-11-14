# Pusaka — final report (8 Nov 2026)

Details per phase: [`reports/01-tech-lead.md`](reports/01-tech-lead.md) · [`02-strategy`](reports/02-strategy.md) · [`03-contracts`](reports/03-contracts.md) · [`04-dapp`](reports/04-dapp.md) · [`05-security`](reports/05-security.md) · [`06-qa`](reports/06-qa.md) · [`07-submission`](reports/07-submission.md).

## 1. Scorecard & checklist
HACKATHON.md gives no numeric rubric; the criteria are derived from Q-012, Q-017 and the track brief (`02-strategy.md`).

| Criterion | 2 Nov | 8 Nov |
|---|---|---|
| Reproducibility from a clean clone | 5 | 9 |
| Claims verified on-chain | 6 | 10 |
| Depth of NEAR integration | 6 | 9 |
| Fit with the `nfts` brief | 7 | 9 |
| Security / threat model | 6 | 9 |
| Demo & presentation | 5 | 6 (video/X not yet) |
| UI/a11y/perf polish | 6 | 9 |

There is no separate sponsor bounty in this hackathon; "sponsor" = NEAR. Submission checklist: `07-submission.md`.

## 2. Audit & security findings
18 findings from the 7–8 Nov round (A1–A18): 1 Critical, 6 High, 8 Medium, 3 Low. 16 fixed and verified; A16 (typecheck) was decided not to be added, with a stated reason; A17 (source map) is waiting for the repo to go public. Security: `cargo audit` in CI (1 dev-only advisory, ignored with a stated reason), `npm audit` 0, git history & bundle free of secrets, headers & CORS correct. Upgrades renounced 8 Nov; Firewall rate limit active (429). Known issue: coverage not measured.

## 3. Integrations (before → after this round)
Chain Signatures: Deep → + staking FunctionCall · Light client: Medium → Deep (change) · RPC: simple failover → per call + cooldown + cache · 1Click: quote → + correct timeout & tested fallback · Staking pool: — → Deep · Contract errors: raw code → sentence. Full list: `04-dapp.md`, README "Every NEAR primitive".

## 4. Competitors & positioning
19 projects in `nfts` (out of 266). "NFT that carries a wallet" is now at parity (Handover, Deed, Torch, Logen, Outlive). Only Pusaka holds **real Bitcoin proven on-chain** and moves BTC + EVM + SOL + NEAR at once. Positioning and the table of 8 competitors: `02-strategy.md`.

## 5. Differentiators that are hard to copy (on-chain proof)
1. Bitcoin light client in the contract: `prove_deposit` `EYLPHJGX…`; change proven on #10 (proposal 5).
2. One NFT, many chains: Sepolia `0x85a7466d…`, Solana (finalized), NEAR account `3npsdnYo…`, nBTC, stake `4yQWgGG4…`.
3. Contract with no key and final code: DeleteKey `3mNiGWfH…`; formerly DAO + timelock (TooEarly `EHX5b1cp…`, deploy `67hUwJuA…`), renounced `GdASfxh5…`.

## 6. New features this round
NFT-owned NEAR staking (`#/pusaka/2`), free change proof (`#/pusaka/10`), token page title before JS (LCP 8.4 → 2.7 s), human-readable contract errors, `.env.example`, `cargo audit` in CI.

## 7. Testing
Contract 376 × 2 (including fuzz + invariant) · Node unit 14 files in CI · Playwright `ui.spec` 115 (5 projects) + `live.spec` 45 · `verify.mjs` 8 checks · MCP smoke. Bugs found by tests: 10 (`06-qa.md`). Production mobile Lighthouse: landing 88, token 87, a11y 100, SEO 100, best-practices 96.

## 8. Links
Demo: https://pusaka-two.vercel.app · Contract: https://testnet.near.rocks/account/pusaka-btc.testnet · Repo: https://github.com/PugarHuda/pusaka · Video & deck: not yet (script + outline in `07-submission.md`).

## 9. Blockers (need the user)
1. **Demo video + X post** (mandatory requirement; script ready).
2. **Public repo** before 14 Nov 23:59 UTC (suggested 13 Nov); then production source map (1 line).
3. ~~Renounce upgrade~~: **done 8 Nov** (proposal 7, `GdASfxh5…`).
4. **Mainnet payout account** and form data (name, email, team size, consent); submit after the payload is shown.
5. **Mainnet funds** (~$35 minimum / ~$47 full, measured 8 Nov, `docs/MAINNET.md`; at `pugarhuda.near`) if a mainnet deploy / TLA name is wanted.
6. ~~Firewall publish~~: done 8 Nov (429 after 20 POST/minute/IP). Optional: 1Click JWT from partners.near-intents.org (no 0.2 % fee).
