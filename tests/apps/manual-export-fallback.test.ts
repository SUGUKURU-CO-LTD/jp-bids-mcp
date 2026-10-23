// Unit tests for manual CSV export fallback and diagnostics
// Validates all required criteria from user specifications:
// 1. downloadFile unavailable + clipboard write failure -> falls back to manual display + records diagnostic stage
// 2. downloadFile error response / exception + clipboard write failure -> falls back to manual display + records error stage/name
// 3. Case 3 split (MCP spec compliance & strict 16-column / 21-column CSV verification):
//    - 3-1: isError: true -> stops as error
//    - 3-2: isError: false + valid 16-col CSV -> proceeds to save (production server output shape)
//    - 3-3: isError omitted + valid 16-col CSV -> proceeds to save (MCP default false)
//    - 3-4a: isError omitted + structuredContent missing -> stops as invalid format
//    - 3-4b: isError omitted + non-matching header text ("説明,これはCSVではありません") -> stops
//    - 3-4c: header column count mismatch (e.g. 2 cols or 9 cols) -> stops
//    - 3-4d: data row column count mismatch -> stops
//    - 3-4e: parsed data row count mismatch with rankedCount -> stops
//    - 3-4f: rankedCount missing or invalid (non-integer, negative, string) -> does not fallback to 0, stops
//    - 3-4g: unclosed quotes in CSV -> stops with parse error
//    - 3-4h: stray quote inside unquoted field -> stops with parse error
//    - 3-4i: stray characters after closing quote -> stops with parse error
//    - 3-5a: valid 21-col CSV with exact 16 base + 5 extra columns -> passes
//    - 3-5b: 21-col CSV with invalid extra column name/order -> stops
// 4. complex 16-col CSV with Japanese, quotes, commas, cell-internal newlines, BOM -> raw text fidelity vs display differences
// 5. subsequent export with different selection -> resets old export data completely
// 6. token auditing without secret leakage + diagnostic report verification
// 7. async race condition prevention:
//    - 7-1: Operation A delayed tool response ignored after Operation B or new search starts
//    - 7-2: Operation A delayed download/clipboard failure ignored after Operation B or new search starts (no manual display, no new copy)

import { describe, expect, it, vi } from "vitest";
import type { Bid } from "../../src/domain/bid.js";
import {
  auditTokens,
  EXPECTED_BASE_COLUMNS,
  EXPECTED_EXTRA_COLUMNS,
  extractCsvFromToolResult,
  getLatestDiagnosticReport,
  resetDiagnosticReport,
  updateDiagnosticReport,
  normalizeErrorName,
  parseCsvRows,
  type ManualExportState,
} from "../../src/apps/export-diagnostics.js";
import {
  FALLBACK_MANUAL_COPY_PROMPT,
  handleExportBids,
} from "../../src/apps/search-results.js";

