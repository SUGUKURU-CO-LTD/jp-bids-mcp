// Diagnostic and Fallback Utilities for Search Results Workspace Export
// Ensures safe, uncorrupted CSV extraction, audited token tracking, and resilient manual fallback display.

export interface ManualExportState {
  type: "csv" | "json";
  rawText: string;
  displayText: string;
  downloadText: string;
  itemCount: number;
  filename: string;
}

export type ExportDiagnosticStage =
  | "idle"
  | "tool_call_start"
  | "tool_call_success"
  | "tool_call_error"
  | "download_file_attempt"
  | "download_file_success"
  | "download_file_error"
  | "clipboard_attempt"
  | "clipboard_success"
  | "clipboard_error"
  | "manual_fallback";

export type AllowedErrorName =
  | "NotAllowedError"
  | "SecurityError"
  | "AbortError"
  | "TypeError"
  | "NetworkError"
  | "UnknownError";

export function normalizeErrorName(err: unknown): AllowedErrorName {
  if (
    typeof err === "object" &&
    err !== null &&
    "name" in err &&
    typeof (err as { name: unknown }).name === "string"
  ) {
    const name = (err as { name: string }).name;
    if (
      name === "NotAllowedError" ||
      name === "SecurityError" ||
      name === "AbortError" ||
      name === "TypeError" ||
      name === "NetworkError"
    ) {
      return name;
    }
  }
  return "UnknownError";
}

export interface TokenAuditEntry {
  length: number;
  fullHash: string;
  shortPrefix: string;
}

export interface ExportDiagnosticReport {
  stage: ExportDiagnosticStage;
  toolCall?:
    | {
        isExplicitSuccess?: boolean;
        hasStructuredContent?: boolean;
        hasExpectedField?: boolean;
        rawTextLength?: number;
        reportedItemCount?: number;
      }
    | undefined;
  downloadFile?:
    | {
        capabilitySupported?: boolean;
        attempted?: boolean;
        resultIsError?: boolean;
        errorName?: AllowedErrorName;
      }
    | undefined;
  clipboard?:
    | {
        attempted?: boolean;
        errorName?: AllowedErrorName;
      }
    | undefined;
  tokensAudit: {
    count: number;
    tokens: TokenAuditEntry[];
  };
}

let activeDiagnosticReport: ExportDiagnosticReport = {
  stage: "idle",
  tokensAudit: { count: 0, tokens: [] },
};

export function getLatestDiagnosticReport(): ExportDiagnosticReport {
  return activeDiagnosticReport;
}

export function updateDiagnosticReport(
  partial: Partial<ExportDiagnosticReport>,
): ExportDiagnosticReport {
  const nextDownloadFile =
    partial.downloadFile !== undefined || activeDiagnosticReport.downloadFile !== undefined
      ? {
          ...activeDiagnosticReport.downloadFile,
          ...partial.downloadFile,
        }
      : undefined;

  const nextClipboard =
    partial.clipboard !== undefined || activeDiagnosticReport.clipboard !== undefined
      ? {
          ...activeDiagnosticReport.clipboard,
          ...partial.clipboard,
        }
      : undefined;

  const nextToolCall =
    partial.toolCall !== undefined || activeDiagnosticReport.toolCall !== undefined
      ? {
          ...activeDiagnosticReport.toolCall,
          ...partial.toolCall,
        }
      : undefined;

  const updated: ExportDiagnosticReport = {
    ...activeDiagnosticReport,
    ...partial,
    tokensAudit: partial.tokensAudit ?? activeDiagnosticReport.tokensAudit,
  };
  if (nextDownloadFile !== undefined) {
    updated.downloadFile = nextDownloadFile;
  } else {
    delete updated.downloadFile;
  }
  if (nextClipboard !== undefined) {
    updated.clipboard = nextClipboard;
  } else {
    delete updated.clipboard;
  }
  if (nextToolCall !== undefined) {
    updated.toolCall = nextToolCall;
  } else {
    delete updated.toolCall;
  }

  activeDiagnosticReport = updated;
  if (typeof window !== "undefined") {
    (
      window as unknown as { __lastExportDiagnostic?: ExportDiagnosticReport }
    ).__lastExportDiagnostic = activeDiagnosticReport;
  }
  return activeDiagnosticReport;
}

export function resetDiagnosticReport(): void {
  activeDiagnosticReport = {
    stage: "idle",
    tokensAudit: { count: 0, tokens: [] },
  };
  if (typeof window !== "undefined") {
    (
      window as unknown as { __lastExportDiagnostic?: ExportDiagnosticReport }
    ).__lastExportDiagnostic = activeDiagnosticReport;
  }
}

/**
 * Computes a SHA-256 hash in hex format.
 * Uses Web Crypto (browser/JSDOM) safely without leaking token secrets.
 */
export async function computeSha256Hex(text: string): Promise<string> {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  return "hash_unavailable";
}

