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
