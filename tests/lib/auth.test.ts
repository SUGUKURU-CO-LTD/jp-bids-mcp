// API Key認証ユニットテスト
// Unit tests for API key authentication
// Pengujian unit untuk autentikasi kunci API

import { describe, expect, it, vi } from "vitest";
import { BETA_UNTIL, isInBetaPeriod, parseProApiKeys, parseTier } from "../../src/lib/auth.js";

// 期日を直接書かずBETA_UNTILからの相対で組む。延長時にテストが腐らない。
// Derive fixtures from BETA_UNTIL instead of hardcoding dates, so extending
// the beta period does not rot these tests.
// Turunkan fixture dari BETA_UNTIL, bukan tanggal literal, agar tes tidak usang.
const DAY_MS = 24 * 60 * 60 * 1000;
const beforeBetaEnds = new Date(BETA_UNTIL.getTime() - DAY_MS);
const wellBeforeBetaEnds = new Date(BETA_UNTIL.getTime() - 60 * DAY_MS);
const afterBetaEnds = new Date(BETA_UNTIL.getTime() + 1000);
const wellAfterBetaEnds = new Date(BETA_UNTIL.getTime() + 180 * DAY_MS);

describe("parseProApiKeys", () => {
  it("空文字列 / empty string / string kosong → empty set", () => {
    expect(parseProApiKeys("")).toEqual(new Set());
    expect(parseProApiKeys(undefined)).toEqual(new Set());
  });

  it("カンマ区切りのキーをSetに変換 / comma-separated keys become Set / kunci dipisahkan koma menjadi Set", () => {
    const keys = parseProApiKeys("jp-bids_aaa,jp-bids_bbb, jp-bids_ccc ");
    expect(keys.has("jp-bids_aaa")).toBe(true);
    expect(keys.has("jp-bids_bbb")).toBe(true);
    expect(keys.has("jp-bids_ccc")).toBe(true);
    expect(keys.size).toBe(3);
  });
});

describe("isInBetaPeriod", () => {
  it("期日前はtrue / before the cutoff is beta / sebelum batas waktu adalah beta", () => {
    expect(isInBetaPeriod(beforeBetaEnds)).toBe(true);
    expect(isInBetaPeriod(wellBeforeBetaEnds)).toBe(true);
  });

  it("期日以降はfalse / from the cutoff onward is not beta / dari batas waktu bukan beta", () => {
    expect(isInBetaPeriod(BETA_UNTIL)).toBe(false);
    expect(isInBetaPeriod(afterBetaEnds)).toBe(false);
    expect(isInBetaPeriod(wellAfterBetaEnds)).toBe(false);
  });

  // 期日を過ぎたまま放置されるとREADMEやlanding pageの表記と乖離する
  // A lapsed cutoff silently contradicts the README and landing page copy
  // Batas waktu yang kedaluwarsa bertentangan dengan README dan landing page
  it("現在はベータ期間内 / the cutoff is still in the future / batas waktu masih di depan", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-01T00:00:00Z"));
    try {
      expect(isInBetaPeriod()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("parseTier", () => {
  const proKeys = new Set(["jp-bids_secret123"]);
  // ベータ期間後の日付でキー検証をテスト
  // Use post-beta date to test key-based auth logic
  // Gunakan tanggal pasca-beta untuk menguji logika autentikasi berbasis kunci
  const afterBeta = afterBetaEnds;

  it("ベータ期間中は全リクエストPro / all Pro during beta / semua Pro selama beta", () => {
    expect(parseTier(undefined, proKeys, beforeBetaEnds)).toBe("pro");
    expect(parseTier("Bearer jp-bids_wrongkey", proKeys, beforeBetaEnds)).toBe("pro");
  });

  it("キーが未設定なら全リクエストPro / no keys configured → all Pro / tidak ada kunci → semua Pro", () => {
    expect(parseTier(undefined, new Set(), afterBeta)).toBe("pro");
    expect(parseTier("Bearer jp-bids_anything", new Set(), afterBeta)).toBe("pro");
  });

  it("Authorizationヘッダーなし → Free / no Authorization header → Free / tidak ada header → Free", () => {
    expect(parseTier(undefined, proKeys, afterBeta)).toBe("free");
  });

  it("不正なヘッダー形式 → Free / malformed header → Free / header tidak valid → Free", () => {
    expect(parseTier("jp-bids_secret123", proKeys, afterBeta)).toBe("free");
    expect(parseTier("Token jp-bids_secret123", proKeys, afterBeta)).toBe("free");
  });

  it("正しいProキー → Pro / valid Pro key → Pro / kunci Pro valid → Pro", () => {
    expect(parseTier("Bearer jp-bids_secret123", proKeys, afterBeta)).toBe("pro");
    expect(parseTier("bearer jp-bids_secret123", proKeys, afterBeta)).toBe("pro");
    expect(parseTier("  Bearer jp-bids_secret123  ", proKeys, afterBeta)).toBe("pro");
  });

  it("存在しないキー → Free / unknown key → Free / kunci tidak dikenal → Free", () => {
    expect(parseTier("Bearer jp-bids_wrongkey", proKeys, afterBeta)).toBe("free");
  });
});
