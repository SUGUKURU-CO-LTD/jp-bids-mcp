// 完全無料 Public MVP 用の課金無効化モジュール（Stripe 依存完全除去）
// Billing disabled module for free Public MVP (Stripe dependency completely removed)
// Modul penonaktifan penagihan untuk Public MVP gratis (ketergantungan Stripe dihapus sepenuhnya)

/**
 * PDF抽出時の課金イベント記録（Public MVP では完全に非活性・no-op）
 * PDF extraction usage billing record (completely disabled / no-op in Public MVP)
 *
 * @param _stripeCustomerId - 互換性維持のためのパラメータ（未使用）
 */
export async function recordPdfExtractionUsage(_stripeCustomerId?: string): Promise<void> {
  // Public MVP は完全無料のため、課金イベントは送信しない
  // Free Public MVP does not transmit billing events
}

/**
 * 課金機能が有効か確認する（Public MVP では常に false）
 * Check if billing is enabled (always false in Public MVP)
 */
export function isBillingEnabled(): boolean {
  return false;
}