export async function auditTokens(tokens: string[]): Promise<TokenAuditEntry[]> {
  const entries: TokenAuditEntry[] = [];
  for (const token of tokens) {
    const fullHash = await computeSha256Hex(token);
    entries.push({
      length: token.length,
      fullHash,
      shortPrefix: fullHash.slice(0, 8),
    });
  }
  return entries;
}

export type ExtractedCsvResult =
  | {
      valid: true;
      rawCsv: string;
      displayText: string;
      downloadText: string;
      itemCount: number;
      filename: string;
    }
  | {
      valid: false;
      reason: string;
    };

export const EXPECTED_BASE_COLUMNS = [
  "priority",
  "score",
  "key",
  "project_name",
  "organization_name",
  "prefecture",
  "city",
  "category",
  "procedure_type",
  "notice_date",
  "tender_submission_deadline",
  "opening_tenders_event",
  "fit_reasons",
  "risks",
  "next_action",
  "official_url",
] as const;

export const EXPECTED_EXTRA_COLUMNS = [
  "pdf_eligibility",
  "pdf_required_documents",
  "pdf_submission_deadline",
  "pdf_opening_date",
  "pdf_contact_point",
] as const;

export type ParseCsvResult =
  | { success: true; rows: string[][] }
  | { success: false; error: string; line: number; column: number };

/**
 * Strict CSV row parser.
 * Handles quoted cells, escaped quotes (""), commas, and cell-internal newlines (\n, \r\n).
 * Strictly detects:
 * - Unclosed quotes
 * - Stray quotes inside unquoted fields
 * - Stray characters immediately following closing quotes
 */
export function parseCsvRows(csvText: string): ParseCsvResult {
  const clean = csvText.startsWith("\ufeff") ? csvText.slice(1) : csvText;
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = "";

  type CellState = "START" | "UNQUOTED" | "QUOTED" | "AFTER_QUOTE";
  let state: CellState = "START";

  let lineNum = 1;
  let colNum = 1;

  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];
    const nextChar = clean[i + 1];

    if (state === "START") {
      if (char === '"') {
        state = "QUOTED";
      } else if (char === ",") {
        currentRow.push("");
        state = "START";
      } else if (char === "\r" || char === "\n") {
        if (char === "\r" && nextChar === "\n") i++;
        currentRow.push("");
        if (currentRow.length > 1 || (currentRow[0] && currentRow[0].length > 0)) {
          rows.push(currentRow);
        }
        currentRow = [];
        lineNum++;
        colNum = 1;
        state = "START";
        continue;
      } else {
        currentCell += char;
        state = "UNQUOTED";
      }
    } else if (state === "QUOTED") {
      if (char === '"') {
        if (nextChar === '"') {
          currentCell += '"';
          i++; // skip escaped quote
          colNum++;
        } else {
          state = "AFTER_QUOTE";
        }
      } else {
        currentCell += char;
        if (char === "\n") {
          lineNum++;
          colNum = 1;
          continue;
        }
      }
    } else if (state === "AFTER_QUOTE") {
      if (char === ",") {
        currentRow.push(currentCell);
        currentCell = "";
        state = "START";
      } else if (char === "\r" || char === "\n") {
        if (char === "\r" && nextChar === "\n") i++;
        currentRow.push(currentCell);
        currentCell = "";
        rows.push(currentRow);
        currentRow = [];
        lineNum++;
        colNum = 1;
        state = "START";
        continue;
      } else {
        return {
          success: false,
          error: `閉じ引用符の直後に不正な文字 '${char}' があります。区切り文字 (,) または改行が必要です。`,
          line: lineNum,
          column: colNum,
        };
      }
    } else if (state === "UNQUOTED") {
      if (char === '"') {
        return {
          success: false,
          error: '非引用フィールドの途中に不正な引用符 (") が含まれています。',
          line: lineNum,
          column: colNum,
        };
      } else if (char === ",") {
        currentRow.push(currentCell);
        currentCell = "";
        state = "START";
      } else if (char === "\r" || char === "\n") {
        if (char === "\r" && nextChar === "\n") i++;
        currentRow.push(currentCell);
        currentCell = "";
        rows.push(currentRow);
        currentRow = [];
        lineNum++;
        colNum = 1;
        state = "START";
        continue;
      } else {
        currentCell += char;
      }
    }
    colNum++;
  }

  if (state === "QUOTED") {
    return {
      success: false,
      error: "閉じていない引用符が検出されました (EOFに達しました)。",
      line: lineNum,
      column: colNum,
    };
  }

  if (
    state === "AFTER_QUOTE" ||
    state === "UNQUOTED" ||
    currentCell.length > 0 ||
    currentRow.length > 0
  ) {
    currentRow.push(currentCell);
    if (currentRow.length > 1 || (currentRow[0] && currentRow[0].length > 0)) {
      rows.push(currentRow);
    }
  }

  return { success: true, rows };
}

