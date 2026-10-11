import { GoogleGenAI, Type } from "@google/genai";
import type { Bid, ExtractedBidRequirements } from "../domain/bid.js";
import { ExtractedBidRequirementsSchema } from "../domain/bid.js";
import {
  buildPdfExtractionSystemPrompt,
  buildPdfExtractionUserPrompt,
} from "../domain/pdf-extraction-prompt.js";
import { parsePositiveNumberEnv } from "../lib/env.js";
import { UpstreamError } from "../lib/errors.js";
import type { FetchedDocument } from "./pdf-fetcher.js";

export interface VertexExtractionResult {
  mode: "vertex_ai";
  extractedRequirements?: ExtractedBidRequirements;
  rawText: string;
  warnings: string[];
  model: string;
}

export interface VertexGeminiClientOptions {
  project?: string;
  location?: string;
  model?: string;
  dailyBudgetUsd?: number;
  estimatedCostPerCallUsd?: number;
  ai?: Pick<GoogleGenAI, "models">;
}

let currentBudgetDate = new Date().toISOString().slice(0, 10);
let estimatedSpendUsd = 0;

export function resolveVertexProject(optionsProject?: string): string | undefined {
  return optionsProject ?? process.env.GOOGLE_CLOUD_PROJECT ?? process.env.JP_BIDS_VERTEX_PROJECT;
}

export function isVertexAiEnabled(): boolean {
  return (
    process.env.JP_BIDS_DOCUMENT_EXTRACTION === "vertex" ||
    process.env.JP_BIDS_VERTEX_AI === "1" ||
    process.env.JP_BIDS_VERTEX_AI === "true"
  );
}

export class VertexGeminiClient {
  private readonly ai: Pick<GoogleGenAI, "models">;
  private readonly model: string;
  private readonly dailyBudgetUsd: number;
  private readonly estimatedCostPerCallUsd: number;

  constructor(options: VertexGeminiClientOptions = {}) {
    const project = resolveVertexProject(options.project);
    const location =
      options.location ??
      process.env.JP_BIDS_VERTEX_LOCATION ??
      process.env.GOOGLE_CLOUD_LOCATION ??
      "global";
    this.model = options.model ?? process.env.JP_BIDS_VERTEX_MODEL ?? "gemini-3-flash-preview";
    this.dailyBudgetUsd =
      options.dailyBudgetUsd ??
      parsePositiveNumberEnv(process.env.JP_BIDS_VERTEX_DAILY_BUDGET_USD, 5);
    this.estimatedCostPerCallUsd =
      options.estimatedCostPerCallUsd ??
      parsePositiveNumberEnv(process.env.JP_BIDS_VERTEX_ESTIMATED_COST_PER_CALL_USD, 0.01);

    if (options.ai) {
      this.ai = options.ai;
      return;
    }
    if (!project) {
      throw new UpstreamError(
        "Vertex AI direct mode requires GOOGLE_CLOUD_PROJECT or JP_BIDS_VERTEX_PROJECT, or an injected GoogleGenAI client.",
      );
    }
    this.ai = new GoogleGenAI({
      vertexai: true,
      project,
      location,
    });
  }

  async extractBidRequirements(input: {
    bid: Bid;
    documents: FetchedDocument[];
  }): Promise<VertexExtractionResult> {
    reserveBudget(this.dailyBudgetUsd, this.estimatedCostPerCallUsd);
    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: [
        {
          role: "user",
          parts: [
            { text: buildPdfExtractionUserPrompt(input.bid, []) },
            ...input.documents.map((document) => ({
              inlineData: {
                mimeType: document.mimeType,
                data: Buffer.from(document.bytes).toString("base64"),
              },
            })),
          ],
        },
      ],
      config: {
        systemInstruction: buildPdfExtractionSystemPrompt(),
        temperature: 0,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            eligibility: { type: Type.ARRAY, items: { type: Type.STRING } },
            requiredDocuments: { type: Type.ARRAY, items: { type: Type.STRING } },
            questionDeadline: { type: Type.STRING, nullable: true },
            tenderSubmissionDeadline: { type: Type.STRING, nullable: true },
            openingDate: { type: Type.STRING, nullable: true },
            briefingDate: { type: Type.STRING, nullable: true },
            deliveryDeadline: { type: Type.STRING, nullable: true },
            contractPeriod: { type: Type.STRING, nullable: true },
            contactPoint: { type: Type.STRING, nullable: true },
            disqualification: { type: Type.ARRAY, items: { type: Type.STRING } },
            estimatedBudget: { type: Type.STRING, nullable: true },
            evaluationCriteria: { type: Type.ARRAY, items: { type: Type.STRING } },
            ambiguousPoints: { type: Type.ARRAY, items: { type: Type.STRING } },
            rawNotes: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: [
            "eligibility",
            "requiredDocuments",
            "questionDeadline",
            "tenderSubmissionDeadline",
            "openingDate",
            "briefingDate",
            "deliveryDeadline",
            "contractPeriod",
            "contactPoint",
            "disqualification",
            "estimatedBudget",
            "evaluationCriteria",
            "ambiguousPoints",
            "rawNotes",
          ],
        },
      },
    });
    const rawText = response.text ?? "";
    try {
      return {
        mode: "vertex_ai",
        extractedRequirements: ExtractedBidRequirementsSchema.parse(JSON.parse(rawText)),
        rawText,
        warnings: [],
        model: this.model,
      };
    } catch (error) {
      return {
        mode: "vertex_ai",
        rawText,
        warnings: [`Vertex AI JSON解析に失敗しました: ${formatError(error)}`],
        model: this.model,
      };
    }
  }
}

export function resetVertexBudgetForTests(): void {
  currentBudgetDate = new Date().toISOString().slice(0, 10);
  estimatedSpendUsd = 0;
}

function reserveBudget(dailyBudgetUsd: number, estimatedCostPerCallUsd: number): void {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== currentBudgetDate) {
    currentBudgetDate = today;
    estimatedSpendUsd = 0;
  }
  if (estimatedSpendUsd + estimatedCostPerCallUsd > dailyBudgetUsd) {
    throw new UpstreamError(`Vertex AI daily budget guard exceeded: ${dailyBudgetUsd} USD.`);
  }
  estimatedSpendUsd += estimatedCostPerCallUsd;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
