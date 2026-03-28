'use client';

import { useState, useCallback, useEffect } from 'react';
import { UserCheck, List, PlusCircle, KeyRound, CheckCircle, AlertTriangle } from 'lucide-react';
import ClockInOutPanel from './ClockInOutPanel';
import AttendanceLogTable from './AttendanceLogTable';
import EnrollmentModal from './EnrollmentModal';
import { useAuth } from '@/hooks/useAuth';
import { isSuperAdmin } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';

interface AbsensiPageProps {
  businessId: number;
}

type Tab = 'scan' | 'log' | 'settings';

export default function AbsensiPage({ businessId }: AbsensiPageProps) {
  const { user } = useAuth();
  const isAdmin = isSuperAdmin(user);
  const canEnroll = isAdmin || hasPermission(user, 'access_absensi_enroll');

  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;

  const [activeTab, setActiveTab]           = useState<Tab>('scan');
  const [showEnrollModal, setShowEnrollModal] = useState(false);
  const [lastScanResult, setLastScanResult]  = useState<string | null>(null);
  
  const [snInput, setSnInput]                = useState('');
  const [vcInput, setVcInput]                = useState('');
  const [acInput, setAcInput]                = useState('');
  const [settingsSaved, setSettingsSaved]    = useState<'idle' | 'ok' | 'err'>('idle');

  // Load saved credentials from DB on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const sn = await api?.localDbGetSetting?.('fingerprint_sn');
        const vc = await api?.localDbGetSetting?.('fingerprint_vc');
        const ac = await api?.localDbGetSetting?.('fingerprint_ac');
        if (sn) setSnInput(sn);
        if (vc) setVcInput(vc);
        if (ac) setAcInput(ac);
      } catch (err) {
        console.warn('Failed to load fingerprint settings:', err);
      }
    };
    loadSettings();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSaveSettings = useCallback(async () => {
    if (!snInput.trim() || !vcInput.trim() || !acInput.trim()) return;
    const res = await api?.absensiSetCredentials?.({
      sn: snInput.trim(),
      vc: vcInput.trim(),
      ac: acInput.trim()
    });
    setSettingsSaved(res?.success ? 'ok' : 'err');
    setTimeout(() => setSettingsSaved('idle'), 3000);
  }, [api, snInput, vcInput, acInput]);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold text-gray-800">Absensi</h1>
          {/* Tabs */}
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setActiveTab('scan')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors
                ${activeTab === 'scan' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-600 hover:text-gray-800'}`}
            >
              <UserCheck className="w-4 h-4" />
              Scan
            </button>
            <button
              onClick={() => setActiveTab('log')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors
                ${activeTab === 'log' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-600 hover:text-gray-800'}`}
            >
              <List className="w-4 h-4" />
              Log
            </button>
            {isAdmin && (
              <button
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

        {/* Enroll button — admin only */}
        {canEnroll && (
          <button
            onClick={() => setShowEnrollModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors"
          >
            <PlusCircle className="w-4 h-4" />
            Daftarkan Sidik Jari
          </button>
        )}
      </div>

      {/* Last scan toast */}
      {lastScanResult && activeTab === 'scan' && (
        <div className="mx-6 mt-3 px-4 py-2 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700 flex-shrink-0">
          {lastScanResult}
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === 'scan' && (
          <ClockInOutPanel
            businessId={businessId}
            onSuccess={({ employeeName, clockType, status, lateMinutes }) => {
              const action = clockType === 'clock_in' ? 'Clock In' : 'Clock Out';
              const statusText = status === 'late' ? ` — Terlambat ${lateMinutes} menit` : '';
              setLastScanResult(`${employeeName}: ${action}${statusText}`);
            }}
          />
        )}
        {activeTab === 'log' && (
          <div className="h-full p-6 overflow-hidden flex flex-col">
            <AttendanceLogTable businessId={businessId} />
          </div>
        )}
        {activeTab === 'settings' && isAdmin && (
          <div className="h-full p-6 overflow-y-auto">
            <div className="max-w-md space-y-6">
              <div>
                <h2 className="text-base font-semibold text-gray-800 mb-1">FlexCode SDK Activation</h2>
                <p className="text-sm text-gray-500 mb-4">
                  Masukkan detail lisensi FlexCode SDK yang Anda miliki. Detail ini biasanya dikirim bersama hardware atau via email.
                </p>
                
                <div className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-gray-600 uppercase tracking-wider">Serial Number (SN)</label>
                    <input
                      type="text"
                      value={snInput}
                      onChange={e => setSnInput(e.target.value)}
                      placeholder="Masukkan Serial Number"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-bold text-gray-600 uppercase tracking-wider">Verification Code (VC)</label>
                    <input
                      type="text"
                      value={vcInput}
                      onChange={e => setVcInput(e.target.value)}
                      placeholder="Masukkan Verification Code"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-bold text-gray-600 uppercase tracking-wider">Activation Code (AC)</label>
                    <input
                      type="text"
                      value={acInput}
                      onChange={e => setAcInput(e.target.value)}
                      placeholder="Masukkan Activation Code"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                  </div>

                  <button
                    onClick={handleSaveSettings}
                    disabled={!snInput.trim() || !vcInput.trim() || !acInput.trim()}
                    className="w-full px-4 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm"
                  >
                    Simpan & Aktifkan reader
                  </button>
                </div>

                {settingsSaved === 'ok' && (
                  <div className="flex items-center gap-1.5 mt-3 text-sm text-green-600 font-medium">
                    <CheckCircle className="w-4 h-4" /> Lisensi berhasil disimpan dan diterapkan.
                  </div>
                )}
                {settingsSaved === 'err' && (
                  <div className="flex items-center gap-1.5 mt-3 text-sm text-red-600 font-medium">
                    <AlertTriangle className="w-4 h-4" /> Gagal menyimpan lisensi. Periksa kembali input Anda.
                  </div>
                )}
              </div>

              <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 text-sm text-blue-800 space-y-2">
                <p className="font-semibold flex items-center gap-1.5 underline decoration-blue-300 underline-offset-4 decoration-2">
                   Penting untuk Migrasi FlexCode:
                </p>
                <ul className="list-disc ml-4 space-y-1 text-blue-700/90">
                  <li>Format template FlexCode <b>tidak kompatibel</b> dengan DigitalPersona.</li>
                  <li>Anda wajib <b>mendaftarkan ulang</b> seluruh sidik jari karyawan.</li>
                  <li>Data lama akan tetap ada di database namun tidak bisa terbaca oleh SDK baru ini.</li>
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Enrollment modal */}
      {showEnrollModal && (
        <EnrollmentModal
          enrolledByUserId={Number(user?.id ?? 0)}
          onClose={() => setShowEnrollModal(false)}
        />
      )}
    </div>
  );
}
