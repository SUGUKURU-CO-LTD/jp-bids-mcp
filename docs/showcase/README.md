# JP Bids MCP — Public Technical Showcase: MCP Apps Cross-Client Demonstration

English technical overview is available below the Japanese section.  
本ドキュメントは、公式 MCP SDK および MCP Apps 拡張仕様を採用した官公需入札検索 MCP サーバー（JP Bids MCP）が、Claude Desktop（ローカル stdio 接続）および ChatGPT（OpenAI Secure MCP Tunnel 接続）の双方において、同一のコードベースから対話型 GUI ワークスペース（AI Bid Workspace）として動作することを実証した技術 Showcase です。

---

## 1. 概要 (Executive Summary)

### 日本語
JP Bids MCP（公開リポジトリ: `SUGUKURU-CO-LTD/jp-bids-mcp`）は、経済産業省中小企業庁の官公需情報ポータルサイト（KKJ）の入札公告情報を検索・分析・活用するための Model Context Protocol (MCP) サーバーです。

本プロジェクトでは、従来の「テキストや JSON を返すだけの MCP ツール」にとどまらず、MCP Apps 拡張仕様（`@modelcontextprotocol/ext-apps`）を実装することで、LLM クライアント（Claude Desktop および ChatGPT）内に **対話型 HTML ワークスペース（AI Bid Workspace）を直接描画・双方向操作できるアーキテクチャ** を実現しました。

本ドキュメントでは、開発者が自身の環境でローカルモックを用いた動作確認を行えるよう、自己検証結果に基づく**実機スクリーンショット**、**クロスクライアント検証マトリクス**、**アーキテクチャ解説**、**ソースコード照合**、および **客観的検証結果** を公開します。なお、外部の独立した第三者による再現性検証および実 KKJ API への本番アクセス試験は現時点で未実施です。

### English Summary
JP Bids MCP demonstrates an advanced cross-client implementation of the **Model Context Protocol (MCP) and MCP Apps extension specification** (`@modelcontextprotocol/ext-apps`). It enables both Claude Desktop (via local stdio) and ChatGPT (via OpenAI Secure MCP Tunnel) to render and interact with the identical self-contained, interactive HTML/React workspace directly within their chat interfaces from a single unified server codebase.

Rather than only returning flat text or JSON arrays, the server registers both structured tools and UI resources (`text/html;profile=mcp-app`), allowing bidirectional tool execution between the embedded GUI and the MCP server via the host application. This showcase provides self-verified real-device screenshots from both hosts, architectural breakdowns, offline mock reproduction procedures, and test evidence. Note that live KKJ API access and independent third-party verification have not yet been conducted.

---

## 2. 実機デモ Showcase (Verified Interactive Demonstration)

### 2.1. Claude Desktop 実機デモ (M1〜M3-B)

以下の画面は、Windows 11 上の Claude Desktop において、ローカルモックサーバー（`examples/mock-stdio-server.mjs`）を接続して実際に操作・検証されたものです。

> [!NOTE]
> **実機キャプチャの取り扱いについて**
> - すべてのスクリーンショットは未加工（個人情報保護のための枠取り・トリミングのみ、描画内容の改変なし）の実際の実機画面です。
> - 表示されているデータは、`tests/fixtures/kkj-search.xml` によるローカルモックデータ（`KKJ-TEST-001`）であり、実 KKJ API との外部通信は行われていません。

---

#### Step 1 (M1 & M2): チャット指示からのインライン Workspace 描画

LLM チャットに対して自然言語で入札検索を指示すると、Claude が `search_bids_app` ツールを選択・実行します。サーバーは構造化サマリーテキストを返すと同時に、メタデータで指定された UI リソース（`ui://jp-bids/search-results.html`）を Claude が読み込み、チャットの応答上部に **AI Bid Workspace** がインライン描画されます。

![M1 & M2: AI Bid Workspace インライン描画](./assets/01-m1-m2-inline-workspace.png)

| 項目 | 内容 |
| :--- | :--- |
| **撮影日時** | 2026年10月12日 17:58:55 JST |
| **検証項目** | **M1**（MCP 経由の入札検索） / **M2**（MCP Apps ワークスペース描画） |
| **確認できる動作** | ① チャット上での `jp-bids-mock search_bids_app` ツール呼び出し<br>② チャットヘッダー直下に「AI Bid Workspace」ヘッダーと検索窓が表示<br>③ モック案件 `KKJ-TEST-001`（鹿児島市システム保守業務委託）の初期表示<br>④ チャット本文にテキストサマリーとテーブルが出力 |

