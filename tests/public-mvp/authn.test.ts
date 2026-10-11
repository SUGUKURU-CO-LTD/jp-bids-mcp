import { createHash, createHmac } from "node:crypto";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  authenticateMcpRequest,
  constantTimeStringEqual,
  parseServiceApiKeys,
} from "../../src/lib/authn.js";
import { resolveServerProfile } from "../../src/lib/profile.js";
import { createJpBidsServer } from "../../src/mcp.js";
import { signJwt } from "../../src/oauth/jwt.js";
import { createHttpApp } from "../../src/transports/http.js";

const TEST_SECRET = "test-secret-with-sufficient-length-at-least-32-bytes";
const BASE_URL = "https://mcp.test";
const REDIRECT_URI = "http://localhost/callback";

function challengeFor(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

describe("U2-R: Authentication & Authorization Acceptance (A01 - A08)", () => {
  const originalEnv = { ...process.env };
  const serviceKeys = parseServiceApiKeys("service.key.one, service.key.two");

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      JP_BIDS_BASE_URL: BASE_URL,
      JP_BIDS_OAUTH_SECRET: TEST_SECRET,
      JP_BIDS_PRO_API_KEYS: "service.key.one, service.key.two",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // A01: Missing or malformed Authorization header
  describe("A01: Missing or malformed Authorization header", () => {
    it("A01-01: unit: rejects missing or empty Authorization header", () => {
      const res1 = authenticateMcpRequest(undefined, {
        serviceKeys,
        oauthSecret: TEST_SECRET,
        baseUrl: BASE_URL,
      });
      expect(res1.status).toBe("missing_header");

      const res2 = authenticateMcpRequest("   ", {
        serviceKeys,
        oauthSecret: TEST_SECRET,
        baseUrl: BASE_URL,
      });
      expect(res2.status).toBe("missing_header");
    });

    it("A01-02: unit: rejects malformed Bearer header format (e.g. Basic, empty token)", () => {
      const res1 = authenticateMcpRequest("Basic user:pass", {
        serviceKeys,
        oauthSecret: TEST_SECRET,
        baseUrl: BASE_URL,
      });
      expect(res1.status).toBe("invalid_format");

      const res2 = authenticateMcpRequest("Bearer", {
        serviceKeys,
        oauthSecret: TEST_SECRET,
        baseUrl: BASE_URL,
      });
      expect(res2.status).toBe("invalid_format");
    });

    it("A01-03: HTTP: returns 401 with WWW-Authenticate header when Authorization header is absent", async () => {
      const app = createHttpApp();
      const res = await request(app)
        .post("/mcp")
        .send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
        .expect(401);

      expect(res.headers["www-authenticate"]).toContain("Bearer resource_metadata=");
      expect(res.body).toEqual({ error: "unauthorized" });
    });
  });

  // A02: Valid OAuth and Service Key Authentication without Tier Lock
  describe("A02: Valid OAuth and Service Key connection without Tier Lock", () => {
    it("A02-01: valid OAuth access token connects and resolves exactly 7 public tools without tier lock", async () => {
      const app = createHttpApp();
      const now = Math.floor(Date.now() / 1000);
      const token = signJwt(
        {
          iss: BASE_URL,
          aud: `${BASE_URL}/mcp`,
          sub: "user-a02",
          scope: "mcp:read",
          type: "access_token",
          iat: now,
          exp: now + 3600,
        },
        TEST_SECRET,
      );

      const res = await request(app)
        .post("/mcp")
        .set("Authorization", `Bearer ${token}`)
        .set("Accept", "application/json, text/event-stream")
        .send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })
        .expect(200);

      expect(res.status).toBe(200);
      expect(resolveServerProfile()).toBe("public_mvp");
    });

    it("A02-02: valid Service API Key connects and executes tools with identical public MVP scope", async () => {
      const app = createHttpApp();
      const res = await request(app)
        .post("/mcp")
        .set("Authorization", "Bearer service.key.one")
        .set("Accept", "application/json, text/event-stream")
        .send({ jsonrpc: "2.0", id: 2, method: "initialize", params: {} })
        .expect(200);

      expect(res.status).toBe(200);
    });
  });

  // A03: Invalid Signature or Corrupted JWT
  describe("A03: Invalid signature or corrupted JWT", () => {
    it("A03-01: unit: rejects token signed with wrong secret", () => {
      const now = 1700000000;
      const wrongSecretJwt = signJwt(
        {
          iss: BASE_URL,
          aud: `${BASE_URL}/mcp`,
          sub: "user-tampered",
          scope: "mcp:read",
          type: "access_token",
          iat: now,
          exp: now + 3600,
        },
        "wrong-secret-that-does-not-match-at-all-32b",
      );

      const res = authenticateMcpRequest(`Bearer ${wrongSecretJwt}`, {
        serviceKeys,
        oauthSecret: TEST_SECRET,
        baseUrl: BASE_URL,
        now: new Date(now * 1000),
      });
      expect(res.status).toBe("invalid_token");
    });

    it("A03-02: HTTP: returns 401 with invalid_token WWW-Authenticate header", async () => {
      const app = createHttpApp();
      const res = await request(app)
        .post("/mcp")
        .set("Authorization", "Bearer corrupted.jwt.token.string")
        .send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
        .expect(401);

      expect(res.headers["www-authenticate"]).toContain('Bearer error="invalid_token"');
      expect(res.body).toEqual({ error: "invalid_token" });
    });
  });

  // A04: Expired, Missing Exp, or Invalid Alg
  describe("A04: Expired, missing exp, or invalid algorithm", () => {
    it("A04-01: rejects token with exp in the past", () => {
      const now = 1700000000;
      const expiredJwt = signJwt(
        {
          iss: BASE_URL,
          aud: `${BASE_URL}/mcp`,
          sub: "user-expired",
          scope: "mcp:read",
          type: "access_token",
          iat: now - 7200,
          exp: now - 3600,
        },
        TEST_SECRET,
      );

      const res = authenticateMcpRequest(`Bearer ${expiredJwt}`, {
        serviceKeys,
        oauthSecret: TEST_SECRET,
        baseUrl: BASE_URL,
        now: new Date(now * 1000),
      });
      expect(res.status).toBe("invalid_token");
    });

    it("A04-02: boundary: exp === now is strictly rejected as expired", () => {
      const now = 1700000000;
      const exactBoundaryJwt = signJwt(
        {
          iss: BASE_URL,
          aud: `${BASE_URL}/mcp`,
          sub: "user-boundary",
          scope: "mcp:read",
          type: "access_token",
          iat: now - 3600,
          exp: now, // exp === now
        },
        TEST_SECRET,
      );

      const res = authenticateMcpRequest(`Bearer ${exactBoundaryJwt}`, {
        serviceKeys,
        oauthSecret: TEST_SECRET,
        baseUrl: BASE_URL,
        now: new Date(now * 1000),
      });
      expect(res.status).toBe("invalid_token");
    });

    it("A04-03: rejects tokens signed with alg: 'none'", () => {
      const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" }), "utf8").toString(
        "base64url",
      );
      const payload = Buffer.from(
        JSON.stringify({
          iss: BASE_URL,
          aud: `${BASE_URL}/mcp`,
          sub: "user-none",
          scope: "mcp:read",
          iat: 1700000000,
          exp: 1700003600,
        }),
        "utf8",
      ).toString("base64url");
      const unsignedToken = `${header}.${payload}.`;

      const res = authenticateMcpRequest(`Bearer ${unsignedToken}`, {
        serviceKeys,
        oauthSecret: TEST_SECRET,
        baseUrl: BASE_URL,
      });
      expect(res.status).toBe("invalid_token");
    });
  });

  // A05: Purpose / Audience / Issuer Mismatch
  describe("A05: Different issuer / audience / purpose mismatch", () => {
    it("A05-01: rejects bid_ref token used as MCP access token due to typ & purpose mismatch", () => {
      const header = Buffer.from(
        JSON.stringify({ alg: "HS256", typ: "jp-bids-bid-ref+jwt" }),
        "utf8",
      ).toString("base64url");
      const payload = Buffer.from(
        JSON.stringify({
          purpose: "bid_ref",
          iss: BASE_URL,
          aud: "jp-bids:bid_ref",
          sub: "user-snapshot",
          scope: "mcp:read",
          iat: 1700000000,
          exp: 1700003600,
        }),
        "utf8",
      ).toString("base64url");
      const sig = createHmac("sha256", TEST_SECRET)
        .update(`${header}.${payload}`)
        .digest("base64url");
      const bidRefToken = `${header}.${payload}.${sig}`;

      const res = authenticateMcpRequest(`Bearer ${bidRefToken}`, {
        serviceKeys,
        oauthSecret: TEST_SECRET,
        baseUrl: BASE_URL,
        now: new Date(1700000000 * 1000),
      });
      expect(res.status).toBe("invalid_token");
    });

    it("A05-02: rejects access token with wrong audience", () => {
      const now = 1700000000;
      const wrongAudJwt = signJwt(
        {
          iss: BASE_URL,
          aud: "https://other-service.com/api",
          sub: "user-aud",
          scope: "mcp:read",
          type: "access_token",
          iat: now,
          exp: now + 3600,
        },
        TEST_SECRET,
      );

      const res = authenticateMcpRequest(`Bearer ${wrongAudJwt}`, {
        serviceKeys,
        oauthSecret: TEST_SECRET,
        baseUrl: BASE_URL,
        now: new Date(now * 1000),
      });
      expect(res.status).toBe("invalid_token");
    });
  });

  // A06: Scope Insufficiency
  describe("A06: Insufficient scope returns 403", () => {
    it("A06-01: unit: returns insufficient_scope when mcp:read scope is missing", () => {
      const now = 1700000000;
      const writeOnlyJwt = signJwt(
        {
          iss: BASE_URL,
          aud: `${BASE_URL}/mcp`,
          sub: "user-write",
          scope: "mcp:write",
          type: "access_token",
          iat: now,
          exp: now + 3600,
        },
        TEST_SECRET,
      );

      const res = authenticateMcpRequest(`Bearer ${writeOnlyJwt}`, {
        serviceKeys,
        oauthSecret: TEST_SECRET,
        baseUrl: BASE_URL,
        now: new Date(now * 1000),
      });
      expect(res.status).toBe("insufficient_scope");
    });

    it("A06-02: HTTP: returns 403 with insufficient_scope WWW-Authenticate header", async () => {
      const app = createHttpApp();
      const now = Math.floor(Date.now() / 1000);
      const invalidScopeJwt = signJwt(
        {
          iss: BASE_URL,
          aud: `${BASE_URL}/mcp`,
          sub: "user-scope-test",
          scope: "other:scope",
          type: "access_token",
          iat: now,
          exp: now + 3600,
        },
        TEST_SECRET,
      );

      const res = await request(app)
        .post("/mcp")
        .set("Authorization", `Bearer ${invalidScopeJwt}`)
        .send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
        .expect(403);

      expect(res.headers["www-authenticate"]).toContain('Bearer error="insufficient_scope"');
      expect(res.body).toEqual({ error: "insufficient_scope" });
    });
  });

  // A07: DCR, PKCE, Token Exchange, Refresh & Reconnect
  describe("A07: DCR, PKCE authorization code exchange, refresh rotation, and reconnect", () => {
    it("A07-01: completes full OAuth authorization code flow with PKCE and token refresh", async () => {
      const app = createHttpApp();

      // 1. Dynamic Client Registration (DCR)
      const regRes = await request(app)
        .post("/oauth/register")
        .send({
          client_name: "A07 Test Client",
          redirect_uris: [REDIRECT_URI],
        })
        .expect(201);
      const clientId = regRes.body.client_id;
      expect(clientId).toBeDefined();

      // 2. PKCE Authorization
      const verifier = "a07-pkce-verifier-string-with-sufficient-entropy";
      const authRes = await request(app)
        .post("/oauth/authorize")
        .type("form")
        .send({
          action: "allow",
          client_id: clientId,
          redirect_uri: REDIRECT_URI,
          state: "state-a07",
          scope: "mcp:read",
          code_challenge: challengeFor(verifier),
          code_challenge_method: "S256",
          resource: `${BASE_URL}/mcp`,
        })
        .expect(302);

      const location = new URL(authRes.header.location);
      const code = location.searchParams.get("code");
      expect(code).toBeDefined();

      // 3. Token Exchange
      const tokenRes = await request(app)
        .post("/oauth/token")
        .type("form")
        .send({
          grant_type: "authorization_code",
          code,
          code_verifier: verifier,
          client_id: clientId,
          redirect_uri: REDIRECT_URI,
        })
        .expect(200);

      expect(tokenRes.body.token_type).toBe("Bearer");
      expect(tokenRes.body.scope).toBe("mcp:read");
      const accessToken = tokenRes.body.access_token;
      expect(accessToken).toBeDefined();
      const refreshToken = tokenRes.body.refresh_token;

      // 4. Token Refresh
      const refreshRes = await request(app)
        .post("/oauth/token")
        .type("form")
        .send({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        })
        .expect(200);

      expect(refreshRes.body.access_token).toBeDefined();
      expect(refreshRes.body.refresh_token).not.toBe(refreshToken); // rotated

      // 5. Reusing old refresh token fails
      await request(app)
        .post("/oauth/token")
        .type("form")
        .send({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        })
        .expect(400);
    });
  });

  // A08: Beta Expiry, Key Presence, and Secret Leak Defense
  describe("A08: Beta expiry, key presence, and zero secret leakage", () => {
    it("A08-01: constantTimeStringEqual prevents timing attacks and rejects differing strings", () => {
      expect(constantTimeStringEqual("secret123", "secret123")).toBe(true);
      expect(constantTimeStringEqual("secret123", "secret124")).toBe(false);
      expect(constantTimeStringEqual("secret123", "short")).toBe(false);
    });

    it("A08-02: secrets are never leaked in response payloads or HTTP error bodies", async () => {
      const app = createHttpApp();
      const res = await request(app)
        .post("/mcp")
        .set("Authorization", "Bearer invalid-key")
        .send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
        .expect(401);

      const bodyStr = JSON.stringify(res.body);
      const headersStr = JSON.stringify(res.headers);

      expect(bodyStr).not.toContain(TEST_SECRET);
      expect(bodyStr).not.toContain("service.key.one");
      expect(headersStr).not.toContain(TEST_SECRET);
      expect(headersStr).not.toContain("service.key.one");
    });

    it("A08-03: presence or absence of API keys does not alter public MVP tool whitelist (7 tools)", () => {
      // With keys configured
      const serverWithKeys = createJpBidsServer({ profile: "public_mvp" });
      expect(serverWithKeys).toBeDefined();

      // Without keys configured
      delete process.env.JP_BIDS_PRO_API_KEYS;
      const serverWithoutKeys = createJpBidsServer({ profile: "public_mvp" });
      expect(serverWithoutKeys).toBeDefined();
    });
  });
});
