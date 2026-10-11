import { createHash } from "node:crypto";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHttpApp } from "../src/transports/http.js";

const BASE_URL = "https://mcp.test";
const REDIRECT_URI = "http://localhost/callback";

describe("OAuth flow", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      JP_BIDS_BASE_URL: BASE_URL,
      JP_BIDS_OAUTH_SECRET: "test-oauth-secret-with-at-least-32-bytes",
      JP_BIDS_OAUTH_STORE: "memory",
      JP_BIDS_PRO_API_KEYS: "jp-bids.test.key",
      JP_BIDS_OAUTH_RATE_LIMIT_MAX: "100",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("registers clients and binds authorization to registered redirect URIs", async () => {
    const app = createHttpApp();
    const client = await registerClient(app);
    expect(client.client_id_expires_at).toEqual(expect.any(Number));

    await request(app)
      .get("/oauth/authorize")
      .query({
        response_type: "code",
        client_id: client.client_id,
        redirect_uri: "http://localhost/other",
        code_challenge: challengeFor("verifier"),
        code_challenge_method: "S256",
        scope: "mcp:read",
        resource: `${BASE_URL}/mcp`,
      })
      .expect(400);
  });

  it("caps dynamic client registration metadata size", async () => {
    const app = createHttpApp();
    await request(app)
      .post("/oauth/register")
      .send({
        client_name: "x".repeat(121),
        redirect_uris: [REDIRECT_URI],
      })
      .expect(400);

    await request(app)
      .post("/oauth/register")
      .send({
        client_name: "Test MCP Client",
        redirect_uris: Array.from({ length: 11 }, (_, index) => `http://localhost/cb-${index}`),
      })
      .expect(400);
  });

  it("rate-limits unauthenticated OAuth registration writes", async () => {
    process.env.JP_BIDS_OAUTH_RATE_LIMIT_MAX = "2";
    const app = createHttpApp();

    await registerClient(app);
    await registerClient(app);
    await request(app)
      .post("/oauth/register")
      .send({
        client_name: "Test MCP Client",
        redirect_uris: [REDIRECT_URI],
      })
      .expect(429);
  });

  it("uses forwarded client IPs for OAuth rate limiting behind proxies", async () => {
    process.env.JP_BIDS_OAUTH_RATE_LIMIT_MAX = "1";
    const app = createHttpApp();

    await request(app)
      .post("/oauth/register")
      .set("X-Forwarded-For", "203.0.113.10")
      .send({ client_name: "A", redirect_uris: [REDIRECT_URI] })
      .expect(201);
    await request(app)
      .post("/oauth/register")
      .set("X-Forwarded-For", "203.0.113.10")
      .send({ client_name: "A2", redirect_uris: [REDIRECT_URI] })
      .expect(429);
    await request(app)
      .post("/oauth/register")
      .set("X-Forwarded-For", "203.0.113.11")
      .send({ client_name: "B", redirect_uris: [REDIRECT_URI] })
      .expect(201);
  });

  it("exchanges an authorization code once and rotates refresh tokens", async () => {
    const app = createHttpApp();
    const client = await registerClient(app);
    const verifier = "correct-horse-battery-staple";
    const code = await authorize(app, client.client_id, verifier);

    const tokenResponse = await request(app)
      .post("/oauth/token")
      .type("form")
      .send({
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
        client_id: client.client_id,
        redirect_uri: REDIRECT_URI,
      })
      .expect(200);

    expect(tokenResponse.body).toMatchObject({
      token_type: "Bearer",
      expires_in: 3600,
      scope: "mcp:read",
    });
    expect(tokenResponse.body.access_token).toEqual(expect.any(String));
    expect(tokenResponse.body.refresh_token).toEqual(expect.any(String));

    await request(app)
      .post("/oauth/token")
      .type("form")
      .send({
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
        client_id: client.client_id,
        redirect_uri: REDIRECT_URI,
      })
      .expect(400);

    const refreshResponse = await request(app)
      .post("/oauth/token")
      .type("form")
      .send({
        grant_type: "refresh_token",
        refresh_token: tokenResponse.body.refresh_token,
      })
      .expect(200);
    expect(refreshResponse.body.refresh_token).not.toBe(tokenResponse.body.refresh_token);

    await request(app)
      .post("/oauth/token")
      .type("form")
      .send({
        grant_type: "refresh_token",
        refresh_token: tokenResponse.body.refresh_token,
      })
      .expect(400);
  });

  it("accepts only access tokens on /mcp and still allows dotted API keys", async () => {
    const app = createHttpApp();
    const client = await registerClient(app);
    const verifier = "mcp-access-token-verifier";
    const code = await authorize(app, client.client_id, verifier);

    await request(app)
      .post("/mcp")
      .set("Authorization", `Bearer ${code}`)
      .send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })
      .expect(401);

    const tokenResponse = await request(app)
      .post("/oauth/token")
      .type("form")
      .send({
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
        client_id: client.client_id,
        redirect_uri: REDIRECT_URI,
      })
      .expect(200);

    await request(app)
      .post("/mcp")
      .set("Authorization", `Bearer ${tokenResponse.body.refresh_token}`)
      .send({ jsonrpc: "2.0", id: 2, method: "initialize", params: {} })
      .expect(401);

    await request(app)
      .post("/mcp")
      .set("Authorization", `Bearer ${tokenResponse.body.access_token}`)
      .send({ jsonrpc: "2.0", id: 3, method: "initialize", params: {} })
      .expect((response) => {
        if (response.status === 401) {
          throw new Error(`access token was rejected: ${response.text}`);
        }
      });

    await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer jp-bids.test.key")
      .send({ jsonrpc: "2.0", id: 4, method: "initialize", params: {} })
      .expect((response) => {
        if (response.status === 401) {
          throw new Error(`dotted API key was rejected: ${response.text}`);
        }
      });
  });
});

async function registerClient(app: ReturnType<typeof createHttpApp>): Promise<{
  client_id: string;
  client_id_expires_at: number;
}> {
  const response = await request(app)
    .post("/oauth/register")
    .send({
      client_name: "Test MCP Client",
      redirect_uris: [REDIRECT_URI],
    })
    .expect(201);
  return response.body as { client_id: string; client_id_expires_at: number };
}

async function authorize(
  app: ReturnType<typeof createHttpApp>,
  clientId: string,
  verifier: string,
): Promise<string> {
  const response = await request(app)
    .post("/oauth/authorize")
    .type("form")
    .send({
      action: "allow",
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      state: "state-1",
      scope: "mcp:read",
      code_challenge: challengeFor(verifier),
      code_challenge_method: "S256",
      resource: `${BASE_URL}/mcp`,
    })
    .expect(302);
  const location = response.header.location;
  expect(location).toBeDefined();
  const redirect = new URL(location ?? REDIRECT_URI);
  expect(redirect.searchParams.get("iss")).toBe(BASE_URL);
  const code = redirect.searchParams.get("code");
  expect(code).toEqual(expect.any(String));
  return code ?? "";
}

function challengeFor(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}
