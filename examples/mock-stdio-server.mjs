// examples/mock-stdio-server.mjs
// JP Bids MCP — Public Mock stdio launcher for Claude Desktop & MCP Clients
//
// Purpose:
// Demonstrates and verifies JP Bids MCP (including MCP Apps UI) offline
// using local XML fixtures (tests/fixtures/kkj-search.xml) without network access.
//
// Reproduces M1–M3-B milestone verification:
// - M1: Chat bid search (search_bids) -> structured response
// - M2: MCP Apps workspace UI (search_bids_app) -> interactive HTML panel
// - M3-A: In-app UI selection & state updates
// - M3-B: In-app bidirectional tool calls -> search_bids_app
//
// Security & Scope Notice:
// - Application-level mock: In-application HTTP interceptor replacing calls to
//   http://www.kkj.go.jp/api/ with local XML fixture responses.
// - Application fetch guard: Unexpected globalThis.fetch calls throw an error.
//   (Note: This is an application-level runtime mock/interception, NOT an
//   OS-level sandbox or network-level firewall isolation).
// - stdout is strictly reserved for JSON-RPC messages (StdioServerTransport).
//   All debug, diagnostic, and error logs are directed to stderr.
// - Zero PDF/attachment downloads, zero API keys required.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const FIXTURE_PATH = path.join(REPO_ROOT, "tests", "fixtures", "kkj-search.xml");
const DIST_MCP_PATH = path.join(REPO_ROOT, "dist", "mcp.js");
const DIST_KKJ_CLIENT_PATH = path.join(REPO_ROOT, "dist", "api", "kkj-client.js");

// 1. Enforce safe environment profiles
process.env.JP_BIDS_PROFILE = "public_mvp";
process.env.JP_BIDS_DOCUMENT_EXTRACTION = "off";

// 2. Pre-flight checks: Ensure build artifacts exist
if (!fs.existsSync(DIST_MCP_PATH) || !fs.existsSync(DIST_KKJ_CLIENT_PATH)) {
  process.stderr.write(
    `[mock-stdio-FATAL] Build artifacts not found in dist/.\n` +
      `Please run "npm run build" in the repository root before running this mock server.\n`,
  );
  process.exit(1);
}

// 3. Pre-flight checks: Ensure offline fixture exists
if (!fs.existsSync(FIXTURE_PATH)) {
  process.stderr.write(`[mock-stdio-FATAL] Fixture not found at: ${FIXTURE_PATH}\n`);
  process.exit(1);
}

const xmlContent = fs.readFileSync(FIXTURE_PATH, "utf8");
if (!xmlContent || xmlContent.trim().length === 0) {
  process.stderr.write(`[mock-stdio-FATAL] Fixture is empty at: ${FIXTURE_PATH}\n`);
  process.exit(1);
}

// 4. Application-level fetch guard (blocks unexpected outbound network calls)
// NOTE: This intercepts runtime fetch calls within Node.js, not OS-level traffic.
globalThis.fetch = async function blockedFetch(input) {
  const urlStr = typeof input === "string" ? input : input?.url ? input.url : String(input);
  process.stderr.write(`[mock-stdio-BLOCKED] Prevented unexpected outbound fetch to: ${urlStr}\n`);
  throw new Error(`[app-mock-guard] Outbound network egress blocked in mock mode: ${urlStr}`);
};

// 5. Dynamic imports of project artifacts using platform-independent URLs
const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
const { createJpBidsServer } = await import(pathToFileURL(DIST_MCP_PATH).href);
const { KkjClient } = await import(pathToFileURL(DIST_KKJ_CLIENT_PATH).href);

// 6. Strict mock KKJ client implementation
const mockFetchImpl = async (url) => {
  const urlStr = String(url);
  let parsedUrl;
  try {
    parsedUrl = new URL(urlStr);
  } catch {
    process.stderr.write(`[mock-stdio-WARN] Invalid URL format: ${urlStr}\n`);
    throw new Error(`[mock-guard] Invalid URL format: ${urlStr}`);
  }

  // Exact URL pattern matching: only http://www.kkj.go.jp/api/ is accepted
  const isExactKkjMatch =
    parsedUrl.protocol === "http:" &&
    parsedUrl.hostname === "www.kkj.go.jp" &&
    parsedUrl.pathname === "/api/";

  if (!isExactKkjMatch) {
    process.stderr.write(`[mock-stdio-WARN] Rejected non-matching URL: ${urlStr}\n`);
    throw new Error(
      `[mock-guard] Strict URL match failed: expected http://www.kkj.go.jp/api/, got ${parsedUrl.origin}${parsedUrl.pathname}`,
    );
  }

  const timestamp = new Date().toISOString();
  process.stderr.write(
    `[mock-stdio ${timestamp}] [LOCAL_MOCK_CALL] Mock KKJ fetch intercepted: ${urlStr.slice(0, 100)}\n`,
  );

  return new Response(xmlContent, {
    status: 200,
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
};

const mockKkjClient = new KkjClient({
  rateLimitPerSecond: 1000,
  timeoutMs: 5000,
  fetchImpl: mockFetchImpl,
});

// 7. Create server instance with public_mvp profile and connect transport
const server = createJpBidsServer({
  kkjClient: mockKkjClient,
  profile: "public_mvp",
});

const transport = new StdioServerTransport();
await server.connect(transport);

process.stderr.write(
  `[mock-stdio] JP Bids MCP [LOCAL_MOCK_DEMO] listening on stdio (PID: ${process.pid}, profile: public_mvp)\n`,
);
