# Pusaka

[![CI](https://github.com/PugarHuda/pusaka/actions/workflows/ci.yml/badge.svg?event=push)](https://github.com/PugarHuda/pusaka/actions/workflows/ci.yml)

**An NFT on NEAR that holds real Bitcoin. Sell it, borrow against it or leave it to an heir, and the BTC moves with it. NEAR's
Bitcoin light client proves every deposit. Live on NEAR testnet; not on mainnet yet ([what's real](#whats-real-and-what-isnt-yet)).**

Today, putting BTC in an NFT means wrapped BTC or a custodian. Here the NFT controls a native Bitcoin address itself:
each Pusaka is a NEP-171 NFT whose Bitcoin key is held by the NEAR MPC network through
[Chain Signatures](https://docs.near.org/chain-abstraction/chain-signatures), and it signs only when the **current NFT owner** asks.

## Three things to check

1. **Proven, not claimed.** Every satoshi inside is checked by NEAR's own Bitcoin light client, minus everything ever
   signed away: `verified_sats` needs no indexer, oracle or custodian. See the
   [proof of reserves](https://pusaka-two.vercel.app/#/reserves), or run `node scripts/mainnet-proof.mjs` to watch NEAR's
   *mainnet* light client accept the same proof.
2. **Clean to buy.** Before paying, a buyer sees whether anything the seller already signed could still move what's
   inside, on Bitcoin, three EVM chains, Solana and the NFT's NEAR account. The badge is redrawn from the chains on every
   view, and the same answer is JSON other wallets can read: [proof of clean](docs/PROOF-OF-CLEAN.md).

   [![Pusaka #4: proof of clean](https://pusaka-two.vercel.app/api/badge?id=4&contract=pusaka-btc.testnet&clean=1)](https://pusaka-two.vercel.app/?contract=pusaka-btc.testnet#/pusaka/4)
3. **It passes on, with no custodian.** Name an heir and a silence period; if the holder stays silent, the heir claims
   the NFT and every Bitcoin in it ([claimed #2 gas-free](https://testnet.near.rocks/tx/DzHQ4456hRkbJxTBRHDJCJ2C8PhXto5T7AgF33zSD3Dn)).
   An agent in a TEE can claim for the heir with a key that never leaves the enclave and can only call `claim_inheritance`
   ([claimed classic #2](https://testnet.near.rocks/tx/ECFUYRkyr23STgCu8okhYs52RXvHXUmrg9449Q3mUTqR); [check the key is the enclave's](docs/FEATURES.md#the-heirs-agent-in-a-tee)).
   The next one, live: classic #27's heir can claim from 16 Nov 02:00 UTC and the TEE agent claims it then. This badge
   counts down, then names who inherited it:

   [![Pusaka #27: heir countdown](https://pusaka-two.vercel.app/api/badge?id=27&contract=pusaka-btc.testnet&heir=1)](https://pusaka-two.vercel.app/?contract=pusaka-btc.testnet#/pusaka/27)

**About 3 minutes, no wallet:**
```
git clone https://github.com/PugarHuda/pusaka && cd pusaka
npm install && node scripts/verify.mjs        # every claim here, checked against NEAR, its MPC, its light client and Bitcoin
node scripts/mainnet-proof.mjs                # the same proof, accepted by NEAR's *mainnet* Bitcoin light client (free view call)
```
Then open **https://pusaka-two.vercel.app/#/market**. Judges: [JUDGES.md](JUDGES.md) is the shortest path (3-minute check, 10-minute tour).

| | |
|---|---|
| ![The market: every Pusaka with the Bitcoin proven inside it](docs/screenshots/market.png) | ![A Pusaka for sale by Dutch auction: 10,000 sats verified on NEAR, its price against the BTC inside, a live NEAR Intents exit quote](docs/screenshots/token.png) |
| **Market**: every Pusaka, the BTC proven inside | **A Pusaka**: BTC verified on NEAR, price vs. the BTC inside |
| ![Clean to buy: nothing the seller signed can still move what's inside, checked on every chain](docs/screenshots/clean-to-buy.png) | ![Real attacks the contracts refused, each confirmed failed on NEAR](docs/screenshots/refused.png) |
| **Clean to buy**: Bitcoin, every EVM chain, Solana, its NEAR account | **Refused**: real attacks, failed on-chain |
| ![Pusaka #27's will: if its holder stays silent until 16 Nov 02:00 UTC, pusaka-buyer.testnet can claim it with everything it holds](docs/screenshots/heir.png) | ![A prompt-injected agent tries to send a Pusaka's Bitcoin to an attacker and is refused three ways; nothing changes on chain](docs/screenshots/attack-demo.png) |
| **It passes on**: #27's will, claimed by the TEE agent | **Attack demo**: a prompt-injected agent, refused before signing |

More screenshots (lending pool, proof trail, exchange check, Smart Pusaka, reserves, agents): [docs/screenshots](docs/screenshots).

### What's real, and what isn't (yet)

> **Run by us on testnet:** the three price reporters, the gas relayer, and the 3-account DAO that can upgrade
> `pusaka-v2.testnet`. **Nobody can change** the classic `pusaka-btc.testnet`.
> - **Real, on NEAR testnet, every claim with a tx hash** (200 of them, all checked by `verify.mjs`).
> - **Mainnet:** not deployed (needs funds; `docs/MAINNET.md`), but `scripts/mainnet-proof.mjs` shows Pusaka's proof
>   accepted by the mainnet light client `btc-client.bridge.near` for a real mainnet Bitcoin transaction.
> - **NEAR Intents** swaps execute on Tidepool, a 1Click-compatible testnet sandbox with NEAR's unmodified `defuse`
>   verifier; 1Click's own liquidity is mainnet-only, so mainnet is shown as a live quote.
> - **No keys:** the classic contract has none and renounced upgrades. `pusaka-v2.testnet` (the main contract, Smart
>   Pusakas), the market, the USDC pool and pUSD have had none since 13 Nov; v2 changes only through the DAO plus a
>   10-minute timelock (last used 14 Nov to fix review finding R6-1).
> - **The USDC pool** lends Circle's own testnet USDC. On testnet it runs tight (borrow up to 79.5%, liquidation from
>   80%) so a real price move can trigger a real liquidation, and one did on 14 Nov at 81.15%
>   ([BSDwVry5…](https://testnet.near.rocks/tx/BSDwVry5HC95QByn9RYcH2MW5emjSwx8Pa6TCJsKWH8)); mainnet: 50/80.

## Why it's different

| | NFT = a Chain Signatures wallet (Satchel, Handover, Incorpr) | BTC vault NFT for loans (Unwrapped) | **Pusaka** |
|---|---|---|---|
| Bitcoin inside | none (Satchel: 16 EVM chains), or native BTC read off-chain | native UTXOs, SPV-proven on NEAR | **native UTXOs proven on NEAR, plus nBTC in the NFT's own account** |
| Balance stays right after spends | EVM sign record (Satchel) | proven minus a signature ledger | **proven minus every signed output; a buy fails if anything was signed since the buyer looked** |
| Borrowing | no | USDC from a pool | **NEAR from a person (fixed term, no oracle) or Circle USDC from a pool, the holder picks** |
| "Clean to buy" | EVM (Satchel) | n/a | **Bitcoin, every EVM chain, Solana and its NEAR account** |
| Code anyone can trust | Satchel: locked, 0 keys | upgradeable | **keyless contracts, reproducible build (NEP-330), every event replayed by `verify.mjs`** |

Where others are ahead, said plainly: Satchel covers 16 EVM chains and is on mainnet; Unwrapped's pool has a longer
track record; Pusaka's three price reporters are all run by us on testnet, so the 2-of-3 quorum guards against one bad
source, not against us.

## Try it in two minutes (testnet wallet only)

1. Open **https://pusaka-two.vercel.app/#/market**, click *Connect NEAR wallet* and pick Meteor (testnet; new accounts get faucet NEAR).
2. **Buy:** pick any card marked *For sale* (the demo stock is refilled, so the numbers move), then *Buy*. **See:** "You own Pusaka #N", and you can *Withdraw* its BTC to any `tb1…` address.
3. **Lend:** pick any card marked *Asking to borrow* and click *Lend*. **See:** the loan funded, the Pusaka locked as collateral, and *Take the Pusaka* once it's overdue.
4. **See the attacks it refused:** [#/refused](https://pusaka-two.vercel.app/#/refused) lists real failed transactions, each with the contract's own panic read from NEAR's archive and the test that guards it.
5. **Don't trust our page:** open any Pusaka and click *Check it yourself*: your browser asks NEAR, its MPC signer, its light client and Bitcoin directly.

## Run it locally

Requirements: Node 22+, and Rust + `cargo-near` only to rebuild the contract.

```sh
cd contract && cargo test          # 376 passed (~4 min cold): every threat-model attack has a test
npm install && npm run demo        # mint, prove a BTC deposit, sell, withdraw, lend, foreclose (~5 min, testnet)
npm run e2e -w web                 # 115 UI tests on 5 browsers/devices + 45 checks against the live app
npm run dev                        # the web app at http://localhost:5173
```

Step-by-step output of each, and what the tests cover: [docs/TESTING.md](docs/TESTING.md).

## What it does

The three things above are the product. Everything else is built on the same proven balance, live on testnet with
transaction hashes, and listed in full in [docs/FEATURES.md](docs/FEATURES.md#everything-it-does):

- **Markets:** one-transaction sale, Dutch auctions, Mintbase (NEP-178/199), per-sat bids, buy with native Bitcoin, NEAR Intents exit.
- **Credit:** NEAR loans from a person (offer book, refinance) or Circle USDC from a pool with liquidation.
- **One NFT, many wallets:** ETH and USDC on three EVM chains, SOL, its own NEAR account (staking, nBTC), all moving with the NFT.
- **Smart Pusakas** ([docs/V2.md](docs/V2.md)): a keyless account per NFT, bundles, vault with clawback, covered calls, post-quantum lock, SIWE and BIP-322 proofs for exchanges.
- **For agents:** `npx -y pusaka-mcp` (61 tools, spend caps; also in the MCP Registry as `io.github.PugarHuda/pusaka`), x402 audits ([docs/AGENTS.md](docs/AGENTS.md)). A prompt-injected agent is refused three ways before anything is signed: `node mcp/injection-demo.mjs`.

## How it works

```
 owner ──withdraw(utxos, to, amount)──▶ pusaka contract ──sign(path="pusaka-N", sighash)──▶ v1.signer-prod.testnet
                                         │ checks: caller owns NFT N,         (NEAR MPC network,
                                         │ not listed, nothing pending        Chain Signatures)
                                         │ builds the BTC tx + BIP143 sighashes      │
                                         │ records the signed outpoints              │
          signed tx  ◀──on_signed()──────┘◀──────────── signature ───────────────────┘
             └── client attaches witnesses, verifies each signature, broadcasts to Bitcoin testnet3
```

- **Key derivation:** token `N` uses MPC path `pusaka-N`; the contract fetches the public key from the MPC contract at mint, so nobody can mint a Pusaka pointing at an address they control.
- **The contract never signs a hash you give it.** It builds the transaction from the UTXOs you name ([`omni-transaction`](https://github.com/near/omni-transaction-rs)) and computes every sighash itself, which makes the signed-outpoint registry trustworthy.
- **Deposits** are proven by `btc-client-v4.testnet` (Near-One's Bitcoin light client) against Bitcoin testnet3's headers.

| | |
|---|---|
| Contracts | [`pusaka-v2.testnet`](https://testnet.near.rocks/account/pusaka-v2.testnet) (main) and the frozen classic [`pusaka-btc.testnet`](https://testnet.near.rocks/account/pusaka-btc.testnet) |
| Live demo | **https://pusaka-two.vercel.app** |
| Code | `contract/` (Rust NFT + Bitcoin), `lend/` and `market/` (Rust), `api/` (Vercel functions), `web/` (React), `mcp/`, `shade/` (TEE agent), `scripts/`. Deploy your own: [docs/MAINNET.md](docs/MAINNET.md) |

*Pusaka* is Indonesian for an heirloom. Built at NEAR HACKATHON (Nov 2026) with near-sdk 5, omni-transaction,
near-api-js 7, bitcoinjs-lib and Vite + React; all code written during the hackathon window, with help from Claude Code.
Second project by the same builder, independent of this one: [Koperasi](https://github.com/PugarHuda/koperasi), an AI
agent owned and governed by its members.

## License

[MIT](LICENSE)
