# JP Bids MCP — 日本語ガイド

[![CI](https://github.com/SUGUKURU-CO-LTD/jp-bids-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/SUGUKURU-CO-LTD/jp-bids-mcp/actions/workflows/ci.yml)
[![CodeQL](https://github.com/SUGUKURU-CO-LTD/jp-bids-mcp/actions/workflows/codeql.yml/badge.svg)](https://github.com/SUGUKURU-CO-LTD/jp-bids-mcp/actions/workflows/codeql.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

日本の官公需入札情報をModel Context Protocol (MCP) で検索・順位付け・要件抽出・出力するサーバーです。完全無料・読み取り中心で7ツールを提供します。<br>
Search, rank, extract requirements, and export Japanese public procurement notices through MCP (free, read-centric, 7 tools).<br>
Server MCP untuk mencari, memeringkat, mengekstrak persyaratan, dan mengekspor pengumuman pengadaan pemerintah Jepang (gratis, read-centric, 7 tools).

> **完全無料・読み取り中心 / Free and Read-Centric**<br>
> 会員登録や有料プランなしで全公開機能（7ツール）を無料で利用できます。提供側によるStripe等の課金呼出しは一切行いません。<br>
> All 7 public tools are available for free without subscription or paid tiers.

---

### 公開状況と配信チャネル / Project Status & Release Channels

| 配信チャネル / 項目 | 状態 / Status | 説明 / 内容 |
|---|:---:|---|
| **GitHub オープンソース** | **公開中 (Active)** | [SUGUKURU-CO-LTD/jp-bids-mcp](https://github.com/SUGUKURU-CO-LTD/jp-bids-mcp) (Apache 2.0)。182件のテスト全件成功、CI・CodeQL合格、再現可能なオフラインモックデモ同梱。 |
| **ローカルモックデモ** | **実証済 (Verified)** | M1〜M3-Bの動作実証完了（検索、MCP AppsワークスペースUI描画、双方向ツール呼び出し）。 |
| **npm パッケージ** | **準備中 (Planned)** | パッケージ生成 (`npm pack`) 検証済み。公開版 (`jp-bids-mcp`) の配信は別途承認後に実施予定。 |
| **公式 MCP Registry** | **準備中 (Planned)** | 識別名 `io.github.SUGUKURU-CO-LTD/jp-bids` 準拠設定済み。レジストリ登録は別途承認後に実施予定。 |
| **リモート MCP エンドポイント** | **準備中 (Planned)** | Streamable HTTP エンドポイント (`https://mcp.bid-jp.com/mcp`) はホスティング環境構築後に公開予定。 |

---

## 現在の検証状況 / Current Verification Status

> [!IMPORTANT]
> **ステータス: ローカルモック実証完了 (M1〜M3-B) | 実データ接続・正式受入は準備中**
> - **Claude Desktopでのモック実証 (M1〜M3-B)**: **合格（実証完了）**。公開モックstdio起動スクリプト (`examples/mock-stdio-server.mjs`) を用いてオフラインXMLフィクスチャ (`tests/fixtures/kkj-search.xml`、`KKJ-TEST-001`) を注入し、Claude Desktop 内での動作を検証済み：
>   - **M1**: チャットからの入札検索 (`search_bids`) による構造化結果取得。
>   - **M2**: MCP Apps仕様 (`ui://jp-bids/search-results.html`) に基づくAI Bid Workspaceパネル画面の描画 (`search_bids_app`)。
>   - **M3-A**: 画面内での動的状態変化（案件選択チェックボックス、選択件数カウント、CSV/JSONエクスポートボタンの有効化）。
>   - **M3-B**: 画面からサーバーへの双方向ツール呼び出し（画面内検索実行による `search_bids_app` 呼び出し、2ms応答、画面再描画）。
>   *(※M1〜M3-Bの実証は、アプリケーション内のモック処理（`examples/mock-stdio-server.mjs`）によりKKJ APIリクエストをローカルXMLフィクスチャ応答に差し替え、未承認fetchを例外として遮断するガード下で実施されました。これはNode.jsランタイム内のアプリケーションレベルのモック・傍受処理であり、OSレベルのサンドボックスやネットワークファイアウォールによる通信遮断ではありません。検証期間中に外部KKJへの通信は観測されませんでした)*
> - **クリーン環境実機検証と自動テスト結果の区別**:
>   - **自動テスト群 (182件)**: 単体・結合テスト（型定義、セキュリティ制約、UIビューモデル・ハンドラー、モック通信）を Vitest により自動検証 (`npm test`)。
>   - **新規クローン環境実機検証**: 既存の開発環境とは完全に隔離された新規ディレクトリで `git clone` → `npm ci` → `npm run build` → 子プロセス起動を行い、`initialize`、7ツール登録 (`tools/list`)、モック案件取得 (`tools/call search_bids`)、MCP Apps UI MIME (`resources/read ui://jp-bids/search-results.html`) を検証。
>   - **Claude Desktop 実機接続**: Claude Desktop プロセスからの正常起動・接続および7ツールの登録を確認済み。デスクトップクライアント上でのチャット検索・UI描画・画面内操作（M2〜M3-B）の実機対話操作は、デスクトップ環境における手動操作・目視確認が必要であり、プログラム的テスト証拠とは区別して管理します。
> - **実KKJ API接続・Gate 1正式受入**: **準備中**。中小企業庁KKJ APIへの直接通信およびGate 1（35条件）の受入試験は、後続の検証フェーズで実施予定です。

---

## クイックスタート: ローカルモックデモ (推奨) / Quick Start

外部ネットワークアクセスを行わずに、Claude Desktop および MCP クライアントから直ちに動作確認を行える再現可能なローカルモックデモを提供しています。

> [!NOTE]
> **ネットワーク要件とモックの安全性**:
> - `git clone` および初回の依存関係インストール (`npm ci`) の実行にはインターネット接続が必要です。
> - 依存関係インストール後のローカルモックデモ実行 (`examples/mock-stdio-server.mjs`) では、**実KKJ APIへの外部アクセスは一切発生しません**。すべてローカルXMLフィクスチャ (`tests/fixtures/kkj-search.xml`、`KKJ-TEST-001`) を読み込んでオフラインで安全に応答します。
> - *(※これはNode.jsアプリケーションレベルで未承認fetchを例外遮断しローカルデータを返すモック処理であり、OSレベルのサンドボックスやネットワークファイアウォールによる通信遮断ではありません)*

### 1. クローンとビルド

再現性のため、依存関係インストールには `npm ci` を使用します：

```bash
git clone https://github.com/SUGUKURU-CO-LTD/jp-bids-mcp.git
cd jp-bids-mcp
npm ci
npm run build
npm test
```

> [!TIP]
> **Windows PowerShell をお使いの場合**:
> PowerShellのスクリプト実行ポリシーにより `npm.ps1` がブロックされる場合（`PSSecurityException`）は、`npm.cmd` を使用してください：
> ```bash
> npm.cmd ci
> npm.cmd run build
> npm.cmd test
> ```

### 2. Claude Desktop の設定

`claude_desktop_config.json` を編集します：

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows (通常インストーラー版)**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Windows (Microsoft Store / UWP 版)**: ストア版では設定ファイルがパッケージ固有の仮想化ディレクトリ配下にリダイレクトされる場合があります。すべての環境で同一のパスになるとは限りませんが、今回の検証環境（Windows 11）では以下のパスが確認されました（パス例）：
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

*(※ `/ABSOLUTE/PATH/TO/jp-bids-mcp` は実際のローカルリポジトリの絶対パスに置き換えてください。Windows環境でGUIアプリから環境変数PATHの `node` が解決できない場合は、有効な回避策として `node.exe` の絶対パス（例: `"C:\\Program Files\\nodejs\\node.exe"`）を指定してください)*

### 3. Claude Desktop で確認

Claude Desktop を再起動し、チャットで以下のように入力します：

```text
「鹿児島県の入札案件を検索して」
```

→ ローカルフィクスチャ `KKJ-TEST-001`（鹿児島市システム保守業務委託）が検索され、インタラクティブな **AI Bid Workspace** 画面 (`ui://jp-bids/search-results.html`) が開きます。画面内での案件選択チェック、スコアリング、双方向検索が即座に動作します。

---

## 通常ローカル起動 / Standard Local Runtime

> [!WARNING]
> **実APIアクセスに関する注意**:
> - `node dist/server.js` は本番用の通常ビルドであり、**モックサーバーではありません**。
> - このモードでツールを実行すると、中小企業庁「官公需情報ポータルサイト」の公式API (`http://www.kkj.go.jp/api/`) へ実際にHTTP通信が発生する可能性があります。
> - 事前検証時や不要・未承認の実アクセスを避けたい場合は、必ずモックデモ (`examples/mock-stdio-server.mjs`) を使用してください。

ビルド済みの通常サーバープロセスをローカルで起動する場合の設定例です：

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

CLI バージョン確認:
```bash
node dist/server.js --version
```

---

## 今後の配信予定チャネル / Planned Deployment Channels

以下の公開・配信経路はメタデータおよびマニフェスト準備済みであり、個別のリリース承認を経て順次公開されます：

### 1. 公開 npm パッケージ
npm レジストリへの公開後は、`npx` コマンドで直接実行可能になります：
```bash
# (npm 公開後に利用可能予定)
npx -y jp-bids-mcp
```

### 2. リモート Streamable HTTP エンドポイント
ホスティング環境へのデプロイ完了後は、リモートMCPクライアント（Claude.ai、ChatGPT等）から OAuth 2.0 経由で接続可能になります：
```text
https://mcp.bid-jp.com/mcp
```
*(Dynamic Client Registration + PKCE S256 による OAuth 2.0 認可が必要です)*

---

## 主な機能 / What It Provides

- **官公需入札情報の読み取り専用検索**: キーワード、自治体・地域、業種による入札公告の高速検索。
- **AI Bid Radar**: 案件を自社の強みや条件に合わせて比較採点・順位付け (`rank_bids`)。
- **要件・提出書類抽出**: 公告メタデータから参加資格・提出書類・要件チェックリストを自動構造化抽出 (`extract_bid_requirements`)。※外部PDF抽出は既定OFF。
- **MCP Apps UI (`search_bids_app`)**: Claude Desktop 内で動作する対話型ワークスペース画面 (`ui://jp-bids/search-results.html`)。単一HTMLファイルにインラインバンドルされ、CSP (`connectDomains: []`, `resourceDomains: []`) 設定により外部アセット読み込みを厳格制限。画面内での絞り込み、選択、双方向ツール呼び出しに対応。
- **ショートリスト出力 (`export_bid_shortlist`)**: 選択した案件をCSV / JSON形式でエクスポート（選択順序を保持）。
- **完全無料・読み取り専用**: 会員登録や有料プランなしで全公開機能（7ツール）を無料で利用可能。提供側の課金（Stripe等）は一切行いません。
- **Resources・Resource Templates**: コンテキスト注入用の静的リソースおよび動的テンプレート。
- **安全設計**: 添付ファイルの一時保存なし、トークンバケット型レート制限 (<= 1 req/sec)、stdoutへのログ出力完全排除（stderrのみ）。

データ出典: 中小企業庁 官公需情報ポータルサイト 検索API.

---

## ツール一覧 (Public MVP: 7 ツール)

| ツール / Tool | 説明 / Description | プロファイル |
|---|---|---|
| `search_bids` | キーワード・地域・業種で検索 / Keyword, region & category search | Public MVP |
| `list_recent_bids` | 直近の公告一覧（過去1〜30日） / Recent notices (past 1–30 days) | Public MVP |
| `get_bid_detail` | 案件詳細取得 / Bid detail | Public MVP |
| `rank_bids` | 自社条件でスコアリング・順位付け / Score & rank by your criteria | Public MVP |
| `extract_bid_requirements` | 要件・提出書類・資格の抽出（外部抽出既定OFF） / Requirement extraction | Public MVP |
| `export_bid_shortlist` | CSV/JSONエクスポート（選択順序保持） / Export shortlist to CSV/JSON | Public MVP |
| `search_bids_app` | MCP Apps UI付き検索ワークスペース (`ui://jp-bids/search-results.html`) / Interactive search workspace with single-file HTML panel | Public MVP |

---

## MCP 仕様対応状況 / Protocol & Specification Support

JP Bids MCP は Model Context Protocol の標準仕様に基づき実装および自動テスト検証されています：

- **Protocol Version**: `2025-11-25` を正式サポート（ヘッダー受け入れ検証済み）。将来の仕様拡張も順次追従予定。
- **Header Mismatch Validation**: `Mcp-Method` / `Mcp-Name` ヘッダーが存在する場合、JSON-RPC body との不一致を厳格に拒否。
- **OAuth 2.0 Security**: OAuth authorization response および JWT に RFC 9207 `iss` パラメータを含める堅牢な認可仕様をサポート。
- **MCP Apps Extension**: `@modelcontextprotocol/ext-apps` (v1.7.4) に基づく安全なインライン UI 配信。

---

## リソース一覧 / Resources

- `attribution://kkj`: 中小企業庁 官公需情報ポータルサイト データ出典および免責条項
- `docs://api-reference`: 7ツールの API リファレンス
- `codes://prefectures`: 都道府県コード一覧
- `ui://jp-bids/search-results.html`: MCP Apps AI Bid Workspace UI リソース
- `prefecture://{lg_code}`: 自治体別入札情報テンプレート

---

## 検証・テストコマンド / Verification & Testing

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

## 相互運用 / Interoperability

JP Bids MCP は、日本の行政データ・業務系 MCP サーバーとの親和性を考慮して設計されています：

- **J-Grants MCP** (デジタル庁): 入札案件（JP Bids MCP）と補助金・助成金（J-Grants MCP）を同一会話内でシームレスに横断検索。
- **freee MCP** (freee株式会社): 落札後の取引登録、請求書発行、会計連携との自動化パイプライン。

> *(注: JP Bids MCP、J-Grants MCP、freee MCP はそれぞれ別組織によって開発・運用されている独立したサーバーです。入札判断前に必ず公式調達書類をご確認ください)*

---

## 仕様とメタデータ区分 / Metadata & Specifications

- **公式 MCP Registry 定義 (`server.json`)**:
  - `$schema: "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json"` 準拠。
  - レジストリ識別名: `io.github.SUGUKURU-CO-LTD/jp-bids`
- **Server Card ディスカバリ定義 (`public/.well-known/mcp/server-card.json`)**:
  - 公開 7 ツールの JSON Schema、認証スキーム、および MCP Apps UI バインディングを定義。

---

## 注意事項 / Notes

このサーバーは入札情報の添付ファイルを保存しません。入札判断前に必ず公式調達書類を確認してください。<br>
This server does not store upstream documents or attachment files. Results are reference information and should be verified against official procurement documents before bidding decisions.

- [プライバシーポリシー / Privacy Policy](https://github.com/SUGUKURU-CO-LTD/jp-bids-mcp/blob/main/public/privacy.html)
- [利用規約 / Terms of Service](https://github.com/SUGUKURU-CO-LTD/jp-bids-mcp/blob/main/public/terms.html)
- [ライセンス / License: Apache-2.0](https://github.com/SUGUKURU-CO-LTD/jp-bids-mcp/blob/main/LICENSE)

