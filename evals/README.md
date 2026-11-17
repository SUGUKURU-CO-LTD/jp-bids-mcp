# JP Bids MCP 評価ハーネス（Claude API）

Claude API（Messages API）で実際の Claude モデルに JP Bids の7ツールを使わせ、次の3点を採点します。

- 正しいツールを選ぶか（例: 「今週の新着」なら `list_recent_bids`）
- 引数を正しく組むか（都道府県・区分・期間・出力形式など）
- ツールがエラーにならず、回答が安全か（参加資格を断定しない、など）

ユニットテスト（`npm test`）では分からない「ツール説明文がモデルにどう読まれるか」を確かめるためのものです。ツール説明やスキーマを変えたときの回帰テストと、ディレクトリ掲載品質の確認に使います。

## サーバーモード

| モード | 中身 | 外部通信 | 用途 |
|---|---|---|---|
| `mock` | `examples/mock-stdio-server.mjs`（fixture） | Claude API のみ | PR ごとの回帰テスト |
| `live` | `dist/server.js`（stdio） | Claude API ＋ KKJ API | 実データでの確認 |
| `remote` | MCP コネクタで本番 `https://mcp.bid-jp.com/mcp` | Claude API → 本番 | 本番デプロイの確認 |

`mock` は検索条件に関係なく fixture の同じ1件（鹿児島市の案件）を返します。ツール選択と引数の採点用で、回答内容の良し悪しは `live` で見てください。

`remote` は Messages API の MCP コネクタ（beta `mcp-client-2025-11-20`）を使います。本番サーバーが受け付ける Bearer キー（Cloud Run の `JP_BIDS_PRO_API_KEYS` に登録したもの）を `JP_BIDS_SERVICE_KEY` に入れてください。MCP コネクタは ZDR の対象外です（出典: https://platform.claude.com/docs/en/agents-and-tools/mcp-connector ）。

## GitHub Actions での実行（推奨）

1. Claude Console（platform.claude.com）で、SUGUKURU CO LTD 組織の API キーを発行する。プロモーションクレジットはこの組織に付与されている。評価専用のワークスペースを作り、支出上限を設定してからキーを発行すると安全。
2. リポジトリの Settings → Secrets and variables → Actions に `ANTHROPIC_API_KEY` として登録する。
3. Actions → 「LLM Eval (Claude API)」→ Run workflow で実行する。

| 起動方法 | サーバー | モデル | 予算上限（既定） |
|---|---|---|---|
| 手動（workflow_dispatch） | 選択（既定 live） | 選択（既定 Opus/Sonnet/Haiku） | 入力値（既定 $10） |
| 毎週月曜 9:17 JST | live（2026-12-12 以降は mock） | Opus/Sonnet/Haiku（同 Sonnet のみ） | $5（同 $2） |
| PR（ツール関連ファイルの変更時） | mock | Sonnet | $2 |

キーが未登録なら、何も呼ばずにスキップします。結果は実行ページの Summary に表で出て、`results.json` と `summary.md` が Artifact に30日間残ります。

## ローカルでの実行

準備（リポジトリ直下で実行）:

```bash
npm ci && npm run build:server && (cd evals && npm ci)
```

APIを呼ばない確認（キー不要）:

```bash
npx tsx evals/run.ts --dry-run
```

実行（`ANTHROPIC_API_KEY` は各自の環境変数に設定しておく）:

```bash
EVAL_SERVER=mock EVAL_MODELS=claude-sonnet-5-5 npx tsx evals/run.ts
```

主なオプション（環境変数 / フラグ）:

| 環境変数 | フラグ | 既定値 | 説明 |
|---|---|---|---|
| `EVAL_SERVER` | `--server=` | `mock` | `mock` / `live` / `remote` |
| `EVAL_MODELS` | `--models=` | `claude-sonnet-5-5` | カンマ区切り |
| `EVAL_CASES` | `--cases=` | 全件 | `id` または `tag:safety` などをカンマ区切りで |
| `EVAL_TRIALS` | `--trials=` | 1 | 各ケースの試行回数 |
| `EVAL_BUDGET_USD` | `--budget=` | 20 | 概算費用がこれを超えたら停止 |
| `EVAL_FAIL_UNDER` | `--fail-under=` | なし | 合格率がこれ未満なら終了コード1（例: 0.8） |

## 費用

実行ログと Summary に、モデルごとのトークン数と概算費用が出ます。単価は公式のモデル一覧（https://platform.claude.com/docs/en/models/overview 、2026-11-18 確認）の値で、キャッシュ割引は考慮していません。実際の請求額は Console の「コスト」画面で確認してください。

ツール定義（7ツール分）は毎ターン入力に乗ります（`--dry-run` でサイズを表示）。そのため1ケースあたりの費用は、ほぼ「ターン数 × ツール定義の長さ」で決まります。ツール説明を短くすると、評価費用と利用者側の費用の両方が下がります。

## ケースの追加

`cases.json` に追記します。`expect` で使える項目は次のとおりです。

- `tools_any`: いずれかが呼ばれれば合格
- `tools_none`: 呼んではいけないツール
- `first_tool`: 最初に呼ぶべきツール（候補のいずれか）
- `tool_order`: この順で呼ばれていること（`a|b` は「a または b」）
- `no_tools`: ツールを呼ばないこと
- `args`: 引数チェック。`tool` は名前・`*`・`*search*` 形式。`path` は `a.b`、`a|b`、全文字列を対象にする `$text`。`op` は `eq` / `not_eq` / `in` / `contains` / `includes_all` / `lte` / `gte` / `exists`。省略時を許すなら `absent_ok: true`
- `answer_includes_any` / `answer_excludes`: 最終回答の文言
- `max_tool_errors`: 許容するツールエラー数

ケースが存在しないツール名を参照すると、実行前にエラーで止まります。
