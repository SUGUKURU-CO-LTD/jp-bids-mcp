import { createAttribution } from "./attribution.js";
import type { Bid, BidRankingResult, BidSearchResult, RankedBid } from "./bid.js";
import { parseJapaneseDateTime, todayDateJst } from "./date-range.js";

export type DeadlineStatus = "unknown" | "passed" | "today" | "upcoming";

export interface RankingInputBid {
  key: string;
  projectName: string;
  organizationName?: string | undefined;
  prefectureName?: string | undefined;
  cityName?: string | undefined;
  category?: string | undefined;
  procedureType?: string | undefined;
  certification?: string | undefined;
  cftIssueDate?: string | undefined;
  tenderSubmissionDeadline?: string | undefined;
  openingTendersEvent?: string | undefined;
  periodEndTime?: string | undefined;
  externalDocumentUri?: string | undefined;
  attachments?: Array<{ name: string; uri: string }> | undefined;
  resultId?: number | undefined;
  bidRef?: string | undefined;
}

export interface BidRankingOptions {
  preferredKeywords?: string[] | undefined;
  avoidKeywords?: string[] | undefined;
  dueWithinDays?: number | undefined;
  now?: Date | undefined;
  shortlistLimit?: number | undefined;
  selectionIndex?: number | undefined;
}

export const bidRankingScoringPolicy = {
  version: "ai-bid-radar-0.2-public-mvp",
  summary:
    "Rules-based MVP ranking for public bid discovery. Evaluates public notice metadata and deadlines in JST. Excludes project body text from keyword scoring to ensure consistency across search and signed snapshots.",
};

export function rankBidSearchResult(
  result: BidSearchResult,
  options: BidRankingOptions = {},
): BidRankingResult {
  const rankedBids = result.bids
    .map((bid) => rankBid(bid, options))
    .sort((left, right) => right.score - left.score || left.bid.resultId - right.bid.resultId)
    .slice(0, options.shortlistLimit ?? result.bids.length);

  return {
    searchHits: result.searchHits,
    returnedCount: result.returnedCount,
    rankedCount: rankedBids.length,
    rankedBids,
    query: result.query,
    attribution: result.attribution,
    scoringPolicy: bidRankingScoringPolicy,
  };
}

export function rankSelectionBids(
  bids: RankingInputBid[],
  options: BidRankingOptions = {},
): BidRankingResult {
  const rankedBids = bids
    .map((bid, index) => rankBid(bid, { ...options, selectionIndex: index }))
    .sort(
      (left, right) =>
        right.score - left.score || (left.selectionIndex ?? 0) - (right.selectionIndex ?? 0),
    )
    .slice(0, options.shortlistLimit ?? bids.length);

  return {
    searchHits: bids.length,
    returnedCount: bids.length,
    rankedCount: rankedBids.length,
    rankedBids,
    query: {
      selection_count: bids.length,
      keys: bids
        .map((b) => b.key)
        .slice(0, 10)
        .join(","),
    },
    attribution: createAttribution(),
    scoringPolicy: bidRankingScoringPolicy,
  };
}

export function rankBid(bid: RankingInputBid, options: BidRankingOptions = {}): RankedBid {
  const reasons: string[] = [];
  const risks: string[] = [];
  const nextActions = [
    "公式公告ページまたは添付仕様書で参加条件を確認する",
    "質問期限、提出期限、開札日を社内カレンダーへ登録する",
    "過去落札者と概算原価を確認して追う/見送るを判断する",
  ];
  let score = 45;

  if (bid.externalDocumentUri) {
    score += 8;
    reasons.push("公式公告URLがあり、次の確認に進みやすい");
  } else {
    score -= 12;
    risks.push("公式公告URLが検索結果に含まれていない");
  }

  if (bid.organizationName) {
    score += 5;
    reasons.push(`発注機関が確認できる: ${bid.organizationName}`);
  } else {
    risks.push("発注機関名が不明");
  }

  if (bid.prefectureName) {
    score += 4;
    reasons.push(`地域が確認できる: ${bid.prefectureName}`);
  } else {
    risks.push("地域情報が不明");
  }

  if (bid.category) {
    score += 4;
    reasons.push(`カテゴリが確認できる: ${bid.category}`);
  }

  applyKeywordFit(bid, options, reasons, risks, (delta) => {
    score += delta;
  });

  const deadlineResult = scoreDeadline(bid, options, reasons, risks);
  score += deadlineResult.delta;
  score += scoreProcedure(bid, reasons);

  const normalizedScore = clampScore(score);
  const priority = toPriority(normalizedScore, risks, deadlineResult.status);

  // Re-cast as Bid for the RankedBid output
  const fullBid: Bid = {
    resultId: bid.resultId ?? 0,
    key: bid.key,
    projectName: bid.projectName,
    organizationName: bid.organizationName,
    prefectureName: bid.prefectureName,
    cityName: bid.cityName,
    category: bid.category,
    procedureType: bid.procedureType,
    certification: bid.certification,
    cftIssueDate: bid.cftIssueDate,
    tenderSubmissionDeadline: bid.tenderSubmissionDeadline,
    openingTendersEvent: bid.openingTendersEvent,
    periodEndTime: bid.periodEndTime,
    externalDocumentUri: bid.externalDocumentUri,
    attachments: bid.attachments,
    bidRef: bid.bidRef,
  };

  const ranked: RankedBid = {
    bid: fullBid,
    score: normalizedScore,
    priority,
    reasons: reasons.slice(0, 6),
    risks: risks.slice(0, 6),
    nextActions,
    deadlineStatus: deadlineResult.status,
  };

  if (options.selectionIndex !== undefined) {
    ranked.selectionIndex = options.selectionIndex;
  }

  return ranked;
}

