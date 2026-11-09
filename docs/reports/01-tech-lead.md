# 01 — Tech Lead / Auditor

Putaran 2: 8 Nov 2026, sore. Basis: commit `d655777` (main). Fase ini hanya memetakan, tidak memperbaiki kode. Semua angka diukur ulang di putaran ini; perintahnya tercantum.

## Konteks
| | |
|---|---|
| Hackathon | NEAR HACKATHON 2026 (nearhackathon.com, aturan: HACKATHON.md) |
| Track | `nfts` (NFTs That Do Something), `defi`, `open` |
| Sponsor/bounty | Tidak ada bounty sponsor terpisah. "Sponsor" = NEAR; syaratnya: dibangun di NEAR, repo publik, demo + post X |
| Network | NEAR testnet; Bitcoin testnet3; Sepolia / Base Sepolia / Arbitrum Sepolia; Solana devnet |
| Penilaian | HACKATHON.md tidak memuat rubrik angka. Q-017: Claude Code & Codex menyaring (reproduksibilitas, verifikasi fitur, laporan, skor awal), manusia memutuskan. Q-012: demo hosted nilai tambah |
| Deadline | 2026-11-14T23:59:00Z (repo harus publik saat itu) |
| Repo | github.com/PugarHuda/pusaka (privat sementara) |
| Proyek | NFT NEAR (NEP-171) yang memegang Bitcoin asli lewat Chain Signatures; saldo dibuktikan on-chain oleh light client Bitcoin NEAR; jual NFT = BTC (plus dompet EVM/SOL/NEAR-nya) ikut pindah. Target: pemegang BTC yang ingin menjual, mewariskan, atau mengagunkan tanpa bridge/kustodian |

## Kesiapan submission: ~85 %
Turun dari ~90 % di putaran 1: **CI merah sejak renounce** (B1) dan badge merah ada di baris 3 README, tempat pertama yang dilihat juri dan AI penyaring. Kodenya sendiri sehat (semua pemeriksaan lokal di bawah hijau). Sisanya bukan kode: video + post X, repo publik, form submission.

## Hasil menjalankan semuanya (lokal, 8 Nov)
| Perintah | Hasil |
|---|---|
| `cargo test` (contract) | **225 passed**, 0 failed, 0 warning |
| 9 unit Node (`shared/*.test.mjs`, `api/_*.test.mjs`, `web/src/*.test.mjs`) | 9/9 ok |
| `npm run lint` | 0 error; web 15 warning (B7) |
| `npm run build -w web` | ok; peringatan chunk > 500 kB (B8) |
| `node scripts/verify.mjs` | **all checks passed** (8 cek, termasuk "upgrades renounced: final", 56 tx README ada di chain) |
| `npm audit --omit=dev` | 0 kerentanan |
| `https://pusaka-two.vercel.app` | 200, 0,7 s; `/api/reserves` = 158.346 sats, sama dengan kontrak |
| GitHub Actions, 3 run terakhir | **merah** (B1, B5); run hijau terakhir `8bf017b` |

Wallet: alur dompet asli dijalankan lewat `web/e2e/wallet-qa.mjs` (Intear) di putaran sebelumnya; tidak diulang di putaran ini karena kontrak tidak berubah sejak itu (sha256 sama, upgrade sudah final).

## Status on-chain
| Akun | Peran | Status | Bukti |
|---|---|---|---|
| `pusaka-btc.testnet` | kontrak utama | ter-deploy, **0 access key**, **upgrade di-renounce (final)** | wasm sha256 `ac16e80e…` = build reproducible CI commit `4bf36b2` (NEP-330), deploy `67hUwJuA…`, DeleteKey `3mNiGWfH…`, renounce `GdASfxh5…` |
| `pusaka-council.sputnikv2.testnet` | Sputnik DAO, dulu pemegang hak upgrade | kode `AA4nA45v…`; perannya selesai setelah proposal 7 | proposal 0–7 |
| `pusaka-agent.testnet` | kontrak Shade Agent (TEE) | kode `4y4jLrp5…` | `register_agent` `4Pxmp4gy…` |
| `pusaka-relayer.testnet` | relayer NEP-366, gas key NEP-611 | akun tanpa kode (sesuai peran) | relay `66Gi31T5…` |
| MPC `v1.signer-prod.testnet`, light client `btc-client-v4.testnet` | dependensi NEAR | dibaca langsung oleh `verify.mjs` | 21 kunci BTC = derivasi MPC; 9 deposit terbukti |

