import { XMLParser } from "fast-xml-parser";
import { LRUCache } from "lru-cache";
import { createAttribution } from "../domain/attribution.js";
import type { Bid, BidSearchResult } from "../domain/bid.js";
import { UpstreamError, UserInputError } from "../lib/errors.js";
import { TokenBucketRateLimiter } from "../lib/rate-limiter.js";
import { VERSION } from "../lib/version.js";

export interface KkjSearchParams {
  Query?: string;
  Project_Name?: string;
  Organization_Name?: string;
  LG_Code?: string;
  Category?: 1 | 2 | 3;
  Procedure_Type?: 1 | 2 | 3;
  Certification?: string;
  CFT_Issue_Date?: string;
  Tender_Submission_Deadline?: string;
  Opening_Tenders_Event?: string;
  Period_End_Time?: string;
  Count?: number;
}

export interface KkjClientOptions {
  fetchImpl?: typeof fetch;
  endpoint?: string;
  userAgent?: string;
  timeoutMs?: number;
  cacheTtlMs?: number;
  rateLimitPerSecond?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  rememberRecentBids?: boolean;
}

type XmlRecord = Record<string, unknown>;

const defaultEndpoint = "http://www.kkj.go.jp/api/";

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  trimValues: true,
});

// 5xx・タイムアウト・ネットワーク断は上流の一時的な問題として再試行対象にする
// 5xx, timeouts, and network drops are treated as transient upstream issues eligible for retry
// 5xx, timeout, dan putus jaringan diperlakukan sebagai masalah upstream sementara yang layak dicoba ulang
const defaultMaxRetries = 2;
const defaultRetryBaseDelayMs = 500;

function isRetryableError(error: unknown): boolean {
  if (error instanceof UpstreamError) {
    return error.status === undefined || error.status >= 500;
  }
  if (error instanceof UserInputError) {
    return false;
  }
  if (error instanceof Error && error.name === "TimeoutError") {
    return true;
  }
  // fetch throws TypeError for network-level failures (DNS, connection reset, etc.)
  return error instanceof TypeError;
}

export class KkjClient {
  private readonly fetchImpl: typeof fetch;
  private readonly endpoint: string;
  private readonly userAgent: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly rememberRecentBidsEnabled: boolean;
  private readonly cache: LRUCache<string, BidSearchResult>;
  private readonly limiter: TokenBucketRateLimiter;
  private recentBidKeys: string[] = [];
  private recentOrganizationNames: string[] = [];
  private readonly recentBids = new Map<string, Bid>();

  constructor(options: KkjClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.endpoint = options.endpoint ?? defaultEndpoint;
    this.userAgent = options.userAgent ?? `JP Bids MCP/${VERSION}`;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.maxRetries = options.maxRetries ?? defaultMaxRetries;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? defaultRetryBaseDelayMs;
    this.rememberRecentBidsEnabled = options.rememberRecentBids ?? true;
    this.cache = new LRUCache<string, BidSearchResult>({
      max: 500,
      ttl: options.cacheTtlMs ?? 10 * 60 * 1000,
    });
    const perSecond = options.rateLimitPerSecond ?? 1;
    this.limiter = new TokenBucketRateLimiter(Math.max(1, Math.floor(1000 / perSecond)));
  }

  async search(params: KkjSearchParams): Promise<BidSearchResult> {
    ensureSearchParams(params);
    const normalizedParams = normalizeParams(params);
    const cacheKey = JSON.stringify(normalizedParams);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const result = await this.fetchWithRetry(normalizedParams);
    if (this.rememberRecentBidsEnabled) {
      this.rememberBidKeys(result.bids);
    }
    this.cache.set(cacheKey, result);
    return result;
  }

  private async fetchWithRetry(
    normalizedParams: Record<string, string | number>,
  ): Promise<BidSearchResult> {
    let attempt = 0;
    for (;;) {
      // レートリミッタは再試行ごとに通す（KKJへの短時間大量アクセスを避ける）
      // Pass through the rate limiter on every attempt, including retries
      // Lewati rate limiter pada setiap percobaan, termasuk percobaan ulang
      await this.limiter.wait();
      try {
        return await this.fetchOnce(normalizedParams);
      } catch (error) {
        if (attempt >= this.maxRetries || !isRetryableError(error)) {
          throw error;
        }
        attempt += 1;
        const delayMs = this.retryBaseDelayMs * 2 ** (attempt - 1);
        await sleep(delayMs);
      }
    }
  }

