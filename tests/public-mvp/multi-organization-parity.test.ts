import { describe, expect, it } from "vitest";
import type { Bid, BidSearchResult } from "../../src/domain/bid.js";
import { rankBid, rankBidSearchResult, rankSelectionBids } from "../../src/domain/bid-ranking.js";
import { exportBidShortlist } from "../../src/domain/bid-shortlist.js";
import { createAttribution } from "../../src/domain/attribution.js";

const multiOrgBids: Bid[] = [
  {
    resultId: 1,
    key: "key_mof_1",
    projectName: "高度情報化セミナー動画作成に係る業務委託(区分２)",
    organizationName: "財務省",
    prefectureName: "東京都",
    category: "役務",
    procedureType: "一般競争入札",
    cftIssueDate: "2026-10-16T00:00:00+09:00",
    externalDocumentUri: "https://www.p-portal.go.jp/pps-web-biz/UAA01/OAA0101",
  },
  {
    resultId: 2,
    key: "key_mof_2",
    projectName: "高度情報化セミナー動画作成に係る業務委託(区分１)",
    organizationName: "財務省",
    prefectureName: "東京都",
    category: "役務",
    procedureType: "一般競争入札",
    cftIssueDate: "2026-10-16T00:00:00+09:00",
    externalDocumentUri: "https://www.p-portal.go.jp/pps-web-biz/UAA01/OAA0101",
  },
  {
    resultId: 3,
    key: "key_mod_1",
    projectName: "【防衛装備庁】海洋監視システムの設置作業役務",
    organizationName: "防衛省",
    prefectureName: "東京都",
    category: "役務",
    procedureType: "一般競争入札",
    cftIssueDate: "2026-10-16T00:00:00+09:00",
    externalDocumentUri: "https://www.p-portal.go.jp/pps-web-biz/UAA01/OAA0101",
  },
  {
    resultId: 4,
    key: "key_mof_3",
    projectName: "社屋状況等調査業務委託",
    organizationName: "財務省",
    prefectureName: "東京都",
    category: "役務",
    procedureType: "一般競争入札",
    cftIssueDate: "2026-10-13T00:00:00+09:00",
    externalDocumentUri: "https://www.p-portal.go.jp/pps-web-biz/UAA01/OAA0101",
  },
  {
    resultId: 5,
    key: "key_env_1",
    projectName: "令和８年度福島復興現場におけるGX建設機械試行工事に関する調査委託業務",
    organizationName: "環境省",
    prefectureName: "東京都",
    category: "役務",
    procedureType: "一般競争入札",
    cftIssueDate: "2026-10-09T00:00:00+09:00",
    externalDocumentUri: "https://www.p-portal.go.jp/pps-web-biz/UAA01/OAA0101",
  },
  {
    resultId: 6,
    key: "key_setagaya_1",
    projectName: "レセプト管理標準準拠システム移行及び運用・保守業務委託(公募型プロポーザル)",
    organizationName: "東京都世田谷区",
    prefectureName: "東京都",
    category: "役務",
    procedureType: "公募型プロポーザル",
    cftIssueDate: "2026-10-08T00:00:00+09:00",
    externalDocumentUri: "https://www.city.setagaya.lg.jp/documents/36280/03_koukokubun.docx",
  },
  {
    resultId: 7,
    key: "key_mext_1",
    projectName: "独立行政法人日本学術振興会業務基盤システム更新・保守業務",
    organizationName: "独立行政法人日本学術振興会",
    prefectureName: "東京都",
    category: "役務",
    procedureType: "一般競争入札",
    cftIssueDate: "2026-10-16T00:00:00+09:00",
    externalDocumentUri: "https://www.p-portal.go.jp/pps-web-biz/UAA01/OAA0101",
  },
];

describe("Multi-Organization Reason & Parity Defense", () => {
  it("OR-01: ensures reasons consistently match bid.organizationName across all ranking results", () => {
    const searchResult: BidSearchResult = {
      searchHits: multiOrgBids.length,
      returnedCount: multiOrgBids.length,
      bids: multiOrgBids,
      query: { query: "システム" },
      attribution: createAttribution(),
    };

    const ranked = rankBidSearchResult(searchResult, { shortlistLimit: 10 });

    for (const item of ranked.rankedBids) {
      const orgReason = item.reasons.find((r) => r.startsWith("発注機関が確認できる:"));
      expect(orgReason).toBeDefined();
      expect(orgReason).toBe(`発注機関が確認できる: ${item.bid.organizationName}`);
    }
  });

  it("OR-02: ensures CSV organization_name column strictly matches fit_reasons for every row", () => {
    const searchResult: BidSearchResult = {
      searchHits: multiOrgBids.length,
      returnedCount: multiOrgBids.length,
      bids: multiOrgBids,
      query: { query: "システム" },
      attribution: createAttribution(),
    };

    const ranked = rankBidSearchResult(searchResult, { shortlistLimit: 10 });
    const exported = exportBidShortlist(ranked, undefined, "csv");

    const lines = exported.csv.split("\n");
    const header = lines[0].split(",");
    const orgColIdx = header.indexOf("organization_name");
    const reasonsColIdx = header.indexOf("fit_reasons");

    expect(orgColIdx).toBeGreaterThanOrEqual(0);
    expect(reasonsColIdx).toBeGreaterThanOrEqual(0);

    // Verify data rows (skip header)
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;

      // Simple CSV split (note: fit_reasons is quoted)
      const matches = [...line.matchAll(/(?:^|,)(?:"([^"]*(?:""[^"]*)*)"|([^",]*))/g)];
      const cells = matches.map((m) => (m[1] !== undefined ? m[1].replaceAll('""', '"') : (m[2] ?? "")));

      const orgName = cells[orgColIdx];
      const fitReasons = cells[reasonsColIdx];

      expect(orgName).toBeTruthy();
      expect(fitReasons).toContain(`発注機関が確認できる: ${orgName}`);

      // Crucial: Ensure other organizations do NOT contaminate this row's fit_reasons
      for (const otherBid of multiOrgBids) {
        if (otherBid.organizationName && otherBid.organizationName !== orgName) {
          expect(fitReasons).not.toContain(`発注機関が確認できる: ${otherBid.organizationName}`);
        }
      }
    }
  });

  it("OR-03: preserves organization purity regardless of input array ordering and shuffling", () => {
    // Reverse order (Environment Ministry first, then MOF, MOD, etc.)
    const reversedBids = [...multiOrgBids].reverse();
    const rankedReversed = rankSelectionBids(reversedBids);
    const exportedReversed = exportBidShortlist(rankedReversed, undefined, "csv");

    for (const item of rankedReversed.rankedBids) {
      const orgReason = item.reasons.find((r) => r.startsWith("発注機関が確認できる:"));
      expect(orgReason).toBe(`発注機関が確認できる: ${item.bid.organizationName}`);
    }

    expect(exportedReversed.csv).toContain("環境省");
    expect(exportedReversed.csv).toContain("発注機関が確認できる: 環境省");
  });
});
