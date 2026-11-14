# PRD — Pusaka

> **NFTs that hold real Bitcoin. Pass the NFT on, and its BTC goes with it.**
> *Pusaka: NFTs that hold real Bitcoin. Pass it on, and the BTC goes with it.*

| | |
|---|---|
| Status | Draft v1 — 2 Nov 2026 |
| Event | NEAR HACKATHON (nearhackathon.com), deadline **14 Nov 2026 23:59 UTC** |
| Submission tracks | `nfts` (main), `defi`, `open` |
| Network | NEAR testnet + Bitcoin testnet4 |


> **Implementation note (2 Nov 2026, after the spike):**
> - The day 1 spike **succeeded**: the contract calls `sign` on `v1.signer-prod.testnet` cross-contract (deposit of 1 yocto per call) and the resulting tx was accepted by Bitcoin testnet4.
> - The address type changed from P2PKH to **P2WPKH (BIP143)**: `omni-transaction` 0.5 supports the SegWit sighash, and the input values are signed too.
> - The contract fetches the BTC key itself via `derived_public_key` on the MPC contract (callback `on_key`), not from user input (T6).
> - Added after the security review: txids are canonicalised and duplicate outpoints are rejected (T3b); minters and withdrawers pay for storage; history is capped at 32 entries.
> - Measurements: buy ≈ 3.0 s to finality; MPC signature 6.8–13.7 s. The current status is in the README.

> **Status 9 Nov 2026: all P0 and P1 items are done, and most of P2 as well.** The document below stays as the 2 Nov draft, as a record
> of the original plan. What applies now is in the README; this table summarises the differences.
>
> | PRD plan | Reality | Evidence |
> |---|---|---|
> | F1–F11 (P0): mint, BTC address, balance, withdraw, listing, atomic buy, pending lock, outpoint registry, safe balance, history, `npm run demo` | Done | `cargo test` (225 on 9 Nov; 375 now), `live.spec` |
> | F12 gift receiving page · F13 hosted demo · F14 image changes with the BTC inside | Done: Give + NEP-452 gift link · https://pusaka-two.vercel.app · on-chain SVG with "liquid" as high as the balance (`contract/src/art.rs`) | README "Try it" |
> | Bitcoin testnet4, P2PKH | **testnet3** (the network the NEAR light client follows), **P2WPKH** (BIP143) | README "Measured on testnet" |
> | Next.js frontend + wallet-selector | Vite + React + `@hot-labs/near-connect` | `web/` |
> | Non-goal: on-chain light client (UTXOs checked by the client) | **Built**: `prove_deposit` through `btc-client-v4.testnet`, `verified_sats` in the contract | `verify.mjs` |
> | Non-goal: NEP-178 / external marketplace | **Built**: NEP-178 + NEP-199, sold on Mintbase testnet | tx `CCxgRJ7i…` |
> | P2: multi-asset (ETH/SOL), lending collateral | **Built**: ETH + USDC on 3 EVM chains, SOL, its own NEAR account, nBTC, staking; loans and a loan offer market | README |
> | P2: SegWit/Taproot | SegWit yes; **Taproot is not possible**: NEAR's MPC does not have Schnorr yet | — |
> | P2: pay via NEAR Intents | **Partial**: 1Click quote for exiting BTC (dry-run). 1Click liquidity only exists on mainnet | `shared/intents.mjs` |
> | §8 threat model T1–T7 | Extended to T1–T27, each with a named test | README "threat model" |
> | §8.3 team full access key on the contract | **Removed**: the contract has no key, upgrades renounced through the DAO (8 Nov) | `verify.mjs` |
> | §13 video ≤ 90 s | Script of 2:15 (X limit 2:20) in `docs/reports/08-video.md`; recording by the team | — |
> | Mainnet (non-goal) | Not yet: waiting for the team's decision and funds (`docs/MAINNET.md`) | — |

---

## 1. Summary

