# 04 — dApp & integrasi (Full-Stack Engineer)

Acuan: `01-tech-lead.md` (A3–A12, A14), `02-strategy.md`.

## Temuan yang di-fix
| ID | Fix | Verifikasi |
|---|---|---|
| A4 | cache + dedupe view call 4 s, dibuang setelah setiap tx (`forgetViews`) | market 96 → 44 panggilan RPC (crawl QA) |
| A5 | failover RPC per panggilan dengan cooldown 60 s; panic kontrak tidak di-retry | `shared/failover.test.mjs` |
| A6 | landing/market/token: pesan + Try again saat RPC down | `ui.spec` route interception (5 browser) |
| A7 | harga: retry per sumber, error menyebut sumber, MCP menolak dengan jelas | `shared/prices.test.mjs` |
| A10/A11 | LCP halaman token 8,4 → 2,7 s; viem RPC client lazy | Lighthouse produksi, `ui.spec` |
| A12 | 1Click: timeout 30 s; fallback jujur diuji | `live.spec` |
| A14 | `.env.example` | — |
| A18 | panic kontrak → kalimat (`web/src/errors.js`), epoch ms → tanggal | `web/src/errors.test.mjs`; dicocokkan dengan tx gagal nyata `6PrmsY8y…` (NotOwner), `wS4qnqmc…` (Listed), `3GN75VgG…` (Collateralised), `ANbwMLtn…` (NotDueYet), `CoteHaM8…` (claim_inheritance) |

## Wallet & transaksi (NEAR)
| Diminta | Implementasi |
|---|---|
| connect / ganti akun / disconnect / reconnect | `@hot-labs/near-connect` (Meteor, Intear, HOT, MyNearWallet…), sesi dipulihkan saat load |
| ganti network | tidak relevan seperti di EVM: build menetapkan testnet/mainnet (`VITE_NETWORK`), wallet NEAR menandatangani per network |
| status tx: tanda tangan → pending → final/gagal, link explorer | `callRaw` menunggu FINAL, pesan sukses dengan link NEAR Rocks; panic kontrak diterjemahkan ke kalimat manusia (`NotOwner` → "Only the holder…") |
| simulasi sebelum kirim | preflight view (`acceptWouldSucceed`, `buy` dengan `expected_sign_epoch`, relayer memeriksa light client sebelum `prove_deposit`) |
| double submit | tombol dinonaktifkan selama tx; kontrak mengikat ke `sign_epoch`/nonce sehingga kiriman ganda gagal |
| nonce / replacement | NEAR: nonce key dikelola wallet; untuk tx lintas-chain kontrak mencatat nonce floor (T10, T14) |
| tx EVM yang dibuat kontrak | `finalizeEth` memeriksa sighash sama dan signature me-recover ke alamat Pusaka sebelum broadcast |

## Data on-chain
- RPC NEAR: FastNear → dRPC → rpc.testnet.near.org (failover per panggilan). Bitcoin: mempool.space → Blockstream. EVM: publicnode per chain (viem, lazy).
- Event: History per NFT dibaca dari event kontrak; cache dibuang setelah tx.
- Validasi data API/indexer: jawaban Esplora hanya dipakai untuk membangun **bukti** yang diverifikasi light client ("a wrong answer from the API can only make the proof fail"); harga butuh dua sumber yang selisihnya < 5 % (`crossCheck`). Zod tidak dipasang: validasi kritis terjadi on-chain.

## Inventaris integrasi (sebelum → sesudah putaran ini)
| Integrasi | Sebelum | Sesudah |
|---|---|---|
| Chain Signatures (secp256k1 + Ed25519 + CKD + foreign-tx) | Dalam | Dalam + FunctionCall generik untuk staking |
| Bitcoin light client | Sedang | Dalam: kembalian penarikan terbukti |
| RPC NEAR | failover sederhana | per panggilan + cooldown + cache |
| NEAR Intents 1Click | quote dry-run | + timeout yang benar, fallback teruji |
| Staking pool | — | Dalam: stake/unstake/withdraw, UI + MCP + skrip |
| Playwright | 1 browser | 5 proyek, axe, visual, interception |

## Cara mencoba fitur baru
- Staking: buka https://pusaka-two.vercel.app/#/pusaka/2 → bagian *Staked NEAR*; atau `node scripts/stake.mjs x 2 status`.
- Bukti kembalian gratis: `#/pusaka/10` → History menunjukkan proof oleh `pusaka-relayer.testnet`.
- Fallback 1Click: `#/pusaka/12` saat 1Click down menampilkan "No NEAR Intents quote right now (…)", tidak ada angka.
