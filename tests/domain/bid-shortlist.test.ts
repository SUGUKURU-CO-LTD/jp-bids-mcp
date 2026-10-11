import { describe, expect, it } from "vitest";
import { createAttribution } from "../../src/domain/attribution.js";
import type { BidRankingResult } from "../../src/domain/bid.js";
import { exportBidShortlistCsv } from "../../src/domain/bid-shortlist.js";

describe("bid shortlist export", () => {
  it("exports ranked bids as Sheets-friendly CSV", () => {
    const result: BidRankingResult = {
      searchHits: 1,
      returnedCount: 1,
      rankedCount: 1,
      query: { Query: "システム" },
      attribution: createAttribution(),
      scoringPolicy: {
        version: "test",
        summary: "test policy",
      },
      rankedBids: [
        {
          score: 88,
          priority: "pursue",
          reasons: ["重要キーワードに一致: システム"],
          risks: ['仕様書に "別紙" 参照あり'],
          nextActions: ["公式公告ページを確認する"],
          bid: {
            resultId: 1,
            key: "A",
            projectName: '庁舎, "ネットワーク" 保守',
          },
        },
      ],
    };

    const exported = exportBidShortlistCsv(result);

    expect(exported.columns).toContain("priority");
    expect(exported.csv).toContain("priority,score,key");
    expect(exported.csv).toContain('"庁舎, ""ネットワーク"" 保守"');
    expect(exported.csv).toContain('"仕様書に ""別紙"" 参照あり"');
  });
});
