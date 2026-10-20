import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { KkjClient } from "../../src/api/kkj-client.js";
import { createAttribution } from "../../src/domain/attribution.js";
import type { Bid, BidSearchResult } from "../../src/domain/bid.js";
import { createJpBidsServer } from "../../src/mcp.js";

// Test utility CSV parser handling quotes, escaped quotes, commas, and newlines (for row and cell inspection)
function parseCsvRows(csvText: string): string[][] {
  const clean = csvText.startsWith("\ufeff") ? csvText.slice(1) : csvText;
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = "";
  let insideQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];
    const nextChar = clean[i + 1];

    if (insideQuotes) {
      if (char === '"' && nextChar === '"') {
        currentCell += '"';
        i++; // skip escaped quote
      } else if (char === '"') {
        insideQuotes = false;
      } else {
        currentCell += char;
      }
    } else {
      if (char === '"') {
        insideQuotes = true;
      } else if (char === ",") {
        currentRow.push(currentCell);
        currentCell = "";
      } else if (char === "\n" || (char === "\r" && nextChar === "\n")) {
        if (char === "\r") i++;
        currentRow.push(currentCell);
        currentCell = "";
        if (currentRow.length > 0 && currentRow.some((c) => c.trim().length > 0)) {
          rows.push(currentRow);
        }
        currentRow = [];
      } else {
        currentCell += char;
      }
    }
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell);
    if (currentRow.some((c) => c.trim().length > 0)) {
      rows.push(currentRow);
    }
  }

  return rows;
}

const mockBids: Bid[] = [
  {
    resultId: 1,
    key: "key_mof_1",
    projectName: "高度情報化セミナー動画作成に係る業務委託(区分２)",
    organizationName: "財務省",
    prefectureName: "東京都",
    category: "役務",
    procedureType: "一般競争入札",
    cftIssueDate: "2026-10-16T00:00:00+09:00",
    externalDocumentUri: "https://www.p-portal.go.jp/pps-web-biz/UAA01/OAA0101",
  },
  {
    resultId: 2,
    key: "key_mod_1",
    projectName: "【防衛装備庁】海洋監視システムの設置作業役務",
    organizationName: "防衛省",
    prefectureName: "東京都",
    category: "役務",
    procedureType: "一般競争入札",
    cftIssueDate: "2026-10-16T00:00:00+09:00",
    externalDocumentUri: "https://www.p-portal.go.jp/pps-web-biz/UAA01/OAA0101",
  },
  {
    resultId: 3,
    key: "key_env_1",
    projectName: "令和８年度福島復興現場におけるGX建設機械試行工事に関する調査委託業務",
    organizationName: "環境省",
    prefectureName: "東京都",
    category: "役務",
    procedureType: "一般競争入札",
    cftIssueDate: "2026-10-09T00:00:00+09:00",
    externalDocumentUri: "https://www.p-portal.go.jp/pps-web-biz/UAA01/OAA0101",
  },
];

