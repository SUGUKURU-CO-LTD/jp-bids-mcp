# JP Bids MCP

[![npm version](https://img.shields.io/npm/v/jp-bids-mcp)](https://www.npmjs.com/package/jp-bids-mcp)
[![CI](https://github.com/SUGUKURU-CO-LTD/jp-bids-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/SUGUKURU-CO-LTD/jp-bids-mcp/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Smithery](https://smithery.ai/badge/a-kabe-1qio/jp-bids-mcp)](https://smithery.ai/servers/a-kabe-1qio/jp-bids-mcp)

日本の官公需入札情報をMCPで検索・順位付け・要件抽出・出力するサーバー。完全無料・読み取り中心で7ツールを提供します。<br>
Search, rank, extract requirements, and export Japanese public procurement notices through MCP (free, read-centric, 7 tools).<br>
Server MCP untuk mencari, memeringkat, mengekstrak persyaratan, dan mengekspor pengumuman pengadaan pemerintah Jepang (gratis, read-centric, 7 tools).

> **完全無料・読み取り中心 / Free and Read-Centric**<br>
> 会員登録・有料プランなしで全公開機能（7ツール）を無料で利用できます。Stripe等の課金呼出しは行いません。<br>
> All 7 public tools are available for free without subscription or paid tiers.

```text
Remote MCP: https://mcp.bid-jp.com/mcp
npm:        jp-bids-mcp
Registry metadata name: io.github.SUGUKURU-CO-LTD/jp-bids
```

## Current Status & Verification / 検証状況とステータス / Status Verifikasi

> [!IMPORTANT]
> **Status: Local Mock Validated (M1–M3-B) | Live Connection & Formal Acceptance In Progress**
> - **Claude Desktop Mock Verification (M1–M3-B)**: **PASSED (実証完了)**. Verified inside Claude Desktop using a local mock stdio launcher script (`examples/mock-stdio-server.mjs`) injecting offline XML fixtures (`tests/fixtures/kkj-search.xml`, `KKJ-TEST-001`):
>   - **M1**: Search bids via chat (`search_bids`) returning structured results.
>   - **M2**: Interactive UI workspace rendering (`search_bids_app`) via MCP Apps specification (`ui://jp-bids/search-results.html`).
>   - **M3-A**: In-app interactive state changes (row selection, selection counts, CSV/JSON button activation).
>   - **M3-B**: Bidirectional UI-to-server tool invocation (in-app search calling `search_bids_app` returning in 2ms and updating UI).
>   *(Note: M1–M3-B verification was performed via an in-application mock interceptor (`examples/mock-stdio-server.mjs`) resolving KKJ API requests with local XML fixtures and guarding runtime `fetch` calls. This is an application-level runtime mock, not an OS-level sandbox or network firewall isolation. No external KKJ network traffic was observed during verification).*
> - **Live KKJ Connection & Gate 1 Acceptance**: **IN PROGRESS (未完了・移行中)**. Direct queries to the Small and Medium Enterprise Agency KKJ API and formal Gate 1 compliance acceptance (35 test conditions) are scheduled for phase M4.
>
> **Environment Separation (Mock Demo vs. Standard / Live Access)**:
> - **Public Mock Demo (`examples/mock-stdio-server.mjs`)**: For UI evaluation, offline testing, and reproducing M1–M3-B in Claude Desktop. Uses local XML fixtures (`tests/fixtures/kkj-search.xml`, `KKJ-TEST-001`) with application-level HTTP request interception (not OS-level network isolation).
> - **Standard Local Runtime (`node dist/server.js`)**: Normal runtime execution. May query the official KKJ portal API (`http://www.kkj.go.jp/api/`) depending on configuration, adhering to token-bucket rate limiting (<= 1 req/sec), zero attachment persistence, and stderr-only logging.
> - **Published Package (`npx -y jp-bids-mcp`) & Remote MCP (`https://mcp.bid-jp.com/mcp`)**: Standard production pathways communicating with the official KKJ API or remote service endpoints.

## MCP 2026-07-28 Readiness / 対応状況 / Kesiapan

JP Bids MCP は `2025-11-25` と `2026-07-28` の protocol version を受け入れます。`Mcp-Method` / `Mcp-Name` header がある場合は JSON-RPC body との不一致を拒否し、OAuth authorization response と JWT には RFC 9207 の `iss` を含めます。
JP Bids MCP accepts both `2025-11-25` and `2026-07-28` protocol versions. When `Mcp-Method` / `Mcp-Name` headers are present, mismatches with the JSON-RPC body are rejected, and OAuth authorization responses/JWTs include RFC 9207 `iss`.
JP Bids MCP menerima versi protokol `2025-11-25` dan `2026-07-28`. Jika header `Mcp-Method` / `Mcp-Name` ada, ketidaksesuaian dengan body JSON-RPC ditolak, dan response/JWT OAuth menyertakan `iss` RFC 9207.

`server/discover`, `ttlMs` / `cacheScope`, and MRTR are tracked for the upcoming MCP 2026-07-28 specification and will be enabled after SDK support stabilizes.

## AIに話しかけるだけ / Just Ask Your AI

```text
「鹿児島県のIT系入札を探して、うちに合う順にランク付けして」
```

→ 14件ヒット → 複数案件の適合度・期限を比較採点 (`rank_bids`) → ワークスペース画面で確認 (`search_bids_app`)。

```text
「この案件の参加資格と提出書類のチェックリストを作って」
```

→ 公告メタデータから要件チェックリストを自動抽出 (`extract_bid_requirements`)。

```text
「上位5件をCSVで出力して」
```

→ 選択した順序を保ったままCSV / JSONでエクスポート (`export_bid_shortlist`)。

*(注: Investor Radarや過去落札傾向分析等の追加機能はローカル開発用 `full_local` プロファイル限定です)*

## Quick Start / クイックスタート

Use the remote endpoint from any Streamable HTTP compatible MCP client:

```text
https://mcp.bid-jp.com/mcp
```

The remote endpoint requires OAuth 2.0. A request without `Authorization` receives `401` with `WWW-Authenticate: Bearer resource_metadata="https://mcp.bid-jp.com/.well-known/oauth-protected-resource/mcp"`. Claude.ai, ChatGPT, and MCP Inspector run the flow for you (Dynamic Client Registration + PKCE S256), so you only click approve. Plain `curl` will not work without a token — use local stdio below to try it without authentication.

リモートエンドポイントは OAuth 2.0 必須です。`Authorization` なしのリクエストは `401` と `WWW-Authenticate` ヘッダーを返します。Claude.ai / ChatGPT / MCP Inspector は認可フローを自動で処理するため、承認ボタンを押すだけです。認証なしで試したい場合は下記のローカル stdio を使ってください。

Endpoint jarak jauh memerlukan OAuth 2.0. Permintaan tanpa `Authorization` mendapat `401` beserta header `WWW-Authenticate`. Klien seperti Claude.ai, ChatGPT, dan MCP Inspector menjalankan alur otorisasi secara otomatis. Untuk mencoba tanpa autentikasi, gunakan stdio lokal di bawah.

With MCP Inspector:

```bash
npx --yes @modelcontextprotocol/inspector
```

Set `Transport Type` to `Streamable HTTP` and use the remote URL above. Do not use the default STDIO sample command such as `mcp-server-everything`.

Sample `search_bids` arguments:

```json
{
  "query": "システム",
  "prefecture": "鹿児島県",
  "category": "役務",
  "limit": 3
}
```

Local stdio (no authentication required):

```bash
npx --yes jp-bids-mcp
```

CSV export:

```bash
npx --yes jp-bids-export --prefecture 鹿児島県 --category 役務 --query システム --days 7 > bids.csv
```

Check without starting an MCP session:

```bash
npx --yes jp-bids-mcp --version
```

### Claude Desktop Configuration / 設定例

#### 1. Local Stdio (`claude_desktop_config.json`)

**A. Public Mock Demo (M1–M3-B Offline Reproduction):**
> [!TIP]
> To reproduce the M1–M3-B Claude Desktop demonstration safely without live KKJ network access, build the repository locally and run the public mock script:

1. Clone and build the project:
   ```bash
   git clone https://github.com/SUGUKURU-CO-LTD/jp-bids-mcp.git
   cd jp-bids-mcp
   npm install
   npm run build
   ```
2. Configure `claude_desktop_config.json`:
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
   *(Replace `/path/to/jp-bids-mcp` with the absolute path to your cloned repository).*
3. Restart Claude Desktop and ask Claude:
   ```text
   「鹿児島県の入札案件を検索して」
   ```
   The mock server serves `KKJ-TEST-001` (鹿児島市システム保守業務委託) from local fixture `tests/fixtures/kkj-search.xml`, rendering the interactive AI Bid Workspace panel with selection and bidirectional tool invocation.
   *(Note: This uses application-level request interception to return local fixture data, not an OS-level sandbox).*

**B. Standard Local Runtime (Node.js Build):**
> [!NOTE]
> `node dist/server.js` is the standard server runtime path. Unlike the mock demo script, standard runtime operates in normal mode and may query the live KKJ API depending on configuration:

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

**C. Standard Published Package via npx:**
> [!WARNING]
> `npx -y jp-bids-mcp` downloads the published npm package and runs in standard mode (not the local mock demo). It communicates with the live KKJ API and may differ from your local working copy:

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

*(Note: Do not hardcode personal absolute paths or private credentials into configuration files).*

#### 2. Remote Custom Connector (Claude.ai / Claude Desktop)

The remote endpoint is configured via Anthropic's official Custom Connector UI (not in `claude_desktop_config.json`):

1. Open Claude (Claude.ai or Claude Desktop).
2. Navigate to **Customize / Settings → Connectors** (カスタムコネクタ).
3. Add a Custom Connector with the endpoint:
   ```text
   https://mcp.bid-jp.com/mcp
   ```
4. Authenticate via OAuth 2.0 (Dynamic Client Registration + PKCE S256).

## What It Provides / 主な機能

- 官公需入札情報の読み取り専用検索。Read-only search for Japanese public procurement notices.
- AI Bid Radar: 案件を実務優先度でスコアリング・ランキング。Ranking bid candidates by practical follow-up priority.
- 要件・資格抽出: 案件メタデータから要件・提出書類・資格を構造化抽出（※外部資料抽出は既定OFF）。Requirement and eligibility extraction from bid metadata (external document extraction is OFF by default).
- MCP Apps UI (`search_bids_app`): Claude Desktop内の対話型ワークスペース画面 (`ui://jp-bids/search-results.html`)。単一HTMLファイルにインラインバンドルされ、CSP (`connectDomains: []`, `resourceDomains: []`) 設定により外部アセット読み込みを制限。画面内での絞り込み、選択、双方向ツール呼び出しに対応。
- 完全無料・読み取り専用: 会員登録や有料プランなしで全公開機能（7ツール）を無料で利用可能。提供側の課金（Stripe等）は行いません。Free and read-centric with 7 tools; no subscriptions or billing calls.
- Resources・Resource Templatesでコンテキストを精密に渡せる。Resources and Resource Templates for targeted context.
- リモートStreamable HTTPとローカルstdioの両対応。Remote Streamable HTTP and local stdio transports.

*(注: Investor Radarや上場銘柄名寄せ等の追加モジュールはローカル開発用 `full_local` プロファイル限定の参考実装です)*

データ出典 / Data source: 中小企業庁 官公需情報ポータルサイト 検索API.

## Tools / ツール一覧

| ツール / Tool | 説明 / Description | Profile |
|---|---|---|
| `search_bids` | キーワード・地域・業種で検索 / Keyword, region & category search | Public MVP |
| `list_recent_bids` | 直近の公告一覧（過去1〜30日） / Recent notices (past 1–30 days) | Public MVP |
| `get_bid_detail` | 案件詳細取得 / Bid detail | Public MVP |
| `rank_bids` | 自社条件でスコアリング・順位付け / Score & rank by your criteria | Public MVP |
| `extract_bid_requirements` | 要件・提出書類・資格の抽出（外部抽出既定OFF） / Requirement extraction | Public MVP |
| `export_bid_shortlist` | CSV/JSONエクスポート（選択順序保持） / Export shortlist to CSV/JSON | Public MVP |
| `search_bids_app` | MCP Apps UI付き検索ワークスペース (`ui://jp-bids/search-results.html`、単一HTMLバンドルUI) / Interactive search workspace with single-file HTML panel | Public MVP |

## Pricing / 料金 / Harga

| Plan | Price | Features |
|---|---|---|
| **Public MVP** | Free / 無料 / Gratis | All 7 public tools (search, recent, detail, rank, extract, export, search apps UI) |

完全無料・読み取り中心で提供されます。有料プランや月額課金、Stripe等の課金呼出しはありません。<br>
Completely free and read-centric. No paid tiers, monthly subscriptions, or billing calls.<br>
*(※利用者が利用する外部AIクライアント利用料や、自己ホスト時のクラウド費用は除きます / Excludes third-party AI client tokens or self-hosted cloud infrastructure costs)*

## Resources

- `attribution://kkj`
- `docs://api-reference`
- `codes://prefectures`
- `ui://jp-bids/search-results.html`
- `prefecture://{lg_code}`

## Verification

```bash
npm run build
npm test
node examples/mock-stdio-server.mjs
```

## Documentation

- API Reference: `npm run docs:api` (generates HTML in `docs/api`)
- Examples: `examples/mock-stdio-server.mjs`

## Interoperability / 相互運用 / Interoperabilitas

JP Bids MCP pairs with the [J-Grants MCP](https://github.com/digital-go-jp/jgrants-mcp-server) (Digital Agency of Japan) to cover both government contracts and grants in a single conversation.

```
# Search bids (JP Bids MCP) and grants (J-Grants MCP) simultaneously
"鹿児島県のITシステム調達案件と、中小企業向けDX補助金を同時に探してください。"
```

JP Bids MCP also pairs with [freee MCP](https://www.npmjs.com/package/freee-mcp) (freee K.K.) for procurement-to-accounting automation — financial readiness checks, post-award deal entries, and invoice generation from bid data.

> JP Bids MCP, J-Grants MCP, and freee MCP are independent servers operated by separate organizations. Results are reference information; always verify against official documents.

## Metadata & Specifications / 仕様とメタデータ区分

JP Bids MCP strictly distinguishes between official registry cataloging and runtime discovery endpoints:

1. **Official MCP Registry Manifest (`server.json`)**:
   - Conforms to `$schema: "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json"`.
   - Used by official package registries (`io.github.SUGUKURU-CO-LTD/jp-bids`) for server listing, repository verification, package transports, and interoperability declarations.
2. **Server Card Discovery Endpoint (`public/.well-known/mcp/server-card.json`)**:
   - Hosted at `/.well-known/mcp/server-card.json` for client endpoint introspection.
   - Supplies detailed JSON schemas for all 7 tools, authentication scheme definitions, and `_meta.ui` bindings for MCP Apps.

## Notes / 注意事項

このサーバーは入札情報の添付ファイルを保存しません。入札判断前に必ず公式調達書類を確認してください。  
This server does not store upstream documents or attachment files. Results are reference information and should be verified against official procurement documents before bidding decisions.

- [Privacy Policy / プライバシーポリシー](https://mcp.bid-jp.com/privacy)
- [Terms of Service / 利用規約](https://mcp.bid-jp.com/terms)