Pusaka is an NFT collection (NEP-171) on NEAR where **every token has a real Bitcoin address** derived through **NEAR Chain Signatures**. That address is controlled by the Pusaka contract, and the contract only requests an MPC signature on the order of the **current NFT owner**. As a result, ownership of the BTC moves together with the NFT, in one NEAR transaction (~1 second), with no bridge, no wrapped token, no custodian, and no private key that the previous owner could secretly keep.

---

## 2. Background & problem

Moving BTC ownership today always sacrifices something:

| Method | Problem |
|---|---|
| On-chain Bitcoin transaction | 10–60 minutes of confirmations, fees, and mutual trust needed during the process (who sends first?) |
| Wrapped BTC (WBTC, etc.) | Depends on a custodian/bridge, a point of hacks and censorship |
| Hand over the private key / seed | The previous owner can keep a copy; there is no guarantee |
| NFT wallet on Ethereum (ERC-6551) | Can only hold assets on its own chain, not real BTC |

**Insight:** Chain Signatures let a NEAR *contract* own a real Bitcoin address. If that contract is also the NFT contract, then "who owns this BTC" is simply decided by "who owns this NFT", which is state that moves atomically on NEAR.

---

## 3. Goals & non-goals

### Goals (hackathon)
1. Prove it end to end on testnet: mint → fund with BTC → atomic sale → buyer withdraws the BTC.
2. Enforce that **the previous owner cannot take the BTC after the NFT moves** (see §8), with a test for each scenario.
3. Reproducible by judges (Claude Code / Codex + humans) in **≤ 10 minutes** without looking for a BTC faucet.

### Non-goals (MVP)
- Mainnet / real funds.
- On-chain Bitcoin light client (UTXO verification is done by the client, see §8.3).
- External marketplace integration (NEP-178 approvals are deliberately not implemented).
- SegWit/Taproot addresses (the MVP uses P2PKH, see §7.4).
- Assets other than BTC (EVM/SOL could come later with the same mechanism).

---

## 4. Personas & use cases

| Persona | Need | Use case in Pusaka |
|---|---|---|
| **OTC trader** | Sell a large BTC position without mutual trust | List an NFT holding 0.5 BTC, the buyer pays → the NFT moves atomically |
| **Gift giver / inheritance** | Give BTC that can be inherited without leaking the seed | Mint a Pusaka, fund it with BTC, transfer the NFT to the recipient |
| **Borrower (P2)** | Pledge real BTC without a bridge | Pusaka as collateral in a NEAR lending protocol |

**Main use case for the demo:** OTC, a seller and a buyer who do not know each other.

---

## 5. Feature scope

### P0 — required for submission
| ID | Feature |
|---|---|
| F1 | Mint a Pusaka NFT (NEP-171 core + metadata) |
| F2 | Derive a BTC address per token (path = `pusaka-{token_id}`), shown in the UI |
| F3 | Read the balance & UTXOs of the token address from Bitcoin testnet4 (mempool.space API) |
| F4 | **Withdraw:** the contract builds the BTC tx, checks the owner, requests an MPC signature per UTXO, and returns a tx ready to broadcast |
| F5 | **Listing** with a NEAR price; a listing locks withdraw |
| F6 | **Atomic buy:** pay NEAR → the seller is paid + the NFT moves in one transaction |
| F7 | **Pending lock:** while a signature is being processed, transfer/listing is rejected |
| F8 | **Signed-outpoint registry:** the contract records every UTXO it has ever signed |
| F9 | **Safe balance:** the UI computes the safe balance = unspent UTXOs that have *never* been signed |
| F10 | History per token: owners, sales, withdrawals |
| F11 | `npm run demo` + a demo NFT already holding testnet BTC |

### P1 — if time allows
| ID | Feature |
|---|---|
| F12 | Gift transfer (`nft_transfer`) with a "receive Pusaka" page that shows the safe balance |
| F13 | Hosted demo on Vercel (stays online until 25 Nov) |
| F14 | Dynamic NFT visual: the image changes with the amount of BTC inside |

