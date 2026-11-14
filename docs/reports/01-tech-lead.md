# 01 — Tech Lead / Auditor

Round 2: 8 Nov 2026, afternoon. Basis: commit `d655777` (main). This phase only maps issues; it does not fix code. Every number was measured again in this round; the commands are listed.

## Context
| | |
|---|---|
| Hackathon | NEAR HACKATHON 2026 (nearhackathon.com, rules: HACKATHON.md) |
| Track | `nfts` (NFTs That Do Something), `defi`, `open` |
| Sponsor/bounty | No separate sponsor bounty. "Sponsor" = NEAR; requirements: built on NEAR, public repo, demo + X post |
| Network | NEAR testnet; Bitcoin testnet3; Sepolia / Base Sepolia / Arbitrum Sepolia; Solana devnet |
| Judging | HACKATHON.md has no numeric rubric. Q-017: Claude Code & Codex screen (reproducibility, feature verification, report, initial score), humans decide. Q-012: a hosted demo is a plus |
| Deadline | 2026-11-14T23:59:00Z (repo must be public by then) |
| Repo | github.com/PugarHuda/pusaka (private for now) |
| Project | A NEAR NFT (NEP-171) that holds real Bitcoin through Chain Signatures; the balance is proven on-chain by NEAR's Bitcoin light client; selling the NFT = the BTC (plus its EVM/SOL/NEAR wallets) moves with it. Target: BTC holders who want to sell, bequeath, or use it as collateral without a bridge/custodian |

## Submission readiness: ~85 %
Down from ~90 % in round 1: **CI has been red since the renounce** (B1) and the red badge is on line 3 of the README, the first place judges and the screening AI look. The code itself is healthy (all local checks below are green). The rest is not code: video + X post, public repo, submission form.

## Results of running everything (local, 8 Nov)
| Command | Result |
|---|---|
| `cargo test` (contract) | **225 passed**, 0 failed, 0 warning |
| 9 Node units (`shared/*.test.mjs`, `api/_*.test.mjs`, `web/src/*.test.mjs`) | 9/9 ok |
| `npm run lint` | 0 errors; web 15 warnings (B7) |
| `npm run build -w web` | ok; chunk > 500 kB warning (B8) |
| `node scripts/verify.mjs` | **all checks passed** (8 checks, including "upgrades renounced: final", 56 README tx exist on chain) |
| `npm audit --omit=dev` | 0 vulnerabilities |
| `https://pusaka-two.vercel.app` | 200, 0.7 s; `/api/reserves` = 158,346 sats, same as the contract |
| GitHub Actions, last 3 runs | **red** (B1, B5); last green run `8bf017b` |

Wallet: the real wallet flow was run through `web/e2e/wallet-qa.mjs` (Intear) in the previous round; it was not repeated in this round because the contract has not changed since then (same sha256, upgrades already final).

## On-chain status
| Account | Role | Status | Proof |
|---|---|---|---|
| `pusaka-btc.testnet` | main contract | deployed, **0 access keys**, **upgrades renounced (final)** | wasm sha256 `ac16e80e…` = reproducible CI build of commit `4bf36b2` (NEP-330), deploy `67hUwJuA…`, DeleteKey `3mNiGWfH…`, renounce `GdASfxh5…` |
| `pusaka-council.sputnikv2.testnet` | Sputnik DAO, formerly held the upgrade right | code `AA4nA45v…`; its role ended after proposal 7 | proposals 0–7 |
| `pusaka-agent.testnet` | Shade Agent contract (TEE) | code `4y4jLrp5…` | `register_agent` `4Pxmp4gy…` |
| `pusaka-relayer.testnet` | NEP-366 relayer, NEP-611 gas key | account without code (as its role requires) | relay `66Gi31T5…` |
| MPC `v1.signer-prod.testnet`, light client `btc-client-v4.testnet` | NEAR dependencies | read directly by `verify.mjs` | 21 BTC keys = MPC derivation; 9 deposits proven |

