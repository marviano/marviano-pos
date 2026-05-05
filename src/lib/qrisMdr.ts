/** QR/QRIS MDR (merchant discount rate) helpers — gross sale unchanged; fee & net stored separately. */

export const DEFAULT_QRIS_MDR_RATE_PERCENT = 0.7;

/** Max allowed MDR percent for sanity checks (configurable UI). */
export const MAX_QRIS_MDR_RATE_PERCENT = 25;

export function isQrisMdrPaymentMethod(paymentMethod: string | null | undefined): boolean {
  const m = String(paymentMethod ?? '')
    .trim()
    .toLowerCase();
  return m === 'qr' || m === 'qris';
}

/**
 * Parse stored setting (local_settings string). Accepts "0.7", "0,7", " 1 ".
 * Returns DEFAULT when empty/invalid.
 */
export function parseQrisMdrRatePercent(raw: string | null | undefined): number {
  if (raw == null || raw === '') return DEFAULT_QRIS_MDR_RATE_PERCENT;
  const n = Number(String(raw).trim().replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return DEFAULT_QRIS_MDR_RATE_PERCENT;
  return Math.min(MAX_QRIS_MDR_RATE_PERCENT, n);
}

export function roundMoney2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type QrisMdrBreakdown = {
  /** Rate copied at transaction time (percent points, e.g. 0.7 means 0.7%). */
  ratePercentSnapshot: number;
  mdrAmount: number;
  netAfterMdr: number;
};

/**
 * @param grossAmount — customer-paid total (`final_amount`), before MDR.
 * @param ratePercent — percentage points (0.7 = 0.7%).
 */
export function computeQrisMdrBreakdown(grossAmount: number, ratePercent: number): QrisMdrBreakdown {
  const gross = Number(grossAmount);
  if (!Number.isFinite(gross) || gross <= 0) {
    return { ratePercentSnapshot: roundMoney2(ratePercent), mdrAmount: 0, netAfterMdr: 0 };
  }
  const rate = Number(ratePercent);
  const safeRate = Number.isFinite(rate) && rate > 0 ? Math.min(MAX_QRIS_MDR_RATE_PERCENT, rate) : 0;
  const mdrRaw = (gross * safeRate) / 100;
  const mdrAmount = roundMoney2(mdrRaw);
  const netAfterMdr = roundMoney2(gross - mdrAmount);
  return {
    ratePercentSnapshot: roundMoney2(safeRate),
    mdrAmount,
    netAfterMdr: netAfterMdr < 0 ? 0 : netAfterMdr,
  };
}
