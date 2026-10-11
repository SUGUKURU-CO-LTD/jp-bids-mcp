// OAuth 2.0 エンドポイント（RFC 8414 / RFC 9728 / RFC 7591 / PKCE）
// OAuth 2.0 endpoints (RFC 8414 / RFC 9728 / RFC 7591 / PKCE)
// Endpoint OAuth 2.0 (RFC 8414 / RFC 9728 / RFC 7591 / PKCE)

import express, { type NextFunction, type Request, type Response, Router } from "express";
import { generateId, signJwt, verifyJwt, verifyPkceS256 } from "./jwt.js";
import { MemoryOAuthStore, type OAuthClientRecord, type OAuthStore } from "./store.js";

function getBaseUrl(req: Request): string {
  if (process.env.JP_BIDS_BASE_URL) return process.env.JP_BIDS_BASE_URL;
  const proto = req.header("x-forwarded-proto") || req.protocol;
  const host = req.header("x-forwarded-host") || req.header("host") || "localhost:8080";
  return `${proto}://${host}`;
}

function isValidRedirectUri(uri: string): boolean {
  try {
    const url = new URL(uri);
    if (url.protocol === "https:") return true;
    if ((url.hostname === "localhost" || url.hostname === "127.0.0.1") && url.protocol === "http:")
      return true;
    return false;
  } catch {
    return false;
  }
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function consentHtml(p: {
  clientId: string;
  clientName: string;
  redirectUri: string;
  state: string;
  scope: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  resource: string;
}): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Authorize — JP Bids</title>
<style>
body{font-family:system-ui,sans-serif;max-width:400px;margin:4rem auto;padding:0 1rem;color:#1a1a1a}
h1{font-size:1.3rem;margin-bottom:.3rem}.sub{color:#666;font-size:.85rem;margin-bottom:1.5rem}
.card{background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:1.2rem;margin:1rem 0}
.scope{display:inline-block;background:#dbeafe;color:#1d4ed8;padding:2px 8px;border-radius:4px;font-size:.85rem}
.actions{display:flex;gap:.5rem;margin-top:1.5rem}
button{padding:.6rem 1.4rem;border-radius:6px;border:1px solid #d1d5db;cursor:pointer;font-size:.95rem}
.allow{background:#2563eb;color:#fff;border:none}.allow:hover{background:#1d4ed8}
.deny{background:#fff}.deny:hover{background:#f3f4f6}
</style></head>
<body>
<h1>JP Bids</h1>
<p class="sub">日本の官公需入札検索 MCP サーバー</p>
<div class="card">
<p><strong>${esc(p.clientName)}</strong> が JP Bids へのアクセスを求めています。</p>
<p style="margin:.8rem 0 0"><span class="scope">${esc(p.scope)}</span></p>
<p style="color:#666;font-size:.85rem;margin-top:.8rem">入札情報への読み取り専用アクセスを許可します。個人情報は収集しません。<br>
Read-only access to Japanese government procurement bid data. No personal data is collected.</p>
</div>
<form method="POST" action="/oauth/authorize">
<input type="hidden" name="client_id" value="${esc(p.clientId)}">
<input type="hidden" name="redirect_uri" value="${esc(p.redirectUri)}">
<input type="hidden" name="state" value="${esc(p.state)}">
<input type="hidden" name="scope" value="${esc(p.scope)}">
<input type="hidden" name="code_challenge" value="${esc(p.codeChallenge)}">
<input type="hidden" name="code_challenge_method" value="${esc(p.codeChallengeMethod)}">
<input type="hidden" name="resource" value="${esc(p.resource)}">
<div class="actions">
<button type="submit" name="action" value="allow" class="allow">許可する / Allow</button>
<button type="submit" name="action" value="deny" class="deny">拒否 / Deny</button>
</div></form></body></html>`;
}

/**
 * OAuth 2.0ルーターを生成する
 * Create OAuth 2.0 Express router
 * Buat router Express OAuth 2.0
 */
export function createOAuthRouter(secret: string): Router {
  return createOAuthRouterWithStore(secret, new MemoryOAuthStore());
}

export function createOAuthRouterWithStore(secret: string, store: OAuthStore): Router {
  const router = Router();
  router.use("/oauth", oauthRateLimit(store));
  router.use("/oauth", express.urlencoded({ extended: false }));

  // --- Protected Resource Metadata (RFC 9728) ---
  const resourceMeta = (req: Request, res: Response) => {
    const base = getBaseUrl(req);
    res.json({
      resource: `${base}/mcp`,
      authorization_servers: [base],
      scopes_supported: ["mcp:read"],
      bearer_methods_supported: ["header"],
    });
  };
  router.get("/.well-known/oauth-protected-resource/mcp", resourceMeta);
  router.get("/.well-known/oauth-protected-resource", resourceMeta);

  // --- Authorization Server Metadata (RFC 8414) ---
  router.get("/.well-known/oauth-authorization-server", (req: Request, res: Response) => {
    const base = getBaseUrl(req);
    res.json({
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/oauth/token`,
      registration_endpoint: `${base}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["none"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: ["mcp:read"],
      client_id_metadata_document_supported: false,
    });
  });

  // --- Dynamic Client Registration (RFC 7591) ---
  router.post("/oauth/register", async (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const clientName = (body.client_name as string) || "MCP Client";
    const redirectUris = body.redirect_uris as string[] | undefined;

    if (clientName.length > 120) {
      res.status(400).json({
        error: "invalid_client_metadata",
        error_description: "client_name is too long",
      });
      return;
    }
    if (
      !redirectUris ||
      !Array.isArray(redirectUris) ||
      redirectUris.length === 0 ||
      redirectUris.length > 10
    ) {
      res
        .status(400)
        .json({ error: "invalid_client_metadata", error_description: "redirect_uris is required" });
      return;
    }
    for (const uri of redirectUris) {
      if (uri.length > 2048 || !isValidRedirectUri(uri)) {
        res.status(400).json({
          error: "invalid_redirect_uri",
          error_description: `Invalid redirect URI: ${uri}`,
        });
        return;
      }
    }

    const client = await store.registerClient({ clientName, redirectUris });
    res.status(201).json({
      client_id: client.clientId,
      client_name: client.clientName,
      redirect_uris: client.redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      client_id_issued_at: client.issuedAt,
      client_id_expires_at: client.expiresAt,
    });
  });

  // --- Authorization Endpoint ---
  router.get("/oauth/authorize", async (req: Request, res: Response) => {
    const q = req.query as Record<string, string>;
    const {
      client_id,
      redirect_uri,
      state,
      scope,
      code_challenge,
      code_challenge_method,
      response_type,
      resource,
    } = q;

    const base = getBaseUrl(req);
    const expectedResource = `${base}/mcp`;

    if (response_type !== "code") {
      res.status(400).json({ error: "unsupported_response_type" });
      return;
    }
    const client = await validateRegisteredClient(store, client_id, redirect_uri);
    if (!client) {
      res.status(400).json({ error: "invalid_client" });
      return;
    }
    if (!redirect_uri || !isValidRedirectUri(redirect_uri)) {
      res.status(400).json({ error: "invalid_request", error_description: "Invalid redirect_uri" });
      return;
    }
    if (!code_challenge || code_challenge_method !== "S256") {
      res
        .status(400)
        .json({ error: "invalid_request", error_description: "PKCE with S256 is required" });
      return;
    }
    if (!isAcceptedScope(scope) || (resource && resource !== expectedResource)) {
      res
        .status(400)
        .json({ error: "invalid_request", error_description: "Invalid scope or resource" });
      return;
    }

    res.type("html").send(
      consentHtml({
        clientId: client.clientId,
        clientName: client.clientName,
        redirectUri: redirect_uri,
        state: state || "",
        scope: scope || "mcp:read",
        codeChallenge: code_challenge,
        codeChallengeMethod: code_challenge_method,
        resource: resource || expectedResource,
      }),
    );
  });

  router.post("/oauth/authorize", async (req: Request, res: Response) => {
    const body = req.body as Record<string, string>;
    const {
      client_id,
      redirect_uri,
      state,
      scope,
      code_challenge,
      code_challenge_method,
      action,
      resource,
    } = body;

    const base = getBaseUrl(req);
    const expectedResource = `${base}/mcp`;
    const client = await validateRegisteredClient(store, client_id, redirect_uri);
    if (!client) {
      res.status(400).json({ error: "invalid_client" });
      return;
    }

    if (!redirect_uri || !isValidRedirectUri(redirect_uri)) {
      res.status(400).json({ error: "invalid_request" });
      return;
    }
    if (code_challenge_method !== "S256" || !code_challenge) {
      res.status(400).json({ error: "invalid_request" });
      return;
    }
    if (!isAcceptedScope(scope) || (resource && resource !== expectedResource)) {
      res.status(400).json({ error: "invalid_request" });
      return;
    }

    if (action === "deny") {
      const url = new URL(redirect_uri);
      url.searchParams.set("error", "access_denied");
      url.searchParams.set("iss", base);
      if (state) url.searchParams.set("state", state);
      res.redirect(url.toString());
      return;
    }

    const codeJti = generateId();
    await store.storeAuthorizationCode({
      jti: codeJti,
      clientId: client.clientId,
      redirectUri: redirect_uri,
      scope: scope || "mcp:read",
      resource: resource || expectedResource,
      codeChallenge: code_challenge,
      codeChallengeMethod: "S256",
      expiresAt: Math.floor(Date.now() / 1000) + 300,
      consumedAt: null,
    });
    const code = signJwt(
      {
        iss: base,
        aud: `${base}/oauth/token`,
        jti: codeJti,
        type: "authorization_code",
        client_id: client.clientId,
        redirect_uri: redirect_uri || "",
        scope: scope || "mcp:read",
        code_challenge: code_challenge || "",
        code_challenge_method: code_challenge_method || "S256",
        resource: resource || expectedResource,
      },
      secret,
      300,
    );

    const url = new URL(redirect_uri);
    url.searchParams.set("code", code);
    url.searchParams.set("iss", base);
    if (state) url.searchParams.set("state", state);
    res.redirect(url.toString());
  });

  // --- Token Endpoint ---
  router.post("/oauth/token", async (req: Request, res: Response) => {
    const body = req.body as Record<string, string>;
    const grantType = body.grant_type;

    if (grantType === "authorization_code") {
      await handleAuthCodeGrant(req, res, body, secret, store);
    } else if (grantType === "refresh_token") {
      await handleRefreshGrant(req, res, body, secret, store);
    } else {
      res.status(400).json({ error: "unsupported_grant_type" });
    }
  });

  return router;
}

function oauthRateLimit(store: OAuthStore) {
  const windowMs = parsePositiveInteger(process.env.JP_BIDS_OAUTH_RATE_LIMIT_WINDOW_MS, 60_000);
  const maxRequests = parsePositiveInteger(process.env.JP_BIDS_OAUTH_RATE_LIMIT_MAX, 60);
  return async (req: Request, res: Response, next: NextFunction) => {
    const allowed = await store.consumeRateLimit(`oauth:${req.ip}`, windowMs, maxRequests);
    if (!allowed) {
      res.status(429).json({ error: "rate_limited" });
      return;
    }
    next();
  };
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function handleAuthCodeGrant(
  req: Request,
  res: Response,
  body: Record<string, string>,
  secret: string,
  store: OAuthStore,
): Promise<void> {
  const { code, code_verifier, client_id, redirect_uri } = body;

  if (!code || !code_verifier) {
    res
      .status(400)
      .json({ error: "invalid_request", error_description: "code and code_verifier are required" });
    return Promise.resolve();
  }

  const payload = verifyJwt(code, secret);
  if (!payload || payload.type !== "authorization_code") {
    res
      .status(400)
      .json({ error: "invalid_grant", error_description: "Invalid or expired authorization code" });
    return Promise.resolve();
  }

  const jti = typeof payload.jti === "string" ? payload.jti : "";
  const storedCode = await store.consumeAuthorizationCode(jti);
  if (!storedCode) {
    res
      .status(400)
      .json({ error: "invalid_grant", error_description: "Authorization code is invalid or used" });
    return;
  }

  if (!verifyPkceS256(code_verifier, storedCode.codeChallenge)) {
    res.status(400).json({ error: "invalid_grant", error_description: "PKCE verification failed" });
    return;
  }

  if (redirect_uri && redirect_uri !== storedCode.redirectUri) {
    res.status(400).json({ error: "invalid_grant", error_description: "redirect_uri mismatch" });
    return;
  }
  if (client_id && client_id !== storedCode.clientId) {
    res.status(400).json({ error: "invalid_grant", error_description: "client_id mismatch" });
    return;
  }

  const base = getBaseUrl(req);
  if (payload.iss !== base || payload.aud !== `${base}/oauth/token`) {
    res
      .status(400)
      .json({ error: "invalid_grant", error_description: "issuer or audience mismatch" });
    return;
  }
  const sub = storedCode.clientId;
  const scope = storedCode.scope;
  const accessJti = generateId();
  const refreshJti = generateId();
  const refreshFamilyId = generateId();

  const accessToken = signJwt(
    {
      iss: base,
      sub,
      aud: storedCode.resource,
      scope,
      type: "access_token",
      jti: accessJti,
      resource: storedCode.resource,
    },
    secret,
    3600,
  );
  await store.storeRefreshToken({
    jti: refreshJti,
    familyId: refreshFamilyId,
    clientId: storedCode.clientId,
    subject: sub,
    scope,
    resource: storedCode.resource,
    expiresAt: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
    consumedAt: null,
  });
  const refreshToken = signJwt(
    {
      iss: base,
      sub,
      aud: storedCode.resource,
      scope,
      type: "refresh_token",
      jti: refreshJti,
      family_id: refreshFamilyId,
      resource: storedCode.resource,
    },
    secret,
    30 * 24 * 3600,
  );

  res.json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: 3600,
    refresh_token: refreshToken,
    scope,
  });
  return Promise.resolve();
}

async function handleRefreshGrant(
  req: Request,
  res: Response,
  body: Record<string, string>,
  secret: string,
  store: OAuthStore,
): Promise<void> {
  const { refresh_token } = body;

  if (!refresh_token) {
    res
      .status(400)
      .json({ error: "invalid_request", error_description: "refresh_token is required" });
    return Promise.resolve();
  }

  const payload = verifyJwt(refresh_token, secret);
  if (!payload || payload.type !== "refresh_token") {
    res
      .status(400)
      .json({ error: "invalid_grant", error_description: "Invalid or expired refresh token" });
    return Promise.resolve();
  }
  const base = getBaseUrl(req);
  if (payload.iss !== base || typeof payload.aud !== "string") {
    res
      .status(400)
      .json({ error: "invalid_grant", error_description: "issuer or audience mismatch" });
    return Promise.resolve();
  }
  const jti = typeof payload.jti === "string" ? payload.jti : "";
  const consumed = await store.consumeRefreshToken(jti);
  if (consumed.status !== "ok") {
    res.status(400).json({
      error: "invalid_grant",
      error_description:
        consumed.status === "reused"
          ? "Refresh token reuse detected"
          : "Invalid or expired refresh token",
    });
    return Promise.resolve();
  }

  const sub = consumed.record.subject;
  const scope = consumed.record.scope;
  const accessJti = generateId();
  const refreshJti = generateId();

  const accessToken = signJwt(
    {
      iss: base,
      sub,
      aud: consumed.record.resource,
      scope,
      type: "access_token",
      jti: accessJti,
      resource: consumed.record.resource,
    },
    secret,
    3600,
  );
  await store.storeRefreshToken({
    jti: refreshJti,
    familyId: consumed.record.familyId,
    clientId: consumed.record.clientId,
    subject: sub,
    scope,
    resource: consumed.record.resource,
    expiresAt: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
    consumedAt: null,
  });
  const newRefresh = signJwt(
    {
      iss: base,
      sub,
      aud: consumed.record.resource,
      scope,
      type: "refresh_token",
      jti: refreshJti,
      family_id: consumed.record.familyId,
      resource: consumed.record.resource,
    },
    secret,
    30 * 24 * 3600,
  );

  res.json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: 3600,
    refresh_token: newRefresh,
    scope,
  });
  return Promise.resolve();
}

async function validateRegisteredClient(
  store: OAuthStore,
  clientId: string | undefined,
  redirectUri: string | undefined,
): Promise<OAuthClientRecord | null> {
  if (!clientId || !redirectUri) return null;
  const client = await store.getClient(clientId);
  if (!client) return null;
  return client.redirectUris.includes(redirectUri) ? client : null;
}

function isAcceptedScope(scope: string | undefined): boolean {
  if (!scope) return true;
  const scopes = new Set(scope.split(/\s+/).filter((item) => item.length > 0));
  return scopes.size === 1 && scopes.has("mcp:read");
}
