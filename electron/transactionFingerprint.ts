/**
 * Transaction fingerprint for Smart Sync diff (local vs salespulse.cc).
 * Must stay in sync with salespulse GET /api/transactions/fingerprint.
 */

export type TransactionFingerprintRow = {
  uuid_id: string;
  status: string;
  total_amount: number;
  final_amount: number;
  refund_total: number;
  refund_status: string;
  item_count: number;
  cancelled_item_count: number;
  total_items_count: number;
  active_total: number;
  finished_item_count: number;
  package_lines_finished_count: number;
  refund_from_table?: number;
  p1_receipt: number | null;
  p2_receipt: number | null;
};

export type TransactionFingerprint = {
  uuid_id: string;
  fp: string;
};

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function buildTransactionFingerprintFromRow(r: TransactionFingerprintRow): TransactionFingerprint {
  const refundTotal = Math.max(
    Number(r.refund_total) || 0,
    Number(r.refund_from_table) || 0
  );
  const finalAmount = Number(r.final_amount) || 0;
  const refundStatus =
    refundTotal > 0
      ? refundTotal >= finalAmount - 0.01
        ? 'full'
        : 'partial'
      : r.refund_status || 'none';
  const normalizedStatus =
    r.status === 'completed' || r.status === 'paid' ? 'paid' : r.status || 'paid';

  const fp = [
    normalizedStatus,
    roundMoney(Number(r.total_amount) || 0),
    roundMoney(Number(r.final_amount) || 0),
    Number(r.item_count) || 0,
    Number(r.cancelled_item_count) || 0,
    Number(r.total_items_count) || 0,
    roundMoney(Number(r.active_total) || 0),
    Number(r.finished_item_count) || 0,
    Number(r.package_lines_finished_count) || 0,
    roundMoney(refundTotal),
    refundStatus,
    Number(r.p1_receipt) || 0,
    Number(r.p2_receipt) || 0,
  ].join('|');

  return { uuid_id: r.uuid_id, fp };
}
