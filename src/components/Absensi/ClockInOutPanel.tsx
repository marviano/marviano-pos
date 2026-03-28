'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Fingerprint, CheckCircle, XCircle, Clock, Loader2 } from 'lucide-react';

type ScanState = 'idle' | 'waiting' | 'success' | 'error';

interface ClockInOutPanelProps {
  businessId: number;
  onSuccess?: (result: {
    employeeId: number;
    employeeName: string;
    clockType: 'clock_in' | 'clock_out';
    status: AttendanceStatus | null;
    lateMinutes: number;
    scanAt: string;
  }) => void;
}

const FINGER_LABELS: Record<number, string> = {
  0: 'Jari Telunjuk Kanan',
  1: 'Jari Telunjuk Kiri',
  2: 'Ibu Jari Kanan',
  3: 'Ibu Jari Kiri',
  4: 'Jari Tengah Kanan',
  5: 'Jari Tengah Kiri',
};

const STATUS_LABELS: Record<string, string> = {
  on_time: 'Tepat Waktu',
  late: 'Terlambat',
  early_out: 'Pulang Lebih Awal',
  outside_schedule: 'Di Luar Jadwal',
};

const STATUS_COLORS: Record<string, string> = {
  on_time: 'text-green-600',
  late: 'text-amber-600',
  early_out: 'text-orange-600',
  outside_schedule: 'text-gray-500',
};

