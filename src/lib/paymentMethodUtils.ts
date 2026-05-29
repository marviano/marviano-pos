/** POS payment method codes (matches payment_methods table on VPS). */
export type PosPaymentMethodCode =
  | 'cash'
  | 'debit'
  | 'qr'
  | 'ewallet'
  | 'cl'
  | 'room_charge'
  | 'voucher'
  | 'qpon'
  | 'gofood'
  | 'grabfood'
  | 'shopeefood'
  | 'tiktok';

/** ID map: keep in sync with smartSync + salespulse transactions API. */
export const PAYMENT_METHOD_ID_TO_CODE: Record<number, PosPaymentMethodCode | string> = {
  1: 'cash',
  2: 'debit',
  3: 'qr',
  4: 'ewallet',
  5: 'cl',
  6: 'voucher',
  14: 'gofood',
  15: 'grabfood',
  16: 'shopeefood',
  17: 'tiktok',
  18: 'qpon',
  19: 'room_charge',
};

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  debit: 'Debit',
  qr: 'QR Code',
  ewallet: 'E-Wallet',
  cl: 'City Ledger',
  room_charge: 'Room Charge',
  voucher: 'Voucher',
  qpon: 'Qpon',
  gofood: 'GoFood',
  grabfood: 'GrabFood',
  shopeefood: 'ShopeeFood',
  tiktok: 'TikTok',
};

export const PAYMENT_METHOD_COLORS: Record<string, string> = {
  cash: 'bg-green-100 text-green-800',
  debit: 'bg-blue-100 text-blue-800',
  qr: 'bg-purple-100 text-purple-800',
  ewallet: 'bg-orange-100 text-orange-800',
  cl: 'bg-gray-100 text-gray-800',
  room_charge: 'bg-indigo-100 text-indigo-800',
  voucher: 'bg-yellow-100 text-yellow-800',
  qpon: 'bg-indigo-100 text-indigo-800',
  gofood: 'bg-teal-100 text-teal-800',
  grabfood: 'bg-green-100 text-green-800',
  shopeefood: 'bg-orange-100 text-orange-800',
  tiktok: 'bg-red-100 text-red-800',
};

/** No cash tender; host/customer name required (CL + Room Charge). */
export const DEFERRED_PAYMENT_METHODS = new Set<string>(['cl', 'room_charge']);

export function isDeferredPaymentMethod(code: string | null | undefined): boolean {
  return DEFERRED_PAYMENT_METHODS.has(String(code ?? '').toLowerCase());
}

export function getPaymentMethodLabel(code: string | null | undefined): string {
  const key = String(code ?? '').toLowerCase();
  return PAYMENT_METHOD_LABELS[key] || key || 'Unknown';
}

export function getPaymentMethodColor(code: string | null | undefined): string {
  const key = String(code ?? '').toLowerCase();
  return PAYMENT_METHOD_COLORS[key] || 'bg-gray-100 text-gray-800';
}
