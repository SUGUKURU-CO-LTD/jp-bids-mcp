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
        "Use JP Bids to search public Japanese government procurement notices, rank bid opportunities, extract requirements, and export shortlists. Free and read-centric. Always show the KKJ attribution included in tool results.",
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
