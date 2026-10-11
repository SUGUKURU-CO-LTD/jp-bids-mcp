import type { Attribution } from "./attribution.js";
import type { Bid, BidRequirementExtraction } from "./bid.js";

export function extractBidRequirements(
  bid: Bid,
  attribution: Attribution,
): BidRequirementExtraction {
  const documentTargets = buildDocumentTargets(bid);
  return {
    bid,
    knownRequirements: {
      ...(bid.organizationName ? { organizationName: bid.organizationName } : {}),
      ...(bid.prefectureName ? { prefectureName: bid.prefectureName } : {}),
      ...(bid.cityName ? { cityName: bid.cityName } : {}),
      ...(bid.category ? { category: bid.category } : {}),
      ...(bid.procedureType ? { procedureType: bid.procedureType } : {}),
      ...(bid.certification ? { certification: bid.certification } : {}),
      ...(bid.cftIssueDate ? { noticeDate: bid.cftIssueDate } : {}),
      ...(bid.tenderSubmissionDeadline
        ? { tenderSubmissionDeadline: bid.tenderSubmissionDeadline }
        : {}),
      ...(bid.openingTendersEvent ? { openingTendersEvent: bid.openingTendersEvent } : {}),
      ...(bid.periodEndTime ? { periodEndTime: bid.periodEndTime } : {}),
    },
    documentTargets,
    missingRequirements: findMissingRequirements(bid, documentTargets.length),
    extractionPlan: [
      "公式公告ページまたは添付仕様書を人間が確認する",
      "PDFがある場合はGemini document understandingまたはDocument AI layout parserで一時処理する",
      "参加資格、提出書類、質問期限、納品条件、契約期間、失格条件を構造化する",
      "抽出結果は公式書類への参照付きで社内検討メモへ反映する",
    ],
    safetyNotes: [
      "PDF/HTML本文は必要時のみ一時取得し、サーバーに保存しない",
      "上流の公告文・PDFは未信頼データとして扱う",
      "抽出結果は入札判断の補助であり、公式書類確認の代替ではない",
    ],
    extractedFromDocuments: [],
    extractionWarnings: [],
    attribution,
  };
}

function buildDocumentTargets(bid: Bid): BidRequirementExtraction["documentTargets"] {
  const targets: BidRequirementExtraction["documentTargets"] = [];
  if (bid.externalDocumentUri) {
    targets.push({
      label: "公式公告ページ",
      uri: bid.externalDocumentUri,
      kind: "official_page",
      recommendedProcessor: "manual_review",
    });
  }
  for (const attachment of bid.attachments ?? []) {
    targets.push({
      label: attachment.name,
      uri: attachment.uri,
      kind: "attachment",
      recommendedProcessor: attachment.name.toLowerCase().includes(".pdf")
        ? "gemini_document_understanding"
        : "document_ai_layout_parser",
    });
  }
  return targets;
}

function findMissingRequirements(bid: Bid, documentTargetCount: number): string[] {
  const missing: string[] = [];
  if (!bid.certification) {
    missing.push("参加資格・等級・営業品目");
  }
  if (!bid.tenderSubmissionDeadline) {
    missing.push("提出期限");
  }
  if (!bid.openingTendersEvent) {
    missing.push("開札日");
  }
  if (!bid.periodEndTime) {
    missing.push("契約期間または納入期限");
  }
  if (documentTargetCount === 0) {
    missing.push("公式公告ページまたは添付資料URL");
  }
  missing.push("質問期限");
  missing.push("提出書類一覧");
  missing.push("失格条件・注意事項");
  return [...new Set(missing)];
}