describe("Manual Export Fallback & Diagnostic Pipeline", () => {
  const HEADER_16 = EXPECTED_BASE_COLUMNS.join(",");
  const HEADER_21 = [...EXPECTED_BASE_COLUMNS, ...EXPECTED_EXTRA_COLUMNS].join(",");

  const ROW_1 =
    'pursue,95,BID-DEFENSE-01,防衛省システム改修業務,防衛省,東京都,千代田区,役務,一般競争入札,2026-07-21,2026-08-03T17:00:00+09:00,2026-08-07T14:00:00+09:00,"適合度スコア (95点)",特になし,参加要件の確認,https://www.mod.go.jp/bids/01.html';

  const ROW_2 =
    'review,75,BID-JSPS-02,日本学術振興会サーバ運用保守,独立行政法人日本学術振興会,東京都,千代田区,役務,一般競争入札,2026-07-18,2026-08-19T17:00:00+09:00,2026-08-24T10:00:00+09:00,"適合度スコア (75点)",期限近接,質問書の提出検討,https://www.jsps.go.jp/bids/02.html';

  const VALID_16_CSV_2 = `${HEADER_16}\n${ROW_1}\n${ROW_2}\n`;
  const VALID_16_CSV_1 = `${HEADER_16}\n${ROW_1}\n`;

  const sampleBid1: Bid = {
    resultId: 1,
    key: "BID-DEFENSE-01",
    projectName: "防衛省システム改修業務",
    organizationName: "防衛省",
    bidRef: "token_defense_signed_ref_xyz1234567890",
  };

  const sampleBid2: Bid = {
    resultId: 2,
    key: "BID-JSPS-02",
    projectName: "日本学術振興会サーバ運用保守",
    organizationName: "独立行政法人日本学術振興会",
    bidRef: "token_jsps_signed_ref_abc0987654321",
  };

  const validBids = [sampleBid1, sampleBid2];

  // 1. downloadFile unavailable + clipboard failure -> manual display fallback + diagnostic verification
  it("Case 1: falls back to manual display when downloadFile is unavailable and clipboard write fails", async () => {
    let actionMessage = "";
    let manualData: ManualExportState | null = null;

    const mockApp = {
      getHostCapabilities: () => ({ serverTools: true, downloadFile: false }),
      callServerTool: vi.fn(async () => ({
        isError: false,
        structuredContent: {
          csv: VALID_16_CSV_2,
          rankedCount: 2,
          filename: "jp-bids-selection.csv",
        },
      })),
    };

    const originalClipboard = navigator.clipboard;
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: vi.fn().mockRejectedValue(new DOMException("Write permission denied", "NotAllowedError")),
      },
      configurable: true,
    });

    try {
      await handleExportBids(
        mockApp as never,
        validBids,
        "選択CSV",
        (msg) => {
          actionMessage = msg;
        },
        "csv",
        (data) => {
          manualData = data;
        },
      );

      expect(mockApp.callServerTool).toHaveBeenCalledWith({
        name: "export_bid_shortlist",
        arguments: {
          bid_refs: [sampleBid1.bidRef, sampleBid2.bidRef],
          format: "csv",
        },
      });

      expect(actionMessage).toBe(FALLBACK_MANUAL_COPY_PROMPT);
      expect(manualData).not.toBeNull();
      expect(manualData?.type).toBe("csv");
      expect(manualData?.itemCount).toBe(2);
      expect(manualData?.filename).toBe("jp-bids-selection.csv");
      expect(manualData?.rawText).toBe(VALID_16_CSV_2);
      // Download text must have BOM prefix
      expect(manualData?.downloadText.startsWith("\ufeff")).toBe(true);
      expect(manualData?.displayText).toBe(manualData?.rawText);

      // Verify collected diagnostic report
      const diag = getLatestDiagnosticReport();
      expect(diag.stage).toBe("manual_fallback");
      expect(diag.downloadFile?.capabilitySupported).toBe(false);
      expect(diag.downloadFile?.attempted).toBe(false);
      expect(diag.clipboard?.attempted).toBe(true);
      expect(diag.clipboard?.errorName).toBe("NotAllowedError");
      expect(diag.tokensAudit.count).toBe(2);
    } finally {
      Object.defineProperty(navigator, "clipboard", {
        value: originalClipboard,
        configurable: true,
      });
    }
  });

  // 2. downloadFile API error response / exception + clipboard failure + diagnostic verification
  it("Case 2: falls back to manual display and normalizes error when downloadFile returns error or throws and clipboard fails", async () => {
    let actionMessage = "";
    let manualData: ManualExportState | null = null;

    // Subcase 2a: downloadFile error response (result.isError: true)
    const mockAppWithErrorResponse = {
      getHostCapabilities: () => ({ serverTools: true, downloadFile: true }),
      callServerTool: vi.fn(async () => ({
        isError: false,
        structuredContent: {
          csv: VALID_16_CSV_1,
          rankedCount: 1,
        },
      })),
      downloadFile: vi.fn(async () => ({ isError: true, error: "Host rejected download" })),
    };

    const originalClipboard = navigator.clipboard;
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: vi.fn().mockRejectedValue(new DOMException("Must handle a user gesture", "SecurityError")),
      },
      configurable: true,
    });

    try {
      await handleExportBids(
        mockAppWithErrorResponse as never,
        [sampleBid1],
        "選択CSV",
        (msg) => {
          actionMessage = msg;
        },
        "csv",
        (data) => {
          manualData = data;
        },
      );

      expect(mockAppWithErrorResponse.downloadFile).toHaveBeenCalled();
      expect(actionMessage).toBe(FALLBACK_MANUAL_COPY_PROMPT);
      expect(manualData?.rawText).toBe(VALID_16_CSV_1);
      expect(manualData?.itemCount).toBe(1);

      // Verify diagnostic report for error response
      const diagResponse = getLatestDiagnosticReport();
      expect(diagResponse.stage).toBe("manual_fallback");
      expect(diagResponse.downloadFile?.capabilitySupported).toBe(true);
      expect(diagResponse.downloadFile?.attempted).toBe(true);
      expect(diagResponse.downloadFile?.resultIsError).toBe(true);
      expect(diagResponse.clipboard?.errorName).toBe("SecurityError");

      // Subcase 2b: downloadFile exception (throws)
      const mockAppWithThrow = {
        getHostCapabilities: () => ({ serverTools: true, downloadFile: true }),
        callServerTool: vi.fn(async () => ({
          isError: false,
          structuredContent: {
            csv: VALID_16_CSV_1,
            rankedCount: 1,
          },
        })),
        downloadFile: vi.fn(async () => {
          throw new DOMException("Connection aborted", "AbortError");
        }),
      };

      manualData = null;
      await handleExportBids(
        mockAppWithThrow as never,
        [sampleBid1],
        "選択CSV",
        (msg) => {
          actionMessage = msg;
        },
        "csv",
        (data) => {
          manualData = data;
        },
      );
      expect(actionMessage).toBe(FALLBACK_MANUAL_COPY_PROMPT);
      expect(manualData).not.toBeNull();

      // Verify diagnostic report for exception
      const diagThrow = getLatestDiagnosticReport();
      expect(diagThrow.stage).toBe("manual_fallback");
      expect(diagThrow.downloadFile?.errorName).toBe("AbortError");
      expect(diagThrow.clipboard?.errorName).toBe("SecurityError");
    } finally {
      Object.defineProperty(navigator, "clipboard", {
        value: originalClipboard,
        configurable: true,
      });
    }
  });

  // 3. Case 3 Split (MCP Specification Compliance & Strict 16-Column / 21-Column Verification)
  describe("Case 3: Response status & payload validation (MCP Specification & Strict column verification)", () => {
    // 3-1: isError: true -> stops as error
    it("Case 3-1: isError: true stops as tool error and does not proceed to save", async () => {
      let actionMessage = "";
      let manualData: ManualExportState | null = null;
      const mockApp = {
        getHostCapabilities: () => ({ serverTools: true }),
        callServerTool: vi.fn(async () => ({
          isError: true,
          content: [{ type: "text", text: "Invalid argument or expired token" }],
        })),
      };

      await handleExportBids(
        mockApp as never,
        validBids,
        "選択CSV",
        (msg) => {
          actionMessage = msg;
        },
        "csv",
        (data) => {
          manualData = data;
        },
      );

      expect(actionMessage).toContain("CSVとして解釈できませんでした");
      expect(manualData).toBeNull();
      const diag = getLatestDiagnosticReport();
      expect(diag.stage).toBe("tool_call_error");
    });

    // 3-2: isError: false + valid 16-col CSV -> proceeds to save (production server output shape)
    it("Case 3-2: isError: false + valid 16-col CSV proceeds to save using production server fixture", async () => {
      let actionMessage = "";
      let manualData: ManualExportState | null = null;

      // Production server output fixture
      const serverProductionResponse = {
        isError: false,
        content: [
          {
            type: "text",
            text: "入札shortlist CSV: 2件\nファイル名候補: jp-bids-selection-20261024.csv\n",
          },
        ],
        structuredContent: {
          csv: VALID_16_CSV_2,
          rankedCount: 2,
          filename: "jp-bids-selection-20261024.csv",
        },
      };

      const mockApp = {
        getHostCapabilities: () => ({ serverTools: true, downloadFile: true }),
        callServerTool: vi.fn(async () => serverProductionResponse),
        downloadFile: vi.fn(async () => ({ isError: false })),
      };

      await handleExportBids(
        mockApp as never,
        validBids,
        "選択CSV",
        (msg) => {
          actionMessage = msg;
        },
        "csv",
        (data) => {
          manualData = data;
        },
      );

      expect(mockApp.downloadFile).toHaveBeenCalledWith({
        contents: [
          {
            type: "resource",
            resource: {
              uri: "file:///jp-bids-selection-20261024.csv",
              mimeType: "text/csv;charset=utf-8",
              text: `\ufeff${VALID_16_CSV_2}`,
            },
          },
        ],
      });
      expect(actionMessage).toBe("CSV出力をHostへリクエストしました。");
      expect(manualData).toBeNull();
      const diag = getLatestDiagnosticReport();
      expect(diag.stage).toBe("download_file_success");
    });

    // 3-3: isError omitted + valid 16-col CSV -> proceeds to save (MCP spec default is false)
    it("Case 3-3: isError omitted + valid 16-col CSV proceeds to save (MCP spec default is false)", async () => {
      let actionMessage = "";

      const responseWithOmittedIsError = {
        structuredContent: {
          csv: VALID_16_CSV_1,
          rankedCount: 1,
          filename: "test.csv",
        },
      };

      const mockApp = {
        getHostCapabilities: () => ({ serverTools: true, downloadFile: true }),
        callServerTool: vi.fn(async () => responseWithOmittedIsError),
        downloadFile: vi.fn(async () => ({ isError: false })),
      };

      await handleExportBids(
        mockApp as never,
        [sampleBid1],
        "選択CSV",
        (msg) => {
          actionMessage = msg;
        },
        "csv",
      );

      expect(mockApp.downloadFile).toHaveBeenCalled();
      expect(actionMessage).toBe("CSV出力をHostへリクエストしました。");
    });

    // 3-4a: isError omitted + structuredContent missing
    it("Case 3-4a: isError omitted + missing structuredContent stops as invalid format", async () => {
      let actionMessage = "";
      const mockApp = {
        getHostCapabilities: () => ({ serverTools: true }),
        callServerTool: vi.fn(async () => ({
          content: [{ type: "text", text: "Some summary text" }],
        })),
      };
      await handleExportBids(
        mockApp as never,
        validBids,
        "選択CSV",
        (msg) => {
          actionMessage = msg;
        },
        "csv",
      );
      expect(actionMessage).toContain("CSVとして解釈できませんでした");
    });

    // 3-4b: isError omitted + non-matching header text ("説明,これはCSVではありません") -> stops
    it("Case 3-4b: stops when header does not match expected 16 columns (e.g., '説明,これはCSVではありません')", () => {
      const toolResult = {
        structuredContent: {
          csv: "説明,これはCSVではありません\n値1,値2\n",
          rankedCount: 1,
        },
      };
      const extracted = extractCsvFromToolResult(toolResult);
      expect(extracted.valid).toBe(false);
      if (!extracted.valid) {
        expect(extracted.reason).toContain("CSVヘッダーの列数不正");
      }
    });

    // 3-4c: header column count mismatch (e.g. 2 cols or 9 cols) -> stops
    it("Case 3-4c: stops when header has 9 cols instead of formal 16 columns", () => {
      const toolResult = {
        structuredContent: {
          csv: "key,projectName,organizationName,prefectureName,category,procedureType,cftIssueDate,tenderSubmissionDeadline,officialUrl\nK1,P1,O1,P1,C1,PT1,D1,D2,U1\n",
          rankedCount: 1,
        },
      };
      const extracted = extractCsvFromToolResult(toolResult);
      expect(extracted.valid).toBe(false);
      if (!extracted.valid) {
        expect(extracted.reason).toContain("CSVヘッダーの列数不正");
      }
    });

    // 3-4d: data row column count mismatch -> stops
    it("Case 3-4d: stops when data row has fewer columns than the 16-column header", () => {
      const invalidRowCsv = `${HEADER_16}\npursue,95,BID-01\n`;
      const toolResult = {
        structuredContent: {
          csv: invalidRowCsv,
          rankedCount: 1,
        },
      };
      const extracted = extractCsvFromToolResult(toolResult);
      expect(extracted.valid).toBe(false);
      if (!extracted.valid) {
        expect(extracted.reason).toContain("データ行 1 の列数がヘッダー列数と一致しません");
      }
    });

    // 3-4e: parsed data row count mismatch with rankedCount -> stops
    it("Case 3-4e: stops when parsed data row count (2) does not match rankedCount (3)", () => {
      const toolResult = {
        structuredContent: {
          csv: VALID_16_CSV_2, // has 2 data rows
          rankedCount: 3,       // metadata says 3
        },
      };
      const extracted = extractCsvFromToolResult(toolResult);
      expect(extracted.valid).toBe(false);
      if (!extracted.valid) {
        expect(extracted.reason).toContain("CSV解析データ件数 (2件) と rankedCount (3件) が一致しません");
      }
    });

    // 3-4f: rankedCount missing or invalid (non-integer, negative, string) -> does not fallback to 0, stops
    it("Case 3-4f: stops and does NOT silently fallback to 0 when rankedCount is missing or invalid", () => {
      // missing rankedCount
      const resMissing = {
        structuredContent: {
          csv: VALID_16_CSV_1,
        },
      };
      const extMissing = extractCsvFromToolResult(resMissing);
      expect(extMissing.valid).toBe(false);
      if (!extMissing.valid) {
        expect(extMissing.reason).toContain("rankedCount が不正または未設定です");
      }

      // string rankedCount
      const resString = {
        structuredContent: {
          csv: VALID_16_CSV_1,
          rankedCount: "1",
        },
      };
      const extString = extractCsvFromToolResult(resString);
      expect(extString.valid).toBe(false);
      if (!extString.valid) {
        expect(extString.reason).toContain("rankedCount が不正または未設定です");
      }

      // negative rankedCount
      const resNegative = {
        structuredContent: {
          csv: VALID_16_CSV_1,
          rankedCount: -1,
        },
      };
      const extNegative = extractCsvFromToolResult(resNegative);
      expect(extNegative.valid).toBe(false);
      if (!extNegative.valid) {
        expect(extNegative.reason).toContain("rankedCount が不正または未設定です");
      }
    });

    // 3-4g: unclosed quotes in CSV -> stops with parse error
    it("Case 3-4g: stops on unclosed quotes in CSV", () => {
      const unclosedCsv = `${HEADER_16}\npursue,95,BID-01,"防衛省案件\n`;
      const toolResult = {
        structuredContent: {
          csv: unclosedCsv,
          rankedCount: 1,
        },
      };
      const extracted = extractCsvFromToolResult(toolResult);
      expect(extracted.valid).toBe(false);
      if (!extracted.valid) {
        expect(extracted.reason).toContain("閉じていない引用符が検出されました");
      }
    });

    // 3-4h: stray quote inside unquoted field -> stops with parse error
    it("Case 3-4h: stops on stray quote inside unquoted cell", () => {
      const strayCsv = `${HEADER_16}\npursue,95,BID"01,防衛省案件,防衛省,東京都,千代田区,役務,一般競争入札,2026-07-21,2026-08-03,2026-08-07,適合,なし,確認,https://example.com\n`;
      const toolResult = {
        structuredContent: {
          csv: strayCsv,
          rankedCount: 1,
        },
      };
      const extracted = extractCsvFromToolResult(toolResult);
      expect(extracted.valid).toBe(false);
      if (!extracted.valid) {
        expect(extracted.reason).toContain("非引用フィールドの途中に不正な引用符");
      }
    });

    // 3-4i: stray characters after closing quote -> stops with parse error
    it("Case 3-4i: stops on stray characters immediately following closing quote", () => {
      const strayAfterQuoteCsv = `${HEADER_16}\npursue,95,"BID-01"extra,防衛省案件,防衛省,東京都,千代田区,役務,一般競争入札,2026-07-21,2026-08-03,2026-08-07,適合,なし,確認,https://example.com\n`;
      const toolResult = {
        structuredContent: {
          csv: strayAfterQuoteCsv,
          rankedCount: 1,
        },
      };
      const extracted = extractCsvFromToolResult(toolResult);
      expect(extracted.valid).toBe(false);
      if (!extracted.valid) {
        expect(extracted.reason).toContain("閉じ引用符の直後に不正な文字");
      }
    });

    // 3-5a: valid 21-col CSV with exact 16 base + 5 extra columns -> passes
    it("Case 3-5a: valid 21-col CSV with exact 16 base and 5 extra columns passes", () => {
      const row21 = `${ROW_1},"全省庁統一資格 A等級","申請書・誓約書",2026-08-03T17:00:00+09:00,2026-08-07T14:00:00+09:00,契約担当官`;
      const csv21 = `${HEADER_21}\n${row21}\n`;
      const toolResult = {
        structuredContent: {
          csv: csv21,
          rankedCount: 1,
        },
      };
      const extracted = extractCsvFromToolResult(toolResult);
      expect(extracted.valid).toBe(true);
      if (extracted.valid) {
        expect(extracted.itemCount).toBe(1);
      }
    });

    // 3-5b: 21-col CSV with invalid extra column name/order -> stops
    it("Case 3-5b: 21-col CSV with misordered or invalid extra columns is rejected", () => {
      const invalidExtraCols = [
        ...EXPECTED_BASE_COLUMNS,
        "pdf_eligibility",
        "wrong_extra_col",
        "pdf_submission_deadline",
        "pdf_opening_date",
        "pdf_contact_point",
      ].join(",");
      const row21 = `${ROW_1},"全省庁統一資格 A等級","申請書・誓約書",2026-08-03T17:00:00+09:00,2026-08-07T14:00:00+09:00,契約担当官`;
      const csvInvalidExtra = `${invalidExtraCols}\n${row21}\n`;
      const toolResult = {
        structuredContent: {
          csv: csvInvalidExtra,
          rankedCount: 1,
        },
      };
      const extracted = extractCsvFromToolResult(toolResult);
      expect(extracted.valid).toBe(false);
      if (!extracted.valid) {
        expect(extracted.reason).toContain("CSVヘッダーの追加列不一致");
      }
    });
  });

  // 4. Complex CSV: Japanese, quotes, commas, cell-internal newlines, BOM
  it("Case 4: preserves raw 16-col CSV fidelity and differentiates display vs raw vs BOM text with internal newlines", () => {
    const complexRow1 =
      'pursue,95,BID-01,"調達案件名（「物品・役務」，含む）","防衛省 陸上装備庁",東京都,千代田区,役務,一般競争入札,2026-07-21,2026-08-03,2026-08-07,"1行目適合理由\n2行目セル内改行あり",特になし,参加要件の確認,https://www.mod.go.jp/01.html';

    const complexRow2 =
      'review,70,BID-02,"科研費システム保守","独立行政法人日本学術振興会",東京都,千代田区,役務,一般競争入札,2026-07-18,2026-08-19,2026-08-24,"カンマ,を含む理由",期限近接,質問書の提出,https://www.jsps.go.jp/02.html';

    const complexCsv = `${HEADER_16}\n${complexRow1}\n${complexRow2}\n`;

    const toolResult = {
      isError: false,
      structuredContent: {
        csv: complexCsv,
        rankedCount: 2, // Note: newline count is higher due to cell newline, but parsed rows is 2!
        filename: "complex-test.csv",
      },
    };

    const extracted = extractCsvFromToolResult(toolResult);
    expect(extracted.valid).toBe(true);
    if (!extracted.valid) return;

    expect(extracted.rawCsv).toBe(complexCsv);
    expect(extracted.displayText).toBe(complexCsv);
    expect(extracted.downloadText).toBe(`\ufeff${complexCsv}`);
    expect(extracted.itemCount).toBe(2);

    const parseResult = parseCsvRows(complexCsv);
    expect(parseResult.success).toBe(true);
    if (!parseResult.success) return;

    const parsedRows = parseResult.rows;
    expect(parsedRows).toHaveLength(3); // header + 2 data rows
    expect(parsedRows[0]).toHaveLength(16);
    expect(parsedRows[1]).toHaveLength(16);
    expect(parsedRows[2]).toHaveLength(16);
    // Cell with internal newline correctly parsed as one cell
    expect(parsedRows[1]?.[12]).toBe("1行目適合理由\n2行目セル内改行あり");
  });

  // 5. Subsequent export resets old CSV
  it("Case 5: resets old manual export data completely on a new export attempt", async () => {
    let manualData: ManualExportState | null = {
      type: "csv",
      rawText: "old_data",
      displayText: "old_data",
      downloadText: "old_data",
      itemCount: 99,
      filename: "old.csv",
    };

    const mockApp = {
      getHostCapabilities: () => ({ serverTools: true }),
      callServerTool: vi.fn(async () => ({
        isError: true,
      })),
    };

    await handleExportBids(
      mockApp as never,
      validBids,
      "選択CSV",
      () => {},
      "csv",
      (data) => {
        manualData = data;
      },
    );

    expect(manualData).toBeNull();
  });

  // 6. Token auditing without secret leakage
  it("Case 6: audits token length and full/short SHA-256 hashes without leaking token strings", async () => {
    const tokens = [
      "token_alpha_1234567890abcdef",
      "token_beta_0987654321fedcba",
    ];

    const audit = await auditTokens(tokens);
    expect(audit).toHaveLength(2);
    expect(audit[0]?.length).toBe(tokens[0]!.length);
    expect(audit[0]?.fullHash).toMatch(/^[0-9a-f]{64}$/);
    expect(audit[0]?.shortPrefix).toBe(audit[0]!.fullHash.slice(0, 8));
    expect(audit[0]?.fullHash).not.toContain("token_alpha");
  });

  // 7. Async race condition tests
  describe("Case 7: Async race condition prevention across tool calls, downloadFile, and clipboard", () => {
    // 7-1: Operation A tool response arrives late after Operation B starts
    it("Case 7-1: ignores delayed tool response of Operation A after Operation B starts", async () => {
      let manualData: ManualExportState | null = null;
      let actionMessage = "";

      let resolveOperationA: ((val: unknown) => void) | undefined;
      const promiseA = new Promise((resolve) => {
        resolveOperationA = resolve;
      });

      const mockApp = {
        getHostCapabilities: () => ({ serverTools: true, downloadFile: false }),
        callServerTool: vi.fn().mockImplementationOnce(() => promiseA),
      };

      const originalClipboard = navigator.clipboard;
      Object.defineProperty(navigator, "clipboard", {
        value: {
          writeText: vi.fn().mockRejectedValue(new DOMException("denied", "NotAllowedError")),
        },
        configurable: true,
      });

      try {
        let isStaleA = false;
        // Start Operation A (delayed tool response)
        const executionA = handleExportBids(
          mockApp as never,
          [sampleBid1],
          "選択CSV (A)",
          (msg) => {
            actionMessage = msg;
          },
          "csv",
          (data) => {
            manualData = data;
          },
          () => isStaleA,
        );

        // User starts Operation B or executes new search -> marks Operation A stale
        isStaleA = true;
        manualData = null;
        // While tool call A is pending, user triggers Operation B or new search
        isStaleA = true;
        actionMessage = "Operation B started";
        updateDiagnosticReport({ stage: "tool_call_start" });

        // Now Operation A finishes late
        resolveOperationA?.({
          isError: false,
          structuredContent: {
            csv: VALID_16_CSV_1,
            rankedCount: 1,
          },
        });

        await executionA;

        // Result of A must NOT overwrite Operation B's state or diagnostic report
        expect(manualData).toBeNull();
        expect(actionMessage).toBe("Operation B started");
        expect(getLatestDiagnosticReport().stage).toBe("tool_call_start");
      } finally {
        Object.defineProperty(navigator, "clipboard", {
          value: originalClipboard,
          configurable: true,
        });
      }
    });

    // 7-2: Operation A tool response finishes, but download/clipboard delays and fails after Operation B starts
    it("Case 7-2: ignores delayed downloadFile error of Operation A after Operation B starts and preserves B diagnostic report", async () => {
      let manualData: ManualExportState | null = null;
      let actionMessage = "";

      let resolveDownloadA: ((val: unknown) => void) | undefined;
      const downloadPromiseA = new Promise((resolve) => {
        resolveDownloadA = resolve;
      });

      const mockApp = {
        getHostCapabilities: () => ({ serverTools: true, downloadFile: true }),
        callServerTool: vi.fn(async () => ({
          isError: false,
          structuredContent: {
            csv: VALID_16_CSV_1,
            rankedCount: 1,
            filename: "old-a.csv",
          },
        })),
        downloadFile: vi.fn().mockImplementationOnce(() => downloadPromiseA),
      };

      const clipboardWriteMock = vi.fn().mockRejectedValue(new DOMException("denied", "NotAllowedError"));
      const originalClipboard = navigator.clipboard;
      Object.defineProperty(navigator, "clipboard", {
        value: {
          writeText: clipboardWriteMock,
        },
        configurable: true,
      });

      try {
        let isStaleA = false;
        // Start Operation A
        const executionA = handleExportBids(
          mockApp as never,
          [sampleBid1],
          "選択CSV (A)",
          (msg) => {
            actionMessage = msg;
          },
          "csv",
          (data) => {
            manualData = data;
          },
          () => isStaleA,
        );

        // Wait for callServerTool and downloadFile to be reached (including auditTokens async hash)
        await new Promise((r) => setTimeout(r, 20));
        expect(mockApp.callServerTool).toHaveBeenCalled();
        expect(mockApp.downloadFile).toHaveBeenCalled();

        // While downloadFile is pending, user starts Operation B or executes new search
        isStaleA = true;
        manualData = null;
        actionMessage = "新規検索を開始しました";
        resetDiagnosticReport();
        updateDiagnosticReport({
          stage: "tool_call_start",
        });

        // Now downloadFile A fails late with error response
        resolveDownloadA?.({ isError: true, error: "Host rejected" });

        await executionA;

        // Old Operation A must NOT initiate clipboard write
        expect(clipboardWriteMock).not.toHaveBeenCalled();
        // Old Operation A must NOT display manual fallback panel
        expect(manualData).toBeNull();
        // Action message must NOT be overwritten by A
        expect(actionMessage).toBe("新規検索を開始しました");
        // Diagnostic report of Operation B must NOT be overwritten by delayed A
        const currentDiag = getLatestDiagnosticReport();
        expect(currentDiag.stage).toBe("tool_call_start");
        expect(currentDiag.downloadFile).toBeUndefined();
      } finally {
        Object.defineProperty(navigator, "clipboard", {
          value: originalClipboard,
          configurable: true,
        });
      }
    });

    // 7-3: Operation A downloadFile throws late exception after Operation B starts
    it("Case 7-3: ignores delayed downloadFile exception of Operation A and preserves B diagnostic report", async () => {
      let manualData: ManualExportState | null = null;
      let actionMessage = "";

      let rejectDownloadA: ((err: unknown) => void) | undefined;
      const downloadPromiseA = new Promise((_, reject) => {
        rejectDownloadA = reject;
      });

      const mockApp = {
        getHostCapabilities: () => ({ serverTools: true, downloadFile: true }),
        callServerTool: vi.fn(async () => ({
          isError: false,
          structuredContent: {
            csv: VALID_16_CSV_1,
            rankedCount: 1,
            filename: "old-a.csv",
          },
        })),
        downloadFile: vi.fn().mockImplementationOnce(() => downloadPromiseA),
      };

      const clipboardWriteMock = vi.fn().mockRejectedValue(new DOMException("denied", "NotAllowedError"));
      const originalClipboard = navigator.clipboard;
      Object.defineProperty(navigator, "clipboard", {
        value: {
          writeText: clipboardWriteMock,
        },
        configurable: true,
      });

      try {
        let isStaleA = false;
        // Start Operation A
        const executionA = handleExportBids(
          mockApp as never,
          [sampleBid1],
          "選択CSV (A)",
          (msg) => {
            actionMessage = msg;
          },
          "csv",
          (data) => {
            manualData = data;
          },
          () => isStaleA,
        );

        // Wait for callServerTool and downloadFile to be reached
        await new Promise((r) => setTimeout(r, 20));
        expect(mockApp.callServerTool).toHaveBeenCalled();
        expect(mockApp.downloadFile).toHaveBeenCalled();

        // While downloadFile is pending, user starts Operation B
        isStaleA = true;
        manualData = null;
        actionMessage = "Operation B active";
        resetDiagnosticReport();
        updateDiagnosticReport({
          stage: "tool_call_start",
        });

        // Now downloadFile A throws late exception (e.g. host disconnect)
        rejectDownloadA?.(new Error("Host connection severed"));

        await executionA;

        // Old Operation A must NOT initiate clipboard write
        expect(clipboardWriteMock).not.toHaveBeenCalled();
        // Old Operation A must NOT display manual fallback panel
        expect(manualData).toBeNull();
        // Action message must NOT be overwritten by A
        expect(actionMessage).toBe("Operation B active");
        // Diagnostic report must NOT be overwritten with download_file_error
        const currentDiag = getLatestDiagnosticReport();
        expect(currentDiag.stage).toBe("tool_call_start");
        expect(currentDiag.downloadFile).toBeUndefined();
      } finally {
        Object.defineProperty(navigator, "clipboard", {
          value: originalClipboard,
          configurable: true,
        });
      }
    });

    // 7-4: Operation A starts -> Operation B completes successfully -> Operation A rejects
    it("Case 7-4: preserves Operation B display and diagnostics when delayed Operation A rejects in outermost catch", async () => {
      let manualData: ManualExportState | null = null;
      let actionMessage = "";

      let rejectToolA: ((err: unknown) => void) | undefined;
      const toolPromiseA = new Promise((_, reject) => {
        rejectToolA = reject;
      });

      const mockApp = {
        getHostCapabilities: () => ({ serverTools: true, downloadFile: true }),
        callServerTool: vi.fn().mockImplementationOnce(() => toolPromiseA),
        downloadFile: vi.fn(),
      };

      const originalClipboard = navigator.clipboard;
      Object.defineProperty(navigator, "clipboard", {
        value: {
          writeText: vi.fn().mockResolvedValue(undefined),
        },
        configurable: true,
      });

      try {
        let isStaleA = false;
        // Start Operation A
        const executionA = handleExportBids(
          mockApp as never,
          [sampleBid1],
          "選択CSV (A)",
          (msg) => {
            actionMessage = msg;
          },
          "csv",
          (data) => {
            manualData = data;
          },
          () => isStaleA,
        );

        // Wait until callServerTool is reached for A
        await new Promise((r) => setTimeout(r, 20));
        expect(mockApp.callServerTool).toHaveBeenCalled();

        // While tool call A is pending, Operation B executes and completes successfully
        isStaleA = true;
        actionMessage = "Operation B CSV出力を完了しました";
        resetDiagnosticReport();
        updateDiagnosticReport({
          stage: "download_file_success",
          downloadFile: { capabilitySupported: true, attempted: true, resultIsError: false },
        });

        // Now Operation A tool call throws/rejects late (e.g. host error or network timeout)
        rejectToolA?.(new Error("Host server tool execution failed"));

        await executionA;

        // Action message must NOT be overwritten by A's catch block
        expect(actionMessage).toBe("Operation B CSV出力を完了しました");
        // Manual data must remain unchanged
        expect(manualData).toBeNull();
        // Diagnostic report of Operation B must be preserved
        const diagAfterA = getLatestDiagnosticReport();
        expect(diagAfterA.stage).toBe("download_file_success");
        expect(diagAfterA.downloadFile?.resultIsError).toBe(false);
      } finally {
        Object.defineProperty(navigator, "clipboard", {
          value: originalClipboard,
          configurable: true,
        });
      }
    });
  });

  // Helper unit test: normalizeErrorName
  it("normalizes DOMException and Error names into allowed list", () => {
    expect(normalizeErrorName(new DOMException("denied", "NotAllowedError"))).toBe("NotAllowedError");
    expect(normalizeErrorName(new DOMException("security", "SecurityError"))).toBe("SecurityError");
    expect(normalizeErrorName(new TypeError("type error"))).toBe("TypeError");
    expect(normalizeErrorName(new Error("random unknown"))).toBe("UnknownError");
    expect(normalizeErrorName(null)).toBe("UnknownError");
  });
});
