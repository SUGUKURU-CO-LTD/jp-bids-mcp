import request from "supertest";
import { describe, expect, it } from "vitest";
import { createHttpApp } from "../src/transports/http.js";

describe("HTTP transport app", () => {
  it("serves health checks", async () => {
    const response = await request(createHttpApp()).get("/health").expect(200);
    expect(response.body).toEqual({ ok: true, service: "JP Bids MCP" });
  });

  it("serves readiness checks on a custom-domain friendly path", async () => {
    const response = await request(createHttpApp()).get("/readyz").expect(200);
    expect(response.body).toEqual({ ok: true, service: "JP Bids MCP" });
  });

  it("rejects unsupported standalone SSE GET on /mcp", async () => {
    const response = await request(createHttpApp()).get("/mcp").expect(405);
    expect(response.body.error).toContain("SSE GET");
  });

  it("rejects unsupported MCP protocol versions", async () => {
    const response = await request(createHttpApp())
      .post("/mcp")
      .set("MCP-Protocol-Version", "1900-01-01")
      .send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })
      .expect(400);
    expect(response.body).toMatchObject({
      error: "Unsupported MCP protocol version",
      supported: ["2025-11-25", "2026-07-28"],
    });
  });

  it("rejects routable MCP headers that disagree with the JSON-RPC body", async () => {
    await request(createHttpApp())
      .post("/mcp")
      .set("Mcp-Method", "tools/call")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
      .expect(400);

    await request(createHttpApp())
      .post("/mcp")
      .set("Mcp-Method", "tools/call")
      .set("Mcp-Name", "search_bids")
      .send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "rank_bids" } })
      .expect(400);
  });

  it("serves usage stats on /stats", async () => {
    const response = await request(createHttpApp()).get("/stats").expect(200);
    expect(response.body).toMatchObject({
      service: "JP Bids MCP",
      mcpRequestCount: expect.any(Number),
      uptimeSeconds: expect.any(Number),
      nodeVersion: expect.any(String),
    });
    expect(response.body.startedAt).toBeDefined();
  });

  it("serves landing page on /", async () => {
    const response = await request(createHttpApp()).get("/").expect(200);
    expect(response.headers["content-type"]).toMatch(/html/);
  });

  it("returns 404 for the OpenAI Apps domain challenge when no token is configured", async () => {
    const response = await request(createHttpApp())
      .get("/.well-known/openai-apps-challenge")
      .expect(404);
    expect(response.text).toBe("not configured");
  });

  it("serves the OpenAI Apps domain challenge token as plain text when configured", async () => {
    const original = process.env.OPENAI_APPS_CHALLENGE_TOKEN;
    process.env.OPENAI_APPS_CHALLENGE_TOKEN = "test-challenge-token";
    try {
      const response = await request(createHttpApp())
        .get("/.well-known/openai-apps-challenge")
        .expect(200);
      expect(response.text).toBe("test-challenge-token");
      expect(response.headers["content-type"]).toMatch(/text\/plain/);
    } finally {
      if (original === undefined) {
        delete process.env.OPENAI_APPS_CHALLENGE_TOKEN;
      } else {
        process.env.OPENAI_APPS_CHALLENGE_TOKEN = original;
      }
    }
  });
});
