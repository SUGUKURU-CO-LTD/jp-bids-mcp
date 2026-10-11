import { z } from "zod";
import { AttributionSchema } from "./attribution.js";
import { CategorySchema, ProcedureTypeSchema } from "./codes.js";

export const AttachmentSchema = z.object({
  name: z.string().min(1),
  uri: z.string(),
});

export const BidSchema = z.object({
  resultId: z.number().int().nonnegative(),
  key: z.string().min(1),
  externalDocumentUri: z.string().optional(),
  projectName: z.string().min(1),
  date: z.string().optional(),
  fileType: z.string().optional(),
  fileSize: z.number().nonnegative().optional(),
  lgCode: z.string().optional(),
  prefectureName: z.string().optional(),
  cityCode: z.string().optional(),
  cityName: z.string().optional(),
  organizationName: z.string().optional(),
  certification: z.string().optional(),
  cftIssueDate: z.string().optional(),
  periodEndTime: z.string().optional(),
  category: CategorySchema.or(z.string()).optional(),
  procedureType: ProcedureTypeSchema.or(z.string()).optional(),
  location: z.string().optional(),
  tenderSubmissionDeadline: z.string().optional(),
  openingTendersEvent: z.string().optional(),
  itemCode: z.string().optional(),
  projectDescription: z.string().optional(),
  attachments: z.array(AttachmentSchema).optional(),
  bidRef: z.string().optional(),
  attachmentsTruncated: z.boolean().optional(),
  truncatedReason: z.string().optional(),
});

export type Bid = z.infer<typeof BidSchema>;

export const PaginationMetadataSchema = z.object({
  has_more: z.boolean(),
  next_cursor: z.string().nullable().optional(),
  total_count: z.number().int().nonnegative(),
});

export const BidSearchResultSchema = z.object({
  searchHits: z.number().int().nonnegative(),
  returnedCount: z.number().int().nonnegative(),
  bids: z.array(BidSchema),
  query: z.record(z.string(), z.union([z.string(), z.number()])),
  attribution: AttributionSchema,
  pagination: PaginationMetadataSchema.optional(),
  searchCriteria: z.record(z.string(), z.unknown()).optional(),
});

export type BidSearchResult = z.infer<typeof BidSearchResultSchema>;

export const BidPrioritySchema = z.enum(["pursue", "review", "skip"]);

export const RankedBidSchema = z.object({
  bid: BidSchema,
  score: z.number().int().min(0).max(100),
  priority: BidPrioritySchema,
  reasons: z.array(z.string()),
  risks: z.array(z.string()),
  nextActions: z.array(z.string()),
  deadlineStatus: z.enum(["unknown", "passed", "today", "upcoming"]).optional(),
  selectionIndex: z.number().int().nonnegative().optional(),
});

export type RankedBid = z.infer<typeof RankedBidSchema>;

export const BidRankingResultSchema = z.object({
  searchHits: z.number().int().nonnegative(),
  returnedCount: z.number().int().nonnegative(),
  rankedCount: z.number().int().nonnegative(),
  rankedBids: z.array(RankedBidSchema),
  query: z.record(z.string(), z.union([z.string(), z.number()])),
  attribution: AttributionSchema,
  scoringPolicy: z.object({
    version: z.string(),
    summary: z.string(),
  }),
});

export type BidRankingResult = z.infer<typeof BidRankingResultSchema>;

export const BidFitExplanationSchema = z.object({
  rankedBid: RankedBidSchema,
  fitSummary: z.string(),
  confirmationChecklist: z.array(z.string()),
  attribution: AttributionSchema,
  scoringPolicy: z.object({
    version: z.string(),
    summary: z.string(),
  }),
});

export type BidFitExplanation = z.infer<typeof BidFitExplanationSchema>;

export const BidShortlistExportSchema = z.object({
  format: z.enum(["csv", "json"]),
  filename: z.string(),
  rankedCount: z.number().int().nonnegative(),
  csv: z.string().optional(),
  columns: z.array(z.string()),
  jsonContent: z.array(z.record(z.string(), z.unknown())).optional(),
  attribution: AttributionSchema,
  scoringPolicy: z.object({
    version: z.string(),
    summary: z.string(),
  }),
});

export type BidShortlistExport = z.infer<typeof BidShortlistExportSchema>;

export const ExtractedBidRequirementsSchema = z
  .object({
    eligibility: z.array(z.string()),
    requiredDocuments: z.array(z.string()),
    questionDeadline: z.string().nullable(),
    tenderSubmissionDeadline: z.string().nullable(),
    openingDate: z.string().nullable(),
    briefingDate: z.string().nullable(),
    deliveryDeadline: z.string().nullable(),
    contractPeriod: z.string().nullable(),
    contactPoint: z.string().nullable(),
    disqualification: z.array(z.string()),
    estimatedBudget: z.string().nullable(),
    evaluationCriteria: z.array(z.string()),
    ambiguousPoints: z.array(z.string()),
    rawNotes: z.array(z.string()),
  })
  .strict();

export type ExtractedBidRequirements = z.infer<typeof ExtractedBidRequirementsSchema>;

