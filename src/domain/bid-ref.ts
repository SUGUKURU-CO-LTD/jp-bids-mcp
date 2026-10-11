// Signed Bid Reference (bid_ref) Utility
// Generates and verifies tamper-evident, 24-hour cryptographic snapshots of search results using HKDF-derived keys.

import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { isProductionEnvironment } from "../lib/profile.js";
import type { Bid } from "./bid.js";

export const BID_REF_TYP = "jp-bids-bid-ref+jwt";
export const BID_REF_AUDIENCE = "jp-bids:bid_ref";
export const BID_REF_PURPOSE = "bid_ref";

/**
 * bid_ref の受理上限（8192文字）。
 * 正式件名の省略を行わず、MCPツール引数として受理可能な最大文字数。
 */
export const BID_REF_MAX_LENGTH = 8192;

/**
 * 添付資料の省略目安（4096文字）。
 * トークン長がこの値を超過した場合、件名は維持したまま添付URL配列の段階的縮小を開始する。
 */
export const ATTACHMENT_COMPACT_THRESHOLD = 4096;

export const DEFAULT_BID_REF_EXPIRY_SECONDS = 24 * 3600; // 24 hours

let processEphemeralSecret: string | undefined;

/**
 * プロセス固有の暗号論的ランダム署名鍵（256bit hex）を取得する。
 * 固定のハードコード文字列を使わず、プロセス再起動ごとに自動生成される。
 */
export function getProcessEphemeralSecret(): string {
  if (!processEphemeralSecret) {
    processEphemeralSecret = randomBytes(32).toString("hex");
  }
  return processEphemeralSecret;
}

export function resetProcessEphemeralSecretForTest(): void {
  processEphemeralSecret = undefined;
}

export interface BidRefBid {
  key: string;
  projectName: string;
  organizationName?: string;
  prefectureName?: string;
  cityName?: string;
  category?: string;
  procedureType?: string;
  certification?: string;
  cftIssueDate?: string;
  tenderSubmissionDeadline?: string;
  openingTendersEvent?: string;
  periodEndTime?: string;
  externalDocumentUri?: string;
  attachments?: Array<{ name: string; uri: string }>;
  resultId?: number;
  attachmentsTruncated?: boolean;
  truncatedReason?: string;
}

export interface BidRefPayload {
  v: 1;
  purpose: "bid_ref";
  iss: string;
  aud: "jp-bids:bid_ref";
  iat: number;
  exp: number;
  fetchedAt: string;
  bid: BidRefBid;
}

/**
 * Derives a dedicated 32-byte signing secret for bid_ref tokens from the master OAuth secret via HKDF.
 */
export function deriveBidRefSecret(masterSecret: string): Buffer {
  const ikm = Buffer.from(masterSecret, "utf8");
  const salt = Buffer.alloc(0);
  const info = Buffer.from("jp-bids/bid_ref/v1", "utf8");
  return Buffer.from(hkdfSync("sha256", ikm, salt, info, 32));
}

export interface SignBidRefOptions {
  masterSecret?: string | undefined;
  baseUrl?: string | undefined;
  fetchedAt?: string | undefined;
  expiresInSeconds?: number | undefined;
  now?: Date | undefined;
}

/**
 * Sanitizes and extracts only public metadata from a Bid record for inclusion in a bid_ref snapshot.
 * Explicitly excludes projectDescription, search keywords, and user data.
 */
