# 07 — Deploy, submission & pitch (DevOps & Submission)

Acuan: `01`–`06`. Aturan resmi: https://nearhackathon.com/HACKATHON.md.

## Build & CI (setiap push/PR + harian)
| Langkah | Status |
|---|---|
| `cargo test` testnet + mainnet (225 + 225) | ✓ |
| `cargo audit` | ✓ (1 advisory dev-only di-ignore dengan alasan) |
| build wasm reproducible + sha256 | ✓ |
| unit Node (9 file) | ✓ |
| `npm run lint` (oxlint, `no-undef`) | ✓ |
| typecheck | tidak ada: proyek JavaScript; `tsc --checkJs` dicoba, hanya false positive |
| `npm run build -w web` | ✓ |
| Playwright `live.spec` (32) + `ui.spec` (90), artifact laporan | ✓ |
| `verify.mjs`, receipt monitor, MCP smoke/due diligence | ✓ |
| `npm audit` | 0 kerentanan |

## Deployment
- Frontend: https://pusaka-two.vercel.app (Vercel, terhubung GitHub; setiap push ke main = deploy). Versi live diuji `live.spec` terhadap kontrak `pusaka-btc.testnet`.
- Kontrak & bukti: `03-kontrak.md`.
- `.env.example`: semua variabel opsional, cara mendapatkannya tertulis per baris.
- Setup dari nol: dilakukan 4 Nov dari clone bersih (perbaikan: tes yang butuh key yang di-gitignore kini memakai akun faucet sekali pakai); `npm run demo` tidak lagi menunggu faucet BTC (fallback 3 menit).

## README untuk juri
Sudah ada: one-liner di baris pertama, link demo, try-it "do X → see Y", JUDGES.md (5 menit), arsitektur (diagram ASCII "How it works"), tabel akun kontrak + explorer, threat model T1–T27 → tes, tabel "Every NEAR primitive", "Measured on testnet" dengan tx hash, cara menjalankan tes. Sesuai HACKATHON.md ("no marketing"), README tidak menyebut nama proyek pesaing. Sejak 9 Nov ada tabel faktual "How this differs from other 'the NFT is a wallet' designs" yang membandingkan tiga desain (sub-akun NEAR, alamat EVM lewat Chain Signatures, Pusaka) tanpa kata "pertama/terbaik"; perbandingan per proyek ada di `02-strategy.md`.
Belum ada (butuh user): link video demo dan post X.

## Naskah video demo (2:30)
| Waktu | Layar | Narasi |
|---|---|---|
| 0:00–0:15 | landing | "Menjual Bitcoin bersama sebuah NFT biasanya berarti bridge, wrapped BTC, atau mempercayai penjual. Pusaka: NFT di NEAR yang memegang Bitcoin asli." |
| 0:15–0:45 | `#/pusaka/10`: BTC terverifikasi, alamat tb1, History | "Saldo ini dibuktikan di NEAR oleh light client Bitcoin — bukan indexer. Kuncinya dipegang jaringan MPC NEAR, hanya bisa dipakai kontrak, atas permintaan pemilik NFT saat ini." |
| 0:45–1:15 | Buy dengan wallet (satu persetujuan) → "You own Pusaka #10" | "Satu transaksi NEAR: bayar penjual, royalti 2,5 %, NFT pindah — dan Bitcoin-nya ikut." |
| 1:15–1:35 | penjual lama mencoba withdraw → "Only the current holder… (NotOwner)" | "Penjual tidak menyimpan kunci apa pun. Kontraknya sendiri tanpa access key." |
| 1:35–2:00 | satu Pusaka: ETH/USDC di 3 EVM, SOL, akun NEAR + stake, nBTC | "Satu NFT, banyak dompet: semuanya pindah bersama." |
| 2:00–2:20 | pinjaman: request → fund; terminal `node scripts/verify.mjs` all checks passed | "Pinjam dengan BTC sebagai agunan tanpa bridge. Setiap klaim README dicek ulang terhadap chain dengan satu perintah." |
| 2:20–2:30 | landing + URL | "Pusaka — pusaka, warisan yang berpindah tangan. Built at NEAR HACKATHON." |