---

#### Step 2 (M3-A): UI 内でのインタラクティブな状態管理（選択・集計・活性化）

描画されたワークスペースは単なる静的 HTML プレビューではなく、独立した React アプリケーションとして動作しています。ユーザーがカード左のチェックボックスをクリックすると、ワークスペース内の状態が即座に更新されます。

![M3-A: 案件選択とリアクティブな状態変化](./assets/02-m3a-interactive-selection.png)

| 項目 | 内容 |
| :--- | :--- |
| **撮影日時** | 2026年10月12日 18:01:37 JST |
| **検証項目** | **M3-A**（案件選択・件数更新・操作ボタン活性化） |
| **確認できる動作** | ① 案件カード左のチェックボックスがアクティブ化（青インジケータ点灯）<br>② 選択件数が「0件選択中」から **「1件選択中」** に即時更新<br>③ 「選択全解除」ボタンが出現し、一括操作アクションが有効化 |

---

#### Step 3 (M3-B): UI 内からの双方向ツール呼び出し（再検索・結果更新）

ワークスペースを拡大表示し、ヘッダーの検索入力欄にキーワード **「保守」** を入力して [検索] ボタンを押下します。UI 内部から MCP プロトコル経由でホストを通じてサーバーの `search_bids_app` が呼び出され、返却された結果が画面内リストおよび詳細パネルへ反映されます。

##### 画面内キーワード入力
![M3-B: 拡大画面とキーワード入力](./assets/03-m3b-in-app-search-input.png)

##### 検索実行と結果描画
![M3-B: 画面内再検索・結果更新](./assets/04-m3b-in-app-search-expanded.png)

| 項目 | 内容 |
| :--- | :--- |
| **撮影日時** | 2026年10月12日 18:02:10 JST（入力） / 18:05:28 JST（結果反映） |
| **検証項目** | **M3-B**（画面内検索操作・結果表示） |
| **確認できる動作** | ① ワークスペースのモーダル拡大表示<br>② キーワード欄「保守」の入力と [検索] ボタンのトリガー<br>③ サーバーからの結果を受け取り、案件一覧および右側詳細パネル（提出期限 2026-05-15、開札 2026-05-20、公告日 2026-04-25）が描画<br>④ 下部アクションボタン（「要件抽出」「詳細取得」「公式」「選択比較」等）が利用可能な状態でレンダリング |

> [!NOTE]
> M3-B の GUI 操作および検索結果の画面描画は実機操作にて確認済みです。なお、本検証では UI の視覚的成立を主目的としたため、バックエンド通信ログ（JSON-RPC メッセージ）との厳密なミリ秒単位の時系列突合検証はスコープ外としています。

---

### 2.2. ChatGPT クロスクライアント実機デモ (Cross-Client Verification — Gate B)

JP Bids MCP は、Claude Desktop だけでなく、OpenAI Secure MCP Tunnel を介して **ChatGPT 上でも全く同一の MCP Apps UI（AI Bid Workspace）を動作させることができること** を実機検証（Gate B 機能受入）により実証しました。

同一の TypeScript コードベースから生成された単一 HTML バンドル（`ui://jp-bids/search-results.html`）が、ホスト環境の差異を吸収してシームレスに機能します。

#### 接続方式と同一コードベースの共有

- **Claude Desktop**: ローカル stdio トランスポート（`examples/mock-stdio-server.mjs`）
- **ChatGPT**: OpenAI Secure MCP Tunnel 方式（公式 `tunnel-client` を介してローカル Node.js サーバープロセスと接続）
- **共通資産**:
  - 全 7 種の公開 MCP 業務ツール（`search_bids`, `get_bid_detail`, `list_recent_bids`, `extract_bid_requirements`, `rank_bids`, `export_bid_shortlist`, `search_bids_app`）
  - MCP Apps UI リソース (`ui://jp-bids/search-results.html`)
  - オフライン XML フィクスチャ (`tests/fixtures/kkj-search.xml`, `KKJ-TEST-001`)

