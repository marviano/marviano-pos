'use client';

import { useState, useEffect, useCallback } from 'react';
import { appAlert, appConfirm } from '@/components/AppDialog';
import { getTodayUTC7 } from '@/lib/dateUtils';
import { Calendar } from 'lucide-react';
import { formatRupiah, formatPhoneDisplay } from '@/lib/formatUtils';
import { parseReservationItemsJson, computeTotalFromReservationItems } from '@/lib/reservationItems';
import { fetchFromVps, initApiUrlCache } from '@/lib/api';
import { canSendReservationToKasir } from '@/lib/reservationDateUtils';
import {
  archiveReservationLocally,
  deleteReservationPermanently,
  pullReservationsFromVps,
  scheduleReservationVpsSync,
  updateReservationStatusLocally,
} from '@/lib/reservationSync';
import { RESERVATION_STATUS_LABELS, reservationStatusLabel } from '@/lib/reservationStatus';
import { jamToDisplay } from '@/lib/reservationTimeFormat';
import ReservationFormModal, { type ReservationRow } from './ReservationFormModal';
import ReservationTablePicker from './ReservationTablePicker';
import ReservationCalendarModal from './ReservationCalendarModal';
import RefundExcModal from './RefundExcModal';
import RecordDpModal from './RecordDpModal';
import ReservationFinancePanel from './ReservationFinancePanel';
import {
  getReservationRecordedDp,
  getReservationSisaBayar,
  isDpRecorded,
} from '@/lib/reservationPayments';

