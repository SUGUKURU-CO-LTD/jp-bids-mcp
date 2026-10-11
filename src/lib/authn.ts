// Authentication & Authorization for JP Bids MCP HTTP Transport
// Enforces strict constant-time API key matching, RFC 8725 JWT BCP validation, and scope verification.

import { timingSafeEqual } from "node:crypto";
import {
  type AccessTokenClaims,
  validateMcpAccessTokenClaimsDetailed,
  verifyJwt,
} from "../oauth/jwt.js";

export type AuthenticatedSubject =
  | { kind: "service_key"; token: string; scope: "mcp:read" }
  | { kind: "oauth_user"; claims: AccessTokenClaims };

export type AuthenticateResult =
  | { status: "ok"; subject: AuthenticatedSubject }
  | { status: "missing_header"; error: "unauthorized" }
  | { status: "invalid_format"; error: "invalid_token" }
  | { status: "invalid_token"; error: "invalid_token" }
  | { status: "insufficient_scope"; error: "insufficient_scope" };

/**
 * Parses comma-separated service API keys from JP_BIDS_PRO_API_KEYS.
 */
export function parseServiceApiKeys(value: string | undefined): ReadonlySet<string> {
  if (!value) return new Set();
  return new Set(
    value
      .split(",")
      .map((k) => k.trim())
      .filter((k) => k.length > 0),
  );
}

/**
 * Constant-time string equality check to prevent timing attacks.
 */
export function constantTimeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export interface AuthenticateOptions {
  serviceKeys: ReadonlySet<string>;
  oauthSecret?: string | undefined;
  baseUrl: string;
  now?: Date | undefined;
}

/**
 * Authenticates an incoming HTTP request for the /mcp endpoint.
 */
export function authenticateMcpRequest(
  authHeader: string | undefined,
  options: AuthenticateOptions,
): AuthenticateResult {
  if (!authHeader || authHeader.trim() === "") {
    return { status: "missing_header", error: "unauthorized" };
  }

  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  if (!match?.[1]) {
    return { status: "invalid_format", error: "invalid_token" };
  }
  const token = match[1].trim();

  // 1. Check against registered service keys using constant-time comparison
  if (options.serviceKeys.size > 0) {
    for (const configuredKey of options.serviceKeys) {
      if (constantTimeStringEqual(token, configuredKey)) {
        return {
          status: "ok",
          subject: { kind: "service_key", token, scope: "mcp:read" },
        };
      }
    }
  }

  // 2. Not a registered service key -> must be a valid OAuth Access Token JWT
  if (!options.oauthSecret) {
    return { status: "invalid_token", error: "invalid_token" };
  }

  const jwt = verifyJwt(token, options.oauthSecret, {
    expectedTyp: "JWT",
    now: options.now,
  });
  if (!jwt) {
    return { status: "invalid_token", error: "invalid_token" };
  }

  const validated = validateMcpAccessTokenClaimsDetailed(jwt, {
    issuer: options.baseUrl,
    audience: `${options.baseUrl}/mcp`,
    requiredScope: "mcp:read",
  });

  if (!validated.ok) {
    if (validated.reason === "insufficient_scope") {
      return { status: "insufficient_scope", error: "insufficient_scope" };
    }
    return { status: "invalid_token", error: "invalid_token" };
  }

  return {
    status: "ok",
    subject: { kind: "oauth_user", claims: validated.claims },
  };
}
