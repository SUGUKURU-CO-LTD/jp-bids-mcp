/**
 * Browser-based manual export fallback test using Headless Chrome & CDP.
 *
 * Scope and verified milestones:
 * 1. Host initialization and 2-item bid selection.
 * 2. Strict 16-column CSV generation via export_bid_shortlist with quotes, commas, and internal newlines.
 * 3. Forced failure of host downloadFile (denyDownload=1) and clipboard.writeText (denyClipboard=1).
 * 4. Resilient display of ManualExportPanel with exact Japanese prompt and count.
 * 5. Execution of "Select All" button and textarea focus/selection range verification.
 * 6. Extraction of manual textarea value (Browser display extraction milestone).
 * 7. Verification of diagnostic report collection (window.__lastExportDiagnostic).
 * 8. Byte-level fidelity (SHA-256) vs parsed CSV content fidelity (RFC 4180 / 16 columns).
 * 9. Persistence of the verified CSV test artifact.
 */

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { parseCsvRows } from "../../src/apps/export-diagnostics.js";

const chromePath =
  process.platform === "win32"
    ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    : "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const HARNESS_PORT = 8993;
const DEBUG_PORT = 9338;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const harnessDir = fileURLToPath(new URL(".", import.meta.url));
const appsDir = fileURLToPath(new URL("../../dist/apps/", import.meta.url));

const mimeTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

async function readCandidate(pathname: string): Promise<Buffer | undefined> {
  const relative = pathname.replace(/^\/+/, "") || "host.html";
  if (relative.includes("..")) return undefined;
  for (const dir of [harnessDir, appsDir]) {
    try {
      return await readFile(join(dir, relative));
    } catch {
      // try next
    }
  }
  return undefined;
}

function startStaticServer(): Promise<{ close: () => Promise<void> }> {
  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url ?? "/", `http://127.0.0.1:${HARNESS_PORT}`).pathname;
    const body = await readCandidate(pathname);
    if (!body) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("not found");
      return;
    }
    res.writeHead(200, {
      "content-type": mimeTypes[extname(pathname)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(body);
  });

  return new Promise((resolve) => {
    server.listen(HARNESS_PORT, "127.0.0.1", () => {
      resolve({
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

async function waitForDevtools(): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
      const info = (await response.json()) as { webSocketDebuggerUrl: string };
      return info.webSocketDebuggerUrl;
    } catch {
      await sleep(200);
    }
  }
  throw new Error("Chrome DevTools endpoint did not become available");
}

class CdpSession {
  private nextId = 1;
  private readonly pending = new Map<number, (result: unknown) => void>();

  private constructor(private readonly socket: WebSocket) {}

  static async connect(url: string): Promise<CdpSession> {
    const socket = new WebSocket(url);
    const session = new CdpSession(socket);
    socket.addEventListener("message", (event) => {
      const payload = JSON.parse(String(event.data)) as { id?: number; result?: unknown };
      if (payload.id === undefined) return;
      const resolve = session.pending.get(payload.id);
      if (!resolve) return;
      session.pending.delete(payload.id);
      resolve(payload.result);
    });
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error("CDP socket error")), { once: true });
    });
    return session;
  }

  send<T = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
  ): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve) => {
      this.pending.set(id, (result) => resolve(result as T));
      this.socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }

  close(): void {
    this.socket.close();
  }
}

