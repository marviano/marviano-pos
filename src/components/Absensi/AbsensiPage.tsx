'use client';

/**
 * FlexCode "PHP-style" flow: finspot: + FlexCodeSDK.exe + HTTP (same as pictos-absensi / official demo).
 * Requires a running FlexCode-compatible server (e.g. pictos-absensi) at FlexCode server URL.
 * SN/VC/AC must match that server’s device settings; employee IDs must exist on that server’s DB.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
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

const LS_FLEXCODE_BASE = 'flexcode_http_base_url';

interface AbsensiPageProps {
  businessId: number;
}

type Tab = 'scan' | 'log' | 'settings';

interface FlexEmployee {
  id: number;
  nama_karyawan: string;
  template_count?: number;
  color?: string | null;
}

interface AttendanceRow {
  id: number;
  clock_type: string;
  scan_at: string;
  employee_name?: string | null;
}

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/$/, '');
}

function finspotReg(absoluteRegisterUrl: string): string {
  return `finspot:FingerspotReg;${btoa(absoluteRegisterUrl)}`;
}

function finspotVer(absoluteVerificationUrl: string): string {
  return `finspot:FingerspotVer;${btoa(absoluteVerificationUrl)}`;
}

export default function AbsensiPage({ businessId }: AbsensiPageProps) {
  const { user } = useAuth();
  const isAdmin = isSuperAdmin(user);
  const canEnroll = isAdmin || hasPermission(user, 'access_absensi_enroll');

  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;

  const [activeTab, setActiveTab] = useState<Tab>('scan');
  const [toast, setToast] = useState<string | null>(null);

  const [serverBaseUrl, setServerBaseUrl] = useState('');
  const [snInput, setSnInput] = useState('');
  const [vcInput, setVcInput] = useState('');
  const [acInput, setAcInput] = useState('');
  const [settingsSaved, setSettingsSaved] = useState<'idle' | 'ok' | 'err'>('idle');

  const [employees, setEmployees] = useState<FlexEmployee[]>([]);
  const [empLoading, setEmpLoading] = useState(false);
  const [empError, setEmpError] = useState<string | null>(null);
  /** Shown when HTTP to pictos fails but local SQLite list works (same DB / sync). */
  const [empWarning, setEmpWarning] = useState<string | null>(null);

  const [verifyEmpId, setVerifyEmpId] = useState<string>('');
  const [enrollEmpId, setEnrollEmpId] = useState<string>('');

  const [enrollState, setEnrollState] = useState<'idle' | 'waiting' | 'success' | 'error'>('idle');
  const [enrollMsg, setEnrollMsg] = useState('');
  const enrollPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const enrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enrollBaseCountRef = useRef(0);

  const [logs, setLogs] = useState<AttendanceRow[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  // Load local credentials + saved FlexCode server URL
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LS_FLEXCODE_BASE);
      if (saved) setServerBaseUrl(saved);
      else setServerBaseUrl('http://localhost:3000');
    } catch {
      setServerBaseUrl('http://localhost:3000');
    }

    const load = async () => {
      try {
        const sn = await api?.localDbGetSetting?.('fingerprint_sn');
        const vc = await api?.localDbGetSetting?.('fingerprint_vc');
        const ac = await api?.localDbGetSetting?.('fingerprint_ac');
        if (sn) setSnInput(String(sn));
        if (vc) setVcInput(String(vc));
        if (ac) setAcInput(String(ac));
      } catch (err) {
        console.warn('Failed to load fingerprint settings:', err);
      }
    };
    void load();
  }, [api]);

  const base = normalizeBaseUrl(serverBaseUrl || 'http://localhost:3000');

  /** Prefer main-process GET (no renderer CORS). Falls back to fetch (e.g. web-only build). */
  const flexcodeGetJson = useCallback(
    async <T,>(path: string): Promise<T> => {
      const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
      if (api?.flexcodeHttpGet) {
        const r = await api.flexcodeHttpGet(url);
        if (r.ok) return r.data as T;
        throw new Error(r.error);
      }
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as T;
    },
    [api, base]
  );

  const refreshEmployees = useCallback(async () => {
    setEmpLoading(true);
    setEmpError(null);
    setEmpWarning(null);
    try {
      const rows = await flexcodeGetJson<FlexEmployee[]>('/api/employees');
      setEmployees(Array.isArray(rows) ? rows : []);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Request failed';
      try {
        const raw = await api?.localDbGetEmployees?.();
        const arr = Array.isArray(raw) ? raw : [];
        type EmpRow = { id: number; nama_karyawan: string; business_id?: number | null };
        const filtered = (arr as EmpRow[]).filter(row => {
          if (!businessId) return true;
          const bid = row.business_id;
          return bid === undefined || bid === null || bid === businessId;
        });
        const mapped: FlexEmployee[] = filtered.map(row => ({
          id: row.id,
          nama_karyawan: row.nama_karyawan,
        }));
        setEmployees(mapped);
        setEmpWarning(
          mapped.length
            ? `Tidak terhubung ke HTTP FlexCode (${msg}). Daftar karyawan dari database POS lokal — pastikan Node (pictos-absensi) berjalan di ${base} agar enroll/log sinkron.`
            : null
        );
        if (!mapped.length) {
          setEmpError(
            `${msg} — dan tidak ada karyawan lokal. Jalankan pictos-absensi (npm start) atau perbaiki URL di tab SDK.`
          );
        }
      } catch {
        setEmployees([]);
        setEmpError(msg);
      }
    } finally {
      setEmpLoading(false);
    }
  }, [api, base, businessId, flexcodeGetJson]);

  useEffect(() => {
    if (activeTab === 'scan' || activeTab === 'log') {
      void refreshEmployees();
    }
  }, [activeTab, refreshEmployees]);

  const refreshLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const rows = await flexcodeGetJson<AttendanceRow[]>('/api/attendance/recent');
      setLogs(Array.isArray(rows) ? rows : []);
    } catch {
      setLogs([]);
    } finally {
      setLogsLoading(false);
    }
  }, [flexcodeGetJson]);

  useEffect(() => {
    if (activeTab === 'log') void refreshLogs();
  }, [activeTab, refreshLogs]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }, []);

  const handleSaveSettings = useCallback(async () => {
    if (!snInput.trim() || !vcInput.trim() || !acInput.trim()) return;
    try {
      localStorage.setItem(LS_FLEXCODE_BASE, normalizeBaseUrl(serverBaseUrl));
    } catch {
      /* ignore */
    }
    const res = await api?.absensiSetCredentials?.({
      sn: snInput.trim(),
      vc: vcInput.trim(),
      ac: acInput.trim(),
    });
    setSettingsSaved(res?.success ? 'ok' : 'err');
    setTimeout(() => setSettingsSaved('idle'), 3000);
    if (res?.success) showToast('Pengaturan disimpan. Samakan SN/VC/AC di server FlexCode (pictos-absensi).');
  }, [api, snInput, vcInput, acInput, serverBaseUrl, showToast]);

  const clearEnrollPoll = useCallback(() => {
    if (enrollPollRef.current) {
      clearInterval(enrollPollRef.current);
      enrollPollRef.current = null;
    }
    if (enrollTimeoutRef.current) {
      clearTimeout(enrollTimeoutRef.current);
      enrollTimeoutRef.current = null;
    }
  }, []);

  const startEnrollPoll = useCallback(
    (employeeId: string) => {
      clearEnrollPoll();
      enrollTimeoutRef.current = setTimeout(() => {
        clearEnrollPoll();
        setEnrollState('error');
        setEnrollMsg('Timeout — tidak ada template baru dalam 60 detik');
      }, 60000);

      enrollPollRef.current = setInterval(async () => {
        try {
          const templates = await flexcodeGetJson<unknown[]>(`/api/employees/${employeeId}/templates`);
          if (templates.length > enrollBaseCountRef.current) {
            clearEnrollPoll();
            setEnrollState('success');
            setEnrollMsg('Sidik jari berhasil didaftarkan di server FlexCode.');
            showToast('Enrollment selesai');
            void refreshEmployees();
          }
        } catch {
          /* ignore */
        }
      }, 2000);
    },
    [clearEnrollPoll, flexcodeGetJson, refreshEmployees, showToast]
  );

  const handleStartEnroll = useCallback(async () => {
    if (!enrollEmpId || !api?.openExternal) {
      showToast('Pilih karyawan dan pastikan Electron API tersedia');
      return;
    }
    clearEnrollPoll();
    const registerUrl = `${base}/device/register?user_id=${encodeURIComponent(enrollEmpId)}`;
    try {
      const tr = await flexcodeGetJson<unknown[]>(`/api/employees/${enrollEmpId}/templates`);
      enrollBaseCountRef.current = Array.isArray(tr) ? tr.length : 0;
    } catch {
      enrollBaseCountRef.current = 0;
    }

    setEnrollState('waiting');
    setEnrollMsg('FlexCodeSDK akan terbuka — letakkan jari pada scanner.');

    const fin = finspotReg(registerUrl);
    await api.openExternal(fin);

    startEnrollPoll(enrollEmpId);
  }, [enrollEmpId, api, base, clearEnrollPoll, flexcodeGetJson, startEnrollPoll, showToast]);

  const handleCancelEnroll = useCallback(() => {
    clearEnrollPoll();
    setEnrollState('idle');
    setEnrollMsg('');
  }, [clearEnrollPoll]);

  const handleStartVerify = useCallback(async () => {
    if (!verifyEmpId || !api?.openExternal) {
      showToast('Pilih karyawan');
      return;
    }
    const verificationUrl = `${base}/device/verification?user_id=${encodeURIComponent(verifyEmpId)}`;
    const fin = finspotVer(verificationUrl);
    await api.openExternal(fin);
    showToast('FlexCodeSDK dibuka untuk verifikasi — hasil & absensi dicatat di server FlexCode.');
  }, [verifyEmpId, api, base, showToast]);

  useEffect(() => () => clearEnrollPoll(), [clearEnrollPoll]);

  return (
    <div className="flex flex-col h-full min-h-0">
      {toast && (
        <div className="mx-6 mt-3 px-4 py-2 bg-slate-800 text-white text-sm rounded-lg shadow-md shrink-0 z-10">
          {toast}
        </div>
      )}

      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold text-gray-800">Absensi</h1>
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            <button
              type="button"
              onClick={() => setActiveTab('scan')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors
                ${activeTab === 'scan' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-600 hover:text-gray-800'}`}
            >
              <UserCheck className="w-4 h-4" />
              Scan
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('log')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors
                ${activeTab === 'log' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-600 hover:text-gray-800'}`}
            >
              <List className="w-4 h-4" />
              Log
            </button>
            {isAdmin && (
              <button
                type="button"
                onClick={() => setActiveTab('settings')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors
                  ${activeTab === 'settings' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-600 hover:text-gray-800'}`}
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
          <div className="max-w-xl space-y-8">
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <strong>Mode FlexCode web</strong> — sama seperti demo PHP / pictos-absensi: FlexCodeSDK.exe dipanggil lewat{' '}
              <code className="bg-amber-100 px-1 rounded">finspot:</code>. Pastikan URL server di SDK mengarah ke mesin yang
              menjalankan API <code className="bg-amber-100 px-1">/device/…</code> (mis. pictos-absensi), dan SN/VC/AC sama
              di sana.
            </div>

            <div>
              <h2 className="text-sm font-semibold text-gray-800 mb-3 flex items-center gap-2">
                <Fingerprint className="w-4 h-4" />
                Verifikasi / absensi
              </h2>
              <p className="text-xs text-gray-500 mb-3">Pilih karyawan lalu mulai — protokol PHP: FingerspotVer → URL verification.</p>
              <div className="space-y-3">
                <select
                  value={verifyEmpId}
                  onChange={e => setVerifyEmpId(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  disabled={empLoading}
                >
                  <option value="">— Pilih karyawan (dari server FlexCode) —</option>
                  {employees.map(e => (
                    <option key={e.id} value={String(e.id)}>
                      {e.nama_karyawan}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={!verifyEmpId || empLoading}
                  onClick={() => void handleStartVerify()}
                  className="w-full py-2.5 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
                >
                  Mulai scan (verifikasi)
                </button>
              </div>
            </div>

            {canEnroll && (
              <div className="border-t border-gray-100 pt-8">
                <h2 className="text-sm font-semibold text-gray-800 mb-3 flex items-center gap-2">
                  <PlusCircle className="w-4 h-4" />
                  Daftarkan sidik jari
                </h2>
                <p className="text-xs text-gray-500 mb-3">Protokol PHP: FingerspotReg → register URL; polling template di server.</p>
                <div className="space-y-3">
                  <select
                    value={enrollEmpId}
                    onChange={e => setEnrollEmpId(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    disabled={empLoading}
                  >
                    <option value="">— Pilih karyawan —</option>
                    {employees.map(e => (
                      <option key={e.id} value={String(e.id)}>
                        {e.nama_karyawan}
                      </option>
                    ))}
                  </select>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={!enrollEmpId || empLoading || enrollState === 'waiting'}
                      onClick={() => void handleStartEnroll()}
                      className="flex-1 py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50 inline-flex items-center justify-center gap-2"
                    >
                      {enrollState === 'waiting' ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                      Mulai daftar (enrollment)
                    </button>
                    {enrollState === 'waiting' && (
                      <button type="button" onClick={handleCancelEnroll} className="px-4 py-2.5 rounded-lg border border-gray-300 text-sm">
                        Batal
                      </button>
                    )}
                  </div>
                  {enrollState !== 'idle' && (
                    <p
                      className={`text-sm ${enrollState === 'success' ? 'text-green-600' : enrollState === 'error' ? 'text-red-600' : 'text-gray-700'}`}
                    >
                      {enrollMsg}
                    </p>
                  )}
                </div>
              </div>
            )}

            {empLoading && (
              <p className="text-xs text-gray-400 flex items-center gap-2">
                <Loader2 className="w-3 h-3 animate-spin" /> Memuat daftar karyawan…
              </p>
            )}
            {empWarning && (
              <p className="text-sm text-amber-800 bg-amber-100/80 border border-amber-200 rounded-lg px-3 py-2">{empWarning}</p>
            )}
            {empError && <p className="text-sm text-red-600">{empError}</p>}
          </div>
        )}

        {activeTab === 'log' && (
          <div className="max-w-3xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-800">Log absensi (server FlexCode)</h2>
              <button
                type="button"
                onClick={() => void refreshLogs()}
                className="text-xs text-blue-600 hover:underline"
              >
                Muat ulang
              </button>
            </div>
            {logsLoading ? (
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            ) : (
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-left text-xs text-gray-600">
                    <tr>
                      <th className="px-4 py-2">Waktu</th>
                      <th className="px-4 py-2">Karyawan</th>
                      <th className="px-4 py-2">Jenis</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="px-4 py-8 text-center text-gray-400">
                          Tidak ada data atau server tidak terjangkau
                        </td>
                      </tr>
                    ) : (
                      logs.map(row => (
                        <tr key={row.id} className="border-t border-gray-100">
                          <td className="px-4 py-2 whitespace-nowrap">
                            {row.scan_at ? new Date(row.scan_at).toLocaleString('id-ID') : '—'}
                          </td>
                          <td className="px-4 py-2">{row.employee_name ?? '—'}</td>
                          <td className="px-4 py-2">{row.clock_type}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === 'settings' && isAdmin && (
          <div className="max-w-md space-y-6">
            <div>
              <h2 className="text-base font-semibold text-gray-800 mb-1">FlexCode server & lisensi</h2>
              <p className="text-sm text-gray-500 mb-4">
                URL dasar HTTP tempat <code className="text-xs bg-gray-100 px-1 rounded">/device/register</code>,{' '}
                <code className="text-xs bg-gray-100 px-1">/device/verification</code>, dan{' '}
                <code className="text-xs bg-gray-100 px-1">/api/employees</code> di-host (mis. pictos-absensi).
              </p>
              <label className="text-xs font-bold text-gray-600 uppercase tracking-wider">FlexCode server URL</label>
              <input
                type="url"
                value={serverBaseUrl}
                onChange={e => setServerBaseUrl(e.target.value)}
                placeholder="http://192.168.x.x:3000"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono mt-1 mb-4"
              />

              <p className="text-sm text-gray-500 mb-4">
                SN / VC / AC di bawah disimpan di database lokal POS (sama seperti sebelumnya). Untuk alur web, isi{' '}
                <strong>identik</strong> di pengaturan perangkat pada server FlexCode.
              </p>

              <div className="space-y-4">
                <div>
                  <label className="text-xs font-bold text-gray-600 uppercase tracking-wider">Serial Number (SN)</label>
                  <input
                    type="text"
                    value={snInput}
                    onChange={e => setSnInput(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono mt-1"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-600 uppercase tracking-wider">Verification Code (VC)</label>
                  <input
                    type="text"
                    value={vcInput}
                    onChange={e => setVcInput(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono mt-1"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-600 uppercase tracking-wider">Activation Code (AC)</label>
                  <input
                    type="text"
                    value={acInput}
                    onChange={e => setAcInput(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono mt-1"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void handleSaveSettings()}
                  disabled={!snInput.trim() || !vcInput.trim() || !acInput.trim()}
                  className="w-full px-4 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  Simpan
                </button>
              </div>

              {settingsSaved === 'ok' && (
                <div className="flex items-center gap-1.5 mt-3 text-sm text-green-600 font-medium">
                  <CheckCircle className="w-4 h-4" /> Tersimpan
                </div>
              )}
              {settingsSaved === 'err' && (
                <div className="flex items-center gap-1.5 mt-3 text-sm text-red-600 font-medium">
                  <AlertTriangle className="w-4 h-4" /> Gagal menyimpan
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
