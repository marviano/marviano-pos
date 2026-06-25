/** Snapshot fields for reservation fraud/audit activity logs (edit, cancel, archive, delete). */

import { getCalendarDateYMDInWib, wibNowSql } from './wibDateTime';

export interface ReservationActivitySnapshotSource {
  uuid_id: string;
  nama?: string;
  phone?: string;
  tanggal?: string | Date | null;
  jam?: string | Date | null;
  pax?: number;
  status?: string;
  dp?: number | string | null;
  total_price?: number | string | null;
  table_ids_json?: unknown;
  penanggung_jawab_id?: number | null;
  note?: string | null;
  created_by_email?: string | null;
}

function normalizeTanggal(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) return getCalendarDateYMDInWib(v);
  const s = String(v).trim();
  if (!s) return '';
  if (s.includes('T')) return s.slice(0, 10);
  return s;
}

function normalizeJam(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toTimeString().slice(0, 5);
  const s = String(v).trim();
  if (!s) return '';
  if (s.length >= 5 && /^\d{1,2}:\d{2}/.test(s)) return s.slice(0, 5);
  return s;
}

export function reservationRowSnapshot(row: ReservationActivitySnapshotSource): Record<string, unknown> {
  return {
    uuid_id: row.uuid_id,
    nama: row.nama,
    phone: row.phone,
    tanggal: normalizeTanggal(row.tanggal),
    jam: normalizeJam(row.jam),
    pax: row.pax,
    status: row.status,
    dp: row.dp,
    total_price: row.total_price,
    table_ids_json: row.table_ids_json,
    penanggung_jawab_id: row.penanggung_jawab_id,
    note: row.note ?? null,
    created_by_email: row.created_by_email ?? null,
  };
}

export function enrichReservationLogDetails(
  details: Record<string, unknown>,
  ctx: { userEmail?: string | null; userId?: number | string | null; userName?: string | null }
): Record<string, unknown> {
  const rawId = ctx.userId;
  const userIdNum =
    rawId != null && rawId !== '' && !Number.isNaN(Number(rawId)) ? Number(rawId) : null;
  return {
    ...details,
    logged_at: wibNowSql(),
    source: 'pos',
    actor_email: ctx.userEmail ?? null,
    actor_user_id: userIdNum,
    actor_name: ctx.userName ?? null,
  };
}

export function parseActorFromLogDetails(details: string | null): string | null {
  if (!details) return null;
  try {
    const d = JSON.parse(details) as Record<string, unknown>;
    const name = d.actor_name != null ? String(d.actor_name).trim() : '';
    if (name) return name;
    const email = d.actor_email != null ? String(d.actor_email).trim() : '';
    if (email) return email;
    return null;
  } catch {
    return null;
  }
}