### P2 — roadmap (written in the README, not built)
- Pay with assets from any chain via **NEAR Intents**
- On-chain Bitcoin light client for trustless UTXO verification
- SegWit/Taproot, multi-asset (ETH/SOL), Pusaka as lending collateral

---

## 6. User stories & acceptance criteria

**US1 — Mint**
As a user, I mint a Pusaka and immediately see its BTC address.
- AC: `nft_mint` succeeds → `btc_address(token_id)` returns the same testnet P2PKH address as the off-chain derivation (chainsig.js).
- AC: Two different tokens always have different addresses; the same token always has the same address.

**US2 — Fund the balance**
As the owner, I send testnet BTC to the token address and the balance appears in the UI.
- AC: The balance and UTXO list show up ≤ 30 seconds after the tx enters the mempool.

**US3 — Withdraw**
As the owner, I withdraw BTC to any address.
- AC: Only `owner_of(token)` can call it; any other account → panic `NotOwner`.
- AC: The tx produced by the contract is valid and accepted by the testnet4 network (the txid can be checked on mempool.space).
- AC: Every input outpoint is recorded in the signed-outpoint registry.

**US4 — Listing**
As the owner, I list a Pusaka for N NEAR.
- AC: While listed, `withdraw` and `nft_transfer` are rejected (`Listed`).
- AC: `cancel_listing` re-enables withdraw.
- AC: Listing is rejected if the token is `SignPending`.

**US5 — Buy**
As a buyer, I see the safe balance and then buy.
- AC: `buy` with deposit ≥ price → the seller receives NEAR, the NFT moves to the buyer, the listing is removed, all in one transaction.
- AC: `buy` takes an `expected_signed_count` parameter; if the registry changed since the buyer checked → it fails (`StateChanged`).
- AC: After the purchase, the previous seller calls `withdraw` → `NotOwner`.

**US6 — Buyer verification**
As a buyer, I know how much BTC is truly safe.
- AC: The UI shows the **Safe balance** and the **At-risk balance** (UTXOs that have been signed but are not yet spent) separately, with an explanation.

---

## 7. Technical specification

### 7.1 Architecture

```
┌──────────────┐      ┌────────────────────────────┐      ┌─────────────────────────┐
│ Frontend     │─────▶│ Contract pusaka.testnet     │─────▶│ MPC signer              │
│ Next.js      │      │ (Rust, near-sdk)            │◀─────│ v1.signer-prod.testnet  │
│ wallet-      │      │ - NEP-171                   │ sig  │ (Chain Signatures)      │
│ selector     │      │ - atomic listing & buy      │      └─────────────────────────┘
│              │      │ - build BTC tx (omni-tx)    │
│              │      │ - locks + outpoint registry │
│              │      └────────────────────────────┘
│              │── balance/UTXO/broadcast ──▶ Bitcoin testnet4 (mempool.space/testnet4/api)
└──────────────┘
```

### 7.2 Contract state

```rust
struct Pusaka {
    tokens: NonFungibleToken,                    // near-contract-standards NEP-171
    listings: LookupMap<TokenId, Listing>,       // { price: NearToken, seller: AccountId }
    pending: LookupSet<TokenId>,                 // tokens waiting for an MPC signature
    signed_outpoints: LookupMap<TokenId, Vector<OutPoint>>, // { txid: [u8;32], vout: u32 }
    history: LookupMap<TokenId, Vector<Event>>,  // Mint | Sale | Withdraw | Transfer
    mpc_contract: AccountId,                     // v1.signer-prod.testnet
}
```

### 7.3 Methods

