# JP Bids MCP — Panduan Bahasa Indonesia

[![Smithery](https://smithery.ai/badge/a-kabe-1qio/jp-bids-mcp)](https://smithery.ai/servers/a-kabe-1qio/jp-bids-mcp)

## Gambaran Umum / Overview / 概要

JP Bids MCP adalah server MCP untuk mencari, memeringkat, mengekstrak persyaratan, dan mengekspor pengumuman pengadaan pemerintah Jepang dari portal KKJ. Sepenuhnya gratis, read-centric, 7 tools.

JP Bids MCP is an MCP server for searching, ranking, extracting requirements, and exporting Japanese government procurement notices from the SME Agency's KKJ portal (free, read-centric, 7 tools).

JP Bids MCP は、中小企業庁「官公需情報ポータルサイト」の入札情報をMCPで検索・順位付け・要件抽出・出力するサーバーです（完全無料・読み取り中心・7ツール）。

> **Sepenuhnya Gratis & Read-Centric / Free and Read-Centric**<br>
> Semua 7 tools publik dapat digunakan gratis tanpa langganan berbayar. Tidak ada pemanggilan Stripe.<br>
> All 7 public tools are free without subscription or paid tiers.

## Status Saat Ini & Verifikasi

> [!IMPORTANT]
> **Status: Mock Lokal Tervalidasi (M1–M3-B) | Koneksi Langsung & Penerimaan Resmi Sedang Berlangsung**
> - **Verifikasi Mock Claude Desktop (M1–M3-B)**: **LULUS (Terbukti)**. Diverifikasi di Claude Desktop menggunakan skrip peluncur stdio mock publik (`examples/mock-stdio-server.mjs`) yang menginjeksikan data uji XML offline (`tests/fixtures/kkj-search.xml`, `KKJ-TEST-001`):
>   - **M1**: Pencarian tender lewat chat (`search_bids`) mengembalikan hasil terstruktur.
>   - **M2**: Tampilan antarmuka AI Bid Workspace (`search_bids_app`) berbasis spesifikasi MCP Apps (`ui://jp-bids/search-results.html`).
>   - **M3-A**: Perubahan status interaktif dalam antarmuka (pilihan baris tender, jumlah terpilih, aktivasi tombol ekspor CSV/JSON).
>   - **M3-B**: Komunikasi alat dua arah dari UI ke server (pencarian dalam aplikasi memanggil `search_bids_app` dalam 2ms dan memperbarui UI).
>   *(Catatan: Verifikasi M1–M3-B dilakukan melalui pencegatan mock tingkat aplikasi (`examples/mock-stdio-server.mjs`) yang menyelesaikan permintaan API KKJ menggunakan fixture XML lokal dan memblokir panggilan fetch tak terduga. Perhatikan bahwa ini adalah guard mock tingkat aplikasi dalam runtime Node.js, bukan isolasi firewall tingkat OS atau sandbox jaringan; tidak ada lalu lintas jaringan keluar ke KKJ yang teramati selama sesi verifikasi).*
> - **Koneksi Data KKJ Langsung & Penerimaan Gate 1**: **DALAM PROSES (Belum Selesai・Transisi)**. Akses jaringan langsung ke API KKJ Badan UKM Jepang dan pengujian penerimaan resmi Gate 1 (35 kondisi) dijadwalkan pada tahap berikutnya (M4).
>
> **Pemisahan Lingkungan (Demo Mock vs. Jalur Runtime Standar / Produksi)**:
> - **Demo Mock Publik (`examples/mock-stdio-server.mjs`)**: Untuk evaluasi UI, pengujian offline, dan mereproduksi M1–M3-B di Claude Desktop. Menggunakan fixture XML lokal (`tests/fixtures/kkj-search.xml`, `KKJ-TEST-001`) dengan pencegatan permintaan HTTP tingkat aplikasi (bukan isolasi jaringan tingkat OS).
> - **Runtime Lokal Standar (`node dist/server.js`)**: Eksekusi runtime normal. Dapat melakukan kueri ke API KKJ portal resmi (`http://www.kkj.go.jp/api/`) bergantung pada konfigurasi, dengan pembatasan laju token bucket ketat (<= 1 req/dtk), tanpa penyimpanan lampiran PDF/XML, dan tanpa log stdout (hanya stderr).
> - **Paket Publik (`npx -y jp-bids-mcp`) & MCP Jarak Jauh (`https://mcp.bid-jp.com/mcp`)**: Jalur produksi standar yang berkomunikasi dengan API KKJ resmi atau endpoint layanan jarak jauh.

## Cukup Bicara dengan AI

```text
"Cari tender IT di Prefektur Kagoshima, urutkan yang paling cocok untuk kami"
```

→ 14 hasil → Pemeringkatan tender (`rank_bids`) → Lihat di UI workspace (`search_bids_app`).

```text
"Atur persyaratan wajib dan dokumen dari pengumuman ini"
```

→ Ekstrak daftar checklist persyaratan (`extract_bid_requirements`).

```text
"Ekspor 5 tender teratas ke format CSV"
```

→ Ekspor ke CSV / JSON dengan mempertahankan urutan pilihan (`export_bid_shortlist`).

*(Catatan: Fitur tambahan seperti Investor Radar dan analisis riwayat pemenang hanya tersedia di profil pengembang `full_local`)*

## Mulai Cepat / Quick Start / クイックスタート

```text
Remote MCP: https://mcp.bid-jp.com/mcp
npm:        jp-bids-mcp
Registry metadata name: io.github.SUGUKURU-CO-LTD/jp-bids
```

### Claude.ai / ChatGPT / Klien MCP

```text
https://mcp.bid-jp.com/mcp
```

Endpoint jarak jauh memerlukan OAuth 2.0. Permintaan tanpa header `Authorization` menerima `401` beserta `WWW-Authenticate: Bearer resource_metadata="https://mcp.bid-jp.com/.well-known/oauth-protected-resource/mcp"`. Claude.ai, ChatGPT, dan MCP Inspector menjalankan alur otorisasi secara otomatis (Dynamic Client Registration + PKCE S256), jadi Anda hanya perlu menekan tombol setuju. `curl` biasa memerlukan token. Untuk mencoba tanpa autentikasi, gunakan stdio lokal di bawah.

The remote endpoint requires OAuth 2.0; MCP clients run the flow automatically. Use local stdio below to try without authentication.

リモートエンドポイントは OAuth 2.0 必須です。MCP クライアントは認可フローを自動処理します。認証なしで試すには下のローカル stdio を使ってください。

### Stdio Lokal (tanpa autentikasi)

```bash
npx --yes jp-bids-mcp
```

### Ekspor CSV

```bash
npx --yes jp-bids-export --prefecture 鹿児島県 --category 役務 --query システム > tenders.csv
```

### Contoh Konfigurasi Claude Desktop

#### 1. Stdio Lokal (`claude_desktop_config.json`)

**A. Demo Mock Publik (Reproduksi Offline M1–M3-B):**
> [!TIP]
> Untuk mereproduksi demonstrasi M1–M3-B di Claude Desktop dengan aman tanpa akses jaringan langsung ke KKJ, build repositori secara lokal dan jalankan skrip mock publik:

1. Clone repositori dan build proyek:
   ```bash
   git clone https://github.com/SUGUKURU-CO-LTD/jp-bids-mcp.git
   cd jp-bids-mcp
   npm install
   npm run build
   ```
2. Tambahkan konfigurasi ke `claude_desktop_config.json`:
   ```json
   {
     "mcpServers": {
       "jp-bids-mock": {
         "command": "node",
         "args": ["/path/to/jp-bids-mcp/examples/mock-stdio-server.mjs"]
       }
     }
   }
   ```
   *(Ganti `/path/to/jp-bids-mcp` dengan path absolut lokal ke repositori hasil clone).*
3. Muat ulang Claude Desktop dan tanyakan di obrolan:
   ```text
   「鹿児島県の入札案件を検索して」
   ```
   Server mock menyajikan data `KKJ-TEST-001` (鹿児島市システム保守業務委託) dari fixture lokal `tests/fixtures/kkj-search.xml`, menampilkan panel AI Bid Workspace interaktif lengkap dengan pemilihan dan komunikasi dua arah.
   *(Catatan: Ini menggunakan pencegatan permintaan tingkat aplikasi untuk mengembalikan data fixture lokal, bukan isolasi sandbox tingkat OS).*

**B. Runtime Lokal Standar (Build Node.js):**
> [!NOTE]
> `node dist/server.js` adalah jalur runtime server standar. Berbeda dengan skrip demo mock, runtime standar beroperasi dalam mode normal dan dapat melakukan kueri ke API KKJ langsung bergantung pada konfigurasi:

```json
{
  "mcpServers": {
    "jp-bids": {
      "command": "node",
      "args": ["/path/to/jp-bids-mcp/dist/server.js"],
      "env": {
        "JP_BIDS_PROFILE": "public_mvp"
      }
    }
  }
}
```

**C. Paket Publik Standar via npx:**
> [!WARNING]
> `npx -y jp-bids-mcp` mengunduh paket dari registri npm publik dan berjalan dalam mode standar (bukan demo mock lokal). Paket ini berkomunikasi langsung dengan API KKJ resmi dan versinya mungkin berbeda dari salinan kerja lokal Anda:

```json
{
  "mcpServers": {
    "jp-bids": {
      "command": "npx",
      "args": ["-y", "jp-bids-mcp"],
      "env": {
        "JP_BIDS_PROFILE": "public_mvp"
      }
    }
  }
}
```

*(Catatan: Jangan mencantumkan path absolut Windows pribadi atau rahasia ke dalam file konfigurasi).*

#### 2. Konektor Kustom Jarak Jauh (Claude.ai / Claude Desktop)

Endpoint jarak jauh dikonfigurasi melalui antarmuka Konektor Kustom resmi Anthropic (bukan di `claude_desktop_config.json`):

1. Buka Claude (Claude.ai atau Claude Desktop).
2. Buka menu **Customize / Pengaturan → Connectors** (Konektor).
3. Tambahkan Konektor Kustom dengan URL:
   ```text
   https://mcp.bid-jp.com/mcp
   ```
4. Selesaikan otorisasi via OAuth 2.0 (Dynamic Client Registration + PKCE S256).

## Daftar Alat / Tools / ツール一覧

| Alat | Deskripsi | Profil |
|---|---|---|
| `search_bids` | Cari berdasarkan kata kunci, wilayah, kategori | Public MVP |
| `list_recent_bids` | Daftar pengumuman terbaru (1–30 hari terakhir) | Public MVP |
| `get_bid_detail` | Detail tender | Public MVP |
| `rank_bids` | Peringkat berdasarkan kriteria perusahaan | Public MVP |
| `extract_bid_requirements` | Ekstraksi persyaratan tender (ekstraksi dokumen eksternal default OFF) | Public MVP |
| `export_bid_shortlist` | Ekspor shortlist CSV/JSON (urutan pemilihan dipertahankan) | Public MVP |
| `search_bids_app` | Workspace pencarian interaktif dengan UI MCP Apps (`ui://jp-bids/search-results.html`, panel UI bundel HTML mandiri) | Public MVP |

## Harga / Pricing / 料金

| Paket | Harga | Fitur |
|---|---|---|
| **Public MVP** | Gratis (Free) | 7 alat publik (pencarian, pengumuman terbaru, detail, peringkat, ekstraksi persyaratan, ekspor shortlist, UI MCP Apps) |

Semua fitur publik (7 alat) tersedia gratis tanpa langganan atau tingkatan berbayar. Tidak ada panggilan penagihan Stripe.<br>
*(※ Tidak termasuk biaya token AI pihak ketiga atau infrastruktur cloud self-hosted)*

## Sumber Data

API Pencarian Portal Informasi Pengadaan Pemerintah, Badan UKM Jepang. Server ini tidak menyimpan dokumen lampiran tender. Selalu verifikasi dengan dokumen pengadaan resmi sebelum mengajukan penawaran.

## Interoperabilitas / Interoperability / 相互運用

JP Bids MCP berpasangan dengan [J-Grants MCP](https://github.com/digital-go-jp/jgrants-mcp-server) (Badan Digital Jepang) untuk mencakup tender pemerintah dan subsidi dalam satu percakapan.

```
# Cari tender (JP Bids MCP) dan subsidi (J-Grants MCP) secara bersamaan
"Tolong cari tender pengadaan sistem IT di Kagoshima dan subsidi DX untuk usaha kecil secara bersamaan."
```

JP Bids MCP dapat dipadukan dengan [J-Grants MCP](https://github.com/digital-go-jp/jgrants-mcp-server) (Digital Agency of Japan) dan [freee MCP](https://www.npmjs.com/package/freee-mcp) (freee K.K.) untuk pencarian terpadu tender dan subsidi, serta otomatisasi pengadaan-ke-akuntansi.

> JP Bids MCP, J-Grants MCP, dan freee MCP adalah server independen yang dioperasikan oleh organisasi berbeda. Hasil adalah informasi referensi; selalu verifikasi dengan dokumen resmi.

## Spesifikasi Metadata & Registri

JP Bids MCP memisahkan secara jelas antara manifes katalog registri resmi dan endpoint penemuan runtime:

1. **Manifes MCP Registry Resmi (`server.json`)**:
   - Mematuhi `$schema: "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json"`.
   - Digunakan oleh registri paket resmi (`io.github.SUGUKURU-CO-LTD/jp-bids`) untuk pendaftaran server, verifikasi repositori, dan interoperabilitas.
2. **Endpoint Penemuan Server Card (`public/.well-known/mcp/server-card.json`)**:
   - Disediakan di `/.well-known/mcp/server-card.json` untuk introspeksi skema alat yang lengkap dan binding `_meta.ui` MCP Apps.

## Kebijakan / Policies / ポリシー

- [Kebijakan Privasi / Privacy Policy](https://mcp.bid-jp.com/privacy)
- [Ketentuan Layanan / Terms of Service](https://mcp.bid-jp.com/terms)
