/**
 * Date utilities for WIB (Asia/Jakarta, UTC+7).
 * Prefer importing from @/lib/wibDateTime for new code.
 */

import { formatDateTimeForWib, getCalendarDateYMDInWib, wibNowSql } from './wibDateTime';

/** Today's calendar date in WIB (YYYY-MM-DD). */
export const getTodayUTC7 = (): string => {
  return getCalendarDateYMDInWib(new Date());
};

/** Epoch ms → WIB calendar date (YYYY-MM-DD). */
export const epochToUTC7Date = (epoch: number): string => {
  return getCalendarDateYMDInWib(new Date(epoch));
};

/** Date → WIB calendar date (YYYY-MM-DD). */
export const dateToUTC7String = (date: Date): string => {
  return getCalendarDateYMDInWib(date);
};

/** Current WIB wall-clock as MySQL DATETIME. */
export const getNowUTC7String = (): string => {
  return wibNowSql();
};

/** @deprecated use formatDateTimeForWib */
export { formatDateTimeForWib };