| Method | Access | Description |
|---|---|---|
| `nft_mint(receiver_id)` | public, storage deposit | Mint a new token |
| `btc_path(token_id) -> String` | view | `"pusaka-{token_id}"` |
| `listing(token_id)` / `signed_outpoints(token_id)` / `history(token_id)` | view | Data for the UI & verification |
| `withdraw(token_id, utxos: Vec<Utxo>, to: String, amount, fee)` | owner | Check lock → build tx → mark `pending` → call MPC `sign` per input → callback |
| `on_signed(token_id, ...)` | private callback | Remove `pending`, record outpoints, return the signature/raw tx; if MPC fails → only remove `pending` |
| `list(token_id, price)` | owner | Reject if `pending` |
| `cancel_listing(token_id)` | owner | |
| `buy(token_id, expected_signed_count)` | public, deposit = price | Pay the seller + transfer the NFT + remove the listing, atomically |
| `nft_transfer(...)` | NEP-171 | Rejected if `pending` or listed |

**Core rule:** the contract **never** signs a hash supplied by the user. The hash is always computed by the contract from a tx it built itself, so every signature is bound to a recorded outpoint.

### 7.4 Bitcoin

- **Address type:** testnet P2PKH (legacy). Reason: `omni-transaction-rs` (v0.3) provides `build_for_signing_legacy(EcdsaSighashType::All)` with a P2PKH example; SegWit is not clearly documented yet → postponed to P2.
- **Key:** public key derived from the MPC master key + (contract account, path) → hashed into a P2PKH address. The derivation is cross-checked against chainsig.js in tests.
- **Signature:** ECDSA secp256k1, **one `sign` call per input UTXO** (as in the official example).
- **UTXO inputs:** supplied by the frontend (from mempool.space). The contract cannot verify that they exist; if the user lies, the tx is simply invalid on Bitcoin and only the caller loses.
- **Broadcast:** the frontend assembles the signatures into the tx and then does `POST /tx` to mempool.space testnet4.

### 7.5 Token state machine

```
          list()                    buy()
  Idle ────────────▶ Listed ───────────────▶ Idle (new owner)
   │  ▲              │
   │  │ on_signed()  │ cancel_listing()
   │  │              ▼
   │  └──────── SignPending ◀── withdraw()  (only from Idle)
   └──── nft_transfer() ──▶ Idle (new owner)   (only from Idle)
```

---

## 8. Threat model

The main question: **how could the previous owner try to still take the BTC after the NFT moves?**

| # | Attack | Mitigation | Enforced by | Test |
|---|---|---|---|---|
| T1 | Withdraw BTC right before the NFT is sold | A listing locks withdraw | Contract | `withdraw_while_listed_fails` |
| T2 | Request a signature, then immediately transfer/sell the NFT before MPC answers | The `SignPending` status blocks transfer/listing/buy | Contract | `transfer_while_pending_fails` |
| T3 | **Pre-signed tx:** request a signature, do not broadcast, sell the NFT, broadcast later | Every signed outpoint is recorded on-chain; the buyer only counts UTXOs that have **never** been signed as the *safe balance* | Contract (registry) + client (calculation) | `outpoints_recorded_on_sign`, safe balance UI test |
| T4 | Changing the state between the buyer's check and the purchase | `buy(expected_signed_count)` fails if the registry changed | Contract | `buy_with_stale_count_fails` |
| T5 | Another account requests a signature for someone else's token | Check `predecessor == owner_of(token)`; the path can only be used by the Pusaka contract account | Contract + MPC | `non_owner_withdraw_fails` |
| T6 | Signing an arbitrary hash through the contract | The contract only signs the sighash of a tx it built | Contract | code review + `no_raw_hash_entrypoint` |
| T7 | An unknown BTC sender "pollutes" the token | Harmless: extra UTXOs only add to the balance | — | — |

### 8.3 Limitations stated honestly in the README
- A NEAR contract cannot read Bitcoin state. The "UTXO already spent" status is verified by the **client** through an indexer (anyone can re-verify with their own Bitcoin node). Upgrade: on-chain Bitcoin light client (P2).
- Security depends on NEAR's MPC network (threshold assumption).
- The contract on testnet is deployed with a full access key owned by the team; for production, the key must be deleted/locked so the code cannot be replaced secretly.

