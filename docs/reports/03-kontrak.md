# 03 — Smart contract (Smart Contract Engineer)

Acuan: `01-audit.md` (A1, A2, A13), `02-strategi.md` (staking: BANGUN).

## Stack
Rust, `near-sdk` 5, `near-contract-standards` (NEP-171/177/178/181/199/297), `omni-transaction` untuk membangun transaksi BTC/EVM/NEAR. Padanan "library teruji" di NEAR: `near-contract-standards` dan crate resmi Near-One/omni. Build reproducible NEP-330 (`cargo near build reproducible-wasm`, image tersemat digest) di CI.

| Standar kualitas yang diminta | Di Pusaka |
|---|---|
| Custom error | panic dengan kode tetap (`NotOwner`, `Listed`, `SignPending`, `TooEarly`, `CodeMismatch`, `Collateralised`, `NotDueYet`…), diuji per kode |
| Event untuk setiap perubahan state penting | NEP-297 `nft_mint`, `nft_transfer`, `nft_metadata_update`, plus event Pusaka (`Withdraw*`, `Staking`, loan, heir, gift, upgrade) — dipakai History per NFT |
| Access control | `assert_owner` + `assert_free` di setiap jalur keluar; upgrade hanya DAO → timelock; akun kontrak 0 key |
| Emergency / pause | sengaja tidak ada: pause oleh admin = kustodian. Penggantinya: `unlock_stale` (pemilik), timelock upgrade agar pemegang bisa keluar dulu, `renounce_upgrades` |
| CEI / reentrancy | NEAR async: state dicatat **sebelum** promise (outpoint & nonce floor dicatat sebelum MPC diminta tanda tangan; token dikunci `SignPending`), callback memulihkan saat gagal (`a3_…`, `s3_…`, `x2_…`) |
| Overflow | aritmatika checked/u128; lelang Dutch bebas overflow (tes `m…`) |

## Temuan yang di-fix (putaran 7 Nov)
| ID | Fix | Tes | Bukti on-chain |
|---|---|---|---|
| A1 | kembalian penarikan (output 1 dari tx buatan kontrak, `ch:<txid>`) bisa dibuktikan sampai 1.000 sats | `ch1`–`ch4` | proposal 5, #10: 7.400 sats terbukti gas-free |
| A2 | tidak bisa dipakai untuk dust milik orang lain | `ch2`, `ch4` | review keamanan otomatis |
| Fitur | staking NEAR milik NFT ke pool factory resmi; maks 3 pool; hanya pemilik; terkunci saat listed/agunan/signing | `sk1`–`sk8` | stake 1 NEAR `4yQWgGG4…`, unstake 0,3 `EQyUsGqa…` |

## Deployment
| Kontrak | Network | Explorer |
|---|---|---|
| `pusaka-btc.testnet` | NEAR testnet | https://testnet.near.rocks/account/pusaka-btc.testnet |
| `pusaka-council.sputnikv2.testnet` (DAO upgrade) | NEAR testnet | https://testnet.near.rocks/account/pusaka-council.sputnikv2.testnet |
| `pusaka-agent.testnet` (Shade Agent) | NEAR testnet | https://testnet.near.rocks/account/pusaka-agent.testnet |

Deploy yang dapat diulang: `node scripts/dao-upgrade.mjs propose <wasm-dari-CI> <member>` → `vote` → tunggu 10 menit → `node scripts/upgrade.mjs apply <wasm> <signer>`. Deploy terakhir: proposal 6, wasm sha256 `ac16e80e928ba6a2f1e67fc358a8f5d8db7de83779a70514aaffdceb1bceac60` (commit `4bf36b2`), tx `67hUwJuA…`. "Verifikasi source": NEAR tidak punya verifier gaya Etherscan; padanannya NEP-330 `contract_source_metadata` + `verify.mjs` membandingkan code hash dengan build CI.

`deployments/[network].json`: tidak dibuat terpisah. Satu sumber kebenaran sudah ada di `shared/btc.mjs` `CONFIG.testnet|mainnet`, dibaca frontend, MCP, API dan skrip; file kedua hanya menambah kemungkinan tidak sinkron.

## Testing
| Jenis | Jumlah | Catatan |
|---|---|---|
| Unit + jalur revert | **225** (`cargo test`) dan 225 (`--features mainnet`) | nama tes = serangan di threat model |
| Fuzz | tidak memakai framework fuzz | input numerik/alamat diuji batas (0, maks, case, duplikat txid `t3b`) |
| Invariant | tersirat di tes per jalur (saldo terverifikasi tak pernah naik oleh output yang sudah ditandatangani) | tidak ada harness invariant terpisah |
| Fork test | tidak ada fork node NEAR; integrasi diuji **live** di testnet (light client, MPC, Mintbase, pool) | tx di README "Measured on testnet" |
| Coverage | tidak diukur (`cargo llvm-cov` belum dipasang) | known gap |

## Gas
Batas gas per panggilan ditetapkan di kontrak (mis. stake 125 TGas, sign MPC dengan deposit sesuai `experimental_signature_deposit`). Storage dibayar pemanggil (`CHANGE_BYTES`, `POOLS_BYTES`) dan diuji agar tidak bisa dibebankan ke kontrak.
