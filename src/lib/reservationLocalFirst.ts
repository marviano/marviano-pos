/**
 * Reservation data: local MySQL (DB_HOST) is source of truth.
 * Salespulse VPS receives upserts/deletes in the background when online.
 */

import { initApiUrlCache } from '@/lib/api';

export type ReservationSavePayload = {
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

export async function syncReservationsToVpsInBackground(businessId: number): Promise<{
  success: boolean;
  succeeded?: number;
  skipped?: number;
  error?: string;
  message?: string;
}> {
  const api = window.electronAPI;
  if (!api?.localDbSyncUnsyncedReservationsToVps) {
    return { success: false, error: 'Sync not available' };
  }
  try {
    await initApiUrlCache();
    return await api.localDbSyncUnsyncedReservationsToVps(businessId);
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function saveReservationToLocalMySQL(
  payload: ReservationSavePayload,
  isEdit: boolean
): Promise<{ success: boolean; error?: string }> {
  const api = window.electronAPI;
  if (!api) {
    return { success: false, error: 'Electron API tidak tersedia.' };
  }
  try {
    if (isEdit && api.localDbUpdateReservation) {
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
      if (res?.success === false) {
        return { success: false, error: res.error || 'Gagal memperbarui reservasi di database lokal.' };
      }
      return { success: true };
    }
    if (api.localDbUpsertReservation) {
      const res = await api.localDbUpsertReservation({
        ...payload,
        table_ids_json: payload.table_ids_json,
      });
      if (res?.success === false) {
        return { success: false, error: res.error || 'Gagal menyimpan reservasi di database lokal.' };
      }
      return { success: true };
    }
    if (api.localDbCreateReservation) {
      const res = await api.localDbCreateReservation({
        ...payload,
        table_ids_json: payload.table_ids_json,
      });
      if (res?.success === false) {
        return { success: false, error: res.error || 'Gagal menyimpan reservasi di database lokal.' };
      }
      return { success: true };
    }
    return { success: false, error: 'API reservasi lokal tidak tersedia.' };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Gagal menyimpan ke database lokal.' };
  }
}

export async function updateReservationStatusLocal(
  uuid: string,
  data: {
    nama: string;
    phone: string;
    tanggal: string;
    jam: string;
    pax: number;
    status: string;
    dp: number | string;
    total_price: number | string;
    table_ids_json: number[] | null;
    items_json: unknown;
    penanggung_jawab_id: number | null;
    note: string | null;
  }
): Promise<{ success: boolean; error?: string }> {
  const api = window.electronAPI;
  if (!api?.localDbUpdateReservation) {
    return { success: false, error: 'API update reservasi lokal tidak tersedia.' };
  }
  const res = await api.localDbUpdateReservation(uuid, data);
  if (res?.success === false) {
    return { success: false, error: res.error || 'Gagal mengubah status di database lokal.' };
  }
  return { success: true };
}

export async function archiveReservationLocal(
  uuid: string,
  reason: string
): Promise<{ success: boolean; error?: string }> {
  const api = window.electronAPI;
  if (!api?.localDbArchiveReservation) {
    return { success: false, error: 'API arsip reservasi lokal tidak tersedia.' };
  }
  const res = await api.localDbArchiveReservation(uuid, reason);
  if (res?.success === false) {
    return { success: false, error: res.error || 'Gagal mengarsipkan di database lokal.' };
  }
  return { success: true };
}

export async function deleteReservationLocal(
  uuid: string,
  meta?: { businessId?: number; reason?: string }
): Promise<{ success: boolean; error?: string }> {
  const api = window.electronAPI;
  if (!api?.localDbDeleteReservation) {
    return { success: false, error: 'API hapus reservasi lokal tidak tersedia.' };
  }
  const res = await api.localDbDeleteReservation(uuid, meta);
  if (res?.success === false) {
    return { success: false, error: res.error || 'Gagal menghapus dari database lokal.' };
  }
  return { success: true };
}