async function main() {
  console.log("=== Starting Real Browser Manual Export Fallback Verification ===");

  const server = await startStaticServer();
  console.log(`[1] Static harness server listening on http://127.0.0.1:${HARNESS_PORT}`);

  const userDataDir = join(process.env.TEMP || "C:\\Temp", `chrome-test-${Date.now()}`);
  const chrome = spawn(
    chromePath,
    [
      "--headless=new",
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${userDataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  let session: CdpSession | null = null;

  try {
    const wsUrl = await waitForDevtools();
    console.log(`[2] Connected to Chrome DevTools endpoint`);
    session = await CdpSession.connect(wsUrl);

    // Create target page with query params: denyDownload=1, denyClipboard=1, autoResult=1, selectBids=0,1
    const targetUrl = `http://127.0.0.1:${HARNESS_PORT}/host.html?autoResult=1&denyDownload=1&denyClipboard=1&selectBids=0,1`;
    const target = await session.send<{ targetId: string }>("Target.createTarget", { url: targetUrl });
    const targetSession = await session.send<{ sessionId: string }>("Target.attachToTarget", {
      targetId: target.targetId,
      flatten: true,
    });
    const sessionId = targetSession.sessionId;

    await session.send("Page.enable", {}, sessionId);
    await session.send("Runtime.enable", {}, sessionId);

    console.log(`[3] Navigated to: ${targetUrl}`);

    // Wait for iframe to render cards and select 2 bids
    console.log("[4] Waiting for initial search results rendering and bid selection...");
    let ready = false;
    for (let i = 0; i < 40; i++) {
      const evalRes = await session.send<{ result: { value: unknown } }>(
        "Runtime.evaluate",
        {
          expression: `(() => {
            const frame = document.getElementById("frame");
            if (!frame || !frame.contentDocument) return null;
            const doc = frame.contentDocument;
            const countEl = doc.querySelector(".selection-count");
            const btn = Array.from(doc.querySelectorAll(".lane-selection-bar button")).find(b => b.textContent?.includes("選択CSV"));
            return {
              selectionText: countEl ? countEl.textContent : "",
              hasExportBtn: Boolean(btn),
              btnDisabled: btn ? btn.disabled : true
            };
          })()`,
          returnByValue: true,
        },
        sessionId,
      );

      const state = evalRes.result.value as { selectionText: string; hasExportBtn: boolean; btnDisabled: boolean } | null;
      if (state && state.selectionText.includes("2 件選択中") && state.hasExportBtn && !state.btnDisabled) {
        ready = true;
        console.log(`    -> Confirmed state: "${state.selectionText}", Export CSV button enabled.`);
        break;
      }
      await sleep(250);
    }

    if (!ready) {
      throw new Error("UI did not reach 2-item selection state in time");
    }

    // Click "選択CSV"
    console.log('[5] Clicking "選択CSV" button...');
    await session.send(
      "Runtime.evaluate",
      {
        expression: `(() => {
          const frame = document.getElementById("frame");
          const doc = frame.contentDocument;
          const btn = Array.from(doc.querySelectorAll(".lane-selection-bar button")).find(b => b.textContent?.includes("選択CSV"));
          if (btn) btn.click();
        })()`,
      },
      sessionId,
    );

    // Wait for ManualExportPanel to appear (since downloadFile and clipboard will fail)
    console.log("[6] Waiting for ManualExportPanel fallback to display...");
    let panelFound = false;
    let panelData: {
      headerText: string;
      hintText: string;
      textareaValue: string;
      textareaLength: number;
      diagnosticReport: unknown;
    } | null = null;

    for (let i = 0; i < 40; i++) {
      const panelEval = await session.send<{ result: { value: unknown } }>(
        "Runtime.evaluate",
        {
          expression: `(() => {
            const frame = document.getElementById("frame");
            const doc = frame?.contentDocument;
            const win = frame?.contentWindow;
            const panel = doc?.querySelector(".manual-export-panel");
            if (!panel) return null;
            const header = panel.querySelector(".manual-export-header strong")?.textContent || "";
            const hint = panel.querySelector(".manual-export-hint")?.textContent || "";
            const textarea = panel.querySelector("textarea");
            return {
              headerText: header,
              hintText: hint,
              textareaValue: textarea ? textarea.value : "",
              textareaLength: textarea ? textarea.value.length : 0,
              diagnosticReport: win?.__lastExportDiagnostic || null
            };
          })()`,
          returnByValue: true,
        },
        sessionId,
      );

      if (panelEval.result.value) {
        panelFound = true;
        panelData = panelEval.result.value as NonNullable<typeof panelData>;
        break;
      }
      await sleep(200);
    }

    if (!panelFound || !panelData) {
      throw new Error("ManualExportPanel did not appear after export failure");
    }

    console.log(`    -> Header Text: "${panelData.headerText}"`);
    console.log(`    -> Hint Text: "${panelData.hintText}"`);
    console.log(`    -> Textarea Length: ${panelData.textareaLength} characters`);

    // Verify header and hint text
    if (!panelData.headerText.includes("CSV 手動取得欄 (2件)")) {
      throw new Error(`Unexpected header text: ${panelData.headerText}`);
    }
    if (!panelData.hintText.includes("自動保存・コピーを完了できませんでした。下の欄をクリックして全選択し、コピーしてください。")) {
      throw new Error(`Unexpected hint text: ${panelData.hintText}`);
    }

    // Verify collected diagnostic report
    console.log("[7] Verifying diagnostic report collected from browser session...");
    const diag = panelData.diagnosticReport as {
      stage?: string;
      downloadFile?: { capabilitySupported?: boolean; attempted?: boolean; resultIsError?: boolean };
      clipboard?: { attempted?: boolean; errorName?: string };
      tokensAudit?: { count?: number };
    } | null;

    console.log(`    -> Diagnostic Stage: "${diag?.stage}"`);
    console.log(`    -> DownloadFile API resultIsError: ${diag?.downloadFile?.resultIsError}`);
    console.log(`    -> Clipboard write errorName: "${diag?.clipboard?.errorName}"`);
    console.log(`    -> Tokens audited count: ${diag?.tokensAudit?.count}`);

    if (diag?.stage !== "manual_fallback") {
      throw new Error(`Expected diagnostic stage 'manual_fallback', got: ${diag?.stage}`);
    }
    if (diag?.downloadFile?.capabilitySupported !== false) {
      throw new Error(`Expected downloadFile capabilitySupported to be false, got: ${diag?.downloadFile?.capabilitySupported}`);
    }
    if (diag?.clipboard?.errorName !== "NotAllowedError") {
      throw new Error(`Expected clipboard errorName to be 'NotAllowedError', got: ${diag?.clipboard?.errorName}`);
    }

    // Click "全選択" button inside manual export panel
    console.log('[8] Clicking "全選択" (Select All) button and verifying selection range...');
    const selectAllEval = await session.send<{ result: { value: unknown } }>(
      "Runtime.evaluate",
      {
        expression: `(() => {
          const frame = document.getElementById("frame");
          const doc = frame.contentDocument;
          const panel = doc.querySelector(".manual-export-panel");
          const selectAllBtn = Array.from(panel.querySelectorAll(".manual-export-actions button")).find(b => b.textContent?.includes("全選択"));
          const textarea = panel.querySelector("textarea");
          if (selectAllBtn) selectAllBtn.click();
          return {
            hasSelectAllBtn: Boolean(selectAllBtn),
            selectionStart: textarea.selectionStart,
            selectionEnd: textarea.selectionEnd,
            totalLength: textarea.value.length
          };
        })()`,
        returnByValue: true,
      },
      sessionId,
    );

    const selectState = selectAllEval.result.value as {
      hasSelectAllBtn: boolean;
      selectionStart: number;
      selectionEnd: number;
      totalLength: number;
    };

    console.log(`    -> Selection range: [${selectState.selectionStart}, ${selectState.selectionEnd}] (Total length: ${selectState.totalLength})`);
    if (selectState.selectionStart !== 0 || selectState.selectionEnd !== selectState.totalLength || selectState.totalLength === 0) {
      throw new Error(`Select All failed to select full content: ${JSON.stringify(selectState)}`);
    }

    // Inspect server mock tool response to compare
    const toolCallEval = await session.send<{ result: { value: unknown } }>(
      "Runtime.evaluate",
      {
        expression: `(() => {
          return {
            lastToolCall: window.lastToolCall,
            lastDownloadFile: window.lastDownloadFile
          };
        })()`,
        returnByValue: true,
      },
      sessionId,
    );

    const toolCallData = toolCallEval.result.value as {
      lastToolCall?: {
        name: string;
        arguments: unknown;
        response: {
          csv: string;
          rankedCount: number;
          columns: string[];
        };
      };
    };

    const mockRawCsv = toolCallData.lastToolCall?.response?.csv ?? "";
    const displayedCsv = panelData.textareaValue;

    console.log("\n[9] Comparing CSV Data Fidelity (Browser display value extraction milestone):");
    console.log(`    Raw CSV length from server: ${mockRawCsv.length} chars`);
    console.log(`    Displayed CSV length in UI: ${displayedCsv.length} chars`);

    // Byte-level comparison
    const rawBuffer = Buffer.from(mockRawCsv, "utf-8");
    const displayedBuffer = Buffer.from(displayedCsv, "utf-8");
    const rawHash = createHash("sha256").update(rawBuffer).digest("hex");
    const displayedHash = createHash("sha256").update(displayedBuffer).digest("hex");

    console.log(`    Raw CSV SHA-256:       ${rawHash} (${rawBuffer.length} bytes)`);
    console.log(`    Displayed CSV SHA-256: ${displayedHash} (${displayedBuffer.length} bytes)`);

    const byteMatch = rawHash === displayedHash;
    console.log(`    -> Byte-level exact match: ${byteMatch ? "YES (Identical)" : "NO"}`);
    if (!byteMatch) {
      throw new Error(`CSV原文とブラウザ表示値が一致しません (raw=${rawHash}, displayed=${displayedHash})`);
    }

    // Line ending check
    const hasCrlf = displayedCsv.includes("\r\n");
    console.log(`    -> Newline convention: ${hasCrlf ? "CRLF (Windows)" : "LF (Unix)"}`);

    // Parse and strictly validate CSV structure: 2 rows, each 16 columns, bid keys, and cell-internal newlines
    console.log("\n[10] Validating Parsed CSV Content (2 rows, 16 columns, keys, cell-internal newlines):");
    const parsed = parseCsvRows(displayedCsv);
    if (!parsed.success) {
      throw new Error(`CSV parse failed: ${parsed.error} at line ${parsed.line}, column ${parsed.column}`);
    }

    const rows = parsed.rows;
    console.log(`    -> Total parsed rows (including header): ${rows.length}`);
    if (rows.length !== 3) {
      throw new Error(`Expected exactly 3 rows (1 header + 2 data rows), got ${rows.length}`);
    }

    const EXPECTED_COLS = [
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
    ];

    const header = rows[0]!;
    console.log(`    -> Header column count: ${header.length} columns`);
    console.log(`    -> Headers: ${header.join(", ")}`);
    const columnsMatch = header.length === 16 && EXPECTED_COLS.every((col, i) => header[i] === col);
    console.log(`    -> 16-column header match: ${columnsMatch ? "PASS" : "FAIL"}`);
    if (!columnsMatch) {
      throw new Error(`Header does not match expected 16 columns: ${JSON.stringify(header)}`);
    }

    const row1 = rows[1]!;
    const row2 = rows[2]!;
    console.log(`    -> Row 1 column count: ${row1.length}, Row 2 column count: ${row2.length}`);
    if (row1.length !== 16) {
      throw new Error(`Row 1 column count mismatch: expected 16, got ${row1.length}`);
    }
    if (row2.length !== 16) {
      throw new Error(`Row 2 column count mismatch: expected 16, got ${row2.length}`);
    }

    // Bid Keys assertion
    const keyIndex = EXPECTED_COLS.indexOf("key");
    const key1 = row1[keyIndex];
    const key2 = row2[keyIndex];
    console.log(`    -> Row 1 Key: "${key1}", Row 2 Key: "${key2}"`);
    if (key1 !== "KKJ-2026-46201-0311") {
      throw new Error(`Row 1 key mismatch: expected "KKJ-2026-46201-0311", got "${key1}"`);
    }
    if (key2 !== "KKJ-2026-46000-0288") {
      throw new Error(`Row 2 key mismatch: expected "KKJ-2026-46000-0288", got "${key2}"`);
    }

    // Cell-internal newline and quote content assertion
    const fitReasonsIndex = EXPECTED_COLS.indexOf("fit_reasons");
    const fitReasons1 = row1[fitReasonsIndex];
    const fitReasons2 = row2[fitReasonsIndex];
    console.log(`    -> Row 1 fit_reasons: ${JSON.stringify(fitReasons1)}`);
    console.log(`    -> Row 2 fit_reasons: ${JSON.stringify(fitReasons2)}`);

    const expectedFitReasons1 = '適合度スコア (95点)\n"要件合致", 高評価';
    const expectedFitReasons2 = "適合度スコア (92点) - 要件合致";

    if (fitReasons1 !== expectedFitReasons1) {
      throw new Error(
        `Row 1 fit_reasons mismatch:\nExpected: ${JSON.stringify(expectedFitReasons1)}\nGot:      ${JSON.stringify(fitReasons1)}`,
      );
    }
    if (!fitReasons1.includes("\n")) {
      throw new Error("Row 1 fit_reasons does not contain expected internal newline");
    }
    if (!fitReasons1.includes('"要件合致"')) {
      throw new Error("Row 1 fit_reasons does not contain expected internal quotes");
    }
    if (fitReasons2 !== expectedFitReasons2) {
      throw new Error(
        `Row 2 fit_reasons mismatch:\nExpected: ${JSON.stringify(expectedFitReasons2)}\nGot:      ${JSON.stringify(fitReasons2)}`,
      );
    }
    console.log("    -> Parsed content assertion: ALL PASS (2 items, 16 cols each, keys verified, internal newline verified)");

    // Persist verified CSV artifact
    const artifactDir = join(process.cwd(), "artifacts");
    await mkdir(artifactDir, { recursive: true });
    const artifactPath = join(artifactDir, "browser-manual-export-20261024.csv");
    await writeFile(artifactPath, displayedBuffer);
    console.log(`[11] Saved verified CSV artifact to: ${artifactPath}`);

    console.log("\n=== Real Browser Verification SUCCESS ===");
    console.log(`RECORD OF VERIFICATION MILESTONES:
- Verified Milestone: Browser display value extraction, preservation, and file persistence
- Browser Engine: Headless Chrome (${chromePath})
- Deterministic Fail Condition: denyDownload=1 (host download declined) & denyClipboard=1 (clipboard write NotAllowedError)
- Manual Display Fallback: Rendered successfully with header "CSV 手動取得欄 (2件)"
- Select All Button: Functional (selection [0, ${selectState.totalLength}])
- Diagnostic State Connected & Verified: stage=${diag?.stage}, downloadFile.capabilitySupported=${diag?.downloadFile?.capabilitySupported}, clipboard.errorName=${diag?.clipboard?.errorName}
- Byte-level Fidelity: raw SHA-256 == displayed SHA-256 (${displayedHash})
- 16-Column Strict Specification: PASS (includes cell-internal quotes and newline)
- Verified Artifact: ${artifactPath}
`);

  } finally {
    if (session) session.close();
    chrome.kill("SIGKILL");
    await server.close();
  }
}

main().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
