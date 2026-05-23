/**
 * Format numbers with Indonesian style: 1.000.000 (dot as thousand separator).
 * When parsing from user input, strip . and - before saving to DB.
 */

/** Format number with dot as thousand separator (e.g. 1000000 -> "1.000.000"). */
export function formatNumberIndonesian(n: number): string {
  if (n == null || Number.isNaN(n)) return '0';
  const s = Math.round(n).toString();
  const parts: string[] = [];
  for (let i = s.length; i > 0; i -= 3) {
    parts.unshift(s.slice(Math.max(0, i - 3), i));
  }
  return parts.join('.');
}

/** Format as Rupiah with dot thousands: "Rp 1.000.000". */
export function formatRupiah(n: number): string {
  if (n == null || Number.isNaN(n)) return 'Rp\u00A00';
  return `Rp\u00A0${formatNumberIndonesian(n)}`;
}

/** Format number for display in inputs that accept typed values (e.g. "1.000.000"); decimals allowed. */
export function formatNumberForInput(n: number): string {
  if (n == null || Number.isNaN(n) || n === 0) return '';
  const fixed = Number(n);
  if (!Number.isFinite(fixed)) return '';
  const [intPart, decPart] = fixed.toString().split('.');
  const intFormatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return decPart != null ? `${intFormatted},${decPart}` : intFormatted;
}

/**
 * Parse user input (may contain 1.000.000 or 1,5) to number for DB.
 * Indonesian format: . = thousand separator, , = decimal. Always strip dots then use comma as decimal.
 * So "5.000" and "5.0000" (user typing 50000) both parse correctly.
 */
export function parseNumberInput(v: string | number | null | undefined): number {
  if (v == null) return 0;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const s = String(v).trim().replace(/\s/g, '');
  if (!s) return 0;
  const cleaned = s.replace(/\./g, '').replace(/,/g, '.');
  const n = parseFloat(cleaned);
  return Number.isNaN(n) ? 0 : n;
}

/** Max phone digits allowed (e.g. 0822xxxxxxxxx or 62xxxxxxxxxxx). */
export const PHONE_MAX_DIGITS = 13;

/** Strip to digits only (no country normalization). */
export function stripPhoneForDb(phone: string, maxDigits?: number): string {
  const digits = (phone || '').replace(/\D/g, '');
  const max = maxDigits ?? PHONE_MAX_DIGITS;
  return digits.length > max ? digits.slice(0, max) : digits;
}

/** Indonesian mobile: always store as 62 + 8–12 subscriber digits (no duplicate 62). */
export function normalizePhoneForDb(raw: string): string {
  let digits = (raw || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0')) return '62' + digits.slice(1);
  if (digits.startsWith('62')) return digits;
  return '62' + digits;
}

/** Merge country code field + national input without producing 6262…. */
export function combinePhoneParts(countryCode: string, nationalInput: string): string {
  const cc = (countryCode || '62').replace(/\D/g, '') || '62';
  let national = (nationalInput || '').replace(/\D/g, '');
  if (national.startsWith('0')) national = national.slice(1);
  if (national.startsWith('62')) return normalizePhoneForDb(national);
  if (cc === '62') return normalizePhoneForDb('62' + national);
  return normalizePhoneForDb(cc + national);
}

export function splitPhoneForInput(stored: string): { countryCode: string; national: string } {
  const normalized = normalizePhoneForDb(stored);
  if (normalized.startsWith('62') && normalized.length > 2) {
    return { countryCode: '62', national: normalized.slice(2) };
  }
  const digits = (stored || '').replace(/\D/g, '');
  if (digits.startsWith('0')) {
    return { countryCode: '62', national: digits.slice(1) };
  }
  return { countryCode: '62', national: digits };
}

export function isValidIndonesianPhone(normalized: string): boolean {
  return /^62\d{8,12}$/.test(normalized);
}

/**
 * Display as local 0-prefix (e.g. 6282234662863 → 082234662863).
 */
export function formatPhoneDisplay(phone: string): string {
  const normalized = normalizePhoneForDb(phone);
  if (!normalized) return '';
  if (normalized.startsWith('62') && normalized.length > 2) {
    return '0' + normalized.slice(2);
  }
  return normalized;
}
