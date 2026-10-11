import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { KkjClient } from "../api/kkj-client.js";
import { type BidRequirementExtraction, BidShortlistExportSchema } from "../domain/bid.js";
import {
  type BidRankingOptions,
  type RankingInputBid,
  rankBidSearchResult,
  rankSelectionBids,
} from "../domain/bid-ranking.js";
import { signBidRef, verifyBidRef } from "../domain/bid-ref.js";
import { extractBidRequirements } from "../domain/bid-requirements.js";
import { exportBidShortlist } from "../domain/bid-shortlist.js";
import { UserInputError } from "../lib/errors.js";
import type { ServerProfile } from "../lib/profile.js";
import { toolError } from "../lib/tool-result.js";
import { enrichWithDocumentExtraction } from "./document-extraction.js";
import { buildSearchBidsParams, searchBidsInputSchema } from "./search-bids.js";

const SEARCH_PARAM_KEYS = [
  "query",
  "project_name",
  "organization_name",
  "prefecture",
  "category",
  "procedure_type",
  "certification",
  "issued_after",
  "issued_before",
  "due_after",
  "due_before",
  "opening_after",
  "opening_before",
  "period_end_after",
  "period_end_before",
] as const;

function hasSearchParams(args: Record<string, unknown>): boolean {
  return SEARCH_PARAM_KEYS.some((key) => args[key] !== undefined);
}

const inputSchema = {
  ...searchBidsInputSchema,
  bid_refs: z
    .array(z.string().min(1))
    .min(1)
    .max(50)
    .optional()
    .describe(
      "エクスポート対象とする bid_ref の配列（最大50件）。指定時は検索を行わず指定案件のみを出力します（Selection-only mode）。",
    ),
  format: z
    .enum(["csv", "json"])
    .default("csv")
    .describe("出力フォーマット。'csv' または 'json'。デフォルトは 'csv'。"),
  preferred_keywords: z
    .array(z.string().min(1))
    .optional()
    .describe("優先したい語句。例: ソフトウェア、保守、クラウド。"),
  avoid_keywords: z
    .array(z.string().min(1))
    .optional()
    .describe("避けたい語句。例: 工事、常駐、夜間。"),
  due_within_days: z
    .number()
    .int()
    .min(1)
    .max(180)
    .default(30)
    .describe("この日数以内に提出期限が来る案件を優先。デフォルト30日。"),
  shortlist_limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe(
      "出力する最大件数。検索モードではデフォルト10件。選択モードでは指定がなければ全選択件数を出力します。",
    ),
  fetch_documents: z
    .boolean()
    .default(false)
    .describe("trueの場合、上位案件のPDF/HTML抽出結果をCSVに参加資格・提出期限列として追加する。"),
};

