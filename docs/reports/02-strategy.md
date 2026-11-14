# 02 — Strategy & market research (Hackathon Strategist)

8 Nov 2026. Reference: `01-tech-lead.md`. Sources:
- The official text https://nearhackathon.com/HACKATHON.md and its main page.
- 87 competing projects in our track (API `nearhackathon.com/api/projects`, repos, on-chain accounts, and X posts read one by one).
- Web research on 8 Nov. Source links are in every row.

## 1. Judging criteria & requirements
**There is no official numeric rubric.** What is written:
- Screening: "Claude Code and Codex screen every project before the human jury decides". This covers a reproducibility check, feature verification, a structured report, and an initial score. "A low score alone cannot reject" a project.
- Previous NEAR hackathons judged "technical implementation, design, impact, originality, and sustainability" (nearhackathon.com).
- The judges come from NEAR, a16z crypto, Helius, Electric Capital, Synthetix/Infinex, Dragonfly, cyber•Fund, Anthropic, and OpenAI.
- Prizes per track $10K / $3K / $2K; grand prize $55K. Judging on 16 Nov, results by 18 Nov at the latest.

Track briefs, quoted:
- **nfts:** "Build NFTs as accounts — assets that own money, earn royalties, hold inventory, carry credentials… Ownership with behavior."
- **defi:** "…settle across chains through **NEAR Intents**… Deep liquidity, no custodian, nobody to switch it off."
- **open:** "new ways for money, intelligence and ownership to work together."

### Scorecard (now → target)
| Criterion | Score | What it takes to reach 9–10 |
|---|---|---|
| Reproducibility (AI screener) | 9 | Public repo. The rest is already there: `npm run demo`, `verify.mjs`, JUDGES.md, CI green again since `44bda6a` |
| Claims = on-chain reality | 10 | Keep it: daily `verify.mjs` in CI |
| Technical implementation | 9 | — (376 contract tests including fuzz + invariant, 96 % line coverage, light client, MPC 3 domains + CKD + foreign-tx) |
| Fit with `nfts` ("NFTs as accounts that own money") | 9 | The track brief practically describes Pusaka |
| Fit with `defi` ("settle… through NEAR Intents", "nobody to switch it off") | 6 | Intents in Pusaka is only a **dry-run quote**: 1Click liquidity only exists on mainnet. The `defi` leaders (Warrant, setllend) are **on mainnet**, and Warrant settles its transactions inside `intents.near`. To go up: deploy to mainnet + one Intents exit path that is actually executed |
| Fit with `open` | 8 | The BTC × AI agent (MCP) × inheritance combination is already unique |
| Design / polish | 8 | Lighthouse 87–88, a11y 100. Goes up with the "refusal room" (F2) and the video |
| Impact / sustainability | 6 | Testnet only. Mainnet (F1) is the biggest proof that this product can be used for real |
| Demo & presentation | 6 | **Video + X post do not exist yet** (required). The script is in `07-submission.md` |

### Requirements checklist (HACKATHON.md)
- [x] Built on NEAR, within the time window, one submission per repo
- [x] README for machines and humans with "do X → see Y" steps
- [x] A demo that can be opened: https://pusaka-two.vercel.app (Q-012: "screenshots are not enough")
- [ ] Public repo before 14 Nov 23:59 UTC (user)
- [ ] X post tagging @NEARProtocol and #NEARHackathon, with video (user)

There are no separate sponsor bounties; "sponsor" = NEAR.