---

## 9. Frontend specification

| Page | Contents |
|---|---|
| `/` Gallery | A card for each Pusaka: image, BTC safe balance, price if listed, `Listed` / `Pending` badge |
| `/pusaka/[id]` Detail | BTC address (+ QR), safe vs at-risk balance, UTXO list, history; buttons by role: **Fund**, **Withdraw**, **List/Cancel** (owner) or **Buy** (others) |
| `/mint` | Mint button + instructions for funding with testnet4 BTC |
| Buy modal | Safe balance breakdown, a warning if anything is at risk, price confirmation |

Principle: one clear moment per screen; technical terms are hidden, and the security explanation is available in a "Why is it safe?" tooltip.

---

## 10. Non-functional requirements

| Area | Target |
|---|---|
| Reproducibility | Clone → `npm install` → `npm run demo` → see the full buy-sell flow, ≤ 10 minutes, with no API key and no BTC faucet (using the demo token that is already funded) |
| Tests | `cargo test` / `npm test` as one command; all §8 scenarios covered |
| Repo security | No secrets in the repo; keys in `.env` (example in `.env.example`) |
| License | MIT, `LICENSE` file |
| Demo availability | Hosted demo online until 25 Nov 2026 |

---

## 11. Success metrics (for the README & demo)

Judges at previous NEAR hackathons asked for numbers. What we will measure and report:

| Metric | Target |
|---|---|
| BTC ownership transfer time (buy → NFT moves) | ≤ 2 seconds (1 NEAR tx) vs ±10–60 minutes on-chain on Bitcoin |
| Ownership transfer cost | < $0.01 NEAR gas, 0 Bitcoin fee |
| MPC signature latency per UTXO | measured & reported |
| Threat model coverage | 7/7 scenarios have a test, all passing |
| Judge reproduction time | ≤ 10 minutes |

---

## 12. Mapping to the judging criteria

| Criterion | Evidence in Pusaka |
|---|---|
| AI screening (runs & matches the README) | `npm run demo`, one-command tests, README in "do X → see Y" format |
| Technical implementation | BTC tx built on-chain, locks, outpoint registry, threat model tests |
| Originality | An NFT that holds real BTC: not present in the 62 submissions as of 2 Nov |
| Impact | Trustless BTC OTC, gifts/inheritance, collateral |
| NEAR leverage | Chain Signatures + the contract as guardian + atomic transfer: impossible without a custodian on other chains |
| Design / clarity | "I sold 0.01 real BTC in 1 second by transferring an NFT" |
| NFT track ("ownership with behavior", transfer threat model) | §8 answered in full with tests |

---

## 13. Demo & submission plan

### Demo video (≤ 90 seconds)
1. **(0–10s)** The problem: "Moving BTC = waiting for confirmations or trusting a custodian."
2. **(10–25s)** Pusaka #1 holds 0.01 testnet BTC: show its address on mempool.space.
3. **(25–45s)** The seller lists → the buyer (second browser) sees the safe balance → clicks Buy → the NFT moves in ~1 second.
4. **(45–60s)** The previous seller tries to withdraw → rejected with `NotOwner`.
5. **(60–80s)** The buyer withdraws the BTC → the txid appears on mempool.space.
6. **(80–90s)** "Only possible on NEAR: Chain Signatures." + repo link.

### Draft X post
> Selling Bitcoin usually means waiting for confirmations or trusting a custodian.
> Pusaka: NFTs that hold real BTC (not wrapped). Sell the NFT → the Bitcoin moves with it, in ~1 second.
> Built at NEAR HACKATHON with Chain Signatures. Repo + demo 👇 What would you put inside one?
> @NEARProtocol @NearBuilders @NearLegion #NEARHackathon

