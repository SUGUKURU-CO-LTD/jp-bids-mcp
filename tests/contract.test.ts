import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createJpBidsServer } from "../src/mcp.js";

describe("MCP contract", () => {
  it("exposes tools, prompts, resources, templates, and completion", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createJpBidsServer();
    const client = new Client({ name: "contract-test", version: "0.1.0" });

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual(
      [
        "export_bid_shortlist",
        "extract_bid_requirements",
        "get_bid_detail",
        "list_recent_bids",
        "rank_bids",
        "search_bids",
        "search_bids_app",
      ].sort(),
    );

    const prompts = await client.listPrompts();
    expect(prompts.prompts.map((prompt) => prompt.name).sort()).toEqual(
      ["bid_discovery_workspace", "bid_due_alert", "morning_bid_briefing"].sort(),
    );

    const resources = await client.listResources();
    expect(resources.resources.map((resource) => resource.uri).sort()).toEqual(
      [
        "attribution://kkj",
        "codes://prefectures",
        "docs://api-reference",
        "ui://jp-bids/search-results.html",
      ].sort(),
    );

    const templates = await client.listResourceTemplates();
    expect(templates.resourceTemplates.map((template) => template.uriTemplate)).toEqual([
      "prefecture://{lg_code}",
    ]);

    const completion = await client.complete({
      ref: { type: "ref/resource", uri: "prefecture://{lg_code}" },
      argument: { name: "lg_code", value: "4" },
    });
    expect(completion.completion.values).toEqual(expect.arrayContaining(["46"]));

    await client.close();
    await server.close();
  });

  it("reads the MCP Apps search results UI resource", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createJpBidsServer();
    const client = new Client({ name: "app-resource-test", version: "0.1.0" });

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const resource = await client.readResource({ uri: "ui://jp-bids/search-results.html" });
    expect(resource.contents[0]).toMatchObject({
      mimeType: "text/html;profile=mcp-app",
    });
    expect(resource.contents[0]?.text).toContain('<div id="root"></div>');

    await client.close();
    await server.close();
  });
});
