import type {
  CreateMessageRequestParams,
  CreateMessageResult,
} from "@modelcontextprotocol/sdk/types.js";
import type { Bid, ExtractedBidRequirements } from "../domain/bid.js";
import {
  buildPdfExtractionSystemPrompt,
  buildPdfExtractionUserPrompt,
  bytesToSamplingText,
  type ExtractionDocumentText,
  parseExtractedRequirementsJson,
} from "../domain/pdf-extraction-prompt.js";
import type { FetchedDocument } from "./pdf-fetcher.js";

export type SamplingCreateMessage = (
  params: CreateMessageRequestParams,
) => Promise<CreateMessageResult>;

export interface SamplingExtractionResult {
  mode: "sampling";
  extractedRequirements?: ExtractedBidRequirements;
  rawText: string;
  warnings: string[];
  model?: string;
  stopReason?: string;
}

export async function extractRequirementsWithSampling(input: {
  createMessage: SamplingCreateMessage;
  bid: Bid;
  documents: FetchedDocument[];
}): Promise<SamplingExtractionResult> {
  const preparedDocuments = input.documents.map(toExtractionDocumentText);
  const response = await input.createMessage({
    systemPrompt: buildPdfExtractionSystemPrompt(),
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: buildPdfExtractionUserPrompt(input.bid, preparedDocuments),
        },
      },
    ],
    modelPreferences: {
      hints: [{ name: "gemini-2.5-flash" }, { name: "claude-haiku-4-5" }],
      intelligencePriority: 0.7,
      costPriority: 0.5,
    },
    includeContext: "none",
    temperature: 0,
    maxTokens: 4096,
  });
  const rawText = samplingResultText(response);
  const warnings = preparedDocuments.flatMap((document) => document.warnings);
  const metadata = {
    model: response.model,
    ...(response.stopReason ? { stopReason: response.stopReason } : {}),
  };
  try {
    return {
      mode: "sampling",
      extractedRequirements: parseExtractedRequirementsJson(rawText),
      rawText,
      warnings,
      ...metadata,
    };
  } catch (error) {
    return {
      mode: "sampling",
      rawText,
      warnings: [...warnings, formatParseWarning(error)],
      ...metadata,
    };
  }
}

function toExtractionDocumentText(document: FetchedDocument): ExtractionDocumentText {
  const converted = bytesToSamplingText(document.mimeType, document.bytes);
  return {
    sourceUri: document.finalUri,
    mimeType: document.mimeType,
    sha256: document.sha256,
    sizeBytes: document.sizeBytes,
    text: converted.text,
    warnings: converted.warnings,
  };
}

function samplingResultText(result: CreateMessageResult): string {
  const blocks = Array.isArray(result.content) ? result.content : [result.content];
  return blocks
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function formatParseWarning(error: unknown): string {
  if (error instanceof Error) {
    return `Sampling結果JSONの解析に失敗しました: ${error.message}`;
  }
  return "Sampling結果JSONの解析に失敗しました。";
}
