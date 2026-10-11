import type { Bid, BidSearchResult } from "../domain/bid.js";
import { parseJapaneseDateTime, todayDateJst } from "../domain/date-range.js";

export interface BidCardViewModel {
  key: string;
  projectName: string;
  organizationName: string;
  prefectureName: string;
  category: string;
  cftIssueDate: string;
  submissionDeadline: string;
  openingDate: string;
  officialUrl: string;
  hasPdf: boolean;
  daysUntilDeadline: number | null;
  deadlineUrgency: "overdue" | "urgent" | "normal" | "unknown";
  quickScore: number;
  priorityLabel: "pursue" | "review" | "skip";
  actionState: "unread" | "pdf_extracted" | "qualified" | "memo_created";
  bidRef?: string | undefined;
  serverScore?: number | undefined;
  serverReason?: string | undefined;
  rawDeadline?: string | undefined;
}

export interface WorkspaceViewModel {
  cards: BidCardViewModel[];
  totalHits: number;
  returnedCount: number;
  dataSource: string;
  accessedAt: string;
}

export function toWorkspaceViewModel(
  result: BidSearchResult,
  now: Date = new Date(),
): WorkspaceViewModel {
  return {
    cards: result.bids.map((bid) => toBidCardViewModel(bid, now)),
    totalHits: result.searchHits,
    returnedCount: result.returnedCount,
    dataSource: result.attribution.dataSource,
    accessedAt: result.attribution.accessedAt,
  };
}

export function toBidCardViewModel(bid: Bid, now: Date = new Date()): BidCardViewModel {
  const hasPdf =
    bid.fileType === "pdf" ||
    (bid.externalDocumentUri ?? "").toLowerCase().endsWith(".pdf") ||
    (bid.attachments ?? []).some((attachment) => attachment.name.toLowerCase().endsWith(".pdf"));

  const daysUntilDeadline = computeDaysUntilDeadline(bid.tenderSubmissionDeadline, now);
  const deadlineUrgency = computeDeadlineUrgency(daysUntilDeadline);
  const quickScore = computeQuickScore(bid, daysUntilDeadline);
  const priorityLabel = computePriorityLabel(quickScore);

  return {
    key: bid.key,
    projectName: bid.projectName,
    organizationName: bid.organizationName ?? "-",
    prefectureName: bid.prefectureName ?? "-",
    category: bid.category ?? "-",
    cftIssueDate: formatDisplayDate(bid.cftIssueDate),
    submissionDeadline: formatDisplayDate(bid.tenderSubmissionDeadline),
    openingDate: formatDisplayDate(bid.openingTendersEvent),
    officialUrl: bid.externalDocumentUri ?? "",
    hasPdf,
    daysUntilDeadline,
    deadlineUrgency,
    quickScore,
    priorityLabel,
    actionState: "unread",
    bidRef: bid.bidRef,
    rawDeadline: bid.tenderSubmissionDeadline,
  };
}

// 表示用に日付を整形する（時刻付きは日本時間 JST で日時表示、日付のみは日付のみ、不明はそのまま）
function formatDisplayDate(value: string | undefined): string {
  if (!value) {
    return "-";
  }
  const parsed = parseJapaneseDateTime(value);
  if (!parsed) {
    return value;
  }
  if (!parsed.hasTime) {
    const y = parsed.year.toString().padStart(4, "0");
    const m = parsed.month.toString().padStart(2, "0");
    const d = parsed.day.toString().padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const jstDate = new Date(parsed.date.getTime() + 9 * 3600 * 1000);
  const y = jstDate.getUTCFullYear().toString().padStart(4, "0");
  const m = (jstDate.getUTCMonth() + 1).toString().padStart(2, "0");
  const d = jstDate.getUTCDate().toString().padStart(2, "0");
  const hh = jstDate.getUTCHours().toString().padStart(2, "0");
  const mm = jstDate.getUTCMinutes().toString().padStart(2, "0");
  return `${y}-${m}-${d} ${hh}:${mm} JST`;
}

function computeDaysUntilDeadline(deadline: string | undefined, now: Date): number | null {
  const parsed = parseJapaneseDateTime(deadline);
  if (!parsed) {
    return null;
  }
  if (parsed.hasTime && now.getTime() > parsed.date.getTime()) {
    return -1;
  }
  const deadlineStr = parsed.hasTime
    ? new Date(parsed.date.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10)
    : `${parsed.year.toString().padStart(4, "0")}-${parsed.month.toString().padStart(2, "0")}-${parsed.day.toString().padStart(2, "0")}`;
  const todayJst = todayDateJst(now);
  const diffDays = Math.round(
    (new Date(`${deadlineStr}T00:00:00Z`).getTime() - new Date(`${todayJst}T00:00:00Z`).getTime()) /
      86_400_000,
  );
  if (diffDays < 0) {
    return -1;
  }
  return diffDays;
}

function computeDeadlineUrgency(
  daysUntilDeadline: number | null,
): BidCardViewModel["deadlineUrgency"] {
  if (daysUntilDeadline === null) {
    return "unknown";
  }
  if (daysUntilDeadline < 0) {
    return "overdue";
  }
  if (daysUntilDeadline <= 7) {
    return "urgent";
  }
  return "normal";
}

function computeQuickScore(bid: Bid, daysUntilDeadline: number | null): number {
  let score = 40;
  if (bid.externalDocumentUri) {
    score += 10;
  }
  if (bid.organizationName) {
    score += 5;
  }
  if (bid.tenderSubmissionDeadline) {
    score += 10;
  }
  if (bid.openingTendersEvent) {
    score += 5;
  }
  if (bid.certification) {
    score += 5;
  }
  if (daysUntilDeadline !== null && daysUntilDeadline > 0 && daysUntilDeadline <= 30) {
    score += 10;
  }
  if (bid.fileType === "pdf" || (bid.externalDocumentUri ?? "").toLowerCase().endsWith(".pdf")) {
    score += 5;
  }
  return Math.min(100, Math.max(0, score));
}

function computePriorityLabel(score: number): BidCardViewModel["priorityLabel"] {
  if (score >= 70) {
    return "pursue";
  }
  if (score >= 45) {
    return "review";
  }
  return "skip";
}
