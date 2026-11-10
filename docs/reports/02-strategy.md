# 02 — Strategy & market research (Hackathon Strategist)

8 Nov 2026. Acuan: `01-tech-lead.md`. Sumber:
- Teks resmi https://nearhackathon.com/HACKATHON.md dan halaman utamanya.
- 87 proyek pesaing di track kita (API `nearhackathon.com/api/projects`, repo, akun on-chain, dan post X dibaca satu per satu).
- Riset web 8 Nov. Tautan sumber ada di setiap baris.

## 1. Kriteria juri & syarat
**Tidak ada rubrik angka resmi.** Yang tertulis:
- Penyaringan: "Claude Code and Codex screen every project before the human jury decides". Isinya cek reproduksibilitas, verifikasi fitur, laporan terstruktur, dan skor awal. "A low score alone cannot reject" sebuah proyek.
- Hackathon NEAR sebelumnya menilai "technical implementation, design, impact, originality, and sustainability" (nearhackathon.com).
- Juri berasal dari NEAR, a16z crypto, Helius, Electric Capital, Synthetix/Infinex, Dragonfly, cyber•Fund, Anthropic, dan OpenAI.
- Hadiah per track $10K / $3K / $2K; grand prize $55K. Penjurian 16 Nov, hasil paling lambat 18 Nov.

Brief track, dikutip:
- **nfts:** "Build NFTs as accounts — assets that own money, earn royalties, hold inventory, carry credentials… Ownership with behavior."
- **defi:** "…settle across chains through **NEAR Intents**… Deep liquidity, no custodian, nobody to switch it off."
- **open:** "new ways for money, intelligence and ownership to work together."

### Scorecard (sekarang → target)
| Kriteria | Skor | Yang dibutuhkan untuk 9–10 |
|---|---|---|
| Reproduksibilitas (penyaring AI) | 9 | Repo publik. Sisanya sudah ada: `npm run demo`, `verify.mjs`, JUDGES.md, CI hijau lagi sejak `44bda6a` |
| Klaim = kenyataan on-chain | 10 | Pertahankan: `verify.mjs` harian di CI |
| Technical implementation | 9 | — (369 tes kontrak termasuk fuzz + invariant, coverage baris 96 %, light client, MPC 3 domain + CKD + foreign-tx) |
| Kesesuaian `nfts` ("NFT sebagai akun yang memiliki uang") | 9 | Brief track praktis mendeskripsikan Pusaka |
| Kesesuaian `defi` ("settle… through NEAR Intents", "nobody to switch it off") | 6 | Intents di Pusaka hanya **quote dry-run**: likuiditas 1Click hanya ada di mainnet. Pemimpin `defi` (Warrant, setllend) **di mainnet**, dan Warrant menyelesaikan transaksinya di dalam `intents.near`. Untuk naik: deploy mainnet + satu jalur keluar Intents yang benar-benar dieksekusi |
| Kesesuaian `open` | 8 | Kombinasi BTC × agen AI (MCP) × pewarisan sudah unik |
| Design / polish | 8 | Lighthouse 87–88, a11y 100. Naik dengan "refusal room" (F2) dan video |
| Impact / sustainability | 6 | Testnet saja. Mainnet (F1) adalah bukti terbesar bahwa produk ini bisa dipakai sungguhan |
| Demo & presentasi | 6 | **Video + post X belum ada** (wajib). Naskah ada di `07-submission.md` |

### Checklist syarat (HACKATHON.md)
- [x] Dibangun di NEAR, dalam jendela waktu, satu submission per repo
- [x] README untuk mesin dan manusia dengan langkah "do X → see Y"
- [x] Demo yang bisa dibuka: https://pusaka-two.vercel.app (Q-012: "screenshots are not enough")
- [ ] Repo publik sebelum 14 Nov 23:59 UTC (user)
- [ ] Post X yang menandai @NEARProtocol dan #NEARHackathon, dengan video (user)

Tidak ada bounty sponsor terpisah; "sponsor" = NEAR.

