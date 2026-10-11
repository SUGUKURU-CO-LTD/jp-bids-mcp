import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const MOCK_SERVER_SCRIPT = path.join(REPO_ROOT, "examples", "mock-stdio-server.mjs");

describe("Mock stdio server protocol verification", () => {
  it("initializes and responds to search_bids and search_bids_app with offline fixture data", async () => {
    const child = spawn(process.execPath, [MOCK_SERVER_SCRIPT], {
      cwd: REPO_ROOT,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    let stdoutData = "";
    let stderrData = "";

    child.stderr.on("data", (chunk) => {
      stderrData += chunk.toString();
    });

    child.stdout.on("data", (chunk) => {
      stdoutData += chunk.toString();
    });

    function send(msg: unknown) {
      child.stdin.write(`${JSON.stringify(msg)}\n`);
    }

    function waitForResponse(
      id: number,
      timeoutMs = 5000,
    ): Promise<{ id: number; result?: Record<string, unknown>; error?: unknown }> {
      return new Promise((resolve, reject) => {
        const start = Date.now();
        const interval = setInterval(() => {
          const lines = stdoutData.split("\n");
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const parsed = JSON.parse(line.trim());
              if (parsed.id === id) {
                clearInterval(interval);
                return resolve(parsed);
              }
            } catch {
              // wait for complete line
            }
          }
          if (Date.now() - start > timeoutMs) {
            clearInterval(interval);
            reject(new Error(`Timeout waiting for response to id ${id}. Stderr: ${stderrData}`));
          }
        }, 50);
      });
    }

    try {
      // 1. Initialize
      send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "verify-client", version: "1.0.0" },
        },
      });

      const initResp = await waitForResponse(1);
      expect(initResp.error).toBeUndefined();
      expect(initResp.result?.serverInfo).toMatchObject({
        name: "JP Bids",
      });

      // 2. Initialized notification
      send({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      });

      // 3. List tools (verify 7 public tools)
      send({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      });

      const listToolsResp = await waitForResponse(2);
      expect(listToolsResp.error).toBeUndefined();
      const tools = (listToolsResp.result?.tools as Array<{ name: string }>) ?? [];
      const toolNames = tools.map((t) => t.name);
      expect(tools).toHaveLength(7);
      expect(toolNames).toEqual(
        expect.arrayContaining([
          "search_bids",
          "list_recent_bids",
          "get_bid_detail",
          "rank_bids",
          "extract_bid_requirements",
          "export_bid_shortlist",
          "search_bids_app",
        ]),
      );

      // 4. Call search_bids (verify mock fixture KKJ-TEST-001)
      send({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "search_bids",
          arguments: { query: "保守" },
        },
      });

      const searchResp = await waitForResponse(3);
      expect(searchResp.error).toBeUndefined();
      const searchStr = JSON.stringify(searchResp);
      expect(searchStr).toContain("KKJ-TEST-001");

      // 5. Call search_bids_app
      send({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "search_bids_app",
          arguments: { query: "保守" },
        },
      });

      const appResp = await waitForResponse(4);
      expect(appResp.error).toBeUndefined();
      const appStr = JSON.stringify(appResp);
      expect(appStr).toContain("KKJ-TEST-001");

      // 6. Read resource (attribution)
      send({
        jsonrpc: "2.0",
        id: 5,
        method: "resources/read",
        params: {
          uri: "attribution://kkj",
        },
      });

      const resourceResp = await waitForResponse(5);
      expect(resourceResp.error).toBeUndefined();
      const resourceStr = JSON.stringify(resourceResp);
      expect(resourceStr).toContain("官公需情報ポータルサイト");

      // 7. Read MCP Apps UI resource (ui://jp-bids/search-results.html)
      send({
        jsonrpc: "2.0",
        id: 6,
        method: "resources/read",
        params: {
          uri: "ui://jp-bids/search-results.html",
        },
      });

      const uiResourceResp = await waitForResponse(6);
      expect(uiResourceResp.error).toBeUndefined();
      const contents = uiResourceResp.result?.contents as
        | Array<{ uri?: string; mimeType?: string; text?: string }>
        | undefined;
      expect(contents).toBeDefined();
      expect(contents?.[0]?.uri).toBe("ui://jp-bids/search-results.html");
      expect(contents?.[0]?.mimeType).toBe("text/html;profile=mcp-app");
      expect(contents?.[0]?.text).toContain("<title>JP Bids Search Results</title>");
      expect(contents?.[0]?.text?.toLowerCase()).toContain("<!doctype html>");
    } finally {
      child.stdin.end();
      child.kill();
    }
  });
});
