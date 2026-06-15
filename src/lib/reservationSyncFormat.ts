/** Normalize reservation date/time from local MySQL rows for VPS API sync. */

import { fetchFromVps } from '@/lib/api';

function formatLocalCalendarDate(value: Date): string {
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatReservationTanggalForSync(tanggal: unknown): string | null {
  if (tanggal == null) return null;
  if (tanggal instanceof Date) {
    return formatLocalCalendarDate(tanggal);
  }
  const s = String(tanggal).trim();
  if (!s) return null;
  if (s.includes('T')) {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return formatLocalCalendarDate(d);
    return s.split('T')[0].slice(0, 10);
  }
  return s.slice(0, 10);
}

export function formatReservationJamForSync(jam: unknown): string | null {
  if (jam == null) return null;
  if (jam instanceof Date) {
    const h = String(jam.getHours()).padStart(2, '0');
    const min = String(jam.getMinutes()).padStart(2, '0');
    return `${h}:${min}`;
  }
  const s = String(jam).trim();
  if (!s) return null;
  if (s.length >= 5 && /^\d{1,2}:\d{2}/.test(s)) return s.slice(0, 5);
  return s;
}

export function formatReservationRowForSync(row: Record<string, unknown>) {
  return {
    uuid_id: row.uuid_id ?? row.id,
    business_id: row.business_id,
    nama: row.nama,
    phone: row.phone,
    tanggal: formatReservationTanggalForSync(row.tanggal),
    jam: formatReservationJamForSync(row.jam),
    pax: row.pax ?? 1,
    dp: row.dp ?? 0,
    total_price: row.total_price ?? 0,
    table_ids_json: row.table_ids_json ?? null,
    items_json: row.items_json ?? null,
    penanggung_jawab_id: row.penanggung_jawab_id ?? null,
    created_by_email: row.created_by_email ?? null,
    note: row.note ?? null,
    status: row.status ?? 'upcoming',
    payment_status: row.payment_status ?? 'none',
    pelunasan_transaction_uuid: row.pelunasan_transaction_uuid ?? null,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
    deleted_at: row.deleted_at ?? null,
    deleted_reason: row.deleted_reason ?? null,
  };
}

export async function pushUnsyncedReservationsToVps(
  rows: Record<string, unknown>[]
): Promise<{ succeeded: number; skipped: number; ok: boolean; message?: string; httpStatus?: number }> {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { succeeded: 0, skipped: 0, ok: true };
  }
  const formatted = rows.map((r) => formatReservationRowForSync(r));
  try {
    const result = await fetchFromVps<{ insertedCount?: number; updatedCount?: number; skippedCount?: number; message?: string }>(
      '/api/reservations',
      { method: 'POST', body: JSON.stringify({ reservations: formatted }) }
    );
    const inserted = Number(result?.insertedCount ?? 0);
    const updated = Number(result?.updatedCount ?? 0);
    const skipped = Number(result?.skippedCount ?? 0);
    return { succeeded: inserted + updated, skipped, ok: true, message: result?.message };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { succeeded: 0, skipped: formatted.length, ok: false, message };
  }
}
