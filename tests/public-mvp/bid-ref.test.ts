import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { KkjClient } from "../../src/api/kkj-client.js";
import type { Bid } from "../../src/domain/bid.js";
import {
  ATTACHMENT_COMPACT_THRESHOLD,
  BID_REF_AUDIENCE,
  BID_REF_MAX_LENGTH,
  BID_REF_PURPOSE,
  BID_REF_TYP,
  signBidRef,
  verifyBidRef,
} from "../../src/domain/bid-ref.js";
import { resolveBid } from "../../src/domain/bid-resolver.js";
import { UserInputError } from "../../src/lib/errors.js";
import { createJpBidsServer } from "../../src/mcp.js";

const TEST_SECRET = "super-secure-master-secret-at-least-32-bytes-long";
const BASE_URL = "https://jp-bids.local";

const sampleBid: Bid = {
  resultId: 1,
  key: "2026-TEST-0001",
  projectName: "令和8年度 クラウド移行支援業務",
  organizationName: "デジタル庁",
  prefectureName: "東京都",
  cityName: "千代田区",
  category: "役務",
  procedureType: "一般競争入札",
  certification: "A",
  cftIssueDate: "2026-04-01",
  tenderSubmissionDeadline: "2026-04-20",
  openingTendersEvent: "2026-04-22",
  periodEndTime: "2027-03-31",
  externalDocumentUri: "https://example.go.jp/bids/1",
  attachments: [
    { name: "仕様書.pdf", uri: "https://example.go.jp/spec.pdf" },
    { name: "入札説明書.pdf", uri: "https://example.go.jp/guide.pdf" },
  ],
};

