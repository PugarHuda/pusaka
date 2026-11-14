# 07 — Deploy, submission & pitch (DevOps & Submission)

Reference: `01`–`06`. Official rules: https://nearhackathon.com/HACKATHON.md.

## Build & CI (every push/PR + daily)
| Step | Status |
|---|---|
| `cargo test` testnet + mainnet (376 + 376, including fuzz + invariant) | ✓ |
| `cargo audit` | ✓ (1 dev-only advisory ignored, with a stated reason) |
| reproducible wasm build + sha256 | ✓ |
| Node unit (14 files in CI) | ✓ |
| `npm run lint` (oxlint, `no-undef`) | ✓ |
| typecheck | none: JavaScript project; `tsc --checkJs` was tried, only false positives |
| `npm run build -w web` | ✓ |
| Playwright `live.spec` (45) + `ui.spec` (115), report artifact | ✓ |
| `verify.mjs`, receipt monitor, MCP smoke/due diligence | ✓ |
| `npm audit` | 0 vulnerabilities |

## Deployment
- Frontend: https://pusaka-two.vercel.app (Vercel, connected to GitHub; every push to main = deploy). The live version is tested by `live.spec` against the contract `pusaka-btc.testnet`.
- Contract & proofs: `03-contracts.md`.
- `.env.example`: every variable is optional, and how to get each one is written on its line.
- Setup from scratch: done on 4 Nov from a clean clone (fix: tests that need a gitignored key now use a one-time faucet account); `npm run demo` no longer waits for the BTC faucet (3-minute fallback).

## README for judges
Already there: a one-liner on the first line, demo link, try-it "do X → see Y", JUDGES.md (5 minutes), architecture (ASCII diagram "How it works"), table of contract accounts + explorer, threat model T1–T27 → tests, the "Every NEAR primitive" table, "Measured on testnet" with tx hashes, how to run the tests. In line with HACKATHON.md ("no marketing"), the README does not name competing projects. Since 9 Nov there is a factual table "How this differs from other 'the NFT is a wallet' designs" that compares three designs (NEAR sub-account, EVM address through Chain Signatures, Pusaka) without the words "first/best"; the per-project comparison is in `02-strategy.md`.
Not there yet (needs the user): demo video link and X post.

## Demo video script (2:30)
| Time | Screen | Narration |
|---|---|---|
| 0:00–0:15 | landing | "Selling Bitcoin together with an NFT usually means a bridge, wrapped BTC, or trusting the seller. Pusaka: an NFT on NEAR that holds real Bitcoin." |
| 0:15–0:45 | `#/pusaka/10`: verified BTC, tb1 address, History | "This balance is proven on NEAR by a Bitcoin light client, not an indexer. The key is held by NEAR's MPC network, can only be used by the contract, and only at the request of the current NFT owner." |
| 0:45–1:15 | Buy with a wallet (one approval) → "You own Pusaka #10" | "One NEAR transaction: the seller is paid, 2.5 % royalty, the NFT moves, and its Bitcoin goes with it." |
| 1:15–1:35 | the old seller tries to withdraw → "Only the current holder… (NotOwner)" | "The seller keeps no key at all. The contract itself has no access key." |
| 1:35–2:00 | one Pusaka: ETH/USDC on 3 EVMs, SOL, NEAR account + stake, nBTC | "One NFT, many wallets: they all move together." |
| 2:00–2:20 | loan: request → fund; terminal `node scripts/verify.mjs` all checks passed | "Borrow with BTC as collateral, without a bridge. Every README claim is re-checked against the chain with one command." |
| 2:20–2:30 | landing + URL | "Pusaka: pusaka, an heirloom that changes hands. Built at NEAR HACKATHON." |

## Pitch deck outline (8 slides)
1. Problem: BTC cannot be sold/bequeathed/used as collateral together with other assets without a bridge or custodian.
2. Solution: a NEP-171 NFT that controls a real BTC address through Chain Signatures.
3. Demo: buy #10 (tx), old seller refused (failed tx `NotOwner`).
4. Differentiators: balance proven on-chain (light client), one NFT many chains, credit market.
5. Architecture: contract ↔ MPC signer ↔ light client ↔ NEP-366 relayer ↔ MCP agents.
6. NEAR integrations: Chain Signatures (3 domains + CKD + foreign-tx), light client, Intents, Omni nBTC, staking, Sputnik DAO, NEP-330/366/413/452/611.
7. Validation: 376 contract tests (fuzz + invariant, 96 % line coverage), 160 Playwright tests, `verify.mjs` (check "upgrades renounced: final"), live tx in the README.
8. Next: mainnet (funds), the NFT owning a TLA name. (Upgrade renounce already done: proposal 7, 8 Nov.)

## Submission form text
- Project name: `Pusaka`
- Tracks: `nfts`, `defi`, `open`
- Repo: https://github.com/PugarHuda/pusaka (must be public)
- Demo post: *(the user publishes it on X, then provides the link)*
- What they built (≤2000 characters):

> Pusaka is a NEAR NFT (NEP-171) that holds real Bitcoin. Each token controls its own native Bitcoin address through NEAR Chain Signatures: the key lives in NEAR's MPC network and the contract asks for a signature only when the current NFT owner requests one, so selling the NFT hands over the Bitcoin in one NEAR transaction, with no bridge, wrapped BTC or custodian, and no key the seller could keep. Deposits are proven, not claimed: NEAR's on-chain Bitcoin light client verifies every deposit and the contract subtracts every output it ever signed, so a buyer, lender or agent reads verified_sats from the contract alone. The same MPC keys make each Pusaka a set of wallets that move together: ETH and USDC on three EVM chains (USDC verified by MPC foreign-transaction checks), SOL, and its own NEAR account holding nBTC and staked NEAR. On top: sales with royalties and Dutch auctions, NEP-178/199 sales on outside markets (tested on Mintbase), loans with the BTC as collateral and a standing-offer loan market, inheritance to an heir with guardians, a holder-only room with a sealed letter (MPC confidential key derivation), gas-free actions through a NEP-366 relayer with a NEP-611 gas key, an MCP server for AI agents with spending guards, and a deposit prover in a TEE (Phala TDX, attestation checked on-chain). The contract has no access key and its code is final: a Sputnik DAO vote renounced upgrades, and the deployed wasm is a reproducible NEP-330 build. 376 contract tests (including fuzz and invariant tests, 96% line coverage) are named after the attacks they stop; node scripts/verify.mjs re-checks every README claim against NEAR and Bitcoin without a wallet.

(1,676 characters.) Lead name, email, team size, mainnet payout account, and contact consent are filled in by the user.

## Final checklist
- [x] Code, tests, CI green, hosted demo (stays live until ≥ 25 Nov)
- [x] LICENSE (MIT)
- [x] Upgrade renounced through the DAO (8 Nov, proposal 7, `GdASfxh5…`)
- [ ] Public repo (≤ 14 Nov 23:59 UTC; 13 Nov recommended) (user)
- [ ] Demo video + X post (@NEARProtocol, #NEARHackathon) (user)
- [ ] Mainnet payout account (`pugarhuda.near`?) (user confirms)
- [ ] Submit (JSON payload shown first, waiting for "yes") (user)