"ABI sinkron": NEAR tidak memakai file ABI. Frontend memanggil method by name, dan `live.spec` membaca view method yang sama dari kontrak yang ter-deploy, sehingga ketidaksinkronan langsung gagal di CI. Kontraknya kini final, jadi risiko ini tertutup permanen.

## Inventaris fitur: klaim vs kenyataan
Semua klaim README punya tx atau tes. `verify.mjs` mengecek ulang 56 tx dan saldo terhadap chain (hijau). Satu klaim tidak lagi benar: **teks submission dan README menyebut upgrade masih lewat DAO + timelock** (B2, B3); kenyataannya sudah final.

## Inventaris mock / dummy / hardcode
`grep -rniE "mock|fake|dummy|TODO|FIXME|lorem|placeholder|coming soon|0x0000"` di `api shared mcp scripts web/src contract/src shade`:
| Temuan | Penilaian |
|---|---|
| `mock` di `*.test.mjs` | fetch palsu di unit test failover/harga: wajar |
| `todo` di `api/_relayer.mjs`, `mcp/tools.mjs`, `scripts/prove.mjs`, `scripts/prove-usdc.mjs`, `web/src/App.jsx:776` | nama variabel (deposit yang belum dibuktikan), bukan penanda pekerjaan |
| `placeholder=` | atribut `<input>` |
| "Placeholder tiles" `web/src/extras.jsx` | skeleton loading, diganti data kontrak |
| `fake` `shared/btc.mjs` | komentar "never fake a deposit" |
| `contract: "pusaka.near"` (config mainnet) | akun mainnet belum dibuat; UI mainnet tidak di-deploy (butuh dana user) |
| TODO / FIXME / coming soon / lorem / `0x000…` | **0** |

## Inventaris integrasi (NEAR = satu-satunya "sponsor")
| Integrasi | Tingkat | Bukti |
|---|---|---|
| Chain Signatures (secp256k1 BTC/EVM, ed25519 SOL/NEAR, CKD, foreign-tx USDC) | Dalam | `verify.mjs`, tx di README |
| Light client Bitcoin | Dalam | `prove_deposit` `EYLPHJGX…`; kembalian #10 |
| NEP-171/177/178/181/199/297/330/366/413/452/611 | Dalam | tabel "Every NEAR primitive" README |
| Sputnik DAO | Dalam (selesai: renounce) | proposal 0–7 |
| Staking pool | Dalam | `4yQWgGG4…` |
| Omni nBTC | Sedang | `withdraw-nbtc` |
| NEAR Intents 1Click | Sedang (dry run; likuiditas mainnet saja) | `live.spec` quote / fallback |
| Shade Agent (Phala TEE) | Sedang (pernah jalan; dimatikan untuk hemat kredit) | `register_agent` `4Pxmp4gy…` |
| SocialDB notify, Mintbase | Sedang | README |

