# JP Bids MCP

[![CI](https://github.com/SUGUKURU-CO-LTD/jp-bids-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/SUGUKURU-CO-LTD/jp-bids-mcp/actions/workflows/ci.yml)
[![CodeQL](https://github.com/SUGUKURU-CO-LTD/jp-bids-mcp/actions/workflows/codeql.yml/badge.svg)](https://github.com/SUGUKURU-CO-LTD/jp-bids-mcp/actions/workflows/codeql.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

日本の官公需入札情報をMCPで検索・順位付け・要件抽出・出力するサーバー。完全無料・読み取り中心で7ツールを提供します。<br>
Search, rank, extract requirements, and export Japanese public procurement notices through MCP (free, read-centric, 7 tools).<br>
Server MCP untuk mencari, memeringkat, mengekstrak persyaratan, dan mengekspor pengumuman pengadaan pemerintah Jepang (gratis, read-centric, 7 tools).

> **完全無料・読み取り中心 / Free and Read-Centric**<br>
> 会員登録・有料プランなしで全公開機能（7ツール）を無料で利用できます。Stripe等の課金呼出しは行いません。<br>
> All 7 public tools are available for free without subscription or paid tiers.

---

### Project Status & Release Channels / 公開状況と配信チャネル

| Channel / 項目 | Status / 状態 | Description / 内容 |
|---|:---:|---|
| **GitHub Open Source** | **Active (公開中)** | [SUGUKURU-CO-LTD/jp-bids-mcp](https://github.com/SUGUKURU-CO-LTD/jp-bids-mcp) (Apache 2.0). 182 tests, CI/CodeQL pass, reproducible offline mock demo. |
| **Local Mock Demo** | **Verified (実証済)** | Offline M1–M3-B verification (search, MCP Apps workspace UI, bidirectional tool calls). |
| **npm Package** | **Planned (準備中)** | Packaging (`npm pack`) validated; publication (`jp-bids-mcp`) pending separate release approval. |
| **Official MCP Registry** | **Planned (準備中)** | Namespace `io.github.SUGUKURU-CO-LTD/jp-bids` configured; registry listing pending separate approval. |
| **Remote MCP Endpoint** | **Planned (準備中)** | Streamable HTTP endpoint (`https://mcp.bid-jp.com/mcp`) planned for hosted deployments. |

> 💡 **Public Technical Showcase / 実機デモ技術解説**:  
> Claude Desktop 内で動作する MCP Apps 対話型ワークスペースの実機スクリーンショット、アーキテクチャ解説、および再現手順は [**docs/showcase/README.md**](https://github.com/SUGUKURU-CO-LTD/jp-bids-mcp/blob/main/docs/showcase/README.md) をご覧ください。<br>
> See [**docs/showcase/README.md**](https://github.com/SUGUKURU-CO-LTD/jp-bids-mcp/blob/main/docs/showcase/README.md) for real-device screenshots, architectural deep-dives, and offline reproduction guides of the interactive MCP Apps workspace running inside Claude Desktop.

---

## Current Verification Status / 検証状況

> [!IMPORTANT]
> **Status: Local Mock Validated (M1–M3-B) | Live KKJ Connection in Preparation**
> - **Claude Desktop Mock Verification (M1–M3-B)**: **PASSED (実証完了)**. Verified inside Claude Desktop using the local mock stdio launcher script (`examples/mock-stdio-server.mjs`) injecting offline XML fixtures (`tests/fixtures/kkj-search.xml`, `KKJ-TEST-001`):
>   - **M1**: Search bids via chat (`search_bids`) returning structured results.
>   - **M2**: Interactive UI workspace rendering (`search_bids_app`) via MCP Apps specification (`ui://jp-bids/search-results.html`).
>   - **M3-A**: In-app interactive state changes (row selection, selection counts, CSV/JSON export button activation).
>   - **M3-B**: Bidirectional UI-to-server tool invocation (in-app search calling `search_bids_app` returning in 2ms and updating UI).
>   *(Note: M1–M3-B verification was performed via an in-application mock interceptor (`examples/mock-stdio-server.mjs`) resolving KKJ API requests with local XML fixtures and guarding runtime `fetch` calls. This is an application-level runtime mock, not an OS-level sandbox or network firewall isolation. No external KKJ network traffic was observed during verification).*
> - **Clean Clone Reproduction vs. Automated Tests**:
>   - **Automated Tests**: 182 Vitest unit/integration tests (`npm test`) verify server schemas, security constraints, UI view models, and protocol invariants.
>   - **Clean Clone Stdio Verification**: Reproducibility verified on a separate, newly cloned directory without development caches (`npm ci` → `npm run build` → stdio handshake), proving 7-tool registration, mock search response (`KKJ-TEST-001`), and MCP Apps UI HTML bundle retrieval.
>   - **Desktop App Verification**: Process launch, connection, and 7-tool registration confirmed in Claude Desktop. In-app interactive GUI actions (M2–M3-B) require manual user operation in desktop clients and are tracked distinct from programmatic test evidence.
> - **Live KKJ Connection & Gate 1 Acceptance**: **IN PREPARATION (準備中)**. Direct queries to the Small and Medium Enterprise Agency KKJ API and formal Gate 1 compliance acceptance (35 test conditions) are scheduled for subsequent verification phases.

---

## Quick Start: Local Mock Demo (Recommended) / クイックスタート

誰でもネットワークアクセスなしで Claude Desktop および MCP クライアントから直ちに動作検証を行える、再現可能なローカルモックデモを提供しています。

To safely evaluate JP Bids MCP and reproduce the interactive MCP Apps workspace UI offline without live network dependencies:

> [!NOTE]
> **Network Requirements & Mock Safety**:
> - An active internet connection is required for `git clone` and the initial dependency installation via `npm ci`.
> - Once dependencies are installed, running the local mock demo (`examples/mock-stdio-server.mjs`) performs **no external network requests to the live KKJ API**; all responses are served offline using local XML fixtures (`tests/fixtures/kkj-search.xml`, `KKJ-TEST-001`).
> - *(Note: This mock uses application-level request interception within Node.js to guard runtime fetch calls and resolve local fixtures. It is not an OS-level sandbox or network firewall isolation).*

### 1. Clone & Build / リポジトリのビルド

For reproducible builds, use `npm ci` to install pinned dependencies:

```bash
git clone https://github.com/SUGUKURU-CO-LTD/jp-bids-mcp.git
cd jp-bids-mcp
npm ci
npm run build
npm test
```

> [!TIP]
> **Windows PowerShell Users**:
> If script execution is restricted by PowerShell policy (`PSSecurityException` on `npm.ps1`), execute with `npm.cmd` instead:
> ```bash
> npm.cmd ci
> npm.cmd run build
> npm.cmd test
> ```

### 2. Configure Claude Desktop / Claude Desktop 設定

Edit your `claude_desktop_config.json`:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows (Standard installer)**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Windows (Microsoft Store / UWP edition)**: In Store distributions, configuration files may be virtualized under a package-specific directory. While package identifiers can vary across installations, the following path was observed in our Windows 11 verification environment as an observed path example:
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

*(Replace `/ABSOLUTE/PATH/TO/jp-bids-mcp` with your actual local repository path. On Windows, if `node` is not resolved by the GUI process from environment PATH, specifying the absolute path to `node.exe`, e.g., `"C:\\Program Files\\nodejs\\node.exe"`, is a recommended workaround).*

### 3. Ask Claude / AIに話しかける

Restart Claude Desktop, and ask:

```text
「鹿児島県の入札案件を検索して」
```

→ ローカルフィクスチャ `KKJ-TEST-001`（鹿児島市システム保守業務委託）が検索され、インタラクティブな **AI Bid Workspace** 画面 (`ui://jp-bids/search-results.html`) が開きます。画面内でのチェック選択、スコアリング、双方向検索が即座に動作します。

---

## Standard Local Runtime / 通常ローカル起動

> [!WARNING]
> **Live API Access Notice**:
> - `node dist/server.js` is the standard production server build, **not a mock server**.
> - Executing tools in this mode may initiate real HTTP network requests to the official SME Agency KKJ API (`http://www.kkj.go.jp/api/`).
> - To avoid unapproved live API traffic or rate limit consumption during local evaluation, use the mock demo (`examples/mock-stdio-server.mjs`) instead.

If you wish to run the standard build server directly:

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

CLI version check:
```bash
node dist/server.js --version
```

---

## Planned Deployment Channels (Coming Soon) / 今後の配信予定

The following production channels are prepared in manifests and will be opened following separate release approvals:

### 1. Published npm Package
Once published to the npm registry, execution will be available directly via `npx`:
```bash
# (Planned post-npm release)
npx -y jp-bids-mcp
```

### 2. Remote Streamable HTTP Endpoint
Once the hosted environment is deployed, remote MCP clients (Claude.ai, ChatGPT, etc.) will connect via OAuth 2.0:
```text
https://mcp.bid-jp.com/mcp
```
*(Requires OAuth 2.0 with Dynamic Client Registration + PKCE S256).*

---

## What It Provides / 主な機能

- **官公需入札情報の読み取り専用検索**: Read-only search for Japanese public procurement notices.
- **AI Bid Radar**: 案件を実務優先度でスコアリング・ランキング (`rank_bids`)。
- **要件・提出書類抽出**: 案件メタデータから参加要件・提出書類・資格を構造化抽出 (`extract_bid_requirements`)。※外部PDF抽出は既定OFF。
- **MCP Apps UI (`search_bids_app`)**: Claude Desktop 内で動作する対話型ワークスペース画面 (`ui://jp-bids/search-results.html`)。単一HTMLファイルにインラインバンドルされ、CSP (`connectDomains: []`, `resourceDomains: []`) 設定により外部アセット読み込みを厳格制限。画面内での絞り込み、選択、双方向ツール呼び出しに対応。
- **ショートリスト出力 (`export_bid_shortlist`)**: 選択した案件をCSV / JSON形式でエクスポート。
- **完全無料・読み取り専用**: 会員登録や有料プランなしで全公開機能（7ツール）を無料で利用可能。提供側の課金（Stripe等）は一切行いません。
- **Resources・Resource Templates**: コンテキスト注入用の静的リソースおよび動的テンプレート。
- **安全設計**: 添付ファイルの一時保存なし、トークンバケット型レート制限 (<= 1 req/sec)、stdoutへのログ出力完全排除（stderrのみ）。

データ出典 / Data source: 中小企業庁 官公需情報ポータルサイト 検索API.

---

## Tools / ツール一覧 (Public MVP: 7 ツール)

| ツール / Tool | 説明 / Description | Profile |
|---|---|---|
| `search_bids` | キーワード・地域・業種で検索 / Keyword, region & category search | Public MVP |
| `list_recent_bids` | 直近の公告一覧（過去1〜30日） / Recent notices (past 1–30 days) | Public MVP |
| `get_bid_detail` | 案件詳細取得 / Bid detail | Public MVP |
| `rank_bids` | 自社条件でスコアリング・順位付け / Score & rank by your criteria | Public MVP |
| `extract_bid_requirements` | 要件・提出書類・資格の抽出（外部抽出既定OFF） / Requirement extraction | Public MVP |
| `export_bid_shortlist` | CSV/JSONエクスポート（選択順序保持） / Export shortlist to CSV/JSON | Public MVP |
| `search_bids_app` | MCP Apps UI付き検索ワークスペース (`ui://jp-bids/search-results.html`) / Interactive search workspace with single-file HTML panel | Public MVP |

---

## Protocol & Specification Support / MCP 仕様対応状況

JP Bids MCP は Model Context Protocol の標準仕様に基づき実装および自動テスト検証されています：

- **Protocol Version**: `2025-11-25` を正式サポート（ヘッダー受け入れ検証済み）。将来の仕様拡張も順次追従予定。
- **Header Mismatch Validation**: `Mcp-Method` / `Mcp-Name` ヘッダーが存在する場合、JSON-RPC body との不一致を厳格に拒否。
- **OAuth 2.0 Security**: OAuth authorization response および JWT に RFC 9207 `iss` パラメータを含める堅牢な認可仕様をサポート。
- **MCP Apps Extension**: `@modelcontextprotocol/ext-apps` (v1.7.4) に基づく安全なインライン UI 配信。

---

## Resources / リソース一覧

- `attribution://kkj`: 中小企業庁 官公需情報ポータルサイト データ出典および免責条項
- `docs://api-reference`: 7ツールの API リファレンス
- `codes://prefectures`: 都道府県コード一覧
- `ui://jp-bids/search-results.html`: MCP Apps AI Bid Workspace UI リソース
- `prefecture://{lg_code}`: 自治体別入札情報テンプレート

---

## Verification & Testing / 検証コマンド

```bash
# 全体チェック (Biome Lint, TypeScript型検査, Vite UIビルド, Vitest 182テスト全件)
npm run check

# TypeDoc API ドキュメント生成・差分検査 (Windows & Linux 両対応)
npm run docs:check

# 本番実行時依存のセキュリティ監査 (脆弱性 0 件)
npm audit --omit=dev

# オフラインモック stdio 単体検証テスト
npx vitest run tests/mock-stdio-verification.test.ts
```

---

## Interoperability / 相互運用

JP Bids MCP は、日本の行政データ・業務系 MCP サーバーとの親和性を考慮して設計されています：

- **J-Grants MCP** (デジタル庁): 入札案件（JP Bids MCP）と補助金・助成金（J-Grants MCP）を同一会話内でシームレスに横断検索。
- **freee MCP** (freee株式会社): 落札後の取引登録、請求書発行、会計連携との自動化パイプライン。

> *(注: JP Bids MCP、J-Grants MCP、freee MCP はそれぞれ別組織によって開発・運用されている独立したサーバーです。入札判断前に必ず公式調達書類をご確認ください)*

---

## Metadata & Specifications / 仕様とメタデータ区分

- **Official MCP Registry Manifest (`server.json`)**:
  - `$schema: "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json"` 準拠。
  - レジストリ識別名: `io.github.SUGUKURU-CO-LTD/jp-bids`
- **Server Card Discovery (`public/.well-known/mcp/server-card.json`)**:
  - 公開 7 ツールの JSON Schema、認証スキーム、および MCP Apps UI バインディングを定義。

---

## Notes / 注意事項

このサーバーは入札情報の添付ファイルを保存しません。入札判断前に必ず公式調達書類を確認してください。<br>
This server does not store upstream documents or attachment files. Results are reference information and should be verified against official procurement documents before bidding decisions.

- [Privacy Policy / プライバシーポリシー](https://github.com/SUGUKURU-CO-LTD/jp-bids-mcp/blob/main/public/privacy.html)
- [Terms of Service / 利用規約](https://github.com/SUGUKURU-CO-LTD/jp-bids-mcp/blob/main/public/terms.html)
- [License: Apache-2.0](https://github.com/SUGUKURU-CO-LTD/jp-bids-mcp/blob/main/LICENSE)

