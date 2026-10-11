// OAuth共有状態ストア
// Shared OAuth state store
// Penyimpanan state OAuth bersama

import { createHash } from "node:crypto";
import { type DocumentData, Firestore, Timestamp } from "@google-cloud/firestore";
import { generateId } from "./jwt.js";

export interface OAuthClientRecord {
  clientId: string;
  clientName: string;
  redirectUris: string[];
  issuedAt: number;
  expiresAt: number;
}

export interface AuthorizationCodeRecord {
  jti: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  resource: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  expiresAt: number;
  consumedAt: number | null;
}

export interface RefreshTokenRecord {
  jti: string;
  familyId: string;
  clientId: string;
  subject: string;
  scope: string;
  resource: string;
  expiresAt: number;
  consumedAt: number | null;
}

export type RefreshConsumeResult =
  | { status: "ok"; record: RefreshTokenRecord }
  | { status: "missing" }
  | { status: "reused" }
  | { status: "compromised" };

export interface OAuthStore {
  registerClient(input: { clientName: string; redirectUris: string[] }): Promise<OAuthClientRecord>;
  getClient(clientId: string): Promise<OAuthClientRecord | null>;
  storeAuthorizationCode(record: AuthorizationCodeRecord): Promise<void>;
  consumeAuthorizationCode(jti: string): Promise<AuthorizationCodeRecord | null>;
  storeRefreshToken(record: RefreshTokenRecord): Promise<void>;
  consumeRefreshToken(jti: string): Promise<RefreshConsumeResult>;
  consumeRateLimit(key: string, windowMs: number, maxRequests: number): Promise<boolean>;
}

export class MemoryOAuthStore implements OAuthStore {
  private readonly clients = new Map<string, OAuthClientRecord>();
  private readonly authorizationCodes = new Map<string, AuthorizationCodeRecord>();
  private readonly refreshTokens = new Map<string, RefreshTokenRecord>();
  private readonly compromisedRefreshFamilies = new Set<string>();
  private readonly rateLimits = new Map<string, { count: number; resetAt: number }>();

  async registerClient(input: {
    clientName: string;
    redirectUris: string[];
  }): Promise<OAuthClientRecord> {
    const client: OAuthClientRecord = {
      clientId: generateId(),
      clientName: input.clientName,
      redirectUris: input.redirectUris,
      issuedAt: Math.floor(Date.now() / 1000),
      expiresAt: Math.floor(Date.now() / 1000) + 90 * 24 * 3600,
    };
    this.clients.set(client.clientId, client);
    return client;
  }

  async getClient(clientId: string): Promise<OAuthClientRecord | null> {
    const client = this.clients.get(clientId);
    if (!client) return null;
    if (client.expiresAt <= Math.floor(Date.now() / 1000)) return null;
    return client;
  }

  async storeAuthorizationCode(record: AuthorizationCodeRecord): Promise<void> {
    this.authorizationCodes.set(record.jti, record);
  }

  async consumeAuthorizationCode(jti: string): Promise<AuthorizationCodeRecord | null> {
    const record = this.authorizationCodes.get(jti);
    const now = Math.floor(Date.now() / 1000);
    if (!record || record.consumedAt !== null || record.expiresAt <= now) {
      return null;
    }
    const consumed = { ...record, consumedAt: now };
    this.authorizationCodes.set(jti, consumed);
    return record;
  }

  async storeRefreshToken(record: RefreshTokenRecord): Promise<void> {
    this.refreshTokens.set(record.jti, record);
  }

  async consumeRefreshToken(jti: string): Promise<RefreshConsumeResult> {
    const record = this.refreshTokens.get(jti);
    const now = Math.floor(Date.now() / 1000);
    if (!record || record.expiresAt <= now) {
      return { status: "missing" };
    }
    if (this.compromisedRefreshFamilies.has(record.familyId)) {
      return { status: "compromised" };
    }
    if (record.consumedAt !== null) {
      this.compromisedRefreshFamilies.add(record.familyId);
      return { status: "reused" };
    }
    this.refreshTokens.set(jti, { ...record, consumedAt: now });
    return { status: "ok", record };
  }

  async consumeRateLimit(key: string, windowMs: number, maxRequests: number): Promise<boolean> {
    const now = Date.now();
    const bucket = this.rateLimits.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.rateLimits.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    if (bucket.count >= maxRequests) {
      return false;
    }
    bucket.count += 1;
    return true;
  }
}

export class FirestoreOAuthStore implements OAuthStore {
  private readonly db: Firestore;
  private readonly prefix: string;

  constructor(options: { projectId?: string; prefix?: string } = {}) {
    this.db = new Firestore(options.projectId ? { projectId: options.projectId } : {});
    this.prefix = options.prefix ?? "jp_bids_oauth";
  }

  async registerClient(input: {
    clientName: string;
    redirectUris: string[];
  }): Promise<OAuthClientRecord> {
    const client: OAuthClientRecord = {
      clientId: generateId(),
      clientName: input.clientName,
      redirectUris: input.redirectUris,
      issuedAt: Math.floor(Date.now() / 1000),
      expiresAt: Math.floor(Date.now() / 1000) + 90 * 24 * 3600,
    };
    await this.collection("clients").doc(client.clientId).set(toFirestoreRecord(client));
    return client;
  }