## 2. Research: what wins
1. **Proof that the product works.** NEAR's AI screener tests "runs and does what the README says". The Colosseum shortlist also goes through code review ([FAQ](https://superteamcan.notion.site/Colosseum-1ae380b97c4681cabad4e7f85ae0af7b)). The top competitors here (Warrant 8.8; Sealed Exploit 8.8 after the video was scored) both have a one-command `verify`, keyless contracts, and green CI.
2. **Chain Signatures controlling accounts on chains without smart contracts.** NEAR's bounty at ETHGlobal asked for exactly this: "DeFi… on non-smart contract chains… controlling externally-owned accounts on chains like Bitcoin" ([Brussels](https://ethglobal.com/events/brussels/prizes/near-protocol), [London 2024](https://ethglobal.com/events/london2024/prizes/near-protocol)).
3. **AI + DeFi.** DeFiBrain won the Chain Signatures bounty and 1st place at ETH Seoul ([NEAR](https://pages.near.org/?p=21306)).
4. **A story about security and user protection.** Example: the Colosseum 2025 winner, Unrugable ([Solana Compass](https://ee.solanacompass.com/learn/breakpoint-25/winners-of-the-colosseum-cypherpunk-hackathon)). In this hackathon: Warrant with a "refusal room" of 31 real failed tx, and Sealed Exploit with 21 fake claims rejected on-chain.
5. **Mainnet beats testnet in defi.** Warrant (`warrant-options.near`, 0 keys) and setllend (`setllend.near`) are already live on mainnet.

## 3. Live products with a similar problem
| Product | Core / chain / technology | Target user | Token / economics | Traction (DefiLlama, 8 Nov) | Strengths | Weaknesses | Source |
|---|---|---|---|---|---|---|---|
| Liquidium | P2P BTC loans backed by Ordinals/Runes (PSBT + DLC oracle); default = collateral moves, no LTV liquidation | Ordinal/rune holders, BTC lenders | LIQ (rune; ATL 14 Jun 2026) | TVL $4.0M; >63k loans, 3,378 BTC volume | Native BTC, no bridge | Ordinal collateral carries floor-price risk; oracle = trusted third signer | [docs](https://help.liquidium.fi/en/articles/9189612-how-does-liquidium-work-a-technical-deep-dive) |
| Babylon | Self-custody BTC staking (Taproot timelock script, EOTS slashing); Cosmos chain | BTC holders looking for yield | BABY | TVL $3.10B | No wrapping | Security staking only; slashing risk | [docs](https://docs.babylonlabs.io/guides/overview/bitcoin_staking/) |
| Lombard LBTC | BTC liquid staking; mint/burn approved by a 14-member consortium; CCIP | EVM/Sui/Solana DeFi users | BARD | TVL $746M | Backed by institutions | Consortium = trusted party ("coordination risk") | [risk report](https://static-r2.jup.ag/lend/risk-research/lbtc-risk-report.pdf) |
| tBTC (Threshold) | BTC wrapped 1:1, 51-of-100 staked-signer wallet | EVM DeFi users | T | TVL $328M | Permissionless redeem | Still a wrapped asset + a signer set | [docs](https://docs.threshold.network/tbtc-signer-nodes) |
| ERC-6551 / Tokenbound | Every ERC-721 has a smart contract wallet | NFT/game projects | — | No 2025–26 data found | Standard, open tooling | **The seller can empty the wallet right before the sale is final**; EVM only | [survey](https://arxiv.org/pdf/2508.07190), [EIP thread](https://ethereum-magicians.org/t/erc-6551-non-fungible-token-bound-accounts/13030?page=2) |
| NEAR Omni (nBTC) | BTC deposits proven by light client, withdrawals signed by MPC | NEAR/Intents users | — | Omni TVL not found; NEAR Intents $193M | Same trust stack as Pusaka | BTC becomes a token on NEAR (not a UTXO at its own address) | [docs](https://docs.near.org/chain-abstraction/omnibridge/overview) |

### Competitors in this hackathon (scored with the same rubric; details in the competitor analysis folder)
| Project (track) | Core | NEAR technology | Traction (testnet/mainnet) | Strengths | Weaknesses | Source |
|---|---|---|---|---|---|---|
| Warrant (defi) 8.8 | Physically-settled options, collateral inside `intents.near`, NEP-245 | Intents, 1Click, relayer, reproducible build | **Mainnet**, 0 keys, 90 tx | Refusal room of 31 tx, `verify.mjs` | One narrow product (options) | [repo](https://github.com/emmanuelist/warrant) |
| Sealed Exploit (open) 8.8 | Exploit bounties verified in a TEE (OutLayer) | Global contract, keyless accounts, OutLayer | testnet, 84 hunter tx | 21 fake claims rejected on-chain | Niche market | [repo](https://github.com/edycutjong/sealed) |
| setllend (defi) 8.2 | Fixed-rate USDC loans (order book) | Intents `auth_call`, 1Click, Rhea oracle | **Mainnet**, 1 FA key | Mature credit design | The app screens in the video are an "animated recreation"; the owner can change parameters | [repo](https://github.com/TarasBrilian/setllend) |
| Handover (nfts) 8.2 | NFT = ETH wallet; the seller can't keep the key | Chain Signatures (ETH), 0 keys | testnet, 23 tx | Claim→file:line→test | 1 chain; balance checked off-chain; no CI | [repo](https://github.com/AlphaTechini/handover) |
| OneUp (defi/nfts) 7.7 | Prediction market + "extra life" NFTs | NEP-171, 0 keys | testnet, ±25k tx (its own bots) | Volume, CI | Mock oracle; Intents/DAO only local | [repo](https://github.com/ethboi/oneup) |
| Outlive (nfts) 7.5 | NFTs own an API business vault (402, receipts) | NEAR vault, NEP-413 | testnet, 1 FA key | Clear business story | "demand unproven", the contract still has a key | [repo](https://github.com/itsolaph/outlive) |
| Heir (open) 7.3 | Dead-man's switch, ETH heirs through Chain Signatures | Chain Signatures, gas-free relayer | testnet, 1 FA key | The most similar to Pusaka in substance | Narrower (NEAR + ETH), no CI | [repo](https://github.com/ZSP111/Heir) |


### After watching all the demo videos (9 Nov)

81 videos/photos from X posts were rescored (12-frame contact sheet + transcript). What changes Pusaka's position:
- **Handover 7.7 → 8.2 (nfts).** The 3:32 video shows the NFT's ETH wallet being funded and spending on Sepolia (Etherscan), then a seller who holds back a signed tx being blocked until that tx is cleared. The gap with Pusaka (8.3) is now only 0.1, and Pusaka's Demo score is still 7 because its video doesn't exist yet.
- **Sealed Exploit 8.8 and Warrant 8.8.** Both videos are almost entirely real terminal/UI with tx in the explorer.
- **setllend 8.2 → 8.0, Loca 8.2 → 8.0.** Their videos are animation only, with no real tx.

Lesson for the Pusaka video: the judges value **real screens + explorer**, not motion graphics. At minimum show a BTC deposit proven on-chain, an NFT sale, rejected attack tx (`#/refused`), and a green `verify.mjs`. A Demo score of 9 raises Pusaka to 8.7.

### Update 9 Nov evening: 380 projects, 46 new in our tracks

Two re-audits with the same rubric: new projects (repo, on-chain contract, X demo) and the top rivals since 9 Nov. Per-project details are in the competitor analysis folder (not in the repo).

| Track | Projects (excluding Pusaka) | New |
|---|---|---|
| nfts | 29 | +10 |
| defi | 63 | +23 |
| open | 69 | +24 |

**The old rivals have barely moved.** No new mainnet deploys and no keys deleted. GetLeash went up 8.3 → 8.5 because its README was re-tested through a fresh clone.

**New projects entering the top 5:**
| Project | Track | Score | Why it is strong | Weaknesses |
|---|---|---|---|---|
| Contri | nfts | 8.2–8.7 (two scorers) | Rotating savings (arisan) on **mainnet**, `circles.contring.near` 0 keys, hash = CI build, pays through Intents 1Click, ~104 Rust tests | The NFT is a side feature: NEP-171 read-only, no `nft_transfer` |
| Hallmark | defi | 8.8 | Agent price limits for Intents, quote checked by `ed25519_verify` on-chain, mainnet (68 tx), 61 Rust + 71 JS tests | The contract still has a full-access key |
| Veto | open | 8.7 | Second signer in a TEE, `ecrecover`, Chain Signatures to Base, keyless vault from a global contract | Mainnet Intents claim not proven, no CI |
| Priced In | defi / open | 8.2 | Fact prediction market, 3 AI judges in a NEAR AI TEE, mainnet (231 tx) | — |
| Seats | nfts | 7.7 | Membership NFT + Sputnik DAO + AI delegation on OutLayer, green CI | — |

**Most similar to Pusaka: the new Torch (6.8).** An inheritance NFT that holds testnet4 BTC and Sepolia ETH addresses through Chain Signatures, with heirs. How it differs from Pusaka:
- no on-chain deposit proof (no light client, no `verified_sats`);
- BTC/ETH signing only from a CLI;
- no market and no loans.

The comparison table in the README has been sharpened for this (column "BTC/EVM address", row "Sell it as Bitcoin").

**Pusaka's position (assuming public repo + video + green CI):**
| Track | Pusaka | Above Pusaka |
|---|---|---|
| nfts | 8.3–8.5 | Contri 8.7 (first scorer); level with Contri 8.2 (second scorer) |
| defi | 8.2 | Warrant 8.8, Hallmark 8.8 |
| open | 8.3 | Sealed Exploit 8.8, Veto 8.7, Writ 8.5, GetLeash 8.5 |

**Now (private repo, no video, CI red because of billing): 6.2.** Outside scorers give Repro 1 as long as the repo can't be opened.

**Actions, ordered by score gain per hour:**
1. Public repo (user), by 12 Nov at the latest. Repro 1 → 9, and CI becomes free again so the badge turns green.
2. 2–2.5 minute video + X post (user). Opening line: "Native BTC, proven by a light client". Show real screens + explorer, not animation.
3. ~~Align the test counts~~: done (376 in all documents).
4. ~~"What's real / not" box~~: done, at the top of the README.
5. ~~`verify.mjs` checks v2~~: done. ~~Delete the v2 key~~: done 13 Nov (`6PrDXyqq…`).
6. Mainnet (user, needs funds) is the only way to catch Contri, Hallmark and Warrant on "impact".

## 4. Honest: parity, what to catch up on, gaps
**Parity (not differentiators):**
- NFTs that carry a wallet: Handover, Deed, Torch, Logen, Outlive.
- Keyless contract + one-command `verify`: Warrant, Handover, Sealed.
- Gas-free relayer: Heir, Warrant.
- Inheritance / dead-man's switch: Heir.
- MCP for agents: OneUp.

**Competitor features we must catch up on:**
1. **Mainnet** (Warrant, setllend). This is Pusaka's only big weakness in `defi` and in "impact".
2. **A visible refusal room**: Warrant shows real failed tx in the app. Pusaka has its failed tx (`NotOwner`, `TooEarly`, `CodeMismatch`, and others), but only in the README and tests.
3. **Real Intents execution** for the `defi` track (Warrant, setllend). Only possible on mainnet.

**Gaps nobody has filled yet (evidence):**
1. **ERC-6551 "drain before sale"**: a problem acknowledged in the EIP thread and in an academic survey. Pusaka solves it for BTC: the balance is proven by the light client at the time of sale, and the buyer binds `expected_sign_epoch`.
2. **Native BTC + a sellable NFT + on-chain deposit proof + atomic sale**: the research found not a single live product that combines all four. Liquidium uses a third-party oracle, LBTC and tBTC use signer sets, and nBTC wraps BTC.
3. **Custodian-free Bitcoin inheritance**: Heir is only for NEAR/ETH. Babylon, Lombard, and tBTC don't have this feature.

**New narrative risk (8 Nov): Shade Agents are *deprecated*.** docs.near.org: "After April 19th, 2026, the Shade Agent Framework will no longer [be] maintained as standalone developer tooling." Pusaka mentions it in the README (6 places) and in the submission text. NEAR judges will read that as using outdated tooling. → F3.

## 5. Real differentiators that are hard to copy
1. **Trust & verification: a Bitcoin light client inside the contract.** `verified_sats` = proven deposits minus every output the contract has ever signed. Buyers, lenders, and agents only need to read the contract, not an indexer or an oracle. To copy this, a competitor needs to understand Bitcoin Merkle proofs, confirmations, and change (proposal 5).
2. **Composability: one NFT, five chains, one transaction.** BTC (MPC secp256k1), ETH + USDC on 3 EVMs (USDC checked through MPC foreign-tx verification), SOL (ed25519), a NEAR account + nBTC (Omni) + stake. All of it moves together with `nft_transfer`.
3. **Credit on top of BTC without a bridge, usable by AI agents.** BTC-backed loans, a standing offer market, refinancing, and Dutch auctions. An MCP server with 61 tools, spending guards and elicitation, so agents that act stay under human control.

## 6. Positioning
> For **Bitcoin holders** who want to sell, borrow against, or pass on their BTC **without a bridge or custodian**, **Pusaka** is **a NEAR NFT that owns a real Bitcoin address**, with a balance **proven on-chain by NEAR's Bitcoin light client** that moves with the NFT in a single transaction. **Unlike** LBTC/tBTC, which wrap BTC behind a signer consortium, or ERC-6551 NFT wallets, which the seller can drain before the sale is final.

## 7. Feature / integration candidates
| # | Candidate | Added value | Score impact | Competitors have it? | Effort | Risk | Reference | Decision |
|---|---|---|---|---|---|---|---|---|
| F1 | **Mainnet deploy** (`pusaka.near` / user account) + one live Pusaka | `defi` 6→8, impact 6→8; "nobody to switch it off" proven | High | Warrant, setllend | 3–4 h | Needs user funds (~$35 minimum / ~$47 full, `docs/MAINNET.md`); cannot be undone | `docs/MAINNET.md` | **Postponed** (user, 8 Nov: "later"); to be decided before 13 Nov |
| F2 | **Refusal room**: a `#/refused` page with real failed tx from the chain (NotOwner, TooEarly, CodeMismatch, front-run sign epoch, …), each with an explorer link and the test that guards it | Polish + "trust" visible in 10 seconds; winning pattern no. 4 | Medium–High | Warrant | 3 h | Low: read-only, data already exists | README threat model, `receipt-monitor.mjs` | **BUILD — done 8 Nov**: `#/refused`, 11 real tx (picked from 441 contract tx), `live.spec` + axe + overflow pass |
| F3 | **Change the framing Shade Agent → "deposit prover in a TEE (Phala TDX)"**, plus a note that the framework is deprecated | Avoids the impression of outdated tooling | Medium | — | 30 minutes | Zero | docs.near.org (see §4) | **BUILD — done 8 Nov** (README 6 places, submission text 1,620 characters) |
| F4 | Real Intents/1Click execution to exit from BTC | `defi` +1 | Medium | Warrant, setllend | 4 h after F1 | Mainnet liquidity only | 1Click API | **BUILD — done 9 Nov (testnet, through Tidepool)**: script, web form (Intear, 14.79 USDC), and MCP tools `pusaka_swap_to_usdc`/`pusaka_swap_status`; mainnet (1Click) follows F1 |
| F5 | Deterministic accounts (state-init) / global contract per NFT | Latest version of "NFTs as accounts" | Low–Medium | Deed, Sealed | 1–2 days | Changing the core architecture 6 days before the deadline; the contract is already final (renounced) | docs.near.org deterministic accounts | **BUILD — done 9 Nov in contract v2** (`pusaka-v2.testnet`, upgradeable through the DAO): a `0s…` account per NFT from the `token-account` global contract, `account_call` only by the holder, live #4–#6 |
| F6 | ML-DSA post-quantum key | — | Zero | — | — | — | — | **BUILD — done 9 Nov in v2**: `set_pq_key` + `pq_unlock` verified on-chain with `env::ml_dsa_verify` (NEP-645, 3.5 TGas); UI `#/v2`, MCP tool `pusaka_pq_unlock` |
| F7 | TLA name owned by the NFT | fits the `nfts` brief | Low | — | 1–2 days | Mainnet + rent | — | **BUILD (testnet version) — 9 Nov**: a TLA name is impossible (only `registrar` can create names < 65 characters), so the alias is `t<id>.pusaka-v2.testnet` with the same rules |
| F8 | **Contract-enforced daily budget for AI agents** (adopted from Hallmark/Veto) | A hijacked agent loses at most one day's budget, and only to accounts the holder registered | Medium (nfts "ownership with behavior" + open) | Hallmark (off-NFT), Veto (TEE) | 4 h | Low | — | **BUILD — done 10 Nov in v2** through DAO proposal 10: `set_agent`/`agent_send`/`agent_of`, 9 `f8_*` tests, live 1 payment + 4 rejections on-chain, MCP tool + UI `#/v2/7` |
| F9 | **Sign in as the NFT** (EIP-4361, the NFT's MPC EVM key) | Logins/access owned by the NFT's address move to the new holder | Medium (nfts "carry credentials") | — | 3 h | Low | — | **DONE 10 Nov** (proposal 11): `sign_in`, 6 `f9_*` tests, live `BBN85r1K…` + `NotOwner` rejection, MCP tool `pusaka_sign_in`, button at `#/v2/<id>` |
| I1 | **NFT sold whole through NEAR Intents** (`nft_transfer_call` to the defuse verifier, `token_diff` NEP-413) | Pusaka #15 (10,000 sats) sold for 5 USDC in one tx; a mismatched price is rejected and the NFT returns | High (defi: Intents used as settlement of a real asset) | — | 2 h | Low | — | **DONE 10 Nov** without changing the contract: `scripts/intents-nft-sale.mjs`, tx `ALQN3eLY…` |
| I2 | **The NFT has its own NEAR Intents balance**, which moves when the NFT moves | Balance controlled only by the current holder; gap V2-9 closed | Medium (defi + nfts) | — | 2 h | Low | — | **DONE 10 Nov**: `scripts/v2-intents-balance.mjs`, shown at `#/v2/<id>` |
| A1 | **Bids per verified sat** (Blur collection bids pattern) in a separate market contract | Instant exit for every Pusaka, price follows the proven contents | High (defi) | Blur | 4 h | Medium | — | **DONE 10 Nov**: `pusaka-market.testnet`, live `5rApe8UQ…` + `SatsOutOfRange` rejection |
| A2 | **Loans without maturity** (Blend: call → interest auction → refinance/seize) | Loan liquidity without an oracle | High (defi) | Paradigm/Blur Blend | 4 h | Medium | — | **DONE 10 Nov**: live offer → call → refinance 173.53 % → repay |
| A3 | **BIP-322 BTC address proof** from the NFT's MPC key | Proof of address ownership accepted by Bitcoin wallets/exchanges | Medium (nfts, open) | BIP-322 | 2 h | Low | — | **DONE** (proposal 16), matches the official vectors |
| A4 | **Renter (ERC-4907 user)** | Rent out access without handing over the NFT/BTC | Low | ERC-4907 | 1 h | Low | — | **DONE** (proposal 16) |
| A5 | **Buy a Pusaka with real BTC**, proven by the light client | Bitcoin buyers without NEAR tokens | High (nfts, defi) | Atomiq (pattern) | 5 h | Medium | — | **CONTRACT DONE** (proposal 16, 11 tests, listing+reservation live); live BTC payment pending: the ISP blocks Bitcoin explorers from this machine |
| A6 | **Proof-of-reserves page** + `reserves()` view | A PoR primitive that can be re-verified | Medium (defi) | Chainlink PoR, Lombard | 2 h | Low | — | **DONE**: `#/reserves` |
| A7 | Pyth prices / on-chain LTV limit | — | — | Pyth | — | — | — | **REJECTED**: the testnet feed has been stale since June 2026 and Hermes now needs a paid API key (401) |
| A8 | Withdrawal delay + guardian veto (Zodiac Delay) | — | — | Safe/Zodiac | — | — | — | **REJECTED**: a key thief only needs to move the NFT; an effective delay would have to delay every owner action (a big refactor). The PQ key (F6) already makes a stolen NEAR key useless |
| A9 | Instant loan pool (Liquidium/Rhea) | — | — | Liquidium | — | — | — | **NOT BUILT**: needs an on-chain price oracle (see A7) and share accounting; too risky for 3 days |
| A10 | **x402 on NEAR**: paid proof-of-reserves audit per call | Agents pay for services without an account/API key | High (agent economy) | FastNear `@fastnear/x402` | 3 h | Low | — | **DONE 10 Nov**: `api/audit.mjs`, MCP tool `pusaka_paid_audit`, live `seQLPR6C…`, `A2qiMjNA…`, `9Qmkeyad…`; the public facilitator needs a manual API key, so settlement happens in our own process through the relayer |
| A11 | **Vault + clawback** (copying Bitcoin covenant vaults: CTV/OP_CAT, Liana/Casa) | A stolen key can't drain immediately | High (security) | purrfect_vault, bitcoinops vaults | 3 h | Medium | — | **DONE 10 Nov** (proposal 19): F14, 14 `f14_*` tests, live at `#/v2/5` |
| A12 | **Covered call** (Hook) | The holder earns a premium without selling | Medium (DeFi) | Hook protocol | 2 h | Medium | — | **DONE 10 Nov** (proposal 19): F15, 11 `f15_*` tests, live |
| A13 | **Linear-curve buy pool** (sudoswap) per verified sat | Instant liquidity for many Pusaka | Medium | sudoswap | 1 h | Low | — | **DONE 10 Nov**: `place_pool`, 5 `pool_*` tests, market redeploy `HfF9Axjj…` |
| A14 | **Passkey login** (WebAuthn PRF → NEAR implicit account) + relayer | Users without a wallet | Medium (onboarding) | web3-authn, Tatchi | 3 h | Medium | — | **DONE 10 Nov**: `web/src/passkey.js`, live `J3d5cvfp…`, `GCkmawSb…` |
| A15 | **Telegram Mini App** | Distribution (Portals/MRKT have traction on Telegram) | Medium | MRKT, Portals | 1 h | Low | Bot created by the user via BotFather | **READY**: `web/src/telegram.js`, `docs/TELEGRAM.md` |
| A16 | **ERC-8004 agent card** | Agents can be discovered | Low | ERC-8004 | 0.5 h | Low | On-chain registration needs Base Sepolia ETH | **DONE (discovery only)**: `/.well-known/agent-registration.json` |

## 8. Specifications of the selected features
### F2 — Refusal room
- **User story:** as a judge or prospective buyer, I want to see with my own eyes that the attacks named in the README are really rejected by the chain, not only by tests.
- **Flow:** nav "Refused" → a list of cards. Each card shows who tried what, the panic code (translated by `errors.js`), the time, the tx link in the explorer, and the name of the test that guards that attack. Data comes from the listed tx (hashes fixed in the code), and their status is read live from RPC (`EXPERIMENTAL_tx_status`) so it can't be faked.
- **Acceptance criteria:**
  1. At least 6 real failed tx from the README (NotOwner, TooEarly, CodeMismatch, and others), each with status `Failure` when read from RPC.
  2. The failure sentence comes from the on-chain panic, not static text. If RPC can't be read, the card says "couldn't read", not "refused".
  3. There is a `live.spec` test that checks every card is failed on-chain; `verify.mjs` does not change.
  4. axe: no serious or critical violations.
- **Contract:** no changes (not possible anyway: the contract is final). NEAR RPC only.
- **NEAR tools:** RPC `tx` / `EXPERIMENTAL_tx_status`, explorer.

### F3 — TEE framing
- README (6 places) + submission text: "Shade Agent" → "a deposit prover in a TEE (Phala TDX), registered on-chain with an attestation check (built on NEAR's Shade Agent contract, a framework NEAR has since deprecated)". The tx and the `pusaka-agent.testnet` account stay linked.
- **Acceptance:** `verify.mjs` green (tx links still there); submission character count ≤ 2000.

### F1 — Mainnet (waiting for the user's decision)
The steps are in `docs/MAINNET.md`: deploy the same reproducible wasm, mint 1 Pusaka, make a small BTC deposit, `prove_deposit`, delete the key + `renounce_upgrades`, then add mainnet rows to `verify.mjs`.
**Acceptance:** `verify.mjs --network mainnet` green, and the tx listed in the README.

## 9. UI / landing copy (10 seconds)
Current hero: "NFTs that hold real Bitcoin." + lede (one transaction, no bridge or custodian, no key left with the seller) + total verified sats from the contract. This copy already states differentiator 1. The recommendations only add proof, not claims:
1. Below the verified sats number: "proven by NEAR's Bitcoin light client". **Already there:** "Every satoshi is proven by NEAR's Bitcoin light client, not reported by us."
2. A trust link to F2. **Done:** the "See what the contract refused" pill in the hero, next to "Open the market" and "Connect an AI agent".
3. No "us vs them" table in the app or README (HACKATHON.md: "no marketing"). The comparison stays in this report.
