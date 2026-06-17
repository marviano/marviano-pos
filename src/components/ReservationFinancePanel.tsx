'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatRupiah } from '@/lib/formatUtils';
import {
  financeEntryTypeLabel,
  formatReservationPaymentMethod,
} from '@/lib/reservationPaymentMethods';
import type { ReservationFinanceEntry, ReservationFinanceSummary } from '@/types/reservationFinance';

interface ReservationFinancePanelProps {
  businessId: number;
  refreshTrigger?: number;
  onViewReservation?: (reservationUuid: string) => void;
}

function formatFinanceTime(iso: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatReservasiDate(tanggal: string | null, jam: string | null): string {
  if (!tanggal) return '';
  const t = String(tanggal).slice(0, 10);
  const j = jam ? String(jam).slice(0, 5) : '';
  return j ? `${t} ${j}` : t;
}

export default function ReservationFinancePanel({
  businessId,
  refreshTrigger = 0,
  onViewReservation,
}: ReservationFinancePanelProps) {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<ReservationFinanceSummary | null>(null);
  const [entries, setEntries] = useState<ReservationFinanceEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const fetchFinance = useCallback(async () => {
    const api = window.electronAPI;
    if (!api?.localDbGetReservationFinance) {
      setError('Fitur keuangan reservasi tidak tersedia.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await api.localDbGetReservationFinance(businessId, {
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      });
      if (!result?.success) {
        setSummary(null);
        setEntries([]);
        setError(result?.error ?? 'Gagal memuat data keuangan.');
        return;
      }
      setSummary(result.summary ?? null);
      setEntries(Array.isArray(result.entries) ? result.entries : []);
    } catch (e) {
      setSummary(null);
      setEntries([]);
      setError(e instanceof Error ? e.message : 'Gagal memuat data keuangan.');
    } finally {
      setLoading(false);
    }
  }, [businessId, dateFrom, dateTo]);

  useEffect(() => {
    fetchFinance();
  }, [fetchFinance, refreshTrigger]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden p-5 min-h-0">
      <div className="bg-white rounded-lg shadow border border-slate-200 overflow-hidden flex flex-col flex-1 min-h-0">
        {summary && (
          <div className="px-4 py-3 border-b border-slate-200 grid grid-cols-2 lg:grid-cols-4 gap-3 bg-slate-50">
            <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2">
              <p className="text-xs text-sky-700 uppercase tracking-wide font-medium">Total DP diterima</p>
              <p className="text-lg font-bold text-sky-900 mt-0.5">{formatRupiah(summary.total_dp_in)}</p>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
              <p className="text-xs text-emerald-700 uppercase tracking-wide font-medium">Total pelunasan</p>
              <p className="text-lg font-bold text-emerald-900 mt-0.5">{formatRupiah(summary.total_pelunasan_in)}</p>
            </div>
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2">
              <p className="text-xs text-red-700 uppercase tracking-wide font-medium">Total refund keluar</p>
              <p className="text-lg font-bold text-red-900 mt-0.5">{formatRupiah(summary.total_refund_out)}</p>
            </div>
            <div className="rounded-lg border border-slate-300 bg-white px-3 py-2">
              <p className="text-xs text-slate-600 uppercase tracking-wide font-medium">Saldo net reservasi</p>
              <p className={`text-lg font-bold mt-0.5 ${summary.net_balance >= 0 ? 'text-slate-900' : 'text-red-700'}`}>
                {formatRupiah(summary.net_balance)}
              </p>
            </div>
          </div>
        )}

        <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap gap-3 items-center">
          <span className="text-sm font-semibold text-slate-700 uppercase tracking-wide mr-1">Filter</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white text-slate-900"
            title="Dari tanggal transaksi"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white text-slate-900"
            title="Sampai tanggal transaksi"
          />
          <button
            type="button"
            onClick={() => fetchFinance()}
            className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 text-sm font-medium hover:bg-slate-50"
          >
            Muat ulang
          </button>
        </div>

        <div className="flex-1 overflow-auto min-h-0">
          {loading ? (
            <div className="py-10 text-center text-slate-500 text-sm">Memuat log keuangan...</div>
          ) : error ? (
            <div className="py-10 text-center text-red-600 text-sm px-4">{error}</div>
          ) : entries.length === 0 ? (
            <div className="py-10 text-center text-slate-500 text-sm">Belum ada transaksi keuangan reservasi.</div>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 bg-slate-100 z-10">
                <tr className="text-left text-xs uppercase tracking-wide text-slate-600">
                  <th className="px-3 py-2 font-semibold border-b border-slate-200 w-[140px]">Waktu</th>
                  <th className="px-3 py-2 font-semibold border-b border-slate-200 min-w-[180px]">Reservasi</th>
                  <th className="px-3 py-2 font-semibold border-b border-slate-200 w-[110px]">Jenis</th>
                  <th className="px-3 py-2 font-semibold border-b border-slate-200 w-[120px]">Metode</th>
                  <th className="px-3 py-2 font-semibold border-b border-slate-200 w-[130px] text-right">Jumlah</th>
                  <th className="px-3 py-2 font-semibold border-b border-slate-200 min-w-[120px]">Keterangan</th>
                  <th className="px-3 py-2 font-semibold border-b border-slate-200 w-[100px]">Oleh</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const isIn = entry.direction === 'in';
                  const resLabel = entry.reservation_nama || entry.guest_nama || '-';
                  const resDate = formatReservasiDate(entry.reservation_tanggal, entry.reservation_jam);
                  const canOpenRes = Boolean(entry.reservation_uuid && onViewReservation);
                  return (
                    <tr key={entry.id} className="border-b border-slate-100 hover:bg-slate-50/80">
                      <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap align-top">
                        {formatFinanceTime(entry.created_at)}
                      </td>
                      <td className="px-3 py-2.5 align-top min-w-0">
                        {canOpenRes ? (
                          <button
                            type="button"
                            onClick={() => onViewReservation!(entry.reservation_uuid!)}
                            className="text-left text-blue-600 hover:text-blue-800 hover:underline font-medium truncate block max-w-full"
                            title="Lihat detail reservasi"
                          >
                            {resLabel}
                          </button>
                        ) : (
                          <span className="font-medium text-slate-800">{resLabel}</span>
                        )}
                        {resDate ? (
                          <p className="text-xs text-slate-500 mt-0.5">Acara: {resDate}</p>
                        ) : null}
                        {entry.guest_phone ? (
                          <p className="text-xs text-slate-500">{entry.guest_phone}</p>
                        ) : null}
                      </td>
                      <td className="px-3 py-2.5 align-top">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                            isIn ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                          }`}
                        >
                          {financeEntryTypeLabel(entry.payment_type)}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-slate-700 align-top">
                        {formatReservationPaymentMethod(entry.payment_method)}
                      </td>
                      <td
                        className={`px-3 py-2.5 text-right font-semibold whitespace-nowrap align-top ${
                          isIn ? 'text-green-700' : 'text-red-700'
                        }`}
                      >
                        {isIn ? '+' : '−'}{formatRupiah(entry.amount)}
                      </td>
                      <td className="px-3 py-2.5 text-slate-600 text-xs align-top">
                        {entry.note || '-'}
                        {entry.transaction_uuid ? (
                          <p className="text-slate-400 mt-0.5 truncate max-w-[160px]" title={entry.transaction_uuid}>
                            Tx: {entry.transaction_uuid.slice(0, 8)}…
                          </p>
                        ) : null}
                      </td>
                      <td className="px-3 py-2.5 text-slate-600 text-xs align-top truncate max-w-[100px]" title={entry.created_by_email ?? ''}>
                        {entry.created_by_email?.split('@')[0] ?? '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
