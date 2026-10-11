import { describe, expect, it } from "vitest";
import type { BidSearchResult } from "../../src/domain/bid.js";
import { rankBidSearchResult } from "../../src/domain/bid-ranking.js";

const baseResult: BidSearchResult = {
  searchHits: 2,
  returnedCount: 2,
  query: { Query: "システム", Count: 2 },
  attribution: {
    dataSource: "中小企業庁 官公需情報ポータルサイト",
    sourceUrl: "https://www.kkj.go.jp/",
    accessedAt: "2026-05-03T00:00:00.000Z",
    terms: "官公需情報ポータルサイトの利用規約に従って利用してください。",
  },
  bids: [
    {
      resultId: 2,
      key: "LOW",
      projectName: "庁舎夜間工事",
      tenderSubmissionDeadline: "2026-05-20",
      procedureType: "指名競争入札",
    },
    {
      resultId: 1,
      key: "HIGH",
      projectName: "クラウドシステム保守業務",
      externalDocumentUri: "https://example.test/bid.pdf",
      organizationName: "鹿児島市",
      prefectureName: "鹿児島県",
      category: "役務",
      procedureType: "一般競争入札",
      tenderSubmissionDeadline: "2026-05-20",
    },
  ],
};

describe("bid ranking", () => {
  it("prioritizes bids with practical follow-up signals", () => {
    const result = rankBidSearchResult(baseResult, {
      preferredKeywords: ["クラウド", "保守"],
      avoidKeywords: ["工事"],
      now: new Date("2026-05-03T00:00:00+09:00"),
    });

    expect(result.rankedBids[0]?.bid.key).toBe("HIGH");
    expect(result.rankedBids[0]?.priority).toBe("pursue");
    expect(result.rankedBids[0]?.reasons).toEqual(
      expect.arrayContaining(["公式公告URLがあり、次の確認に進みやすい"]),
    );
    expect(result.rankedBids[1]?.bid.key).toBe("LOW");
    expect(result.rankedBids[1]?.risks).toEqual(
      expect.arrayContaining(["避けたいキーワードに一致: 工事"]),
    );
  });

  it("marks expired bids as skip candidates", () => {
    const result = rankBidSearchResult(baseResult, {
      now: new Date("2026-06-01T00:00:00+09:00"),
    });

    expect(result.rankedBids.every((rankedBid) => rankedBid.priority === "skip")).toBe(true);
  });
});
