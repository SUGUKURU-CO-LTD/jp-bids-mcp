export interface Branding {
  serviceName: string;
  serviceShortName: string;
  organizationName: string;
  serviceUrl: string;
  contactUrl: string;
  dataAttribution: string;
}

const DEFAULT_BRANDING: Branding = {
  serviceName: "JP Bids",
  serviceShortName: "JP Bids",
  organizationName: "Sugukuru Inc.",
  serviceUrl: "https://mcp.bid-jp.com",
  contactUrl: "https://sugu-kuru.co.jp",
  dataAttribution: "中小企業庁 官公需情報ポータルサイト（政府標準利用規約 第2.0版）",
};

let cachedBranding: Branding | null = null;

/**
 * 現在のブランド設定を返す。環境変数で上書き可能。
 * Returns current branding config. Overridable via environment variables.
 * Mengembalikan konfigurasi branding saat ini. Dapat ditimpa melalui variabel lingkungan.
 *
 * ENV vars:
 *   JP_BIDS_BRAND_NAME         — サービス名 (e.g. "MyBids Pro")
 *   JP_BIDS_BRAND_SHORT_NAME   — 短縮名 (e.g. "MyBids")
 *   JP_BIDS_BRAND_ORG          — 運営組織名
 *   JP_BIDS_BRAND_URL          — サービスURL
 *   JP_BIDS_BRAND_CONTACT      — 問い合わせ先
 *   JP_BIDS_BRAND_ATTRIBUTION  — データ出典表記
 */
export function getBranding(): Branding {
  if (cachedBranding) return cachedBranding;

  cachedBranding = {
    serviceName: process.env.JP_BIDS_BRAND_NAME ?? DEFAULT_BRANDING.serviceName,
    serviceShortName: process.env.JP_BIDS_BRAND_SHORT_NAME ?? DEFAULT_BRANDING.serviceShortName,
    organizationName: process.env.JP_BIDS_BRAND_ORG ?? DEFAULT_BRANDING.organizationName,
    serviceUrl: process.env.JP_BIDS_BRAND_URL ?? DEFAULT_BRANDING.serviceUrl,
    contactUrl: process.env.JP_BIDS_BRAND_CONTACT ?? DEFAULT_BRANDING.contactUrl,
    dataAttribution: process.env.JP_BIDS_BRAND_ATTRIBUTION ?? DEFAULT_BRANDING.dataAttribution,
  };

  if (process.env.JP_BIDS_BRAND_NAME) {
    console.error(`[info] White-label branding active: ${cachedBranding.serviceName}`);
  }

  return cachedBranding;
}

export function resetBrandingCache(): void {
  cachedBranding = null;
}
