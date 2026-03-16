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

/** Strip to digits only for DB/API (removes spaces, dots, dashes). Optionally cap at PHONE_MAX_DIGITS. */
export function stripPhoneForDb(phone: string, maxDigits?: number): string {
  const digits = (phone || '').replace(/\D/g, '');
  const max = maxDigits ?? PHONE_MAX_DIGITS;
  return digits.length > max ? digits.slice(0, max) : digits;
}

/**
 * Format phone for display: digits only, no separator (e.g. 082234662863).
 * Uses digits only from input; max 13 digits.
 */
export function formatPhoneDisplay(phone: string): string {
  return stripPhoneForDb(phone || '', PHONE_MAX_DIGITS);
}
