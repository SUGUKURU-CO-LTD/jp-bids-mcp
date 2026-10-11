import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type FetchedDocument, fetchDocument } from "../api/pdf-fetcher.js";
import {
  extractRequirementsWithSampling,
  type SamplingCreateMessage,
} from "../api/sampling-extractor.js";
import {
  isVertexAiEnabled,
  resolveVertexProject,
  VertexGeminiClient,
} from "../api/vertex-gemini-client.js";
import type { BidRequirementExtraction, ExtractedBidRequirements } from "../domain/bid.js";
import { isBillingEnabled, recordPdfExtractionUsage } from "../lib/billing.js";
import type { ServerProfile } from "../lib/profile.js";

export type DocumentExtractionMode = "off" | "vertex";

/**
 * Returns the current document extraction mode.
 * Defaults to "off" in Public MVP to ensure zero unexpected external fetches, LLM, or Stripe calls.
 */
export function getDocumentExtractionMode(): DocumentExtractionMode {
  const envVal = process.env.JP_BIDS_DOCUMENT_EXTRACTION?.trim().toLowerCase();
  if (envVal === "vertex") {
    return "vertex";
  }
  return "off";
}

export const documentExtractionInputSchema = {
  fetch_documents: {
    description: "trueの場合、公式公告ページまたは添付資料を一時取得して要件抽出を試みる。",
  },
  target_uris: {
    description: "抽出対象URL。省略時は検索結果の公式公告ページ・添付資料URLから最大3件を使う。",
  },
} as const;

/**
 * PDF/HTML書類を取得しAI抽出した結果でBidRequirementExtractionを強化する
 * Enrich BidRequirementExtraction with AI-extracted content from PDF/HTML documents
 * Memperkaya BidRequirementExtraction dengan konten yang diekstraksi AI dari dokumen PDF/HTML
 *
 * @param server - MCPサーバーインスタンス / MCP server instance / Instance server MCP
 * @param extraction - 抽出元データ / Source extraction data / Data ekstraksi sumber
 * @param targetUris - 対象URL / Target URIs / URI target
 * @param stripeCustomerId - Stripe顧客ID（課金追跡用）/ Stripe customer ID (for billing tracking) / ID pelanggan Stripe (untuk pelacakan penagihan)
 */
class ProcessConcurrencyLimiter {
  private active = 0;
  private queue: Array<() => void> = [];
  constructor(private maxConcurrent: number) {}

  async acquire(): Promise<() => void> {
    if (this.active < this.maxConcurrent) {
      this.active++;
      let released = false;
      return () => {
        if (!released) {
          released = true;
          this.active--;
          const next = this.queue.shift();
          if (next) {
            this.active++;
            next();
          }
        }
      };
    }
    return new Promise<() => void>((resolve) => {
      this.queue.push(() => {
        let released = false;
        resolve(() => {
          if (!released) {
            released = true;
            this.active--;
            const next = this.queue.shift();
            if (next) {
              this.active++;
              next();
            }
          }
        });
      });
    });
  }
}

const globalFetchLimiter = new ProcessConcurrencyLimiter(2);

