'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  UserCheck,
  List,
  PlusCircle,
  KeyRound,
  CheckCircle,
  AlertTriangle,
  Fingerprint,
  Loader2,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { isSuperAdmin } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';

type Tab = 'scan' | 'log' | 'settings';

interface AbsensiPageProps {
  businessId: number;
}

const FINGER_LABELS: Record<number, string> = {
  0: 'Jari Telunjuk Kanan',
  1: 'Jari Telunjuk Kiri',
  2: 'Ibu Jari Kanan',
  3: 'Ibu Jari Kiri',
  4: 'Jari Tengah Kanan',
  5: 'Jari Tengah Kiri',
};

export default function AbsensiPage({ businessId }: AbsensiPageProps) {
  const { user } = useAuth();
  const isAdmin = isSuperAdmin(user);
  const canEnroll = isAdmin || hasPermission(user, 'access_absensi_enroll');

  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;

  const [activeTab, setActiveTab] = useState<Tab>('scan');
  const [readerStatus, setReaderStatus] = useState<'unknown' | 'connected' | 'disconnected'>('unknown');

  const [scanState, setScanState] = useState<'idle' | 'waiting' | 'success' | 'error'>('idle');
  const [scanMessage, setScanMessage] = useState('Tempelkan jari untuk absensi');
  const [lastScanResult, setLastScanResult] = useState<string | null>(null);

  const [settingsSaved, setSettingsSaved] = useState<'idle' | 'ok' | 'err'>('idle');
  const [snInput, setSnInput] = useState('');
  const [vcInput, setVcInput] = useState('');
  const [acInput, setAcInput] = useState('');
  const [vkeyInput, setVkeyInput] = useState('SecurityKey');

  const [employees, setEmployees] = useState<Array<{ id: number; nama_karyawan: string }>>([]);
  const [employeesLoading, setEmployeesLoading] = useState(false);

  const [enrollEmployeeId, setEnrollEmployeeId] = useState<string>('');
  const [enrollFingerIndex, setEnrollFingerIndex] = useState<number>(0);
  const [enrollLoading, setEnrollLoading] = useState(false);
  const [enrollMessage, setEnrollMessage] = useState('');

  const [logsLoading, setLogsLoading] = useState(false);
  const [logs, setLogs] = useState<
    Array<{ id: number; clock_type: string; scan_at: string; employee_id?: number; nama_karyawan?: string; status?: string; late_minutes?: number }>
  >([]);

  const employeeById = useMemo(() => {
    const map = new Map<number, string>();
    for (const e of employees) map.set(e.id, e.nama_karyawan);
    return map;
  }, [employees]);

  const loadEmployees = useCallback(async () => {
    if (!api?.localDbGetEmployees) return;
    setEmployeesLoading(true);
    try {
      const rows = await api.localDbGetEmployees();
      setEmployees((rows ?? []) as Array<{ id: number; nama_karyawan: string }>);
    } catch {
      setEmployees([]);
    } finally {
      setEmployeesLoading(false);
    }
  }, [api]);

  const refreshLogs = useCallback(async () => {
    if (!api?.absensiGetAttendanceLogs) return;
    setLogsLoading(true);
    try {
      const res = await api.absensiGetAttendanceLogs({
        business_id: businessId,
        limit: 50,
      });
      if (res?.success) setLogs((res.data ?? []) as any[]);
      else setLogs([]);
    } catch {
      setLogs([]);
    } finally {
      setLogsLoading(false);
    }
  }, [api, businessId]);

  // Initial load
  useEffect(() => {
    void (async () => {
      try {
        const connected = await api?.absensiCheckReader?.();
        setReaderStatus(connected?.connected ? 'connected' : 'disconnected');
      } catch {
        setReaderStatus('disconnected');
      }

      try {
        const sn = await api?.localDbGetSetting?.('fingerprint_sn');
        const vc = await api?.localDbGetSetting?.('fingerprint_vc');
        const ac = await api?.localDbGetSetting?.('fingerprint_ac');
        const vkey = await api?.localDbGetSetting?.('fingerprint_vkey');
        if (sn) setSnInput(String(sn));
        if (vc) setVcInput(String(vc));
        if (ac) setAcInput(String(ac));
        if (vkey) setVkeyInput(String(vkey));
      } catch {
        // ignore
      }

      await loadEmployees();
      if (activeTab === 'log') await refreshLogs();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (activeTab === 'log') void refreshLogs();
  }, [activeTab, refreshLogs]);

  // Live SDK progress feedback (important so enrollment doesn't look frozen)
  useEffect(() => {
    api?.onAbsensiEnrollProgress?.((event: any) => {
      const msg = event?.message ? String(event.message) : '';
      if (msg) setEnrollMessage(msg);
    });
    api?.onAbsensiIdentifyProgress?.((event: any) => {
      const msg = event?.message ? String(event.message) : '';
      if (msg) setScanMessage(msg);
    });
    return () => {
      api?.removeAbsensiListeners?.();
    };
  }, [api]);

  const handleSaveSettings = useCallback(async () => {
    if (!api) return;
    if (!snInput.trim() || !vcInput.trim() || !acInput.trim() || !vkeyInput.trim()) return;

    setSettingsSaved('idle');
    try {
      const r1 = await api.absensiSetCredentials?.({ sn: snInput.trim(), vc: vcInput.trim(), ac: acInput.trim() });
      const r2 = await api.absensiSetVkey?.(vkeyInput.trim());
      const ok = Boolean(r1?.success) && (r2 ? Boolean(r2.success) : true);

      setSettingsSaved(ok ? 'ok' : 'err');
    } catch {
      setSettingsSaved('err');
    }
    setTimeout(() => setSettingsSaved('idle'), 3000);
  }, [api, snInput, vcInput, acInput, vkeyInput]);

  const handleStartScan = useCallback(async () => {
    if (!api) return;
    if (scanState === 'waiting') return;

    setScanState('waiting');
    setLastScanResult(null);
    setScanMessage('Menunggu sidik jari...');

    try {
      const identifyRes = await api.absensiStartIdentify?.(businessId);
      if (!identifyRes?.success) throw new Error(identifyRes?.error ?? 'Identify gagal');

      const employeeId = identifyRes.employeeId;
      const score = identifyRes.score ?? 0;

      // Determine next clock_type from today's latest log
      const todayRes = await api.absensiGetTodayStatus?.(businessId);
      const rows = (todayRes?.data ?? []) as any[];
      const last = rows.find(r => r.employee_id === employeeId);

      const clockType = last?.clock_type === 'clock_in' ? 'clock_out' : 'clock_in';

      const createRes = await api.absensiCreateAttendanceLog?.({
        employee_id: employeeId,
        business_id: businessId,
        clock_type: clockType,
        scan_at: new Date().toISOString(),
        match_score: score,
      });
      if (!createRes?.success) throw new Error(createRes?.error ?? 'Gagal menyimpan absensi');

      const name = employeeById.get(employeeId) ?? `Karyawan #${employeeId}`;
      const statusText =
        createRes.status === 'late' ? ` — Terlambat ${createRes.lateMinutes ?? createRes.late_minutes ?? 0} menit` : '';

      setScanState('success');
      setScanMessage(`${clockType === 'clock_in' ? 'Clock In' : 'Clock Out'} berhasil`);
      setLastScanResult(`${name}: ${clockType === 'clock_in' ? 'Masuk' : 'Keluar'}${statusText}`);

      // Refresh logs so user sees the new entry
      if (activeTab === 'log') void refreshLogs();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setScanState('error');
      setScanMessage(msg);
    }
  }, [api, businessId, scanState, employeeById, activeTab, refreshLogs]);

  const handleStartEnroll = useCallback(async () => {
    if (!api) return;
    if (!enrollEmployeeId) return;
    if (enrollLoading) return;

    setEnrollLoading(true);
    setEnrollMessage('Mulai pendaftaran sidik jari...');

    try {
      const employeeId = Number(enrollEmployeeId);
      const res = await api.absensiStartEnroll?.(employeeId);
      if (!res?.success) throw new Error(res?.error ?? 'Enroll gagal');
      const templateBase64 = res.templateBase64;
      if (!templateBase64) throw new Error('Tidak ada template yang dihasilkan');

      const saveRes = await api.absensiSaveTemplate?.({
        employee_id: employeeId,
        finger_index: enrollFingerIndex,
        template_data: templateBase64,
        quality: res.quality ?? 100,
      });
      if (!saveRes?.success) throw new Error(saveRes?.error ?? 'Gagal menyimpan template');

      setEnrollMessage('Sidik jari berhasil didaftarkan.');
      await loadEmployees();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setEnrollMessage(msg);
    } finally {
      setEnrollLoading(false);
    }
  }, [api, enrollEmployeeId, enrollLoading, enrollFingerIndex, loadEmployees]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold text-gray-800">Absensi</h1>
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            <button
              type="button"
              onClick={() => setActiveTab('scan')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'scan' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              <UserCheck className="w-4 h-4" />
              Scan
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('log')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'log' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              <List className="w-4 h-4" />
              Log
            </button>
            {isAdmin && (
              <button
                type="button"
                onClick={() => setActiveTab('settings')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  activeTab === 'settings' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-600 hover:text-gray-800'
                }`}
              >
                <KeyRound className="w-4 h-4" />
                SDK
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-6">
        {activeTab === 'scan' && (
          <div className="max-w-xl space-y-6">
            <div className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 text-sm text-gray-800">
              Status reader:{' '}
              <span className={readerStatus === 'connected' ? 'text-green-600 font-semibold' : 'text-red-600 font-semibold'}>
                {readerStatus === 'connected' ? 'Connected' : 'Disconnected'}
              </span>
            </div>

            <div className="rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Klik <b>Mulai Scan</b> dan tempelkan jari pada scanner. Identifikasi dilakukan oleh SDK via COM, dan hasil
              disimpan ke MySQL menggunakan <code className="bg-amber-100 px-1 rounded">DB_HOST</code>.
            </div>

            <button
              type="button"
              onClick={() => void handleStartScan()}
              disabled={scanState === 'waiting' || !api}
              className="w-full px-4 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {scanState === 'waiting' ? (
                <span className="inline-flex items-center gap-2 justify-center">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Memproses...
                </span>
              ) : (
                'Mulai Scan'
              )}
            </button>

            <div className="rounded-lg border border-gray-100 bg-white px-4 py-3 text-sm">
              <div className="font-semibold text-gray-800 mb-1">Status</div>
              <div className={scanState === 'error' ? 'text-red-600' : scanState === 'success' ? 'text-green-600' : 'text-gray-800'}>
                {scanMessage}
              </div>
              {lastScanResult ? <div className="mt-2 text-gray-700">{lastScanResult}</div> : null}
            </div>
          </div>
        )}

        {activeTab === 'log' && (
          <div className="max-w-3xl space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-800">Log absensi</h2>
              <button
                type="button"
                onClick={() => void refreshLogs()}
                className="text-xs text-blue-600 hover:underline"
                disabled={logsLoading}
              >
                {logsLoading ? 'Memuat...' : 'Muat ulang'}
              </button>
            </div>
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs text-gray-600">
                  <tr>
                    <th className="px-4 py-2">Waktu</th>
                    <th className="px-4 py-2">Karyawan</th>
                    <th className="px-4 py-2">Jenis</th>
                    <th className="px-4 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {logsLoading ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-gray-400">
                        <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                      </td>
                    </tr>
                  ) : logs.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-gray-400">
                        Tidak ada data
                      </td>
                    </tr>
                  ) : (
                    logs.map(l => (
                      <tr key={l.id} className="border-t border-gray-100">
                        <td className="px-4 py-2 whitespace-nowrap">
                          {l.scan_at ? new Date(l.scan_at).toLocaleString('id-ID') : '—'}
                        </td>
                        <td className="px-4 py-2">{l.nama_karyawan ?? (l.employee_id ? `#${l.employee_id}` : '—')}</td>
                        <td className="px-4 py-2">{l.clock_type}</td>
                        <td className="px-4 py-2">
                          {l.status ? (l.status === 'late' ? `late (+${l.late_minutes ?? 0}m)` : l.status) : '—'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'settings' && isAdmin && (
          <div className="max-w-lg space-y-6">
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-4">
              <div>
                <h2 className="text-base font-semibold text-gray-800 mb-1">FlexCode SDK Credentials</h2>
                <p className="text-sm text-gray-500">
                  SN/VC/AC & VKey disimpan di database lokal via <code className="bg-gray-100 px-1 rounded">DB_HOST</code> dan
                  dipakai oleh SDK COM untuk enroll/verify.
                </p>
              </div>

              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Serial Number (SN)</label>
                    <input
                      type="text"
                      value={snInput}
                      onChange={e => setSnInput(e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Verification Code (VC)</label>
                    <input
                      type="text"
                      value={vcInput}
                      onChange={e => setVcInput(e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Activation Code (AC)</label>
                  <input
                    type="text"
                    value={acInput}
                    onChange={e => setAcInput(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Security / Verification Key (VKey)</label>
                  <input
                    type="text"
                    value={vkeyInput}
                    onChange={e => setVkeyInput(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                  <p className="text-xs text-gray-400 mt-1">Harus sama untuk template enroll dan verify.</p>
                </div>

                <button
                  type="button"
                  onClick={() => void handleSaveSettings()}
                  disabled={!snInput.trim() || !vcInput.trim() || !acInput.trim() || !vkeyInput.trim()}
                  className="w-full px-4 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  Simpan & Aktifkan reader
                </button>

                {settingsSaved === 'ok' ? (
                  <div className="flex items-center gap-2 text-sm text-green-600 font-medium">
                    <CheckCircle className="w-4 h-4" /> Lisensi berhasil disimpan
                  </div>
                ) : null}
                {settingsSaved === 'err' ? (
                  <div className="flex items-center gap-2 text-sm text-red-600 font-medium">
                    <AlertTriangle className="w-4 h-4" /> Gagal menyimpan lisensi
                  </div>
                ) : null}
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-4">
              <div>
                <h2 className="text-base font-semibold text-gray-800 mb-1">Enrollment (Daftarkan sidik jari)</h2>
                <p className="text-sm text-gray-500">
                  Enroll template lewat SDK COM, lalu simpan ke tabel <code className="bg-gray-100 px-1 rounded">fingerprint_templates</code>.
                </p>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Pilih karyawan</label>
                  <select
                    value={enrollEmployeeId}
                    onChange={e => setEnrollEmployeeId(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    disabled={employeesLoading}
                  >
                    <option value="">— Pilih karyawan —</option>
                    {employees.map(e => (
                      <option key={e.id} value={String(e.id)}>
                        {e.nama_karyawan}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Index jari</label>
                  <select
                    value={enrollFingerIndex}
                    onChange={e => setEnrollFingerIndex(Number(e.target.value))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    disabled={employeesLoading}
                  >
                    {Object.keys(FINGER_LABELS)
                      .map(k => Number(k))
                      .sort((a, b) => a - b)
                      .map(i => (
                        <option key={i} value={i}>
                          {FINGER_LABELS[i]}
                        </option>
                      ))}
                  </select>
                </div>

                <button
                  type="button"
                  disabled={!canEnroll || !enrollEmployeeId || enrollLoading}
                  onClick={() => void handleStartEnroll()}
                  className="w-full px-4 py-2.5 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors inline-flex items-center justify-center gap-2"
                >
                  {enrollLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Fingerprint className="w-4 h-4" />}
                  {enrollLoading ? 'Mendaftarkan...' : 'Mulai Enroll'}
                </button>

                {enrollMessage ? <div className="text-sm text-gray-700">{enrollMessage}</div> : null}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