export function extractBidRefData(bid: Bid): BidRefBid {
  const data: BidRefBid = {
    key: bid.key,
    projectName: bid.projectName,
  };
  if (bid.organizationName) data.organizationName = bid.organizationName;
  if (bid.prefectureName) data.prefectureName = bid.prefectureName;
  if (bid.cityName) data.cityName = bid.cityName;
  if (bid.category) data.category = String(bid.category);
  if (bid.procedureType) data.procedureType = String(bid.procedureType);
  if (bid.certification) data.certification = bid.certification;
  if (bid.cftIssueDate) data.cftIssueDate = bid.cftIssueDate;
  if (bid.tenderSubmissionDeadline) data.tenderSubmissionDeadline = bid.tenderSubmissionDeadline;
  if (bid.openingTendersEvent) data.openingTendersEvent = bid.openingTendersEvent;
  if (bid.periodEndTime) data.periodEndTime = bid.periodEndTime;
  if (bid.externalDocumentUri) data.externalDocumentUri = bid.externalDocumentUri;
  if (bid.resultId !== undefined) data.resultId = bid.resultId;

  if (Array.isArray(bid.attachments) && bid.attachments.length > 0) {
    const initialMax = 10;
    if (bid.attachments.length > initialMax) {
      data.attachmentsTruncated = true;
      data.truncatedReason = `添付資料が${bid.attachments.length}件あるため、初期スナップショットでは上位${initialMax}件を保持しました。`;
    }
    data.attachments = bid.attachments.slice(0, initialMax).map((a) => ({
      name: a.name,
      uri: a.uri,
    }));
  }
  if (bid.attachmentsTruncated) {
    data.attachmentsTruncated = true;
    if (bid.truncatedReason) {
      data.truncatedReason = bid.truncatedReason;
    }
  }
  return data;
}

/**
 * Signs a bid_ref token. Enforces the upper bound with progressive attachment compaction.
 */
export function signBidRef(bid: Bid, options?: SignBidRefOptions): string {
  const masterSecret =
    options?.masterSecret ??
    process.env.JP_BIDS_OAUTH_SECRET ??
    (isProductionEnvironment()
      ? (() => {
          throw new Error("JP_BIDS_OAUTH_SECRET is required in production.");
        })()
      : getProcessEphemeralSecret());

  const baseUrl = options?.baseUrl ?? process.env.JP_BIDS_BASE_URL ?? "https://jp-bids.local";
  const fetchedAt =
    options?.fetchedAt ??
    (bid as { fetchedAt?: string }).fetchedAt ??
    (bid as { accessedAt?: string }).accessedAt ??
    new Date().toISOString();

  const key = deriveBidRefSecret(masterSecret);
  const now = Math.floor((options?.now ?? new Date()).getTime() / 1000);
  const expiresIn = options?.expiresInSeconds ?? DEFAULT_BID_REF_EXPIRY_SECONDS;

  const header = { alg: "HS256", typ: BID_REF_TYP };
  const h = Buffer.from(JSON.stringify(header), "utf8").toString("base64url");

  let bidData = extractBidRefData(bid);

  const buildToken = (data: BidRefBid): string => {
    const payload: BidRefPayload = {
      v: 1,
      purpose: BID_REF_PURPOSE,
      iss: baseUrl,
      aud: BID_REF_AUDIENCE,
      iat: now,
      exp: now + expiresIn,
      fetchedAt,
      bid: data,
    };

    const p = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const sig = createHmac("sha256", key).update(`${h}.${p}`).digest("base64url");
    return `${h}.${p}.${sig}`;
  };

  let token = buildToken(bidData);
  const ATTACHMENT_COMPACT_THRESHOLD = 4096;

  // Progressive attachment compaction when token exceeds 4096 characters
  if (
    token.length > ATTACHMENT_COMPACT_THRESHOLD &&
    bidData.attachments &&
    bidData.attachments.length > 0
  ) {
    const originalAttachments = bidData.attachments;
    for (const maxAtt of [5, 3, 1, 0]) {
      const nextBidData: BidRefBid = {
        ...bidData,
        attachmentsTruncated: true,
        truncatedReason: `添付資料URLが長大なため、4096文字制限内に収める目的で添付数を${maxAtt}件に縮小しました。`,
      };
      if (maxAtt > 0) {
        nextBidData.attachments = originalAttachments.slice(0, maxAtt);
      } else {
        delete nextBidData.attachments;
      }
      bidData = nextBidData;
      token = buildToken(bidData);
      if (token.length <= ATTACHMENT_COMPACT_THRESHOLD) {
        break;
      }
    }
  }

  if (token.length <= BID_REF_MAX_LENGTH) {
    return token;
  }

  // NOTE: Never silently truncate projectName, key, or ranking fields.
  throw new Error(
    `Generated bid_ref exceeds maximum allowed length of ${BID_REF_MAX_LENGTH} characters even after attachment compaction (length: ${token.length}).`,
  );
}

export type VerifyBidRefResult =
  | { valid: true; payload: BidRefPayload }
  | { valid: false; reason: string };

