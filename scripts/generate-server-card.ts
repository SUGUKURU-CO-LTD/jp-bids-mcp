import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { VERSION } from "../src/lib/version.js";
import { createJpBidsServer } from "../src/mcp.js";

const outputPath = "public/.well-known/mcp/server-card.json";

const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
const server = createJpBidsServer({ profile: "public_mvp" });
const client = new Client({ name: "server-card-generator", version: VERSION });

await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
const tools = await client.listTools();
await client.close();
await server.close();

const card = {
  serverInfo: {
    name: "JP Bids",
    version: VERSION,
  },
  authentication: {
    required: true,
    schemes: ["oauth2", "api_key"],
    transports: {
      stdio: { required: false },
      streamable_http: { required: true },
    },
  },
  tools: tools.tools.map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema ?? null,
    annotations: tool.annotations ?? {},
    _meta: tool._meta ?? {},
  })),
};

await writeFile(outputPath, `${JSON.stringify(card, null, 2)}\n`, "utf8");

const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";
execFileSync(npxCmd, ["biome", "format", "--write", outputPath], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
console.error(`Generated ${outputPath}`);
