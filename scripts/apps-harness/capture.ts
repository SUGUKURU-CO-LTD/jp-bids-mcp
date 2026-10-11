/**
 * MCP Apps UI の決定的スクリーンショット取得。
 * scripts/apps-harness/host.html（モックホスト）越しに本番バンドルを描画し、CDP で撮影する。
 * 本番コードには一切手を入れないので、撮れた画面は実際に配信されるUIそのものである。
 *
 * Deterministic screenshots of the MCP Apps UI. Renders the production bundle
 * behind scripts/apps-harness/host.html (a mock host) and captures over CDP.
 * The production code is never modified, so the captures are the shipped UI.
 *
 * Tangkapan layar deterministik UI MCP Apps. Merender bundel production di
 * belakang host tiruan dan menangkap melalui CDP tanpa mengubah kode production.
 *
 * 使い方 / Usage / Penggunaan:
 *   npm run build:ui
 *   npx tsx scripts/apps-harness/capture.ts
 */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

interface Shot {
  file: string;
  query: string;
  width: number;
  height: number;
  colorScheme: "light" | "dark";
}

const shots: Shot[] = [
  {
    file: "01-welcome.png",
    query: "?autoResult=0",
    width: 1280,
    height: 880,
    colorScheme: "light",
  },
  { file: "02-workspace.png", query: "", width: 1280, height: 880, colorScheme: "light" },
  {
    file: "03-evidence.png",
    query: "?openEvidence=1",
    width: 1280,
    height: 880,
    colorScheme: "light",
  },
  { file: "04-dark.png", query: "", width: 1280, height: 880, colorScheme: "dark" },
  { file: "05-mobile.png", query: "", width: 420, height: 860, colorScheme: "light" },
  {
    file: "06-fallback.png",
    query: `?denyMessage=1&clickAction=${encodeURIComponent("要件抽出")}`,
    width: 1280,
    height: 880,
    colorScheme: "light",
  },
  {
    file: "07-ranked.png",
    query: `?selectBids=11_unordered&clickAction=${encodeURIComponent("選択比較")}`,
    width: 1280,
    height: 880,
    colorScheme: "light",
  },
  {
    file: "08-export.png",
    query: `?selectBids=11_unordered&clickAction=${encodeURIComponent("選択CSV")}`,
    width: 1280,
    height: 880,
    colorScheme: "light",
  },
  {
    file: "09-export-json.png",
    query: `?selectBids=11_unordered&clickAction=${encodeURIComponent("選択JSON")}`,
    width: 1280,
    height: 880,
    colorScheme: "light",
  },
];

const chromePath =
  process.env.CHROME_PATH ??
  (process.platform === "win32"
    ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    : "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
const harnessPort = Number(process.env.HARNESS_PORT ?? 8899);
const debugPort = Number(process.env.CHROME_DEBUG_PORT ?? 9333);
const outDir = fileURLToPath(new URL("../../images/mcp-apps-bid-workspace/", import.meta.url));

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForDevtools(): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
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

const server = createServer(async (req, res) => {
  const { readFile } = await import("node:fs/promises");
  const { extname, join } = await import("node:path");
  const harnessDir = fileURLToPath(new URL(".", import.meta.url));
  const appsDir = fileURLToPath(new URL("../../dist/apps/", import.meta.url));
  const pathname = new URL(req.url ?? "/", `http://127.0.0.1:${harnessPort}`).pathname;
  const relative = pathname.replace(/^\/+/, "") || "host.html";
  if (relative.includes("..")) {
    res.writeHead(400).end("bad request");
    return;
  }
  for (const dir of [harnessDir, appsDir]) {
    try {
      const body = await readFile(join(dir, relative));
      const types: Record<string, string> = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
      };
      res.writeHead(200, {
        "content-type": types[extname(relative)] ?? "application/octet-stream",
        "cache-control": "no-store",
      });
      res.end(body);
      return;
    } catch {
      // 次の候補を試す / try the next candidate
    }
  }
  res.writeHead(404).end("not found");
});

await mkdir(outDir, { recursive: true });
await new Promise<void>((resolve) => server.listen(harnessPort, "127.0.0.1", resolve));

