import { randomBytes } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import cors from "cors";
import express, { type Request, type Response } from "express";
import { KkjClient } from "../api/kkj-client.js";
import { parseProApiKeys, parseTier } from "../lib/auth.js";
import { authenticateMcpRequest } from "../lib/authn.js";
import { parsePortEnv, parsePositiveNumberEnv } from "../lib/env.js";
import { parseAllowedOrigins, validateOrigin } from "../lib/http.js";
import {
  getActiveProfile,
  isProductionEnvironment,
  resolveServerProfile,
  type ServerProfile,
} from "../lib/profile.js";
import { VERSION } from "../lib/version.js";
import { createJpBidsServer } from "../mcp.js";
import { createOAuthRouterWithStore } from "../oauth/router.js";
import { createOAuthStoreFromEnv } from "../oauth/store.js";

const supportedProtocolVersions = new Set(["2025-11-25", "2026-07-28"]);

function readJsonRpcMethod(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return undefined;
  const method = (body as { method?: unknown }).method;
  return typeof method === "string" ? method : undefined;
}

function readJsonRpcName(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return undefined;
  const params = (body as { params?: unknown }).params;
  if (typeof params !== "object" || params === null || Array.isArray(params)) return undefined;
  const name = (params as { name?: unknown }).name;
  return typeof name === "string" ? name : undefined;
}

function validateRoutableMcpHeaders(req: Request, res: Response): boolean {
  const headerMethod = req.header("Mcp-Method");
  const headerName = req.header("Mcp-Name");
  if (!headerMethod && !headerName) return true;

  const bodyMethod = readJsonRpcMethod(req.body);
  const bodyName = readJsonRpcName(req.body);
  if (headerMethod && bodyMethod && headerMethod !== bodyMethod) {
    res.status(400).json({
      error: "Mcp-Method header does not match JSON-RPC method",
      header_method: headerMethod,
      body_method: bodyMethod,
    });
    return false;
  }
  if (headerName && bodyName && headerName !== bodyName) {
    res.status(400).json({
      error: "Mcp-Name header does not match JSON-RPC params.name",
      header_name: headerName,
      body_name: bodyName,
    });
    return false;
  }
  return true;
}

function resolveOAuthSecret(): string | undefined {
  const explicit = process.env.JP_BIDS_OAUTH_SECRET;
  if (explicit) return explicit;
  if (isProductionEnvironment()) {
    throw new Error(
      "JP_BIDS_OAUTH_SECRET is required in production. Refusing to start with an ephemeral OAuth signing key.",
    );
  }
  const generated = randomBytes(32).toString("hex");
  console.error("[info] JP_BIDS_OAUTH_SECRET is unset. Generated an ephemeral local-dev key.");
  return generated;
}

function assertProductionConfig(allowedOrigins: ReadonlySet<string>): void {
  if (!isProductionEnvironment()) return;

  if (!process.env.JP_BIDS_OAUTH_SECRET) {
    throw new Error(
      "JP_BIDS_OAUTH_SECRET is required in production. Refusing to start with an ephemeral OAuth signing key.",
    );
  }
  if (!process.env.JP_BIDS_BASE_URL) {
    throw new Error("JP_BIDS_BASE_URL is required in production.");
  }
  if (allowedOrigins.size === 0) {
    throw new Error(
      "ALLOWED_ORIGINS is required in production. Refusing to expose /mcp to all browser origins.",
    );
  }
  if (!process.env.JP_BIDS_PDF_ALLOWED_HOSTS) {
    throw new Error(
      "JP_BIDS_PDF_ALLOWED_HOSTS is required in production to avoid unrestricted document-fetch egress.",
    );
  }
}

function getBaseUrl(req: Request): string {
  if (process.env.JP_BIDS_BASE_URL) return process.env.JP_BIDS_BASE_URL;
  const proto = req.header("x-forwarded-proto") || req.protocol;
  const host = req.header("x-forwarded-host") || req.header("host") || "localhost:8080";
  return `${proto}://${host}`;
}

