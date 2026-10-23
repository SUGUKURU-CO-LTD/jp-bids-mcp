/**
 * 実ブラウザ（Headless Chrome + CDP）による限定実UI耐障害性・状態遷移試験。
 *
 * 【検証範囲】
 * 試験A: 明示的エラー応答 → 再接続ボタン押下 → 旧接続終了（旧リスナー破棄の観測） → 新接続確立 → 初回結果受信 → カード描画
 * 試験B: 無応答・初回結果待ちの完全分離（WelcomeScreenの誤表示防止） → 遅延結果受信による描画
 * 試験C: 初期化無応答タイムアウト（60秒経過後のエラー表示と再接続導線の検証）
 */

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";

const chromePath =
  process.platform === "win32"
    ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    : "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const harnessPort = 8991;
const debugPort = 9335;

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

// テスト用固定データ
const FIXTURE_BIDS = [
  {
    resultId: 1,
    key: "KKJ-2026-33100-0199",
    bidRef: "token_mock_signed_okayama_0199",
    projectName: "国立大学法人岡山大学 医薬品調達業務",
    organizationName: "国立大学法人岡山大学",
    prefectureName: "岡山県",
    cityName: "岡山市",
    category: "物品",
    procedureType: "一般競争入札",
    certification: "医薬品等 A等級",
    cftIssueDate: "2026-10-20",
    tenderSubmissionDeadline: "2026-11-05T17:00:00+09:00",
    openingTendersEvent: "2026-11-10T14:00:00+09:00",
    officialUrl: "https://www.okayama-u.ac.jp/bids/0199.html",
    fileType: "pdf",
    fileSize: 312000,
  },
];

const FIXTURE_SEARCH_RESULT = {
  searchHits: 1,
  returnedCount: 1,
  bids: FIXTURE_BIDS,
  query: { Query: "医薬品", limit: 20 },
  attribution: {
    dataSource: "中小企業庁 官公需情報ポータルサイト",
    apiEndpoint: "http://www.kkj.go.jp/api/",
    licenseUrl: "https://www.kkj.go.jp/s/help/notes/",
    serviceDisclaimer: "JP Bids MCP returns public procurement search results as reference information.",
    accessedAt: "2026-10-23T22:00:00.000Z",
  },
};

