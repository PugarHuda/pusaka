# Proof of clean (`pusaka-clean/1`)

A small, open format for one question that every "NFT that holds money" has to answer before a sale:
**can anything the current holder already signed still move what's inside?** Pusaka is the reference implementation;
any NFT whose assets are controlled by keys a contract signs for (NEAR Chain Signatures, ERC-6551 token-bound
accounts, MPC wallets) can publish the same answer.

## Why

A token-bound wallet can be drained between the moment a buyer looks and the moment the sale settles, the known
weakness of ERC-6551 ([EIP discussion](https://ethereum-magicians.org/t/erc-6551-non-fungible-token-bound-accounts/13030?page=2)).
With Chain Signatures it is subtler: the seller can ask for a signature, keep the signed transaction, sell the NFT, then
broadcast it. A balance alone doesn't show that. Proof of clean does, chain by chain, and fails closed.

## What the NFT contract must expose (read-only)

| Need | Pusaka's view | Why |
|---|---|---|
| Every Bitcoin output it ever signed | `token_info.signed_outpoints` | Those coins are not counted in the balance shown |
| A signature in flight | `token_info.pending` | Something may be signed in the next block |
| Per-chain nonce floor for account chains | `eth_nonce_floor(token_id, chain_id)`, `near_nonce_floor(token_id)` | A signed EVM/NEAR transaction with nonce ≥ the account's current nonce is still spendable |
| A counter of every signature | `token_info.sign_epoch` | The purchase binds to it (below) |
| Encumbrances | `token_info.loan` | A lender can still take it |

Solana uses a recent blockhash, so a signed transfer expires in about two minutes; the check looks at the last
transfers the contract signed (`token_info.history`).

## The verdict

Each check is `{ ok, what, detail }` where `ok` is `true`, `false`, or `null` (that chain could not be read).

- `risk` if any check is `false`.
- otherwise `unknown` if any check is `null`, or a chain the NFT has a key on was not read.
- otherwise `clean`.

**Never `clean` unless every chain answered.** A missing RPC, an explorer timeout or an unknown chain is `unknown`.

## The attestation (JSON)

`GET https://pusaka-two.vercel.app/api/badge?id=<token>&contract=<contract>&format=json`

```json
{
  "standard": "pusaka-clean",
  "version": "1",
  "chain": "near",
  "contract": "pusaka-btc.testnet",
  "token_id": "4",
  "verified_sats": "10000",
  "verdict": "clean",
  "checked_at": "2026-11-13T17:05:00.000Z",
  "valid_for_s": 60,
  "checks": [{ "ok": true, "what": "Not collateral for a loan", "detail": "no funded loan" }]
}
```

`verified_sats` is the Bitcoin proven on NEAR by its light client, net of every signed output. The same answer is drawn
as an SVG badge (`&clean=1`, no `format`) for a marketplace listing or a README, with `checked_at` printed on it.

## Freshness, and why the badge isn't the guarantee

A verdict is a reading, not a promise: the holder can sign something a second later. So:
1. Responses are cached for 60 seconds at most and never served stale (`valid_for_s`).
2. **The guarantee is on-chain:** a buyer passes the `sign_epoch` they saw to `buy(token_id, expected_sign_epoch)`, and
   the contract refuses the purchase if anything was signed since (`StateChanged`). The attestation tells the buyer
   what they are looking at; the epoch makes sure it is what they get.

## Adopting it

An NFT-wallet project needs three things: record what its contract signs (outputs or nonce floors), count signatures
in an epoch the sale checks, and serve the checks above in this JSON. The reference code is short:
[`shared/clean.mjs`](../shared/clean.mjs) (checks and verdict, Node or browser), [`api/badge.mjs`](../api/badge.mjs)
(SVG and JSON), and `node scripts/verify.mjs`, which runs it for every Pusaka for sale.

## Security notes

- The attestation is computed by whoever serves it. Don't trust our server: `cleanOf()` in `shared/clean.mjs` reads
  NEAR, Bitcoin, the EVM chains and Solana directly, and the token page's *Check it yourself* runs it in your browser.
- Assets the contract never signed for (a key imported from elsewhere) are out of scope. Pusaka's keys are derived by
  NEAR's MPC for the contract only, so none exist.