/** Parse value from DB (number or string from DECIMAL) to number for currency display. */
function parseMoneyFromDb(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  if (typeof v === 'string') {
    const s = v.trim().replace(/\s/g, '');
    const dotCount = (s.match(/\./g) || []).length;
    const commaCount = (s.match(/,/g) || []).length;
    const cleaned = dotCount <= 1 && commaCount === 0
      ? s.replace(',', '.')
      : s.replace(/\./g, '').replace(/,/g, '.');
    const n = parseFloat(cleaned);
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

function normalizePhoneForWa(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('0')) return '62' + digits.slice(1);
  if (!digits.startsWith('62')) return '62' + digits;
  return digits;
}

interface ReservationPageProps {
  businessId: number;
  userEmail?: string | null;
  userId?: number | string | null;
  canPermanentDelete?: boolean;
  onPickProductsFromKasir?: (reservation: ReservationRow) => void;
  onSendToKasir?: (reservation: ReservationRow, tableName?: string) => void;
}

type ActiveTab = 'reservations' | 'keuangan' | 'log';
type LogActionFilter = 'all' | 'reservation_create' | 'reservation_update' | 'reservation_delete' | 'reservation_archive' | 'reservation_send_to_kasir';

type ReservationListFilters = {
  dateFrom?: string;
  dateTo?: string;
  status?: 'all' | 'upcoming' | 'attended' | 'cancelled' | 'archived';
};

interface ActivityLogRow {
  id: number;
  action: string;
  details: string | null;
  created_at: string | Date;
  user_id: number | null;
  user_email?: string | null;
  user_name?: string | null;
}

export default function ReservationPage({ businessId, userEmail, userId, canPermanentDelete = false, onPickProductsFromKasir, onSendToKasir }: ReservationPageProps) {
  const [activeTab, setActiveTab] = useState<ActiveTab>('reservations');
  const [reservations, setReservations] = useState<ReservationRow[]>([]);
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'upcoming' | 'attended' | 'cancelled' | 'archived'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingReservation, setEditingReservation] = useState<ReservationRow | null>(null);
  const [archiveModalRow, setArchiveModalRow] = useState<ReservationRow | null>(null);
  const [archiveReason, setArchiveReason] = useState('');
  const [permanentDeleteRow, setPermanentDeleteRow] = useState<ReservationRow | null>(null);
  const [permanentDeleteReason, setPermanentDeleteReason] = useState('');
  const [layoutModalRow, setLayoutModalRow] = useState<ReservationRow | null>(null);
  const [layoutModalSize, setLayoutModalSize] = useState<{ width: number; height: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState<Record<string, unknown>[]>([]);
  const [tablesMap, setTablesMap] = useState<Record<number, string>>({}); // id -> table_number
  const [reservationLogs, setReservationLogs] = useState<ActivityLogRow[]>([]);
  const [logFilterAction, setLogFilterAction] = useState<LogActionFilter>('all');
  const [logFilterDateFrom, setLogFilterDateFrom] = useState('');
  const [logFilterDateTo, setLogFilterDateTo] = useState('');
  const [logDetailModal, setLogDetailModal] = useState<ActivityLogRow | null>(null);
  const [calendarModalOpen, setCalendarModalOpen] = useState(false);
  const [vpsError, setVpsError] = useState<string | null>(null);
  const [refundExcModalOpen, setRefundExcModalOpen] = useState(false);
  const [refundExcPrefillReservation, setRefundExcPrefillReservation] = useState<ReservationRow | null>(null);
  const [recordDpModalOpen, setRecordDpModalOpen] = useState(false);
  const [recordDpReservation, setRecordDpReservation] = useState<ReservationRow | null>(null);
  const [financeRefreshTrigger, setFinanceRefreshTrigger] = useState(0);

  const bumpFinanceRefresh = useCallback(() => {
    setFinanceRefreshTrigger((n) => n + 1);
  }, []);

  const loadReservationsFromLocal = async (filters: {
    dateFrom: string;
    dateTo: string;
    statusFilter?: string;
    showArchived: 'no' | 'only';
  }): Promise<ReservationRow[]> => {
    const api = window.electronAPI;
    if (!api?.localDbGetReservations) return [];
    const local = await api.localDbGetReservations(businessId, {
      tanggalFrom: filters.dateFrom || undefined,
      tanggalTo: filters.dateTo || undefined,
      status: filters.statusFilter,
      showArchived: filters.showArchived,
    });
    return (Array.isArray(local) ? local : []) as ReservationRow[];
  };

  const sortReservations = (rows: ReservationRow[]): ReservationRow[] =>
    [...rows].sort((a, b) => {
      const ta = String(a.tanggal).slice(0, 10);
      const tb = String(b.tanggal).slice(0, 10);
      if (ta !== tb) return ta.localeCompare(tb);
      return String(a.jam).localeCompare(String(b.jam));
    });

  const fetchReservations = useCallback(async (
    signal?: AbortSignal,
    overrides?: ReservationListFilters
  ) => {
    const dateFrom = overrides?.dateFrom !== undefined ? overrides.dateFrom : filterDateFrom;
    const dateTo = overrides?.dateTo !== undefined ? overrides.dateTo : filterDateTo;
    const statusValue = overrides?.status !== undefined ? overrides.status : filterStatus;

    setLoading(true);
    setVpsError(null);
    const showArchived: 'no' | 'only' = statusValue === 'archived' ? 'only' : 'no';
    const statusFilter = statusValue === 'all' || statusValue === 'archived' ? undefined : statusValue;
    const listFilters = { dateFrom, dateTo, statusFilter, showArchived };

    try {
      const api = window.electronAPI;
      if (!api?.localDbGetReservations) {
        setReservations([]);
        setVpsError('Database lokal tidak tersedia.');
        return;
      }

      const localList = await loadReservationsFromLocal(listFilters);
      if (signal?.aborted) return;
      setReservations(sortReservations(localList));
      setLoading(false);

      const pull = await pullReservationsFromVps(businessId, listFilters, signal);
      if (signal?.aborted) return;

      const refreshed = sortReservations(await loadReservationsFromLocal(listFilters));
      setReservations(refreshed);

      const unsynced = await api.localDbGetUnsyncedReservations?.(businessId);
      const pendingCount = Array.isArray(unsynced) ? unsynced.length : 0;

      if (pull.message) {
        setVpsError(pull.message);
      } else if (pendingCount > 0) {
        setVpsError(`${pendingCount} reservasi menunggu sinkron ke server.`);
      }
    } catch (e) {
      const name = e instanceof Error ? e.name : '';
      if (name === 'AbortError' || signal?.aborted) return;
      console.error('Fetch reservations error:', e);
      setReservations([]);
      setVpsError(e instanceof Error ? e.message : 'Gagal memuat reservasi.');
    } finally {
      setLoading(false);
    }
  }, [businessId, filterDateFrom, filterDateTo, filterStatus]);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchReservations(ctrl.signal);
    return () => {
      ctrl.abort();
    };
  }, [fetchReservations]);

  const fetchReservationLogs = useCallback(async (signal?: AbortSignal) => {
    setVpsError(null);
    try {
      await initApiUrlCache();
      const list = await fetchFromVps<ActivityLogRow[]>(
        `/api/activity-logs?business_id=${businessId}&actions=reservation_*`,
        { signal }
      );
      const reservationActions = Array.isArray(list) ? list : [];
      setReservationLogs(reservationActions);
    } catch (e) {
      const name = e instanceof Error ? e.name : '';
      const msg = e instanceof Error ? e.message : String(e);
      if (name === 'AbortError' || signal?.aborted) {
        return;
      }
      console.error('Fetch reservation logs error:', e);
      setReservationLogs([]);
      setVpsError(e instanceof Error ? e.message : 'Gagal memuat log dari server.');
    }
  }, [businessId]);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchReservationLogs(ctrl.signal);
    return () => {
      ctrl.abort();
    };
  }, [fetchReservationLogs]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const api = window.electronAPI;
      if (api?.localDbGetEmployees) {
        try {
          const list = await api.localDbGetEmployees();
          if (!cancelled) setEmployees(Array.isArray(list) ? list : []);
          return;
        } catch {
          // fall through to VPS
        }
      }
      try {
        await initApiUrlCache();
        const list = await fetchFromVps<Record<string, unknown>[]>(`/api/employees?business_id=${businessId}`);
        if (!cancelled) setEmployees(Array.isArray(list) ? list : []);
      } catch {
        if (!cancelled) setEmployees([]);
      }
    })();
    return () => { cancelled = true; };
  }, [businessId]);

  useEffect(() => {
    let cancelled = false;
    const tableNumbers: Record<number, string> = {};
    (async () => {
      const api = window.electronAPI;
      if (!api?.getRestaurantRooms || !api?.getRestaurantTables) return;
      try {
        const rooms = await api.getRestaurantRooms(businessId);
        const roomList = Array.isArray(rooms) ? rooms : [];
        for (const room of roomList) {
          if (cancelled) return;
          const tables = await api.getRestaurantTables(room.id);
          const arr = Array.isArray(tables) ? tables : [];
          arr.forEach((t) => {
            tableNumbers[t.id] = t.table_number ?? String(t.id);
          });
        }
        if (!cancelled) setTablesMap(tableNumbers);
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, [businessId]);

  const filtered = reservations.filter((r) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const nama = (r.nama ?? '').toLowerCase();
    const phone = (r.phone ?? '').replace(/\D/g, '');
    const qDigits = searchQuery.replace(/\D/g, '');
    return nama.includes(q) || phone.includes(qDigits);
  });

  const getEmployeeName = (id: number | null): string => {
    if (id == null) return '-';
    const emp = employees.find((e) => Number(e.id) === id);
    return (emp?.nama_karyawan ?? emp?.name ?? `#${id}`) as string;
  };

  const getTableNames = (row: ReservationRow): string => {
    const raw = row.table_ids_json;
    if (raw == null) return '-';
    let ids: number[] = [];
    if (Array.isArray(raw)) ids = raw;
    else if (typeof raw === 'string') {
      try {
        ids = JSON.parse(raw);
      } catch {
        return '-';
      }
    }
    if (ids.length === 0) return '-';
    return ids.map((id) => tablesMap[id] ?? `#${id}`).join(', ');
  };

  const handleOpenWa = (phoneNumber: string) => {
    const url = `https://wa.me/${normalizePhoneForWa(phoneNumber)}`;
    if (window.electronAPI?.openExternal) {
      window.electronAPI.openExternal(url);
    } else {
      window.open(url, '_blank');
    }
  };

  const openArchiveModal = (r: ReservationRow) => {
    setArchiveModalRow(r);
    setArchiveReason('');
  };

  const openPermanentDeleteModal = (r: ReservationRow) => {
    setPermanentDeleteRow(r);
    setPermanentDeleteReason('');
  };

  const handlePermanentDeleteConfirm = async () => {
    const r = permanentDeleteRow;
    if (!r) return;
    const reason = permanentDeleteReason.trim();
    if (!reason) {
      await appAlert('Alasan hapus permanen wajib diisi.');
      return;
    }

    const hasDp = getReservationRecordedDp(r) > 0 || isDpRecorded(r);
    const isPaid = (r.payment_status ?? 'none') === 'paid';
    let warning = 'Data reservasi dan catatan DP/pembayaran reservasi akan dihapus permanen dari POS dan VPS.';
    if (isPaid) {
      warning += ' Transaksi pelunasan di kasir TIDAK dihapus (tetap ada di daftar transaksi).';
    } else if (hasDp) {
      warning += ' Catatan DP akan ikut terhapus.';
    }

    const confirmed = await appConfirm(
      `Hapus permanen reservasi "${r.nama}"?\n\n${warning}\n\nTindakan ini tidak dapat dibatalkan.`
    );
    if (!confirmed) return;

    try {
      const res = await deleteReservationPermanently(r.uuid_id, reason);
      if (!res.success) {
        throw new Error(res.error ?? 'Gagal menghapus permanen.');
      }
      const tanggalStr = String(r.tanggal ?? '').slice(0, 10);
      const jamStr = String(r.jam ?? '').slice(0, 8);
      await logReservationActivity('reservation_delete', {
        uuid_id: r.uuid_id,
        nama: r.nama,
        phone: r.phone,
        tanggal: tanggalStr,
        jam: jamStr,
        reason,
        vps_deleted: res.vpsDeleted ?? false,
      });
      setPermanentDeleteRow(null);
      setPermanentDeleteReason('');
      await fetchReservations();
      fetchReservationLogs();
      await appAlert('Reservasi dihapus permanen dari POS dan VPS.');
    } catch (e) {
      await appAlert(e instanceof Error ? e.message : 'Gagal menghapus permanen.');
    }
  };

  const handleArchiveConfirm = async () => {
    const r = archiveModalRow;
    if (!r) return;
    const reason = archiveReason.trim();
    if (!reason) {
      await appAlert('Alasan arsip wajib diisi.');
      return;
    }
    try {
      const res = await archiveReservationLocally(r.uuid_id, reason);
      if (!res.success) {
        throw new Error(res.error ?? 'Gagal mengarsipkan reservasi.');
      }
      scheduleReservationVpsSync();
      const tanggalValue: unknown = r.tanggal;
      const jamValue: unknown = r.jam;
      const tanggalStr = tanggalValue instanceof Date ? tanggalValue.toISOString().slice(0, 10) : String(tanggalValue ?? '');
      const jamStr = jamValue instanceof Date ? (jamValue as Date).toTimeString().slice(0, 5) : String(jamValue ?? '');
      await logReservationActivity('reservation_archive', {
        uuid_id: r.uuid_id,
        nama: r.nama,
        phone: r.phone,
        tanggal: tanggalStr,
        jam: jamStr,
        pax: r.pax,
        status: r.status,
        dp: r.dp,
        total_price: r.total_price,
        table_ids_json: r.table_ids_json,
        penanggung_jawab_id: r.penanggung_jawab_id,
        note: r.note ?? null,
        reason,
      });
      setArchiveModalRow(null);
      setArchiveReason('');
      fetchReservations();
      fetchReservationLogs();
    } catch (e) {
      await appAlert(e instanceof Error ? e.message : 'Gagal mengarsipkan reservasi.');
    }
  };

  const openCreate = () => {
    setEditingReservation(null);
    setIsModalOpen(true);
  };

  const openEdit = (r: ReservationRow) => {
    setEditingReservation(r);
    setIsModalOpen(true);
  };

  const handleViewReservationFromFinance = useCallback(async (reservationUuid: string) => {
    const found = reservations.find((r) => r.uuid_id === reservationUuid);
    if (found) {
      openEdit(found);
      return;
    }
    const api = window.electronAPI;
    if (!api?.localDbGetReservations) {
      await appAlert('Reservasi tidak ditemukan.');
      return;
    }
    try {
      const rows = await api.localDbGetReservations(businessId, {});
      const row = (Array.isArray(rows) ? rows : []).find(
        (r) => String((r as ReservationRow).uuid_id) === reservationUuid
      ) as ReservationRow | undefined;
      if (row) {
        openEdit(row);
      } else {
        await appAlert('Reservasi tidak ditemukan di database lokal.');
      }
    } catch {
      await appAlert('Gagal memuat detail reservasi.');
    }
  }, [businessId, reservations]);

  const statusBadge = (row: ReservationRow) => {
    if (row.deleted_at) {
      return <span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-200 text-slate-700">Arsip</span>;
    }
    const s = (row.status || 'upcoming').toLowerCase();
    const classes =
      s === 'upcoming'
        ? 'bg-blue-100 text-blue-800'
        : s === 'attended'
          ? 'bg-green-100 text-green-800'
          : 'bg-red-100 text-red-800';
    const label = reservationStatusLabel(s);
    return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${classes}`}>{label}</span>;
  };

  /** Normalize tanggal from DB to YYYY-MM-DD. Main process sends strings; Date kept for activity-log payloads. */
  const normalizeTanggalForDisplay = (v: string | Date | null | undefined): string => {
    if (v == null) return '';
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    const s = String(v).trim();
    if (!s) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    if (s.includes('T')) return s.slice(0, 10);
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
  };

  /** Normalize jam from DB to HH.mm for display. */
  const normalizeJamForDisplay = (v: string | Date | null | undefined): string => {
    if (v == null) return '';
    if (v instanceof Date) return jamToDisplay(v.toTimeString().slice(0, 5));
    const s = String(v).trim();
    if (!s) return '';
    return jamToDisplay(s);
  };

  /** String version for title/tooltip (title attribute must be string). */
  const formatDateAsString = (d: string | Date | null | undefined, jam: string | Date | null | undefined): string => {
    const dateStr = normalizeTanggalForDisplay(d);
    const time = normalizeJamForDisplay(jam);
    if (!dateStr) return time ? `-, ${time}` : '-';
    const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    const day = match ? parseInt(match[3], 10) : null;
    const monthIdx = match ? parseInt(match[2], 10) - 1 : -1;
    const year = match ? parseInt(match[1], 10) : null;
    const month = monthIdx >= 0 && monthIdx < 12 ? monthNames[monthIdx] : dateStr;
    const dateLabel = day != null && year != null ? `${day} ${month} ${year}` : dateStr;
    return time ? `${dateLabel}, ${time}` : dateLabel;
  };

  const formatDate = (d: string | Date | null | undefined, jam: string | Date | null | undefined) => {
    const dateStr = normalizeTanggalForDisplay(d);
    const time = normalizeJamForDisplay(jam);
    if (!dateStr) {
      return (
        <>
          <span className="text-slate-500">-</span>
          {time ? <><br /><small className="text-slate-500">{time}</small></> : null}
        </>
      );
    }
    // Format YYYY-MM-DD without creating a Date, so timezone never shifts the day
    const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    const day = match ? parseInt(match[3], 10) : null;
    const monthIdx = match ? parseInt(match[2], 10) - 1 : -1;
    const year = match ? parseInt(match[1], 10) : null;
    const month = monthIdx >= 0 && monthIdx < 12 ? monthNames[monthIdx] : dateStr;
    const dateLabel = day != null && year != null ? `${day} ${month} ${year}` : dateStr;
    return (
      <>
        {dateLabel}
        <br />
        <small className="text-slate-500">{time || '-'}</small>
      </>
    );
  };

  const getTableIdsFromRow = (row: ReservationRow): number[] => {
    const raw = row.table_ids_json;
    if (raw == null) return [];
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string') {
      try {
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr : [];
      } catch {
        return [];
      }
    }
    return [];
  };

  const getItemsCountFromRow = (row: ReservationRow): number => {
    const raw = row.items_json;
    if (raw == null) return 0;
    if (Array.isArray(raw)) return raw.length;
    if (typeof raw === 'string') {
      try {
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr.length : 0;
      } catch {
        return 0;
      }
    }
    return 0;
  };

  /** Total from saved menu (items_json). Falls back to total_price when no items. */
  const getTotalFromSavedMenu = (row: ReservationRow): number => {
    const items = parseReservationItemsJson(row.items_json ?? null);
    if (items.length > 0) return computeTotalFromReservationItems(items);
    return parseMoneyFromDb(row.total_price);
  };

  const handleSendToKasir = async (r: ReservationRow) => {
    const api = window.electronAPI;
    if (!api?.localDbGetPendingTransactionsByTableIds || !onSendToKasir) return;
    const tableIds = getTableIdsFromRow(r);
    if (tableIds.length > 0) {
      const conflicts = await api.localDbGetPendingTransactionsByTableIds(businessId, tableIds) as Array<{ tableId: number; transactionUuid: string; created_at: string }>;
      if (conflicts.length > 0) {
        const list = conflicts.map((c) => {
          const tableNum = tablesMap[c.tableId] ?? `Meja ${c.tableId}`;
          const time = c.created_at && c.created_at.length >= 11 ? c.created_at.slice(11, 16) : c.created_at ?? '';
          return `${tableNum} — Pesanan aktif sejak ${time}`;
        });
        await appAlert(
          'Meja Sudah Terisi.\n\nMeja berikut sudah memiliki pesanan aktif: ' + list.join('\n') + '\n\nSelesaikan pesanan aktif di meja tersebut terlebih dahulu, atau ubah meja pada reservasi ini.'
        );
        return;
      }
    }
    // Status stays "upcoming" until user clicks Simpan Order in Kasir (then set to "attended" there)
    await logReservationActivity('reservation_send_to_kasir', {
      uuid_id: r.uuid_id,
      nama: r.nama,
      tanggal: r.tanggal,
      jam: r.jam,
      table_ids_json: getTableIdsFromRow(r)
    });
    fetchReservations();
    fetchReservationLogs();
    const tableName = tableIds.length > 0 ? tableIds.map((id) => tablesMap[id] ?? `Meja ${id}`).join(', ') : undefined;
    onSendToKasir(r, tableName);
  };

  const logReservationActivity = async (action: string, details: Record<string, unknown>) => {
    try {
      await initApiUrlCache();
      await fetchFromVps('/api/activity-logs', {
        method: 'POST',
        body: JSON.stringify({
          action,
          business_id: businessId,
          details,
        }),
      });
    } catch (e) {
      console.warn('Failed to log reservation activity to VPS:', e);
    }
  };

  const handleReservationStatusChange = async (
    r: ReservationRow,
    newStatus: 'upcoming' | 'attended' | 'cancelled'
  ) => {
    try {
      const res = await updateReservationStatusLocally(r.uuid_id, newStatus);
      if (!res.success) {
        throw new Error(res.error ?? 'Gagal mengubah status.');
      }
      scheduleReservationVpsSync();
      const tanggalStr = (r.tanggal as unknown) instanceof Date ? (r.tanggal as unknown as Date).toISOString().slice(0, 10) : String(r.tanggal ?? '');
      const jamStr = (r.jam as unknown) instanceof Date ? (r.jam as unknown as Date).toTimeString().slice(0, 5) : String(r.jam ?? '');
      await logReservationActivity('reservation_update', {
        uuid_id: r.uuid_id,
        nama: r.nama,
        phone: r.phone,
        tanggal: tanggalStr,
        jam: jamStr,
        pax: r.pax,
        status: newStatus,
        dp: r.dp,
        total_price: r.total_price,
        table_ids_json: r.table_ids_json,
        penanggung_jawab_id: r.penanggung_jawab_id,
        note: r.note ?? null,
      });
      fetchReservations();
      fetchReservationLogs();
    } catch (err) {
      await appAlert(err instanceof Error ? err.message : 'Gagal mengubah status.');
    }
  };

  const getReservationCardStyles = (r: ReservationRow) => {
    if (r.deleted_at) return 'bg-slate-100 border-slate-300 border-l-slate-500';
    const s = (r.status || 'upcoming').toLowerCase();
    if (s === 'upcoming') return 'bg-blue-100 border-blue-300 border-l-blue-600 hover:bg-blue-200/70';
    if (s === 'attended') return 'bg-emerald-100 border-emerald-300 border-l-emerald-600 hover:bg-emerald-200/70';
    if (s === 'cancelled') return 'bg-rose-100 border-rose-300 border-l-rose-600 hover:bg-rose-200/70';
    return 'bg-blue-100 border-blue-300 border-l-blue-600 hover:bg-blue-200/70';
  };

  const getReservationCardDividerStyles = (r: ReservationRow) => {
    if (r.deleted_at) return 'border-slate-300/80';
    const s = (r.status || 'upcoming').toLowerCase();
    if (s === 'upcoming') return 'border-blue-300/70';
    if (s === 'attended') return 'border-emerald-300/70';
    if (s === 'cancelled') return 'border-rose-300/70';
    return 'border-blue-300/70';
  };

  const handleLayoutSizeReady = useCallback((canvasWidth: number, canvasHeight: number) => {
    const maxW = typeof window !== 'undefined' ? Math.min(800, window.innerWidth * 0.9) : 800;
    const maxH = typeof window !== 'undefined' ? Math.min(600, window.innerHeight * 0.85) : 600;
    const cw = Math.max(100, canvasWidth);
    const ch = Math.max(100, canvasHeight);
    const aspect = ch / cw;
    let w: number;
    let h: number;
    if (maxW * aspect <= maxH) {
      w = maxW;
      h = maxW * aspect;
    } else {
      h = maxH;
      w = maxH / aspect;
    }
    // Modal 25% wider for layout meja
    const w25 = Math.round(w * 1.25);
    const cappedW = typeof window !== 'undefined' ? Math.min(w25, Math.floor(window.innerWidth * 0.94)) : w25;
    setLayoutModalSize({ width: cappedW, height: Math.round(h) });
  }, []);

  const formatLogAction = (action: string) => {
    if (action === 'reservation_create') return 'Buat';
    if (action === 'reservation_update') return 'Edit';
    if (action === 'reservation_delete') return 'Hapus';
    if (action === 'reservation_archive') return 'Arsip';
    if (action === 'reservation_send_to_kasir') return 'Kirim ke Kasir';
    return action;
  };

  /** Format tanggal from DB to readable (e.g. 11 Mar 2026). Uses string parse only for YYYY-MM-DD to avoid timezone shift. */
  const formatDetailDate = (v: unknown): string => {
    if (v == null) return '-';
    const s = String(v).trim();
    if (!s) return '-';
    const match = s.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
      const day = parseInt(match[3], 10);
      const month = monthNames[parseInt(match[2], 10) - 1] ?? match[2];
      const year = parseInt(match[1], 10);
      return `${day} ${month} ${year}`;
    }
    const d = s.includes('T') ? new Date(s) : new Date(s + 'T00:00:00');
    if (Number.isNaN(d.getTime())) return s;
    return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  /** Format jam to HH:mm. Prefer string slice for HH:mm / HH:mm:ss to avoid timezone. */
  const formatDetailTime = (v: unknown): string => {
    if (v == null) return '-';
    const s = String(v).trim();
    if (!s) return '-';
    if (s.length >= 5 && /^\d{1,2}:\d{2}/.test(s)) return s.slice(0, 5);
    const d = new Date('1970-01-01T' + s);
    if (Number.isNaN(d.getTime())) return s;
    return d.toTimeString().slice(0, 5);
  };

  const formatLogDetails = (details: string | null) => {
    if (!details) return '-';
    try {
      const d = JSON.parse(details) as Record<string, unknown>;
      const nama = (d.nama != null ? String(d.nama) : '').trim() || '-';
      const dateStr = formatDetailDate(d.tanggal);
      const timeStr = formatDetailTime(d.jam);
      const base = `${nama} — ${dateStr}, ${timeStr}`;
      const reason = d.reason != null ? String(d.reason).trim() : '';
      if (reason) return `${base} | Alasan: ${reason}`;
      return base;
    } catch {
      return details.slice(0, 80);
    }
  };

  /** Parsed details for the log detail modal */
  const parseLogDetails = (details: string | null): Record<string, unknown> | null => {
    if (!details) return null;
    try {
      return JSON.parse(details) as Record<string, unknown>;
    } catch {
      return null;
    }
  };

  const formatLogTime = (created_at: string | Date) => {
    if (created_at instanceof Date) return created_at.toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' });
    if (typeof created_at === 'string') return new Date(created_at).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' });
    return '-';
  };

  const getUserDisplay = (logRow: ActivityLogRow) => {
    if (logRow.user_name && String(logRow.user_name).trim()) return String(logRow.user_name).trim();
    if (logRow.user_email && String(logRow.user_email).trim()) return String(logRow.user_email).trim();
    if (logRow.user_id != null && logRow.user_id !== 0) return `User #${logRow.user_id}`;
    return 'POS';
  };

  const filteredLogs = reservationLogs.filter((log) => {
    if (logFilterAction !== 'all' && log.action !== logFilterAction) return false;
    const logTime = log.created_at instanceof Date ? log.created_at.getTime() : new Date(log.created_at).getTime();
    if (logFilterDateFrom) {
      const from = new Date(logFilterDateFrom + 'T00:00:00').getTime();
      if (logTime < from) return false;
    }
    if (logFilterDateTo) {
      const to = new Date(logFilterDateTo + 'T23:59:59').getTime();
      if (logTime > to) return false;
    }
    return true;
  });

  return (
    <div className="flex-1 flex flex-col h-full min-h-0 bg-slate-100">
      <div className="border-b border-slate-200 px-5 my-2 min-h-9 pb-2 text-xs flex flex-nowrap items-center gap-2 w-full min-w-0">
        <div className="flex flex-1 flex-nowrap items-center gap-2 min-w-0 h-full">
        {activeTab === 'reservations' && (
          <>
            <div className="flex items-center h-full rounded-md border border-slate-300 overflow-hidden bg-white text-[length:inherit]">
              <button
                type="button"
                onClick={() => { setFilterDateFrom(''); setFilterDateTo(''); }}
                className="h-full px-2.5 rounded-none border-0 border-r border-slate-300 bg-slate-50 text-slate-700 font-medium hover:bg-slate-100 whitespace-nowrap text-inherit"
              >
                Tampilkan semua reservasi
              </button>
              <button
                type="button"
                onClick={() => {
                  const today = getTodayUTC7();
                  const [y, m, d] = today.split('-').map(Number);
                  const t = new Date(y, m - 1, d + 1);
                  const dStr = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
                  setFilterDateFrom(dStr);
                  setFilterDateTo(dStr);
                }}
                className="h-full px-2.5 rounded-none border-0 border-r border-slate-300 bg-slate-50 text-slate-700 font-medium hover:bg-slate-100 whitespace-nowrap text-inherit"
              >
                Besok
              </button>
              <div className="flex items-center gap-1 px-2 h-full border-r border-slate-300 bg-white shrink-0 text-inherit">
                <span className="text-slate-600 font-medium whitespace-nowrap">Dari</span>
                <input
                  type="date"
                  value={filterDateFrom}
                  onChange={(e) => setFilterDateFrom(e.target.value)}
                  className="border-0 bg-transparent p-0 text-slate-900 focus:ring-0 focus:outline-none min-w-0 text-inherit h-full"
                  title="Tanggal mulai"
                />
              </div>
              <div className="flex items-center gap-1 px-2 h-full bg-white shrink-0 text-inherit">
                <span className="text-slate-600 font-medium whitespace-nowrap">Sampai</span>
                <input
                  type="date"
                  value={filterDateTo}
                  onChange={(e) => setFilterDateTo(e.target.value)}
                  className="border-0 bg-transparent p-0 text-slate-900 focus:ring-0 focus:outline-none min-w-0 text-inherit h-full"
                  title="Tanggal akhir"
                />
              </div>
              <button
                type="button"
                onClick={() => setCalendarModalOpen(true)}
                className="h-full px-3 rounded-none border-0 border-l border-slate-300 bg-slate-50 text-slate-900 font-semibold hover:bg-slate-100 flex items-center gap-1.5"
              >
                <Calendar className="w-3.5 h-3.5 shrink-0 text-slate-900" />
                Kalender
              </button>
            </div>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as 'all' | 'upcoming' | 'attended' | 'cancelled' | 'archived')}
              className="h-full min-h-0 border border-slate-300 rounded-md px-2.5 bg-white text-slate-900 text-inherit"
            >
              <option value="all">Semua Status</option>
              <option value="upcoming">{RESERVATION_STATUS_LABELS.upcoming}</option>
              <option value="attended">{RESERVATION_STATUS_LABELS.attended}</option>
              <option value="cancelled">{RESERVATION_STATUS_LABELS.cancelled}</option>
              <option value="archived">Arsip</option>
            </select>
            <input
              type="text"
              placeholder="Cari nama / no. HP..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-full border border-slate-300 rounded-md px-2.5 w-40 bg-white text-slate-900 placeholder:text-slate-500 text-inherit min-w-0"
            />
            <button
              type="button"
              onClick={openCreate}
              className="h-full px-3 rounded-md bg-blue-600 text-white font-semibold hover:bg-blue-700 text-inherit shrink-0"
            >
              + Tambah Reservasi
            </button>
            <button
              type="button"
              onClick={() => { setRefundExcPrefillReservation(null); setRefundExcModalOpen(true); }}
              className="h-full px-3 rounded-md bg-blue-600 text-white font-semibold hover:bg-blue-700 shrink-0"
            >
              Refund Eksepsi
            </button>
          </>
        )}
        <div className="ml-auto flex items-center h-full shrink-0">
          <div className="flex items-center gap-0.5 h-full rounded-md border border-slate-200 p-0.5 bg-slate-50">
            <button
              type="button"
              onClick={() => setActiveTab('reservations')}
              className={`h-full min-h-0 px-2.5 rounded text-inherit font-medium transition-colors ${activeTab === 'reservations' ? 'bg-white text-slate-800 shadow' : 'text-slate-600 hover:text-slate-800'}`}
            >
              Reservasi
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('keuangan')}
              className={`h-full min-h-0 px-2.5 rounded text-inherit font-medium transition-colors ${activeTab === 'keuangan' ? 'bg-white text-slate-800 shadow' : 'text-slate-600 hover:text-slate-800'}`}
            >
              Keuangan
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('log')}
              className={`h-full min-h-0 px-2.5 rounded text-inherit font-medium transition-colors ${activeTab === 'log' ? 'bg-white text-slate-800 shadow' : 'text-slate-600 hover:text-slate-800'}`}
            >
              Log
            </button>
          </div>
        </div>
        </div>
      </div>
      {vpsError && (
        <div className="mx-4 mt-2 px-4 py-3 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-between gap-3">
          <span className="text-sm text-amber-900">{vpsError}</span>
          <button
            type="button"
            onClick={() => { setVpsError(null); fetchReservations(); fetchReservationLogs(); }}
            className="px-3 py-1.5 rounded-md bg-amber-600 text-white text-sm font-medium hover:bg-amber-700"
          >
            Coba lagi
          </button>
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-hidden relative">
        <div
          className="flex h-full transition-transform duration-300 ease-out"
          style={{
            width: '300%',
            transform: activeTab === 'keuangan'
              ? 'translateX(-33.333333%)'
              : activeTab === 'log'
                ? 'translateX(-66.666667%)'
                : 'translateX(0)',
          }}
        >
          <div className="w-1/3 min-w-0 flex-shrink-0 flex flex-col overflow-hidden min-h-0">
      <div className="flex-1 min-w-0 overflow-auto p-4">
        {loading ? (
          <div className="py-10 text-center text-slate-500 text-sm">Memuat...</div>
        ) : filtered.length === 0 ? (
          <div className="py-10 text-center text-slate-500 text-sm">Tidak ada reservasi.</div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((r) => {
              const tableIds = getTableIdsFromRow(r);
              const tableCount = tableIds.length;
              const itemsCount = getItemsCountFromRow(r);
              const dividerClass = getReservationCardDividerStyles(r);
              return (
                <article
                  key={r.uuid_id}
                  className={`rounded-lg border border-l-4 shadow-sm p-4 flex flex-col gap-2.5 min-w-0 text-sm ${getReservationCardStyles(r)}`}
                >
                  <div className="flex items-start justify-between gap-3 min-w-0">
                    <div className="min-w-0 flex-1">
                      <h3 className="text-base font-semibold text-slate-900 truncate" title={r.nama}>{r.nama}</h3>
                      <p className="text-sm text-slate-600 mt-1">{formatDateAsString(r.tanggal, r.jam)}</p>
                      <button
                        type="button"
                        onClick={() => handleOpenWa(r.phone)}
                        className="text-sm text-green-600 underline hover:text-green-700 mt-1 truncate block max-w-full text-left"
                        title={r.phone}
                      >
                        {formatPhoneDisplay(r.phone)}
                      </button>
                    </div>
                    <div className="shrink-0">
                      {!r.deleted_at ? (
                        <select
                          value={(r.status || 'upcoming').toLowerCase()}
                          onChange={(e) => handleReservationStatusChange(r, e.target.value as 'upcoming' | 'attended' | 'cancelled')}
                          className="border border-slate-300 rounded px-2.5 py-1.5 text-sm font-medium bg-white text-slate-800 cursor-pointer"
                          onClick={(ev) => ev.stopPropagation()}
                        >
                          <option value="upcoming">{RESERVATION_STATUS_LABELS.upcoming}</option>
                          <option value="attended">{RESERVATION_STATUS_LABELS.attended}</option>
                          <option value="cancelled">{RESERVATION_STATUS_LABELS.cancelled}</option>
                        </select>
                      ) : (
                        statusBadge(r)
                      )}
                    </div>
                  </div>

                  <dl className={`grid grid-cols-2 gap-x-4 gap-y-2 text-sm border-t pt-2.5 ${dividerClass}`}>
                    <div>
                      <dt className="text-xs text-slate-500 uppercase tracking-wide">Pax</dt>
                      <dd className="font-medium text-slate-800 mt-0.5">{r.pax}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500 uppercase tracking-wide">Meja</dt>
                      <dd className="font-medium text-slate-800 mt-0.5">
                        {tableCount === 0 ? (
                          <span className="text-slate-400">-</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => { setLayoutModalRow(r); setLayoutModalSize(null); }}
                            className="text-blue-600 hover:text-blue-800 underline"
                          >
                            {tableCount} meja
                          </button>
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500 uppercase tracking-wide">Produk</dt>
                      <dd className="mt-0.5">
                        {(r.status || 'upcoming').toLowerCase() === 'upcoming' && onPickProductsFromKasir && !r.deleted_at ? (
                          <button
                            type="button"
                            onClick={() => onPickProductsFromKasir(r)}
                            className={
                              itemsCount > 0
                                ? 'inline-block px-2 py-0.5 rounded-full bg-violet-100 text-violet-800 text-xs font-semibold hover:bg-violet-200 underline-offset-2 hover:underline cursor-pointer'
                                : 'text-violet-700 text-xs font-semibold hover:text-violet-900 underline'
                            }
                            title="Klik untuk pilih atau ubah menu reservasi"
                          >
                            {itemsCount > 0 ? `${itemsCount} item · ubah` : 'Pilih menu'}
                          </button>
                        ) : itemsCount > 0 ? (
                          <span className="inline-block px-2 py-0.5 rounded-full bg-violet-100 text-violet-800 text-xs font-semibold">
                            {itemsCount} item
                          </span>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500 uppercase tracking-wide">DP</dt>
                      <dd className="font-medium text-slate-800 mt-0.5">
                        {formatRupiah(getReservationRecordedDp(r) || parseMoneyFromDb(r.dp))}
                        <span className={`ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                          isDpRecorded(r) ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
                        }`}>
                          {isDpRecorded(r) ? '✓ tercatat' : 'belum tercatat'}
                        </span>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500 uppercase tracking-wide">Sisa</dt>
                      <dd className="font-medium text-slate-800 mt-0.5">
                        {(r.payment_status ?? 'none') === 'paid'
                          ? <span className="text-emerald-700">Lunas</span>
                          : formatRupiah(getReservationSisaBayar(r))}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500 uppercase tracking-wide">Total</dt>
                      <dd className="font-medium text-slate-800 mt-0.5">{formatRupiah(getTotalFromSavedMenu(r))}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500 uppercase tracking-wide">PJ</dt>
                      <dd className="font-medium text-slate-800 truncate mt-0.5" title={getEmployeeName(r.penanggung_jawab_id)}>
                        {getEmployeeName(r.penanggung_jawab_id)}
                      </dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-xs text-slate-500 uppercase tracking-wide">Ditambah oleh</dt>
                      <dd className="text-slate-700 truncate mt-0.5" title={r.created_by_email ?? undefined}>{r.created_by_email ?? '—'}</dd>
                    </div>
                  </dl>

                  {!r.deleted_at && (
                    <div className={`flex flex-col gap-1.5 border-t pt-2.5 mt-auto ${dividerClass}`}>
                      {(r.status || 'upcoming').toLowerCase() === 'upcoming' && !isDpRecorded(r) && (
                        <button
                          type="button"
                          onClick={() => { setRecordDpReservation(r); setRecordDpModalOpen(true); }}
                          className="w-full px-3 py-2 text-sm font-bold rounded bg-sky-600 text-white hover:bg-sky-700"
                        >
                          Catat DP
                        </button>
                      )}
                      {(r.status || 'upcoming').toLowerCase() === 'upcoming' && (
                        <>
                          {onPickProductsFromKasir && (
                            <button
                              type="button"
                              onClick={() => onPickProductsFromKasir(r)}
                              className="w-full px-3 py-2 text-sm font-bold rounded bg-violet-600 text-white hover:bg-violet-700"
                            >
                              Pilih / Ubah menu reservasi
                            </button>
                          )}
                          {onSendToKasir && canSendReservationToKasir(r.tanggal) && (
                            <button
                              type="button"
                              onClick={() => handleSendToKasir(r)}
                              className="w-full px-3 py-2 text-sm font-bold rounded bg-green-600 text-white hover:bg-green-700"
                            >
                              Pindahkan menu ke Simpan Order Kasir
                            </button>
                          )}
                        </>
                      )}
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => { setRefundExcPrefillReservation(r); setRefundExcModalOpen(true); }}
                          className="flex-1 px-3 py-2 text-sm font-bold rounded bg-blue-600 text-white hover:bg-blue-700"
                        >
                          Refund Eksepsi
                        </button>
                        <button
                          type="button"
                          onClick={() => openEdit(r)}
                          className="flex-1 px-3 py-2 text-sm border border-slate-300 rounded bg-white text-slate-700 hover:bg-slate-50"
                        >
                          Edit
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => openArchiveModal(r)}
                        className="w-full px-3 py-2 text-sm border border-red-200 rounded bg-white text-red-600 hover:bg-red-50"
                      >
                        Hapus
                      </button>
                    </div>
                  )}

                  {r.deleted_at && canPermanentDelete && (
                    <div className={`flex flex-col gap-1.5 border-t pt-2.5 mt-auto ${dividerClass}`}>
                      {r.deleted_reason ? (
                        <p className="text-xs text-slate-500">
                          <span className="font-semibold">Alasan arsip:</span> {r.deleted_reason}
                        </p>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => openPermanentDeleteModal(r)}
                        className="w-full px-3 py-2 text-sm font-bold rounded bg-red-700 text-white hover:bg-red-800"
                        title="Super Admin — hapus permanen dari POS dan VPS"
                      >
                        Hapus Permanen
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>
          </div>
          <div className="w-1/3 min-w-0 flex-shrink-0 flex flex-col overflow-hidden min-h-0">
            <ReservationFinancePanel
              businessId={businessId}
              refreshTrigger={financeRefreshTrigger}
              onViewReservation={handleViewReservationFromFinance}
            />
          </div>
          <div className="w-1/3 min-w-0 flex-shrink-0 flex flex-col overflow-hidden">
        <div className="flex-1 flex flex-col overflow-hidden p-5">
          <div className="bg-white rounded-lg shadow border border-slate-200 overflow-hidden flex flex-col flex-1 min-h-0">
            <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap gap-3 items-center">
              <span className="text-sm font-semibold text-slate-700 uppercase tracking-wide mr-2">Filter</span>
              <select
                value={logFilterAction}
                onChange={(e) => setLogFilterAction(e.target.value as LogActionFilter)}
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white text-slate-900"
              >
                <option value="all">Semua aksi</option>
                <option value="reservation_create">Buat</option>
                <option value="reservation_update">Edit</option>
                <option value="reservation_delete">Hapus</option>
                <option value="reservation_archive">Arsip</option>
                <option value="reservation_send_to_kasir">Kirim ke Kasir</option>
              </select>
              <input
                type="date"
                placeholder="Dari"
                value={logFilterDateFrom}
                onChange={(e) => setLogFilterDateFrom(e.target.value)}
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white text-slate-900"
              />
              <input
                type="date"
                placeholder="Sampai"
                value={logFilterDateTo}
                onChange={(e) => setLogFilterDateTo(e.target.value)}
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white text-slate-900"
              />
            </div>
            <div className="flex-1 overflow-auto min-h-0 overflow-x-auto">
              <table className="w-full border-collapse table-fixed">
                <thead className="bg-slate-50 border-b border-slate-200 sticky top-0">
                  <tr>
                    <th className="text-left py-2.5 px-3 text-xs font-semibold text-slate-600 uppercase w-28">Waktu</th>
                    <th className="text-left py-2.5 px-3 text-xs font-semibold text-slate-600 uppercase w-28">User</th>
                    <th className="text-left py-2.5 px-3 text-xs font-semibold text-slate-600 uppercase w-20">Aksi</th>
                    <th className="text-left py-2.5 px-3 text-xs font-semibold text-slate-600 uppercase w-48">Reservasi</th>
                    <th className="text-left py-2.5 px-3 text-xs font-semibold text-slate-600 uppercase w-20">Lihat</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLogs.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-500 text-sm">
                        Tidak ada log.
                      </td>
                    </tr>
                  ) : (
                    filteredLogs.map((log) => {
                      const detailsText = formatLogDetails(log.details);
                      return (
                        <tr key={log.id} className="border-b border-slate-100 hover:bg-slate-50">
                          <td className="py-2.5 px-3 text-sm text-slate-600 whitespace-nowrap">{formatLogTime(log.created_at)}</td>
                          <td className="py-2.5 px-3 text-sm text-slate-800 max-w-0 truncate" title={getUserDisplay(log)}>{getUserDisplay(log)}</td>
                          <td className="py-2.5 px-3 max-w-0 truncate">
                            <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                              log.action === 'reservation_archive' ? 'bg-amber-100 text-amber-800' :
                              log.action === 'reservation_delete' ? 'bg-red-100 text-red-800' :
                              log.action === 'reservation_create' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'
                            }`}>
                              {formatLogAction(log.action)}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-sm text-slate-700 max-w-0 truncate" title={detailsText}>{detailsText}</td>
                          <td className="py-2.5 px-3 w-20">
                            <button
                              type="button"
                              onClick={() => setLogDetailModal(log)}
                              className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                            >
                              Detail
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
          </div>
        </div>
      </div>

      <ReservationFormModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingReservation(null);
        }}
        onSaved={({ tanggal, saved }) => {
          setFilterDateFrom(tanggal);
          setFilterDateTo(tanggal);
          setFilterStatus('all');
          setSearchQuery('');
          setReservations((prev) => {
            const idx = prev.findIndex((r) => r.uuid_id === saved.uuid_id);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = { ...next[idx], ...saved };
              return next;
            }
            return [saved, ...prev];
          });
          fetchReservationLogs();
        }}
        businessId={businessId}
        reservation={editingReservation}
        userEmail={userEmail}
        employees={employees}
        onLogActivity={logReservationActivity}
        onPickProductsFromKasir={onPickProductsFromKasir}
      />

      <ReservationCalendarModal
        isOpen={calendarModalOpen}
        onClose={() => setCalendarModalOpen(false)}
        businessId={businessId}
        onSelectDateForFilter={(dateStr) => {
          setFilterDateFrom(dateStr);
          setFilterDateTo(dateStr);
          setCalendarModalOpen(false);
        }}
      />

      <RecordDpModal
        isOpen={recordDpModalOpen}
        onClose={() => { setRecordDpModalOpen(false); setRecordDpReservation(null); }}
        onSaved={() => { fetchReservations(); bumpFinanceRefresh(); }}
        businessId={businessId}
        userId={userId}
        reservation={recordDpReservation}
      />

      <RefundExcModal
        isOpen={refundExcModalOpen}
        onClose={() => { setRefundExcModalOpen(false); setRefundExcPrefillReservation(null); }}
        onSaved={() => bumpFinanceRefresh()}
        businessId={businessId}
        userId={userId}
        initialReservation={refundExcPrefillReservation}
      />

      {layoutModalRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => { setLayoutModalRow(null); setLayoutModalSize(null); }}>
          <div
            className="bg-white rounded-xl shadow-xl flex flex-col overflow-hidden"
            style={{ width: layoutModalSize ? layoutModalSize.width + 32 : undefined, maxWidth: '94vw', maxHeight: '90vh' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 shrink-0">
              <h3 className="text-base font-semibold text-slate-800">Layout meja — {layoutModalRow.nama}</h3>
              <button type="button" onClick={() => { setLayoutModalRow(null); setLayoutModalSize(null); }} className="p-1.5 text-slate-500 hover:text-slate-700 rounded" aria-label="Tutup">✕</button>
            </div>
            <div
              className="overflow-auto flex-1 min-h-0 p-4"
              style={layoutModalSize ? { width: layoutModalSize.width, height: layoutModalSize.height, minHeight: 200 } : { minHeight: 280 }}
            >
              <ReservationTablePicker
                businessId={businessId}
                selectedTableIds={getTableIdsFromRow(layoutModalRow)}
                onChange={() => {}}
                readOnly
                onLayoutSizeReady={handleLayoutSizeReady}
              />
            </div>
          </div>
        </div>
      )}

      {archiveModalRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => { setArchiveModalRow(null); setArchiveReason(''); }}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
              <h3 className="text-base font-semibold text-slate-800">Arsip reservasi</h3>
              <button type="button" onClick={() => { setArchiveModalRow(null); setArchiveReason(''); }} className="p-1.5 text-slate-500 hover:text-slate-700 rounded" aria-label="Tutup">✕</button>
            </div>
            <div className="px-4 py-4 space-y-3">
              <p className="text-sm text-slate-600">
                Reservasi <strong>{String(archiveModalRow.nama ?? '')}</strong> ({(archiveModalRow.tanggal as unknown) instanceof Date ? (archiveModalRow.tanggal as unknown as Date).toISOString().slice(0, 10) : String(archiveModalRow.tanggal ?? '')} {(archiveModalRow.jam as unknown) instanceof Date ? (archiveModalRow.jam as unknown as Date).toTimeString().slice(0, 5) : String(archiveModalRow.jam ?? '')}) akan diarsipkan. Data tidak dihapus permanen.
              </p>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Alasan arsip (wajib)</label>
                <textarea
                  value={archiveReason}
                  onChange={(e) => setArchiveReason(e.target.value)}
                  placeholder="Contoh: Pembatalan oleh customer, double booking, ..."
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white text-slate-900 placeholder:text-slate-500 min-h-[80px] resize-y"
                  rows={3}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-slate-200">
              <button
                type="button"
                onClick={() => { setArchiveModalRow(null); setArchiveReason(''); }}
                className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 font-medium"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleArchiveConfirm}
                disabled={!archiveReason.trim()}
                className="px-4 py-2 rounded-lg bg-amber-600 text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-amber-700"
              >
                Arsip
              </button>
            </div>
          </div>
        </div>
      )}

      {permanentDeleteRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => { setPermanentDeleteRow(null); setPermanentDeleteReason(''); }}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-red-200 bg-red-50">
              <h3 className="text-base font-bold text-red-800">Hapus Permanen (Super Admin)</h3>
              <button type="button" onClick={() => { setPermanentDeleteRow(null); setPermanentDeleteReason(''); }} className="p-1.5 text-slate-500 hover:text-slate-700 rounded" aria-label="Tutup">✕</button>
            </div>
            <div className="px-4 py-4 space-y-3">
              <p className="text-sm text-slate-700">
                Reservasi <strong>{String(permanentDeleteRow.nama ?? '')}</strong> akan dihapus permanen dari database POS <strong>dan</strong> Salespulse (VPS).
              </p>
              <ul className="text-xs text-slate-600 list-disc pl-4 space-y-1">
                <li>Catatan DP / pembayaran reservasi ikut terhapus</li>
                <li>Transaksi kasir (jika sudah bayar) <strong>tidak</strong> dihapus</li>
                <li>Log aktivitas reservasi tetap ada</li>
                <li>Membutuhkan koneksi internet ke VPS</li>
              </ul>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Alasan hapus permanen (wajib)</label>
                <textarea
                  value={permanentDeleteReason}
                  onChange={(e) => setPermanentDeleteReason(e.target.value)}
                  placeholder="Contoh: Data uji, duplikat, salah input permanen..."
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white text-slate-900 placeholder:text-slate-500 min-h-[80px] resize-y"
                  rows={3}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-slate-200">
              <button
                type="button"
                onClick={() => { setPermanentDeleteRow(null); setPermanentDeleteReason(''); }}
                className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 font-medium"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handlePermanentDeleteConfirm}
                disabled={!permanentDeleteReason.trim()}
                className="px-4 py-2 rounded-lg bg-red-700 text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-red-800"
              >
                Hapus Permanen
              </button>
            </div>
          </div>
        </div>
      )}

      {logDetailModal && (() => {
        const d = parseLogDetails(logDetailModal.details);
        const tableIds = (() => {
          const raw = d?.table_ids_json;
          if (Array.isArray(raw)) return raw.map((id) => Number(id)).filter((id) => !Number.isNaN(id));
          if (typeof raw === 'string') {
            try {
              const arr = JSON.parse(raw);
              return Array.isArray(arr) ? arr.map((id: unknown) => Number(id)).filter((id: number) => !Number.isNaN(id)) : [];
            } catch { return []; }
          }
          return [];
        })();
        const tableLabel = tableIds.length === 0 ? '-' : tableIds.map((id) => tablesMap[id] ?? `#${id}`).join(', ');
        const pjId = d?.penanggung_jawab_id != null ? Number(d.penanggung_jawab_id) : null;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setLogDetailModal(null)}>
            <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 shrink-0">
                <h3 className="text-base font-semibold text-slate-800">Detail log aktivitas</h3>
                <button type="button" onClick={() => setLogDetailModal(null)} className="p-1.5 text-slate-500 hover:text-slate-700 rounded" aria-label="Tutup">✕</button>
              </div>
              <div className="px-4 py-4 overflow-auto space-y-4">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  <span className="text-slate-500">Waktu</span>
                  <span className="text-slate-800">{formatLogTime(logDetailModal.created_at)}</span>
                  <span className="text-slate-500">User</span>
                  <span className="text-slate-800">{getUserDisplay(logDetailModal)}</span>
                  <span className="text-slate-500">Aksi</span>
                  <span>
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                      logDetailModal.action === 'reservation_archive' ? 'bg-amber-100 text-amber-800' :
                      logDetailModal.action === 'reservation_delete' ? 'bg-red-100 text-red-800' :
                      logDetailModal.action === 'reservation_create' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'
                    }`}>
                      {formatLogAction(logDetailModal.action)}
                    </span>
                  </span>
                </div>
                <div className="border-t border-slate-200 pt-3">
                  <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Data reservasi</h4>
                  <dl className="grid grid-cols-[100px_1fr] gap-x-3 gap-y-1.5 text-sm">
                    <dt className="text-slate-500">Nama</dt>
                    <dd className="text-slate-800">{d?.nama != null ? String(d.nama) : '-'}</dd>
                    <dt className="text-slate-500">No. HP</dt>
                    <dd className="text-slate-800">{d?.phone != null ? formatPhoneDisplay(String(d.phone)) : '-'}</dd>
                    <dt className="text-slate-500">Tanggal</dt>
                    <dd className="text-slate-800">{formatDetailDate(d?.tanggal)}</dd>
                    <dt className="text-slate-500">Jam</dt>
                    <dd className="text-slate-800">{formatDetailTime(d?.jam)}</dd>
                    <dt className="text-slate-500">Pax</dt>
                    <dd className="text-slate-800">{d?.pax != null ? String(d.pax) : '-'}</dd>
                    <dt className="text-slate-500">Meja</dt>
                    <dd className="text-slate-800">{tableLabel}</dd>
                    <dt className="text-slate-500">DP</dt>
                    <dd className="text-slate-800">{d?.dp != null ? formatRupiah(parseMoneyFromDb(d.dp)) : '-'}</dd>
                    <dt className="text-slate-500">Total</dt>
                    <dd className="text-slate-800">{(() => {
                      const items = parseReservationItemsJson((d?.items_json ?? null) as string | unknown[] | null | undefined);
                      const total = items.length > 0 ? computeTotalFromReservationItems(items) : parseMoneyFromDb(d?.total_price);
                      return total > 0 || d?.total_price != null ? formatRupiah(total) : '-';
                    })()}</dd>
                    <dt className="text-slate-500">PJ</dt>
                    <dd className="text-slate-800">{pjId != null ? getEmployeeName(pjId) : '-'}</dd>
                    <dt className="text-slate-500">Status</dt>
                    <dd className="text-slate-800">{d?.status != null ? String(d.status) : '-'}</dd>
                    {d?.note ? (
                      <>
                        <dt className="text-slate-500">Catatan</dt>
                        <dd className="text-slate-800">{String(d.note)}</dd>
                      </>
                    ) : null}
                    {d?.reason != null && String(d.reason).trim() ? (
                      <>
                        <dt className="text-slate-500">Alasan arsip</dt>
                        <dd className="text-slate-800">{String(d.reason)}</dd>
                      </>
                    ) : null}
                  </dl>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

    </div>
  );
}