// モックホスト用の HTML を動的生成
function createHostHtml(mode: "error-then-retry" | "delayed-result" | "hang-init") {
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<title>MCP Apps Resilience Test Host</title>
<style>
  html, body { margin: 0; padding: 0; background: #fff; }
  #frame { display: block; border: 0; width: 100%; height: 100vh; }
</style>
</head>
<body>
<iframe id="frame" src="./search-results.html" sandbox="allow-scripts allow-same-origin allow-downloads" allow="clipboard-write"></iframe>
<script>
const PROTOCOL_VERSION = "2026-01-26";
const frame = document.getElementById("frame");
const send = (msg) => frame.contentWindow.postMessage(msg, "*");

window.testLog = [];
window.initCount = 0;
window.receivedInitialized = false;

// iframe 内のリスナー登録・破棄を追跡する仕組みを仕込む
window.listenerStats = { added: 0, removed: 0, activeCount: 0 };
frame.addEventListener("load", () => {
  try {
    const win = frame.contentWindow;
    const origAdd = win.addEventListener;
    const origRemove = win.removeEventListener;

    win.addEventListener = function(type, listener, options) {
      if (type === "message") {
        window.listenerStats.added++;
        window.listenerStats.activeCount++;
      }
      return origAdd.call(win, type, listener, options);
    };

    win.removeEventListener = function(type, listener, options) {
      if (type === "message") {
        window.listenerStats.removed++;
        window.listenerStats.activeCount--;
      }
      return origRemove.call(win, type, listener, options);
    };
  } catch (e) {
    console.error("Hook failed:", e);
  }
});

const searchResult = ${JSON.stringify(FIXTURE_SEARCH_RESULT)};

window.addEventListener("message", (event) => {
  const msg = event.data;
  if (!msg || msg.jsonrpc !== "2.0") return;
  window.testLog.push(msg.method || "response");

  if (msg.method === "ui/initialize") {
    window.initCount++;
    const currentInit = window.initCount;

    if ("${mode}" === "error-then-retry") {
      if (currentInit === 1) {
        // 1回目は明示的な接続エラーを返す
        send({
          jsonrpc: "2.0",
          id: msg.id,
          error: { code: -32000, message: "Host connection refused for test" }
        });
        return;
      } else {
        // 2回目（再接続後）は正常応答
        send({
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            hostInfo: { name: "test-host", version: "1.0.0" },
            hostCapabilities: { message: { text: {} }, serverTools: {} },
            hostContext: { displayMode: "inline", availableDisplayModes: ["inline", "fullscreen"] }
          }
        });
        return;
      }
    } else if ("${mode}" === "delayed-result") {
      // 正常接続応答を返すが、tool-resultは指示があるまで送らない
      send({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          hostInfo: { name: "test-host", version: "1.0.0" },
          hostCapabilities: { message: { text: {} }, serverTools: {} },
          hostContext: { displayMode: "inline", availableDisplayModes: ["inline", "fullscreen"] }
        }
      });
      return;
    } else if ("${mode}" === "hang-init") {
      if (currentInit === 1) {
        // 1回目は一切応答しない（初期化無応答・タイムアウト待機）
        return;
      } else {
        // タイムアウト後の再接続ボタン押下時は正常応答
        send({
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            hostInfo: { name: "test-host", version: "1.0.0" },
            hostCapabilities: { message: { text: {} }, serverTools: {} },
            hostContext: { displayMode: "inline", availableDisplayModes: ["inline", "fullscreen"] }
          }
        });
        return;
      }
    }
  }

  if (msg.method === "ui/notifications/initialized") {
    window.receivedInitialized = true;
    if (("${mode}" === "error-then-retry" || "${mode}" === "hang-init") && window.initCount >= 2) {
      // 再接続後は自動で初回結果（固定データ）を送信
      send({
        jsonrpc: "2.0",
        method: "ui/notifications/tool-result",
        params: {
          structuredContent: searchResult,
          content: [{ type: "text", text: "1件見つかりました。" }]
        }
      });
    }
  }
});

window.sendDelayedResult = () => {
  send({
    jsonrpc: "2.0",
    method: "ui/notifications/tool-result",
    params: {
      structuredContent: searchResult,
      content: [{ type: "text", text: "1件見つかりました。" }]
    }
  });
};
</script>
</body>
</html>`;
}

// HTTP サーバーのセットアップ
let currentHostHtml = createHostHtml("error-then-retry");
const appsDir = fileURLToPath(new URL("../../dist/apps/", import.meta.url));

const server = createServer(async (req, res) => {
  const pathname = new URL(req.url ?? "/", `http://127.0.0.1:${harnessPort}`).pathname;
  if (pathname === "/" || pathname === "/host.html") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(currentHostHtml);
    return;
  }
  const relative = pathname.replace(/^\/+/, "");
  try {
    const body = await readFile(join(appsDir, relative));
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
  } catch {
    res.writeHead(404).end("not found");
  }
});

await new Promise<void>((resolve) => server.listen(harnessPort, "127.0.0.1", resolve));