/**
 * Extracts and strictly validates CSV from export_bid_shortlist tool result.
 * Eliminates conversational summaries, headers, and error texts.
 * Conforms to MCP spec: isError is optional; if omitted, defaults to false (success).
 * Validates exact 16-column header and ordering (or full 21-column ordering with extra PDF columns),
 * cell counts, and rankedCount match.
 */
export function extractCsvFromToolResult(result: unknown): ExtractedCsvResult {
  if (typeof result !== "object" || result === null) {
    return { valid: false, reason: "ツール応答がオブジェクトではありません。" };
  }
  const r = result as Record<string, unknown>;

  // isError must be treated as error ONLY if explicitly true (optional in MCP spec, default is false)
  if (r.isError === true) {
    return {
      valid: false,
      reason: "ツール実行エラーが返されました (isError: true)。",
    };
  }

  const structured = r.structuredContent;
  if (typeof structured !== "object" || structured === null) {
    return { valid: false, reason: "構造化データ (structuredContent) がありません。" };
  }
  const s = structured as Record<string, unknown>;

  if (typeof s.csv !== "string" || s.csv.trim().length === 0) {
    return { valid: false, reason: "structuredContent 内に有効な csv 文字列がありません。" };
  }

  // Strictly require integer rankedCount >= 0 without fallback to 0
  if (typeof s.rankedCount !== "number" || !Number.isInteger(s.rankedCount) || s.rankedCount < 0) {
    return {
      valid: false,
      reason: `structuredContent 内の rankedCount が不正または未設定です (${String(s.rankedCount)})。`,
    };
  }
  const itemCount = s.rankedCount;

  const rawCsv = s.csv;
  const parseResult = parseCsvRows(rawCsv);
  if (!parseResult.success) {
    return {
      valid: false,
      reason: `CSV構文エラー (L${parseResult.line}:C${parseResult.column}): ${parseResult.error}`,
    };
  }

  const parsedRows = parseResult.rows;
  if (parsedRows.length === 0) {
    return { valid: false, reason: "CSVのパース結果が空です。" };
  }

  const headerRow = parsedRows[0];
  if (!headerRow) {
    return { valid: false, reason: "CSVのヘッダー行が取得できません。" };
  }

  // Validate exact 16-column header specification (or full 21 columns with PDF extraction)
  const baseLen = EXPECTED_BASE_COLUMNS.length;
  const fullLen = baseLen + EXPECTED_EXTRA_COLUMNS.length;

  if (headerRow.length !== baseLen && headerRow.length !== fullLen) {
    return {
      valid: false,
      reason: `CSVヘッダーの列数不正: 期待=${baseLen}列 (または${fullLen}列), 実際=${headerRow.length}列。`,
    };
  }

  // Check base 16 columns
  for (let c = 0; c < baseLen; c++) {
    if (headerRow[c] !== EXPECTED_BASE_COLUMNS[c]) {
      return {
        valid: false,
        reason: `CSVヘッダーの列不一致 (${c + 1}列目): 期待="${EXPECTED_BASE_COLUMNS[c]}", 実際="${headerRow[c]}"。`,
      };
    }
  }

  // If 21 columns, strictly validate all 5 extra columns
  if (headerRow.length === fullLen) {
    for (let c = 0; c < EXPECTED_EXTRA_COLUMNS.length; c++) {
      const idx = baseLen + c;
      if (headerRow[idx] !== EXPECTED_EXTRA_COLUMNS[c]) {
        return {
          valid: false,
          reason: `CSVヘッダーの追加列不一致 (${idx + 1}列目): 期待="${EXPECTED_EXTRA_COLUMNS[c]}", 実際="${headerRow[idx]}"。`,
        };
      }
    }
  }

  // Validate all data rows have matching column count
  const expectedColCount = headerRow.length;
  const dataRows = parsedRows.slice(1);
  for (let rIdx = 0; rIdx < dataRows.length; rIdx++) {
    const row = dataRows[rIdx];
    if (row && row.length !== expectedColCount) {
      return {
        valid: false,
        reason: `データ行 ${rIdx + 1} の列数がヘッダー列数と一致しません (期待=${expectedColCount}, 実際=${row.length})。`,
      };
    }
  }

  // Strictly validate parsed data row count matches metadata rankedCount
  if (dataRows.length !== itemCount) {
    return {
      valid: false,
      reason: `CSV解析データ件数 (${dataRows.length}件) と rankedCount (${itemCount}件) が一致しません。`,
    };
  }

  const filename =
    typeof s.filename === "string" && s.filename ? s.filename : "jp-bids-workspace.csv";
  const displayText = rawCsv;
  const downloadText = rawCsv.startsWith("\ufeff") ? rawCsv : `\ufeff${rawCsv}`;

  return {
    valid: true,
    rawCsv,
    displayText,
    downloadText,
    itemCount,
    filename,
  };
}