"ABI in sync": NEAR does not use ABI files. The frontend calls methods by name, and `live.spec` reads the same view methods from the deployed contract, so any mismatch fails CI right away. The contract is now final, so this risk is closed permanently.

## Feature inventory: claims vs reality
Every README claim has a tx or a test. `verify.mjs` re-checks 56 tx and the balances against the chain (green). One claim is no longer true: **the submission text and README say upgrades still go through the DAO + timelock** (B2, B3); in reality they are final.

## Mock / dummy / hardcode inventory
`grep -rniE "mock|fake|dummy|TODO|FIXME|lorem|placeholder|coming soon|0x0000"` in `api shared mcp scripts web/src contract/src shade`:
| Finding | Assessment |
|---|---|
| `mock` in `*.test.mjs` | fake fetch in the failover/price unit tests: reasonable |
| `todo` in `api/_relayer.mjs`, `mcp/tools.mjs`, `scripts/prove.mjs`, `scripts/prove-usdc.mjs`, `web/src/App.jsx:776` | variable name (deposits not yet proven), not a work marker |
| `placeholder=` | `<input>` attribute |
| "Placeholder tiles" `web/src/extras.jsx` | loading skeleton, replaced by contract data |
| `fake` `shared/btc.mjs` | comment "never fake a deposit" |
| `contract: "pusaka.near"` (mainnet config) | mainnet account not created yet; mainnet UI not deployed (needs user funds) |
| TODO / FIXME / coming soon / lorem / `0x000…` | **0** |

## Integration inventory (NEAR = the only "sponsor")
| Integration | Level | Proof |
|---|---|---|
| Chain Signatures (secp256k1 BTC/EVM, ed25519 SOL/NEAR, CKD, foreign-tx USDC) | Deep | `verify.mjs`, tx in README |
| Bitcoin light client | Deep | `prove_deposit` `EYLPHJGX…`; change #10 |
| NEP-171/177/178/181/199/297/330/366/413/452/611 | Deep | README table "Every NEAR primitive" |
| Sputnik DAO | Deep (done: renounce) | proposals 0–7 |
| Staking pool | Deep | `4yQWgGG4…` |
| Omni nBTC | Medium | `withdraw-nbtc` |
| NEAR Intents 1Click | Medium (dry run; liquidity on mainnet only) | `live.spec` quote / fallback |
| Shade Agent (Phala TEE) | Medium (ran before; turned off to save credits) | `register_agent` `4Pxmp4gy…` |
| SocialDB notify, Mintbase | Medium | README |

