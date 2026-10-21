# JP Bids MCP 正式告知原稿集（2026年10月22日 15:00 JST 公開版）

発行主体: スグクル株式会社 (SUGUKURU CO., LTD.)  
公式サイト: https://sugu-kuru.co.jp/services/jp-bids-mcp  
接続エンドポイント: https://mcp.bid-jp.com/mcp (Streamable HTTP / OAuth 2.0認可)  
利用料金: JP Bids MCP自体の利用料は無料（Claude等のAIクライアント利用料は別途発生する場合があります）  
告知予定日時: 2026年10月22日 15:00 JST  

---

## 1. ディレクトリ登録・訂正申請原稿（日英）

### 【日本語版原稿案】
```text
■ サーバー名: JP Bids MCP (jp-bids-mcp)
■ 発行元: スグクル株式会社が提供するMCPサーバー
■ 公式サイト: https://sugu-kuru.co.jp/services/jp-bids-mcp
■ 接続URL (Streamable HTTP): https://mcp.bid-jp.com/mcp
■ 接続方式: URL登録およびOAuth 2.0認可後に利用可能
■ 掲載・検証状況:
  - Claudeの本番カスタム接続で確認済み
  - その他のMCPディレクトリ: 現時点で掲載未確認（本原稿は新規登録および旧案内の訂正申請用）
■ 利用料金:
  JP Bids MCP 自体の利用料は無料です。
  （※Claude等のAIクライアント利用料は別途発生する場合があります。旧案内の一部にあった「Free 4 / Pro 17」等の区分は廃止され、公開7ツールすべてを無料Public版として提供しています。）

■ 概要:
日本全国の官公需入札・公共調達公告を、Claude等のAIクライアントから直接検索・詳細確認・CSVエクスポートするためのMCPサーバーです。

■ 公開7ツール一覧:
1. search_bids: 条件指定（キーワード・機関・地域・カテゴリ・日付等）による実公告検索
2. list_recent_bids: 新着公告一覧の取得
3. get_bid_detail: 改ざん防止署名付きスナップショットによる公告詳細の復元
4. rank_bids: 案件の優先度スコアリング（初期検証段階）
5. extract_bid_requirements: 公式公告資料URL（Word/PDF等）および参加条件メタデータの抽出
6. export_bid_shortlist: 検討対象案件の営業リスト用CSV出力
7. search_bids_app: 対話型ワークスペースUI（AI Bid Workspace）
```

### 【英語版原稿案 (English Draft)】
```text
■ Name: JP Bids MCP (jp-bids-mcp)
■ Provider: MCP server provided by SUGUKURU CO., LTD.
■ Official Website: https://sugu-kuru.co.jp/services/jp-bids-mcp
■ Connection URL (Streamable HTTP): https://mcp.bid-jp.com/mcp
■ Connection Method: Available following URL registration and OAuth 2.0 authorization.
■ Verification & Directory Status:
  - Verified on Claude's production custom connection.
  - Other MCP directories: Unverified / Draft for directory submission and updates.
■ Pricing:
  Free of charge. (AI client fees, such as Claude subscriptions, may apply separately. Note: The previous "Free 4 / Pro 17" classification has been deprecated; all 7 public tools are provided free of charge.)

■ Overview:
An MCP server provided by SUGUKURU CO., LTD. enabling AI clients like Claude to search, inspect, and export Japanese public procurement notices.

■ Public Tools (7 tools):
1. search_bids: Search Japanese public procurement bids by keyword, agency, region, and category.
2. list_recent_bids: Retrieve recent bid announcements.
3. get_bid_detail: Restore tamper-evident snapshot details of a bid notice.
4. rank_bids: Score bids by business follow-up priority (early evaluation stage).
5. extract_bid_requirements: Extract official document URLs and qualification metadata.
6. export_bid_shortlist: Export candidate bid shortlist as CSV.
7. search_bids_app: Interactive search workspace (AI Bid Workspace widget).
```

---

## 2. Zenn 技術解説記事ドラフト

