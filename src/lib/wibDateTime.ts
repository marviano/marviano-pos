/**
 * Format timestamps as WIB (UTC+7) MySQL DATETIME strings for reservation module + sync.
 * Naive `YYYY-MM-DD HH:MM:SS` strings from local DB are assumed already WIB.
 */

const MYSQL_DT_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

export function formatDateTimeForWib(
  date: Date | string | number | null | undefined
): string | null {
  if (date === null || date === undefined) return null;

  if (typeof date === 'string') {
    const s = date.trim();
    if (!s) return null;
    if (MYSQL_DT_RE.test(s)) return s;
    const dotIdx = s.indexOf('.');
    if (dotIdx > 0 && MYSQL_DT_RE.test(s.slice(0, dotIdx))) {
      return s.slice(0, 19);
    }
  }

  let dateObj: Date;
  if (typeof date === 'number') {
    dateObj = new Date(date);
  } else if (typeof date === 'string') {
    dateObj = new Date(date);
  } else {
    dateObj = date;
  }

  if (Number.isNaN(dateObj.getTime())) return null;

  const utc7Timestamp = dateObj.getTime() + 7 * 60 * 60 * 1000;
  const utc7Date = new Date(utc7Timestamp);

  const year = utc7Date.getUTCFullYear();
  const month = String(utc7Date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(utc7Date.getUTCDate()).padStart(2, '0');
  const hours = String(utc7Date.getUTCHours()).padStart(2, '0');
  const minutes = String(utc7Date.getUTCMinutes()).padStart(2, '0');
  const seconds = String(utc7Date.getUTCSeconds()).padStart(2, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/** Current wall-clock time in WIB as MySQL DATETIME. */
export function wibNowSql(): string {
  return formatDateTimeForWib(new Date()) ?? '1970-01-01 00:00:00';
}

/** Calendar date YYYY-MM-DD in WIB for any stored timestamp. */
export function getCalendarDateYMDInWib(isoOrDate: string | Date): string {
  const formatted = formatDateTimeForWib(isoOrDate);
  if (!formatted) return '';
  return formatted.slice(0, 10);
}

/** Inclusive WIB day bounds as naive MySQL DATETIME strings (for date-picker filters). */
export function wibDayStartSql(ymd: string): string {
  const day = ymd.includes('T') ? ymd.slice(0, 10) : ymd;
  return `${day} 00:00:00`;
}

export function wibDayEndSql(ymd: string): string {
  const day = ymd.includes('T') ? ymd.slice(0, 10) : ymd;
  return `${day} 23:59:59`;
}

/** Add calendar days in WIB (ymd = YYYY-MM-DD). */
export function addWibCalendarDays(ymd: string, deltaDays: number): string {
  const day = ymd.includes('T') ? ymd.slice(0, 10) : ymd;
  const anchor = new Date(`${day}T12:00:00+07:00`).getTime() + deltaDays * 86_400_000;
  return getCalendarDateYMDInWib(new Date(anchor));
}

/** Date-picker / ISO input → naive WIB DATETIME for SQL range filters. */
export function wibFilterBoundSql(value: string | null | undefined, end = false): string | null {
  if (value == null || value === '') return null;
  const trimmed = value.trim();
  const day = trimmed.includes('T') ? trimmed.slice(0, 10) : trimmed;
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return end ? wibDayEndSql(day) : wibDayStartSql(day);
  }
  return formatDateTimeForWib(trimmed);
}

/** Epoch ms bounds for filtering `*_epoch` columns by WIB calendar days. */
export function wibDateRangeEpochBounds(
  fromDate?: string,
  toDate?: string
): { fromEpoch?: number; toEpoch?: number } {
  let fromEpoch: number | undefined;
  let toEpoch: number | undefined;
  if (fromDate) {
    const day = fromDate.includes('T') ? fromDate.slice(0, 10) : fromDate;
    fromEpoch = new Date(`${day}T00:00:00+07:00`).getTime();
  }
  if (toDate) {
    const day = toDate.includes('T') ? toDate.slice(0, 10) : toDate;
    toEpoch = new Date(`${day}T23:59:59.999+07:00`).getTime();
  }
  return { fromEpoch, toEpoch };
}

/** Parse WIB naive MySQL DATETIME or ISO/Z timestamps to epoch ms. */
export function parseWibTimestampToMs(value: string | null | undefined): number {
  if (!value || typeof value !== 'string') return NaN;
  const normalized = formatDateTimeForWib(value);
  if (!normalized) return NaN;
  const trimmed = value.trim();
  if (/[zZ]$/.test(trimmed) || /[+-]\d{2}:\d{2}$/.test(trimmed)) {
    return new Date(value).getTime();
  }
  return new Date(`${normalized.replace(' ', 'T')}+07:00`).getTime();
}

/** Format timestamp for KDS display clock (HH:MM) in WIB. */
export function formatWibTimeShort(value: string | null | undefined): string | null {
  const ms = parseWibTimestampToMs(value ?? null);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Jakarta',
  });
}
