// OAuth 2.0 JWT署名・検証ユーティリティ
// OAuth 2.0 JWT signing and verification utilities
// Utilitas tanda tangan dan verifikasi JWT OAuth 2.0

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export interface JwtPayload {
  [key: string]: unknown;
  iss?: string;
  sub?: string;
  aud?: string;
  exp?: number;
  iat?: number;
  jti?: string;
  scope?: string;
  type?: string;
}

export interface VerifyJwtOptions {
  expectedTyp?: string | undefined;
  now?: Date | undefined;
}

/**
 * HMAC-SHA256でJWTに署名する
 * Sign a JWT with HMAC-SHA256
 * Tanda tangani JWT dengan HMAC-SHA256
 */
export function signJwt(
  payload: JwtPayload,
  secret: string,
  expiresInSeconds: number = 3600,
  headerOverride?: { alg?: string; typ?: string },
): string {
  const header = { alg: "HS256", typ: "JWT", ...headerOverride };
  const now = Math.floor(Date.now() / 1000);
  const full: JwtPayload = {
    ...payload,
    iat: payload.iat ?? now,
    exp: payload.exp ?? now + expiresInSeconds,
    jti: payload.jti ?? randomBytes(16).toString("hex"),
  };
  const h = Buffer.from(JSON.stringify(header)).toString("base64url");
  const p = Buffer.from(JSON.stringify(full)).toString("base64url");
  const sig = createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url");
  return `${h}.${p}.${sig}`;
}

/**
 * JWTを検証してペイロードを返す（無効ならnull）
 * RFC 8725 BCPに準拠し、alg、typ、オブジェクト性、整数exp/iatを厳格に検証する
 */
export function verifyJwt(
  token: string,
  secret: string,
  options?: VerifyJwtOptions,
): JwtPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts as [string, string, string];

  // Signature verification (constant-time)
  const expected = Buffer.from(
    createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url"),
  );
  const actual = Buffer.from(s);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  try {
    // Header validation
    const header = JSON.parse(Buffer.from(h, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    if (typeof header !== "object" || header === null || Array.isArray(header)) return null;
    if (header.alg !== "HS256") return null;

    const expectedTyp = options?.expectedTyp ?? "JWT";
    if (header.typ !== expectedTyp) return null;

    // Payload validation
    const payload = JSON.parse(Buffer.from(p, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;

    const nowSec = Math.floor((options?.now ?? new Date()).getTime() / 1000);

    // exp validation: if present, must be integer > now
    if (payload.exp !== undefined) {
      if (
        typeof payload.exp !== "number" ||
        !Number.isInteger(payload.exp) ||
        payload.exp <= nowSec
      ) {
        return null;
      }
    }

    // iat validation: if present, must be integer <= now + 60s (clock skew allowance)
    if (payload.iat !== undefined) {
      if (
        typeof payload.iat !== "number" ||
        !Number.isInteger(payload.iat) ||
        payload.iat > nowSec + 60
      ) {
        return null;
      }
    }

    return payload as JwtPayload;
  } catch {
    return null;
  }
}

export interface AccessTokenClaims {
  iss: string;
  sub: string;
  aud: string;
  scope: string;
  type: "access_token";
  exp: number;
}

export type AccessTokenValidationResult =
  | { ok: true; claims: AccessTokenClaims }
  | { ok: false; reason: "invalid_claims" | "insufficient_scope" };

/**
 * MCP access tokenとして使えるJWT claimか検証する
 * Validates issuer, audience, sub, required type, and scope
 */
export function validateMcpAccessTokenClaimsDetailed(
  payload: JwtPayload,
  expected: { issuer: string; audience: string; requiredScope: string },
): AccessTokenValidationResult {
  if (payload.type !== "access_token") return { ok: false, reason: "invalid_claims" };
  if (payload.iss !== expected.issuer) return { ok: false, reason: "invalid_claims" };
  if (payload.aud !== expected.audience) return { ok: false, reason: "invalid_claims" };
  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    return { ok: false, reason: "invalid_claims" };
  }
  if (typeof payload.exp !== "number") return { ok: false, reason: "invalid_claims" };
  if (typeof payload.scope !== "string") return { ok: false, reason: "invalid_claims" };

  const scopes = new Set(payload.scope.split(/\s+/).filter((scope) => scope.length > 0));
  if (!scopes.has(expected.requiredScope)) {
    return { ok: false, reason: "insufficient_scope" };
  }

  return {
    ok: true,
    claims: {
      iss: payload.iss,
      sub: payload.sub,
      aud: payload.aud,
      scope: payload.scope,
      type: "access_token",
      exp: payload.exp,
    },
  };
}

/**
 * Backward-compatible helper returning AccessTokenClaims or null
 */
export function validateMcpAccessTokenClaims(
  payload: JwtPayload,
  expected: { issuer: string; audience: string; requiredScope: string },
): AccessTokenClaims | null {
  const result = validateMcpAccessTokenClaimsDetailed(payload, expected);
  return result.ok ? result.claims : null;
}

/**
 * PKCE S256を検証する
 * Verify PKCE S256 code_challenge against code_verifier
 * Verifikasi PKCE S256 code_challenge terhadap code_verifier
 */
export function verifyPkceS256(verifier: string, challenge: string): boolean {
  return createHash("sha256").update(verifier).digest("base64url") === challenge;
}

export function generateId(): string {
  return randomBytes(16).toString("hex");
}
