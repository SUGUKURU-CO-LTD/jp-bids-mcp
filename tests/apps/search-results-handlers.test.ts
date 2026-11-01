import { describe, expect, it, vi } from "vitest";
import {
  applyHostTheme,
  formatModelContextSummary,
  handleExportBids,
  handleInAppSearch,
  handleRankSelected,
  handleSyncModelContext,
} from "../../src/apps/search-results.js";
import type { Bid } from "../../src/domain/bid.js";

type SearchApp = Parameters<typeof handleInAppSearch>[0];
type RankingApp = Parameters<typeof handleRankSelected>[0];
type RankingSetter = Parameters<typeof handleRankSelected>[2];

describe("K1-a: searchCriteria preservation and in-app search handlers", () => {
  it("preserves certification, prefecture array, date ranges, and limit on in-app re-search", async () => {
    let calledToolName = "";
    let calledArgs: Record<string, unknown> = {};

    const mockApp = {
      getHostCapabilities: () => ({ serverTools: true }),
      callServerTool: vi.fn(async ({ name, arguments: args }) => {
        calledToolName = name;
        calledArgs = args;
        return {
          isError: false,
          structuredContent: {
            searchHits: 1,
            returnedCount: 1,
            bids: [],
          },
        };
      }),
    };

    let searchResultContent: unknown = null;
    let isSearching = false;
    let errorMessage = "";

    await handleInAppSearch(
      mockApp as unknown as SearchApp,
      "AIシステム保守",
      {
        certification: ["A", "B"],
        prefecture: ["東京都", "神奈川県"],
        category: "役務",
        procedure_type: "一般競争入札",
        issued_after: "2026-05-01",
        issued_before: "2026-05-15",
        due_after: "2026-05-20",
        due_before: "2026-06-01",
        limit: 30,
      },
      (content) => {
        searchResultContent = content;
      },
      (v) => {
        isSearching = v;
      },
      (msg) => {
        errorMessage = msg;
      },
    );

    expect(calledToolName).toBe("search_bids_app");
    expect(calledArgs.query).toBe("AIシステム保守");
    expect(calledArgs.certification).toEqual(["A", "B"]);
    expect(calledArgs.prefecture).toEqual(["東京都", "神奈川県"]);
    expect(calledArgs.category).toBe("役務");
    expect(calledArgs.procedure_type).toBe("一般競争入札");
    expect(calledArgs.issued_after).toBe("2026-05-01");
    expect(calledArgs.issued_before).toBe("2026-05-15");
    expect(calledArgs.due_after).toBe("2026-05-20");
    expect(calledArgs.due_before).toBe("2026-06-01");
    expect(calledArgs.limit).toBe(30);
    expect(errorMessage).toBe("");
    expect(searchResultContent).toBeDefined();
    expect(isSearching).toBe(false);
  });

  it("converts upstream KKJ style parameters (Certification, LG_Code, CFT_Issue_Date) to MCP search format", async () => {
    let calledArgs: Record<string, unknown> = {};

    const mockApp = {
      getHostCapabilities: () => ({ serverTools: true }),
      callServerTool: vi.fn(async ({ arguments: args }) => {
        calledArgs = args;
        return { isError: false, structuredContent: { bids: [] } };
      }),
    };

    await handleInAppSearch(
      mockApp as unknown as SearchApp,
      "新案件",
      {
        Certification: "A, B, C",
        LG_Code: "13, 14",
        Category: "3",
        Procedure_Type: "1",
        CFT_Issue_Date: "2026-04-01/2026-04-10",
        Tender_Submission_Deadline: "2026-04-20/2026-04-30",
        Count: "25",
      },
      vi.fn(),
      vi.fn(),
      vi.fn(),
    );

    expect(calledArgs.query).toBe("新案件");
    expect(calledArgs.certification).toEqual(["A", "B", "C"]);
    expect(calledArgs.prefecture).toEqual(["東京都", "神奈川県"]);
    expect(calledArgs.category).toBe("役務");
    expect(calledArgs.procedure_type).toBe("一般競争入札");
    expect(calledArgs.issued_after).toBe("2026-04-01");
    expect(calledArgs.issued_before).toBe("2026-04-10");
    expect(calledArgs.due_after).toBe("2026-04-20");
    expect(calledArgs.due_before).toBe("2026-04-30");
    expect(calledArgs.limit).toBe(25);
  });

  it("handles rank_bids and export_bid_shortlist with valid bid_refs and updates state", async () => {
    const bids: Bid[] = [
      {
        resultId: 1,
        key: "BID-1",
        projectName: "案件1",
        bidRef: "token_bid_1",
      },
      {
        resultId: 2,
        key: "BID-2",
        projectName: "案件2",
        bidRef: "token_bid_2",
      },
    ];

    const mockApp = {
      getHostCapabilities: () => ({ serverTools: true }),
      callServerTool: vi.fn(async ({ name, arguments: _args }) => {
        if (name === "rank_bids") {
          return {
            isError: false,
            structuredContent: {
              rankedCount: 2,
              rankedBids: [
                {
                  bid: { key: "BID-1" },
                  score: 85,
                  priority: "pursue",
                  reasons: ["適合要件あり"],
                },
                {
                  bid: { key: "BID-2" },
                  score: 45,
                  priority: "review",
                  reasons: ["納期要確認"],
                },
              ],
            },
          };
        }
        if (name === "export_bid_shortlist") {
          return {
            isError: false,
            structuredContent: {
              csv: "key,name\nBID-1,案件1\nBID-2,案件2\n",
            },
          };
        }
        return { isError: true };
      }),
    };

    let actionMessage = "";
    type ScoreEntry = { score: number; priority: "pursue" | "review" | "skip"; reasons: string[] };
    let scores = new Map<string, ScoreEntry>();
    const setRankingScores: RankingSetter = (fn) => {
      scores = typeof fn === "function" ? fn(scores) : fn;
    };

    await handleRankSelected(
      mockApp as unknown as RankingApp,
      bids,
      setRankingScores,
      vi.fn(),
      (msg) => {
        actionMessage = msg;
      },
    );

    expect(scores.get("BID-1")?.score).toBe(85);
    expect(scores.get("BID-1")?.priority).toBe("pursue");
    expect(actionMessage).toContain("2件の案件をサーバー評価で比較採点しました");

    // Test export CSV
    actionMessage = "";
    await handleExportBids(
      mockApp as unknown as RankingApp,
      bids,
      "選択CSV",
      (msg) => {
        actionMessage = msg;
      },
      "csv",
    );
    expect(mockApp.callServerTool).toHaveBeenCalledWith({
      name: "export_bid_shortlist",
      arguments: { bid_refs: ["token_bid_1", "token_bid_2"], format: "csv" },
    });

    // Test export JSON
    actionMessage = "";
    await handleExportBids(
      mockApp as unknown as RankingApp,
      bids,
      "選択JSON",
      (msg) => {
        actionMessage = msg;
      },
      "json",
    );
    expect(mockApp.callServerTool).toHaveBeenCalledWith({
      name: "export_bid_shortlist",
      arguments: { bid_refs: ["token_bid_1", "token_bid_2"], format: "json" },
    });
  });

  it("syncs model context including active bid and multi-select shortlist keys", async () => {
    let syncedContent: unknown = null;
    const mockApp = {
      getHostCapabilities: () => ({ updateModelContext: { text: {} } }),
      updateModelContext: vi.fn(async (payload: unknown) => {
        syncedContent = payload;
        return {};
      }),
    };

    const bid: Bid = {
      resultId: 1,
      key: "KKJ-2026-001",
      projectName: "基幹システム更新業務",
    };
    const card = {
      key: "KKJ-2026-001",
      projectName: "基幹システム更新業務",
      organizationName: "デジタル庁",
      prefectureName: "東京都",
      category: "役務",
      submissionDeadline: "2026-11-15",
      openingDate: "2026-11-20",
      cftIssueDate: "2026-10-20",
      daysUntilDeadline: 14,
      deadlineUrgency: "normal" as const,
      hasPdf: true,
      officialUrl: "https://www.digital.go.jp/bids/001.html",
      serverScore: 88,
      priorityLabel: "pursue" as const,
    };
    const workspace = {
      totalHits: 2,
      returnedCount: 2,
      cards: [card],
      dataSource: "官公需情報ポータルサイト",
      accessedAt: "2026-11-01T12:00:00Z",
    };

    const summaryWithoutSelection = formatModelContextSummary(bid, card, workspace, null, []);
    expect(summaryWithoutSelection).toContain("Key: KKJ-2026-001");
    expect(summaryWithoutSelection).toContain("Priority: pursue (88)");
    expect(summaryWithoutSelection).not.toContain("Selected count:");

    let actionMessage = "";
    await handleSyncModelContext(
      mockApp as unknown as SearchApp,
      bid,
      card,
      workspace,
      { score: 92, priority: "pursue", reasons: ["高適合"] },
      (msg) => {
        actionMessage = msg;
      },
      ["KKJ-2026-001", "KKJ-2026-002"],
    );

    expect(actionMessage).toBe("検索結果をHostの文脈へ同期しました。");
    expect(mockApp.updateModelContext).toHaveBeenCalledTimes(1);
    const text = (syncedContent as { content: Array<{ text: string }> }).content[0]?.text ?? "";
    expect(text).toContain("Priority: pursue (92)");
    expect(text).toContain("Selected count: 2 (KKJ-2026-001, KKJ-2026-002)");
  });

  it("applies host theme to document.documentElement.dataset.theme when available", () => {
    const originalDoc = globalThis.document;
    const mockDoc = {
      documentElement: {
        dataset: {} as Record<string, string | undefined>,
      },
    };
    Object.defineProperty(globalThis, "document", {
      value: mockDoc,
      configurable: true,
    });

    try {
      applyHostTheme("dark");
      expect(mockDoc.documentElement.dataset.theme).toBe("dark");

      applyHostTheme("light");
      expect(mockDoc.documentElement.dataset.theme).toBe("light");

      applyHostTheme(undefined);
      expect(mockDoc.documentElement.dataset.theme).toBeUndefined();
    } finally {
      Object.defineProperty(globalThis, "document", {
        value: originalDoc,
        configurable: true,
      });
    }
  });
});
