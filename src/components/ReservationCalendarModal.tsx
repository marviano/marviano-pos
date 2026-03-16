'use client';

import { useState, useEffect, useCallback } from 'react';
import { getTodayUTC7 } from '@/lib/dateUtils';
import { parseReservationItemsJson, computeTotalFromReservationItems } from '@/lib/reservationItems';
import { fetchFromVps, initApiUrlCache } from '@/lib/api';
import ReservationSeatHeatmap from './ReservationSeatHeatmap';

interface ReservationCalendarModalProps {
  isOpen: boolean;
  onClose: () => void;
  businessId: number;
  /** When set, "Lihat reservasi" will call this with the date and caller can filter the list and close the modal. */
  onSelectDateForFilter?: (dateStr: string) => void;
}

type CountByDate = Record<string, number>;
type SumsByDate = Record<string, { dp: number; total: number }>;

const DAY_HEADERS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

function formatRupiahShort(n: number): string {
  if (n == null || Number.isNaN(n) || n === 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}jt`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}rb`;
  return String(Math.round(n));
}

const MONTH_NAMES = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];

function getBadgeClass(count: number): string {
  if (count === 0) return 'bg-slate-100 text-slate-500';
  if (count >= 7) return 'bg-red-100 text-red-800';
  if (count >= 4) return 'bg-amber-100 text-amber-800';
  return 'bg-green-100 text-green-800';
}

