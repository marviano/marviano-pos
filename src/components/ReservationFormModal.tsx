'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { generateUUID } from '@/lib/uuid';
import { getTodayUTC7 } from '@/lib/dateUtils';
import { formatPhoneDisplay, formatNumberForInput, parseNumberInput, stripPhoneForDb } from '@/lib/formatUtils';
import { parseReservationItemsJson, computeTotalFromReservationItems } from '@/lib/reservationItems';
import { appAlert } from '@/components/AppDialog';
import { fetchFromVps, initApiUrlCache } from '@/lib/api';
import ReservationTablePicker from './ReservationTablePicker';

export type ReservationRow = {
  id?: number;
  uuid_id: string;
  business_id: number;
  nama: string;
  phone: string;
  tanggal: string;
  jam: string;
  pax: number;
  dp: number;
  total_price: number;
  table_ids_json: string | number[] | null;
  items_json?: string | unknown[] | null;
  penanggung_jawab_id: number | null;
  created_by_email?: string | null;
  note: string | null;
  status: string;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
  deleted_reason?: string | null;
};

type ContactSuggestion = { id: number; nama: string; phone_number: string };

interface ReservationFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called after save. Optionally pass saved tanggal (YYYY-MM-DD) so the list can update its date filter and show the row. */
  onSaved: (savedTanggal?: string) => void;
  businessId: number;
  reservation?: ReservationRow | null;
  userEmail?: string | null;
  /** Pre-fetched employees (PJ list) from VPS; if not provided, modal will fetch from VPS when open. */
  employees?: Record<string, unknown>[];
  onLogActivity?: (action: string, details: Record<string, unknown>) => Promise<void>;
  /** Called when user clicks "Pilih Produk dari Kasir" – parent should switch to Kasir and set pre-order mode with this reservation. */
  onPickProductsFromKasir?: (reservation: ReservationRow) => void;
}

const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;

function normalizePhoneForVps(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('0')) return '62' + digits.slice(1);
  if (!digits.startsWith('62')) return '62' + digits;
  return digits;
}