export interface VerifyBidRefOptions {
  expectedKey?: string | undefined;
  expectedBaseUrl?: string | undefined;
  now?: Date | undefined;
}

/**
 * Validates a signed bid_ref token.
 */
export function verifyBidRef(
  token: string,
  masterSecret?: string,
  options?: VerifyBidRefOptions,
): VerifyBidRefResult {
  const signingSecret =
    masterSecret ??
    process.env.JP_BIDS_OAUTH_SECRET ??
    (isProductionEnvironment()
      ? (() => {
          throw new Error("JP_BIDS_OAUTH_SECRET is required in production.");
        })()
      : getProcessEphemeralSecret());
  if (typeof token !== "string" || token.length === 0) {
    return { valid: false, reason: "bid_ref is empty" };
  }
  if (token.length > BID_REF_MAX_LENGTH) {
    return {
      valid: false,
      reason: `bid_ref exceeds max length of ${BID_REF_MAX_LENGTH} characters`,
    };
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    return { valid: false, reason: "malformed token: must have exactly 3 parts" };
  }
  const [h, p, s] = parts as [string, string, string];

  const signingKey = deriveBidRefSecret(signingSecret);
  const expectedSig = Buffer.from(
    createHmac("sha256", signingKey).update(`${h}.${p}`).digest("base64url"),
  );
  const actualSig = Buffer.from(s);

  if (expectedSig.length !== actualSig.length || !timingSafeEqual(expectedSig, actualSig)) {
    return { valid: false, reason: "signature mismatch or invalid master secret" };
  }

  try {
    const header = JSON.parse(Buffer.from(h, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    if (header.alg !== "HS256" || header.typ !== BID_REF_TYP) {
      return { valid: false, reason: `header mismatch: expected alg HS256 and typ ${BID_REF_TYP}` };
    }

    const payload = JSON.parse(Buffer.from(p, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      return { valid: false, reason: "payload is not an object" };
    }

    if (payload.v !== 1) return { valid: false, reason: "unsupported bid_ref version" };
    if (payload.purpose !== BID_REF_PURPOSE)
      return { valid: false, reason: "invalid purpose in payload" };
    if (payload.aud !== BID_REF_AUDIENCE)
      return { valid: false, reason: "invalid audience in payload" };

    const nowSec = Math.floor((options?.now ?? new Date()).getTime() / 1000);
    if (
      typeof payload.exp !== "number" ||
      !Number.isInteger(payload.exp) ||
      payload.exp <= nowSec
    ) {
      return { valid: false, reason: "bid_ref has expired" };
    }

    if (
      typeof payload.iat !== "number" ||
      !Number.isInteger(payload.iat) ||
      payload.iat > nowSec + 60
    ) {
      return { valid: false, reason: "invalid or future iat in payload" };
    }

    if (
      typeof payload.fetchedAt !== "string" ||
      Number.isNaN(new Date(payload.fetchedAt).getTime())
    ) {
      return { valid: false, reason: "missing or invalid fetchedAt in payload" };
    }

    if (!payload.bid || typeof payload.bid !== "object") {
      return { valid: false, reason: "missing bid object in payload" };
    }
    const bidObj = payload.bid as Record<string, unknown>;
    if (typeof bidObj.key !== "string" || bidObj.key.length === 0) {
      return { valid: false, reason: "missing or empty bid key in payload" };
    }
    if (typeof bidObj.projectName !== "string" || bidObj.projectName.length === 0) {
      return { valid: false, reason: "missing or empty projectName in payload" };
    }

    if (options?.expectedKey && bidObj.key !== options.expectedKey) {
      return {
        valid: false,
        reason: `bid_key mismatch: token key "${bidObj.key}" does not match requested "${options.expectedKey}"`,
      };
    }

    const expectedIssuer =
      options?.expectedBaseUrl ?? process.env.JP_BIDS_BASE_URL ?? "https://jp-bids.local";
    if (payload.iss !== expectedIssuer) {
      return {
        valid: false,
        reason: `issuer mismatch: expected "${expectedIssuer}", got "${payload.iss}"`,
      };
    }

    return { valid: true, payload: payload as unknown as BidRefPayload };
  } catch (error) {
    return {
      valid: false,
      reason: `token JSON parse error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
