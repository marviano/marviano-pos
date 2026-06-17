/** Metode pembayaran DP / refund reservasi (bukan metode kasir pelunasan). */
export const RESERVATION_MANUAL_PAYMENT_METHODS = [
  { value: 'cash', label: 'Tunai' },
  { value: 'qris', label: 'QRIS' },
  { value: 'transfer_bca', label: 'Transfer BCA' },
  { value: 'transfer_bni', label: 'Transfer BNI' },
  { value: 'transfer_mandiri', label: 'Transfer Mandiri' },
] as const;

export type ReservationManualPaymentMethod = (typeof RESERVATION_MANUAL_PAYMENT_METHODS)[number]['value'];

const MANUAL_LABEL_MAP = Object.fromEntries(
  RESERVATION_MANUAL_PAYMENT_METHODS.map((m) => [m.value, m.label])
) as Record<string, string>;

/** Label metode bayar — DP manual, refund, atau pelunasan kasir. */
export function formatReservationPaymentMethod(code: string | null | undefined): string {
  if (!code) return '-';
  const key = code.toLowerCase();
  if (MANUAL_LABEL_MAP[key]) return MANUAL_LABEL_MAP[key];
  const kasirMap: Record<string, string> = {
    cash: 'Tunai',
    qris: 'QRIS',
    qr: 'QRIS',
    debit: 'Debit',
    credit: 'Kredit',
    ewallet: 'E-Wallet',
    transfer: 'Transfer',
  };
  return kasirMap[key] ?? code;
}

export function isValidReservationManualPaymentMethod(v: string): boolean {
  return RESERVATION_MANUAL_PAYMENT_METHODS.some((m) => m.value === v);
}

export function financeEntryTypeLabel(
  paymentType: 'dp' | 'pelunasan' | 'refund' | 'refund_exc'
): string {
  switch (paymentType) {
    case 'dp':
      return 'DP masuk';
    case 'pelunasan':
      return 'Pelunasan';
    case 'refund':
      return 'Refund DP';
    case 'refund_exc':
      return 'Refund eksepsi';
    default:
      return paymentType;
  }
}
