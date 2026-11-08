# 01 — Audit (Tech Lead)

Tanggal: 8 Nov 2026. Basis: commit `acf56d8` (main). Semua angka di bawah diukur, bukan diperkirakan.

## Konteks
| | |
|---|---|
| Hackathon | NEAR HACKATHON 2026 (nearhackathon.com) |
| Track | `nfts` (NFTs That Do Something), `defi`, `open` |
| Network | NEAR testnet; Bitcoin testnet3; Sepolia / Base Sepolia / Arbitrum Sepolia; Solana devnet |
| Deadline | 2026-11-14T23:59:00Z (repo harus publik saat itu) |
| Penilaian | HACKATHON.md tidak memuat rubrik skor. Q-017: Claude Code & Codex menyaring (reproduksibilitas, verifikasi fitur, laporan, skor awal), manusia memutuskan. Q-012: demo hosted adalah nilai tambah. |
| Repo | github.com/PugarHuda/pusaka (privat sementara) |
| Proyek | NFT NEAR (NEP-171) yang memegang Bitcoin asli lewat Chain Signatures; saldo dibuktikan on-chain oleh light client Bitcoin NEAR; jual NFT = BTC (dan dompet EVM/SOL/NEAR-nya) ikut pindah. |

## Kesiapan submission: ~90 %
Teknis selesai dan terverifikasi. Yang tersisa bukan kode: video demo + post X, repo publik, form submission, akun payout mainnet (lihat blocker di `docs/REPORT.md`).

## Status on-chain (dibaca langsung, `node scripts/verify.mjs`: all checks passed)
| Kontrak | Status | Bukti |
|---|---|---|
| `pusaka-btc.testnet` | ter-deploy, **tanpa access key** (DeleteKey `3mNiGWfH…`), upgrade hanya lewat DAO + timelock | wasm sha256 `ac16e80e…` = build reproducible CI commit `4bf36b2`, deploy `67hUwJuA…` |
| `pusaka-council.sputnikv2.testnet` | Sputnik DAO pemegang hak upgrade (2 dari 3) | proposal 0–6 |
| `pusaka-agent.testnet` | kontrak Shade Agent (TEE) | `register_agent` `4Pxmp4gy…` |
| `pusaka-relayer.testnet` | relayer NEP-366, gas key NEP-611 | `66Gi31T5…` |

"ABI sinkron": NEAR tidak memakai ABI file; frontend memanggil method by name dan `live.spec.mjs` membaca view method yang sama dari kontrak yang ter-deploy (32 tes), jadi ketidaksinkronan langsung gagal di CI.

## Inventaris mock / dummy / TODO
`grep -rniE "mock|fake|dummy|TODO|FIXME|lorem|placeholder|coming soon|0x000"` di `api shared mcp scripts web/src contract/src`:
| Temuan | Penilaian |
|---|---|
| `mock` di `*.test.mjs` (fetch palsu untuk uji failover/harga) | wajar: unit test |
| `placeholder=` di `<input>` | atribut HTML (contoh format), bukan data palsu |
| `contract: "pusaka.near"` di `shared/btc.mjs` (konfigurasi mainnet) | nama akun mainnet yang belum ada; UI mainnet tidak di-deploy. Butuh keputusan/dana user (blocker) |
| `todo` di `api/_relayer.mjs`, `mcp/tools.mjs`, `scripts/prove-usdc.mjs` | nama variabel (daftar deposit yang akan dibuktikan), bukan penanda pekerjaan |
| "Placeholder tiles" di `web/src/extras.jsx` | skeleton loading selama kontrak dibaca, diganti data asli |
| `fake` di `shared/btc.mjs:216` | komentar: "never fake a deposit" |
| TODO / FIXME / coming soon / lorem / 0x000 sebagai penanda | **0** |