## Round 2 findings table
| ID | Category | Severity | Location | Description | Owner | Status (8 Nov, evening) |
|---|---|---|---|---|---|---|
| B1 | QA / CI | **Critical** | `web/e2e/live.spec.mjs:346` | The "For AI agents" page test still expects the text to end in "…timelock." Since the renounce (`6477539`) the app correctly shows "Code changes: none, ever (renounced)", so the test fails on every run. As a result the CI badge on README line 3 is red, and the steps after it (`receipt-monitor`, `verify.mjs`, MCP smoke, due diligence) **no longer run in CI**. The app is right; the test is stale | QA | Fixed: assertion → "Code changes: none, ever (renounced)."; test passes against production |
| B2 | Submission | High | `docs/reports/07-submission.md:57`, slide 8 | The "What they built" text says "code changes only through a Sputnik DAO vote and a timelock", but now it cannot be changed at all. Slide 8 still says "Next: renounce upgrade". The screening AI compares claims with the chain | Submission | Fixed: "its code is final: a Sputnik DAO vote renounced upgrades" (1,592 characters); slides 7/8 updated |
| B3 | Documentation | Medium | `README.md:450` (DAO row), `JUDGES.md:64` | Written in the present tense ("New contract code needs a council proposal…"); needs "formerly…, renounced through proposal 7" | Submission | Fixed: README security paragraph + DAO row (link to proposal 7), JUDGES |
| B4 | MCP | Low | `mcp/tools.mjs:647`, prompt `due_diligence` `:895` | The tool description names the DAO/timelock as the current state. The tool output is already correct (`upgrades: {final: true}`); only the description text is off | Backend | Fixed: tool description + `due_diligence` prompt |
| B5 | CI | Medium | `.github/workflows/ci.yml` job `reproducible-wasm` | The cargo-near installer is curled without retry; the scheduled 09:54 run was red because of a GitHub 504 (`no such command: near`). External flakiness | DevOps | Fixed: install retried 3× (`curl --retry 3 --retry-all-errors`), then `cargo near --version` fails hard |
| B6 | Documentation | Low | `docs/REPORT.md`, `02`/`03`/`05` | Still describes "DAO upgrade + timelock" as the current state; REPORT blocker 5 still says $23–37 (MAINNET.md measured: ~$35 minimum / ~$47 full); blocker 6 (firewall publish) is already done | All roles, when writing their reports | Fixed: 02, 03, 05, REPORT (mainnet cost from MAINNET.md, firewall done) |
| B7 | FE quality | Low | `web/src/App.jsx:388,1914` (`Date.now` during render), `:314,1271` (setState in effect) + 11 others | 15 oxlint React warnings. No bug observed; risk of unstable rendering | Frontend | Fixed: 15 → 0 warnings. `useNow` (clock as state) replaces `Date.now()` during render; error reset in the Try again handler; HolderRoom reset through `key`; non-component helpers moved to `web/src/util.js`. `ui.spec` chromium 18/18 |
| B8 | Performance | Low | `dist/assets/index-*.js` | Main chunk 985 kB (306 kB gzip). LCP is already 2.7 s; splitting per route (market/token/agents) could still reduce it | Frontend | **Partial (9 Nov)**: CKD crypto (BLS12-381, used only by the MPC letter) now loads on use through `@pusaka/shared/ckd` → initial chunk 308 → **271 kB gzip** (−12 %), separate 38 kB `ckd` chunk. Splitting the vendor code (`manualChunks`) was also tried: the initial total rose to 339 kB because lazy modules got pulled in, so it was reverted. Splitting `App.jsx` per route is still not done (regression risk) |
| B9 | Performance | Low | build | No source map (A17); waiting for the repo to go public | DevOps (after the user makes the repo public) | User blocker: repo public first |

Round 1 (A1–A18): 16 fixed and verified; A16 (typecheck) not added, with a stated reason; A17 = B9. The details are in this file's git history (`git log -p docs/reports/01-tech-lead.md`).

## Gaps per area (short)
- **Smart contract**: no new gaps. 225 tests at the time (8 Nov; 376 with 96% line coverage by 14 Nov), 0 warnings, code final.
- **Frontend/dApp**: connect/disconnect, the no-wallet flow, RPC down, both BTC explorers down, and offline are all tested in `ui.spec` (5 browsers). Account switching and wallet rejection are only tested manually (`wallet-qa.mjs`), because there is no injected provider for NEAR wallets. Network switching does not apply: the app is testnet only.
- **Integration**: NEAR RPC and Esplora have failover + cooldown + timeout (unit tests). 1Click has a 30 s timeout and an honest fallback.
- **Web3 UX**: contract panic → sentence (`errors.js`), explorer links in History, gas-free through the relayer, 429 explained.
- **DX**: `npm run demo`, `.env.example`, 5-minute JUDGES.md. Its automated checks (CI) are currently red (B1).

## Priorities (impact on AI screening + judges)
B1–B7 were fixed in the same round at the user's request (see the Status column). The original order:
1. **B1**: update one assertion in `live.spec.mjs` to the text "none, ever (renounced)" → CI green, badge green, `verify.mjs` runs daily again. (QA, ~5 minutes)
2. **B2 + B3**: submission text, slide 8, README DAO row, JUDGES. Claims must match the chain. (Submission)
3. **B5**: retry on the cargo-near download (`curl --retry 3`). (DevOps)
4. B4, B6: wording fixes.
5. B7, B8: optional, after everything above.
6. Non-code (user): video + X post, public repo ≤ 14 Nov (suggested 13 Nov), form/payout data.
