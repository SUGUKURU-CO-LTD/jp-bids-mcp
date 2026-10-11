import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KkjClient } from "../../src/api/kkj-client.js";
import { type Bid, RankedBidSchema } from "../../src/domain/bid.js";
import {
  type BidRankingOptions,
  rankBid,
  rankSelectionBids,
} from "../../src/domain/bid-ranking.js";
import { signBidRef } from "../../src/domain/bid-ref.js";
import { escapeCsvCell, exportBidShortlist } from "../../src/domain/bid-shortlist.js";
import { setTestProfile } from "../../src/lib/profile.js";
import { createJpBidsServer } from "../../src/mcp.js";
import { registerExportBidShortlist } from "../../src/tools/export-bid-shortlist.js";
import { registerRankBids } from "../../src/tools/rank-bids.js";

const TEST_SECRET = "test-secret-at-least-32-bytes-long-for-signing";
const BASE_URL = "https://jp-bids.local";

const sampleBid1: Bid = {
  resultId: 101,
  key: "2026-CLOUD-01",
  projectName: "官庁クラウドインフラ保守業務",
  organizationName: "デジタル庁",
  prefectureName: "東京都",
  category: "役務",
  procedureType: "一般競争入札",
  cftIssueDate: "2026-04-01",
  tenderSubmissionDeadline: "2026-05-15",
  externalDocumentUri: "https://example.go.jp/1",
};

const sampleBid2: Bid = {
  resultId: 102,
  key: "2026-CONST-02",
  projectName: "庁舎空調設備更新工事",
  organizationName: "国土交通省",
  prefectureName: "東京都",
  category: "工事",
  procedureType: "一般競争入札",
  cftIssueDate: "2026-04-02",
  tenderSubmissionDeadline: "2026-04-10",
  externalDocumentUri: "https://example.go.jp/2",
};

