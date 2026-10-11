// Stripe Meters を使ったPDF抽出従量課金モジュール
// PDF extraction usage billing module using Stripe Meters
// Modul penagihan penggunaan ekstraksi PDF menggunakan Stripe Meters

import Stripe from "stripe";
import { VERSION } from "./version.js";

// Stripe Meter イベント名（Stripeダッシュボードで作成するMeterのAPI名に対応）
// Stripe Meter event name (matches the Meter API name created in Stripe dashboard)
// Nama acara Stripe Meter (sesuai dengan nama API Meter yang dibuat di dashboard Stripe)
const METER_EVENT_NAME = "jp_bids_pdf_extraction";

let stripeInstance: Stripe | null = null;

/**
 * Stripe クライアントをシングルトンで返す
 * Returns Stripe client as a singleton
 * Mengembalikan klien Stripe sebagai singleton
 */
function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (!stripeInstance) {
    stripeInstance = new Stripe(key, {
      apiVersion: "2026-04-22.dahlia",
      appInfo: {
        name: "JP Bids MCP",
        version: VERSION,
        url: "https://mcp.bid-jp.com",
      },
    });
  }
  return stripeInstance;
}

/**
 * PDF抽出1件分のStripe Meterイベントを送信する（fire-and-forget）
 * Send a Stripe Meter event for one PDF extraction (fire-and-forget)
 * Kirim acara Stripe Meter untuk satu ekstraksi PDF (fire-and-forget)
 *
 * @param stripeCustomerId - Stripe顧客ID（cus_xxxx）/ Stripe customer ID / ID pelanggan Stripe
 */
export async function recordPdfExtractionUsage(stripeCustomerId: string): Promise<void> {
  const stripe = getStripe();
  if (!stripe) {
    console.error("[billing] STRIPE_SECRET_KEY is not set. Skipping PDF extraction meter event.");
    return;
  }

  try {
    await stripe.v2.billing.meterEvents.create({
      event_name: METER_EVENT_NAME,
      payload: {
        stripe_customer_id: stripeCustomerId,
        value: "1",
      },
    });
  } catch (error) {
    // 課金ミスがツールの実行を妨げないよう、エラーはログのみ
    // Log errors only — billing failures must not block tool execution
    // Catat kesalahan saja — kegagalan penagihan tidak boleh memblokir eksekusi alat
    console.error("[billing] Failed to record PDF extraction meter event:", error);
  }
}

/**
 * STRIPE_SECRET_KEY が設定されているか確認する
 * Check if STRIPE_SECRET_KEY is configured
 * Periksa apakah STRIPE_SECRET_KEY dikonfigurasi
 */
export function isBillingEnabled(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}