```markdown
---
title: "Claudeで公共調達・入札公告を検索・整理する「JP Bids MCP」の利用手順"
emoji: "🏛️"
type: "tech"
topics: ["mcp", "claude", "aiagent", "公共調達", "dx"]
published: false
---

**更新・案内日時: 2026年10月22日 15:00 JST**

## はじめに
官公庁や自治体による公共調達（官公需入札）は、多くの事業者にとって重要な事業機会ですが、案件情報の収集や整理には日常的な確認負荷がかかります。

スグクル株式会社では、Model Context Protocol (MCP) を活用し、Claude 上で実在する入札公告の検索・詳細確認、および検討用リストのエクスポートが行える **「JP Bids MCP」** を提供しています。

本記事では、すでに稼働しているリモート接続エンドポイントを用い、Claude 上で実公告の検索からワークスペースUIを通じたCSV取得までの標準的な利用手順を解説します。

※本ツールはスグクル株式会社が提供するMCPサーバーであり、政府機関や中小企業庁KKJの公式製品ではありません。

## 接続設定（OAuth 2.0認可）
リモートMCP（Streamable HTTP）に対応しており、URL登録とOAuth認可を行うことで接続できます。

- **接続URL**: `https://mcp.bid-jp.com/mcp`
- **利用料金**: 無料（※Claudeの利用料金は別途発生する場合があります）
- **公式案内**: [スグクル株式会社 サービス紹介ページ](https://sugu-kuru.co.jp/services/jp-bids-mcp)

### 接続手順
1. Claude（Web版またはDesktop版）のメニューから「カスタマイズ」>「コネクタ」を開く
2. 「カスタムコネクタを追加」を選択し、接続URL `https://mcp.bid-jp.com/mcp` を入力
3. 画面の案内に従って OAuth 2.0 認可を完了する

※Claude Team または Enterprise プランをご利用の場合、ワークスペース管理者によるコネクタ追加の許可・権限設定が必要になる場合があります。詳しい追加手順や組織設定は [Anthropicヘルプセンター（カスタムコネクタの追加）](https://support.claude.com/ja/articles/11175166) をご確認ください。

## 確認済みの標準利用手順（ワークスペースと選択CSV）

Claudeの本番カスタム接続環境において、以下の操作フローで実公告の検索およびCSVエクスポートが動作することを確認しています。

### 1. 実公告の検索とワークスペース描画
チャット上で `search_bids_app` を呼び出します。例えば、以下のようにそのまま入力して試すことができます。

> **依頼例:**  
> 「JP Bidsのsearch_bids_appで、東京都・役務、件名に「システム」を含む公告を最大3件検索し、AI Bid Workspaceを表示してください。」

実在する官公需公告が検索され、チャット内に「AI Bid Workspace」ウィジェットが表示されます。

### 2. 検討対象案件のチェック
ウィジェット内の案件一覧から、自社の関心に合う案件カードのチェックボックスを選択します。

### 3. 「選択CSV」によるデータ取得
画面上部の **「選択CSV」** ボタンをクリックします。

今回の検証では、選択した2案件を含むCSVファイルを取得し、案件・発注機関・理由の対応を確認しました。  
（※「選択CSV」クリック後の動作は、ご利用のホスト環境に依存します。CSV保存・コピーに対応する場合のほか、チャットへ実行依頼を送るか、操作文をコピーする場合があります。「リクエストをchatへ送信しました」等の通知だけではCSV取得完了ではありません。実際に得たファイルまたはCSV本文と、選択した案件の対応を確認してください。）

> 💡 **CSVの受け取りを確認する**:
> 対応ホストでは、ウィジェットの「選択CSV」からツール応答のCSV本文を受け取れます。非対応ホストでチャットへ依頼が送られた場合や、会話文としてCSVが再提示された場合は、取得経路を区別し、案件名・発注機関・理由を確認してください。過去の不整合の原因をAIの転記と断定するものではありません。

詳しい操作手順と困ったときの対処は、[使用説明書とFAQ](https://github.com/SUGUKURU-CO-LTD/jp-bids-mcp/blob/main/docs/USER_GUIDE.ja.md)を参照してください。

## 業務利用にあたっての留意点
- **原本確認の原則**:  
  本ツールが提供するのは公告メタデータおよび公式資料URLの整理です。入札参加資格や提出期限等の最終確認は、必ず発注機関が提示する公式原本にて行ってください。
- **資料本文の取得・解析について**:  
  今回の本番検証では、添付資料本文の取得・解析は対象としていません（公開コードには `fetch_documents: true` による資料一時取得の抽出オプションが存在しますが、今回の検証では公告メタデータと公式原本URLの確認を対象としています）。仕様書原本の精読や提案書の作成は、発注機関の公式原本をご確認の上、Claude自身の文書理解機能や外部ツールと組み合わせて実施してください。

## おわりに
JP Bids MCP はどなたでも無料で接続いただけます。公共調達リサーチの初期確認にぜひお役立てください。
```

---

## 3. 会社SNS告知文ドラフト

### 【X（旧Twitter）用告知文案（スレッド形式）】

**1投稿目:**
```text
官公庁・自治体の入札案件を、Claudeで探して検討リストに。
スグクルの「JP Bids MCP」は、公告検索と選択案件のCSV取得に対応。利用料無料です（AIクライアント料金は別途かかる場合があります）。
接続手順
https://sugu-kuru.co.jp/services/jp-bids-mcp
#MCP #入札
```

**返信として続ける2投稿目:**
```text
使い方は、Claudeに接続URLを登録してOAuth認可 → 公告を検索 → 画面で案件を選択 →「選択CSV」。
データの出典は中小企業庁「官公需情報ポータルサイト」。スグクル提供のサービスです。参加資格・提出期限は必ず発注機関の公式原本で確認してください。
```

---

### 【Facebook / LinkedIn用告知文案（ビジネス向け）】

> **【サービス案内】公共調達・入札公告検索ツール「JP Bids MCP」利用手順のご案内**
> 
> スグクル株式会社では、全国の官公庁・自治体による調達公告をAIクライアント（Claude等）から検索・整理できる「JP Bids MCP」を提供しております（2026年10月22日 15:00 JST 案内）。
> 
> 本ツールは Model Context Protocol (MCP) に準拠しており、Claude の設定画面（カスタマイズ > コネクタ）に正規URLを登録しOAuth認可を完了することで、インストール不要でご利用いただけます。
> 
> **主な利用機能（無料Public版 7ツール）：**
> ・日本全国の入札公告の実検索・新着確認
> ・チャット内ウィジェット（AI Bid Workspace）での一覧確認
> ・検討案件を選んで出力する「選択CSV」取得機能
> ・発注機関が公開する公式公告文・仕様書原本URLの特定
> 
> 今回の検証では、選択した2案件を含むCSVファイルを取得し、案件・発注機関・理由の対応を確認しました。検索結果の画面から必要な案件を選んで「選択CSV」をクリックすることで、社内検討や管理用のリストをスムーズに取得いただけます。
> 
> **ご利用上の留意点：**
> ・本ツールは公告メタデータと公式資料URLを整理するものであり、入札資格や受領期限の最終判断は必ず発注機関の公式原本にてご確認ください。
> ・今回の本番検証では添付資料本文の取得・解析は対象としていません（公開コードには一時取得オプションがありますが、今回の検証は公告メタデータと公式URLの確認を対象としています）。仕様書原本の精読や提案書作成等の発展的業務は、公式原本をご確認の上、Claudeの文書理解機能や外部ツールと組み合わせて実施してください。
> 
> ▼ 接続手順・詳細はこちら（公式サイト）
> https://sugu-kuru.co.jp/services/jp-bids-mcp
> 
> ※スグクル株式会社が提供するMCPサーバーです（政府・中小企業庁KKJの公式製品ではありません）。
> ※JP Bids MCP自体の利用料は無料です（AIクライアント利用料は別途発生する場合があります）。