export const BidRequirementExtractionSchema = z.object({
  bid: BidSchema,
  knownRequirements: z.object({
    organizationName: z.string().optional(),
    prefectureName: z.string().optional(),
    cityName: z.string().optional(),
    category: z.string().optional(),
    procedureType: z.string().optional(),
    certification: z.string().optional(),
    noticeDate: z.string().optional(),
    tenderSubmissionDeadline: z.string().optional(),
    openingTendersEvent: z.string().optional(),
    periodEndTime: z.string().optional(),
  }),
  documentTargets: z.array(
    z.object({
      label: z.string(),
      uri: z.string(),
      kind: z.enum(["official_page", "attachment", "unknown"]),
      recommendedProcessor: z.enum([
        "manual_review",
        "gemini_document_understanding",
        "document_ai_layout_parser",
      ]),
    }),
  ),
  missingRequirements: z.array(z.string()),
  extractionPlan: z.array(z.string()),
  safetyNotes: z.array(z.string()),
  extractedFromDocuments: z
    .array(
      z.object({
        sourceUri: z.string(),
        finalUri: z.string(),
        sha256: z.string(),
        sizeBytes: z.number().int().nonnegative(),
        mimeType: z.string(),
        extractedAt: z.string(),
        mode: z.enum(["sampling", "vertex_ai", "none"]),
      }),
    )
    .default([]),
  extractedRequirements: ExtractedBidRequirementsSchema.optional(),
  extractionWarnings: z.array(z.string()).default([]),
  rawExtractionText: z.string().optional(),
  extractionStatus: z.enum(["disabled", "partial", "success", "failed"]).optional(),
  attribution: AttributionSchema,
});

export type BidRequirementExtraction = z.infer<typeof BidRequirementExtractionSchema>;

export const BidCalendarExportSchema = z.object({
  format: z.literal("ics"),
  filename: z.string(),
  eventCount: z.number().int().nonnegative(),
  ics: z.string(),
  events: z.array(
    z.object({
      title: z.string(),
      date: z.string(),
      kind: z.enum(["internal_review", "submission_deadline", "opening", "period_end"]),
      sourceField: z.string(),
    }),
  ),
  missingDates: z.array(z.string()),
  attribution: AttributionSchema,
});

export type BidCalendarExport = z.infer<typeof BidCalendarExportSchema>;

export const BidReviewPacketSchema = z.object({
  bid: BidSchema,
  title: z.string(),
  markdown: z.string(),
  rankedBid: RankedBidSchema,
  requirements: BidRequirementExtractionSchema,
  calendar: BidCalendarExportSchema,
  attribution: AttributionSchema,
});

export type BidReviewPacket = z.infer<typeof BidReviewPacketSchema>;

export const BidQuestionDraftSchema = z.object({
  bid: BidSchema,
  title: z.string(),
  markdown: z.string(),
  questions: z.array(
    z.object({
      topic: z.string(),
      question: z.string(),
      reason: z.string(),
      source: z.string(),
    }),
  ),
  reviewNotes: z.array(z.string()),
  attribution: AttributionSchema,
});

export type BidQuestionDraft = z.infer<typeof BidQuestionDraftSchema>;

export const BidQualificationAssessmentSchema = z.object({
  bid: BidSchema,
  status: z.enum(["eligible", "needs_review", "not_eligible"]),
  confidence: z.number().int().min(0).max(100),
  profile: z.object({
    qualifiedPrefectures: z.array(z.string()),
    qualifiedCategories: z.array(z.string()),
    certifications: z.array(z.string()),
    serviceKeywords: z.array(z.string()),
  }),
  matches: z.array(z.string()),
  gaps: z.array(z.string()),
  unknowns: z.array(z.string()),
  requirementsUsed: z
    .object({
      documentExtractionMode: z.enum(["none", "sampling", "vertex_ai"]),
      eligibility: z.array(z.string()),
      requiredDocuments: z.array(z.string()),
      tenderSubmissionDeadline: z.string().nullable(),
      openingDate: z.string().nullable(),
      contactPoint: z.string().nullable(),
    })
    .optional(),
  nextActions: z.array(z.string()),
  attribution: AttributionSchema,
});

export type BidQualificationAssessment = z.infer<typeof BidQualificationAssessmentSchema>;

export const PastAwardSummarySchema = z.object({
  query: z.record(z.string(), z.union([z.string(), z.number()])),
  totalHits: z.number().int().nonnegative(),
  returnedCount: z.number().int().nonnegative(),
  windowDays: z.number().int().positive(),
  topOrganizations: z.array(
    z.object({
      organizationName: z.string(),
      bidCount: z.number().int().nonnegative(),
      categories: z.array(z.string()),
      procedureTypes: z.array(z.string()),
      recentBidKey: z.string().optional(),
      recentBidDate: z.string().optional(),
    }),
  ),
  categoryBreakdown: z.record(z.string(), z.number().int().nonnegative()),
  procedureBreakdown: z.record(z.string(), z.number().int().nonnegative()),
  monthlyVolume: z.array(
    z.object({
      month: z.string(),
      count: z.number().int().nonnegative(),
    }),
  ),
  insights: z.array(z.string()),
  caveats: z.array(z.string()),
  attribution: AttributionSchema,
});

export type PastAwardSummary = z.infer<typeof PastAwardSummarySchema>;

export const OrganizationSummarySchema = z.object({
  organizationName: z.string(),
  totalHits: z.number().int().nonnegative(),
  returnedCount: z.number().int().nonnegative(),
  categories: z.record(z.string(), z.number().int().nonnegative()),
  procedureTypes: z.record(z.string(), z.number().int().nonnegative()),
  recentProjects: z.array(BidSchema),
  attribution: AttributionSchema,
});

export type OrganizationSummary = z.infer<typeof OrganizationSummarySchema>;