> [!NOTE]
> **ChatGPT 実機キャプチャの取り扱いとセキュリティ監査**
> - 以下のスクリーンショットはすべて未加工の ChatGPT Web 実機キャプチャ（個人情報枠取り・トリミングのみ、描画内容の改変なし）です。
> - API キー、認証トークン、Tunnel ID、個人名、メールアドレス、ローカルファイルパスは含まれていません。
> - 表示データは `tests/fixtures/kkj-search.xml` による模擬データ（`KKJ-TEST-001`）であり、実 KKJ API との外部通信は遮断されています。

---

#### Step 1 (Gate B-B5): チャット指示からのインライン Workspace 描画

ChatGPT のチャット入力欄において自然言語で入札検索を指示すると、ChatGPT が `search_bids_app` ツールを検出・実行します。レスポンスに含まれる UI リソースメタデータを解釈し、チャット応答内に **AI Bid Workspace**（2 ペイン対話型ワークスペース）がインライン描画されます。

![ChatGPT: AI Bid Workspace インライン描画](./assets/05-chatgpt-workspace-rendered.png)

| 項目 | 内容 |
| :--- | :--- |
| **撮影日時** | 2026年10月13日 22:59 JST |
| **検証項目** | **Gate B-B5**（MCP Apps ワークスペース UI の ChatGPT インライン描画） |
| **確認できる動作** | ① チャット上での `search_bids_app` ツール呼び出しとプレーンテキスト要約返却<br>② チャット領域内に「AI Bid Workspace」ヘッダーと検索窓が表示<br>③ 左ペインに案件一覧（1/1件）、右ペインに案件詳細パネル（モック案件 `KKJ-TEST-001`：鹿児島市システム保守業務委託）の初期描画<br>④ 提出期限（2026-05-15）、開札（2026-05-20）、公告日（2026-04-25）およびアクションボタン（「要件抽出」「詳細取得」「公式」）の完全レンダリング |

---

#### Step 2 (Gate B-B5-⑤): UI 内でのインタラクティブな状態管理（案件選択）

描画されたワークスペース内で案件カードのチェックボックスをクリックすると、React アプリケーション内部の選択状態が即座に同期されます。

![ChatGPT: 案件選択と状態更新](./assets/06-chatgpt-workspace-selection.png)

| 項目 | 内容 |
| :--- | :--- |
| **撮影日時** | 2026年10月13日 23:03 JST |
| **検証項目** | **Gate B-B5-⑤**（UI 内インタラクティブ選択状態の更新） |
| **確認できる動作** | ① 案件カード左のチェックボックスが青地アクティブ（`[✔]`）に点灯<br>② 選択ステータスが「0件選択中」から **「1件選択中」** へ即時遷移<br>③ 「選択全解除」ボタンが出現し、一括解除アクションが活性化 |

---

#### Step 3 (Gate B-B5-⑥): UI 内からの双方向ツール直接呼び出し（`app.callServerTool`）

ワークスペース左上の [選択比較 (rank)] ボタンをクリックすると、UI 内部から `@modelcontextprotocol/ext-apps` の **`app.callServerTool`** を通じてサーバーの `rank_bids` ツールが直接呼び出されます。

チャット本文を介さずに UI 内で直接サーバー評価結果を受信し、ワークスペースのビューモデルがリアルタイムに更新されます。

![ChatGPT: UI 内からの rank_bids 直接呼び出し](./assets/07-chatgpt-workspace-in-app-rank.png)

| 項目 | 内容 |
| :--- | :--- |
| **撮影日時** | 2026年10月13日 23:06 JST |
| **検証項目** | **Gate B-B5-⑥**（`app.callServerTool` による双方向ツール実行と UI 更新） |
| **確認できる動作** | ① 上部に「1件の案件をサーバー評価で比較採点しました。」の成功バナーが出現<br>② 案件カード右上に「見送り 39点」のスコアバッジが描画<br>③ 右側詳細パネルに「サーバー評価: 39点 / 見送り」および具体的な評価理由カード（「公式公告URLがあり、次の確認に進みやすい...」）が即座に反映 |

---

#### Step 4 (Gate B-B5-⑥): UI からチャットへの要件抽出依頼（`app.sendMessage`）