  async getClient(clientId: string): Promise<OAuthClientRecord | null> {
    const snapshot = await this.collection("clients").doc(clientId).get();
    if (!snapshot.exists) return null;
    const client = fromFirestoreRecord(snapshot.data()) as unknown as OAuthClientRecord;
    if (client.expiresAt <= Math.floor(Date.now() / 1000)) return null;
    return client;
  }

  async storeAuthorizationCode(record: AuthorizationCodeRecord): Promise<void> {
    await this.collection("authorization_codes").doc(record.jti).set(toFirestoreRecord(record));
  }

  async consumeAuthorizationCode(jti: string): Promise<AuthorizationCodeRecord | null> {
    const ref = this.collection("authorization_codes").doc(jti);
    return this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return null;
      const record = fromFirestoreRecord(snapshot.data()) as unknown as AuthorizationCodeRecord;
      const now = Math.floor(Date.now() / 1000);
      if (record.consumedAt !== null || record.expiresAt <= now) return null;
      transaction.update(ref, { consumedAt: now });
      return record;
    });
  }

  async storeRefreshToken(record: RefreshTokenRecord): Promise<void> {
    await this.collection("refresh_tokens").doc(record.jti).set(toFirestoreRecord(record));
  }

  async consumeRefreshToken(jti: string): Promise<RefreshConsumeResult> {
    const tokenRef = this.collection("refresh_tokens").doc(jti);
    return this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(tokenRef);
      if (!snapshot.exists) return { status: "missing" };
      const record = fromFirestoreRecord(snapshot.data()) as unknown as RefreshTokenRecord;
      const now = Math.floor(Date.now() / 1000);
      if (record.expiresAt <= now) return { status: "missing" };

      const actualFamilyRef = this.collection("refresh_families").doc(record.familyId);
      const familySnapshot = await transaction.get(actualFamilyRef);
      if (familySnapshot.exists && familySnapshot.data()?.compromised === true) {
        return { status: "compromised" };
      }
      if (record.consumedAt !== null) {
        transaction.set(
          actualFamilyRef,
          { compromised: true, compromisedAt: now },
          { merge: true },
        );
        return { status: "reused" };
      }
      transaction.update(tokenRef, { consumedAt: now });
      transaction.set(actualFamilyRef, { compromised: false, lastUsedAt: now }, { merge: true });
      return { status: "ok", record };
    });
  }

  async consumeRateLimit(key: string, windowMs: number, maxRequests: number): Promise<boolean> {
    const hashedKey = createHash("sha256").update(key).digest("hex");
    const ref = this.collection("rate_limits").doc(hashedKey);
    return this.db.runTransaction(async (transaction) => {
      const now = Date.now();
      const snapshot = await transaction.get(ref);
      const data = snapshot.exists ? snapshot.data() : undefined;
      const count = typeof data?.count === "number" ? data.count : 0;
      const resetAt = typeof data?.resetAt === "number" ? data.resetAt : 0;
      if (!snapshot.exists || resetAt <= now) {
        transaction.set(ref, {
          count: 1,
          resetAt: now + windowMs,
          resetAtDate: Timestamp.fromMillis(now + windowMs),
        });
        return true;
      }
      if (count >= maxRequests) {
        return false;
      }
      transaction.update(ref, { count: count + 1 });
      return true;
    });
  }

  private collection(name: string) {
    return this.db.collection(`${this.prefix}_${name}`);
  }
}

export function createOAuthStoreFromEnv(): OAuthStore {
  const storeKind =
    process.env.JP_BIDS_OAUTH_STORE ?? (process.env.K_SERVICE ? "firestore" : "memory");
  if (storeKind === "memory") {
    if (process.env.K_SERVICE) {
      throw new Error("JP_BIDS_OAUTH_STORE=memory is not allowed in production.");
    }
    return new MemoryOAuthStore();
  }
  if (storeKind === "firestore") {
    const options: { projectId?: string; prefix?: string } = {};
    if (process.env.GOOGLE_CLOUD_PROJECT) options.projectId = process.env.GOOGLE_CLOUD_PROJECT;
    if (process.env.JP_BIDS_OAUTH_FIRESTORE_PREFIX) {
      options.prefix = process.env.JP_BIDS_OAUTH_FIRESTORE_PREFIX;
    }
    return new FirestoreOAuthStore(options);
  }
  throw new Error(`Unsupported JP_BIDS_OAUTH_STORE value: ${storeKind}`);
}

function toFirestoreRecord<T extends { expiresAt?: number }>(
  record: T,
): T & { expiresAtDate?: Timestamp } {
  return {
    ...record,
    ...(typeof record.expiresAt === "number"
      ? { expiresAtDate: Timestamp.fromMillis(record.expiresAt * 1000) }
      : {}),
  };
}

function fromFirestoreRecord(data: DocumentData | undefined): Record<string, unknown> {
  if (!data) return {};
  const { expiresAtDate: _expiresAtDate, ...record } = data;
  return record;
}