export default function ReservationCalendarModal({ isOpen, onClose, businessId, onSelectDateForFilter }: ReservationCalendarModalProps) {
  const [viewDate, setViewDate] = useState(() => new Date());
  const [counts, setCounts] = useState<CountByDate>({});
  const [sumsByDate, setSumsByDate] = useState<SumsByDate>({});
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [dayReservations, setDayReservations] = useState<Record<string, unknown>[]>([]);
  const [loadingCounts, setLoadingCounts] = useState(true);
  const [loadingReservations, setLoadingReservations] = useState(false);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth() + 1;

  const fetchCounts = useCallback(async () => {
    if (!isOpen) return;
    setLoadingCounts(true);
    try {
      await initApiUrlCache();
      const res = await fetchFromVps<{ success?: boolean; counts?: Array<{ tanggal: string; count: number; sum_dp: number; sum_total: number }> }>(
        `/api/reservations/monthly-counts?business_id=${businessId}&year=${year}&month=${month}`
      );
      const countMap: CountByDate = {};
      const sumMap: SumsByDate = {};
      const list = res?.counts ?? [];
      list.forEach((row) => {
        const key = row.tanggal?.slice(0, 10);
        if (!key) return;
        countMap[key] = Number(row.count) || 0;
        sumMap[key] = { dp: Number(row.sum_dp) || 0, total: Number(row.sum_total) || 0 };
      });
      setCounts(countMap);
      setSumsByDate(sumMap);
    } catch (e) {
      console.error('Fetch reservation counts error:', e);
      setCounts({});
      setSumsByDate({});
    } finally {
      setLoadingCounts(false);
    }
  }, [businessId, year, month, isOpen]);

  function normalizeDateKey(tanggal: unknown): string | null {
    if (tanggal == null) return null;
    if (typeof tanggal === 'string') return tanggal.slice(0, 10);
    if (tanggal instanceof Date) return tanggal.toISOString().slice(0, 10);
    const s = String(tanggal);
    const match = s.match(/^\d{4}-\d{2}-\d{2}/);
    return match ? match[0] : s.slice(0, 10);
  }

  useEffect(() => {
    fetchCounts();
  }, [fetchCounts]);

  const handleDateClick = useCallback(
    async (dateStr: string) => {
      setLoadingReservations(true);
      try {
        await initApiUrlCache();
        const res = await fetchFromVps<{ reservations?: Record<string, unknown>[] }>(
          `/api/reservations?business_id=${businessId}&tanggal_from=${dateStr}&tanggal_to=${dateStr}&show_archived=no&limit=500`
        );
        const arr = res?.reservations ?? [];
        setDayReservations(Array.isArray(arr) ? arr : []);
        setSelectedDate(dateStr);
      } catch (e) {
        console.error('Fetch day reservations error:', e);
        setDayReservations([]);
        setSelectedDate(null);
      } finally {
        setLoadingReservations(false);
      }
    },
    [businessId]
  );

  const backToCalendar = useCallback(() => {
    setSelectedDate(null);
    setDayReservations([]);
  }, []);

  if (!isOpen) return null;

  const firstOfMonth = new Date(year, month - 1, 1);
  const lastOfMonth = new Date(year, month, 0);
  const startPad = firstOfMonth.getDay();
  const daysInMonth = lastOfMonth.getDate();
  const todayStr = getTodayUTC7();

  const cells: { dateStr: string | null; dayNum: number; isCurrentMonth: boolean }[] = [];
  for (let i = 0; i < startPad; i++) {
    cells.push({ dateStr: null, dayNum: 0, isCurrentMonth: false });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({ dateStr, dayNum: d, isCurrentMonth: true });
  }

  const selectedDateLabel = selectedDate
    ? (() => {
        const d = new Date(selectedDate + 'T12:00:00');
        return d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
      })()
    : '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      {/* Fixed size 1200×768 for both calendar and layout (max height 768) */}
      <div
        className="bg-white rounded-2xl shadow-xl flex flex-col overflow-hidden"
        style={{ width: 1200, height: 768, maxWidth: '95vw', maxHeight: '90vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
          <h2 className="text-base font-bold text-slate-800">Kalender Reservasi</h2>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setViewDate(new Date(year, month - 2, 1))}
                className="p-2 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200"
                aria-label="Bulan sebelumnya"
              >
                ←
              </button>
              <span className="min-w-[140px] text-center font-bold text-slate-800 text-sm">
                {MONTH_NAMES[month - 1]} {year}
              </span>
              <button
                type="button"
                onClick={() => setViewDate(new Date(year, month, 1))}
                className="p-2 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200"
                aria-label="Bulan berikutnya"
              >
                →
              </button>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-slate-500 hover:text-slate-700 rounded"
              aria-label="Tutup"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-hidden flex flex-col p-4">
          {!selectedDate ? (
            <>
              <div
                className="grid grid-cols-7 gap-px bg-slate-200 rounded-xl overflow-hidden flex-1 min-h-0"
                style={{ gridTemplateRows: 'auto repeat(6, minmax(0, 1fr))' }}
              >
                {DAY_HEADERS.map((h) => (
                  <div
                    key={h}
                    className="bg-slate-50 text-center py-2 text-[11px] font-bold text-slate-500 uppercase"
                  >
                    {h}
                  </div>
                ))}
                {cells.map((cell, idx) => {
                  if (!cell.isCurrentMonth) {
                    return <div key={idx} className="bg-slate-50 min-h-0 p-1.5" />;
                  }
                  const dateStr = cell.dateStr!;
                  const count = counts[dateStr] ?? 0;
                  const sums = sumsByDate[dateStr] ?? { dp: 0, total: 0 };
                  const isToday = dateStr === todayStr;
                  const isSelected = selectedDate === dateStr;
                  return (
                    <div
                      key={idx}
                      className={`min-h-0 p-1.5 flex flex-col gap-0.5 bg-white hover:bg-blue-50/80 text-left rounded-sm overflow-hidden ${
                        isToday ? 'bg-blue-50' : ''
                      } ${isSelected ? 'ring-2 ring-blue-400' : ''} ${loadingReservations ? 'opacity-70' : ''}`}
                    >
                      <div className="flex flex-wrap items-center gap-1 shrink-0">
                        <span className={`text-sm font-semibold ${isToday ? 'text-blue-600' : 'text-slate-700'}`}>
                          {cell.dayNum}
                        </span>
                        <span
                          className={`inline-block w-fit px-1.5 py-0.5 rounded-full text-[11px] font-bold ${getBadgeClass(count)}`}
                        >
                          Reservasi: {count}
                        </span>
                      </div>
                      {count > 0 && (
                        <div className="flex flex-wrap items-center gap-1 mt-0.5 shrink-0">
                          <span className="inline-flex px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-sky-100 text-sky-800 whitespace-nowrap">
                            DP: {formatRupiahShort(sums.dp)}
                          </span>
                          <span className="inline-flex px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-800 whitespace-nowrap">
                            Total: {formatRupiahShort(sums.total)}
                          </span>
                        </div>
                      )}
                      {count > 0 && (
                        <div className="w-full flex gap-1 mt-1 shrink-0 min-h-0">
                          <button
                            type="button"
                            title="Lihat layout meja"
                            disabled={loadingReservations}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!loadingReservations) handleDateClick(dateStr);
                            }}
                            className="xp-button flex-1 min-w-0 py-1.5 px-1 text-[11px] font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            Layout
                          </button>
                          <button
                            type="button"
                            title="Lihat reservasi tanggal ini"
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectDateForFilter?.(dateStr);
                            }}
                            className="xp-button xp-button-primary flex-1 min-w-0 py-1.5 px-1 text-[11px] font-medium"
                          >
                            Reservasi
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-4 text-xs text-slate-500 border-t border-slate-100 pt-2 mt-2 shrink-0">
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-green-200" /> 1–3 reservasi
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-200" /> 4–6 reservasi
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-200" /> 7+ reservasi
                </span>
              </div>
              {loadingReservations && (
                <p className="text-sm text-slate-500 mt-2">Memuat reservasi...</p>
              )}
            </>
          ) : (
            <div className="flex-1 min-h-0 flex flex-col">
              <ReservationSeatHeatmap
                businessId={businessId}
                selectedDate={selectedDate}
                dateLabel={selectedDateLabel}
                reservations={dayReservations as Array<{
                  uuid_id: string;
                  nama: string;
                  phone?: string;
                  jam: string;
                  pax: number;
                  status: string;
                  table_ids_json?: string | number[] | null;
                  deleted_at?: string | null;
                }>}
                onBackToCalendar={backToCalendar}
                fillHeight
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
