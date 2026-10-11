import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { KkjClient } from "../api/kkj-client.js";
import { createAttribution } from "../domain/attribution.js";
import { type Bid, BidSearchResultSchema } from "../domain/bid.js";
import { resolveBid } from "../domain/bid-resolver.js";
import { resourceLink, toolError } from "../lib/tool-result.js";

const inputSchema = {
  bid_ref: z
    .string()
    .min(1)
    .optional()
    .describe("search_bids または list_recent_bids が返した bid_ref トークン（優先）"),
  bid_key: z
    .string()
    .min(1)
    .optional()
    .describe("search_bids または list_recent_bids が返した Key フィールド"),
};

export function registerGetBidDetail(server: McpServer, client: KkjClient): void {
  server.registerTool(
    "get_bid_detail",
    {
      title: "官公需入札詳細",
      description:
        "入札Keyまたはbid_refから1件の詳細を取得する。添付資料は保存せず公式サイトのURIのみ返す。USE THIS WHEN: search_bids/list_recent_bids が返した bid_ref や Key から公式公告ページ・添付URI・機関情報を確認したいとき。DO NOT USE WHEN: Key や bid_ref がまだ無いとき（search_bids を先に使う）。Fetch full details for one bid by bid_ref or key without storing attachments. Ambil detail lengkap satu tender berdasarkan bid_ref atau kunci tanpa menyimpan lampiran.",
      inputSchema,
      outputSchema: BidSearchResultSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        const resolved = await resolveBid({
          client,
          bid_ref: args.bid_ref,
          bid_key: args.bid_key,
        });
        const exact = resolved.bid;
        const resolutionLabel =
          resolved.resolution === "snapshot"
            ? "署名付きスナップショット (改ざん検証・即時復元)"
            : resolved.resolution === "cache"
              ? "ローカルキャッシュ"
              : "上流検索取得";

        const detail = {
          searchHits: 1,
          returnedCount: 1,
          bids: [exact],
          query: {
            ...(exact.key ? { bid_key: exact.key } : {}),
            ...(args.bid_ref ? { bid_ref: args.bid_ref } : {}),
            resolution: resolved.resolution,
            ...(resolved.fetchedAt ? { fetched_at: resolved.fetchedAt } : {}),
          },
          attribution: createAttribution(),
        };
        const officialLinks = buildOfficialLinks(exact);
        return {
          content: [
            {
              type: "text" as const,
              text: [
                `■ ${exact.projectName}`,
                `機関: ${exact.organizationName ?? "不明"}`,
                `Key: ${exact.key}`,
                `取得方式: ${resolutionLabel}`,
                ...(resolved.fetchedAt ? [`取得日時: ${resolved.fetchedAt}`] : []),
                `出典: ${detail.attribution.dataSource}`,
              ].join("\n"),
            },
            ...officialLinks,
          ],
          structuredContent: detail,
        };
      } catch (error) {
        return toolError(error, "入札詳細の取得で一時的なエラーが発生しました。");
      }
    },
  );
}

// 公式公告ページと添付資料のresource_linkを構築する
// Build resource_link blocks for the official announcement page and attachments
// Bangun blok resource_link untuk halaman pengumuman resmi dan lampiran
function buildOfficialLinks(bid: Bid) {
  const links: ReturnType<typeof resourceLink>[] = [];
  if (bid.externalDocumentUri) {
    links.push(
      resourceLink(bid.externalDocumentUri, "公式公告ページ / Official Announcement", "text/html"),
    );
  }
  for (const attachment of bid.attachments ?? []) {
    if (attachment.uri) {
      const isPdf =
        attachment.name.toLowerCase().endsWith(".pdf") ||
        attachment.uri.toLowerCase().includes(".pdf");
      links.push(
        resourceLink(attachment.uri, attachment.name, isPdf ? "application/pdf" : undefined),
      );
    }
  }
  return links;
}
