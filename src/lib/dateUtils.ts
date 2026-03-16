/**
 * Date utilities for GMT+7 (Jakarta/Indonesia timezone)
 * All date operations in the app should use GMT+7 to match local business operations
 */

/**
 * Get today's date in GMT+7 timezone (YYYY-MM-DD format)
 * This ensures daily counters and date filters use local time, not UTC
 */
export const getTodayUTC7 = (): string => {
  const now = new Date();
  const utc7Time = new Date(now.getTime() + (7 * 60 * 60 * 1000));
  return utc7Time.toISOString().split('T')[0];
};

/**
 * Convert a timestamp (epoch milliseconds) to GMT+7 date string (YYYY-MM-DD format)
 * Used for extracting date from epoch timestamps in audit logs
 */
export const epochToUTC7Date = (epoch: number): string => {
  const date = new Date(epoch);
  const utc7Time = new Date(date.getTime() + (7 * 60 * 60 * 1000));
  return utc7Time.toISOString().split('T')[0];
};

/**
 * Convert a Date object to GMT+7 date string (YYYY-MM-DD format)
 */
export const dateToUTC7String = (date: Date): string => {
  const utc7Time = new Date(date.getTime() + (7 * 60 * 60 * 1000));
  return utc7Time.toISOString().split('T')[0];
};

/**
 * Get current date and time in GMT+7 (WIB) as "YYYY-MM-DD HH:mm:ss".
 * Use for activity log created_at and any display/storage that should be in local (Jakarta) time.
 */
export const getNowUTC7String = (): string => {
  const now = new Date();
  const utc7 = new Date(now.getTime() + (7 * 60 * 60 * 1000));
  const y = utc7.getUTCFullYear();
  const m = String(utc7.getUTCMonth() + 1).padStart(2, '0');
  const d = String(utc7.getUTCDate()).padStart(2, '0');
  const h = String(utc7.getUTCHours()).padStart(2, '0');
  const min = String(utc7.getUTCMinutes()).padStart(2, '0');
  const s = String(utc7.getUTCSeconds()).padStart(2, '0');
  return `${y}-${m}-${d} ${h}:${min}:${s}`;
};


