詳細パネル下部の [要件抽出] ボタンをクリックすると、UI は **`app.sendMessage`** を呼び出し、ホストである ChatGPT のチャット入力へ要件抽出リクエストを送信します。

![ChatGPT: UI からチャットへの要件抽出送信](./assets/08-chatgpt-workspace-in-app-extract.png)

| 項目 | 内容 |
| :--- | :--- |
| **撮影日時** | 2026年10月13日 23:06 JST |
| **検証項目** | **Gate B-B5-⑥**（`app.sendMessage` によるチャット連携） |
| **確認できる動作** | ① 上部に「要件抽出リクエストをchatへ送信しました。」の通知バナーが表示<br>② ホストのチャットストリームへコンテキストが引き渡され、後続の会話連携が成立 |

---

#### UI 内再検索の実機検証と証拠の解釈（誠実な開示）

Gate B の最終検証として、ChatGPT 内の AI Bid Workspace ヘッダー検索入力欄にキーワード **「保守」** を入力し、[検索] ボタンを押下する UI 内再検索試験を実施しました。

##### 実機検証の結果
- **画面側の挙動**: UI 内で案件一覧が即座に更新され、モック案件 `KKJ-TEST-001` がエラーなく再描画されたことを実機上で確認。
- **Tunnel 通信メトリクスの変化**:
  - `tools/call` HTTP 200: **16 → 17（+1件）**
  - `dispatcher.completed`: **66 → 69（+3件）**
  - `dispatcher.failures`: **2 → 2（新規失敗 0 件）**
  - `response_delivery.completed`: **66 → 69（+3件）**

##### 証拠の境界と誠実な記載
- **ツール特定の根拠**: トンネルメトリクス単独では個別ツール名（`search_bids_app`）を識別するリクエスト本文ログが存在しないため、「メトリクス単独で `search_bids_app` と特定した」とは断定しません。UI 上での検索ボタン押下・案件再描画の実機確認と、その直後に観測された Tunnel 上の `tools/call` HTTP 200 の 1 件増加が整合している事実を以て、再検索処理の成立証拠とします。
- **ディスパッチ完了数**: `dispatcher.completed: 69` は、トンネル経由で処理された全ライフサイクルイベント（`initialize`: 23、`notifications/initialized`: 21、`tools/call`: 19、`resources/read`: 4、`tools/list`: 1、`server/discover`: 1）の総計です。「69件すべてが HTTP 200 成功」という意味ではなく、後述する累積 HTTP 409（2件）とは別に厳格に集計・記録しています。

---

#### 画面表示と検証境界の開示（CSPオフ・累積409）

- **ChatGPT UI 上の「CSPオフ」バッジ表示について**:
  ChatGPT 画面の右上（キャプチャ参照）に「CSPオフ」というバッジが表示されていることを観測事実として記録しています。当サーバーのメタデータ定義では `connectDomains: []`, `resourceDomains: []` を宣言していますが、この表示の技術的理由やホスト側の保護状態については推測を行わず、安全性の根拠として扱わない検証境界として明記します。
- **累積 HTTP 409 Conflict（2件）の継続記録**:  
  Gate B 検証中に累積 HTTP 409 が 2 件観測されました。個別のエラー本文と相関 ID が不足しているため、**原因未特定（既知事項）** として継続記録しています。後半の受入試験で追加失敗は観測されておらず、機能受入合格を妨げるものではありませんが、本番運用の完全な信頼性が実証されたという意味ではありません。

---

## 3. アーキテクチャ解説 (Technical Deep Dive)

JP Bids MCP は、公式仕様に忠実な設計と厳格な責任境界を採用しています。

### システム構成図

MCP Apps 仕様では、UI（sandboxed iframe）はサーバープロセスと直接ソケット通信を行うのではなく、**MCP Host（Claude Desktop または ChatGPT）を仲介した `window.postMessage`** によって安全にメッセージを交換します。

また、UI バインディング情報である `_meta.ui.resourceUri` はツールの登録時メタデータ（定義情報）であり、Host は初期化時の `tools/list` 等によって事前に発見・キャッシュします。実際のツール実行（`tools/call search_bids_app`）における返却値は `content`（要約テキスト）と `structuredContent`（構造化検索結果）です。