export function createHttpApp(): express.Express {
  const app = express();
  app.set("trust proxy", 1);
  const allowedOrigins = parseAllowedOrigins(process.env.ALLOWED_ORIGINS);
  assertProductionConfig(allowedOrigins);
  const proApiKeys = parseProApiKeys(process.env.JP_BIDS_PRO_API_KEYS);
  const oauthSecret = resolveOAuthSecret();
  const oauthStore = oauthSecret ? createOAuthStoreFromEnv() : undefined;
  const sharedKkjClient = new KkjClient({
    rateLimitPerSecond: parsePositiveNumberEnv(
      process.env.JP_BIDS_RATE_LIMIT_PER_SECOND ?? process.env.KOKO_CALL_RATE_LIMIT_PER_SECOND,
      1,
    ),
    timeoutMs: parsePositiveNumberEnv(process.env.JP_BIDS_KKJ_TIMEOUT_MS, 15_000),
    rememberRecentBids: false,
  });

  if (proApiKeys.size === 0 && process.env.K_SERVICE) {
    console.error(
      "[warning] JP_BIDS_PRO_API_KEYS is unset. All HTTP requests will be treated as Pro tier. Set this variable in production to enable Free/Pro tier separation.",
    );
  }

  app.use(express.json({ limit: "1mb" }));
  app.use(cors({ origin: allowedOrigins.size === 0 ? true : [...allowedOrigins] }));
  app.use(validateOrigin(allowedOrigins));

  if (oauthSecret) {
    app.use(createOAuthRouterWithStore(oauthSecret, oauthStore ?? createOAuthStoreFromEnv()));
  }

  app.use("/.well-known", express.static("public/.well-known"));

  // OpenAI ChatGPT Apps ドメイン所有確認用（提出フォームがトークンを発行した時だけ設定する）
  // OpenAI ChatGPT Apps domain ownership challenge (only set when the submission form issues a token)
  // Tantangan verifikasi domain OpenAI ChatGPT Apps (hanya diatur saat formulir submission menerbitkan token)
  app.get("/.well-known/openai-apps-challenge", (_req, res) => {
    const token = process.env.OPENAI_APPS_CHALLENGE_TOKEN;
    if (!token) {
      res.status(404).type("text/plain").send("not configured");
      return;
    }
    res.status(200).type("text/plain").send(token);
  });

  app.get("/ogp.png", (_req, res) => {
    res.sendFile("ogp.png", { root: "public" });
  });

  app.get("/favicon.ico", (_req, res) => {
    res.sendFile("favicon.ico", { root: "public" });
  });

  app.get("/favicon.png", (_req, res) => {
    res.sendFile("favicon.png", { root: "public" });
  });

  app.get("/privacy", (_req, res) => {
    res.sendFile("privacy.html", { root: "public" });
  });

  app.get("/terms", (_req, res) => {
    res.sendFile("terms.html", { root: "public" });
  });

  app.get("/robots.txt", (_req, res) => {
    res.type("text/plain").sendFile("robots.txt", { root: "public" });
  });

  app.get("/llms.txt", (_req, res) => {
    res.type("text/markdown; charset=utf-8").sendFile("llms.txt", { root: "public" });
  });

  app.get("/llms-full.txt", (_req, res) => {
    res.type("text/markdown; charset=utf-8").sendFile("llms-full.txt", { root: "public" });
  });

  app.get("/", (_req, res) => {
    res.sendFile("index.html", { root: "public" });
  });

  app.get("/health", (_req, res) => {
    res.status(200).json({ ok: true, service: "JP Bids MCP" });
  });

  // 利用統計: 運用者が疎通と負荷傾向を確認するエンドポイント
  // Usage stats: endpoint for operators to verify service health and traffic trends
  // Statistik penggunaan: endpoint bagi operator untuk memverifikasi kesehatan layanan dan tren trafik
  let requestCount = 0;
  const startedAt = new Date().toISOString();
  app.use("/mcp", (_req, _res, next) => {
    requestCount++;
    next();
  });
  app.get("/stats", (_req, res) => {
    res.status(200).json({
      service: "JP Bids MCP",
      version: VERSION,
      startedAt,
      uptimeSeconds: Math.floor(process.uptime()),
      mcpRequestCount: requestCount,
      nodeVersion: process.version,
    });
  });

  app.get("/readyz", (_req, res) => {
    res.status(200).json({ ok: true, service: "JP Bids MCP" });
  });

  app.get("/mcp", (_req, res) => {
    res.status(405).json({ error: "SSE GET is not enabled for this stateless server" });
  });

  app.post("/mcp", async (req, res) => {
    const protocolVersion = req.header("MCP-Protocol-Version");
    if (protocolVersion && !supportedProtocolVersions.has(protocolVersion)) {
      res.status(400).json({
        error: "Unsupported MCP protocol version",
        supported: [...supportedProtocolVersions],
      });
      return;
    }
    if (!validateRoutableMcpHeaders(req, res)) return;

    // OAuth有効時: Bearerトークンがなければ401を返してOAuthフローを起動する
    // When OAuth is enabled: return 401 without Bearer token to trigger OAuth flow
    // Saat OAuth aktif: kembalikan 401 tanpa Bearer token untuk memulai alur OAuth
    const authHeader = req.header("Authorization");
    const base = getBaseUrl(req);

    if (oauthSecret && !authHeader) {
      res
        .status(401)
        .set(
          "WWW-Authenticate",
          `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`,
        )
        .json({ error: "unauthorized" });
      return;
    }

    const authResult = authenticateMcpRequest(authHeader, {
      serviceKeys: proApiKeys,
      oauthSecret,
      baseUrl: base,
    });

    if (authResult.status === "missing_header") {
      res
        .status(401)
        .set(
          "WWW-Authenticate",
          `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`,
        )
        .json({ error: "unauthorized" });
      return;
    }

    if (authResult.status === "invalid_token" || authResult.status === "invalid_format") {
      res
        .status(401)
        .set(
          "WWW-Authenticate",
          'Bearer error="invalid_token", error_description="The access token is invalid or expired"',
        )
        .json({ error: "invalid_token" });
      return;
    }

    if (authResult.status === "insufficient_scope") {
      res
        .status(403)
        .set("WWW-Authenticate", 'Bearer error="insufficient_scope", scope="mcp:read"')
        .json({ error: "insufficient_scope" });
      return;
    }

    const isOAuthAuthenticated = authResult.subject.kind === "oauth_user";
    const tier = isOAuthAuthenticated
      ? parseOAuthTier(proApiKeys)
      : parseTier(authHeader, proApiKeys);

    const resolvedProfile = resolveServerProfile();
    const activeProfile: ServerProfile =
      resolvedProfile === "public_mvp"
        ? "public_mvp"
        : tier === "free"
          ? "public_mvp"
          : "full_local";
    const server = createJpBidsServer({
      kkjClient: sharedKkjClient,
      profile: activeProfile,
      tier,
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    } as unknown as ConstructorParameters<typeof StreamableHTTPServerTransport>[0]);
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport as Transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error(error);
      if (!res.headersSent) {
        res.status(500).json({ error: "MCP request failed" });
      }
    }
  });

  return app;
}

