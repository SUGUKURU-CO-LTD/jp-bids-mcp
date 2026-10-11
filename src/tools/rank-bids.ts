import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { KkjClient } from "../api/kkj-client.js";
import { BidRankingResultSchema } from "../domain/bid.js";
import {
  type BidRankingOptions,
  type RankingInputBid,
  rankBidSearchResult,
  rankSelectionBids,
} from "../domain/bid-ranking.js";
import { signBidRef, verifyBidRef } from "../domain/bid-ref.js";
import { UserInputError } from "../lib/errors.js";
import { toolError } from "../lib/tool-result.js";
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

const rankBidsInputSchema = {
  ...searchBidsInputSchema,
  bid_refs: z
    .array(z.string().min(1))
    .min(1)
    .max(50)
    .optional()
    .describe(
      "採点対象とする bid_ref の配列（最大50件）。指定時は検索を行わず指定案件のみを採点します（Selection-only mode）。",
    ),
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
    .describe("この日数以内に提出期限が来る案件を優先します。"),
  shortlist_limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe(
      "ランキング結果として返す最大件数。検索モードではデフォルト10件。選択モードでは指定がなければ全選択件数を返します。",
    ),
};

export function registerRankBids(server: McpServer, client: KkjClient): void {
  server.registerTool(
    "rank_bids",
    {
      title: "追うべき入札ランキング",
      description:
        "官公需入札を検索または指定選択し、追うべき順にスコアリングする。USE THIS WHEN: 検索結果や指定した bid_ref 一覧を営業優先度で並べ、pursue/review/skip の初期判断を作りたいとき。DO NOT USE WHEN: 法的な参加資格の最終判定が必要なとき（公式公告資料や発注機関窓口による確認が必要）。Search or evaluate selected bids and score by follow-up priority using AI Bid Radar. Cari atau evaluasi tender terpilih dan peringkat berdasarkan prioritas tindak lanjut dengan AI Bid Radar.",
      inputSchema: rankBidsInputSchema,
      outputSchema: BidRankingResultSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
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

          const result = rankSelectionBids(bids, rankingOptions);
          return {
            content: [{ type: "text" as const, text: formatRankingSummary(result) }],
            structuredContent: result,
          };
        }

        // Standard search-and-rank mode
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
        const result = rankBidSearchResult(
          {
            ...searchResult,
            bids: bidsWithRef,
          },
          rankingOptions,
        );
        return {
          content: [{ type: "text" as const, text: formatRankingSummary(result) }],
          structuredContent: result,
        };
      } catch (error) {
        return toolError(
          error,
          "入札ランキングで一時的なエラーが発生しました。検索条件を絞って再実行してください。",
        );
      }
    },
  );
}

function formatRankingSummary(result: z.infer<typeof BidRankingResultSchema>): string {
  const lines = [
    `追うべき入札候補: ${result.rankedCount}件（検索ヒット ${result.searchHits}件）`,
    `スコアリング: ${result.scoringPolicy.version}`,
    `出典: ${result.attribution.dataSource}`,
    "",
  ];
  for (const rankedBid of result.rankedBids.slice(0, 10)) {
    lines.push(
      `■ ${rankedBid.score}点 / ${rankedBid.priority}: ${rankedBid.bid.projectName}`,
      `  機関: ${rankedBid.bid.organizationName ?? "不明"} | 地域: ${rankedBid.bid.prefectureName ?? "不明"}`,
      `  理由: ${rankedBid.reasons.join(" / ") || "追加確認が必要"}`,
      `  リスク: ${rankedBid.risks.join(" / ") || "大きなリスクは未検出"}`,
      `  次: ${rankedBid.nextActions[0] ?? "公式書類を確認する"}`,
      "",
    );
  }
  return lines.join("\n");
}