export async function enrichWithDocumentExtraction(
  server: McpServer,
  extraction: BidRequirementExtraction,
  targetUris: string[] | undefined,
  stripeCustomerId?: string,
  profile: ServerProfile = "public_mvp",
  vertexClient?: VertexGeminiClient,
): Promise<BidRequirementExtraction> {
  const extractionMode = getDocumentExtractionMode();

  // U3-A Requirement: When OFF, immediately return metadata-only extraction without calling fetch, LLM, or Stripe
  if (extractionMode === "off") {
    return {
      ...extraction,
      extractionStatus: "disabled",
      extractionWarnings: [
        ...extraction.extractionWarnings,
        "外部資料抽出機能 (JP_BIDS_DOCUMENT_EXTRACTION) は現在OFFに設定されています。公告メタデータのみで要件を表示しています。",
      ],
    };
  }

  // U3-A Security: Collect all official URLs associated with this bid
  const allowedBidUris = new Set<string>();
  if (extraction.bid.externalDocumentUri) {
    allowedBidUris.add(extraction.bid.externalDocumentUri);
  }
  for (const target of extraction.documentTargets) {
    if (target.uri) allowedBidUris.add(target.uri);
  }
  for (const attachment of extraction.bid.attachments ?? []) {
    if (attachment.uri) allowedBidUris.add(attachment.uri);
  }

  const requestedUris = targetUris ?? extraction.documentTargets.map((target) => target.uri);
  const validatedUris: string[] = [];
  const securityWarnings: string[] = [];

  for (const uri of requestedUris) {
    if (!uri || uri.trim() === "") continue;
    // F06-1: If allowedBidUris does not contain uri (including when allowedBidUris is empty), reject!
    if (!allowedBidUris.has(uri)) {
      securityWarnings.push(
        `指定されたURL "${uri}" はこの入札案件に関連付けられていないためスキップしました。`,
      );
      continue;
    }
    validatedUris.push(uri);
  }

  if (validatedUris.length > 3) {
    securityWarnings.push("取得対象資料が3件を超えているため、上位3件のみを取得対象としました。");
  }

  const uniqueUris = [...new Set(validatedUris)].slice(0, 3);
  if (uniqueUris.length === 0) {
    return {
      ...extraction,
      extractionStatus: "partial",
      extractionWarnings: [
        ...extraction.extractionWarnings,
        ...securityWarnings,
        "fetch_documents=true ですが、取得対象URLがありません。",
      ],
    };
  }

  // RR4 / K3-c: If Vertex AI is not enabled or project is not configured in public_mvp, stop BEFORE fetching documents
  if (profile === "public_mvp") {
    const hasProject = Boolean(resolveVertexProject());
    if (!isVertexAiEnabled() || !hasProject) {
      return {
        ...extraction,
        extractionStatus: "disabled",
        extractionWarnings: [
          ...extraction.extractionWarnings,
          ...securityWarnings,
          "外部資料抽出 (Vertex AI) が有効化されていないか、Google Cloud Project設定が不足しているため、PDF/HTML本文の抽出は実行しませんでした。",
        ],
      };
    }
  }

  // F06-2 & F06-3 / K3-b / K3-c: 書類取得・LLMはプロセス共通同時実行上限2件、1件最大10MiB、合計最大15MiBで制御する
  const MAX_SINGLE_DOC_BYTES = 10 * 1024 * 1024;
  const MAX_TOTAL_EXTRACTION_BYTES = 15 * 1024 * 1024;

  const documents: FetchedDocument[] = [];
  const fetchWarnings: string[] = [];
  let totalConsumedBytes = 0;

  for (const uri of uniqueUris) {
    const remainingBudget = MAX_TOTAL_EXTRACTION_BYTES - totalConsumedBytes;
    if (remainingBudget <= 0) {
      fetchWarnings.push(
        `合計資料サイズ上限 (15 MiB) を超過するため、一部資料 (${uri}) の取得を省略しました。`,
      );
      break;
    }
    const maxBytesForThisDoc = Math.min(MAX_SINGLE_DOC_BYTES, remainingBudget);
    const release = await globalFetchLimiter.acquire();
    try {
      const doc = await fetchDocument(uri, {
        maxBytes: maxBytesForThisDoc,
        onBytesRead: (bytes) => {
          totalConsumedBytes += bytes;
        },
      });
      if (totalConsumedBytes > MAX_TOTAL_EXTRACTION_BYTES) {
        fetchWarnings.push(
          `合計資料サイズ上限 (15 MiB) を超過するため、一部資料 (${uri}) の解析を省略しました。`,
        );
      } else {
        documents.push(doc);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      fetchWarnings.push(`書類を取得できませんでした (${uri}): ${reason}`);
    } finally {
      release();
    }
  }

  if (documents.length === 0) {
    return {
      ...extraction,
      extractionStatus: "failed",
      extractionWarnings: [
        ...extraction.extractionWarnings,
        ...securityWarnings,
        ...fetchWarnings,
        "fetch_documents=true でしたが、対象書類を取得できなかったため、公告メタデータのみで生成しました。",
      ],
    };
  }

  // F03: In public_mvp, Stripe billing is strictly disabled regardless of env variables
  if (profile !== "public_mvp") {
    const billingCustomerId = stripeCustomerId ?? process.env.STRIPE_DEFAULT_CUSTOMER_ID;
    if (isBillingEnabled() && billingCustomerId) {
      void recordPdfExtractionUsage(billingCustomerId);
    }
  }

  const extractedFromDocuments = documents.map((document) => ({
    sourceUri: document.sourceUri,
    finalUri: document.finalUri,
    sha256: document.sha256,
    sizeBytes: document.sizeBytes,
    mimeType: document.mimeType,
    extractedAt: new Date().toISOString(),
    mode: "none" as const,
  }));

  if (isVertexAiEnabled()) {
    const releaseLlm = await globalFetchLimiter.acquire();
    let vertex: import("../api/vertex-gemini-client.js").VertexExtractionResult;
    try {
      const client = vertexClient ?? new VertexGeminiClient();
      vertex = await client.extractBidRequirements({
        bid: extraction.bid,
        documents,
      });
    } finally {
      releaseLlm();
    }

    const req = vertex.extractedRequirements as Partial<ExtractedBidRequirements> | undefined;
    const hasExtractedRequirements = Boolean(
      req &&
        ((req.eligibility && req.eligibility.length > 0) ||
          (req.requiredDocuments && req.requiredDocuments.length > 0) ||
          req.questionDeadline != null ||
          req.tenderSubmissionDeadline != null ||
          req.openingDate != null ||
          req.briefingDate != null ||
          req.deliveryDeadline != null ||
          req.contractPeriod != null ||
          req.contactPoint != null ||
          (req.disqualification && req.disqualification.length > 0) ||
          req.estimatedBudget != null ||
          (req.evaluationCriteria && req.evaluationCriteria.length > 0) ||
          (req.ambiguousPoints && req.ambiguousPoints.length > 0) ||
          (req.rawNotes && req.rawNotes.length > 0)),
    );

    let extractionStatus: "success" | "partial" | "failed";
    if (!hasExtractedRequirements) {
      extractionStatus = "failed";
    } else if (fetchWarnings.length > 0 || vertex.warnings.length > 0) {
      extractionStatus = "partial";
    } else {
      extractionStatus = "success";
    }

    return {
      ...extraction,
      extractionStatus,
      extractedFromDocuments: extractedFromDocuments.map((document) => ({
        ...document,
        mode: "vertex_ai" as const,
      })),
      ...(vertex.extractedRequirements
        ? { extractedRequirements: vertex.extractedRequirements }
        : {}),
      extractionWarnings: [
        ...extraction.extractionWarnings,
        ...securityWarnings,
        ...fetchWarnings,
        ...vertex.warnings,
      ],
    };
  }

  // F06-6: In public_mvp profile, never fall back to Sampling. Return disabled note.
  if (profile === "public_mvp") {
    return {
      ...extraction,
      extractionStatus: "disabled",
      extractedFromDocuments,
      extractionWarnings: [
        ...extraction.extractionWarnings,
        ...securityWarnings,
        ...fetchWarnings,
        "外部資料抽出 (Vertex AI) が有効化されていないため、PDF/HTML本文の抽出は実行しませんでした。",
      ],
    };
  }

  if (!server.server.getClientCapabilities()?.sampling) {
    return {
      ...extraction,
      extractedFromDocuments,
      extractionWarnings: [
        ...extraction.extractionWarnings,
        ...securityWarnings,
        ...fetchWarnings,
        "MCP client が sampling capability を宣言していないため、PDF/HTML本文のAI抽出は実行しませんでした。",
      ],
    };
  }

  const sampling = await extractRequirementsWithSampling({
    bid: extraction.bid,
    documents,
    createMessage: server.server.createMessage.bind(server.server) as SamplingCreateMessage,
  });

  return {
    ...extraction,
    extractedFromDocuments: extractedFromDocuments.map((document) => ({
      ...document,
      mode: "sampling" as const,
    })),
    ...(sampling.extractedRequirements
      ? { extractedRequirements: sampling.extractedRequirements }
      : {}),
    extractionWarnings: [
      ...extraction.extractionWarnings,
      ...securityWarnings,
      ...fetchWarnings,
      ...sampling.warnings,
    ],
  };
}