export function registerExportBidShortlist(
  server: McpServer,
  client: KkjClient,
  profile: ServerProfile = "public_mvp",
): void {
  server.registerTool(
    "export_bid_shortlist",
    {
      title: "入札検討shortlist CSV",
      description:
        "入札を検索または指定選択してランキングし、Google Sheets/Excel用のCSVまたはJSONを返す。スコア・判断・リスク・次アクション付き。USE THIS WHEN: 複数案件を営業リストとして表計算ソフト等に渡したいとき。DO NOT USE WHEN: 1件の詳細情報や公示内容の全文を確認したいとき（get_bid_detail や公式公告リンクを使う）。Search or select and rank bids, then export a CSV/JSON shortlist for Google Sheets/Excel with scores and next actions. Cari atau pilih tender, beri peringkat, dan ekspor shortlist CSV/JSON.",
      inputSchema,
      outputSchema: BidShortlistExportSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        if (profile === "public_mvp" && args.fetch_documents) {
          throw new UserInputError(
            "Public MVP では shortlist の一括資料抽出 (fetch_documents) は無効です。個別案件に対して extract_bid_requirements をご利用ください。",
          );
        }

        let ranked: ReturnType<typeof rankBidSearchResult>;

        const isSelection = args.bid_refs !== undefined;

        if (isSelection) {
          if (!args.bid_refs || args.bid_refs.length === 0) {
            throw new UserInputError("bid_refs には1件以上の案件参照を指定してください。");
          }
          if (args.bid_refs.length > 50) {
            throw new UserInputError("一度に指定できる bid_ref は最大50件です。");
          }
          if (hasSearchParams(args as Record<string, unknown>)) {
            throw new UserInputError(
              "bid_refs 指定時は検索条件（query, prefecture等）を同時に指定できません。",
            );
          }

          if (args.shortlist_limit !== undefined && args.shortlist_limit < args.bid_refs.length) {
            throw new UserInputError(
              `選択モードでは指定上限件数 (${args.shortlist_limit}) が選択件数 (${args.bid_refs.length}) 未満のため処理できません。全件を指定するか、上限を調整してください。`,
            );
          }

          // Check token duplicates
          const seenRefs = new Set<string>();
          for (const ref of args.bid_refs) {
            if (seenRefs.has(ref)) {
              throw new UserInputError("指定された bid_refs に重複した案件参照が含まれています。");
            }
            seenRefs.add(ref);
          }

          const bids: RankingInputBid[] = [];
          const seenKeys = new Set<string>();
          for (const ref of args.bid_refs) {
            const verification = verifyBidRef(ref);
            if (!verification.valid) {
              throw new UserInputError(
                `指定された bid_ref が無効または期限切れです (${verification.reason})。最新の search_bids または list_recent_bids から再取得してください。`,
              );
            }
            if (seenKeys.has(verification.payload.bid.key)) {
              throw new UserInputError(
                `指定された bid_refs に重複した案件キー (${verification.payload.bid.key}) が含まれています。`,
              );
            }
            seenKeys.add(verification.payload.bid.key);
            bids.push({
              ...verification.payload.bid,
              bidRef: ref,
            });
          }

          const rankingOptions: BidRankingOptions = {
            dueWithinDays: args.due_within_days,
            shortlistLimit: args.shortlist_limit ?? bids.length,
          };
          if (args.preferred_keywords) {
            rankingOptions.preferredKeywords = args.preferred_keywords;
          }
          if (args.avoid_keywords) {
            rankingOptions.avoidKeywords = args.avoid_keywords;
          }

          ranked = rankSelectionBids(bids, rankingOptions);
        } else {
          const rankingOptions: BidRankingOptions = {
            dueWithinDays: args.due_within_days,
            shortlistLimit: args.shortlist_limit ?? 10,
          };
          if (args.preferred_keywords) {
            rankingOptions.preferredKeywords = args.preferred_keywords;
          }
          if (args.avoid_keywords) {
            rankingOptions.avoidKeywords = args.avoid_keywords;
          }

          const searchResult = await client.search(buildSearchBidsParams(args));
          const bidsWithRef = searchResult.bids.map((bid) => ({
            ...bid,
            bidRef:
              bid.bidRef ??
              signBidRef(bid, {
                fetchedAt:
                  (bid as { fetchedAt?: string }).fetchedAt ?? searchResult.attribution?.accessedAt,
              }),
          }));
          ranked = rankBidSearchResult(
            {
              ...searchResult,
              bids: bidsWithRef,
            },
            rankingOptions,
          );
        }

        let extractionMap: Map<string, BidRequirementExtraction> | undefined;
        if (args.fetch_documents) {
          extractionMap = new Map();
          for (const rankedBid of ranked.rankedBids.slice(0, 3)) {
            const baseReq = extractBidRequirements(rankedBid.bid, ranked.attribution);
            const enriched = await enrichWithDocumentExtraction(server, baseReq, undefined);
            extractionMap.set(rankedBid.bid.key, enriched);
          }
        }

        const exported = exportBidShortlist(ranked, extractionMap, args.format);
        const textSummary =
          args.format === "json"
            ? [
                `入札shortlist JSON: ${exported.rankedCount}件`,
                `ファイル名候補: ${exported.filename}`,
                "",
                JSON.stringify(exported.jsonContent ?? [], null, 2),
              ].join("\n")
            : [
                `入札shortlist CSV: ${exported.rankedCount}件`,
                `ファイル名候補: ${exported.filename}`,
                "",
                exported.csv ?? "",
              ].join("\n");

        return {
          content: [
            {
              type: "text" as const,
              text: textSummary,
            },
          ],
          structuredContent: exported,
        };
      } catch (error) {
        return toolError(
          error,
          "入札shortlistの作成で一時的なエラーが発生しました。条件を絞って再実行してください。",
        );
      }
    },
  );
}