describe("U2-R: Selection Ranking, Shortlist Export & CSV Defense (B05, B07, B08)", () => {
  beforeEach(() => {
    process.env.JP_BIDS_OAUTH_SECRET = TEST_SECRET;
    process.env.JP_BIDS_BASE_URL = BASE_URL;
    setTestProfile("public_mvp");
  });

  // B05: Selection Comparison (Only selected bids, Score & Reason Parity)
  describe("B05: Selection comparison only ranks selected bids with scoring parity", () => {
    it("B05-01: rankSelectionBids ranks provided bid_refs preserving original selectionIndex without external items", () => {
      const options: BidRankingOptions = {
        preferredKeywords: ["クラウド"],
        avoidKeywords: ["工事"],
      };

      const ref1 = signBidRef(sampleBid1, {
        masterSecret: TEST_SECRET,
        baseUrl: BASE_URL,
        fetchedAt: "2026-04-01T00:00:00Z",
      });
      const ref2 = signBidRef(sampleBid2, {
        masterSecret: TEST_SECRET,
        baseUrl: BASE_URL,
        fetchedAt: "2026-04-01T00:00:00Z",
      });

      const inputBids = [
        { ...sampleBid2, bidRef: ref2 },
        { ...sampleBid1, bidRef: ref1 },
      ];

      const result = rankSelectionBids(inputBids, options);

      expect(result.rankedCount).toBe(2);
      expect(result.rankedBids[0].bid.key).toBe(sampleBid1.key);
      expect(result.rankedBids[0].selectionIndex).toBe(1); // was index 1 in input
      expect(result.rankedBids[1].bid.key).toBe(sampleBid2.key);
      expect(result.rankedBids[1].selectionIndex).toBe(0); // was index 0 in input
    });

    it("B05-02: guarantees exact score, priority, and reason parity between search ranking and bid_ref snapshot ranking at same asOf", () => {
      const fixedAsOf = new Date("2026-04-05T00:00:00Z");
      const options: BidRankingOptions = {
        preferredKeywords: ["クラウド"],
        avoidKeywords: ["工事"],
        now: fixedAsOf,
      };

      // 1. Direct ranking from search
      const directRanked = rankBid(sampleBid1, options);

      // 2. Snapshot via bid_ref
      const ref1 = signBidRef(sampleBid1, {
        masterSecret: TEST_SECRET,
        baseUrl: BASE_URL,
        fetchedAt: "2026-04-01T00:00:00Z",
      });
      const snapshotRanked = rankSelectionBids([{ ...sampleBid1, bidRef: ref1 }], options);

      expect(snapshotRanked.rankedBids[0].score).toBe(directRanked.score);
      expect(snapshotRanked.rankedBids[0].priority).toBe(directRanked.priority);
      expect(snapshotRanked.rankedBids[0].reasons).toEqual(directRanked.reasons);
      expect(snapshotRanked.rankedBids[0].risks).toEqual(directRanked.risks);
      expect(snapshotRanked.rankedBids[0].deadlineStatus).toBe(directRanked.deadlineStatus);
    });

    it("B05-03: RankedBidSchema validates selectionIndex: 0 without schema violation", () => {
      const rankedBid = {
        bid: sampleBid1,
        score: 75,
        priority: "review" as const,
        reasons: ["テスト理由"],
        risks: [],
        nextActions: ["公式書類の確認"],
        selectionIndex: 0,
      };
      const parsed = RankedBidSchema.safeParse(rankedBid);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.selectionIndex).toBe(0);
      }
    });
  });

  // B07: Selected CSV/JSON Count, Keys, Order, URLs (No Truncation to 10)
  describe("B07: Selection export preserves all 11-50 selected items without truncation", () => {
    it("B07-01: exporting 11 selected items does NOT truncate to default 10", () => {
      const bids: Bid[] = Array.from({ length: 11 }, (_, i) => ({
        resultId: 200 + i,
        key: `2026-SELECT-${String(i + 1).padStart(2, "0")}`,
        projectName: `選定案件第${i + 1}号`,
        organizationName: `発注機関_${i + 1}`,
        prefectureName: "東京都",
        category: "役務",
        procedureType: "一般競争入札",
        cftIssueDate: "2026-04-01",
        tenderSubmissionDeadline: "2026-04-20",
        externalDocumentUri: `https://example.go.jp/notices/${i + 1}`,
      }));

      const rankingResult = rankSelectionBids(bids);
      expect(rankingResult.rankedCount).toBe(11);

      // 1. Export CSV: must contain all 11 rows + 1 header row = 12 lines
      const csvExport = exportBidShortlist(rankingResult, undefined, "csv");
      expect(csvExport.format).toBe("csv");
      const lines = csvExport.csv?.trim().split("\n") ?? [];
      expect(lines.length).toBe(12); // header + 11 items
      expect(csvExport.csv).toContain("2026-SELECT-11");

      // 2. Export JSON: must contain all 11 items
      const jsonExport = exportBidShortlist(rankingResult, undefined, "json");
      expect(jsonExport.format).toBe("json");
      expect(jsonExport.jsonContent?.length).toBe(11);
      expect(jsonExport.jsonContent?.[10]?.key).toBe("2026-SELECT-11");
      expect(jsonExport.jsonContent?.[10]?.official_url).toBe("https://example.go.jp/notices/11");
    });

    it("B07-02: exporting 50 items (maximum bound) preserves all 50 items and verified keys/URLs", () => {
      const bids: Bid[] = Array.from({ length: 50 }, (_, i) => ({
        resultId: 300 + i,
        key: `2026-MAX-${String(i + 1).padStart(2, "0")}`,
        projectName: `大規模選定案件_${i + 1}`,
        organizationName: `自治体_${i + 1}`,
        prefectureName: "大阪府",
        category: "役務",
        procedureType: "一般競争入札",
        cftIssueDate: "2026-04-01",
        tenderSubmissionDeadline: "2026-04-30",
        externalDocumentUri: `https://example.go.jp/max/${i + 1}`,
      }));

      const rankingResult = rankSelectionBids(bids);
      expect(rankingResult.rankedCount).toBe(50);

      const jsonExport = exportBidShortlist(rankingResult, undefined, "json");
      expect(jsonExport.jsonContent?.length).toBe(50);
      expect(jsonExport.jsonContent?.[0]?.key).toBe("2026-MAX-01");
      expect(jsonExport.jsonContent?.[49]?.key).toBe("2026-MAX-50");
    });

    it("B07-03: exportBidShortlist preserves original selection order [LOW, HIGH] regardless of rank scores", () => {
      const lowScoreBid: Bid = {
        ...sampleBid2,
        key: "KEY-LOW",
        projectName: "低スコア案件",
      };
      const highScoreBid: Bid = {
        ...sampleBid1,
        key: "KEY-HIGH",
        projectName: "高スコア案件",
      };

      const rankingResult = {
        rankedBids: [
          {
            bid: highScoreBid,
            score: 95,
            priority: "pursue" as const,
            reasons: ["適合度高"],
            risks: [],
            nextActions: ["提案書作成"],
            selectionIndex: 1,
          },
          {
            bid: lowScoreBid,
            score: 30,
            priority: "skip" as const,
            reasons: ["回避キーワード一致"],
            risks: [],
            nextActions: ["見送り理由の記録"],
            selectionIndex: 0,
          },
        ],
        query: {},
        rankedCount: 2,
        unrankedCount: 0,
        options: {},
        attribution: { dataSource: "KKJ" },
      };

      const exported = exportBidShortlist(rankingResult, undefined, "json");
      expect(exported.jsonContent?.length).toBe(2);
      expect(exported.jsonContent?.[0]?.key).toBe("KEY-LOW");
      expect(exported.jsonContent?.[1]?.key).toBe("KEY-HIGH");
    });

    it("B07-04: rank_bids and export_bid_shortlist reject duplicate bid_refs or duplicate keys in selection mode", async () => {
      const server = new McpServer({ name: "test", version: "1.0.0" });
      const mockClient = { search: vi.fn() } as unknown as KkjClient;
      registerRankBids(server, mockClient);
      registerExportBidShortlist(server, mockClient);

      const ref1 = signBidRef(sampleBid1, {
        masterSecret: TEST_SECRET,
        baseUrl: BASE_URL,
      });

      // @ts-expect-error accessing registered tool handler
      const rankHandler = server._registeredTools.rank_bids.handler;
      const rankRes = await rankHandler({
        bid_refs: [ref1, ref1],
      });
      expect(rankRes.isError).toBe(true);
      expect(rankRes.content[0].text).toContain("重複");

      // @ts-expect-error accessing registered tool handler
      const exportHandler = server._registeredTools.export_bid_shortlist.handler;
      const exportRes = await exportHandler({
        bid_refs: [ref1, ref1],
      });
      expect(exportRes.isError).toBe(true);
      expect(exportRes.content[0].text).toContain("重複");
    });

    it("B07-05: real local MCP Client->Server handles 1, 11, and 50 selected items without truncation", async () => {
      const server = createJpBidsServer({ profile: "public_mvp" });
      const client = new Client({ name: "mcp-e2e-selection-test", version: "1.0.0" });
      const [ct, st] = InMemoryTransport.createLinkedPair();
      await Promise.all([server.connect(st), client.connect(ct)]);

      const makeBids = (count: number) =>
        Array.from({ length: count }, (_, i) => ({
          resultId: 500 + i,
          key: `2026-E2E-${String(i + 1).padStart(2, "0")}`,
          projectName: `E2E案件_${i + 1}`,
          organizationName: `組織_${i + 1}`,
          prefectureName: "東京都",
          category: "役務",
          procedureType: "一般競争入札",
          cftIssueDate: "2026-04-01",
          tenderSubmissionDeadline: "2026-05-15",
          externalDocumentUri: `https://example.go.jp/e2e/${i + 1}`,
        }));

      // Test 1 item
      const bids1 = makeBids(1);
      const refs1 = bids1.map((b) =>
        signBidRef(b, { masterSecret: TEST_SECRET, baseUrl: BASE_URL }),
      );
      const rankRes1 = await client.callTool({
        name: "rank_bids",
        arguments: { bid_refs: refs1 },
      });
      expect(rankRes1.isError).toBeFalsy();
      const rankData1 = rankRes1.structuredContent as { rankedCount: number };
      expect(rankData1.rankedCount).toBe(1);

      // Test 11 items (proves NO truncation to 10)
      const bids11 = makeBids(11);
      const refs11 = bids11.map((b) =>
        signBidRef(b, { masterSecret: TEST_SECRET, baseUrl: BASE_URL }),
      );
      const rankRes11 = await client.callTool({
        name: "rank_bids",
        arguments: { bid_refs: refs11 },
      });
      expect(rankRes11.isError).toBeFalsy();
      const rankData11 = rankRes11.structuredContent as { rankedCount: number };
      expect(rankData11.rankedCount).toBe(11);

      const exportRes11 = await client.callTool({
        name: "export_bid_shortlist",
        arguments: { bid_refs: refs11, format: "csv" },
      });
      expect(exportRes11.isError).toBeFalsy();
      const exportData11 = exportRes11.structuredContent as { rankedCount: number; csv: string };
      expect(exportData11.rankedCount).toBe(11);
      const csvLines11 = exportData11.csv.trim().split(/\r?\n/);
      expect(csvLines11.length).toBe(12); // header + 11 items

      // Test 50 items (proves full capacity preserved)
      const bids50 = makeBids(50);
      const refs50 = bids50.map((b) =>
        signBidRef(b, { masterSecret: TEST_SECRET, baseUrl: BASE_URL }),
      );
      const exportRes50 = await client.callTool({
        name: "export_bid_shortlist",
        arguments: { bid_refs: refs50, format: "json" },
      });
      expect(exportRes50.isError).toBeFalsy();
      const exportData50 = exportRes50.structuredContent as {
        rankedCount: number;
        jsonContent: unknown[];
      };
      expect(exportData50.rankedCount).toBe(50);
      expect(exportData50.jsonContent.length).toBe(50);

      await client.close();
      await server.close();
    });
  });

  // B08: Formula Injection Defense, Special Characters & Mutual Exclusion
  describe("B08: Formula injection defense, special characters, and mutual exclusion", () => {
    it("B08-01: escapeCsvCell prepends ' to formula injection trigger characters (=, +, -, @, \\t, \\r)", () => {
      expect(escapeCsvCell("=CMD('calc')")).toBe("'=CMD('calc')");
      expect(escapeCsvCell("+SUM(A1:B10)")).toBe("'+SUM(A1:B10)");
      expect(escapeCsvCell("-100")).toBe("'-100");
      expect(escapeCsvCell("@formula")).toBe("'@formula");
      expect(escapeCsvCell("\tindented")).toBe("'\tindented");
      // \r is a newline character, so it is both prepended with ' and wrapped in double quotes by CSV standard
      expect(escapeCsvCell("\rcarriage")).toBe('"\'\rcarriage"');
    });

    it("B08-02: handles Japanese characters, quotes, and commas safely in CSV export", () => {
      expect(escapeCsvCell("通常テキスト（令和8年度）")).toBe("通常テキスト（令和8年度）");
      expect(escapeCsvCell('タイトルに"引用符"あり')).toBe('"タイトルに""引用符""あり"');
      expect(escapeCsvCell("東京都,千代田区")).toBe('"東京都,千代田区"');
      expect(escapeCsvCell("=1+1,2+2")).toBe('"\'=1+1,2+2"');
    });

    it("B08-03: rank_bids rejects combining search parameters with bid_refs (mutual exclusion)", async () => {
      const server = new McpServer({ name: "test", version: "1.0.0" });
      const mockClient = { search: vi.fn() } as unknown as KkjClient;
      registerRankBids(server, mockClient);

      const ref1 = signBidRef(sampleBid1, {
        masterSecret: TEST_SECRET,
        baseUrl: BASE_URL,
        fetchedAt: "2026-04-01T00:00:00Z",
      });

      // @ts-expect-error accessing registered tool handler directly for test
      const toolHandler = server._registeredTools.rank_bids.handler;
      const res = await toolHandler({
        bid_refs: [ref1],
        query: "デジタル",
      });

      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain(
        "bid_refs 指定時は検索条件（query, prefecture等）を同時に指定できません",
      );
      expect(mockClient.search).not.toHaveBeenCalled();
    });

    it("B08-04: export_bid_shortlist rejects combining search parameters with bid_refs (mutual exclusion)", async () => {
      const server = new McpServer({ name: "test", version: "1.0.0" });
      const mockClient = { search: vi.fn() } as unknown as KkjClient;
      registerExportBidShortlist(server, mockClient);

      const ref1 = signBidRef(sampleBid1, {
        masterSecret: TEST_SECRET,
        baseUrl: BASE_URL,
        fetchedAt: "2026-04-01T00:00:00Z",
      });

      // @ts-expect-error accessing registered tool handler directly
      const toolHandler = server._registeredTools.export_bid_shortlist.handler;
      const res = await toolHandler({
        bid_refs: [ref1],
        prefecture: "東京都",
      });

      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain(
        "bid_refs 指定時は検索条件（query, prefecture等）を同時に指定できません",
      );
      expect(mockClient.search).not.toHaveBeenCalled();
    });

    it("B08-05: rejects fetch_documents: true in public_mvp profile", async () => {
      const server = new McpServer({ name: "test", version: "1.0.0" });
      const mockClient = { search: vi.fn() } as unknown as KkjClient;
      registerExportBidShortlist(server, mockClient);

      // @ts-expect-error accessing registered tool handler directly
      const toolHandler = server._registeredTools.export_bid_shortlist.handler;
      const res = await toolHandler({
        query: "システム",
        fetch_documents: true,
      });

      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain(
        "Public MVP では shortlist の一括資料抽出 (fetch_documents) は無効です",
      );
    });
  });
});