const chrome = spawn(
  chromePath,
  [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${join(tmpdir(), "jp-bids-apps-harness-profile")}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

try {
  const browserWsUrl = await waitForDevtools();
  const browser = await CdpSession.connect(browserWsUrl);
  const { targetId } = await browser.send<{ targetId: string }>("Target.createTarget", {
    url: "about:blank",
  });
  const { sessionId } = await browser.send<{ sessionId: string }>("Target.attachToTarget", {
    targetId,
    flatten: true,
  });

  await browser.send("Page.enable", {}, sessionId);
  await browser.send("Runtime.enable", {}, sessionId);

  for (const shot of shots) {
    await browser.send(
      "Emulation.setDeviceMetricsOverride",
      { width: shot.width, height: shot.height, deviceScaleFactor: 2, mobile: false },
      sessionId,
    );
    await browser.send(
      "Emulation.setEmulatedMedia",
      { features: [{ name: "prefers-color-scheme", value: shot.colorScheme }] },
      sessionId,
    );
    await browser.send(
      "Page.navigate",
      { url: `http://127.0.0.1:${harnessPort}/host.html${shot.query}` },
      sessionId,
    );
    // ホストのハンドシェイクと tool result の反映を待つ
    await sleep(1800);

    if (shot.file === "06-fallback.png") {
      const evalRes = await browser.send<{ result: { value: unknown } }>(
        "Runtime.evaluate",
        {
          expression: `JSON.stringify({ clicked: window.actionClicked, error: window.actionClickError })`,
          returnByValue: true,
        },
        sessionId,
      );
      const status = JSON.parse(String(evalRes.result?.value ?? "{}"));
      if (status.error) {
        throw new Error(`Screenshot assertion failed for ${shot.file}: ${status.error}`);
      }
      if (!status.clicked) {
        throw new Error(`Screenshot assertion failed for ${shot.file}: action not clicked`);
      }
      await sleep(400);
    } else if (shot.file === "07-ranked.png") {
      const evalRes = await browser.send<{ result: { value: unknown } }>(
        "Runtime.evaluate",
        {
          expression: `(() => {
            const lastCall = window.lastToolCall;
            const frameDoc = document.getElementById("frame")?.contentDocument;
            const noticeText = frameDoc?.querySelector(".notice")?.textContent || "";
            const expectedOrderRefs = window.selectedOrderRefs || [];
            const calledRefs = lastCall?.arguments?.bid_refs || [];
            const orderMatches = expectedOrderRefs.length === 11 &&
              expectedOrderRefs.every((r, i) => calledRefs[i] === r);
            return JSON.stringify({
              clicked: window.actionClicked,
              toolName: lastCall?.name,
              refsCount: calledRefs.length,
              rankedCount: lastCall?.response?.rankedCount,
              hasPolicy: Boolean(lastCall?.response?.scoringPolicy?.version),
              orderMatches,
              noticeText,
              error: window.actionClickError,
            });
          })()`,
          returnByValue: true,
        },
        sessionId,
      );
      const status = JSON.parse(String(evalRes.result?.value ?? "{}"));
      if (status.error) throw new Error(`Assertion failed for ${shot.file}: ${status.error}`);
      if (!status.clicked) throw new Error(`Assertion failed for ${shot.file}: button not clicked`);
      if (status.toolName !== "rank_bids")
        throw new Error(
          `Assertion failed for ${shot.file}: expected rank_bids, got ${status.toolName}`,
        );
      if (status.refsCount !== 11)
        throw new Error(
          `Assertion failed for ${shot.file}: expected 11 refs, got ${status.refsCount}`,
        );
      if (status.rankedCount !== 11)
        throw new Error(
          `Assertion failed for ${shot.file}: expected 11 ranked bids, got ${status.rankedCount}`,
        );
      if (!status.orderMatches)
        throw new Error(
          `Assertion failed for ${shot.file}: bid_refs order did not match selected order`,
        );
      if (!status.hasPolicy)
        throw new Error(`Assertion failed for ${shot.file}: scoringPolicy missing in response`);
      if (!status.noticeText.includes("比較採点しました"))
        throw new Error(
          `Assertion failed for ${shot.file}: notice missing expected text, got: "${status.noticeText}"`,
        );
      await sleep(400);
    } else if (shot.file === "08-export.png") {
      const evalRes = await browser.send<{ result: { value: unknown } }>(
        "Runtime.evaluate",
        {
          expression: `(() => {
            const lastCall = window.lastToolCall;
            const expectedOrderRefs = window.selectedOrderRefs || [];
            const calledRefs = lastCall?.arguments?.bid_refs || [];
            const orderMatches = expectedOrderRefs.length === 11 &&
              expectedOrderRefs.every((r, i) => calledRefs[i] === r);
            const csv = lastCall?.response?.csv || "";
            const rows = csv.split("\\n").slice(1).filter(Boolean);
            const allUrlsPresent = rows.length === 11 && rows.every(r => r.includes("https://"));
            const downloadContents = window.lastDownloadFile;
            return JSON.stringify({
              clicked: window.actionClicked,
              toolName: lastCall?.name,
              refsCount: calledRefs.length,
              format: lastCall?.arguments?.format,
              rankedCount: lastCall?.response?.rankedCount,
              orderMatches,
              rowsCount: rows.length,
              allUrlsPresent,
              hasDownload: Boolean(downloadContents && downloadContents.length > 0),
              error: window.actionClickError,
            });
          })()`,
          returnByValue: true,
        },
        sessionId,
      );
      const status = JSON.parse(String(evalRes.result?.value ?? "{}"));
      if (status.error) throw new Error(`Assertion failed for ${shot.file}: ${status.error}`);
      if (!status.clicked) throw new Error(`Assertion failed for ${shot.file}: button not clicked`);
      if (status.toolName !== "export_bid_shortlist")
        throw new Error(
          `Assertion failed for ${shot.file}: expected export_bid_shortlist, got ${status.toolName}`,
        );
      if (status.refsCount !== 11)
        throw new Error(
          `Assertion failed for ${shot.file}: expected 11 refs, got ${status.refsCount}`,
        );
      if (status.format !== "csv")
        throw new Error(
          `Assertion failed for ${shot.file}: expected csv format, got ${status.format}`,
        );
      if (!status.orderMatches)
        throw new Error(
          `Assertion failed for ${shot.file}: CSV export refs order did not match selected order`,
        );
      if (status.rowsCount !== 11)
        throw new Error(
          `Assertion failed for ${shot.file}: expected 11 CSV rows, got ${status.rowsCount}`,
        );
      if (!status.allUrlsPresent)
        throw new Error(
          `Assertion failed for ${shot.file}: official URLs missing in some CSV rows`,
        );
      if (!status.hasDownload)
        throw new Error(`Assertion failed for ${shot.file}: download was not requested`);
      await sleep(400);
    } else if (shot.file === "09-export-json.png") {
      const evalRes = await browser.send<{ result: { value: unknown } }>(
        "Runtime.evaluate",
        {
          expression: `(() => {
            const lastCall = window.lastToolCall;
            const expectedOrderRefs = window.selectedOrderRefs || [];
            const expectedKeys = window.selectedOrderKeys || [];
            const calledRefs = lastCall?.arguments?.bid_refs || [];
            const orderMatches = expectedOrderRefs.length === 11 &&
              expectedOrderRefs.every((r, i) => calledRefs[i] === r);
            const jsonList = lastCall?.response?.jsonContent || [];
            const keysMatch = jsonList.length === 11 &&
              jsonList.every((item, i) => item.key === expectedKeys[i]);
            const allUrlsPresent = jsonList.length === 11 &&
              jsonList.every(item => Boolean(item.officialUrl && item.officialUrl.startsWith("https://")));
            const downloadContents = window.lastDownloadFile;
            return JSON.stringify({
              clicked: window.actionClicked,
              toolName: lastCall?.name,
              refsCount: calledRefs.length,
              format: lastCall?.arguments?.format,
              rankedCount: lastCall?.response?.rankedCount,
              orderMatches,
              keysMatch,
              allUrlsPresent,
              hasDownload: Boolean(downloadContents && downloadContents.length > 0),
              error: window.actionClickError,
            });
          })()`,
          returnByValue: true,
        },
        sessionId,
      );
      const status = JSON.parse(String(evalRes.result?.value ?? "{}"));
      if (status.error) throw new Error(`Assertion failed for ${shot.file}: ${status.error}`);
      if (!status.clicked) throw new Error(`Assertion failed for ${shot.file}: button not clicked`);
      if (status.toolName !== "export_bid_shortlist")
        throw new Error(
          `Assertion failed for ${shot.file}: expected export_bid_shortlist, got ${status.toolName}`,
        );
      if (status.refsCount !== 11)
        throw new Error(
          `Assertion failed for ${shot.file}: expected 11 refs, got ${status.refsCount}`,
        );
      if (status.format !== "json")
        throw new Error(
          `Assertion failed for ${shot.file}: expected json format, got ${status.format}`,
        );
      if (!status.orderMatches)
        throw new Error(
          `Assertion failed for ${shot.file}: JSON export refs order did not match selected order`,
        );
      if (!status.keysMatch)
        throw new Error(
          `Assertion failed for ${shot.file}: JSON items key order did not match selection order`,
        );
      if (!status.allUrlsPresent)
        throw new Error(`Assertion failed for ${shot.file}: official URLs missing in JSON output`);
      if (!status.hasDownload)
        throw new Error(`Assertion failed for ${shot.file}: JSON download was not requested`);
      await sleep(400);
    }

    const { data } = await browser.send<{ data: string }>(
      "Page.captureScreenshot",
      { format: "png" },
      sessionId,
    );
    await writeFile(join(outDir, shot.file), Buffer.from(data, "base64"));
    console.error(`captured ${shot.file} (${shot.width}x${shot.height}, ${shot.colorScheme})`);
  }

  browser.close();
} finally {
  chrome.kill();
  server.close();
}