## Tabel temuan (putaran 7–8 Nov; putaran sebelumnya ada di git log)
| ID | Kategori | Severity | Lokasi | Deskripsi | Status |
|---|---|---|---|---|---|
| A1 | Kontrak | Kritis | `contract/src/lib.rs` `prove_deposit` | Kembalian penarikan < 10.000 sats tidak bisa dibuktikan lagi; BTC terdampar | Fixed (proposal 5), bukti #10 |
| A2 | Keamanan | Sedang | sama | Versi pertama fix A1 bisa dipakai untuk dust farming ke relayer | Fixed: diikat ke txid buatan kontrak (`ch:<txid>`) |
| A3 | DX | Tinggi | `scripts/demo.mjs` | `npm run demo` menunggu faucet BTC selamanya | Fixed: fallback beli stok setelah 3 menit |
| A4 | Performa | Tinggi | `web/src/near.js` | 96 panggilan RPC untuk 21 token (memicu rate limit) | Fixed: dedupe + cache 4 s → 44 |
| A5 | Integrasi | Tinggi | `shared/btc.mjs` | Failover RPC berputar ke endpoint yang sedang rate-limit | Fixed + `shared/failover.test.mjs` |
| A6 | Error handling | Tinggi | `App.jsx` | Landing "Reading the contract…" selamanya saat RPC down | Fixed: pesan + Try again |
| A7 | Integrasi | Sedang | `prices()`, MCP | "fetch failed" mentah | Fixed: retry, nama sumber, penolakan jelas |
| A8 | DX | Sedang | `scripts/verify.mjs` | Explorer tak terjangkau dilaporkan sebagai saldo salah | Fixed |
| A9 | UX | Sedang | `extras.jsx`, `index.html` | Tema tak mengikuti sistem; localStorage diblokir merusak first paint | Fixed |
| A10 | Performa | Tinggi | `web/index.html`, `App.jsx` | Halaman token mobile LCP 8,4 s (Lighthouse 67) | Fixed: judul dari URL sebelum JS → LCP 2,7 s (87) |
| A11 | Performa | Sedang | `shared/btc.mjs` | Client RPC viem dimuat di semua halaman | Fixed: lazy, bundle 331 → 301 kB gzip |
| A12 | Integrasi | Sedang | `shared/intents.mjs`, `live.spec` | 1Click `/quote` 500 (timeout internal 25 s) membuat CI merah; timeout klien 15 s < 25 s | Fixed: timeout 30 s; e2e cek 1Click dulu dan menguji fallback jujur |
| A13 | Dokumentasi | Tinggi | README | Threat model T20 tidak mencakup staking; jumlah tes 211 (nyata 225) | Fixed: T20 diperbarui, T26/T27 baru |
| A14 | DX | Sedang | root | Tidak ada `.env.example` | Fixed: semua variabel yang dibaca kode, semuanya opsional |
| A15 | Keamanan | Rendah | CI | Tidak ada `cargo audit` | Ditambahkan ke CI (lihat 05) |
| A16 | Kualitas | Rendah | — | Tidak ada typecheck | Dicoba (`tsc --checkJs`): ~40 error, semuanya false positive inferensi. Tidak dipasang; oxlint `no-undef` tetap |
| A18 | UX web3 | Sedang | `web/src/near.js` | Panic kontrak tampil sebagai kode mentah (`NotOwner`, `Listed`) dan tenggat sebagai epoch ms | Fixed: `web/src/errors.js` (30 kode → kalimat, kode tetap disertakan; ms → tanggal), diuji pada 8 tx gagal nyata |
| A17 | Performa | Rendah | build | Tanpa source map (Lighthouse best-practices 96) | Butuh repo publik dulu (blocker) |

## Prioritas (dampak ke penyaringan AI + juri)
1. Reproduksibilitas dari clone bersih (Q-017) — sudah: `npm run demo`, `verify.mjs`, JUDGES.md.
2. Klaim README = kenyataan on-chain — `verify.mjs` + `live.spec` di CI harian.
3. Materi non-kode: video, post X, repo publik (blocker user).
