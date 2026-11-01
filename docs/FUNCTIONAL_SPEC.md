# JP Bids MCP 機能仕様書

更新日: 2026-11-01 JST

[使用説明書](./USER_GUIDE.ja.md) · [検証状況](./VERIFICATION_STATUS.md)

## 仕様の基準

対象はPublic版0.10.0、公開コードの確認基準は `9afe0c6ffb1ec18930c1b358d43ecec784ff7da7`（およびその後のUI改善）です。ソースSHAと本番コンテナの配備リビジョン・イメージdigestとの対応は運用記録および[検証状況](./VERIFICATION_STATUS.md)で管理します。

| ツール | 入力・機能 | 動作・制約 |
| --- | --- | --- |
| search_bids | 条件指定の公告検索 | 検索条件・取得上限・ヒット総数と取得件数の区別 |
| list_recent_bids | 新着公告取得 | 対象期間と取得件数。全掲載案件の網羅保証ではない |
| search_bids_app | 検索条件から検索しUI用の結果を返す | bid_refを渡して表示だけをするツールではない。非対応ホストにはテキスト・構造化結果 |
| get_bid_detail | bid_refまたはKeyから対象を解決 | bid_refは署名付きスナップショット。Key経路と通信・鮮度の扱いを区別 |
| rank_bids | 検索条件またはbid_refsで優先度評価 | 選択モードは1〜50件。検索条件とbid_refsを同時指定しない。受注・参加資格の判定ではない |
| extract_bid_requirements | 対象案件の要件・資料URLを整理 | fetch_documentsは既定false。trueでもサーバー側設定で無効の場合は本文取得しない。本番本文抽出は今回の確認範囲外 |
| export_bid_shortlist | 検索または選択した案件をCSV・JSONで出力 | 選択モードは1〜50件、検索条件との併用不可、重複拒否。Public版では一括fetch_documents=trueを拒否 |

選択モードのCSVは指定案件を対象とし、選択入力の順序を保持する実装です。ランキング結果とCSVを比較する場合、preferred_keywords等の評価条件が同じか確認します。条件が異なるスコアを同一条件の不整合とは扱いません。

bid_refの既定有効期間は公開コード上24時間です。有効期間内でも署名鍵・接続環境の変更等で無効になる可能性があり、「必ず24時間利用可能」とは約束しません。署名はデータ改変の検知を目的とし、公式公告の正確性・最新性の保証ではありません。

## CSVのデータ辞書

Public版の通常出力は次の16列です。

| 列 | 内容 |
| --- | --- |
| priority | 検討優先度 |
| score | 評価条件に基づくスコア |
| key | 案件識別子 |
| project_name | 件名 |
| organization_name | 発注機関 |
| prefecture | 都道府県 |
| city | 市区町村 |
| category | カテゴリ |
| procedure_type | 調達方式 |
| notice_date | 公告日 |
| tender_submission_deadline | 提出期限。空欄は未取得・不明 |
| opening_tenders_event | 開札日時。空欄は未取得・不明 |
| fit_reasons | 評価理由 |
| risks | 要確認のリスク |
| next_action | 次に確認する事項 |
| official_url | 公式公告・資料へのURL |

CSV本体はLFで連結され、UI保存処理は必要に応じてUTF-8 BOMを付けます。カンマ・引用符・改行のあるセルのエスケープと、先頭記号による表計算式としての解釈を抑える処理があります。テスト用パーサーによる確認を、あらゆる表計算ソフトでの完全互換保証に拡張しません。

## UIからのCSV取得経路とフォールバック

直接呼出（`serverTools`）に対応するホストでは、UIが `export_bid_shortlist` を呼び、16列（または詳細取得時の21列）のヘッダー・列数・件数整合性を検証したうえで、次の3段階で取得を試みます。

1. **ホストのファイル保存 (`app.downloadFile`)**: 対応している場合はUTF-8 BOM付きCSVの保存を要求します。
2. **クリップボードコピー (`navigator.clipboard.writeText`)**: ファイル保存が非対応またはエラーとなった場合に試みます。
3. **CSV 手動取得欄 (`ManualExportPanel`)**: サンドボックスiframeの権限制限等で1・2がいずれも完了しなかった場合、読み取り専用のテキストエリア（「全選択」「閉じる」ボタン付き）に検証済みCSV本文を表示します。再検索や別の出力を開始した際は連番ガード（`exportSeqRef`）により古い非同期結果を破棄します。

直接呼出に非対応のホストでは、チャットへ依頼文を送るか、依頼文のコピーに切り替わります。この経路は、CSV本文の直接受け渡しとは区別します。また、検索結果が0件（`searchHits: 0` / `bids: []`）の場合は、UIの案件一覧と詳細欄に0件の空状態（Empty State）を明示表示します。

確認したコード：
[CSV UI経路 (`src/apps/search-results.tsx`)](../src/apps/search-results.tsx) ／ [CSV出力診断・検証 (`src/apps/export-diagnostics.ts`)](../src/apps/export-diagnostics.ts) ／ [CSVツール (`src/tools/export-bid-shortlist.ts`)](../src/tools/export-bid-shortlist.ts) ／ [CSV生成 (`src/domain/bid-shortlist.ts`)](../src/domain/bid-shortlist.ts) ／ [案件参照 (`src/domain/bid-ref.ts`)](../src/domain/bid-ref.ts) ／ [資料抽出の設定分岐 (`src/tools/document-extraction.ts`)](../src/tools/document-extraction.ts)
