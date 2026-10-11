import { readFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KkjClient } from "../../src/api/kkj-client.js";
import { createAttribution } from "../../src/domain/attribution.js";
import type { Bid } from "../../src/domain/bid.js";
import * as billing from "../../src/lib/billing.js";
import { UserInputError } from "../../src/lib/errors.js";
import {
  FULL_LOCAL_PROFILE,
  isProductionEnvironment,
  PUBLIC_MVP_PROFILE,
  resolveServerProfile,
} from "../../src/lib/profile.js";
import { createJpBidsServer } from "../../src/mcp.js";
import { signJwt } from "../../src/oauth/jwt.js";
import { enrichWithDocumentExtraction } from "../../src/tools/document-extraction.js";
import { createHttpApp } from "../../src/transports/http.js";

const EXPECTED_PUBLIC_MVP_TOOLS = [
  "search_bids",
  "list_recent_bids",
  "get_bid_detail",
  "rank_bids",
  "extract_bid_requirements",
  "export_bid_shortlist",
  "search_bids_app",
].sort();

const EXCLUDED_PRO_TOOLS = [
  "explain_bid_fit",
  "assess_bid_qualification",
  "create_bid_calendar",
  "create_bid_review_packet",
  "draft_bid_questions",
  "analyze_past_awards",
  "summarize_bids_by_org",
  "save_search",
  "check_saved_search",
  "list_saved_searches",
  "map_awards_to_listed",
  "get_listed_award_history",
  "analyze_award_price_impact",
  "watch_listed_awards",
  "search_investor_radar_app",
];

const mockSampleBid: Bid = {
  resultId: 1,
  key: "2026-TEST-SAMPLE",
  projectName: "官庁クラウド刷新業務",
  organizationName: "デジタル庁",
  prefectureName: "東京都",
  category: "役務",
  procedureType: "一般競争入札",
  cftIssueDate: "2026-04-01",
  tenderSubmissionDeadline: "2026-04-20",
  externalDocumentUri: "https://example.go.jp/notice/1",
  attachments: [{ name: "仕様書.pdf", uri: "https://example.go.jp/spec.pdf" }],
};

