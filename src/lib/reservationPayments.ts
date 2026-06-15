import type { ReservationRow } from '@/components/ReservationFormModal';
import { parseReservationItemsJson, computeTotalFromReservationItems } from '@/lib/reservationItems';

export type ReservationPaymentStatus = 'none' | 'dp_only' | 'paid';

function parseMoney(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(/\s/g, '').replace(/\./g, '').replace(/,/g, '.'));
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

export function getReservationOrderTotal(row: ReservationRow): number {
  const items = parseReservationItemsJson(row.items_json ?? null);
  if (items.length > 0) return computeTotalFromReservationItems(items);
  return parseMoney(row.total_price);
}

export function getReservationRecordedDp(row: ReservationRow): number {
  const recorded = (row as ReservationRow & { recorded_dp?: unknown }).recorded_dp;
  if (recorded != null) return parseMoney(recorded);
  const ps = (row.payment_status ?? 'none').toLowerCase();
  if (ps === 'dp_only' || ps === 'paid') return parseMoney(row.dp);
  return 0;
}

export function getReservationSisaBayar(row: ReservationRow): number {
  const total = getReservationOrderTotal(row);
  const recordedDp = getReservationRecordedDp(row);
  return Math.max(0, total - recordedDp);
}

export function isDpRecorded(row: ReservationRow): boolean {
  const ps = (row.payment_status ?? 'none').toLowerCase();
  return ps === 'dp_only' || ps === 'paid' || getReservationRecordedDp(row) > 0;
}

export function reservationPaymentStatusLabel(status: string | null | undefined): string {
  const s = (status ?? 'none').toLowerCase();
  if (s === 'dp_only') return 'DP tercatat';
  if (s === 'paid') return 'Lunas';
  return 'Belum dicatat';
}
