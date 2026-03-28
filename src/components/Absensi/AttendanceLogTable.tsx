'use client';

import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Clock, LogIn, LogOut, AlertCircle } from 'lucide-react';

interface AttendanceLogTableProps {
  businessId: number;
}

const STATUS_LABELS: Record<string, string> = {
  on_time: 'Tepat Waktu',
  late: 'Terlambat',
  early_out: 'Pulang Cepat',
  outside_schedule: 'Di Luar Jadwal',
};

const STATUS_BADGE: Record<string, string> = {
  on_time: 'bg-green-100 text-green-700',
  late: 'bg-amber-100 text-amber-700',
  early_out: 'bg-orange-100 text-orange-700',
  outside_schedule: 'bg-gray-100 text-gray-600',
};

export default function AttendanceLogTable({ businessId }: AttendanceLogTableProps) {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;

  const [logs, setLogs]       = useState<AttendanceLogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [dateFrom, setDateFrom] = useState(() => new Date().toISOString().substring(0, 10));
  const [dateTo, setDateTo]   = useState(() => new Date().toISOString().substring(0, 10));

  const loadLogs = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    try {
      const res = await api.absensiGetAttendanceLogs?.({
        business_id: businessId,
        date_from: dateFrom,
        date_to: dateTo,
        limit: 300,
      });
      setLogs((res?.data ?? []) as AttendanceLogRow[]);
    } finally {
      setLoading(false);
    }
  }, [api, businessId, dateFrom, dateTo]);

  useEffect(() => { loadLogs(); }, [loadLogs]);

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' });
  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' });

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Filter bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <label className="font-medium">Dari:</label>
          <input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <label className="font-medium">Sampai:</label>
          <input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        </div>
        <button
          onClick={loadLogs}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'Memuat…' : 'Refresh'}
        </button>
        <span className="text-sm text-gray-400 ml-auto">{logs.length} entri</span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto rounded-xl border border-gray-200 shadow-sm">
        {logs.length === 0 && !loading ? (
          <div className="flex flex-col items-center justify-center h-40 gap-2 text-gray-400">
            <Clock className="w-8 h-8 opacity-50" />
            <p className="text-sm">Belum ada data absensi</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-left">
                <th className="px-4 py-3 font-semibold text-gray-700">Karyawan</th>
                <th className="px-4 py-3 font-semibold text-gray-700">Tanggal</th>
                <th className="px-4 py-3 font-semibold text-gray-700">Jam</th>
                <th className="px-4 py-3 font-semibold text-gray-700">Jenis</th>
                <th className="px-4 py-3 font-semibold text-gray-700">Status</th>
                <th className="px-4 py-3 font-semibold text-gray-700">Terlambat</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {logs.map(log => (
                <tr key={log.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {log.employee_color && (
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: log.employee_color }} />
                      )}
                      <div>
                        <span className="font-medium text-gray-800">{log.nama_karyawan}</span>
                        {log.nama_jabatan && <span className="text-gray-400 text-xs block">{log.nama_jabatan}</span>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{formatDate(log.scan_at)}</td>
                  <td className="px-4 py-3 font-mono text-gray-700">{formatTime(log.scan_at)}</td>
                  <td className="px-4 py-3">
                    <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold
                      ${log.clock_type === 'clock_in' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                      {log.clock_type === 'clock_in'
                        ? <><LogIn  className="w-3 h-3" /> Masuk</>
                        : <><LogOut className="w-3 h-3" /> Pulang</>}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {log.status ? (
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[log.status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {STATUS_LABELS[log.status] ?? log.status}
                      </span>
                    ) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    {log.late_minutes > 0
                      ? <span className="text-amber-600 font-medium">{log.late_minutes} mnt</span>
                      : <span className="text-gray-300">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Sync status note */}
      {logs.some(l => l.sync_status === 'pending') && (
        <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          Beberapa entri belum tersinkron ke server.
        </div>
      )}
    </div>
  );
}
