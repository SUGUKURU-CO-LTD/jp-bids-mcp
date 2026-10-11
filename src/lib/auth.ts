// API Key認証とFree/Proティア判定
// API key authentication and Free/Pro tier detection
// Autentikasi API Key dan deteksi tier Free/Pro

export type Tier = "free" | "pro";

// ベータ期間: この日付まで全ユーザーをProとして扱う（無料開放キャンペーン）
// この定数が唯一の期日定義。README・landing page・検証スクリプトはこの値に合わせる。
// Beta period: treat all users as Pro until this date (free promotion)
// This constant is the single source of truth. README, landing page, and
// verification scripts must follow it.
// Periode beta: perlakukan semua pengguna sebagai Pro hingga tanggal ini (promosi gratis)
// Konstanta ini adalah satu-satunya sumber kebenaran untuk tanggal tersebut.
export const BETA_UNTIL = new Date("2026-10-01T00:00:00+09:00");

/**
 * 現在ベータ期間中かどうかを返す
 * Returns whether the current date is within the beta period
 * Mengembalikan apakah tanggal saat ini berada dalam periode beta
 */
export function isInBetaPeriod(now: Date = new Date()): boolean {
  return now < BETA_UNTIL;
}

/**
 * JP_BIDS_PRO_API_KEYS 環境変数からProキーセットを解析する
 * Parse Pro API key set from JP_BIDS_PRO_API_KEYS environment variable
 * Mengurai kumpulan kunci Pro dari variabel lingkungan JP_BIDS_PRO_API_KEYS
 *
 * @param value - カンマ区切りのAPIキー文字列 / Comma-separated API key string / String kunci API dipisahkan koma
 */
export function parseProApiKeys(value: string | undefined): ReadonlySet<string> {
  if (!value) return new Set();
  return new Set(
    value
      .split(",")
      .map((k) => k.trim())
      .filter((k) => k.length > 0),
  );
}

/**
 * Authorization ヘッダーからAPIキーを抽出し、ティアを判定する
 * Extract API key from Authorization header and determine tier
 * Mengekstrak kunci API dari header Authorization dan menentukan tier
 *
 * @param authHeader - Authorization ヘッダー値 / Authorization header value / Nilai header Authorization
 * @param proKeys - Proキーセット / Pro key set / Kumpulan kunci Pro
 */
export function parseTier(
  authHeader: string | undefined,
  proKeys: ReadonlySet<string>,
  now: Date = new Date(),
): Tier {
  // ベータ期間中は全リクエストをProとして扱う
  // During beta period, treat all requests as Pro
  // Selama periode beta, perlakukan semua permintaan sebagai Pro
  if (isInBetaPeriod(now)) return "pro";

  if (proKeys.size === 0) {
    // キーが設定されていなければ全リクエストをProとして扱う（開発・テスト用）
    // If no keys are configured, treat all requests as Pro (for development/testing)
    // Jika tidak ada kunci yang dikonfigurasi, perlakukan semua permintaan sebagai Pro (untuk pengembangan/pengujian)
    return "pro";
  }
  if (!authHeader) return "free";
  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  if (!match?.[1]) return "free";
  const key = match[1].trim();
  return proKeys.has(key) ? "pro" : "free";
}