export default function ReservationFormModal({
  isOpen,
  onClose,
  onSaved,
  businessId,
  reservation,
  userEmail,
  employees: employeesProp,
  onLogActivity,
  onPickProductsFromKasir
}: ReservationFormModalProps) {
  const isEdit = !!reservation?.uuid_id;
  const [nama, setNama] = useState('');
  const [phone, setPhone] = useState('');
  const [tanggal, setTanggal] = useState('');
  const [jam, setJam] = useState('');
  const [pax, setPax] = useState(1);
  const [status, setStatus] = useState<'upcoming' | 'attended' | 'cancelled'>('upcoming');
  const [dp, setDp] = useState(0);
  const [selectedTableIds, setSelectedTableIds] = useState<number[]>([]);
  const [penanggungJawabId, setPenanggungJawabId] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [employees, setEmployees] = useState<Record<string, unknown>[]>([]);
  const [contactSuggestions, setContactSuggestions] = useState<ContactSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [suggestionAnchor, setSuggestionAnchor] = useState<'nama' | 'phone' | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modalContentRef = useRef<HTMLDivElement>(null);
  const backdropMouseDownRef = useRef(false);

  // Normalize date to YYYY-MM-DD for type="date"
  const normalizeTanggal = (v: unknown): string => {
    if (v == null) return '';
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    const s = String(v).trim();
    if (!s) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    if (s.includes('T')) return s.slice(0, 10);
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
  };
  // Normalize time to HH:mm for type="time"
  const normalizeJam = (v: unknown): string => {
    if (v == null) return '';
    if (v instanceof Date) return v.toTimeString().slice(0, 5);
    const s = String(v).trim();
    if (!s) return '';
    if (s.length >= 5 && /^\d{1,2}:\d{2}/.test(s)) return s.slice(0, 5);
    const d = new Date('1970-01-01T' + s);
    return Number.isNaN(d.getTime()) ? '' : d.toTimeString().slice(0, 5);
  };

  useEffect(() => {
    if (!isOpen) return;
    if (reservation) {
      setNama(reservation.nama ?? '');
      setPhone(stripPhoneForDb(reservation.phone ?? ''));
      setTanggal(normalizeTanggal(reservation.tanggal));
      setJam(normalizeJam(reservation.jam));
      setPax(Number(reservation.pax) || 1);
      setStatus((reservation.status as 'upcoming' | 'attended' | 'cancelled') || 'upcoming');
      setDp(Number(reservation.dp) || 0);
      setNote(reservation.note ?? '');
      setPenanggungJawabId(reservation.penanggung_jawab_id ?? null);
      const raw = reservation.table_ids_json;
      if (Array.isArray(raw)) setSelectedTableIds(raw);
      else if (typeof raw === 'string') {
        try {
          const arr = JSON.parse(raw);
          setSelectedTableIds(Array.isArray(arr) ? arr : []);
        } catch {
          setSelectedTableIds([]);
        }
      } else setSelectedTableIds([]);
    } else {
      setNama('');
      setPhone('');
      setTanggal(getTodayUTC7());
      setJam('18:00');
      setPax(1);
      setStatus('upcoming');
      setDp(0);
      setSelectedTableIds([]);
      setPenanggungJawabId(null);
      setNote('');
    }
  }, [isOpen, reservation]);

  useEffect(() => {
    if (!isOpen) return;
    if (employeesProp !== undefined) {
      setEmployees(Array.isArray(employeesProp) ? employeesProp : []);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        await initApiUrlCache();
        const list = await fetchFromVps<Record<string, unknown>[]>(`/api/employees?business_id=${businessId}`);
        if (!cancelled) setEmployees(Array.isArray(list) ? list : []);
      } catch {
        if (!cancelled) setEmployees([]);
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, businessId, employeesProp]);

  const runSearch = useCallback((query: string, anchor: 'nama' | 'phone') => {
    const api = window.electronAPI;
    if (!api?.localDbSearchContacts || query.length < MIN_QUERY_LENGTH) {
      setContactSuggestions([]);
      setIsSearching(false);
      return;
    }
    setSuggestionAnchor(anchor);
    setShowSuggestions(true);
    setIsSearching(true);
    api.localDbSearchContacts(query).then((rows: unknown) => {
      setContactSuggestions(Array.isArray(rows) ? (rows as ContactSuggestion[]) : []);
      setIsSearching(false);
    }).catch(() => {
      setContactSuggestions([]);
      setIsSearching(false);
    });
  }, []);

  const scheduleSearch = useCallback((value: string, anchor: 'nama' | 'phone') => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim().length < MIN_QUERY_LENGTH) {
      setShowSuggestions(false);
      setSuggestionAnchor(null);
      setContactSuggestions([]);
      return;
    }
    debounceRef.current = setTimeout(() => runSearch(value.trim(), anchor), DEBOUNCE_MS);
  }, [runSearch]);

  const closeSuggestions = useCallback(() => {
    setShowSuggestions(false);
    setSuggestionAnchor(null);
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, []);

  const handleSelectSuggestion = useCallback((s: ContactSuggestion) => {
    setNama(s.nama);
    setPhone(stripPhoneForDb(s.phone_number ?? ''));
    closeSuggestions();
  }, [closeSuggestions]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSuggestions();
    };
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-autocomplete-area]')) closeSuggestions();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onMouseDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onMouseDown);
    };
  }, [isOpen, closeSuggestions]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nama.trim()) return;
    if (!phone.trim()) return;
    if (!tanggal || !jam) return;
    if (pax < 1) return;

    setSaving(true);
    try {
      await initApiUrlCache();
      const tableIdsJson = selectedTableIds.length > 0 ? selectedTableIds : null;
      const phoneForDb = stripPhoneForDb(phone);
      const jamNorm = jam.length === 5 ? jam : `${jam}:00`.slice(0, 5);
      const itemsForTotal = parseReservationItemsJson(reservation?.items_json ?? null);
      const computedTotal = isEdit ? computeTotalFromReservationItems(itemsForTotal) : 0;

      const payload = {
        uuid_id: isEdit && reservation?.uuid_id ? reservation.uuid_id : generateUUID(),
        business_id: businessId,
        nama: nama.trim(),
        phone: phoneForDb,
        tanggal,
        jam: jamNorm,
        pax,
        status,
        dp: Number(dp) || 0,
        total_price: isEdit ? computedTotal : 0,
        table_ids_json: tableIdsJson,
        items_json: isEdit && reservation?.items_json != null ? reservation.items_json : null,
        penanggung_jawab_id: penanggungJawabId,
        created_by_email: userEmail ?? null,
        note: note.trim() || null,
      };

      await fetchFromVps('/api/reservations', {
        method: 'POST',
        body: JSON.stringify({ reservations: [payload] }),
      });

      if (onLogActivity) {
        await onLogActivity(isEdit ? 'reservation_update' : 'reservation_create', {
          uuid_id: payload.uuid_id,
          nama: payload.nama,
          phone: payload.phone,
          tanggal: payload.tanggal,
          jam: payload.jam,
          pax: payload.pax,
          status: payload.status,
          dp: payload.dp,
          total_price: payload.total_price,
          table_ids_json: payload.table_ids_json,
          penanggung_jawab_id: payload.penanggung_jawab_id,
          note: payload.note,
        });
      }
      const api = window.electronAPI;
      if (userEmail && api?.vpsCreateContact) {
        const normalizedPhone = normalizePhoneForVps(phoneForDb);
        api.vpsCreateContact({ nama: nama.trim(), phone_number: normalizedPhone, created_by_email: userEmail, business_id: businessId })
          .then((vpsResult: { success?: boolean; error?: string }) => {
            if (vpsResult?.success === false && (vpsResult?.error === 'HTTP 404' || String(vpsResult?.error || '').includes('404'))) {
              appAlert('Reservasi tersimpan. Kontak tidak bisa disinkronkan ke CRM (server mengembalikan 404). Pastikan URL API di pengaturan mengarah ke Salespulse yang sudah di-deploy dengan fitur kontak POS, dan POS_WRITE_API_KEY di server sudah diatur.');
            }
          })
          .catch((err: unknown) => {
            console.warn('[ReservationFormModal] VPS contact insert failed (fire-and-forget):', err);
          });
      }
      onSaved(tanggal);
      onClose();
    } catch (err) {
      await appAlert(err instanceof Error ? err.message : 'Gagal menyimpan reservasi.');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  const renderSuggestionsDropdown = (anchor: 'nama' | 'phone') => {
    if (suggestionAnchor !== anchor || !showSuggestions) return null;
    return (
      <div className="absolute top-full left-0 right-0 z-[100] mt-0.5 bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden">
        {isSearching ? (
          <div className="px-3 py-2.5 flex items-center gap-2 text-slate-500 text-sm">
            <span className="inline-block w-3.5 h-3.5 border-2 border-slate-200 border-t-blue-500 rounded-full animate-spin flex-shrink-0" />
            Mencari kontak...
          </div>
        ) : contactSuggestions.length === 0 ? (
          <div className="px-3 py-2 text-slate-500 text-sm">Tidak ada kontak ditemukan</div>
        ) : (
          contactSuggestions.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => handleSelectSuggestion(s)}
              className="w-full text-left px-3 py-2 border-b border-slate-100 last:border-b-0 hover:bg-sky-50 flex flex-col gap-0.5"
            >
              <span className="font-semibold text-slate-800 text-sm">{s.nama}</span>
              <span className="text-slate-500 text-xs">{formatPhoneDisplay(s.phone_number ?? '')}</span>
            </button>
          ))
        )}
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) backdropMouseDownRef.current = true;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && backdropMouseDownRef.current) onClose();
        backdropMouseDownRef.current = false;
      }}
    >
      <div
        ref={modalContentRef}
        className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col"
        onMouseDown={() => { backdropMouseDownRef.current = false; }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <h2 className="text-lg font-bold text-slate-800">
            {isEdit ? 'Edit Reservasi' : 'Tambah Reservasi'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-500 hover:text-slate-700 rounded"
            aria-label="Tutup"
          >
            ✕
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto px-5 py-4 grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1 relative" data-autocomplete-area="nama">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Nama</label>
              <input
                type="text"
                value={nama}
                onChange={(e) => {
                  setNama(e.target.value);
                  scheduleSearch(e.target.value, 'nama');
                }}
                onFocus={() => { if (nama.trim().length >= MIN_QUERY_LENGTH) runSearch(nama.trim(), 'nama'); }}
                placeholder="Nama pemesan"
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white text-slate-900 placeholder:text-slate-500"
                required
                autoComplete="off"
              />
              {renderSuggestionsDropdown('nama')}
              <span className="text-[11px] text-slate-400 mt-0.5">Ketik untuk mencari kontak yang sudah ada</span>
            </div>
            <div className="flex flex-col gap-1 relative" data-autocomplete-area="phone">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">No. HP (WhatsApp)</label>
              <input
                type="tel"
                value={formatPhoneDisplay(phone)}
                onChange={(e) => {
                  const digits = stripPhoneForDb(e.target.value);
                  setPhone(digits);
                  scheduleSearch(digits, 'phone');
                }}
                maxLength={16}
                onFocus={() => { if (stripPhoneForDb(phone).length >= MIN_QUERY_LENGTH) runSearch(stripPhoneForDb(phone), 'phone'); }}
                placeholder="0822-3466-2863"
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white text-slate-900 placeholder:text-slate-500"
                required
                autoComplete="off"
              />
              {renderSuggestionsDropdown('phone')}
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Tanggal</label>
              <input
                type="date"
                value={tanggal}
                onChange={(e) => setTanggal(e.target.value)}
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white text-slate-900 placeholder:text-slate-500"
                required
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Jam</label>
              <input
                type="time"
                value={jam}
                onChange={(e) => setJam(e.target.value)}
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white text-slate-900 placeholder:text-slate-500"
                required
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Pax</label>
              <input
                type="number"
                min={1}
                value={pax}
                onChange={(e) => setPax(Math.max(1, parseInt(e.target.value, 10) || 1))}
                placeholder="Jumlah tamu"
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white text-slate-900 placeholder:text-slate-500"
                required
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as 'upcoming' | 'attended' | 'cancelled')}
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white text-slate-900 placeholder:text-slate-500"
              >
                <option value="upcoming">Upcoming</option>
                <option value="attended">Attended</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">DP (Down Payment)</label>
              <input
                type="text"
                inputMode="numeric"
                value={formatNumberForInput(dp)}
                onChange={(e) => setDp(parseNumberInput(e.target.value))}
                placeholder="0"
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white text-slate-900 placeholder:text-slate-500"
              />
            </div>

            <div className="col-span-2 flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Meja</label>
              <ReservationTablePicker
                businessId={businessId}
                selectedTableIds={selectedTableIds}
                onChange={setSelectedTableIds}
              />
            </div>

            {onPickProductsFromKasir && (
              <div className="col-span-2 border border-dashed border-slate-300 rounded-lg p-3 bg-emerald-50/50 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-emerald-800">Pre-Order Produk</div>
                  <div className="text-xs text-emerald-700 mt-0.5">
                    {(() => {
                      const raw = reservation?.items_json;
                      const arr = Array.isArray(raw) ? raw : (typeof raw === 'string' && raw?.trim() ? (() => { try { return JSON.parse(raw); } catch { return []; } })() : []);
                      const count = Array.isArray(arr) ? arr.length : 0;
                      return (
                        <>
                          {count > 0 ? `${count} produk dipilih` : 'Belum ada produk dipilih'}
                          {count > 0 && <span className="ml-1.5 inline-block px-2 py-0.5 rounded-full bg-emerald-600 text-white text-[11px] font-bold">{count} item</span>}
                        </>
                      );
                    })()}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => reservation && onPickProductsFromKasir(reservation)}
                  className="px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 whitespace-nowrap"
                >
                  {reservation?.items_json ? 'Ubah Produk dari Kasir' : 'Pilih Produk dari Kasir'}
                </button>
              </div>
            )}

            <div className="col-span-2 flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Penanggung Jawab</label>
              <div className="flex flex-wrap gap-2">
                {employees.map((emp) => {
                  const id = Number(emp.id);
                  const name = (emp.nama_karyawan ?? emp.name ?? '') as string;
                  const selected = penanggungJawabId === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setPenanggungJawabId(selected ? null : id)}
                      className={`px-3 py-2 rounded-lg border text-sm ${
                        selected ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white border-slate-300 text-slate-700 hover:border-slate-400'
                      }`}
                    >
                      {name || `ID ${id}`}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="col-span-2 flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Catatan (Note)</label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Catatan tambahan..."
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm min-h-[60px] resize-y bg-white text-slate-900 placeholder:text-slate-500"
                rows={3}
              />
            </div>
            <div className="col-span-2 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5">
              💡 Jika nomor HP tidak ditemukan di kontak, kontak baru akan otomatis dibuat saat klik <strong>Simpan</strong>.
            </div>
          </div>
          <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 font-medium"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white font-semibold disabled:opacity-50"
            >
              {saving ? 'Menyimpan...' : 'Simpan'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