## 2. Riset: apa yang menang
1. **Bukti bahwa produknya jalan.** Penyaring AI NEAR menguji "runs and does what the README says". Shortlist Colosseum juga lewat review kode ([FAQ](https://superteamcan.notion.site/Colosseum-1ae380b97c4681cabad4e7f85ae0af7b)). Pesaing teratas di sini (Warrant 8,8; Sealed Exploit 8,8 setelah video dinilai) sama-sama punya `verify` satu perintah, kontrak tanpa key, dan CI hijau.
2. **Chain Signatures mengendalikan akun di chain tanpa smart contract.** Bounty NEAR di ETHGlobal meminta persis ini: "DeFi… on non-smart contract chains… controlling externally-owned accounts on chains like Bitcoin" ([Brussels](https://ethglobal.com/events/brussels/prizes/near-protocol), [London 2024](https://ethglobal.com/events/london2024/prizes/near-protocol)).
3. **AI + DeFi.** DeFiBrain memenangkan bounty Chain Signatures dan juara 1 ETH Seoul ([NEAR](https://pages.near.org/?p=21306)).
4. **Cerita keamanan dan perlindungan user.** Contoh: juara Colosseum 2025, Unrugable ([Solana Compass](https://ee.solanacompass.com/learn/breakpoint-25/winners-of-the-colosseum-cypherpunk-hackathon)). Di hackathon ini: Warrant dengan "refusal room" berisi 31 tx gagal nyata, dan Sealed Exploit dengan 21 klaim palsu yang ditolak on-chain.
5. **Mainnet mengalahkan testnet di defi.** Warrant (`warrant-options.near`, 0 key) dan setllend (`setllend.near`) sudah live di mainnet.

## 3. Produk live dengan masalah serupa
| Produk | Inti / chain / teknologi | Target user | Token / ekonomi | Traction (DefiLlama, 8 Nov) | Kelebihan | Kelemahan | Sumber |
|---|---|---|---|---|---|---|---|
| Liquidium | Pinjaman P2P BTC beragun Ordinals/Runes (PSBT + oracle DLC); gagal bayar = agunan pindah, tanpa likuidasi LTV | Pemegang ordinal/rune, lender BTC | LIQ (rune; ATL 14 Jun 2026) | TVL $4,0 jt; >63k pinjaman, 3.378 BTC volume | BTC native, tanpa bridge | Agunan ordinal berisiko harga lantai; oracle = penanda tangan ketiga yang dipercaya | [docs](https://help.liquidium.fi/en/articles/9189612-how-does-liquidium-work-a-technical-deep-dive) |
| Babylon | Staking BTC self-custody (skrip timelock Taproot, EOTS slashing); chain Cosmos | Pemegang BTC pencari yield | BABY | TVL $3,10 M | Tanpa wrapping | Hanya staking keamanan; risiko slashing | [docs](https://docs.babylonlabs.io/guides/overview/bitcoin_staking/) |
| Lombard LBTC | BTC liquid staking; mint/burn disahkan konsorsium 14 anggota; CCIP | User DeFi EVM/Sui/Solana | BARD | TVL $746 jt | Didukung institusi | Konsorsium = pihak yang dipercaya ("coordination risk") | [risk report](https://static-r2.jup.ag/lend/risk-research/lbtc-risk-report.pdf) |
| tBTC (Threshold) | BTC terbungkus 1:1, dompet 51-of-100 signer ber-stake | User DeFi EVM | T | TVL $328 jt | Redeem permissionless | Tetap aset terbungkus + set penanda tangan | [docs](https://docs.threshold.network/tbtc-signer-nodes) |
| ERC-6551 / Tokenbound | Setiap ERC-721 punya dompet smart contract | Proyek NFT/game | — | Data 2025–26 tidak ditemukan | Standar, tooling terbuka | **Penjual bisa mengosongkan dompet tepat sebelum penjualan final**; hanya EVM | [survei](https://arxiv.org/pdf/2508.07190), [EIP thread](https://ethereum-magicians.org/t/erc-6551-non-fungible-token-bound-accounts/13030?page=2) |
| NEAR Omni (nBTC) | Deposit BTC dibuktikan light client, penarikan ditandatangani MPC | User NEAR/Intents | — | TVL Omni tidak ditemukan; NEAR Intents $193 jt | Stack kepercayaan yang sama dengan Pusaka | BTC menjadi token di NEAR (bukan UTXO di alamat sendiri) | [docs](https://docs.near.org/chain-abstraction/omnibridge/overview) |

### Pesaing di hackathon ini (dinilai dengan rubrik yang sama; detail di folder analisis kompetitor)
| Proyek (track) | Inti | Teknologi NEAR | Traction (testnet/mainnet) | Kelebihan | Kelemahan | Sumber |
|---|---|---|---|---|---|---|
| Warrant (defi) 8,8 | Opsi physically-settled, agunan di dalam `intents.near`, NEP-245 | Intents, 1Click, relayer, reproducible build | **Mainnet**, 0 key, 90 tx | Refusal room 31 tx, `verify.mjs` | Satu produk sempit (opsi) | [repo](https://github.com/emmanuelist/warrant) |
| Sealed Exploit (open) 8,8 | Bounty exploit yang diverifikasi di TEE (OutLayer) | Global contract, akun keyless, OutLayer | testnet, 84 tx hunter | 21 klaim palsu ditolak on-chain | Pasar niche | [repo](https://github.com/edycutjong/sealed) |
| setllend (defi) 8,2 | Pinjaman USDC bunga tetap (order book) | Intents `auth_call`, 1Click, oracle Rhea | **Mainnet**, 1 FA key | Desain kredit matang | Layar app di video adalah "animated recreation"; owner bisa ubah parameter | [repo](https://github.com/TarasBrilian/setllend) |
| Handover (nfts) 8,2 | NFT = dompet ETH; penjual tak bisa simpan kunci | Chain Signatures (ETH), 0 key | testnet, 23 tx | Klaim→file:line→tes | 1 chain; saldo dicek off-chain; tanpa CI | [repo](https://github.com/AlphaTechini/handover) |
| OneUp (defi/nfts) 7,7 | Pasar prediksi + NFT "extra life" | NEP-171, 0 key | testnet, ±25k tx (bot sendiri) | Volume, CI | Oracle mock; Intents/DAO hanya lokal | [repo](https://github.com/ethboi/oneup) |
| Outlive (nfts) 7,5 | NFT memiliki vault bisnis API (402, kuitansi) | vault NEAR, NEP-413 | testnet, 1 FA key | Cerita bisnis jelas | "demand unproven", kontrak masih punya key | [repo](https://github.com/itsolaph/outlive) |
| Heir (open) 7,3 | Dead-man's switch, ahli waris ETH lewat Chain Signatures | Chain Signatures, relayer gas-free | testnet, 1 FA key | Paling mirip Pusaka secara substansi | Lebih sempit (NEAR + ETH), tanpa CI | [repo](https://github.com/ZSP111/Heir) |


### Setelah menonton semua video demo (9 Nov)

81 video/foto dari post X dinilai ulang (contact sheet 12 frame + transkrip). Yang mengubah posisi Pusaka:
- **Handover 7,7 → 8,2 (nfts).** Video 3:32 menunjukkan wallet ETH milik NFT didanai dan membelanjakan di Sepolia (Etherscan), lalu penjual yang menahan tx bertanda tangan diblokir sampai tx itu dibersihkan. Selisihnya dengan Pusaka (8,3) tinggal 0,1, dan nilai Demo Pusaka masih 7 karena videonya belum ada.
- **Sealed Exploit 8,8 dan Warrant 8,8.** Video keduanya hampir seluruhnya terminal/UI nyata dengan tx di explorer.
- **setllend 8,2 → 8,0, Loca 8,2 → 8,0.** Videonya hanya animasi, tanpa tx nyata.

Pelajaran untuk video Pusaka: juri menghargai **layar nyata + explorer**, bukan motion graphics. Minimal tampilkan deposit BTC yang terbukti on-chain, jual-beli NFT, tx serangan yang ditolak (`#/refused`), dan `verify.mjs` hijau. Demo 9 menaikkan Pusaka ke 8,7.

### Pembaruan 9 Nov malam: 380 proyek, 46 baru di track kita

Dua audit ulang dengan rubrik yang sama: proyek baru (repo, kontrak on-chain, demo X) dan rival teratas sejak 9 Nov. Detail per proyek ada di folder analisis kompetitor (tidak di repo).

| Track | Proyek (tanpa Pusaka) | Baru |
|---|---|---|
| nfts | 29 | +10 |
| defi | 63 | +23 |
| open | 69 | +24 |

**Rival lama hampir diam.** Tidak ada deploy mainnet baru dan tidak ada key yang dihapus. GetLeash naik 8,3 → 8,5 karena README-nya dilatih ulang lewat fresh clone.

**Proyek baru yang masuk top 5:**
| Proyek | Track | Skor | Kenapa kuat | Kelemahan |
|---|---|---|---|---|
| Contri | nfts | 8,2–8,7 (dua penilai) | Arisan di **mainnet**, `circles.contring.near` 0 key, hash = build CI, bayar lewat Intents 1Click, ~104 tes Rust | NFT-nya sampingan: NEP-171 read-only, tanpa `nft_transfer` |
| Hallmark | defi | 8,8 | Batas harga agen untuk Intents, quote dicek `ed25519_verify` on-chain, mainnet (68 tx), 61 Rust + 71 JS tes | Kontrak masih punya full-access key |
| Veto | open | 8,7 | Penanda tangan kedua di TEE, `ecrecover`, Chain Signatures ke Base, vault tanpa key dari global contract | Klaim Intents mainnet tidak terbukti, tidak ada CI |
| Priced In | defi / open | 8,2 | Pasar prediksi fakta, 3 juri AI di TEE NEAR AI, mainnet (231 tx) | — |
| Seats | nfts | 7,7 | NFT keanggotaan + Sputnik DAO + delegasi AI di OutLayer, CI hijau | — |

**Paling mirip Pusaka: Torch baru (6,8).** NFT warisan yang memegang alamat BTC testnet4 dan ETH Sepolia lewat Chain Signatures, dengan ahli waris. Bedanya dengan Pusaka:
- tidak ada bukti deposit on-chain (tanpa light client, tanpa `verified_sats`);
- tanda tangan BTC/ETH hanya dari CLI;
- tidak ada pasar dan pinjaman.

Tabel pembeda di README sudah dipertajam untuk ini (kolom "BTC/EVM address", baris "Sell it as Bitcoin").

**Posisi Pusaka (dengan asumsi repo publik + video + CI hijau):**
| Track | Pusaka | Di atas Pusaka |
|---|---|---|
| nfts | 8,3–8,5 | Contri 8,7 (penilai pertama); setara Contri 8,2 (penilai kedua) |
| defi | 8,2 | Warrant 8,8, Hallmark 8,8 |
| open | 8,3 | Sealed Exploit 8,8, Veto 8,7, Writ 8,5, GetLeash 8,5 |

**Sekarang (repo private, tanpa video, CI merah karena billing): 6,2.** Penilai luar memberi Repro 1 selama repo tidak bisa dibuka.

**Aksi, urut kenaikan skor per jam:**
1. Repo publik (user), paling lambat 12 Nov. Repro 1 → 9, dan CI jadi gratis lagi sehingga badge hijau.
2. Video 2–2,5 menit + post X (user). Kalimat pembuka: "BTC native, dibuktikan light client". Tunjukkan layar nyata + explorer, bukan animasi.
3. ~~Samakan angka tes~~: selesai (369 di semua dokumen).
4. ~~Kotak "What's real / not"~~: selesai, di atas README.
5. ~~`verify.mjs` mengecek v2~~: selesai. Hapus key v2 pada 13 Nov.
6. Mainnet (user, butuh dana) adalah satu-satunya cara mengejar Contri, Hallmark dan Warrant di "impact".

## 4. Jujur: paritas, yang harus dikejar, celah
**Paritas (bukan pembeda):**
- NFT yang membawa dompet: Handover, Deed, Torch, Logen, Outlive.
- Kontrak tanpa key + `verify` satu perintah: Warrant, Handover, Sealed.
- Relayer gas-free: Heir, Warrant.
- Pewarisan / dead-man's switch: Heir.
- MCP untuk agen: OneUp.

**Fitur kompetitor yang wajib dikejar:**
1. **Mainnet** (Warrant, setllend). Ini satu-satunya kelemahan besar Pusaka di `defi` dan di "impact".
2. **Refusal room yang bisa dilihat**: Warrant menampilkan tx gagal nyata di app. Pusaka punya tx gagalnya (`NotOwner`, `TooEarly`, `CodeMismatch`, dan lain-lain), tapi hanya di README dan tes.
3. **Eksekusi Intents nyata** untuk track `defi` (Warrant, setllend). Hanya mungkin di mainnet.

**Celah yang belum diisi (bukti):**
1. **"Drain before sale" ERC-6551**: masalah yang diakui di EIP thread dan survei akademik. Pusaka menyelesaikannya untuk BTC: saldo dibuktikan light client pada saat jual, dan pembeli mengikat `expected_sign_epoch`.
2. **BTC native + NFT yang bisa dijual + bukti deposit on-chain + penjualan atomik**: riset tidak menemukan satu produk live pun yang menggabungkan keempatnya. Liquidium memakai oracle pihak ketiga, LBTC dan tBTC memakai set penanda tangan, dan nBTC membungkus BTC.
3. **Pewarisan Bitcoin tanpa kustodian**: Heir hanya untuk NEAR/ETH. Babylon, Lombard, dan tBTC tidak punya fitur ini.

**Risiko narasi baru (8 Nov): Shade Agents sudah *deprecated*.** docs.near.org: "After April 19th, 2026, the Shade Agent Framework will no longer [be] maintained as standalone developer tooling." Pusaka menyebutnya di README (6 tempat) dan di teks submission. Juri NEAR akan membaca itu sebagai memakai tooling usang. → F3.

## 5. Pembeda nyata yang sulit ditiru
1. **Trust & verifikasi: Bitcoin light client di dalam kontrak.** `verified_sats` = deposit yang terbukti dikurangi semua output yang pernah ditandatangani kontrak. Pembeli, lender, dan agen cukup membaca kontrak, bukan indexer atau oracle. Untuk meniru ini, pesaing perlu memahami proof Merkle Bitcoin, konfirmasi, dan kembalian (proposal 5).
2. **Composability: satu NFT, lima chain, satu transaksi.** BTC (MPC secp256k1), ETH + USDC di 3 EVM (USDC dicek lewat foreign-tx verification MPC), SOL (ed25519), akun NEAR + nBTC (Omni) + stake. Semuanya pindah bersama `nft_transfer`.
3. **Kredit di atas BTC tanpa bridge, bisa dipakai agen AI.** Pinjaman beragun BTC, pasar penawaran berdiri, refinance, dan lelang Dutch. MCP server 43 tool dengan guard belanja dan elicitation, sehingga agen yang bertindak tetap dalam kendali manusia.

## 6. Positioning
> Untuk **pemegang Bitcoin** yang ingin menjual, meminjam atas, atau mewariskan BTC-nya **tanpa bridge atau kustodian**, **Pusaka** adalah **NFT NEAR yang memiliki alamat Bitcoin asli**, dengan saldo yang **dibuktikan on-chain oleh light client Bitcoin NEAR** dan yang pindah bersama NFT dalam satu transaksi. **Tidak seperti** LBTC/tBTC yang membungkus BTC di balik konsorsium penanda tangan, atau dompet NFT ERC-6551 yang bisa dikuras penjual sebelum penjualan final.

## 7. Kandidat fitur / integrasi
| # | Kandidat | Nilai tambah | Dampak skor | Kompetitor punya? | Effort | Risiko | Referensi | Keputusan |
|---|---|---|---|---|---|---|---|---|
| F1 | **Deploy mainnet** (`pusaka.near` / akun user) + satu Pusaka hidup | `defi` 6→8, impact 6→8; "nobody to switch it off" terbukti | Tinggi | Warrant, setllend | 3–4 j | Butuh dana user (~$35 minimum / ~$47 penuh, `docs/MAINNET.md`); tidak bisa di-undo | `docs/MAINNET.md` | **Ditunda** (user, 8 Nov: "nanti"); diputuskan sebelum 13 Nov |
| F2 | **Refusal room**: halaman `#/refused` berisi tx gagal nyata dari chain (NotOwner, TooEarly, CodeMismatch, front-run sign epoch, …), masing-masing dengan link explorer dan tes yang menjaganya | Polish + "trust" terlihat dalam 10 detik; pola pemenang no. 4 | Sedang–Tinggi | Warrant | 3 j | Rendah: read-only, data sudah ada | README threat model, `receipt-monitor.mjs` | **BANGUN — selesai 8 Nov**: `#/refused`, 11 tx nyata (dipilih dari 441 tx kontrak), `live.spec` + axe + overflow lulus |
| F3 | **Ubah framing Shade Agent → "deposit prover in a TEE (Phala TDX)"**, plus catatan bahwa framework-nya deprecated | Menghindari kesan tooling usang | Sedang | — | 30 menit | Nol | docs.near.org (lihat §4) | **BANGUN — selesai 8 Nov** (README 6 tempat, teks submission 1.620 karakter) |
| F4 | Eksekusi Intents/1Click nyata untuk keluar dari BTC | `defi` +1 | Sedang | Warrant, setllend | 4 j setelah F1 | Likuiditas mainnet saja | 1Click API | **BANGUN — selesai 9 Nov (testnet, lewat Tidepool)**: skrip, form web (Intear, 14,79 USDC), dan tool MCP `pusaka_swap_to_usdc`/`pusaka_swap_status`; mainnet (1Click) ikut F1 |
| F5 | Akun deterministik (state-init) / global contract per NFT | "NFT sebagai akun" versi terbaru | Rendah–Sedang | Deed, Sealed | 1–2 hari | Ganti arsitektur inti 6 hari sebelum deadline; kontrak sudah final (renounced) | docs.near.org deterministic accounts | **BANGUN — selesai 9 Nov di kontrak v2** (`pusaka-v2.testnet`, upgradeable lewat DAO): akun `0s…` per NFT dari global contract `token-account`, `account_call` hanya oleh pemegang, live #4–#6 |
| F6 | Kunci post-quantum ML-DSA | — | Nol | — | — | — | — | **BANGUN — selesai 9 Nov di v2**: `set_pq_key` + `pq_unlock` diverifikasi on-chain dengan `env::ml_dsa_verify` (NEP-645, 3,5 TGas); UI `#/v2`, tool MCP `pusaka_pq_unlock` |
| F7 | Nama TLA milik NFT | sesuai brief `nfts` | Rendah | — | 1–2 hari | Mainnet + sewa | — | **BANGUN (versi testnet) — 9 Nov**: nama TLA mustahil (hanya `registrar` bisa membuat nama < 65 karakter), jadi alias `t<id>.pusaka-v2.testnet` dengan aturan yang sama |
| F8 | **Budget harian agen AI yang dipaksakan kontrak** (diadopsi dari Hallmark/Veto) | Agen yang dibajak paling banyak kehilangan budget sehari, hanya ke akun yang didaftar pemegang | Sedang (nfts "ownership with behavior" + open) | Hallmark (off-NFT), Veto (TEE) | 4 j | Rendah | — | **BANGUN — selesai 10 Nov di v2** lewat DAO proposal 10: `set_agent`/`agent_send`/`agent_of`, 9 tes `f8_*`, live 1 bayar + 4 tolakan on-chain, tool MCP + UI `#/v2/7` |
| F9 | **Sign in sebagai NFT** (EIP-4361, kunci EVM MPC milik NFT) | Login/akses milik alamat NFT ikut pindah ke pemegang baru | Sedang (nfts "carry credentials") | — | 3 j | Rendah | — | **SELESAI 10 Nov** (proposal 11): `sign_in`, 6 tes `f9_*`, live `BBN85r1K…` + tolakan `NotOwner`, tool MCP `pusaka_sign_in`, tombol di `#/v2/<id>` |
| I1 | **NFT dijual utuh lewat NEAR Intents** (`nft_transfer_call` ke verifier defuse, `token_diff` NEP-413) | Pusaka #15 (10.000 sats) terjual 5 USDC dalam satu tx; harga tidak cocok ditolak dan NFT kembali | Tinggi (defi: Intents dipakai sebagai settlement aset nyata) | — | 2 j | Rendah | — | **SELESAI 10 Nov** tanpa ubah kontrak: `scripts/intents-nft-sale.mjs`, tx `ALQN3eLY…` |
| I2 | **NFT punya saldo NEAR Intents sendiri**, ikut pindah saat NFT dipindah | Saldo dikendalikan pemegang saat ini saja; celah V2-9 ditutup | Sedang (defi + nfts) | — | 2 j | Rendah | — | **SELESAI 10 Nov**: `scripts/v2-intents-balance.mjs`, tampil di `#/v2/<id>` |
| A1 | **Bid per sat terverifikasi** (pola Blur collection bids) di kontrak market terpisah | Exit instan untuk setiap Pusaka, harga mengikuti isi yang terbukti | Tinggi (defi) | Blur | 4 j | Sedang | — | **SELESAI 10 Nov**: `pusaka-market.testnet`, live `5rApe8UQ…` + tolakan `SatsOutOfRange` |
| A2 | **Pinjaman tanpa jatuh tempo** (Blend: call → lelang bunga → refinance/seize) | Likuiditas pinjaman tanpa oracle | Tinggi (defi) | Paradigm/Blur Blend | 4 j | Sedang | — | **SELESAI 10 Nov**: live offer → call → refinance 173,53 % → repay |
| A3 | **Bukti alamat BTC BIP-322** dari kunci MPC NFT | Bukti kepemilikan alamat yang diterima dompet/bursa Bitcoin | Sedang (nfts, open) | BIP-322 | 2 j | Rendah | — | **SELESAI** (proposal 16), cocok dengan vektor resmi |
| A4 | **Penyewa (ERC-4907 user)** | Sewa akses tanpa menyerahkan NFT/BTC | Rendah | ERC-4907 | 1 j | Rendah | — | **SELESAI** (proposal 16) |
| A5 | **Beli Pusaka dengan BTC asli**, dibuktikan light client | Pembeli Bitcoin tanpa token NEAR | Tinggi (nfts, defi) | Atomiq (pola) | 5 j | Sedang | — | **KONTRAK SELESAI** (proposal 16, 11 tes, listing+reservasi live); pembayaran BTC live tertunda: ISP memblokir explorer Bitcoin dari mesin ini |
| A6 | **Halaman proof-of-reserves** + view `reserves()` | Primitive PoR yang bisa diverifikasi ulang | Sedang (defi) | Chainlink PoR, Lombard | 2 j | Rendah | — | **SELESAI**: `#/reserves` |
| A7 | Harga Pyth / batas LTV on-chain | — | — | Pyth | — | — | — | **DITOLAK**: feed testnet basi sejak Juni 2026 dan Hermes kini butuh API key berbayar (401) |
| A8 | Penundaan penarikan + veto guardian (Zodiac Delay) | — | — | Safe/Zodiac | — | — | — | **DITOLAK**: pencuri kunci cukup memindahkan NFT-nya; penundaan yang efektif harus menunda semua aksi pemilik (refaktor besar). Kunci PQ (F6) sudah membuat kunci NEAR curian tidak berguna |
| A9 | Pool pinjaman instan (Liquidium/Rhea) | — | — | Liquidium | — | — | — | **TIDAK DIBANGUN**: butuh oracle harga on-chain (lihat A7) dan akuntansi share; terlalu berisiko untuk 3 hari |
| A10 | **x402 di NEAR**: audit proof-of-reserves berbayar per panggilan | Agen membayar layanan tanpa akun/API key | Tinggi (agent economy) | FastNear `@fastnear/x402` | 3 j | Rendah | — | **SELESAI 10 Nov**: `api/audit.mjs`, tool MCP `pusaka_paid_audit`, live `seQLPR6C…`, `A2qiMjNA…`, `9Qmkeyad…`; facilitator publik butuh API key manual, jadi settle di proses sendiri lewat relayer |
| A11 | **Vault + clawback** (meniru vault covenant Bitcoin: CTV/OP_CAT, Liana/Casa) | Kunci curian tidak bisa langsung menguras | Tinggi (keamanan) | purrfect_vault, bitcoinops vaults | 3 j | Sedang | — | **SELESAI 10 Nov** (proposal 19): F14, 14 tes `f14_*`, live di `#/v2/5` |
| A12 | **Covered call** (Hook) | Pemegang dapat premi tanpa menjual | Sedang (DeFi) | Hook protocol | 2 j | Sedang | — | **SELESAI 10 Nov** (proposal 19): F15, 11 tes `f15_*`, live |
| A13 | **Pool beli kurva linear** (sudoswap) per sat terverifikasi | Likuiditas instan untuk banyak Pusaka | Sedang | sudoswap | 1 j | Rendah | — | **SELESAI 10 Nov**: `place_pool`, 5 tes `pool_*`, market redeploy `HfF9Axjj…` |
| A14 | **Login passkey** (WebAuthn PRF → akun implisit NEAR) + relayer | Pengguna tanpa wallet | Sedang (onboarding) | web3-authn, Tatchi | 3 j | Sedang | — | **SELESAI 10 Nov**: `web/src/passkey.js`, live `J3d5cvfp…`, `GCkmawSb…` |
| A15 | **Telegram Mini App** | Distribusi (Portals/MRKT punya traksi di Telegram) | Sedang | MRKT, Portals | 1 j | Rendah | Bot dibuat user via BotFather | **SIAP**: `web/src/telegram.js`, `docs/TELEGRAM.md` |
| A16 | **Kartu agen ERC-8004** | Agen bisa ditemukan | Rendah | ERC-8004 | 0,5 j | Rendah | Registrasi on-chain butuh ETH Base Sepolia | **SELESAI (discovery saja)**: `/.well-known/agent-registration.json` |

## 8. Spesifikasi fitur terpilih
### F2 — Refusal room
- **User story:** sebagai juri atau calon pembeli, aku ingin melihat dengan mata sendiri bahwa serangan yang disebut README benar-benar ditolak oleh chain, bukan hanya oleh tes.
- **Alur:** nav "Refused" → daftar kartu. Setiap kartu memuat siapa yang mencoba apa, kode panic (diterjemahkan `errors.js`), waktu, link tx di explorer, dan nama tes yang menjaga serangan itu. Data diambil dari tx yang tercantum (hash tetap di kode), dan statusnya dibaca live dari RPC (`EXPERIMENTAL_tx_status`) agar tidak bisa dipalsukan.
- **Acceptance criteria:**
  1. Minimal 6 tx gagal nyata dari README (NotOwner, TooEarly, CodeMismatch, dan lainnya), masing-masing berstatus `Failure` saat dibaca dari RPC.
  2. Kalimat kegagalan berasal dari panic on-chain, bukan teks statis. Kalau RPC tidak bisa dibaca, kartu menulis "couldn't read", bukan "refused".
  3. Ada test `live.spec` yang memastikan setiap kartu berstatus gagal on-chain; `verify.mjs` tidak berubah.
  4. axe: tidak ada pelanggaran serious atau critical.
- **Kontrak:** tidak ada perubahan (memang tidak bisa: kontrak final). Hanya RPC NEAR.
- **Tools NEAR:** RPC `tx` / `EXPERIMENTAL_tx_status`, explorer.

### F3 — Framing TEE
- README (6 tempat) + teks submission: "Shade Agent" → "a deposit prover in a TEE (Phala TDX), registered on-chain with an attestation check (built on NEAR's Shade Agent contract, a framework NEAR has since deprecated)". Tx dan akun `pusaka-agent.testnet` tetap ditautkan.
- **Acceptance:** `verify.mjs` hijau (link tx tetap ada); jumlah karakter submission ≤ 2000.

### F1 — Mainnet (menunggu keputusan user)
Langkah ada di `docs/MAINNET.md`: deploy wasm reproducible yang sama, mint 1 Pusaka, deposit BTC kecil, `prove_deposit`, hapus key + `renounce_upgrades`, lalu tambahkan baris mainnet ke `verify.mjs`.
**Acceptance:** `verify.mjs --network mainnet` hijau, dan tx tercantum di README.

## 9. Copy UI / landing (10 detik)
Hero sekarang: "NFTs that hold real Bitcoin." + lede (satu transaksi, tanpa bridge atau kustodian, tanpa key tersisa di penjual) + total sats terverifikasi dari kontrak. Copy ini sudah menyatakan pembeda 1. Rekomendasinya hanya menambah bukti, bukan klaim:
1. Di bawah angka sats terverifikasi: "proven by NEAR's Bitcoin light client". **Sudah ada:** "Every satoshi is proven by NEAR's Bitcoin light client, not reported by us."
2. Tautan trust ke F2. **Selesai:** pill "See what the contract refused" di hero, di samping "Open the market" dan "Connect an AI agent".
3. Tidak ada tabel "kami vs mereka" di app atau README (HACKATHON.md: "no marketing"). Perbandingannya cukup di laporan ini.