describe("U2-R: Bid Reference (bid_ref) Continuity & Tamper Defense (B03, B04, R2)", () => {
  beforeEach(() => {
    process.env.JP_BIDS_OAUTH_SECRET = TEST_SECRET;
    process.env.JP_BIDS_BASE_URL = BASE_URL;
  });

  // B03: Cache Loss & Independent Instance Bid Continuity
  describe("B03: Reproduces identical bid across independent server instances with empty cache", () => {
    it("B03-01: generates bid_ref on Instance A and fully restores identical bid on Instance B with empty cache", async () => {
      const originalFetchedAt = "2026-04-01T09:30:00Z";

      // 1. Instance A generates signed bid_ref
      const token = signBidRef(sampleBid, {
        masterSecret: TEST_SECRET,
        baseUrl: BASE_URL,
        fetchedAt: originalFetchedAt,
      });
      expect(token).toBeTypeOf("string");

      // 2. Instance B has an entirely empty cache and separate client instance
      const instanceBClient = {
        getCachedBid: vi.fn().mockReturnValue(undefined), // empty cache!
        search: vi.fn(), // should NOT be called!
      } as unknown as KkjClient;

      // 3. Instance B resolves bid from token
      const resolved = await resolveBid({
        client: instanceBClient,
        bid_ref: token,
        signingSecret: TEST_SECRET,
      });

      expect(resolved.resolution).toBe("snapshot");
      expect(resolved.bid.key).toBe(sampleBid.key);
      expect(resolved.bid.projectName).toBe(sampleBid.projectName);
      expect(resolved.bid.organizationName).toBe(sampleBid.organizationName);
      expect(resolved.bid.externalDocumentUri).toBe(sampleBid.externalDocumentUri);
      expect(resolved.bid.tenderSubmissionDeadline).toBe(sampleBid.tenderSubmissionDeadline);
      expect(resolved.fetchedAt).toBe(originalFetchedAt);

      // Verify ZERO cache hit and ZERO KKJ search call on Instance B
      expect(instanceBClient.getCachedBid).not.toHaveBeenCalled();
      expect(instanceBClient.search).not.toHaveBeenCalled();
    });

    it("B03-02: fetchedAt timestamp remains immutable across instance boundaries and is not overwritten with current time", async () => {
      const t0 = "2026-04-01T00:00:00Z";
      const token = signBidRef(sampleBid, {
        masterSecret: TEST_SECRET,
        baseUrl: BASE_URL,
        fetchedAt: t0,
        now: new Date("2026-04-01T00:00:00Z"),
      });

      // Verification performed 12 hours later
      const verification = verifyBidRef(token, TEST_SECRET, {
        now: new Date("2026-04-01T12:00:00Z"),
      });

      expect(verification.valid).toBe(true);
      if (verification.valid) {
        expect(verification.payload.fetchedAt).toBe(t0); // untouched original timestamp
      }
    });
  });

  // B04: Rejection of Tampered, Mismatched, or Expired References (R2 Strict Non-Fallback)
  describe("B04: Tampered, mismatched key, or expired bid_ref rejected with UserInputError without fallback", () => {
    const mockClient = {
      getCachedBid: vi.fn(),
      search: vi.fn(),
    } as unknown as KkjClient;

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("B04-01: tampered token payload signature mismatch immediately throws UserInputError without calling search", async () => {
      const token = signBidRef(sampleBid, {
        masterSecret: TEST_SECRET,
        baseUrl: BASE_URL,
      });
      const parts = token.split(".");
      const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
      payload.bid.projectName = "改ざんされた案件名";
      const tamperedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
      const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

      await expect(
        resolveBid({
          client: mockClient,
          bid_ref: tamperedToken,
          signingSecret: TEST_SECRET,
        }),
      ).rejects.toThrow(UserInputError);

      expect(mockClient.getCachedBid).not.toHaveBeenCalled();
      expect(mockClient.search).not.toHaveBeenCalled();
    });

    it("B04-02: wrong signing secret immediately throws UserInputError without fallback", async () => {
      const token = signBidRef(sampleBid, {
        masterSecret: TEST_SECRET,
        baseUrl: BASE_URL,
      });

      await expect(
        resolveBid({
          client: mockClient,
          bid_ref: token,
          signingSecret: "different-master-secret-that-fails-verification",
        }),
      ).rejects.toThrow(UserInputError);

      expect(mockClient.getCachedBid).not.toHaveBeenCalled();
      expect(mockClient.search).not.toHaveBeenCalled();
    });

    it("B04-03: expired bid_ref (> 24 hours) throws UserInputError without fallback", async () => {
      const t0 = new Date("2026-04-01T00:00:00Z");
      const token = signBidRef(sampleBid, {
        masterSecret: TEST_SECRET,
        baseUrl: BASE_URL,
        fetchedAt: t0.toISOString(),
        now: t0,
      });

      // 24 hours + 1 second later
      const futureNow = new Date("2026-04-02T00:00:01Z");
      await expect(
        resolveBid({
          client: mockClient,
          bid_ref: token,
          signingSecret: TEST_SECRET,
          now: futureNow,
        }),
      ).rejects.toThrow(UserInputError);

      expect(mockClient.getCachedBid).not.toHaveBeenCalled();
      expect(mockClient.search).not.toHaveBeenCalled();
    });

    it("B04-04: token bid_key mismatch with requested bid_key throws UserInputError", async () => {
      const token = signBidRef(sampleBid, {
        masterSecret: TEST_SECRET,
        baseUrl: BASE_URL,
      });

      await expect(
        resolveBid({
          client: mockClient,
          bid_ref: token,
          bid_key: "DIFFERENT-KEY-0099",
          signingSecret: TEST_SECRET,
        }),
      ).rejects.toThrow(UserInputError);

      expect(mockClient.getCachedBid).not.toHaveBeenCalled();
      expect(mockClient.search).not.toHaveBeenCalled();
    });

    it("B04-05: issuer mismatch is strictly rejected during verification", () => {
      const token = signBidRef(sampleBid, {
        masterSecret: TEST_SECRET,
        baseUrl: "https://evil.unauthorized.com",
      });

      const verified = verifyBidRef(token, TEST_SECRET, {
        expectedIssuer: BASE_URL,
      });
      expect(verified.valid).toBe(false);
      if (!verified.valid) {
        expect(verified.reason).toContain("issuer mismatch");
      }
    });

    it("B04-06: long attachments compaction stays under 4096 bytes with attachmentsTruncated: true", () => {
      const longUrl = `https://example.go.jp/very/long/path/${"a".repeat(300)}.pdf`;
      const bidWithLargeAttachments: Bid = {
        ...sampleBid,
        attachments: Array.from({ length: 10 }, (_, i) => ({
          name: `添付書類_${i + 1}.pdf`,
          uri: `${longUrl}?id=${i}`,
        })),
      };

      const token = signBidRef(bidWithLargeAttachments, {
        masterSecret: TEST_SECRET,
        baseUrl: BASE_URL,
      });
      expect(token.length).toBeLessThanOrEqual(BID_REF_MAX_LENGTH);

      const verified = verifyBidRef(token, TEST_SECRET);
      expect(verified.valid).toBe(true);
      if (verified.valid) {
        expect(verified.payload.bid.attachmentsTruncated).toBe(true);
        expect(verified.payload.bid.truncatedReason).toBeDefined();
      }
    });
  });

  // R2: Snapshot Schema, Header, Claims, and Bound Constraints
  describe("R2: Cryptographic format, metadata sanitization, and size limits", () => {
    it("generates correct header (alg: HS256, typ: jp-bids-bid-ref+jwt) and payload (purpose, iss, aud, exp)", () => {
      const token = signBidRef(sampleBid, {
        masterSecret: TEST_SECRET,
        baseUrl: BASE_URL,
        fetchedAt: "2026-04-01T09:00:00Z",
      });

      const parts = token.split(".");
      expect(parts.length).toBe(3);

      const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
      expect(header).toEqual({ alg: "HS256", typ: BID_REF_TYP });

      const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
      expect(payload.purpose).toBe(BID_REF_PURPOSE);
      expect(payload.iss).toBe(BASE_URL);
      expect(payload.aud).toBe(BID_REF_AUDIENCE);
      expect(payload.exp - payload.iat).toBe(24 * 3600); // exactly 24h
    });

    it("strictly excludes projectDescription and internal fields from snapshot", () => {
      const bidWithBody: Bid = {
        ...sampleBid,
        // @ts-expect-error projectDescription is excluded from Bid type
        projectDescription: "秘密の入札仕様書本文",
        internalCompanyNotes: "非公開メモ",
      };

      const token = signBidRef(bidWithBody, {
        masterSecret: TEST_SECRET,
        baseUrl: BASE_URL,
      });
      const verified = verifyBidRef(token, TEST_SECRET);
      expect(verified.valid).toBe(true);
      if (verified.valid) {
        const bidData = verified.payload.bid as Record<string, unknown>;
        expect(bidData.projectDescription).toBeUndefined();
        expect(bidData.internalCompanyNotes).toBeUndefined();
      }
    });

    it("compacts attachments when token exceeds 4096 characters (ATTACHMENT_COMPACT_THRESHOLD) while preserving full projectName", () => {
      const longName =
        "令和8年度 " +
        "超大規模次世代基幹業務システム設計・開発・移行・運用保守一括委託調達業務".repeat(3);
      const bidWithLargeAttachments: Bid = {
        ...sampleBid,
        projectName: longName,
        attachments: Array.from({ length: 10 }, (_, i) => ({
          name: `添付書類_詳細仕様書_設計指針_${i + 1}.pdf`,
          uri: `https://example.go.jp/spec/${"very_long_path_segment_exceeding_threshold_".repeat(12)}_${i + 1}.pdf`,
        })),
      };

      const token = signBidRef(bidWithLargeAttachments, {
        masterSecret: TEST_SECRET,
        baseUrl: BASE_URL,
      });

      expect(ATTACHMENT_COMPACT_THRESHOLD).toBe(4096);
      // Must be within 8192 acceptance limit
      expect(token.length).toBeLessThanOrEqual(BID_REF_MAX_LENGTH);

      const verified = verifyBidRef(token, TEST_SECRET);
      expect(verified.valid).toBe(true);
      if (verified.valid) {
        // Full project name is NEVER truncated
        expect(verified.payload.bid.projectName).toBe(longName);
        // Attachments compacted to satisfy threshold
        expect(verified.payload.bid.attachmentsTruncated).toBe(true);
        expect(verified.payload.bid.truncatedReason).toContain("4096文字制限");
      }
    });

    it("strictly rejects bid_ref exceeding 8192 character acceptance upper bound", () => {
      const oversizedToken = "a".repeat(BID_REF_MAX_LENGTH + 1);
      const verified = verifyBidRef(oversizedToken, TEST_SECRET);
      expect(verified.valid).toBe(false);
      if (!verified.valid) {
        expect(verified.reason).toBe("bid_ref exceeds max length of 8192 characters");
      }
    });

    it("accepts 50 items with large tokens (several thousand chars) at SDK tool entry", async () => {
      const server = createJpBidsServer({ profile: "public_mvp" });
      const client = new Client({ name: "sdk-entry-test", version: "1.0.0" });
      const [ct, st] = InMemoryTransport.createLinkedPair();
      await Promise.all([server.connect(st), client.connect(ct)]);

      const tokens: string[] = [];
      for (let i = 0; i < 50; i++) {
        const itemBid: Bid = {
          resultId: i + 1,
          key: `2026-MULTI-${String(i + 1).padStart(4, "0")}`,
          projectName: `案件番号_${i + 1}_${"基幹系システム構築業務".repeat(10)}`,
          organizationName: `発注組織_${i + 1}`,
          prefectureName: "東京都",
          category: "役務",
          procedureType: "一般競争入札",
          cftIssueDate: "2026-05-01",
          tenderSubmissionDeadline: "2026-05-20",
          externalDocumentUri: `https://example.go.jp/notices/${i + 1}`,
          attachments: [
            { name: `仕様書_${i + 1}.pdf`, uri: `https://example.go.jp/spec_${i + 1}.pdf` },
          ],
        };
        const tok = signBidRef(itemBid, { masterSecret: TEST_SECRET, baseUrl: BASE_URL });
        expect(tok.length).toBeLessThanOrEqual(BID_REF_MAX_LENGTH);
        tokens.push(tok);
      }

      expect(tokens).toHaveLength(50);

      // Call rank_bids via MCP client
      const rankCall = await client.callTool({
        name: "rank_bids",
        arguments: { bid_refs: tokens },
      });
      expect(rankCall.isError).toBeFalsy();
      const rankContent = rankCall.structuredContent as {
        rankedCount: number;
        rankedBids: unknown[];
      };
      expect(rankContent.rankedCount).toBe(50);
      expect(rankContent.rankedBids).toHaveLength(50);

      // Call export_bid_shortlist via MCP client
      const exportCall = await client.callTool({
        name: "export_bid_shortlist",
        arguments: { bid_refs: tokens, format: "csv" },
      });
      expect(exportCall.isError).toBeFalsy();
      const exportContent = exportCall.structuredContent as {
        rankedCount: number;
        csv: string;
      };
      expect(exportContent.rankedCount).toBe(50);
      expect(exportContent.csv).toContain("案件番号_1_");
      expect(exportContent.csv).toContain("案件番号_50_");

      await client.close();
      await server.close();
    });

    it("falls back to cache or exact search ONLY when bid_key is passed without bid_ref", async () => {
      const mockClient = {
        getCachedBid: vi.fn(),
        search: vi.fn(),
      } as unknown as KkjClient;

      // 1. Cache hit
      (mockClient.getCachedBid as Mock).mockReturnValueOnce(sampleBid);
      const resCache = await resolveBid({
        client: mockClient,
        bid_key: sampleBid.key,
        signingSecret: TEST_SECRET,
      });
      expect(resCache.resolution).toBe("cache");
      expect(mockClient.getCachedBid).toHaveBeenCalledWith(sampleBid.key);

      // 2. Cache miss, search hit
      (mockClient.getCachedBid as Mock).mockReturnValueOnce(undefined);
      (mockClient.search as Mock).mockResolvedValueOnce({
        searchHits: 1,
        returnedCount: 1,
        bids: [sampleBid],
        attribution: { dataSource: "KKJ" },
      });
      const resSearch = await resolveBid({
        client: mockClient,
        bid_key: sampleBid.key,
        signingSecret: TEST_SECRET,
      });
      expect(resSearch.resolution).toBe("fulltext_exact");
      expect(mockClient.search).toHaveBeenCalledWith({ Query: sampleBid.key, Count: 10 });
    });
  });
});