/**
 * Evaluates keyword match against public metadata (projectName, organizationName, category, procedureType).
 * Excludes projectDescription body text to guarantee scoring parity between search and bid_ref snapshots.
 */
function applyKeywordFit(
  bid: RankingInputBid,
  options: BidRankingOptions,
  reasons: string[],
  risks: string[],
  addScore: (delta: number) => void,
): void {
  const haystack = [bid.projectName, bid.organizationName, bid.category, bid.procedureType]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();

  for (const keyword of options.preferredKeywords ?? []) {
    if (keyword && haystack.includes(keyword.toLowerCase())) {
      addScore(7);
      reasons.push(`重要キーワードに一致: ${keyword}`);
    }
  }

  for (const keyword of options.avoidKeywords ?? []) {
    if (keyword && haystack.includes(keyword.toLowerCase())) {
      addScore(-15);
      risks.push(`避けたいキーワードに一致: ${keyword}`);
    }
  }
}

function scoreDeadline(
  bid: RankingInputBid,
  options: BidRankingOptions,
  reasons: string[],
  risks: string[],
): { delta: number; status: DeadlineStatus } {
  if (!bid.tenderSubmissionDeadline) {
    risks.push("提出期限が不明のため、公式書類で早急に確認が必要");
    return { delta: -10, status: "unknown" };
  }

  const parsed = parseJapaneseDateTime(bid.tenderSubmissionDeadline);
  if (!parsed) {
    risks.push("提出期限の日付を解析できませんでした");
    return { delta: -10, status: "unknown" };
  }

  const now = options.now ?? new Date();
  const todayJst = todayDateJst(now);
  const deadlineStr = parsed.hasTime
    ? new Date(parsed.date.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10)
    : `${parsed.year.toString().padStart(4, "0")}-${parsed.month.toString().padStart(2, "0")}-${parsed.day.toString().padStart(2, "0")}`;
  const daysUntilDeadline = Math.round(
    (new Date(`${deadlineStr}T00:00:00Z`).getTime() - new Date(`${todayJst}T00:00:00Z`).getTime()) /
      86_400_000,
  );

  // If time was explicitly present (e.g. 17:00:00 JST), use timestamp comparison
  if (parsed.hasTime) {
    if (now.getTime() > parsed.date.getTime()) {
      risks.push("掲載期限を経過（要公式確認）");
      return { delta: -35, status: "passed" };
    }
    if (daysUntilDeadline === 0) {
      risks.push("提出期限は本日です。即時確認が必要です");
      reasons.push("本日締切の案件");
      return { delta: -5, status: "today" };
    }
  } else {
    // Date only
    if (daysUntilDeadline < 0) {
      risks.push("掲載期限を経過（要公式確認）");
      return { delta: -35, status: "passed" };
    }
    if (daysUntilDeadline === 0) {
      risks.push("提出期限は本日です。即時確認が必要です");
      reasons.push("本日締切の案件");
      return { delta: -5, status: "today" };
    }
  }

  if (daysUntilDeadline <= 3) {
    risks.push(`提出期限まで${daysUntilDeadline}日で、対応時間が短い`);
    return { delta: -12, status: "upcoming" };
  }
  const dueWithinDays = options.dueWithinDays ?? 30;
  if (daysUntilDeadline <= dueWithinDays) {
    reasons.push(`提出期限まで${daysUntilDeadline}日で検討対象に入る`);
    return { delta: 12, status: "upcoming" };
  }
  risks.push(`提出期限まで${daysUntilDeadline}日あり、優先度は下げてもよい`);
  return { delta: -2, status: "upcoming" };
}

function scoreProcedure(bid: RankingInputBid, reasons: string[]): number {
  const procedure = bid.procedureType ?? "";
  if (procedure.includes("一般競争")) {
    reasons.push("一般競争入札で新規参加の検討対象になりやすい");
    return 8;
  }
  if (procedure.includes("指名")) {
    return -8;
  }
  return 0;
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function toPriority(
  score: number,
  risks: string[],
  deadlineStatus: DeadlineStatus,
): RankedBid["priority"] {
  // If deadline has already passed, it can NEVER be pursue
  if (deadlineStatus === "passed") {
    return score >= 60 ? "review" : "skip";
  }

  if (score >= 72 && risks.length <= 2) {
    return "pursue";
  }
  if (score <= 39) {
    return "skip";
  }
  return "review";
}