export default function ClockInOutPanel({ businessId, onSuccess }: ClockInOutPanelProps) {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;

  const [scanState, setScanState] = useState<ScanState>('idle');
  const [statusMessage, setStatusMessage] = useState('Tempelkan jari pada scanner untuk absen');
  const [lastResult, setLastResult] = useState<{
    name: string;
    clockType: 'clock_in' | 'clock_out';
    status: AttendanceStatus | null;
    lateMinutes: number;
    scanAt: string;
  } | null>(null);
  const [readerReady, setReaderReady] = useState<boolean | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [fpImage, setFpImage] = useState<string | null>(null);
  const autoResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clock tick
  useEffect(() => {
    const tick = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(tick);
  }, []);

  // Check reader on mount
  useEffect(() => {
    api?.absensiCheckReader?.().then(res => {
      setReaderReady(res?.connected ?? false);
      if (!res?.connected) setStatusMessage(res?.message ?? 'Fingerprint reader tidak terdeteksi');
    });
  }, [api]);

  // Register progress events
  useEffect(() => {
    api?.onAbsensiIdentifyProgress?.((event: AbsensiCaptureEvent) => {
      setStatusMessage(event.message);
      if (event.type === 'finger_touch') setScanState('waiting');
      if (event.image) setFpImage(event.image);
    });
    return () => { api?.removeAbsensiListeners?.(); };
  }, [api]);

  const scheduleAutoReset = useCallback(() => {
    if (autoResetRef.current) clearTimeout(autoResetRef.current);
    autoResetRef.current = setTimeout(() => {
      setScanState('idle');
      setStatusMessage('Tempelkan jari pada scanner untuk absen');
      setLastResult(null);
    }, 5000);
  }, []);

  const handleScan = useCallback(async () => {
    if (scanState === 'waiting' || !api) return;

    setScanState('waiting');
    setStatusMessage('Menunggu sidik jari…');
    setLastResult(null);
    setFpImage(null);

    try {
      // 1. Identify the employee from fingerprint
      const identifyRes = await api.absensiStartIdentify?.(businessId);
      if (!identifyRes?.success || !identifyRes.employeeId) {
        throw new Error(identifyRes?.error ?? 'Sidik jari tidak dikenali');
      }

      const { employeeId, score } = identifyRes;

      // 2. Fetch employee details
      const empRows = await api.localDbGetEmployees?.() as { id: number; nama_karyawan: string }[] | undefined;
      const employee = empRows?.find(e => e.id === employeeId);
      const employeeName = employee?.nama_karyawan ?? `Karyawan #${employeeId}`;

      // 3. Check today's last log to determine clock_in vs clock_out
      const todayRes = await api.absensiGetTodayStatus?.(businessId);
      const todayRows = (todayRes?.data ?? []) as TodayAttendanceRow[];
      const myLastLog = todayRows.find(r => r.employee_id === employeeId);
      const clockType: 'clock_in' | 'clock_out' =
        myLastLog?.clock_type === 'clock_in' ? 'clock_out' : 'clock_in';

      // 4. Record the attendance log
      const scanAt = new Date().toISOString();
      const logRes = await api.absensiCreateAttendanceLog?.({
        employee_id: employeeId,
        business_id: businessId,
        clock_type: clockType,
        scan_at: scanAt,
        match_score: score,
      });

      if (!logRes?.success) throw new Error(logRes?.error ?? 'Gagal menyimpan absensi');

      const result = {
        name: employeeName,
        clockType,
        status: (logRes.status as AttendanceStatus | null) ?? null,
        lateMinutes: logRes.lateMinutes ?? 0,
        scanAt,
      };

      setLastResult(result);
      setScanState('success');
      setStatusMessage(`${clockType === 'clock_in' ? 'Clock In' : 'Clock Out'} berhasil`);
      onSuccess?.({ employeeId, employeeName, clockType, status: result.status, lateMinutes: result.lateMinutes, scanAt });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setScanState('error');
      setStatusMessage(msg);
    } finally {
      scheduleAutoReset();
    }
  }, [api, businessId, onSuccess, scanState, scheduleAutoReset]);


  // Cleanup on unmount
  useEffect(() => () => {
    if (autoResetRef.current) clearTimeout(autoResetRef.current);
    api?.removeAbsensiListeners?.();
  }, [api]);

  const formatTime = (d: Date) =>
    d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Jakarta' });
  const formatDate = (d: Date) =>
    d.toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Jakarta' });

  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[400px] gap-6 p-8 select-none">
      {/* Live clock */}
      <div className="text-center">
        <div className="text-5xl font-bold text-gray-800 font-mono tabular-nums">
          {formatTime(currentTime)}
        </div>
        <div className="text-gray-500 mt-1">{formatDate(currentTime)} WIB</div>
      </div>

      {/* Fingerprint area */}
      <div className="relative">
        <button
          onClick={scanState === 'idle' || scanState === 'error' || scanState === 'success' ? handleScan : undefined}
          disabled={!readerReady || scanState === 'waiting'}
          className={`relative w-40 h-40 rounded-full flex items-center justify-center transition-all duration-300 shadow-lg z-10
            ${scanState === 'waiting'
              ? 'bg-blue-100 border-4 border-blue-400 cursor-wait animate-pulse'
              : scanState === 'success'
                ? 'bg-green-100 border-4 border-green-500 cursor-pointer'
                : scanState === 'error'
                  ? 'bg-red-100 border-4 border-red-400 cursor-pointer'
                  : readerReady
                    ? 'bg-blue-50 border-4 border-blue-300 cursor-pointer hover:bg-blue-100 hover:border-blue-500 active:scale-95'
                    : 'bg-gray-100 border-4 border-gray-300 cursor-not-allowed opacity-60'
            }`}
        >
          {scanState === 'waiting' && !fpImage && <Loader2 className="w-16 h-16 text-blue-500 animate-spin" />}
          {scanState === 'waiting' && fpImage && (
            <div className="w-24 h-32 overflow-hidden flex items-center justify-center rounded-lg bg-white/50 p-1">
              <img src={fpImage} alt="Fingerprint" className="max-w-full max-h-full object-contain mix-blend-multiply opacity-70" />
            </div>
          )}
          {scanState === 'success' && <CheckCircle className="w-16 h-16 text-green-500" />}
          {scanState === 'error'   && <XCircle    className="w-16 h-16 text-red-500" />}
          {scanState === 'idle'    && <Fingerprint className="w-16 h-16 text-blue-400" />}
        </button>
      </div>

      {/* Status message */}
      <p className={`text-center text-base font-medium max-w-xs
        ${scanState === 'success' ? 'text-green-700'
          : scanState === 'error' ? 'text-red-600'
          : scanState === 'waiting' ? 'text-blue-600'
          : 'text-gray-600'}`}
      >
        {statusMessage}
      </p>

      {/* Result card */}
      {lastResult && scanState === 'success' && (
        <div className="bg-white rounded-xl shadow-md border border-gray-100 p-5 w-full max-w-xs text-center space-y-1">
          <p className="text-xl font-bold text-gray-800">{lastResult.name}</p>
          <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold
            ${lastResult.clockType === 'clock_in' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
            <Clock className="w-4 h-4" />
            {lastResult.clockType === 'clock_in' ? 'Clock In' : 'Clock Out'}
          </div>
          {lastResult.status && (
            <p className={`text-sm font-medium ${STATUS_COLORS[lastResult.status] ?? 'text-gray-600'}`}>
              {STATUS_LABELS[lastResult.status] ?? lastResult.status}
              {lastResult.status === 'late' && lastResult.lateMinutes > 0 && ` (${lastResult.lateMinutes} menit)`}
            </p>
          )}
          <p className="text-xs text-gray-400">
            {new Date(lastResult.scanAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' })} WIB
          </p>
        </div>
      )}

      {/* Reader status indicator */}
      {readerReady !== null && (
        <div className={`flex items-center gap-1.5 text-xs ${readerReady ? 'text-green-600' : 'text-red-500'}`}>
          <span className={`w-2 h-2 rounded-full ${readerReady ? 'bg-green-500' : 'bg-red-400'}`} />
          {readerReady ? 'Reader terhubung' : 'Reader tidak terhubung'}
        </div>
      )}

      {/* Legend for finger index */}
      <details className="text-xs text-gray-400 text-center cursor-pointer">
        <summary className="hover:text-gray-600">Kode Jari</summary>
        <div className="mt-1 space-y-0.5">
          {Object.entries(FINGER_LABELS).map(([k, v]) => (
            <div key={k}>{k} = {v}</div>
          ))}
        </div>
      </details>
    </div>
  );
}
