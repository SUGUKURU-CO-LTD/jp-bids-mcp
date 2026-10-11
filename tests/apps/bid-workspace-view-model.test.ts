import { describe, expect, it } from "vitest";
import {
  toBidCardViewModel,
  toWorkspaceViewModel,
} from "../../src/apps/bid-workspace-view-model.js";
import { createAttribution } from "../../src/domain/attribution.js";

const now = new Date("2026-05-03T09:00:00Z");

describe("bid workspace view model", () => {
  it("computes deadline urgency and quick score", () => {
    const card = toBidCardViewModel(
      {
        resultId: 1,
        key: "KKJ-001",
        projectName: "システム保守",
        organizationName: "鹿児島市",
        prefectureName: "鹿児島県",
        category: "役務",
        tenderSubmissionDeadline: "2026-05-06T17:00:00+09:00",
        openingTendersEvent: "2026-05-10T14:00:00+09:00",
        externalDocumentUri: "https://example.test/notice.pdf",
        certification: "A",
      },
      now,
    );

    expect(card.hasPdf).toBe(true);
    expect(card.daysUntilDeadline).toBeLessThanOrEqual(4);
    expect(card.deadlineUrgency).toBe("urgent");
    expect(card.quickScore).toBeGreaterThanOrEqual(70);
    expect(card.priorityLabel).toBe("pursue");
  });

  it("marks overdue bids", () => {
    const card = toBidCardViewModel(
      {
        resultId: 2,
        key: "KKJ-002",
        projectName: "庁舎工事",
        tenderSubmissionDeadline: "2026-04-30T17:00:00+09:00",
      },
      now,
    );

    expect(card.deadlineUrgency).toBe("overdue");
  });

  it("marks unknown deadlines", () => {
    const card = toBidCardViewModel({ resultId: 3, key: "KKJ-003", projectName: "物品購入" }, now);

    expect(card.daysUntilDeadline).toBeNull();
    expect(card.deadlineUrgency).toBe("unknown");
  });

  it("builds workspace view model from search result", () => {
    const vm = toWorkspaceViewModel(
      {
        searchHits: 1,
        returnedCount: 1,
        bids: [{ resultId: 1, key: "KKJ-001", projectName: "テスト" }],
        query: { Query: "テスト" },
        attribution: createAttribution(),
      },
      now,
    );

    expect(vm.cards).toHaveLength(1);
    expect(vm.totalHits).toBe(1);
    expect(vm.dataSource).toBe("中小企業庁 官公需情報ポータルサイト");
  });

  it("detects PDF from attachments", () => {
    const card = toBidCardViewModel(
      {
        resultId: 4,
        key: "KKJ-004",
        projectName: "清掃業務",
        attachments: [{ name: "仕様書.pdf", uri: "https://example.test/spec.pdf" }],
      },
      now,
    );

    expect(card.hasPdf).toBe(true);
  });

  it("K1-b: formats submissionDeadline in JST for ISO strings with times and offsets, matching calculation", () => {
    // Both deadlines represent the same instant: 2026-10-10 09:00:00 UTC (18:00 JST)
    const cardOffsetA = toBidCardViewModel(
      {
        resultId: 10,
        key: "KKJ-010",
        projectName: "offset -10:00",
        tenderSubmissionDeadline: "2026-10-09T23:00:00-10:00",
      },
      new Date("2026-10-10T08:30:00Z"),
    );
    const cardOffsetB = toBidCardViewModel(
      {
        resultId: 11,
        key: "KKJ-011",
        projectName: "offset +09:00",
        tenderSubmissionDeadline: "2026-10-10T18:00:00+09:00",
      },
      new Date("2026-10-10T08:30:00Z"),
    );

    // Both should format to the exact same JST date and time
    expect(cardOffsetA.submissionDeadline).toBe("2026-10-10 18:00 JST");
    expect(cardOffsetB.submissionDeadline).toBe("2026-10-10 18:00 JST");
    expect(cardOffsetA.rawDeadline).toBe("2026-10-09T23:00:00-10:00");
    expect(cardOffsetB.rawDeadline).toBe("2026-10-10T18:00:00+09:00");
    expect(cardOffsetA.deadlineUrgency).toBe(cardOffsetB.deadlineUrgency);

    // Date only: does NOT fabricate time
    const cardDateOnly = toBidCardViewModel(
      {
        resultId: 12,
        key: "KKJ-012",
        projectName: "日付のみ",
        tenderSubmissionDeadline: "2026-11-20",
      },
      now,
    );
    expect(cardDateOnly.submissionDeadline).toBe("2026-11-20");

    // Invalid date: preserves raw string
    const cardInvalid = toBidCardViewModel(
      {
        resultId: 13,
        key: "KKJ-013",
        projectName: "不正日",
        tenderSubmissionDeadline: "2026-02-31",
      },
      now,
    );
    expect(cardInvalid.submissionDeadline).toBe("2026-02-31");
  });
});