検索結果データを受け取った後のワークスペース状態管理およびビューモデル変換（`App State & ViewModel Mapping`）は、サーバープロセスではなく **React UI（`src/apps/search-results.tsx` / `bid-workspace-view-model.ts`）側のクライアント責務** として実行されます。

Claude Desktop と ChatGPT の双方が、それぞれ独立した stdio サーバープロセスを起動しながら、同一のリポジトリコードベースとインライン UI バンドルを共有します。また、OpenAI Secure MCP Tunnel 方式におけるローカル `tunnel-client` と OpenAI 制御プレーン間の通信は、WebSocket ではなく[公式プロトコル仕様](https://github.com/openai/tunnel-client/blob/master/docs/protocol.md)に基づく HTTPS ロングポーリング（`GET /v1/tunnels/{tunnel_id}/poll`）および応答 POST（`POST /v1/tunnels/{tunnel_id}/response`）により行われます（いずれのリクエストもローカル `tunnel-client` から OpenAI 制御プレーンへアウトバウンド送信されます）。

```mermaid
flowchart TB
  subgraph Shared["同一 JP Bids MCP コードベース & UI バンドル (共通資産)"]
    Codebase["JP Bids MCP 実装\n(7 Tools & ui://jp-bids/search-results.html)"]
  end

  subgraph ClientA["検証環境 A: Claude Desktop (ローカル実行)"]
    ChatA["LLM Chat Interface"]
    HostA["MCP Host Broker (Claude Desktop)"]
    subgraph UIContainerA["Sandboxed iframe A"]
      ReactAppA["React UI App (AI Bid Workspace)"]
    end
    ServerA["独立 Node.js stdio サーバープロセス A"]

    ChatA <--> HostA
    HostA <--"window.postMessage"--> ReactAppA
    HostA <=="stdio (JSON-RPC 2.0)"==> ServerA
  end

  subgraph ClientB["検証環境 B: ChatGPT (Secure MCP Tunnel 経由)"]
    ChatB["ChatGPT Web Interface"]
    HostB["MCP Host Broker (ChatGPT Web)"]
    subgraph UIContainerB["Sandboxed iframe B"]
      ReactAppB["React UI App (AI Bid Workspace)"]
    end
    TunnelCloud["OpenAI Tunnel Control Plane"]
    TunnelClient["ローカル tunnel-client (Go Agent)"]
    ServerB["独立 Node.js stdio サーバープロセス B"]

    ChatB <--> HostB
    HostB <--"window.postMessage"--> ReactAppB
    HostB <--> TunnelCloud
    TunnelClient -- "HTTPS Long-Polling: GET /v1/tunnels/{tunnel_id}/poll" --> TunnelCloud
    TunnelClient -- "HTTPS Response: POST /v1/tunnels/{tunnel_id}/response" --> TunnelCloud
    TunnelClient <=="stdio child process (JSON-RPC 2.0)"==> ServerB
  end

  subgraph DataLayer["ローカルオフラインモック"]
    Fixture["tests/fixtures/kkj-search.xml (KKJ-TEST-001)"]
    FetchGuard["Application Fetch Guard"]
  end

  Codebase -.-> ServerA
  Codebase -.-> ServerB
  ServerA <--> Fixture
  ServerB <--> Fixture
```

---

### 3.1. MCP SDK によるツール登録と公開 7 ツール

JP Bids MCP の公開 MVP プロファイルでは、`@modelcontextprotocol/sdk`（v1.32.1）の `McpServer` クラスを利用してツールを登録しています。

- **`search_bids`**: 条件（キーワード、都道府県、省庁、業務区分、日付範囲）に基づく入札公告情報検索
- **`list_recent_bids`**: 新着・締切間近の入札案件クイック取得
- **`get_bid_detail`**: 特定案件の詳細情報取得
- **`rank_bids`**: 自社プロファイルに基づく案件適合度スコアリング・評価
- **`extract_bid_requirements`**: 参加資格・提出要件・技術要件の抽出
- **`export_bid_shortlist`**: 追跡候補案件の CSV / JSON 出力
- **`search_bids_app`**: **MCP Apps 対応 UI ツール**（本 Showcase の中核）

ソースコード参照:
- [`src/tools/register-tools.ts`](../../src/tools/register-tools.ts)
- [`src/apps/register-search-app.ts`](../../src/apps/register-search-app.ts)

---

### 3.2. MCP Apps 拡張仕様の実装 (`@modelcontextprotocol/ext-apps`)

MCP Apps は、クライアント（Host）とサーバー間でセキュアに対話型 UI を共有するための仕様です。

#### 1. ツール定義と UI リソースの紐付け
`src/apps/register-search-app.ts` では、`registerAppTool` を使用して `_meta.ui.resourceUri` にリソース URI を宣言しています。

```typescript
// src/apps/register-search-app.ts（主要ロジックの抜粋）
const SEARCH_RESULTS_APP_URI = "ui://jp-bids/search-results.html";

registerAppTool(
  server,
  "search_bids_app",
  {
    title: "AI Bid Workspace",
    description: "日本全国の官公需入札情報を検索し、MCP Apps対応クライアントではAI Bid Workspaceとして検索結果を表示する。",
    inputSchema: searchBidsInputSchema,
    outputSchema: BidSearchResultSchema.shape,
    _meta: {
      ui: {
        resourceUri: SEARCH_RESULTS_APP_URI,
      },
    },
  },
  async (args) => {
    // 検索処理を行い、サマリーテキストと structuredContent を返却
  }
);
```

#### 2. リソース登録と CSP / パーミッションの責任境界
UI は `registerAppResource` により、MIME タイプ `text/html;profile=mcp-app` として提供されます。

```typescript
// src/apps/register-search-app.ts（主要ロジックの抜粋）
registerAppResource(
  server,
  "JP Bids Search Results App",
  SEARCH_RESULTS_APP_URI,
  {
    title: "JP Bids Search Results",
    _meta: {
      ui: {
        csp: {
          connectDomains: [],
          resourceDomains: [],
        },
        permissions: {
          clipboardWrite: {}, // CSV等のコピー用
        },
      },
    },
  },
  async () => ({
    contents: [
      {
        uri: SEARCH_RESULTS_APP_URI,
        mimeType: RESOURCE_MIME_TYPE, // "text/html;profile=mcp-app"
        text: await readSearchResultsAppHtml(),
      },
    ],
  })
);
```

> [!IMPORTANT]
> **CSP 宣言と多層防御の区別**
> - **UI リソースの CSP 許可設定**: `connectDomains: []` および `resourceDomains: []` は、埋め込み UI が通信または外部アセットを取得できる外部ドメインの許可リストです。空配列を指定することで、外部への接続や追加スクリプト・スタイルのロードを拒否するポリシーを Host に宣言しています。
> - **Host による CSP 適用**: このメタデータを解釈し、実際の iframe や WebView に Content Security Policy を適用して通信を制限するのは **MCP Host（Claude Desktop / ChatGPT）側の責務** です。
> - **サーバー側の Fetch ガード**: Node.js サーバープロセス側で動作する `examples/mock-stdio-server.mjs` のガード（`globalThis.fetch` の例外送出）は、サーバープロセス自身が外部 KKJ API を誤って呼び出さないためのアプリケーションレベルのインターセプト処理です。
> - **境界の明確化**: これらはいずれもアプリケーションおよびプロトコル仕様に基づく制御であり、OS レベルのサンドボックスやネットワーク機器による完全な物理・パケット遮断を保証するものではありません。

---

### 3.3. フロントエンド設計: 単一 HTML バンドルと双方向通信

Claude Desktop や ChatGPT のようなサンドボックス環境で動作させるため、フロントエンド（React 19）は以下の構成をとっています。

1. **Vite + `vite-plugin-singlefile`**:
   `vite.config.ts` により、すべての CSS、JS、画像アセットを `dist/apps/search-results.html` という 1 つのインライン HTML ファイルにコンパイルします。外部アセット読み込みの失敗や CORS 問題を原理的に排除しています。
2. **`@modelcontextprotocol/ext-apps/react` による双方向通信**:
   UI 側は `useApp` フックを通じてホスト環境と通信します。UI 内の操作に応じて、ブラウザの `fetch` ではなく、Host を仲介してサーバーの MCP ツールを実行またはチャット連携します。

```typescript
// src/apps/search-results.tsx（実装の要点を簡略化した擬似コード / 抜粋）
import { useApp } from "@modelcontextprotocol/ext-apps/react";

function App() {
  const { app } = useApp();

  async function handleSearch(keyword: string) {
    // UI から Host を介してサーバーの MCP ツールを双方向直接呼び出し
    const result = await app.callServerTool({
      name: "search_bids_app",
      arguments: { query: keyword },
    });

    if (!result.isError) {
      applyResult(result.structuredContent);
    }
  }

  async function handleSendExtractPrompt(promptText: string) {
    // Host のメッセージ送信機能宣言（message.text）を確認した上で連携
    if (app?.getHostCapabilities()?.message?.text) {
      const result = await app.sendMessage({
        role: "user",
        content: [{ type: "text", text: promptText }],
      });
      if (!result.isError) {
        setActionMessage("要件抽出リクエストをchatへ送信しました。");
      }
    }
  }
}
```

---

### 3.4. オフラインモックと安全設計 (`examples/mock-stdio-server.mjs`)

外部開発者が実環境と同じ体験を安全に検証できるよう、リポジトリには専用のモック stdio サーバーが同梱されています。

- **ローカル XML フィクスチャ**: `tests/fixtures/kkj-search.xml` の静的データを読み込み、API レスポンスをエミュレート。
- **Application Fetch Guard**: サーバー内部で予期しない外部ネットワークアクセス（`globalThis.fetch`）が発生した場合に即座に例外を送出するガードを設置（※OS レベルのサンドボックスではありません）。
- **stdio 規約の厳格遵守**: JSON-RPC 2.0 通信が行われる `stdout` をクリーンに保つため、すべての診断・起動ログは `stderr` に出力。

---

## 4. 客観的検証結果 (Verification Matrix)

信頼性の高いオープンソース公開のため、各検証レイヤーの結果を厳格に区分して管理しています。

| レイヤー | 検証内容 | 結果 / ステータス | 根拠・エビデンス |
| :--- | :--- | :---: | :--- |
| **自動テスト** | 単体・結合・プロトコル検証 | **PASS** | Vitest 24 テストファイル / **190 テスト全件合格** |
| **型検査 & 静的解析** | TypeScript / Biome | **PASS** | `npm run build` (tsc) エラー 0 件 |
| **ドキュメント整合** | TypeDoc API ドキュメント生成 | **PASS** | `npm run docs:check` 合格（型定義・APIリファレンス整合） |
| **GitHub Actions (main)** | CI / CodeQL / Dependency Review | **PASS** | 過去 main 検証 GREEN ([CI Run #38226024891](https://github.com/SUGUKURU-CO-LTD/jp-bids-mcp/actions)) |
| **GitHub Actions (PR #10)** | CI check / CodeQL / Review | **更新中** | CodeQL・Dependency Review PASS / check ジョブ（TypeDoc 同期）対応中 |
| **セキュリティ監査** | 実行時依存パッケージ脆弱性 | **0件** | `npm audit --omit=dev` 検出 0 件 (MCP SDK 1.32.1 / Hono 4.13.13) |
| **クリーン環境検証** | 新規ディレクトリでのクローン・ビルド | **PASS** | `jp-bids-mcp-clean-verify` でのビルド (125ms) & stdio 疎通 |
| **Claude Desktop 実機** | M1〜M3-B の GUI 操作・UI 描画 | **PASS** | ユーザー実操作および本 Showcase 掲載スクリーンショット (01〜04) |
| **ChatGPT 実機 (Gate B)** | Secure Tunnel 経由の 7 ツール実行 & UI 描画・操作 | **PASS** | 7 ツール実行、UI 描画、案件選択、UI 直接採点、要件抽出チャット連携、UI 内再検索（※累積 409 2件は原因未特定として継続記録） |
| **Marketplace 配布 (Gate A)** | Agent Plugins 1.0.0 による Skill 配布実機検証 | **PASS** | GitHub リポジトリインポートによる Portable Agent Skill 自動認識確認 |
| **外部第三者独立検証** | 社外開発者によるブラインド検証 | **未実施** | 将来フェーズにて計画 |
| **実 API 受入試験** | 実 KKJ API への本番接続試験 | **未実施** | 公開リポジトリでは実 API 通信を遮断 |
| **本番デプロイ** | クラウド環境への一般公開ホスティング | **未実施** | ローカル開発・検証版として提供 |

---

## 5. 再現手順 (Quick Start for Developers)

外部の開発者が自身のローカル環境でこのデモを再現するための最短手順です。

### 1. クローンとビルド

```bash
# リポジトリのクローン
git clone https://github.com/SUGUKURU-CO-LTD/jp-bids-mcp.git
cd jp-bids-mcp

# 依存関係のインストール（再現性のため npm ci を推奨）
npm ci

# サーバーおよび MCP Apps UI のビルド
npm run build
```

> [!TIP]
> **Windows 環境における注意事項**
> - PowerShell の実行ポリシーにより `npm` コマンドがブロックされる場合は、`npm.cmd ci` および `npm.cmd run build` を使用してください。
> - ビルド完了後、`dist/apps/search-results.html` が生成されていることを確認してください。

---

### 2. Claude Desktop への登録

Claude Desktop の設定ファイル（`claude_desktop_config.json`）に、モック起動スクリプトの**絶対パス**を登録します。

```json
{
  "mcpServers": {
    "jp-bids-mock": {
      "command": "node",
      "args": [
        "C:\\path\\to\\jp-bids-mcp\\examples\\mock-stdio-server.mjs"
      ]
    }
  }
}
```

> [!IMPORTANT]
> **設定ファイルの保存場所**
> - **標準インストーラー版**: `%APPDATA%\Claude\claude_desktop_config.json`
> - **Microsoft Store (UWP) 版**: `%LOCALAPPDATA%\Packages\Claude_...\LocalCache\Roaming\Claude\claude_desktop_config.json` に仮想化リダイレクトされる場合があります。
> - 確実な起動のため、`command` には `node.exe` の絶対パスを指定することを推奨します。

---

### 3. Claude Desktop での動作確認

1. Claude Desktop を再起動します。
2. チャット入力欄で以下のように入力します：
   ```text
   鹿児島県の入札案件を検索して
   ```
3. Claude が `jp-bids-mock` の `search_bids_app` を実行し、チャット画面内に **AI Bid Workspace** が描画されます。
4. チェックボックスをクリックして選択件数の変化を確認したり、検索バーにキーワードを入力して画面内検索を体験してください。

---

## 6. 公開表現と免責事項 (Transparency & Disclaimer)

1. **実入札データとの関係**: 本 Showcase に掲載されているスクリーンショットおよびデモデータは、すべてオフライン XML フィクスチャ（`tests/fixtures/kkj-search.xml`）に基づく模擬データです。官公需情報ポータルサイトからリアルタイムに取得した最新の入札案件ではありません。
2. **公式認定に関する注記**: 本リポジトリはオープンソースの Model Context Protocol 仕様に基づいて独自に開発されたものであり、Anthropic 社、OpenAI 社、または中小企業庁による公式認定、推薦、または提携を意味するものではありません。
3. **セキュリティ監査の範囲**: 実行時依存（production dependencies）についての `npm audit --omit=dev` は 0 件を確認していますが、開発時依存（dev dependencies）や将来の潜在的脆弱性を含めた完全無欠性を保証するものではありません。
4. **起動モードの区別**: `examples/mock-stdio-server.mjs` は完全にローカルで完結するモック環境ですが、`node dist/server.js` などの通常起動方式では環境変数によって実 KKJ API へのリクエストが実行される可能性があります。開発・検証目的では必ずモックスクリプトを使用してください。

---

## 7. 公式仕様および参照リンク (References)

- **Model Context Protocol (MCP) Official Specification**:  
  https://spec.modelcontextprotocol.io/specification/
- **MCP TypeScript SDK**:  
  https://github.com/modelcontextprotocol/typescript-sdk
- **MCP Apps Extension (`@modelcontextprotocol/ext-apps`)**:  
  https://apps.extensions.modelcontextprotocol.io/
- **OpenAI Agent Plugins Specification**:  
  https://developers.openai.com/plugins/build/plugins
- **OpenAI Secure MCP Tunnels Guide**:  
  https://developers.openai.com/api/docs/guides/secure-mcp-tunnels
- **OpenAI Tunnel Client Protocol Specification**:
  https://github.com/openai/tunnel-client/blob/master/docs/protocol.md
- **中小企業庁 官公需情報ポータルサイト (KKJ)**:  
  http://www.kkj.go.jp/
