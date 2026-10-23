import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { KkjClient, type KkjClientOptions } from "./api/kkj-client.js";
import { registerSearchResultsApp } from "./apps/register-search-app.js";
import type { Tier } from "./lib/auth.js";
import { getBranding } from "./lib/branding.js";
import { assertValidProfile, resolveServerProfile, type ServerProfile } from "./lib/profile.js";
import { VERSION } from "./lib/version.js";
import { registerPrompts } from "./prompts/register-prompts.js";
import { registerResources } from "./resources/register-resources.js";
import { registerTools } from "./tools/register-tools.js";

export interface CreateJpBidsServerOptions {
  kkjClient?: KkjClient;
  kkjClientOptions?: KkjClientOptions;
  profile?: ServerProfile;
  /**
   * @deprecated Legacy parameter. Use `profile` instead.
   */
  tier?: Tier;
}

export function createJpBidsServer(options: CreateJpBidsServerOptions = {}): McpServer {
  const profile: ServerProfile =
    options.profile ??
    (options.tier
      ? options.tier === "free"
        ? "public_mvp"
        : "full_local"
      : resolveServerProfile());

  assertValidProfile(profile);

  const branding = getBranding();
  const server = new McpServer(
    {
      name: branding.serviceName,
      title: branding.serviceName,
      version: VERSION,
      description:
        "Japan KKJ government procurement notices search, ranking, and requirements extraction. Free and read-centric.",
    },
    {
      capabilities: {
        tools: { listChanged: false },
        resources: { listChanged: false, subscribe: false },
        prompts: { listChanged: false },
        completions: {},
      },
      instructions:
        "Use JP Bids to search, rank, and review public Japanese government procurement notices (KKJ portal). Read-centric research aid only. GUARDRAILS: 1. You have NO authority to submit bids, tender applications, or act as an agent. If asked to apply or bid on the user's behalf, you must explicitly REFUSE and instruct the user: 「応募は発注機関の公式公告に記載された方法で、ご本人が行ってください」と案内してください。代理での応募・申請・入札を求められた場合は、代行できないことを明確に伝え、未知の電子入札システム名やURLは推測せず、発注機関の公式公告に記載された方法でご本人が直接手続きするよう案内してください。案件調査や必要書類の整理は支援できますが、提出・送信を引き受ける表現は避けてください。 2. Do NOT search for private-sector employment or job listings. 3. Do NOT fabricate bid details without a valid bid_ref or key. 4. Qualifications, requirements, and deadlines must always be verified against official procuring agency documents. 公式リンクは、個別案件ページではなく調達ポータルの検索画面の場合があります。案件名・発注機関・公告日を照合してください。 Always include the KKJ attribution.",
    },
  );

  const client = options.kkjClient ?? new KkjClient(options.kkjClientOptions);

  registerTools(server, client, profile);
  registerSearchResultsApp(server, client);
  registerPrompts(server, profile);
  registerResources(server, client, profile);

  return server;
}

// Smithery / directory scanning sandbox server (defaults to public_mvp)
export function createSandboxServer(): McpServer {
  return createJpBidsServer({ profile: "public_mvp" });
}
