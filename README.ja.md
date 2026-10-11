# JP Bids MCP — 日本語ガイド

[![Smithery](https://smithery.ai/badge/a-kabe-1qio/jp-bids-mcp)](https://smithery.ai/servers/a-kabe-1qio/jp-bids-mcp)

## 概要 / Overview / Gambaran Umum

JP Bids MCP は、中小企業庁「官公需情報ポータルサイト」の入札情報をModel Context Protocolで検索・順位付け・要件抽出・出力するサーバーです。完全無料・読み取り中心で7ツールを提供します。

JP Bids MCP is an MCP server for searching, ranking, extracting requirements, and exporting Japanese government procurement notices from the SME Agency's KKJ portal (free, read-centric, 7 tools).

JP Bids MCP adalah server MCP untuk mencari, memeringkat, mengekstrak persyaratan, dan mengekspor pengumuman pengadaan pemerintah Jepang dari portal KKJ (gratis, read-centric, 7 tools).

> **完全無料・読み取り中心 / Free and Read-Centric**<br>
> 会員登録・有料プランなしで全公開機能（7ツール）を無料で利用できます。Stripe等の課金呼出しは行いません。<br>
> All 7 public tools are available for free without subscription or paid tiers.

## 現在のステータスと検証状況

> [!IMPORTANT]
> **ステータス: ローカルモック実証完了 (M1〜M3-B) | 実データ接続・正式受入は未完了（移行中）**
> - **Claude Desktopでのモック実証 (M1〜M3-B)**: **合格（実証完了）**。公開モックstdio起動スクリプト (`examples/mock-stdio-server.mjs`) を用いてローカルXMLフィクスチャ (`tests/fixtures/kkj-search.xml`、`KKJ-TEST-001`) を注入し、Claude Desktop 内での動作を検証済み：
>   - **M1**: チャットからの入札検索 (`search_bids`) による構造化結果取得。
>   - **M2**: MCP Apps仕様 (`ui://jp-bids/search-results.html`) に基づくAI Bid Workspaceパネル画面の描画 (`search_bids_app`)。
>   - **M3-A**: 画面内での動的状態変化（案件選択チェックボックス、選択件数カウント、CSV/JSONエクスポートボタンの有効化）。
>   - **M3-B**: 画面からサーバーへの双方向ツール呼び出し（画面内検索実行による `search_bids_app` 呼び出し、2ms応答、画面再描画）。
>   *(※M1〜M3-Bの実証は、アプリケーション内のモック処理（`examples/mock-stdio-server.mjs`）によりKKJ APIリクエストをローカルXMLフィクスチャ応答に差し替え、未承認fetchを例外として遮断するガード下で実施されました。これはNode.jsランタイム内のアプリケーションレベルのモック・傍受処理であり、OSレベルのサンドボックスやネットワークファイアウォールによる通信遮断ではありません。検証期間中に外部KKJへの通信は観測されませんでした)*
> - **実KKJ API接続・Gate 1正式受入**: **未完了・移行中**。中小企業庁KKJ APIへの直接通信およびGate 1（35条件）の受入試験は、次フェーズ（M4）で実施予定です。
>
> **モックデモと通常起動経路の区別**:
> - **公開モックデモ (`examples/mock-stdio-server.mjs`)**: M1〜M3-Bの実証再現・UI動作確認・オフライン検証用。ローカルXMLフィクスチャ (`tests/fixtures/kkj-search.xml`、`KKJ-TEST-001`) を注入し、外部通信を行わずにMCP Apps UIを操作可能。（アプリケーションレベルのモック処理。OSレベルの通信遮断ではありません）。
> - **通常ローカル起動 (`node dist/server.js`)**: 通常実行モード。設定に応じて中小企業庁KKJ API (`http://www.kkj.go.jp/api/`) へアクセスします。厳格なトークンバケット型レート制限 (<= 1 req/sec)、PDF/XML添付ファイルの未保存、stdoutへのログ出力完全排除（stderrのみ）を徹底します。
> - **公開npmパッケージ (`npx -y jp-bids-mcp`) / リモートMCP (`https://mcp.bid-jp.com/mcp`)**: 公開通常経路。

## AIに話しかけるだけ

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

## クイックスタート / Quick Start / Mulai Cepat

```text
リモートMCP: https://mcp.bid-jp.com/mcp
npm:         jp-bids-mcp
Registry metadata name: io.github.SUGUKURU-CO-LTD/jp-bids
```

### Claude.ai / ChatGPT / MCP対応クライアント

```text
https://mcp.bid-jp.com/mcp
```

リモートエンドポイントは OAuth 2.0 必須です。`Authorization` ヘッダーなしのリクエストには `401` と `WWW-Authenticate: Bearer resource_metadata="https://mcp.bid-jp.com/.well-known/oauth-protected-resource/mcp"` が返ります。Claude.ai / ChatGPT / MCP Inspector は Dynamic Client Registration と PKCE(S256) で認可フローを自動的に処理するため、承認ボタンを押すだけで接続できます。`curl` で直接叩く場合はトークンが必要です。認証なしで試したいときは下のローカル stdio を使ってください。

The remote endpoint requires OAuth 2.0; MCP clients run the flow automatically. Use local stdio below to try without authentication.

Endpoint jarak jauh memerlukan OAuth 2.0; klien MCP menjalankan alurnya secara otomatis. Gunakan stdio lokal di bawah untuk mencoba tanpa autentikasi.

### ローカル stdio（認証不要）

```bash
npx --yes jp-bids-mcp
```

### CSVエクスポート

```bash
npx --yes jp-bids-export --prefecture 鹿児島県 --category 役務 --query システム > bids.csv
```

### Claude Desktop 設定例

#### 1. ローカル stdio（`claude_desktop_config.json`）

**A. 公開モックデモ（M1〜M3-Bのオフライン再現・検証用）:**
> [!TIP]
> 外部KKJ通信を行わずに Claude Desktop 内での M1〜M3-B（MCP Apps UIと双方向通信）の実証を安全に再現するには、リポジトリをビルドし公開モック起動スクリプトを使用します：

1. リポジトリをクローンしてビルド:
   ```bash
   git clone https://github.com/SUGUKURU-CO-LTD/jp-bids-mcp.git
   cd jp-bids-mcp
   npm install
   npm run build
   ```
2. `claude_desktop_config.json` に設定を追加:
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
   *(※ `/path/to/jp-bids-mcp` は実際のローカル絶対パスに置き換えてください)*
3. Claude Desktopを再起動し、チャットで以下のように話しかけます：
   ```text
   「鹿児島県の入札案件を検索して」
   ```
   モックサーバーがローカルフィクスチャ (`tests/fixtures/kkj-search.xml`) から案件 `KKJ-TEST-001`（鹿児島市システム保守業務委託）を返し、対話型 AI Bid Workspace パネルが描画されます。画面内での案件選択や再検索もモック内で双方向動作します。
   *(※これはアプリケーションレベルでリクエストを傍受しローカルデータを返すモック処理であり、OSレベルのサンドボックスではありません)*

**B. 通常ローカル起動（Node.jsビルド）:**
> [!NOTE]
> `node dist/server.js` はサーバーの通常起動経路です。モックデモ用スクリプトとは異なり、設定に応じて実KKJ APIへのアクセスを伴い得る通常モードで動作します：

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

**C. 通常公開パッケージ（npx起動）:**
> [!WARNING]
> `npx -y jp-bids-mcp` はモックデモではなく、公開レジストリ上のnpmパッケージを通常モードで起動します（実KKJアクセスを伴い得ます）。また、ローカルの未コミットPublic MVP作業コピーともバージョンが異なる場合があります：

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

*(注: 設定ファイルに個人のWindows絶対パスや秘密情報を直接記述しないでください)*

#### 2. リモートカスタムコネクタ（Claude.ai / Claude Desktop）

リモートエンドポイントは、`claude_desktop_config.json` ではなくAnthropic公式のカスタムコネクタ機能から設定します：

1. Claude（Claude.ai または Claude Desktop）を開きます。
2. **設定（Customize） → コネクタ（Connectors）** を選択します。
3. **カスタムコネクタを追加** を押し、URLを入力します：
   ```text
   https://mcp.bid-jp.com/mcp
   ```
4. OAuth 2.0 で認可を完了します（Dynamic Client Registration + PKCE S256）。

## ツール一覧 / Tools / Daftar Alat

| ツール | 説明 | プロファイル |
|---|---|---|
| `search_bids` | キーワード・地域・業種で検索 | Public MVP |
| `list_recent_bids` | 直近の公告一覧（過去1〜30日） | Public MVP |
| `get_bid_detail` | 案件詳細取得 | Public MVP |
| `rank_bids` | 自社条件でスコアリング・順位付け | Public MVP |
| `extract_bid_requirements` | 要件・提出書類・資格の抽出（外部抽出既定OFF） | Public MVP |
| `export_bid_shortlist` | CSV/JSONエクスポート（選択順序保持） | Public MVP |
| `search_bids_app` | MCP Apps UI付き検索ワークスペース (`ui://jp-bids/search-results.html`、単一HTMLバンドルUI) | Public MVP |

## 料金 / Pricing / Harga

| プラン | 料金 | 機能 |
|---|---|---|
| **公開MVP (Public MVP)** | 無料 (Free) | 公開7ツール（検索・新着一覧・詳細・ランキング・要件抽出・CSV/JSON出力・検索App） |

会員登録・有料プランなしで全公開機能（7ツール）を無料で利用できます。Stripe等の課金呼出しは行いません。<br>
*(※外部AIクライアント利用料や自己ホスト時のクラウド費用は除きます)*

## データ出典

中小企業庁 官公需情報ポータルサイト 検索API。このサーバーは入札情報の添付ファイルを保存しません。入札決定前に必ず公式調達書類を確認してください。

## 相互運用 / Interoperability / Interoperabilitas

JP Bids MCPは[Jグランツ MCP](https://github.com/digital-go-jp/jgrants-mcp-server)（デジタル庁）と連携することで、入札と補助金をひとつの会話で扱えます。

```
# 入札（JP Bids MCP）と補助金（Jグランツ MCP）を同時に探す
"鹿児島県のITシステム調達案件と、中小企業向けDX補助金を同時に探してください。"
```

JP Bids MCPは[J-Grants MCP](https://github.com/digital-go-jp/jgrants-mcp-server)（デジタル庁）や[freee MCP](https://www.npmjs.com/package/freee-mcp)（freee株式会社）とも連携でき、入札・補助金の横断検索や入札→会計処理の自動化（資金余力確認、落札後の売上取引登録、請求書生成）が可能です。

> JP Bids MCP・Jグランツ MCP・freee MCPはそれぞれ別組織が運営する独立サーバーです。結果は参考情報であり、必ず公式書類で確認してください。

## メタデータと仕様準拠

JP Bids MCP は、公式レジストリ向けカタログ定義と、サーバー自身のディスカバリ用エンドポイントを明確に区別しています：

1. **公式 MCP Registry 定義 (`server.json`)**:
   - 公式スキーマ `$schema: "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json"` に準拠。
   - パッケージレジストリ登録 (`io.github.SUGUKURU-CO-LTD/jp-bids`)、リポジトリ検証、stdioパッケージ指定、相互運用情報を提供。
2. **Server Card ディスカバリ定義 (`public/.well-known/mcp/server-card.json`)**:
   - `/.well-known/mcp/server-card.json` に配置され、クライアントによるツールスキーマ詳細取得・認証方式確認・`_meta.ui` バインディング（MCP Apps対応）を提供。

## ポリシー / Policies / Kebijakan

- [プライバシーポリシー / Privacy Policy](https://mcp.bid-jp.com/privacy)
- [利用規約 / Terms of Service](https://mcp.bid-jp.com/terms)
