import type {
  BidRankingResult,
  BidRequirementExtraction,
  BidShortlistExport,
  RankedBid,
} from "./bid.js";

const baseColumns = [
  "priority",
  "score",
  "key",
  "project_name",
  "organization_name",
  "prefecture",
  "city",
  "category",
  "procedure_type",
  "notice_date",
  "tender_submission_deadline",
  "opening_tenders_event",
  "fit_reasons",
  "risks",
  "next_action",
  "official_url",
];

const pdfExtraColumns = [
  "pdf_eligibility",
  "pdf_required_documents",
  "pdf_submission_deadline",
  "pdf_opening_date",
  "pdf_contact_point",
];

export function exportBidShortlist(
  result: BidRankingResult,
  extractionMap?: Map<string, BidRequirementExtraction>,
  format: "csv" | "json" = "csv",
): BidShortlistExport {
  const hasPdfData = extractionMap && extractionMap.size > 0;
  const columns = hasPdfData ? [...baseColumns, ...pdfExtraColumns] : baseColumns;
  const isSelection = result.rankedBids.some((b) => b.selectionIndex !== undefined);
  const orderedBids = isSelection
    ? [...result.rankedBids].sort((a, b) => (a.selectionIndex ?? 0) - (b.selectionIndex ?? 0))
    : result.rankedBids;
  const rawRows = orderedBids.map((rankedBid) => toShortlistRow(rankedBid, extractionMap));

  if (format === "json") {
    const jsonContent = rawRows.map((row) => {
      const record: Record<string, unknown> = {};
      for (let i = 0; i < columns.length; i++) {
        const col = columns[i];
        if (col) {
          record[col] = row[i];
        }
      }
      return record;
    });
    return {
      format: "json",
      filename: "jp-bids-shortlist.json",
      rankedCount: result.rankedCount,
      columns,
      jsonContent,
      attribution: result.attribution,
      scoringPolicy: result.scoringPolicy,
    };
  }

  const csv = [columns, ...rawRows].map((row) => row.map(escapeCsvCell).join(",")).join("\n");
  return {
    format: "csv",
    filename: "jp-bids-shortlist.csv",
    rankedCount: result.rankedCount,
    csv,
    columns,
    attribution: result.attribution,
    scoringPolicy: result.scoringPolicy,
  };
}

export function exportBidShortlistCsv(
  result: BidRankingResult,
  extractionMap?: Map<string, BidRequirementExtraction>,
): BidShortlistExport {
  return exportBidShortlist(result, extractionMap, "csv");
}

function toShortlistRow(
  rankedBid: RankedBid,
  extractionMap?: Map<string, BidRequirementExtraction>,
): string[] {
  const { bid } = rankedBid;
  const base = [
    rankedBid.priority,
    String(rankedBid.score),
    bid.key,
    bid.projectName,
    bid.organizationName ?? "",
    bid.prefectureName ?? "",
    bid.cityName ?? "",
    bid.category ?? "",
    bid.procedureType ?? "",
    bid.cftIssueDate ?? "",
    bid.tenderSubmissionDeadline ?? "",
    bid.openingTendersEvent ?? "",
    rankedBid.reasons.join(" / "),
    rankedBid.risks.join(" / "),
    rankedBid.nextActions?.[0] ?? "",
    bid.externalDocumentUri ?? "",
  ];
  if (!extractionMap || extractionMap.size === 0) {
    return base;
  }
  const extracted = extractionMap.get(bid.key)?.extractedRequirements;
  return [
    ...base,
    extracted?.eligibility.join(" / ") ?? "",
    extracted?.requiredDocuments.join(" / ") ?? "",
    extracted?.tenderSubmissionDeadline ?? "",
    extracted?.openingDate ?? "",
    extracted?.contactPoint ?? "",
  ];
}

export function escapeCsvCell(value: string): string {
  let cell = value;
  // Prevent CSV formula injection in spreadsheet software (Excel, Sheets)
  if (/^[=+\-@\t\r]/.test(cell)) {
    cell = `'${cell}`;
  }
  if (!/[",\n\r]/.test(cell)) {
    return cell;
  }
  return `"${cell.replaceAll('"', '""')}"`;
}