function parseOAuthTier(proApiKeys: ReadonlySet<string>): "free" | "pro" {
  // ベータ期間中はOAuth利用者にもPro相当の公開ベータ体験を提供する
  // During beta, OAuth users receive the public Pro-equivalent beta experience
  // Selama beta, pengguna OAuth mendapat pengalaman beta setara Pro
  return parseTier(undefined, proApiKeys);
}

export async function startHttpServer(): Promise<void> {
  const app = createHttpApp();
  const port = parsePortEnv(process.env.PORT, 8080);
  const profile = getActiveProfile();
  const host = process.env.HTTP_HOST ?? (process.env.K_SERVICE ? "0.0.0.0" : "127.0.0.1");

  if (profile === "full_local" && host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(`full_local profile must bind strictly to 127.0.0.1. Requested host: ${host}`);
  }
  const allowedOrigins = parseAllowedOrigins(process.env.ALLOWED_ORIGINS);

  if (allowedOrigins.size === 0) {
    if (process.env.K_SERVICE) {
      console.error(
        "[warning] ALLOWED_ORIGINS is unset. Browser requests from any Origin can reach this MCP endpoint. Set ALLOWED_ORIGINS to a comma-separated allowlist before exposing publicly.",
      );
    } else {
      console.error(
        "[info] ALLOWED_ORIGINS is unset. Local development allows any Origin. Set ALLOWED_ORIGINS for staging or production.",
      );
    }
  }

  app.listen(port, host, () => {
    console.error(`JP Bids MCP listening on http://${host}:${port}/mcp`);
  });
}
