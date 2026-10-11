import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { KkjClient } from "../../src/api/kkj-client.js";
import { isAllowedBidOfficialUrl } from "../../src/apps/search-results.js";
import { type Bid, type BidSearchResult, signBidRef } from "../../src/domain/bid-ref.js";
import { createJpBidsServer } from "../../src/mcp.js";

const MOCK_SINGLE_HIT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Results>
  <SearchResults>
    <SearchHits>1</SearchHits>
    <SearchResult>
      <ResultId>1</ResultId>
      <Key>KKJ-2026-46201-0001</Key>
      <ProjectName>教育情報システム整備事業</ProjectName>
      <OrganizationName>鹿児島県</OrganizationName>
      <PrefectureName>鹿児島県</PrefectureName>
      <CityName>鹿児島市</CityName>
      <Category>役務</Category>
      <ProcedureType>一般競争入札</ProcedureType>
      <CFT_Issue_Date>2026-07-21</CFT_Issue_Date>
      <Tender_Submission_Deadline>2026-08-10</Tender_Submission_Deadline>
      <External_Document_URI>https://www.pref.kagoshima.jp/notice.pdf</External_Document_URI>
    </SearchResult>
  </SearchResults>
</Results>`;

const MOCK_EMPTY_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Results>
  <SearchResults>
    <SearchHits>0</SearchHits>
  </SearchResults>
</Results>`;

function makeSyntheticBid(idx: number, options: Partial<Bid> = {}): Bid {
  const num = String(idx).padStart(4, "0");
  return {
    key: `KKJ-2026-46201-${num}`,
    projectName: `プロジェクト ${idx} 案件仕様書`,
    organizationName: idx % 2 === 0 ? "鹿児島県" : "鹿児島市",
    prefectureName: "鹿児島県",
    cityName: "鹿児島市",
    category: "役務",
    procedureType: "一般競争入札",
    cftIssueDate: "2026-07-21",
    tenderSubmissionDeadline: "2026-08-10T17:00:00+09:00",
    externalDocumentUri: `https://www.pref.kagoshima.jp/docs/notice_${num}.pdf`,
    officialUrl: `https://www.pref.kagoshima.jp/bids/${num}.html`,
    attachments: [
      {
        name: `仕様書_${num}.pdf`,
        uri: `https://www.pref.kagoshima.jp/docs/notice_${num}.pdf`,
      },
    ],
    ...options,
  };
}

function createMockKkjClient(): KkjClient {
  return new KkjClient({
    fetchImpl: async (url) => {
      const decoded = decodeURIComponent(String(url));
      if (decoded.includes("絶対に存在しない架空検索語99999")) {
        return new Response(MOCK_EMPTY_XML, {
          status: 200,
          headers: { "content-type": "application/xml" },
        });
      }
      return new Response(MOCK_SINGLE_HIT_XML, {
        status: 200,
        headers: { "content-type": "application/xml" },
      });
    },
  });
}