## Outline pitch deck (8 slide)
1. Masalah: BTC tidak bisa dijual/diwariskan/diagunkan bersama aset lain tanpa bridge atau kustodian.
2. Solusi: NFT NEP-171 yang mengendalikan alamat BTC asli lewat Chain Signatures.
3. Demo: beli #10 (tx), penjual lama ditolak (tx gagal `NotOwner`).
4. Pembeda: saldo dibuktikan on-chain (light client), satu NFT banyak chain, pasar kredit.
5. Arsitektur: kontrak ↔ MPC signer ↔ light client ↔ relayer NEP-366 ↔ MCP agen.
6. Integrasi NEAR: Chain Signatures (3 domain + CKD + foreign-tx), light client, Intents, Omni nBTC, staking, Sputnik DAO, NEP-330/366/413/452/611.
7. Validasi: 225 tes kontrak, 122 tes Playwright, `verify.mjs` (cek "upgrades renounced: final"), tx live di README.
8. Next: mainnet (dana), NFT memiliki nama TLA. (Renounce upgrade sudah: proposal 7, 8 Nov.)

## Teks form submission
- Project name: `Pusaka`
- Tracks: `nfts`, `defi`, `open`
- Repo: https://github.com/PugarHuda/pusaka (harus publik)
- Demo post: *(user menerbitkan di X, lalu memberi link)*
- What they built (≤2000 karakter):

> Pusaka is a NEAR NFT (NEP-171) that holds real Bitcoin. Each token controls its own native Bitcoin address through NEAR Chain Signatures: the key lives in NEAR's MPC network and the contract asks for a signature only when the current NFT owner requests one, so selling the NFT hands over the Bitcoin in one NEAR transaction, with no bridge, wrapped BTC or custodian, and no key the seller could keep. Deposits are proven, not claimed: NEAR's on-chain Bitcoin light client verifies every deposit and the contract subtracts every output it ever signed, so a buyer, lender or agent reads verified_sats from the contract alone. The same MPC keys make each Pusaka a set of wallets that move together: ETH and USDC on three EVM chains (USDC verified by MPC foreign-transaction checks), SOL, and its own NEAR account holding nBTC and staked NEAR. On top: sales with royalties and Dutch auctions, NEP-178/199 sales on outside markets (tested on Mintbase), loans with the BTC as collateral and a standing-offer loan market, inheritance to an heir with guardians, a holder-only room with a sealed letter (MPC confidential key derivation), gas-free actions through a NEP-366 relayer with a NEP-611 gas key, an MCP server for AI agents with spending guards, and a deposit prover in a TEE (Phala TDX, attestation checked on-chain). The contract has no access key and its code is final: a Sputnik DAO vote renounced upgrades, and the deployed wasm is a reproducible NEP-330 build. 225 contract tests are named after the attacks they stop; node scripts/verify.mjs re-checks every README claim against NEAR and Bitcoin without a wallet.

(1.620 karakter.) Nama lead, email, ukuran tim, akun payout mainnet, dan persetujuan kontak diisi oleh user sendiri.

## Checklist final
- [x] Kode, tes, CI hijau, demo hosted (tetap hidup sampai ≥ 25 Nov)
- [x] LICENSE (MIT)
- [x] Renounce upgrade lewat DAO (8 Nov, proposal 7, `GdASfxh5…`)
- [ ] Repo publik (≤ 14 Nov 23:59 UTC; disarankan 13 Nov) — user
- [ ] Video demo + post X (@NEARProtocol, #NEARHackathon) — user
- [ ] Akun payout mainnet (`pugarhuda.near`?) — user mengonfirmasi
- [ ] Submit (payload JSON ditampilkan dulu, menunggu "ya") — user
