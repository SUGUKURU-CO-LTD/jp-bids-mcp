import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { KkjClient } from "../api/kkj-client.js";
import type { ServerProfile } from "../lib/profile.js";
import { registerExportBidShortlist } from "./export-bid-shortlist.js";
import { registerExtractBidRequirements } from "./extract-bid-requirements.js";
import { registerGetBidDetail } from "./get-bid-detail.js";
import { registerListRecentBids } from "./list-recent-bids.js";
import { registerRankBids } from "./rank-bids.js";
import { registerSearchBids } from "./search-bids.js";

// Public MVP 6 tools (7th is search_bids_app registered with the app resource)
export const PUBLIC_MVP_TOOL_REGISTRATIONS = [
  registerSearchBids,
  registerListRecentBids,
  registerGetBidDetail,
  registerRankBids,
  registerExtractBidRequirements,
  registerExportBidShortlist,
] as const;

export function registerTools(
  server: McpServer,
  client: KkjClient,
  profile: ServerProfile = "public_mvp",
): void {
  for (const register of PUBLIC_MVP_TOOL_REGISTRATIONS) {
    (register as (s: McpServer, c: KkjClient, p?: ServerProfile) => void)(server, client, profile);
  }
}