describe("U2-R: Public MVP Profile & Zero Billing Acceptance (S01, S02, S03, S04, C01)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.JP_BIDS_PROFILE;
    delete process.env.K_SERVICE;
    delete process.env.NODE_ENV;
    delete process.env.JP_BIDS_ENV;
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("S01: public_mvp profile exposes exactly 7 public tools via factory (default and explicit)", async () => {
    // 1. Explicit profile parameter
    const serverExplicit = createJpBidsServer({ profile: "public_mvp" });
    const client1 = new Client({ name: "s01-explicit-test", version: "1.0.0" });
    const [ct1, st1] = InMemoryTransport.createLinkedPair();
    await Promise.all([serverExplicit.connect(st1), client1.connect(ct1)]);
    const list1 = await client1.listTools();
    const toolNames1 = list1.tools.map((t) => t.name).sort();
    expect(toolNames1).toEqual(EXPECTED_PUBLIC_MVP_TOOLS);
    await client1.close();
    await serverExplicit.close();

    // 2. Default profile when unspecified
    const serverDefault = createJpBidsServer();
    const client2 = new Client({ name: "s01-default-test", version: "1.0.0" });
    const [ct2, st2] = InMemoryTransport.createLinkedPair();
    await Promise.all([serverDefault.connect(st2), client2.connect(ct2)]);
    const list2 = await client2.listTools();
    const toolNames2 = list2.tools.map((t) => t.name).sort();
    expect(toolNames2).toEqual(EXPECTED_PUBLIC_MVP_TOOLS);
    await client2.close();
    await serverDefault.close();
  });

  it("S01-02: HTTP /mcp endpoint with valid OAuth token exposes the exact 7 tools", async () => {
    const testSecret = "test-secret-with-at-least-32-bytes-long";
    const baseUrl = "https://mcp.test";
    process.env.JP_BIDS_BASE_URL = baseUrl;
    process.env.JP_BIDS_OAUTH_SECRET = testSecret;

    const app = createHttpApp();
    const now = Math.floor(Date.now() / 1000);
    const token = signJwt(
      {
        iss: baseUrl,
        aud: `${baseUrl}/mcp`,
        sub: "user-http-s01",
        scope: "mcp:read",
        type: "access_token",
        iat: now,
        exp: now + 3600,
      },
      testSecret,
    );

    // 1. Initialize MCP session
    const initRes = await request(app)
      .post("/mcp")
      .set("Authorization", `Bearer ${token}`)
      .set("Accept", "application/json, text/event-stream")
      .send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {},
      });
    if (initRes.status !== 200) {
      throw new Error(`initialize failed with ${initRes.status}: ${initRes.text}`);
    }

    // 2. Query tools/list
    const res = await request(app)
      .post("/mcp")
      .set("Authorization", `Bearer ${token}`)
      .set("Accept", "application/json, text/event-stream")
      .send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });

    if (res.status !== 200) {
      throw new Error(`HTTP /mcp failed with ${res.status}: ${res.text}`);
    }

    const tools = (res.body?.result?.tools ?? []) as Array<{ name: string }>;
    const toolNames = tools.map((t) => t.name).sort();
    expect(toolNames).toEqual(EXPECTED_PUBLIC_MVP_TOOLS);
  });

  it("S02: excluded tools are not registered and direct tools/call returns tool not found", async () => {
    const server = createJpBidsServer({ profile: "public_mvp" });
    const client = new Client({ name: "s02-test", version: "1.0.0" });
    const [ct, st] = InMemoryTransport.createLinkedPair();

    await Promise.all([server.connect(st), client.connect(ct)]);

    const toolsList = await client.listTools();
    const toolNames = new Set(toolsList.tools.map((t) => t.name));

    for (const excluded of EXCLUDED_PRO_TOOLS) {
      expect(toolNames.has(excluded)).toBe(false);
      const res = await client.callTool({ name: excluded, arguments: {} });
      expect(res.isError).toBe(true);
      expect((res.content[0] as { text: string }).text).toContain(`Tool ${excluded} not found`);
    }

    await client.close();
    await server.close();
  });

  it("S03: public_mvp registers only approved resources and prompts, and UI URI is strictly ui://jp-bids/search-results.html", async () => {
    const server = createJpBidsServer({ profile: "public_mvp" });
    const client = new Client({ name: "s03-test", version: "1.0.0" });
    const [ct, st] = InMemoryTransport.createLinkedPair();

    await Promise.all([server.connect(st), client.connect(ct)]);

    // Check resources
    const resources = await client.listResources();
    const resourceUris = resources.resources.map((r) => r.uri);
    expect(resourceUris).toEqual(
      expect.arrayContaining([
        "attribution://kkj",
        "docs://api-reference",
        "codes://prefectures",
        "ui://jp-bids/search-results.html",
      ]),
    );
    expect(resourceUris).not.toContain("docs://agentic-cloud-roadmap");
    expect(resourceUris).not.toContain("docs://agentic-security-storage-readiness");
    expect(resourceUris).not.toContain("ui://jp-bids/investor-radar.html");
    expect(resourceUris).not.toContain("ui://apps/search-results.html");

    // Check templates
    const templates = await client.listResourceTemplates();
    const templateUris = templates.resourceTemplates.map((t) => t.uriTemplate);
    expect(templateUris).toContain("prefecture://{lg_code}");
    expect(templateUris).not.toContain("bid://{bid_key}");
    expect(templateUris).not.toContain("org://{organization_name}");

    // Check prompts
    const prompts = await client.listPrompts();
    const promptNames = prompts.prompts.map((p) => p.name).sort();
    expect(promptNames).toEqual(
      ["morning_bid_briefing", "bid_due_alert", "bid_discovery_workspace"].sort(),
    );
    expect(promptNames).not.toContain("competitor_radar");
    expect(promptNames).not.toContain("investor_radar_briefing");

    await client.close();
    await server.close();
  });

  it("S04: profile resolution defaults to public_mvp and each production indicator individually blocks full_local", () => {
    // Default & valid resolution
    expect(resolveServerProfile()).toBe(PUBLIC_MVP_PROFILE);
    expect(resolveServerProfile("public_mvp")).toBe(PUBLIC_MVP_PROFILE);
    expect(() => resolveServerProfile("invalid_profile")).toThrow(UserInputError);

    // Development allows full_local
    expect(resolveServerProfile("full_local")).toBe(FULL_LOCAL_PROFILE);

    // 1. K_SERVICE alone blocks full_local
    delete process.env.NODE_ENV;
    delete process.env.JP_BIDS_ENV;
    process.env.K_SERVICE = "jp-bids-service";
    expect(isProductionEnvironment()).toBe(true);
    expect(() => resolveServerProfile("full_local")).toThrow(UserInputError);
    expect(() => createJpBidsServer({ profile: "full_local" })).toThrow(UserInputError);

    // 2. NODE_ENV=production alone blocks full_local
    delete process.env.K_SERVICE;
    delete process.env.JP_BIDS_ENV;
    process.env.NODE_ENV = "production";
    expect(isProductionEnvironment()).toBe(true);
    expect(() => resolveServerProfile("full_local")).toThrow(UserInputError);
    expect(() => createJpBidsServer({ profile: "full_local" })).toThrow(UserInputError);

    // 3. JP_BIDS_ENV=production alone blocks full_local
    delete process.env.K_SERVICE;
    delete process.env.NODE_ENV;
    process.env.JP_BIDS_ENV = "production";
    expect(isProductionEnvironment()).toBe(true);
    expect(() => resolveServerProfile("full_local")).toThrow(UserInputError);
    expect(() => createJpBidsServer({ profile: "full_local" })).toThrow(UserInputError);
  });

  it("C01: Stripe calls remain exactly 0 across all operations even when Stripe keys and customer IDs are configured", async () => {
    // Configure Stripe environment variables
    process.env.JP_BIDS_PROFILE = "public_mvp";
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy_key_should_never_be_called";
    process.env.STRIPE_DEFAULT_CUSTOMER_ID = "cus_dummy_customer_123";

    // Spy on billing module entrypoint
    const spyRecordPdf = vi.spyOn(billing, "recordPdfExtractionUsage");

    const xml = await readFile("tests/fixtures/kkj-search.xml", "utf8");
    const kkjClient = new KkjClient({
      rateLimitPerSecond: 1000,
      fetchImpl: async () => new Response(xml, { status: 200 }),
    });

    const server = createJpBidsServer({ profile: "public_mvp", kkjClient });
    const client = new Client({ name: "c01-stripe-zero-test", version: "1.0.0" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(st), client.connect(ct)]);

    // 1. Execute search_bids (success path)
    const resSearch = await client.callTool({
      name: "search_bids",
      arguments: { query: "クラウド", limit: 5 },
    });
    expect(resSearch.isError).toBeFalsy();

    // 2. Execute list_recent_bids (success path)
    const resRecent = await client.callTool({
      name: "list_recent_bids",
      arguments: { days: 7, limit: 5 },
    });
    expect(resRecent.isError).toBeFalsy();

    // 3. Execute rank_bids with keywords (success path)
    const resRank = await client.callTool({
      name: "rank_bids",
      arguments: { query: "システム", preferred_keywords: ["クラウド"] },
    });
    expect(resRank.isError).toBeFalsy();

    // 4. Execute extract_bid_requirements with fetch_documents: false (success path)
    const resExtract = await client.callTool({
      name: "extract_bid_requirements",
      arguments: { bid_key: "KKJ-TEST-001", fetch_documents: false },
    });
    expect(resExtract.isError).toBeFalsy();

    // 5. Execute export_bid_shortlist (success path)
    const resExport = await client.callTool({
      name: "export_bid_shortlist",
      arguments: { query: "保守", format: "csv" },
    });
    expect(resExport.isError).toBeFalsy();

    // 6. Direct call to enrichWithDocumentExtraction (success path, public_mvp)
    const extraction = {
      bid: mockSampleBid,
      knownRequirements: {},
      documentTargets: [{ name: "仕様書", uri: "https://example.go.jp/spec.pdf" }],
      missingRequirements: [],
      extractionPlan: [],
      safetyNotes: [],
      extractedFromDocuments: [],
      extractionWarnings: [],
      attribution: createAttribution(),
    };
    await enrichWithDocumentExtraction(
      server,
      extraction,
      ["https://example.go.jp/spec.pdf"],
      undefined,
      "public_mvp",
    );

    // Assert that Stripe billing call count is exactly 0 across all SUCCESSFUL operations
    expect(spyRecordPdf).toHaveBeenCalledTimes(0);

    await client.close();
    await server.close();
  });

  it("C01-1: factory profile public_mvp overrides environment mismatch without billing or pro tools", async () => {
    // Environment claims full_local with stripe keys, but server factory is locked to public_mvp
    process.env.JP_BIDS_PROFILE = "full_local";
    process.env.STRIPE_SECRET_KEY = "sk_test_mismatch_key";
    process.env.STRIPE_DEFAULT_CUSTOMER_ID = "cus_mismatch_456";

    const spyRecordPdf = vi.spyOn(billing, "recordPdfExtractionUsage");
    const xml = await readFile("tests/fixtures/kkj-search.xml", "utf8");
    const kkjClient = new KkjClient({
      rateLimitPerSecond: 1000,
      fetchImpl: async () => new Response(xml, { status: 200 }),
    });

    const server = createJpBidsServer({ profile: "public_mvp", kkjClient });
    const client = new Client({ name: "c01-mismatch-test", version: "1.0.0" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(st), client.connect(ct)]);

    // Tools list must strictly match 7 public MVP tools
    const toolList = await client.listTools();
    const toolNames = toolList.tools.map((t) => t.name).sort();
    expect(toolNames).toEqual(EXPECTED_PUBLIC_MVP_TOOLS);

    // Call export_bid_shortlist with successful mock search
    const exportRes = await client.callTool({
      name: "export_bid_shortlist",
      arguments: { query: "クラウド", format: "csv" },
    });
    expect(exportRes.isError).toBeFalsy();

    // Call enrichWithDocumentExtraction with public_mvp profile
    const extraction = {
      bid: mockSampleBid,
      knownRequirements: {},
      documentTargets: [{ name: "仕様書", uri: "https://example.go.jp/spec.pdf" }],
      missingRequirements: [],
      extractionPlan: [],
      safetyNotes: [],
      extractedFromDocuments: [],
      extractionWarnings: [],
      attribution: createAttribution(),
    };
    await enrichWithDocumentExtraction(
      server,
      extraction,
      ["https://example.go.jp/spec.pdf"],
      undefined,
      "public_mvp",
    );

    expect(spyRecordPdf).toHaveBeenCalledTimes(0);

    await client.close();
    await server.close();
  });
});
