import { getTodayUTC7 } from '@/lib/dateUtils';

/** Normalize reservation tanggal to YYYY-MM-DD without timezone shift. */
export function normalizeTanggalToYmd(v: string | Date | null | undefined): string {
  if (v == null) return '';
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(v).trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (s.includes('T')) return s.slice(0, 10);
  const match = s.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? match[0] : s.slice(0, 10);
}

export function isReservationToday(
  tanggal: string | Date | null | undefined,
  todayYmd: string = getTodayUTC7()
): boolean {
  const ymd = normalizeTanggalToYmd(tanggal);
  return ymd.length === 10 && ymd === todayYmd;
}

export function isReservationFuture(
  tanggal: string | Date | null | undefined,
  todayYmd: string = getTodayUTC7()
): boolean {
  const ymd = normalizeTanggalToYmd(tanggal);
  return ymd.length === 10 && ymd > todayYmd;
}

export function isReservationPast(
  tanggal: string | Date | null | undefined,
  todayYmd: string = getTodayUTC7()
): boolean {
  const ymd = normalizeTanggalToYmd(tanggal);
  return ymd.length === 10 && ymd < todayYmd;
}

/** Hari-H or terlambat: boleh kirim menu ke kasir. */
export function canSendReservationToKasir(
  tanggal: string | Date | null | undefined,
  todayYmd: string = getTodayUTC7()
): boolean {
  const ymd = normalizeTanggalToYmd(tanggal);
  if (ymd.length !== 10) return true;
  return ymd <= todayYmd;
}