### README outline
1. What Pusaka is (2 sentences) · 2. Try it in 5 minutes (do X → see Y) · 3. How it works + diagram · 4. Threat model & limitations · 5. NEAR features used · 6. Metrics · 7. Repo structure & how to test · 8. Libraries & AI used (rule Q-005) · 9. License

### Submission payload
`tracks: ["nfts","defi","open"]`: personal data (name, email, `.near` address, X post link) is filled in by the team, **not made up**.

---

## 14. Timeline

| Day | Date | Target | Exit criteria |
|---|---|---|---|
| 1 | 3 Nov | **Feasibility spike** | A testnet contract calls MPC `sign` and the resulting testnet4 BTC tx is accepted by the network. **Failure → pivot** to the backup idea (cross-chain DAO treasury) |
| 2–3 | 4–5 Nov | NEP-171, address derivation, withdraw + owner check | US1, US3 pass |
| 4–5 | 6–7 Nov | Listing, atomic buy, pending lock | US4, US5 pass |
| 6 | 8 Nov | Outpoint registry, `expected_signed_count` | T3, T4 pass |
| 7 | 9 Nov | Complete the threat model tests | 7/7 tests pass |
| 8–9 | 10–11 Nov | Frontend: gallery, detail, buy, withdraw, safe balance | Demo flow runs in the browser |
| 10 | 12 Nov | Deploy, demo token holding BTC, `npm run demo`, hosted demo | Reproduction from a clean clone ≤ 10 minutes |
| 11 | 13 Nov | README, measure metrics, record video, draft X post | All materials ready |
| 12 | 14 Nov | Buffer → repo public → X post → submit (target **< 18:00 UTC**) | 201 response from the submit API |

---

## 15. Risks & open questions

| Risk | Impact | Mitigation |
|---|---|---|
| The MPC contract's `sign` API format (arguments, deposit, gas) differs from what we expect | Blocks F4 | Checked in the day 1 spike against the `near-examples/near-multichain` repo & the MPC contract |
| `omni-transaction-rs` fails to compile to WASM / wrong sighash | Blocks F4 | Fallback: the frontend builds the tx, the contract verifies & records the declared outpoints (weaker, stated in the README) |
| No official example yet of a contract calling MPC cross-contract (not from a user wallet) | Blocks F4 | Spike priority #1; look for examples in the NEAR examples repo |
| Slow MPC latency | The demo feels slow | The buy-sell demo does not need MPC; MPC is only in withdraw |
| Testnet4 BTC faucet is hard to use | Judges cannot try it | Demo token already funded by the team |
| Running out of time | No submission | P1/P2 get cut first; submit on day 12 before 18:00 UTC |

**Open questions:**
1. Solo team or more? (decides whether F13/F14 are realistic)
2. Testnet contract account name (e.g. `pusaka.testnet`): the team needs to create it.
3. Listing price in NEAR only, or also testnet USDC?

---

## Appendix A — Verified technical facts (2 Nov 2026)

- MPC signer: testnet `v1.signer-prod.testnet`, mainnet `v1.signer`.
- Derived address = f(calling account, path, MPC master key); other accounts cannot control the same address.
- Bitcoin uses `Ecdsa` (secp256k1); the official example uses mempool.space **testnet4** and **one `sign` per UTXO**.
- `omni-transaction = "0.3"`: `TransactionBuilder::new::<BITCOIN>()`, `build_for_signing_legacy(EcdsaSighashType::All)`, `build_with_signature(...)`. Note: the example in its README uses `hex.as_bytes()` for the scriptPubKey (ASCII bytes, not the decoded result), so do not copy it as is.

Sources: docs.near.org/chain-abstraction/chain-signatures/implementation · github.com/near/omni-transaction-rs · github.com/near-examples/near-multichain · github.com/NearDeFi/chainsig.js · nearhackathon.com/HACKATHON.md
