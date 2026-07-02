/**
 * Line items that count toward omset (penjualan): not voided/cancelled.
 * Matches SQL filter SQL_ACTIVE_TX_ITEM in electron/main.ts.
 */
export function isActiveTransactionItem(item: {
  production_status?: string | null;
  cancelled_at?: string | null;
}): boolean {
  if (String(item.production_status ?? '').toLowerCase() === 'cancelled') return false;
  const ca = item.cancelled_at;
  if (ca != null && String(ca).trim() !== '') return false;
  return true;
}

/** SQL fragment for transaction_items (no table alias). */
export const SQL_ACTIVE_TX_ITEM =
  "(production_status IS NULL OR production_status != 'cancelled') AND cancelled_at IS NULL";

/** SQL fragment for transaction_items aliased as ti. */
export const SQL_ACTIVE_TX_ITEM_TI =
  "(ti.production_status IS NULL OR ti.production_status != 'cancelled') AND ti.cancelled_at IS NULL";
