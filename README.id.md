# JP Bids MCP — Panduan Bahasa Indonesia

[![CI](https://github.com/SUGUKURU-CO-LTD/jp-bids-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/SUGUKURU-CO-LTD/jp-bids-mcp/actions/workflows/ci.yml)
[![CodeQL](https://github.com/SUGUKURU-CO-LTD/jp-bids-mcp/actions/workflows/codeql.yml/badge.svg)](https://github.com/SUGUKURU-CO-LTD/jp-bids-mcp/actions/workflows/codeql.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

Server MCP untuk mencari, memeringkat, mengekstrak persyaratan, dan mengekspor pengumuman pengadaan pemerintah Jepang melalui Model Context Protocol (MCP). Sepenuhnya gratis, read-centric, menyediakan 7 tools publik.<br>
Search, rank, extract requirements, and export Japanese public procurement notices through MCP (free, read-centric, 7 tools).<br>
日本の官公需入札情報をMCPで検索・順位付け・要件抽出・出力するサーバー（完全無料・読み取り中心・7ツール）。

> **Sepenuhnya Gratis & Read-Centric / Free and Read-Centric**<br>
> Semua 7 tools publik dapat digunakan gratis tanpa langganan berbayar. Tidak ada pemanggilan penagihan pihak ketiga seperti Stripe.<br>
> All 7 public tools are available for free without subscription or paid tiers.

---

### Status Proyek & Saluran Distribusi / Project Status & Release Channels

| Saluran / Item | Status | Deskripsi / Penjelasan |
|---|:---:|---|
| **GitHub Open Source** | **Aktif (Active)** | [SUGUKURU-CO-LTD/jp-bids-mcp](https://github.com/SUGUKURU-CO-LTD/jp-bids-mcp) (Apache 2.0). 182 pengujian lulus, CI/CodeQL lolos, disertai demo mock offline yang dapat direproduksi. |
| **Demo Mock Lokal** | **Terverifikasi (Verified)** | Verifikasi M1–M3-B selesai (pencarian, panel workspace UI MCP Apps, pemanggilan alat dua arah). |
| **Paket npm** | **Direncanakan (Planned)** | Validasi pengemasan (`npm pack`) berhasil. Publikasi (`jp-bids-mcp`) menunggu persetujuan rilis terpisah. |
| **Registri MCP Resmi** | **Direncanakan (Planned)** | Metadata namespace `io.github.SUGUKURU-CO-LTD/jp-bids` telah dikonfigurasi; pendaftaran registri menunggu persetujuan terpisah. |
| **Endpoint MCP Jarak Jauh** | **Direncanakan (Planned)** | Endpoint HTTP streamable (`https://mcp.bid-jp.com/mcp`) direncanakan setelah lingkungan hosting selesai disiapkan. |

> 💡 **Public Technical Showcase / Showcase Teknis Publik**:  
> Lihat [**docs/showcase/README.md**](https://github.com/SUGUKURU-CO-LTD/jp-bids-mcp/blob/main/docs/showcase/README.md) untuk tangkapan layar perangkat nyata, penjelasan arsitektur, dan panduan reproduksi offline dari ruang kerja interaktif MCP Apps di dalam Claude Desktop.

---

## Status Verifikasi Saat Ini / Current Verification Status

> [!IMPORTANT]
> **Status: Mock Lokal Terbukti (M1–M3-B) | Koneksi Langsung KKJ dalam Persiapan**
> - **Verifikasi Mock Claude Desktop (M1–M3-B)**: **LULUS (Terbukti)**. Diverifikasi di Claude Desktop menggunakan skrip peluncur stdio mock publik (`examples/mock-stdio-server.mjs`) yang menginjeksikan fixture XML offline (`tests/fixtures/kkj-search.xml`, `KKJ-TEST-001`):
>   - **M1**: Pencarian tender lewat obrolan (`search_bids`) mengembalikan hasil terstruktur.
>   - **M2**: Tampilan antarmuka AI Bid Workspace (`search_bids_app`) berbasis spesifikasi MCP Apps (`ui://jp-bids/search-results.html`).
>   - **M3-A**: Perubahan status interaktif dalam UI (pemilihan baris tender, penghitung item terpilih, aktivasi tombol ekspor CSV/JSON).
>   - **M3-B**: Komunikasi alat dua arah dari UI ke server (pencarian dalam aplikasi memanggil `search_bids_app` dalam 2ms dan memperbarui UI).
>   *(Catatan: Verifikasi M1–M3-B dilakukan melalui pencegatan mock tingkat aplikasi (`examples/mock-stdio-server.mjs`) yang menyelesaikan permintaan API KKJ menggunakan fixture XML lokal dan memblokir panggilan fetch tak terduga. Ini adalah guard mock tingkat aplikasi dalam runtime Node.js, bukan isolasi firewall tingkat OS atau sandbox jaringan. Tidak ada lalu lintas jaringan keluar ke KKJ yang teramati selama sesi verifikasi).*
> - **Reproduksi Kloning Bersih vs. Pengujian Otomatis**:
>   - **Pengujian Otomatis**: 182 pengujian unit dan integrasi Vitest (`npm test`) memverifikasi skema server, batasan keamanan, view model UI, dan invarian protokol.
>   - **Verifikasi Stdio Kloning Bersih**: Reproduksibilitas diverifikasi pada direktori baru yang terisolasi tanpa cache pengembangan (`npm ci` → `npm run build` → jabat tangan stdio), membuktikan pendaftaran 7 alat, respon pencarian mock (`KKJ-TEST-001`), dan perolehan bundel UI MCP Apps.
>   - **Verifikasi Aplikasi Desktop**: Peluncuran proses, koneksi, dan pendaftaran 7 alat terkonfirmasi di Claude Desktop. Tindakan GUI interaktif dalam aplikasi (M2–M3-B) memerlukan operasi manual pengguna di klien desktop dan dilacak terpisah dari bukti pengujian terprogram.
> - **Koneksi Data KKJ Langsung & Penerimaan Gate 1**: **DALAM PERSIAPAN**. Akses langsung ke API KKJ Badan UKM Jepang dan pengujian kepatuhan resmi Gate 1 (35 kondisi) dijadwalkan pada tahap verifikasi berikutnya.

---

## Mulai Cepat: Demo Mock Lokal (Direkomendasikan) / Quick Start

Tersedia demo mock lokal yang dapat direproduksi secara mandiri tanpa memerlukan akses jaringan eksternal untuk verifikasi langsung di Claude Desktop maupun klien MCP lainnya.

> [!NOTE]
> **Persyaratan Jaringan & Keamanan Mock**:
> - Koneksi internet aktif diperlukan untuk `git clone` dan instalasi dependensi awal menggunakan `npm ci`.
> - Setelah dependensi terinstal, menjalankan demo mock lokal (`examples/mock-stdio-server.mjs`) **tidak melakukan permintaan jaringan eksternal ke API KKJ langsung**; seluruh respon disajikan secara offline menggunakan fixture XML lokal (`tests/fixtures/kkj-search.xml`, `KKJ-TEST-001`).
> - *(Catatan: Mock ini menggunakan pencegatan permintaan tingkat aplikasi di Node.js untuk menjaga pemanggilan fetch dan menyajikan fixture lokal. Ini bukan sandbox atau isolasi firewall tingkat OS).*

### 1. Kloning & Bangun Proyek

Untuk reproduktibilitas pengujian, gunakan `npm ci` untuk instalasi dependensi:

```bash
git clone https://github.com/SUGUKURU-CO-LTD/jp-bids-mcp.git
cd jp-bids-mcp
npm ci
npm run build
npm test
```

> [!TIP]
> **Pengguna Windows PowerShell**:
> Jika eksekusi skrip dibatasi oleh kebijakan PowerShell (`PSSecurityException` pada `npm.ps1`), jalankan menggunakan `npm.cmd`:
> ```bash
> npm.cmd ci
> npm.cmd run build
> npm.cmd test
> ```

### 2. Konfigurasi Claude Desktop

Edit file `claude_desktop_config.json`:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows (Instalasi standar)**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Windows (Edisi Microsoft Store / UWP)**: Pada distribusi Store, file konfigurasi dapat divirtualisasikan ke direktori khusus paket. Meskipun pengidentifikasi paket dapat berbeda di setiap instalasi, jalur berikut telah dikonfirmasi dalam lingkungan pengujian Windows 11 kami sebagai contoh jalur yang teramati:
  `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "jp-bids-mock": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/jp-bids-mcp/examples/mock-stdio-server.mjs"]
    }
  }
}
```

*(Ganti `/ABSOLUTE/PATH/TO/jp-bids-mcp` dengan path absolut repositori lokal Anda. Di Windows, jika `node` tidak dapat diselesaikan oleh proses GUI dari PATH lingkungan, menentukan path absolut ke `node.exe`, misalnya `"C:\\Program Files\\nodejs\\node.exe"`, merupakan solusi yang disarankan).*

### 3. Uji Coba di Claude Desktop

Mulai ulang Claude Desktop, lalu tanyakan di obrolan:

```text
「鹿児島県の入札案件を検索して」
```

→ Data fixture lokal `KKJ-TEST-001` (鹿児島市システム保守業務委託) akan ditemukan, dan panel interaktif **AI Bid Workspace** (`ui://jp-bids/search-results.html`) akan terbuka. Pemilihan baris tender, penskoran, dan pencarian dua arah langsung berfungsi di dalam panel.

---

## Runtime Lokal Standar / Standard Local Runtime

> [!WARNING]
> **Pemberitahuan Akses API Langsung**:
> - `node dist/server.js` adalah build server produksi standar, **bukan server mock**.
> - Menjalankan alat dalam mode ini dapat memicu permintaan HTTP nyata ke API KKJ Badan UKM Jepang (`http://www.kkj.go.jp/api/`).
> - Untuk menghindari akses langsung yang tidak disengaja selama evaluasi lokal, selalu gunakan demo mock (`examples/mock-stdio-server.mjs`).

Contoh konfigurasi jika Anda ingin menjalankan server hasil build standar secara lokal:

```json
{
  "mcpServers": {
    "jp-bids": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/jp-bids-mcp/dist/server.js"],
      "env": {
        "JP_BIDS_PROFILE": "public_mvp"
      }
    }
  }
}
```

Pemeriksaan versi CLI:
```bash
node dist/server.js --version
```

---

## Saluran Distribusi Mendatang / Planned Deployment Channels

Jalur distribusi berikut telah disiapkan pada manifes metadata dan akan dibuka setelah persetujuan rilis terpisah:

### 1. Paket Registri npm Publik
Setelah dirilis ke registri npm, eksekusi langsung via `npx` akan tersedia:
```bash
# (Direncanakan setelah publikasi npm)
npx -y jp-bids-mcp
```

### 2. Endpoint HTTP Streamable Jarak Jauh
Setelah lingkungan hosting dideploy, klien MCP jarak jauh (Claude.ai, ChatGPT, dll.) dapat terhubung melalui OAuth 2.0:
```text
https://mcp.bid-jp.com/mcp
```
*(Memerlukan otorisasi OAuth 2.0 dengan Dynamic Client Registration + PKCE S256).*

---

## Fitur Utama / What It Provides

- **Pencarian Pengadaan Publik (Read-Only)**: Pencarian cepat pengumuman tender pemerintah Jepang berdasarkan kata kunci, wilayah, dan kategori.
- **AI Bid Radar**: Membandingkan kecocokan dan memeringkat tender berdasarkan kriteria perusahaan (`rank_bids`).
- **Ekstraksi Persyaratan & Dokumen**: Mengekstrak daftar periksa kualifikasi dan dokumen yang diperlukan secara terstruktur dari metadata (`extract_bid_requirements`). *Ekstraksi PDF eksternal default NONAKTIF.*
- **UI MCP Apps (`search_bids_app`)**: Workspace interaktif di dalam Claude Desktop (`ui://jp-bids/search-results.html`). Dibundel dalam satu file HTML mandiri dengan CSP ketat (`connectDomains: []`, `resourceDomains: []`) yang mencegah pemuatan aset eksternal. Mendukung penyaringan dalam aplikasi, pemilihan baris, dan pemanggilan alat dua arah.
- **Ekspor Shortlist (`export_bid_shortlist`)**: Mengekspor tender terpilih ke format CSV / JSON dengan mempertahankan urutan pilihan.
- **Sepenuhnya Gratis & Read-Only**: Semua 7 tools publik dapat digunakan gratis tanpa pendaftaran atau langganan berbayar. Tanpa panggilan penagihan Stripe.
- **Resources & Resource Templates**: Resource statis dan template dinamis untuk injeksi konteks AI.
- **Desain Aman**: Tanpa penyimpanan file lampiran, pembatasan laju token bucket (<= 1 req/dtk), bebas dari output log stdout (hanya stderr).

Sumber Data: API Pencarian Portal Informasi Pengadaan Pemerintah, Badan UKM Jepang.

---

## Daftar Alat Publik (Public MVP: 7 Tools)

| Alat / Tool | Deskripsi / Description | Profil |
|---|---|---|
| `search_bids` | Cari berdasarkan kata kunci, wilayah, kategori / Keyword, region & category search | Public MVP |
| `list_recent_bids` | Daftar pengumuman terbaru (1–30 hari terakhir) / Recent notices (past 1–30 days) | Public MVP |
| `get_bid_detail` | Detail tender / Bid detail | Public MVP |
| `rank_bids` | Peringkat berdasarkan kriteria perusahaan / Score & rank by your criteria | Public MVP |
| `extract_bid_requirements` | Ekstraksi persyaratan & kualifikasi tender / Requirement extraction | Public MVP |
| `export_bid_shortlist` | Ekspor shortlist CSV/JSON (urutan dipertahankan) / Export shortlist to CSV/JSON | Public MVP |
| `search_bids_app` | Workspace pencarian interaktif dengan UI MCP Apps (`ui://jp-bids/search-results.html`) / Interactive search workspace | Public MVP |

---

## Dukungan Protokol & Spesifikasi MCP / Protocol Support

JP Bids MCP diimplementasikan dan diverifikasi dengan pengujian otomatis sesuai spesifikasi standar Model Context Protocol:

- **Versi Protokol**: Mendukung resmi `2025-11-25` (validasi penerimaan header teruji).
- **Validasi Header Mismatch**: Menolak secara ketat jika header `Mcp-Method` / `Mcp-Name` tidak cocok dengan body JSON-RPC.
- **Keamanan OAuth 2.0**: Mendukung otorisasi aman dengan menyertakan parameter RFC 9207 `iss` pada respon otorisasi dan token JWT.
- **Ekstensi MCP Apps**: Pengiriman antarmuka in-line yang aman berbasis `@modelcontextprotocol/ext-apps` (v1.7.4).

---

## Daftar Sumber Daya / Resources

- `attribution://kkj`: Data atribusi dan penyangkalan Portal KKJ Badan UKM Jepang
- `docs://api-reference`: Referensi API untuk 7 tools publik
- `codes://prefectures`: Daftar kode prefektur Jepang
- `ui://jp-bids/search-results.html`: Sumber daya antarmuka AI Bid Workspace MCP Apps
- `prefecture://{lg_code}`: Template informasi pengadaan per pemerintah daerah

---

## Perintah Verifikasi & Pengujian / Verification & Testing

```bash
# Pemeriksaan menyeluruh (Biome Lint, pengecekan tipe TypeScript, build Vite UI, 182 pengujian Vitest)
npm run check

# Pembuatan dan pemeriksaan dokumen API TypeDoc (kompatibel Windows & Linux)
npm run docs:check

# Audit keamanan dependensi runtime produksi (0 kerentanan)
npm audit --omit=dev

# Pengujian unit verifikasi mock stdio offline
npx vitest run tests/mock-stdio-verification.test.ts
```

---

## Interoperabilitas / Interoperability

JP Bids MCP dirancang agar mudah dipadukan dengan server MCP data administrasi dan bisnis di Jepang:

- **J-Grants MCP** (Badan Digital Jepang): Menelusuri pengadaan tender (JP Bids MCP) dan subsidi/hibah (J-Grants MCP) dalam satu percakapan AI secara terpadu.
- **freee MCP** (freee K.K.): Otomatisasi pendaftaran transaksi pasca-menang tender, penerbitan faktur, dan integrasi akuntansi.

> *(Catatan: JP Bids MCP, J-Grants MCP, dan freee MCP adalah server independen yang dioperasikan oleh organisasi berbeda. Selalu verifikasi dokumen resmi pengadaan sebelum keputusan penawaran).*

---

## Spesifikasi Metadata & Registri / Metadata & Specifications

- **Manifes MCP Registry Resmi (`server.json`)**:
  - Mematuhi `$schema: "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json"`.
  - Identifier registri: `io.github.SUGUKURU-CO-LTD/jp-bids`
- **Penemuan Server Card (`public/.well-known/mcp/server-card.json`)**:
  - Mendefinisikan JSON Schema 7 tools publik, skema autentikasi, dan binding UI MCP Apps.

---

## Catatan Penting / Notes

Server ini tidak menyimpan dokumen lampiran pengadaan dari portal hulu. Hasil pencarian adalah informasi referensi; selalu verifikasi dengan dokumen pengadaan resmi sebelum mengajukan penawaran.<br>
This server does not store upstream documents or attachment files. Results are reference information and should be verified against official procurement documents before bidding decisions.

- [Kebijakan Privasi / Privacy Policy](https://github.com/SUGUKURU-CO-LTD/jp-bids-mcp/blob/main/public/privacy.html)
- [Ketentuan Layanan / Terms of Service](https://github.com/SUGUKURU-CO-LTD/jp-bids-mcp/blob/main/public/terms.html)
- [Lisensi / License: Apache-2.0](https://github.com/SUGUKURU-CO-LTD/jp-bids-mcp/blob/main/LICENSE)