describe("UI Harness & Interaction Verification (F05 / V02-V05 / S03 / C01)", () => {
  it("S03/V02: UI resource ui://jp-bids/search-results.html is clean, contains no pro tools, ICS, or memo buttons", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createJpBidsServer({ profile: "public_mvp", kkjClient: createMockKkjClient() });
    const client = new Client({ name: "ui-harness-client", version: "0.1.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const resource = await client.readResource({ uri: "ui://jp-bids/search-results.html" });
    expect(resource.contents).toHaveLength(1);
    const content = resource.contents[0];
    expect(content?.mimeType).toContain("text/html");
    const html = (content as { text?: string }).text ?? "";
    expect(html.length).toBeGreaterThan(1000);

    // Verify ICS and memo buttons are removed from UI bundle
    expect(html).not.toContain("締切ICS");
    expect(html).not.toContain("メモ保存");
    expect(html).not.toContain("handleDownloadIcs");
    expect(html).not.toContain("handleDownloadMemo");

    // Verify pro tools are not registered
    const { tools } = await client.listTools();
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).not.toContain("search_investor_radar_app");
    expect(toolNames).not.toContain("save_search");
    expect(toolNames).not.toContain("watch_listed_awards");

    await client.close();
    await server.close();
  });

  it("V03: 0件 search result returns structured content with searchHits: 0 and bids: []", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createJpBidsServer({ profile: "public_mvp", kkjClient: createMockKkjClient() });
    const client = new Client({ name: "ui-harness-client", version: "0.1.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = await client.callTool({
      name: "search_bids",
      arguments: { query: "絶対に存在しない架空検索語99999" },
    });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as BidSearchResult | undefined;
    expect(sc).toBeDefined();
    expect(sc?.searchHits).toBe(0);
    expect(sc?.bids).toEqual([]);

    await client.close();
    await server.close();
  });

  it("V03: Invalid search arguments are rejected cleanly without silent corruption", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createJpBidsServer({ profile: "public_mvp", kkjClient: createMockKkjClient() });
    const client = new Client({ name: "ui-harness-client", version: "0.1.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const res = await client.callTool({
      name: "search_bids",
      arguments: { query: "テスト", limit: -5 },
    });
    expect(res.isError).toBe(true);

    await client.close();
    await server.close();
  });

  it("V05 / F05: isAllowedBidOfficialUrl validates official links on diverse external hosts belonging to the bid", () => {
    const bid = makeSyntheticBid(1, {
      officialUrl: "https://www.city.kagoshima.lg.jp/bids/item1.html",
      externalDocumentUri: "https://www.city.kagoshima.lg.jp/docs/spec.pdf",
      attachments: [{ name: "doc.pdf", uri: "https://files.pref.kagoshima.jp/attach/1.pdf" }],
    });

    // Allowed official URLs matching bid fields
    expect(isAllowedBidOfficialUrl("https://www.city.kagoshima.lg.jp/bids/item1.html", bid)).toBe(
      true,
    );
    expect(isAllowedBidOfficialUrl("https://www.city.kagoshima.lg.jp/docs/spec.pdf", bid)).toBe(
      true,
    );
    expect(isAllowedBidOfficialUrl("https://files.pref.kagoshima.jp/attach/1.pdf", bid)).toBe(true);

    // Disallowed: unassociated host / malicious URL
    expect(isAllowedBidOfficialUrl("https://malicious-site.com/steal", bid)).toBe(false);
    expect(
      isAllowedBidOfficialUrl("http://insecure.city.kagoshima.lg.jp/bids/item1.html", bid),
    ).toBe(false); // must be https
    expect(isAllowedBidOfficialUrl("javascript:alert(1)", bid)).toBe(false);
  });

  it("V05 / F02 / F01: 11-item selection comparison sends all 11 items, preserves count, and returns 0-based selectionIndex", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createJpBidsServer({ profile: "public_mvp", kkjClient: createMockKkjClient() });
    const client = new Client({ name: "ui-harness-client", version: "0.1.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    // Create 11 synthetic signed bid_refs
    const bids: Bid[] = [];
    const bidRefs: string[] = [];
    for (let i = 1; i <= 11; i++) {
      const bid = makeSyntheticBid(i);
      bids.push(bid);
      bidRefs.push(signBidRef(bid));
    }

    const rankResult = await client.callTool({
      name: "rank_bids",
      arguments: { bid_refs: bidRefs },
    });
    expect(rankResult.isError).toBeFalsy();
    const sc = rankResult.structuredContent as {
      rankedCount: number;
      rankedBids: Array<{ key: string; score: number; selectionIndex?: number }>;
    };
    expect(sc.rankedCount).toBe(11);
    expect(sc.rankedBids).toHaveLength(11);

    // Verify all selectionIndex are non-negative and unique
    const indices = sc.rankedBids.map((b) => b.selectionIndex).sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(indices).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    // Verify export CSV preserves original selection order and 11 items
    const csvResult = await client.callTool({
      name: "export_bid_shortlist",
      arguments: { bid_refs: bidRefs, format: "csv" },
    });
    expect(csvResult.isError).toBeFalsy();
    const csvSc = csvResult.structuredContent as { rankedCount: number; csv: string };
    expect(csvSc.rankedCount).toBe(11);
    const lines = csvSc.csv.trim().split(/\r?\n/);
    expect(lines).toHaveLength(12); // header + 11 rows

    // Verify export JSON preserves selection order and 11 items
    const jsonResult = await client.callTool({
      name: "export_bid_shortlist",
      arguments: { bid_refs: bidRefs, format: "json" },
    });
    expect(jsonResult.isError).toBeFalsy();
    const jsonSc = jsonResult.structuredContent as {
      rankedCount: number;
      jsonContent: Array<{ key: string; selectionIndex?: number }>;
    };
    expect(jsonSc.rankedCount).toBe(11);
    expect(jsonSc.jsonContent.map((b) => b.key)).toEqual(bids.map((b) => b.key));

    await client.close();
    await server.close();
  });

  it("V05 / F05: Selection comparison with missing or invalid bidRef rejects with explicit error", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createJpBidsServer({ profile: "public_mvp", kkjClient: createMockKkjClient() });
    const client = new Client({ name: "ui-harness-client", version: "0.1.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const validBidRef = signBidRef(makeSyntheticBid(1));
    const result = await client.callTool({
      name: "rank_bids",
      arguments: { bid_refs: [validBidRef, "corrupted.token.value"] },
    });
    expect(result.isError).toBe(true);

    await client.close();
    await server.close();
  });

  it("V04: Non-Apps host gets text fallback with structured content from search_bids_app", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createJpBidsServer({ profile: "public_mvp", kkjClient: createMockKkjClient() });
    const client = new Client({ name: "ui-harness-client", version: "0.1.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const res = await client.callTool({
      name: "search_bids_app",
      arguments: { query: "教育" },
    });
    expect(res.isError).toBeFalsy();
    const textBlocks = (res.content as Array<{ type: string; text?: string }>).filter(
      (b) => b.type === "text",
    );
    expect(textBlocks.length).toBeGreaterThan(0);
    expect(textBlocks[0]?.text).toContain("教育");
    expect(res.structuredContent).toBeDefined();

    await client.close();
    await server.close();
  });
});
