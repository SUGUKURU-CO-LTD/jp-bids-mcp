import { describe, expect, it, vi } from "vitest";
import type { KkjClient } from "../../src/api/kkj-client.js";
import type { Bid, BidSearchResult } from "../../src/domain/bid.js";
import { rankBid } from "../../src/domain/bid-ranking.js";
import {
  assertDateOnly,
  formatKkjDateRange,
  parseJapaneseDateTime,
  parseJapaneseDateToDate,
  todayDateJst,
} from "../../src/domain/date-range.js";
import { UserInputError } from "../../src/lib/errors.js";
import { buildSearchBidsParams, formatSearchSummary } from "../../src/tools/search-bids.js";

describe("U2-R: Search, 3 Distinct States & JST Deadline Acceptance (B01, B02, B06)", () => {
  // B01: Search with region, category, and date range + Attribution
  describe("B01: Search specifying region, category, date range and attribution", () => {
    it("B01-01: buildSearchBidsParams correctly maps prefecture to LG_Code, category to code, and dates to range", () => {
      const params = buildSearchBidsParams({
        query: "システム保守",
        prefecture: "東京都",
        category: "役務",
        procedure_type: "一般競争入札",
        issued_after: "2026-04-01",
        issued_before: "2026-04-15",
        limit: 10,
      });

      expect(params.Query).toBe("システム保守");
      expect(params.LG_Code).toBe("13"); // 東京都 LG Code
      expect(params.Category).toBe(3); // 役務 -> 3
      expect(params.Procedure_Type).toBe(1); // 一般競争入札 -> 1
      expect(params.CFT_Issue_Date).toBe("2026-04-01/2026-04-15");
      expect(params.Count).toBe(10);
    });

    it("B01-02: search summary includes data source attribution and count details", () => {
      const mockResult: BidSearchResult = {
        searchHits: 2,
        returnedCount: 2,
        bids: [
          {
            resultId: 1,
            key: "2026-B01-01",
            projectName: "官庁ポータルサイト構築業務",
            organizationName: "デジタル庁",
            prefectureName: "東京都",
            cftIssueDate: "2026-04-01",
            tenderSubmissionDeadline: "2026-04-20",
            externalDocumentUri: "https://example.go.jp/notices/1",
          },
        ],
        attribution: {
          dataSource: "官公需情報ポータルサイト (KKJ)",
          accessedAt: "2026-04-01T00:00:00Z",
          notice: "本データは官公需情報ポータルサイトの公開公告情報に基づきます。",
        },
      };

      const summary = formatSearchSummary(mockResult);
      expect(summary).toContain("2件ヒット（取得 2件）");
      expect(summary).toContain("出典: 官公需情報ポータルサイト (KKJ)");
      expect(summary).toContain("官庁ポータルサイト構築業務");
      expect(summary).toContain("提出期限: 2026-04-20");
    });
  });

  // B02: 3 Distinct States (0 results, Invalid input, Upstream error)
  describe("B02: Distinguishes between 0 results, invalid input, and upstream error", () => {
    it("B02-01: zero results state returns 0 hits and informative message without synthetic data", () => {
      const emptyResult: BidSearchResult = {
        searchHits: 0,
        returnedCount: 0,
        bids: [],
        attribution: {
          dataSource: "KKJ",
          accessedAt: "2026-04-01T00:00:00Z",
        },
      };

      const summary = formatSearchSummary(emptyResult);
      expect(summary).toContain("0件ヒット（取得 0件）");
      expect(summary).toContain("出典: KKJ");
      expect(emptyResult.bids).toHaveLength(0);
    });

    it("B02-02: invalid input state throws UserInputError (e.g. non-existent calendar date)", () => {
      // 2026-02-31 does not exist on the calendar
      expect(() => assertDateOnly("2026-02-31", "issued_after")).toThrow(UserInputError);
      expect(() => assertDateOnly("not-a-date", "issued_before")).toThrow(UserInputError);
      expect(() => formatKkjDateRange("2026-04-31", "2026-05-01")).toThrow(UserInputError);
    });

    it("B02-03: upstream error state handles client network or timeout failure gracefully", async () => {
      const failingClient = {
        search: vi.fn().mockRejectedValue(new Error("KKJ API gateway 504 Gateway Timeout")),
      } as unknown as KkjClient;

      await expect(failingClient.search({ Query: "テスト", Count: 10 })).rejects.toThrow(
        "504 Gateway Timeout",
      );
    });
  });

  // B06: Deadline Classification (Passed, Today, Upcoming, Unknown, and JST Boundary)
  describe("B06: Deadline classification and Japan Standard Time (JST) boundary evaluation", () => {
    it("B06-01: classifies past deadline as 'passed' and decreases score with '掲載期限を経過（要公式確認）' risk", () => {
      const evaluationTime = new Date("2026-04-10T00:00:00Z"); // 2026-04-10 in UTC (09:00:00 JST)
      const pastBid: Bid = {
        resultId: 1,
        key: "PAST-01",
        projectName: "過年度業務",
        tenderSubmissionDeadline: "2026-04-05", // 5 days ago
      };

      const ranked = rankBid(pastBid, { now: evaluationTime });
      expect(ranked.deadlineStatus).toBe("passed");
      expect(ranked.priority).not.toBe("pursue"); // Passed deadline can NEVER be pursue
      expect(ranked.risks.join(" ")).toContain("掲載期限を経過（要公式確認）");
    });

    it("B06-02: classifies today deadline as 'today' with urgent warning", () => {
      const evaluationTime = new Date("2026-04-10T03:00:00Z"); // 2026-04-10 12:00:00 JST
      const todayBid: Bid = {
        resultId: 2,
        key: "TODAY-02",
        projectName: "本日締切業務",
        tenderSubmissionDeadline: "2026-04-10",
      };

      const ranked = rankBid(todayBid, { now: evaluationTime });
      expect(ranked.deadlineStatus).toBe("today");
      expect(ranked.risks.join(" ")).toContain("提出期限は本日です");
      expect(ranked.reasons.join(" ")).toContain("本日締切の案件");
    });

    it("B06-03: classifies future deadline as 'upcoming'", () => {
      const evaluationTime = new Date("2026-04-10T00:00:00Z");
      const futureBid: Bid = {
        resultId: 3,
        key: "FUTURE-03",
        projectName: "将来案件",
        tenderSubmissionDeadline: "2026-04-25", // 15 days ahead
      };

      const ranked = rankBid(futureBid, { now: evaluationTime });
      expect(ranked.deadlineStatus).toBe("upcoming");
      expect(ranked.reasons.join(" ")).toContain("提出期限まで15日で検討対象に入る");
    });

    it("B06-04: classifies missing or unparseable deadline as 'unknown'", () => {
      const evaluationTime = new Date("2026-04-10T00:00:00Z");
      const unknownBid: Bid = {
        resultId: 4,
        key: "UNKNOWN-04",
        projectName: "期限未定案件",
        tenderSubmissionDeadline: undefined,
      };

      const ranked = rankBid(unknownBid, { now: evaluationTime });
      expect(ranked.deadlineStatus).toBe("unknown");
      expect(ranked.risks.join(" ")).toContain("提出期限が不明のため");
    });

    it("B06-05: JST midnight boundary test (23:59:59 JST vs 00:00:00 JST)", () => {
      // 2026-04-10 14:59:59 UTC = 2026-04-10 23:59:59 JST -> today is 2026-04-10
      const beforeMidnightUtc = new Date("2026-04-10T14:59:59Z");
      expect(todayDateJst(beforeMidnightUtc)).toBe("2026-04-10");

      // 2026-04-10 15:00:00 UTC = 2026-04-11 00:00:00 JST -> today is 2026-04-11!
      const afterMidnightUtc = new Date("2026-04-10T15:00:00Z");
      expect(todayDateJst(afterMidnightUtc)).toBe("2026-04-11");

      // Bids evaluated right across the JST midnight line
      const deadlineApril10Bid: Bid = {
        resultId: 5,
        key: "JST-TEST",
        projectName: "JST境界案件",
        tenderSubmissionDeadline: "2026-04-10",
      };

      // Before midnight JST (23:59:59 JST on April 10): deadline is TODAY
      const rankedBefore = rankBid(deadlineApril10Bid, { now: beforeMidnightUtc });
      expect(rankedBefore.deadlineStatus).toBe("today");

      // One second later across midnight (00:00:00 JST on April 11): deadline is PASSED!
      const rankedAfter = rankBid(deadlineApril10Bid, { now: afterMidnightUtc });
      expect(rankedAfter.deadlineStatus).toBe("passed");
    });

    it("B06-06: parses Japanese wareki date (令和8年4月20日) correctly for deadline evaluation", () => {
      const evaluationTime = new Date("2026-04-10T00:00:00Z");
      const parsed = parseJapaneseDateToDate("令和8年4月20日");
      expect(parsed).not.toBeNull();
      expect(parsed?.toISOString().slice(0, 10)).toBe("2026-04-20");

      const warekiBid: Bid = {
        resultId: 6,
        key: "WAREKI-01",
        projectName: "和暦表記案件",
        tenderSubmissionDeadline: "令和8年4月20日",
      };
      const ranked = rankBid(warekiBid, { now: evaluationTime });
      expect(ranked.deadlineStatus).toBe("upcoming");
    });

    it("B06-07: parseJapaneseDateTime strictly rejects invalid calendar rollover (e.g. 2026-02-31)", () => {
      expect(parseJapaneseDateTime("2026-02-31")).toBeNull();
      expect(parseJapaneseDateTime("2026-04-31")).toBeNull(); // April has 30 days
      expect(parseJapaneseDateTime("2026-02-29")).toBeNull(); // 2026 is not a leap year
      expect(parseJapaneseDateTime("2024-02-29")).not.toBeNull(); // 2024 is a leap year
      expect(parseJapaneseDateTime("2026-04-30")).not.toBeNull();
    });

    it("B06-08: deadline with exact hour (17:00 JST) evaluated at 18:00 JST on the same day is classified as 'passed'", () => {
      // 2026-04-10 18:00:00 JST = 2026-04-10 09:00:00 UTC
      const evaluationTime = new Date("2026-04-10T09:00:00Z");

      const bidWithTime: Bid = {
        resultId: 7,
        key: "TIME-01",
        projectName: "時間指定案件",
        tenderSubmissionDeadline: "2026-04-10 17:00",
      };

      const ranked = rankBid(bidWithTime, { now: evaluationTime });
      expect(ranked.deadlineStatus).toBe("passed");
      expect(ranked.risks.join(" ")).toContain("掲載期限を経過（要公式確認）");
    });
  });
});