describe("CSV Pipeline Fidelity & Pass-through Verification (No External Calls)", () => {
  it("CPF-01: MCP export_bid_shortlist search-mode response fidelity and simulated BOM pass-through", async () => {
    // Setup Mock KKJ Client (Returns deterministic mock data without network)
    const mockSearchResult: BidSearchResult = {
      searchHits: mockBids.length,
      returnedCount: mockBids.length,
      bids: mockBids,
      query: { query: "システム", prefecture: "東京都" },
      attribution: createAttribution(),
    };

    const kkjClient = new KkjClient();
    kkjClient.search = async () => mockSearchResult;

    const server = createJpBidsServer({
      kkjClient,
      profile: "public_mvp",
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
    await client.connect(clientTransport);

    try {
      // 1. Call export_bid_shortlist via MCP in search mode
      const result = await client.callTool({
        name: "export_bid_shortlist",
        arguments: {
          query: "システム",
          prefecture: "東京都",
          format: "csv",
          shortlist_limit: 5,
        },
      });

      expect(result.isError).toBeFalsy();

      // Verify structuredContent.csv exists and is raw string
      const structured = result.structuredContent as {
        csv?: string;
        filename?: string;
        rankedCount?: number;
      };
      expect(structured).toBeDefined();
      expect(typeof structured.csv).toBe("string");
      const rawServerCsv = structured.csv as string;

      // 2. Simulated BOM Pass-Through Verification (simulating search-results.tsx handleExportBids)
      // NOTE: This verifies string handling and BOM attachment logic in isolation, NOT actual browser UI or dialog interactions.
      const simulatedDownloadText = rawServerCsv.startsWith("\ufeff")
        ? rawServerCsv
        : `\ufeff${rawServerCsv}`;

      // Strict equality: removing BOM reproduces exact server CSV string
      expect(simulatedDownloadText.slice(1)).toBe(rawServerCsv);

      // Verify line break encoding: exactly LF (\n)
      expect(rawServerCsv).not.toContain("\r\n");
      expect(rawServerCsv.split("\n").length).toBe(mockBids.length + 1); // 1 header + 3 data

      // 3. 16-column structure, row count, and key-to-organization mapping inspection
      const rows = parseCsvRows(rawServerCsv);
      const header = rows[0];

      // Verify header has exactly 16 columns
      expect(header.length).toBe(16);

      const keyCol = header.indexOf("key");
      const orgCol = header.indexOf("organization_name");
      const reasonsCol = header.indexOf("fit_reasons");

      expect(keyCol).toBeGreaterThanOrEqual(0);
      expect(orgCol).toBeGreaterThanOrEqual(0);
      expect(reasonsCol).toBeGreaterThanOrEqual(0);

      const dataRows = rows.slice(1);
      // Verify data row count matches expected count
      expect(dataRows.length).toBe(mockBids.length);

      // Verify each data row has exactly 16 columns
      for (const row of dataRows) {
        expect(row.length).toBe(16);
      }

      // Verify bid keys match expected keys in order
      const expectedKeys = mockBids.map((b) => b.key);
      const actualKeys = dataRows.map((r) => r[keyCol]);
      expect(actualKeys).toEqual(expectedKeys);

      for (const row of dataRows) {
        const key = row[keyCol];
        const org = row[orgCol];
        const reasons = row[reasonsCol];

        const originalBid = mockBids.find((b) => b.key === key);
        expect(originalBid).toBeDefined();
        expect(org).toBe(originalBid?.organizationName);

        // Crucial: check reason parity with organization
        expect(reasons).toContain(`発注機関が確認できる: ${originalBid?.organizationName}`);

        // Ensure NO other organization name appears in the reason tag
        for (const other of mockBids) {
          if (other.organizationName !== originalBid?.organizationName) {
            expect(reasons).not.toContain(`発注機関が確認できる: ${other.organizationName}`);
          }
        }
      }

      // 4. Repeated execution consistency (10 consecutive calls)
      for (let i = 0; i < 10; i++) {
        const repeatRes = await client.callTool({
          name: "export_bid_shortlist",
          arguments: {
            query: "システム",
            prefecture: "東京都",
            format: "csv",
            shortlist_limit: 5,
          },
        });
        const repeatStructured = repeatRes.structuredContent as { csv?: string };
        expect(repeatStructured.csv).toBe(rawServerCsv);
      }
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("CPF-02: Selection mode (bid_refs) export fidelity across mixed organizations", async () => {
    const originalSecret = process.env.JP_BIDS_OAUTH_SECRET;
    process.env.JP_BIDS_OAUTH_SECRET = "test-secret-at-least-32-bytes-long-for-signing";

    const { signBidRef } = await import("../../src/domain/bid-ref.js");

    const refMof = signBidRef(mockBids[0]);
    const refMod = signBidRef(mockBids[1]);
    const refEnv = signBidRef(mockBids[2]);

    let kkjSearchCalls = 0;
    const kkjClient = new KkjClient();
    // Replace search method with non-network mock that fails if unexpectedly called
    kkjClient.search = async () => {
      kkjSearchCalls++;
      throw new Error("kkjClient.search must not be called during selection mode export");
    };

    const server = createJpBidsServer({
      kkjClient,
      profile: "public_mvp",
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
    await client.connect(clientTransport);

    try {
      // Call in order: Env -> Mod -> Mof
      const result = await client.callTool({
        name: "export_bid_shortlist",
        arguments: {
          bid_refs: [refEnv, refMod, refMof],
          format: "csv",
        },
      });

      expect(result.isError).toBeFalsy();

      // Ensure search method was not called at all (0 network/search calls)
      expect(kkjSearchCalls).toBe(0);

      const structured = result.structuredContent as { csv?: string };
      const rawCsv = structured.csv as string;

      const rows = parseCsvRows(rawCsv);
      const header = rows[0];

      // Verify header has exactly 16 columns
      expect(header.length).toBe(16);

      const keyCol = header.indexOf("key");
      const orgCol = header.indexOf("organization_name");
      const reasonsCol = header.indexOf("fit_reasons");

      expect(keyCol).toBeGreaterThanOrEqual(0);
      expect(orgCol).toBeGreaterThanOrEqual(0);
      expect(reasonsCol).toBeGreaterThanOrEqual(0);

      const dataRows = rows.slice(1);
      // Verify data count matches the 3 selected items
      expect(dataRows.length).toBe(3);

      // Verify each data row has exactly 16 columns
      for (const row of dataRows) {
        expect(row.length).toBe(16);
      }

      // Verify candidate keys match the expected selection order
      const expectedSelectionKeys = ["key_env_1", "key_mod_1", "key_mof_1"];
      const actualSelectionKeys = dataRows.map((r) => r[keyCol]);
      expect(actualSelectionKeys).toEqual(expectedSelectionKeys);

      // Verify row 1 (Env)
      expect(rows[1][orgCol]).toBe("環境省");
      expect(rows[1][reasonsCol]).toContain("発注機関が確認できる: 環境省");
      expect(rows[1][reasonsCol]).not.toContain("財務省");

      // Verify row 2 (Mod)
      expect(rows[2][orgCol]).toBe("防衛省");
      expect(rows[2][reasonsCol]).toContain("発注機関が確認できる: 防衛省");

      // Verify row 3 (Mof)
      expect(rows[3][orgCol]).toBe("財務省");
      expect(rows[3][reasonsCol]).toContain("発注機関が確認できる: 財務省");
    } finally {
      await client.close();
      await server.close();
      // Reliably restore original environment variable
      if (originalSecret === undefined) {
        delete process.env.JP_BIDS_OAUTH_SECRET;
      } else {
        process.env.JP_BIDS_OAUTH_SECRET = originalSecret;
      }
    }
  });
});