## Tabel temuan putaran 2
| ID | Kategori | Severity | Lokasi | Deskripsi | Penanggung jawab | Status (8 Nov, malam) |
|---|---|---|---|---|---|---|
| B1 | QA / CI | **Kritis** | `web/e2e/live.spec.mjs:346` | Tes halaman "For AI agents" masih mengharapkan teks berakhir "…timelock." Sejak renounce (`6477539`) aplikasi dengan benar menampilkan "Code changes: none, ever (renounced)", jadi tes gagal di setiap run. Akibatnya badge CI di README baris 3 merah, dan langkah setelahnya (`receipt-monitor`, `verify.mjs`, MCP smoke, due diligence) **tidak lagi berjalan di CI**. Aplikasinya benar; tesnya yang basi | QA | Fixed: assertion → "Code changes: none, ever (renounced)."; tes lulus terhadap produksi |
| B2 | Submission | Tinggi | `docs/reports/07-submission.md:57`, slide 8 | Teks "What they built" berbunyi "code changes only through a Sputnik DAO vote and a timelock", padahal sekarang tidak bisa diubah sama sekali. Slide 8 masih menulis "Next: renounce upgrade". AI penyaring membandingkan klaim dengan chain | Submission | Fixed: "its code is final: a Sputnik DAO vote renounced upgrades" (1.592 karakter); slide 7/8 diperbarui |
| B3 | Dokumentasi | Sedang | `README.md:450` (baris DAO), `JUDGES.md:64` | Ditulis dalam bentuk sekarang ("New contract code needs a council proposal…"); perlu "dulu…, di-renounce lewat proposal 7" | Submission | Fixed: README paragraf keamanan + baris DAO (link proposal 7), JUDGES |
| B4 | MCP | Rendah | `mcp/tools.mjs:647`, prompt `due_diligence` `:895` | Deskripsi tool menyebut DAO/timelock sebagai kondisi kini. Output tool sudah benar (`upgrades: {final: true}`); hanya teks deskripsinya | Backend | Fixed: deskripsi tool + prompt `due_diligence` |
| B5 | CI | Sedang | `.github/workflows/ci.yml` job `reproducible-wasm` | Installer cargo-near di-curl tanpa retry; run terjadwal 09:54 merah karena GitHub 504 (`no such command: near`). Flaky eksternal | DevOps | Fixed: install diulang 3× (`curl --retry 3 --retry-all-errors`), lalu `cargo near --version` gagal keras |
| B6 | Dokumentasi | Rendah | `docs/REPORT.md`, `02`/`03`/`05` | Masih menulis "upgrade DAO + timelock" sebagai kondisi kini; REPORT blocker 5 masih $23–37 (MAINNET.md terukur: ~$35 minimum / ~$47 penuh); blocker 6 (firewall publish) sudah selesai | Semua role, saat menulis laporannya | Fixed: 02, 03, 05, REPORT (biaya mainnet dari MAINNET.md, firewall selesai) |
| B7 | Kualitas FE | Rendah | `web/src/App.jsx:388,1914` (`Date.now` saat render), `:314,1271` (setState di effect) + 11 lainnya | 15 peringatan oxlint React. Tidak ada bug teramati; risiko render tak stabil | Frontend | Fixed: 15 → 0 peringatan. `useNow` (jam sebagai state) menggantikan `Date.now()` saat render; reset error di handler Try again; HolderRoom di-reset lewat `key`; helper non-komponen pindah ke `web/src/util.js`. `ui.spec` chromium 18/18 |
| B8 | Performa | Rendah | `dist/assets/index-*.js` | Chunk utama 985 kB (306 kB gzip). LCP sudah 2,7 s; pemisahan per route (market/token/agents) masih bisa mengurangi | Frontend | **Sebagian (9 Nov)**: kripto CKD (BLS12-381, hanya dipakai surat MPC) kini di-load saat dipakai lewat `@pusaka/shared/ckd` → chunk awal 308 → **271 kB gzip** (−12 %), chunk `ckd` 38 kB terpisah. Dicoba juga memecah vendor (`manualChunks`): total awal malah naik ke 339 kB karena modul lazy ikut tertarik, jadi dibatalkan. Memecah `App.jsx` per route tetap tidak dikerjakan (risiko regresi) |
| B9 | Performa | Rendah | build | Tanpa source map (A17); menunggu repo publik | DevOps (setelah user mempublikasikan repo) | Blocker user: repo publik dulu |

Putaran 1 (A1–A18): 16 fixed dan terverifikasi; A16 (typecheck) tidak dipasang dengan alasan; A17 = B9. Rinciannya ada di git history file ini (`git log -p docs/reports/01-tech-lead.md`).

## Gap per area (ringkas)
- **Smart contract**: tidak ada gap baru. 225 tes, 0 warning, kode final. Coverage tidak diukur (known issue di 05).
- **Frontend/dApp**: connect/disconnect, alur tanpa wallet, RPC down, kedua explorer BTC down, dan offline semuanya diuji di `ui.spec` (5 browser). Ganti akun dan wallet menolak hanya diuji manual (`wallet-qa.mjs`), karena tidak ada provider injeksi untuk wallet NEAR. Ganti network tidak berlaku: app hanya testnet.
- **Integrasi**: RPC NEAR dan Esplora punya failover + cooldown + timeout (unit test). 1Click punya timeout 30 s dan fallback jujur.
- **UX web3**: panic kontrak → kalimat (`errors.js`), link explorer di History, gas-free lewat relayer, 429 dijelaskan.
- **DX**: `npm run demo`, `.env.example`, JUDGES.md 5 menit. Pemeriksaan otomatisnya (CI) saat ini merah (B1).

## Prioritas (dampak ke penyaringan AI + juri)
B1–B7 sudah diperbaiki di putaran yang sama atas permintaan user (lihat kolom Status). Urutan aslinya:
1. **B1**: perbarui satu assertion di `live.spec.mjs` ke teks "none, ever (renounced)" → CI hijau, badge hijau, `verify.mjs` kembali jalan harian. (QA, ~5 menit)
2. **B2 + B3**: teks submission, slide 8, README baris DAO, JUDGES. Klaim harus sama dengan chain. (Submission)
3. **B5**: retry pada unduhan cargo-near (`curl --retry 3`). (DevOps)
4. B4, B6: perbaikan kata-kata.
5. B7, B8: opsional, setelah semuanya di atas.
6. Non-kode (user): video + post X, repo publik ≤ 14 Nov (saran 13 Nov), data form/payout.
