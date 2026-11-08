# 02 — Strategi & diferensiasi (Hackathon Strategist)

Acuan: `01-tech-lead.md`. Data kompetitor: `nearhackathon.com/api/projects` (8 Nov: 266 proyek; `nfts` 19, `defi` 40, `open` 44), post X lewat fxtwitter, repo dibaca statis (tidak dijalankan) pada 6 Nov.

## Scorecard
HACKATHON.md tidak punya rubrik angka. Kriteria di bawah diturunkan dari teks resminya: Q-017 (penyaring AI: reproduksibilitas, verifikasi fitur), Q-012 (demo hosted, video), "do X → see Y, no marketing", dan brief track `nfts` ("NFT sebagai akun: memegang uang, royalti, inventaris, kredensial/akses"; NEP-171, dynamic NFT, sub-account).

| Kriteria | Awal (2 Nov) | Sekarang | Yang menahan di bawah 10 |
|---|---|---|---|
| Reproduksibilitas dari clone bersih | 5 | 9 | perlu repo publik agar penyaring bisa clone |
| Klaim terverifikasi on-chain | 6 | 10 | — (`verify.mjs`, 8 cek, di CI harian) |
| Kedalaman integrasi NEAR | 6 | 9 | belum mainnet; TLA hanya mainnet |
| Kesesuaian brief track `nfts` | 7 | 9 | NFT memakai akun implicit turunan MPC, bukan sub-account |
| Keamanan / threat model | 6 | 9 | DAO council masih akun demo sendiri (renounce direncanakan ~13 Nov) |
| Demo & presentasi | 5 | 6 | **video + post X belum ada** (syarat wajib) |
| Polish UI/a11y/perf | 6 | 9 | Lighthouse mobile perf 87–88 |

## Kompetitor (track `nfts`, paling dekat)
| Proyek | Inti | Teknologi NEAR | Kelebihan | Kelemahan | Sumber |
|---|---|---|---|---|---|
| Handover | NFT = dompet ETH; penjual tak bisa simpan kunci | Chain Signatures (ETH), kontrak tanpa key, 99+136 tes | README klaim→file:line→tes, kontrak terkunci | 1 chain, saldo dicek off-chain, tanpa CI | github.com/AlphaTechini/handover |
| Deed | NFT memiliki sub-account tanpa key (global contract) | sub-account, global contract, FC key | jaminan protokol: tak ada yang bisa sign | aset NEAR saja, tanpa UI beli, 11 tes | github.com/ClaudeOpusPremiumAgent/deed |
| Release Passport | rilis software sebagai NFT-akun | sub-account keyless, raw wasm | CLI verifikasi tanpa install | tanpa pembayaran atomik, kontrak masih upgradeable | emilhuseyn.github.io/release-passport |
| Outlive | NFT memiliki vault bisnis API (treasury, harga, ledger) | vault NEAR | cerita bisnis yang jelas, 881 views | "demand unproven", B-roll AI | github.com/itsolaph/outlive |
| Torch | NFT = akun NEAR berisi keranjang token | akun per NFT | pesan sederhana, 1042 views | aset NEAR-only | x.com/BimaJadiva07/status/2118949693963321612 |
| Logen | NFT berdompet, 0 access key, "Attack Lab" 12 serangan | akun keyless | demo serangan interaktif | 92 views, cakupan aset tak dijelaskan | x.com/chennl1u/status/2118871692261147135 |
| Zinc | NFT hak pendapatan proyek | kontrak NFT + dashboard | UI dashboard lengkap | bukan aset lintas-chain | zinc-demo-production.up.railway.app |
| Writ | izin kontrak proyek sebagai NFT yang bisa dipindah | NFT + permission | use case jelas | hanya izin, bukan nilai | x.com/Viktor_ella_/status/2119003082897936792 |

### Paritas (bukan pembeda)
"NFT yang membawa dompetnya" kini diklaim ≥5 proyek (Handover, Deed, Torch, Logen, Outlive). Kontrak tanpa key juga dimiliki Handover, Deed, Logen.

### Yang dikejar dari kompetitor — sudah dikerjakan
- Kontrak tanpa key + verifikasi satu perintah (Handover/Deed) → `pusaka-btc.testnet` 0 key, `verify.mjs`, JUDGES.md.
- Tabel klaim→tes (Handover) → threat model T1–T27, nama tes = serangan.
- "NFT yang menghasilkan" (Outlive, Zinc) → royalti 2,5 %, pinjaman beragun, staking NEAR (7 Nov).

### Celah yang hanya diisi Pusaka
1. **Bitcoin asli yang dibuktikan on-chain**: setiap deposit diperiksa light client Bitcoin di NEAR; tidak ada kompetitor `nfts` yang memverifikasi deposit lintas-chain di kontrak.
2. **Satu NFT, banyak chain sekaligus**: BTC, ETH/USDC di 3 EVM, SOL, akun NEAR + nBTC + stake — semuanya pindah dalam satu transaksi.
3. **Pasar kredit di atas NFT itu**: pinjam dengan BTC sebagai agunan tanpa bridge, lelang Dutch, penawaran berdiri, refinance, gas-free.

## Positioning
> Untuk pemegang Bitcoin yang ingin menjual, mewariskan, atau meminjam atas BTC-nya tanpa bridge atau kustodian, Pusaka adalah NFT NEAR yang memegang Bitcoin asli dan membuktikan saldonya on-chain dengan light client Bitcoin NEAR, tidak seperti NFT-dompet lain yang hanya memegang aset NEAR/ETH atau membaca saldo dari indexer off-chain.

## Kandidat fitur
| Kandidat | Nilai | Kompetitor punya? | Effort | Risiko | Keputusan |
|---|---|---|---|---|---|
| Staking NEAR milik NFT | NFT menghasilkan, primitif NEAR asli | Outlive/Torch sebagian | 6 j | rendah | **BANGUN — selesai 7 Nov** (`sk1`–`sk8`, tx `4yQWgGG4…`) |
| Bukti kembalian penarikan gratis | BTC tidak terdampar | — | 4 j | sedang | **BANGUN — selesai** (proposal 5) |
| Perf halaman token mobile | kesan pertama juri | — | 2 j | rendah | **BANGUN — selesai** (LCP 8,4 → 2,7 s) |
| Nama TLA sebagai milik NFT | sesuai bacaan track | — | 1–2 hari | butuh mainnet + biaya sewa | **TIDAK** sampai ada dana mainnet (blocker) |
| Ganti akun implicit → sub-account / NEP-616 | sesuai "sub-accounts" | Deed, Release Passport | besar | ganti arsitektur inti, 6 hari sebelum deadline | **TIDAK** tanpa persetujuan user |
| Account abstraction / passkey | UX | — | besar | wallet NEAR sudah cukup; relayer gas-free sudah ada | TIDAK |
| JWT 1Click (tanpa fee 0,2 %) | quote lebih andal | — | 15 menit | butuh akun partners.near-intents.org | blocker user |

## Copy 10 detik pertama
Landing sudah: "NFTs that hold real Bitcoin." + lede "Sell the NFT and the Bitcoin goes with it in one NEAR transaction: no bridge, no custodian, no key left with the seller." Statistik total BTC terverifikasi tampil di bawahnya dari kontrak. Tidak diubah: HACKATHON.md meminta "no marketing", dan teks ini sudah menyatakan pembeda (BTC asli, satu transaksi, tanpa kustodian).
