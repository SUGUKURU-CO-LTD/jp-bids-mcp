/**
 * MCP Apps ハーネス用の静的サーバー。
 * dist/apps/search-results.html（本番バンドル）と scripts/apps-harness/host.html を
 * 同一オリジンで配信し、ホスト側の postMessage が届く状態を作る。
 *
 * Static server for the MCP Apps harness. Serves the production bundle
 * (dist/apps/search-results.html) and scripts/apps-harness/host.html from the
 * same origin so host postMessage reaches the app.
 *
 * Server statis untuk harness MCP Apps. Menyajikan bundel production dan
 * host.html dari origin yang sama agar postMessage host mencapai aplikasi.
 *
 * 使い方 / Usage / Penggunaan:
 *   npx tsx scripts/apps-harness/serve.ts
 *   open http://127.0.0.1:8899/host.html
 */

import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const harnessDir = fileURLToPath(new URL(".", import.meta.url));
const appsDir = fileURLToPath(new URL("../../dist/apps/", import.meta.url));
const port = Number(process.env.HARNESS_PORT ?? 8899);

const mimeTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

async function readCandidate(pathname: string): Promise<Buffer | undefined> {
  const relative = pathname.replace(/^\/+/, "") || "host.html";
  // パストラバーサルを防ぐ / Prevent path traversal / Cegah path traversal
  if (relative.includes("..")) return undefined;
  for (const dir of [harnessDir, appsDir]) {
    try {
      return await readFile(join(dir, relative));
    } catch {
      // 次の候補ディレクトリを試す / try the next candidate directory
    }
  }
  return undefined;
}

const server = createServer(async (req, res) => {
  const pathname = new URL(req.url ?? "/", `http://127.0.0.1:${port}`).pathname;
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

server.listen(port, "127.0.0.1", () => {
  console.error(`MCP Apps harness: http://127.0.0.1:${port}/host.html`);
});
