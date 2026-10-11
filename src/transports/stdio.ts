import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { parsePositiveNumberEnv } from "../lib/env.js";
import { createJpBidsServer } from "../mcp.js";

export async function startStdioServer(): Promise<void> {
  const server = createJpBidsServer({
    kkjClientOptions: {
      rateLimitPerSecond: parsePositiveNumberEnv(
        process.env.JP_BIDS_RATE_LIMIT_PER_SECOND ?? process.env.KOKO_CALL_RATE_LIMIT_PER_SECOND,
        1,
      ),
      timeoutMs: parsePositiveNumberEnv(process.env.JP_BIDS_KKJ_TIMEOUT_MS, 15_000),
    },
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("JP Bids MCP listening on stdio");
}
