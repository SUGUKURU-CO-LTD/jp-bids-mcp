// Unified Bid Resolution Utility
// Resolves a Bid from either a signed bid_ref (snapshot) or a bid_key (cache/exact search).
// Follows strict R2 requirement: invalid/expired bid_ref NEVER falls back to cache/search.

import type { KkjClient } from "../api/kkj-client.js";
import { UserInputError } from "../lib/errors.js";
import { isProductionEnvironment } from "../lib/profile.js";
import type { Bid } from "./bid.js";
import { getProcessEphemeralSecret, verifyBidRef } from "./bid-ref.js";

export type ResolutionSource = "snapshot" | "cache" | "fulltext_exact";

export interface ResolvedBidResult {
  bid: Bid;
  resolution: ResolutionSource;
  fetchedAt?: string | undefined;
  expiresAt?: number | undefined;
}

export interface ResolveBidOptions {
  bid_key?: string | undefined;
  bid_ref?: string | undefined;
  client: KkjClient;
  signingSecret?: string | undefined;
  baseUrl?: string | undefined;
  now?: Date | undefined;
}

/**
 * Resolves a Bid from bid_ref or bid_key.
 * If bid_ref is provided, it is cryptographically verified; failures are strictly fatal and never fall back.
 */
export async function resolveBid(options: ResolveBidOptions): Promise<ResolvedBidResult> {
  const { bid_key, bid_ref, client, baseUrl, now } = options;
  const signingSecret =
    options.signingSecret ??
    process.env.JP_BIDS_OAUTH_SECRET ??
    (isProductionEnvironment()
      ? (() => {
          throw new Error("JP_BIDS_OAUTH_SECRET is required in production.");
        })()
      : getProcessEphemeralSecret());

  if (!bid_key && !bid_ref) {
    throw new UserInputError("bid_key または bid_ref のいずれかを指定してください。");
  }

  // 1. Explicit bid_ref path (Priority)
  if (bid_ref) {
    const verification = verifyBidRef(bid_ref, signingSecret, {
      expectedKey: bid_key,
      expectedBaseUrl: baseUrl,
      now,
    });

    if (!verification.valid) {
      // Strict R2: Never silently fall back to cache or fulltext search when a bid_ref is explicitly supplied!
      throw new UserInputError(
        `指定された bid_ref が無効または期限切れです (${verification.reason})。最新の search_bids または list_recent_bids から再取得してください。`,
      );
    }

    const payload = verification.payload;
    const bid: Bid = {
      resultId: payload.bid.resultId ?? 0,
      key: payload.bid.key,
      projectName: payload.bid.projectName,
      organizationName: payload.bid.organizationName,
      prefectureName: payload.bid.prefectureName,
      cityName: payload.bid.cityName,
      category: payload.bid.category,
      procedureType: payload.bid.procedureType,
      certification: payload.bid.certification,
      cftIssueDate: payload.bid.cftIssueDate,
      tenderSubmissionDeadline: payload.bid.tenderSubmissionDeadline,
      openingTendersEvent: payload.bid.openingTendersEvent,
      periodEndTime: payload.bid.periodEndTime,
      externalDocumentUri: payload.bid.externalDocumentUri,
      attachments: payload.bid.attachments,
      attachmentsTruncated: payload.bid.attachmentsTruncated,
      truncatedReason: payload.bid.truncatedReason,
    };

    return {
      bid,
      resolution: "snapshot",
      fetchedAt: payload.fetchedAt,
      expiresAt: payload.exp,
    };
  }

  // 2. Legacy bid_key path (cache lookup, then exact-match search)
  const keyToFind = bid_key as string;
  const cached = client.getCachedBid(keyToFind);
  if (cached) {
    return {
      bid: cached,
      resolution: "cache",
      fetchedAt: (cached as { fetchedAt?: string }).fetchedAt,
    };
  }

  const searchResult = await client.search({ Query: keyToFind, Count: 10 });
  const exact = searchResult.bids.find((candidate) => candidate.key === keyToFind);
  if (!exact) {
    throw new UserInputError(
      "指定された bid_key の入札を確認できませんでした。search_bids で取得した最新の Key または bid_ref を指定してください。",
    );
  }

  return {
    bid: exact,
    resolution: "fulltext_exact",
    fetchedAt:
      (exact as { fetchedAt?: string }).fetchedAt ??
      searchResult.attribution?.accessedAt ??
      new Date().toISOString(),
  };
}