  private async fetchOnce(
    normalizedParams: Record<string, string | number>,
  ): Promise<BidSearchResult> {
    const url = new URL(this.endpoint);
    for (const [key, value] of Object.entries(normalizedParams)) {
      url.searchParams.set(key, String(value));
    }

    const response = await this.fetchImpl(url, {
      headers: { "User-Agent": this.userAgent },
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      throw new UpstreamError(`kkj.go.jp returned ${response.status}`, response.status);
    }

    const xml = await response.text();
    return parseKkjXml(xml, normalizedParams);
  }

  completeBidKeys(value: string): string[] {
    return this.recentBidKeys.filter((key) => key.includes(value)).slice(0, 100);
  }

  getCachedBid(key: string): Bid | undefined {
    const recent = this.recentBids.get(key);
    if (recent) {
      return recent;
    }
    for (const result of this.cache.values()) {
      const exact = result.bids.find((bid) => bid.key === key);
      if (exact) {
        return exact;
      }
    }
    return undefined;
  }

  completeOrganizationNames(value: string): string[] {
    return this.recentOrganizationNames
      .filter((organizationName) => organizationName.includes(value))
      .slice(0, 100);
  }

  private rememberBidKeys(bids: Bid[]): void {
    for (const bid of bids) {
      this.recentBids.set(bid.key, bid);
    }
    const merged = [bids.map((bid) => bid.key), this.recentBidKeys].flat();
    this.recentBidKeys = [...new Set(merged)].slice(0, 200);
    const organizationNames = bids
      .map((bid) => bid.organizationName)
      .filter((organizationName): organizationName is string => Boolean(organizationName));
    this.recentOrganizationNames = [
      ...new Set([...organizationNames, ...this.recentOrganizationNames]),
    ].slice(0, 200);
    for (const key of this.recentBids.keys()) {
      if (!this.recentBidKeys.includes(key)) {
        this.recentBids.delete(key);
      }
    }
  }
}

export function parseKkjXml(xml: string, query: Record<string, string | number>): BidSearchResult {
  const parsed = xmlParser.parse(xml) as unknown;
  const root = getRecord(parsed, "Results");
  if (!root) {
    throw new UpstreamError("KKJ API response did not include Results");
  }
  const error = root.Error;
  if (typeof error === "string" && error.length > 0) {
    throw new UserInputError(`KKJ API error: ${error}`);
  }
  const searchResults = getRecord(root, "SearchResults");
  const rawResults = toArray(searchResults?.SearchResult);
  const bids = rawResults.map((raw) => normalizeBid(raw));
  return {
    searchHits: toNumber(searchResults?.SearchHits) ?? bids.length,
    returnedCount: bids.length,
    bids,
    query,
    attribution: createAttribution(),
  };
}

function ensureSearchParams(params: KkjSearchParams): void {
  if (!params.Query && !params.Project_Name && !params.Organization_Name && !params.LG_Code) {
    throw new UserInputError(
      "検索条件が不足しています。query（全文検索）、project_name（件名）、organization_name（発注機関）、prefecture（都道府県）のいずれかを指定してください。Add one of query, project_name, organization_name, or prefecture.",
    );
  }
}

function normalizeParams(params: KkjSearchParams): Record<string, string | number> {
  const normalized: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      normalized[key] = value;
    }
  }
  return normalized;
}

function normalizeBid(raw: XmlRecord): Bid {
  const bid: Bid = {
    resultId: toNumber(raw.ResultId) ?? 0,
    key: toStringValue(raw.Key) ?? "",
    projectName: toStringValue(raw.ProjectName) ?? "Untitled procurement",
  };
  setOptional(
    bid,
    "externalDocumentUri",
    toStringValue(raw.ExternalDocumentURI) ?? toStringValue(raw.External_Document_URI),
  );
  setOptional(bid, "date", toStringValue(raw.Date));
  setOptional(bid, "fileType", toStringValue(raw.FileType));
  setOptional(bid, "fileSize", toNumber(raw.FileSize));
  setOptional(bid, "lgCode", toStringValue(raw.LgCode) ?? toStringValue(raw.LG_Code));
  setOptional(bid, "prefectureName", toStringValue(raw.PrefectureName));
  setOptional(bid, "cityCode", toStringValue(raw.CityCode));
  setOptional(bid, "cityName", toStringValue(raw.CityName));
  setOptional(bid, "organizationName", toStringValue(raw.OrganizationName));
  setOptional(bid, "certification", toStringValue(raw.Certification));
  setOptional(
    bid,
    "cftIssueDate",
    toStringValue(raw.CftIssueDate) ?? toStringValue(raw.CFT_Issue_Date),
  );
  setOptional(
    bid,
    "periodEndTime",
    toStringValue(raw.PeriodEndTime) ?? toStringValue(raw.Period_End_Time),
  );
  setOptional(bid, "category", toStringValue(raw.Category));
  setOptional(bid, "procedureType", toStringValue(raw.ProcedureType));
  setOptional(bid, "location", toStringValue(raw.Location));
  setOptional(
    bid,
    "tenderSubmissionDeadline",
    toStringValue(raw.TenderSubmissionDeadline) ?? toStringValue(raw.Tender_Submission_Deadline),
  );
  setOptional(
    bid,
    "openingTendersEvent",
    toStringValue(raw.OpeningTendersEvent) ?? toStringValue(raw.Opening_Tenders_Event),
  );
  setOptional(bid, "itemCode", toStringValue(raw.ItemCode));
  setOptional(bid, "projectDescription", toStringValue(raw.ProjectDescription));

  const attachmentRecords = toArray(getRecord(raw, "Attachments")?.Attachment);
  if (attachmentRecords.length > 0) {
    bid.attachments = attachmentRecords.map((attachment) => ({
      name: toStringValue(attachment.Name) ?? "Attachment",
      uri: toStringValue(attachment.Uri) ?? "",
    }));
  }
  return bid;
}

function getRecord(value: unknown, key: string): XmlRecord | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const child = value[key];
  return isRecord(child) ? child : undefined;
}

function isRecord(value: unknown): value is XmlRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toArray(value: unknown): XmlRecord[] {
  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }
  return isRecord(value) ? [value] : [];
}

function toStringValue(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return String(value);
}

function toNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

function setOptional<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: T[K] | undefined,
): void {
  if (value !== undefined) {
    target[key] = value;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