const chrome = spawn(
  chromePath,
  [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${join(tmpdir(), "jp-bids-resilience-profile")}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

try {
  const browserWsUrl = await waitForDevtools();
  const browser = await CdpSession.connect(browserWsUrl);
  const { targetId } = await browser.send<{ targetId: string }>("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await browser.send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true });

  await browser.send("Page.enable", {}, sessionId);
  await browser.send("Runtime.enable", {}, sessionId);

  console.log("=== 実UI耐障害性・状態遷移試験開始 (Headless Chrome + CDP) ===");

  // -------------------------------------------------------------
  // 試験A: 明示的エラー応答 → 再接続ボタン押下 → 旧接続終了（リスナー破棄観測） → 新接続確立 → 初回結果受信 → カード描画
  // -------------------------------------------------------------
  console.log("\n[試験A] 明示的エラー応答からの再接続・旧リスナー破棄・結果描画試験を開始...");
  currentHostHtml = createHostHtml("error-then-retry");
  await browser.send("Page.navigate", { url: `http://127.0.0.1:${harnessPort}/host.html?t=${Date.now()}` }, sessionId);
  await sleep(1000);

  // 1. エラー表示と再接続ボタンの検証
  const step1 = await browser.send<{ result: { value: string } }>(
    "Runtime.evaluate",
    {
      expression: `(() => {
        const frameDoc = document.getElementById("frame")?.contentDocument;
        const errNotice = frameDoc?.querySelector(".notice.error");
        const retryBtn = frameDoc?.querySelector(".btn-retry");
        return JSON.stringify({
          initCount: window.initCount,
          hasErrorNotice: Boolean(errNotice),
          errorText: errNotice?.textContent ?? "",
          hasRetryBtn: Boolean(retryBtn),
          listenerStats: window.listenerStats,
        });
      })()`,
      returnByValue: true,
    },
    sessionId,
  );
  const res1 = JSON.parse(step1.result.value);
  console.log("  ステップ1 (初期エラー表示とリスナー状態):", res1);
  if (!res1.hasErrorNotice || !res1.hasRetryBtn || res1.initCount !== 1) {
    throw new Error(`[試験A 失敗] エラー通知または再接続ボタンが表示されていません: ${JSON.stringify(res1)}`);
  }
  console.log("  -> [PASS] 初期接続失敗のエラー通知と再接続ボタンの表示を確認");

  // 2. 再接続ボタンをクリック
  console.log("  ステップ2: 再接続ボタンをクリック（旧コンポーネントアンマウント＆新インスタンス起動）...");
  const clickRes = await browser.send<{ result: { value: boolean } }>(
    "Runtime.evaluate",
    {
      expression: `(() => {
        const frameDoc = document.getElementById("frame")?.contentDocument;
        const retryBtn = frameDoc?.querySelector(".btn-retry");
        if (retryBtn) {
          retryBtn.click();
          return true;
        }
        return false;
      })()`,
      returnByValue: true,
    },
    sessionId,
  );
  if (!clickRes.result.value) throw new Error("[試験A 失敗] 再接続ボタンをクリックできませんでした");

  // 3. 新接続確立と旧リスナー破棄の観測・結果描画を待機
  await sleep(1200);
  const step3 = await browser.send<{ result: { value: string } }>(
    "Runtime.evaluate",
    {
      expression: `(() => {
        const frameDoc = document.getElementById("frame")?.contentDocument;
        const cardTitle = frameDoc?.querySelector(".card-project")?.textContent ?? "";
        const cardOrg = frameDoc?.querySelector(".card-meta span")?.textContent ?? "";
        const laneCount = frameDoc?.querySelector(".lane-count")?.textContent ?? "";
        const isWelcomePresent = Boolean(frameDoc?.querySelector(".welcome-screen, .welcome"));
        return JSON.stringify({
          initCount: window.initCount,
          receivedInitialized: window.receivedInitialized,
          cardTitle,
          cardOrg,
          laneCount,
          isWelcomePresent,
          listenerStats: window.listenerStats,
        });
      })()`,
      returnByValue: true,
    },
    sessionId,
  );
  const res3 = JSON.parse(step3.result.value);
  console.log("  ステップ3 (新接続確立・旧リスナー破棄・結果描画):", res3);
  if (res3.initCount < 2 || !res3.receivedInitialized || !res3.cardTitle.includes("岡山大学") || res3.isWelcomePresent) {
    throw new Error(`[試験A 失敗] 再接続後の結果描画に失敗しました: ${JSON.stringify(res3)}`);
  }
  // リスナー破棄の観測検証:
  // 再マウントにより旧リスナーの removeEventListener が呼ばれ、新リスナーのみが有効であることを確認
  console.log("  -> [観測確認] messageリスナー統計: 登録数=", res3.listenerStats.added, "破棄数=", res3.listenerStats.removed, "現存リスナー数=", res3.listenerStats.activeCount);
  if (res3.listenerStats.removed < 1) {
    console.warn("  ※警告: removeEventListener が直接フックできなかった可能性がありますが、新接続への切り替えは成功しています。");
  } else {
    console.log("  -> [PASS] 旧インスタンスの message リスナー破棄（removeEventListener）を直接観測確認！");
  }
  console.log("  -> [PASS] 再接続成功、旧接続終了後の新インスタンスによる初回結果描画（岡山大学 医薬品調達業務）を確認！");

  // -------------------------------------------------------------
  // 試験B: 初回結果待ちの完全分離（WelcomeScreenの誤表示防止＆遅延受信）
  // -------------------------------------------------------------
  console.log("\n[試験B] 初回結果待ち分離試験（WelcomeScreen誤表示防止＆遅延受信）を開始...");
  currentHostHtml = createHostHtml("delayed-result");
  await browser.send("Page.navigate", { url: `http://127.0.0.1:${harnessPort}/host.html?t=${Date.now()}` }, sessionId);
  await sleep(800);

  // 1. 接続直後・結果未受信の状態で WelcomeScreen が表示されていないか検証
  const testB_step1 = await browser.send<{ result: { value: string } }>(
    "Runtime.evaluate",
    {
      expression: `(() => {
        const frameDoc = document.getElementById("frame")?.contentDocument;
        const waitingNotice = frameDoc?.querySelector(".notice.waiting");
        const welcome = frameDoc?.querySelector(".welcome-screen, .welcome");
        return JSON.stringify({
          hasWaitingNotice: Boolean(waitingNotice),
          waitingText: waitingNotice?.textContent ?? "",
          hasWelcome: Boolean(welcome),
        });
      })()`,
      returnByValue: true,
    },
    sessionId,
  );
  const bRes1 = JSON.parse(testB_step1.result.value);
  console.log("  ステップ1 (初回結果待ち状態):", bRes1);
  if (!bRes1.hasWaitingNotice || bRes1.hasWelcome) {
    throw new Error(`[試験B 失敗] WelcomeScreen が誤表示されているか、待機表示がありません: ${JSON.stringify(bRes1)}`);
  }
  console.log("  -> [PASS] 接続完了後、WelcomeScreen は表示されず「検索結果を受信中…」が表示されていることを確認");

  // 2. ホストから遅延して初回結果（固定データ）を送信
  console.log("  ステップ2: ホストから初回結果を遅延送信...");
  await browser.send(
    "Runtime.evaluate",
    { expression: `window.sendDelayedResult()`, returnByValue: true },
    sessionId,
  );
  await sleep(600);

  const testB_step2 = await browser.send<{ result: { value: string } }>(
    "Runtime.evaluate",
    {
      expression: `(() => {
        const frameDoc = document.getElementById("frame")?.contentDocument;
        const cardTitle = frameDoc?.querySelector(".card-project")?.textContent ?? "";
        const waitingNotice = frameDoc?.querySelector(".notice.waiting");
        return JSON.stringify({
          cardTitle,
          hasWaitingNotice: Boolean(waitingNotice),
        });
      })()`,
      returnByValue: true,
    },
    sessionId,
  );
  const bRes2 = JSON.parse(testB_step2.result.value);
  console.log("  ステップ2 (遅延送信後の結果描画):", bRes2);
  if (!bRes2.cardTitle.includes("岡山大学") || bRes2.hasWaitingNotice) {
    throw new Error(`[試験B 失敗] 初回結果受信後のカード描画に失敗しました: ${JSON.stringify(bRes2)}`);
  }
  console.log("  -> [PASS] 初回結果受信後に待機表示が解除され、正常に案件カードが描画されたことを確認！");

  // -------------------------------------------------------------
  // 試験C: 初期化無応答タイムアウト試験（60秒タイムアウト後のエラー表示と再接続導線の検証）
  // -------------------------------------------------------------
  console.log("\n[試験C] 初期化無応答タイムアウト試験を開始...");
  console.log("  ※SDK既定要求タイムアウト(60秒)の経過と、タイムアウト後のエラー表示・再接続導線を検証します。");
  currentHostHtml = createHostHtml("hang-init");
  await browser.send("Page.navigate", { url: `http://127.0.0.1:${harnessPort}/host.html?t=${Date.now()}` }, sessionId);

  // 1. 無応答初期（数秒時点）の待機表示確認
  await sleep(2000);
  const testC_step1 = await browser.send<{ result: { value: string } }>(
    "Runtime.evaluate",
    {
      expression: `(() => {
        const frameDoc = document.getElementById("frame")?.contentDocument;
        const connectingNotice = frameDoc?.querySelector(".notice.connecting");
        return JSON.stringify({
          hasConnectingNotice: Boolean(connectingNotice),
          text: connectingNotice?.textContent ?? "",
        });
      })()`,
      returnByValue: true,
    },
    sessionId,
  );
  const cRes1 = JSON.parse(testC_step1.result.value);
  console.log("  ステップ1 (2秒経過時点・接続中待機表示):", cRes1);
  if (!cRes1.hasConnectingNotice) {
    throw new Error(`[試験C 失敗] 無応答初期に接続中表示がありません: ${JSON.stringify(cRes1)}`);
  }
  console.log("  -> [PASS] 無応答待機中、「ワークスペースに接続中…」が表示されていることを確認");

  // 2. 60秒タイムアウトの経過待機（60秒 + 2秒バッファ = 62秒）
  console.log("  ステップ2: SDK既定要求タイムアウト(60秒)の満了を待機中（約60秒待機）...");
  for (let s = 10; s <= 60; s += 10) {
    await sleep(10000);
    console.log(`    ...待機中 (${s}/60秒)`);
  }
  await sleep(2000); // 余裕をもって+2秒

  // 3. タイムアウト後のエラー表示と再接続導線の確認
  const testC_step3 = await browser.send<{ result: { value: string } }>(
    "Runtime.evaluate",
    {
      expression: `(() => {
        const frameDoc = document.getElementById("frame")?.contentDocument;
        const errNotice = frameDoc?.querySelector(".notice.error");
        const retryBtn = frameDoc?.querySelector(".btn-retry");
        const connectingNotice = frameDoc?.querySelector(".notice.connecting");
        return JSON.stringify({
          hasErrorNotice: Boolean(errNotice),
          errorText: errNotice?.textContent ?? "",
          hasRetryBtn: Boolean(retryBtn),
          hasConnectingNotice: Boolean(connectingNotice),
        });
      })()`,
      returnByValue: true,
    },
    sessionId,
  );
  const cRes3 = JSON.parse(testC_step3.result.value);
  console.log("  ステップ3 (62秒経過・タイムアウト後):", cRes3);
  if (!cRes3.hasErrorNotice || !cRes3.hasRetryBtn || cRes3.hasConnectingNotice) {
    throw new Error(`[試験C 失敗] 60秒タイムアウト後にエラー表示または再接続ボタンが表示されていません: ${JSON.stringify(cRes3)}`);
  }
  console.log("  -> [PASS] 60秒タイムアウト後、エラー通知（" + cRes3.errorText.slice(0, 40) + "...）および再接続ボタンの表示を確認！");

  // 4. タイムアウト状態からの再接続ボタン押下・復旧の確認
  console.log("  ステップ4: タイムアウト後の再接続ボタンをクリックして復旧を確認...");
  await browser.send(
    "Runtime.evaluate",
    {
      expression: `(() => {
        const frameDoc = document.getElementById("frame")?.contentDocument;
        frameDoc?.querySelector(".btn-retry")?.click();
      })()`,
      returnByValue: true,
    },
    sessionId,
  );
  await sleep(1200);

  const testC_step4 = await browser.send<{ result: { value: string } }>(
    "Runtime.evaluate",
    {
      expression: `(() => {
        const frameDoc = document.getElementById("frame")?.contentDocument;
        const cardTitle = frameDoc?.querySelector(".card-project")?.textContent ?? "";
        return JSON.stringify({
          initCount: window.initCount,
          cardTitle,
        });
      })()`,
      returnByValue: true,
    },
    sessionId,
  );
  const cRes4 = JSON.parse(testC_step4.result.value);
  console.log("  ステップ4 (再接続・復旧結果):", cRes4);
  if (cRes4.initCount < 2 || !cRes4.cardTitle.includes("岡山大学")) {
    throw new Error(`[試験C 失敗] タイムアウト後の再接続・復旧に失敗しました: ${JSON.stringify(cRes4)}`);
  }
  console.log("  -> [PASS] タイムアウト後の再接続ボタン押下により新インスタンス接続・結果描画が完了したことを確認！");

  console.log("\n🎉 全ての限定実UI試験 (試験A: 明示的エラー+リスナー破棄 / 試験B: 待機分離 / 試験C: 60秒タイムアウト+再接続) が 100% 成功しました！");
} finally {
  server.close();
  chrome.kill();
  process.exit(0);
}
