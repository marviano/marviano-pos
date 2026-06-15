import { fetchFromVps, initApiUrlCache } from '@/lib/api';
import { smartSyncService } from '@/lib/smartSync';
import type { ReservationRow } from '@/components/ReservationFormModal';

export type ReservationUpsertPayload = {
  uuid_id: string;
  business_id: number;
  nama: string;
  phone: string;
  tanggal: string;
  jam: string;
  pax: number;
  status: string;
  dp: number;
  total_price: number;
  table_ids_json: number[] | null;
  items_json: unknown;
  penanggung_jawab_id: number | null;
  created_by_email: string | null;
  note: string | null;
};

function getApi() {
  return typeof window !== 'undefined' ? window.electronAPI : undefined;
}

/** Simpan ke MySQL lokal dulu (sumber utama). Sets synced_at NULL via IPC. */
export async function saveReservationLocally(
  payload: ReservationUpsertPayload,
  editMode: boolean
): Promise<{ success: boolean; error?: string }> {
  const api = getApi();
  if (!api) return { success: false, error: 'Database lokal tidak tersedia.' };

  try {
    if (editMode && api.localDbUpdateReservation) {
      const res = await api.localDbUpdateReservation(payload.uuid_id, {
        nama: payload.nama,
        phone: payload.phone,
        tanggal: payload.tanggal,
        jam: payload.jam,
        pax: payload.pax,
        status: payload.status,
        dp: payload.dp,
        total_price: payload.total_price,
        table_ids_json: payload.table_ids_json,
        items_json: payload.items_json,
        penanggung_jawab_id: payload.penanggung_jawab_id,
        note: payload.note,
      });
      return res?.success === false
        ? { success: false, error: res.error ?? 'Gagal memperbarui reservasi lokal.' }
        : { success: true };
    }
    if (api.localDbCreateReservation) {
      const res = await api.localDbCreateReservation({
        ...payload,
        table_ids_json: payload.table_ids_json,
      });
      return res?.success === false
        ? { success: false, error: res.error ?? 'Gagal menyimpan reservasi lokal.' }
        : { success: true };
    }
    return { success: false, error: 'Fitur reservasi lokal tidak tersedia.' };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Gagal menyimpan reservasi lokal.' };
  }
}

export async function updateReservationStatusLocally(
  uuid: string,
  status: 'upcoming' | 'attended' | 'cancelled'
): Promise<{ success: boolean; error?: string }> {
  const api = getApi();
  if (!api?.localDbUpdateReservation) {
    return { success: false, error: 'Database lokal tidak tersedia.' };
  }
  const res = await api.localDbUpdateReservation(uuid, { status });
  return res?.success === false
    ? { success: false, error: res.error ?? 'Gagal mengubah status.' }
    : { success: true };
}

export async function archiveReservationLocally(
  uuid: string,
  reason: string
): Promise<{ success: boolean; error?: string }> {
  const api = getApi();
  if (!api?.localDbArchiveReservation) {
    return { success: false, error: 'Database lokal tidak tersedia.' };
  }
  const res = await api.localDbArchiveReservation(uuid, reason);
  return res?.success === false
    ? { success: false, error: res.error ?? 'Gagal mengarsipkan reservasi.' }
    : { success: true };
}

/** Hapus permanen di lokal + VPS (jika online). Hanya untuk Super Admin di UI. */
export async function deleteReservationPermanently(
  uuid: string,
  reason?: string
): Promise<{ success: boolean; error?: string; vpsDeleted?: boolean }> {
  const api = getApi();
  if (!api?.localDbDeleteReservationPermanent) {
    return { success: false, error: 'Database lokal tidak tersedia.' };
  }

  let vpsDeleted = false;
  try {
    await initApiUrlCache();
    await fetchFromVps<{ success?: boolean }>(`/api/reservations/${encodeURIComponent(uuid)}`, {
      method: 'DELETE',
      body: JSON.stringify({ deleted_reason: reason ?? '' }),
    });
    vpsDeleted = true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const notFound = /not found|404/i.test(msg);
    if (!notFound) {
      return {
        success: false,
        error: `Gagal menghapus di server VPS: ${msg}. Data lokal tidak dihapus agar tidak muncul lagi saat sinkronisasi.`,
        vpsDeleted: false,
      };
    }
    vpsDeleted = true;
  }

  const res = await api.localDbDeleteReservationPermanent(uuid);
  if (res?.success === false) {
    return {
      success: false,
      error: res.error ?? 'Gagal menghapus reservasi dari database lokal.',
      vpsDeleted,
    };
  }

  return { success: true, vpsDeleted };
}

/** Coba sinkron ke VPS di background; gagal tidak memblokir UI. */
export function scheduleReservationVpsSync(): void {
  void smartSyncService.forceSync().catch((err) => {
    console.warn('[reservationSync] background VPS sync failed:', err);
  });
}

export type ReservationListFilters = {
  dateFrom: string;
  dateTo: string;
  statusFilter?: string;
  showArchived: 'no' | 'only';
};

export function buildReservationVpsQueryParams(
  businessId: number,
  filters: ReservationListFilters
): URLSearchParams {
  const params = new URLSearchParams({ business_id: String(businessId), limit: '5000' });
  if (filters.dateFrom) params.set('tanggal_from', filters.dateFrom.slice(0, 10));
  if (filters.dateTo) params.set('tanggal_to', filters.dateTo.slice(0, 10));
  if (filters.statusFilter) params.set('status', filters.statusFilter);
  params.set('show_archived', filters.showArchived);
  return params;
}

/**
 * Tarik data VPS ke lokal (merge). Local pending (synced_at NULL) menang.
 * Returns message for UI banner or null if OK.
 */
export async function pullReservationsFromVps(
  businessId: number,
  filters: ReservationListFilters,
  signal?: AbortSignal
): Promise<{ ok: boolean; message: string | null }> {
  const api = getApi();
  try {
    await initApiUrlCache();
    const params = buildReservationVpsQueryParams(businessId, filters);
    const res = await fetchFromVps<{ success?: boolean; reservations?: ReservationRow[] }>(
      `/api/reservations?${params.toString()}`,
      { signal }
    );
    const list = Array.isArray(res?.reservations) ? res.reservations : [];
    if (api?.localDbMergeReservationsFromVps && list.length > 0) {
      await api.localDbMergeReservationsFromVps(list);
    }
    return { ok: true, message: null };
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    if (name === 'AbortError' || signal?.aborted) {
      return { ok: false, message: null };
    }
    return {
      ok: false,
      message: 'Mode offline — menampilkan data dari database lokal.',
    };
  }
}
