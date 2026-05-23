'use client';

import { useCallback, useEffect, useState } from 'react';
import { Gift } from 'lucide-react';
import { appAlert } from '@/components/AppDialog';
import { useAuth } from '@/hooks/useAuth';

type LoyaltySettings = {
  business_id: number;
  is_enabled: boolean;
  rupiah_per_point: number;
  earn_basis: 'final_amount' | 'total_amount';
  min_earn_amount: number;
  rounding_mode: string;
};

export default function LoyaltySettingsPanel() {
  const { user } = useAuth();
  const businessId = user?.selectedBusinessId ?? null;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [isEnabled, setIsEnabled] = useState(false);
  const [rupiahPerPoint, setRupiahPerPoint] = useState('50000');
  const [earnBasis, setEarnBasis] = useState<'final_amount' | 'total_amount'>('final_amount');
  const [minEarnAmount, setMinEarnAmount] = useState('0');

  const loadSettings = useCallback(async () => {
    if (businessId == null) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await window.electronAPI?.localDbGetLoyaltySettings?.(businessId);
      if (res?.success && res.settings) {
        setIsEnabled(!!res.settings.is_enabled);
        setRupiahPerPoint(String(res.settings.rupiah_per_point ?? 50000));
        setEarnBasis(res.settings.earn_basis === 'total_amount' ? 'total_amount' : 'final_amount');
        setMinEarnAmount(String(res.settings.min_earn_amount ?? 0));
      }
    } catch (err) {
      console.error('Failed to load loyalty settings:', err);
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const saveSettings = async () => {
    if (businessId == null) {
      appAlert('Pilih outlet terlebih dahulu.');
      return;
    }
    const rupiah = Math.max(1, Math.floor(Number(rupiahPerPoint.replace(/\D/g, '')) || 0));
    if (!rupiah) {
      appAlert('Rp per poin minimal 1.');
      return;
    }
    const minEarn = Math.max(0, Number(minEarnAmount) || 0);
    setSaving(true);
    setMessage('');
    try {
      const res = await window.electronAPI?.localDbUpsertLoyaltySettings?.({
        business_id: businessId,
        is_enabled: isEnabled,
        rupiah_per_point: rupiah,
        earn_basis: earnBasis,
        min_earn_amount: minEarn,
        rounding_mode: 'floor',
      });
      if (res?.success) {
        setMessage('Program loyalitas disimpan.');
        setTimeout(() => setMessage(''), 2500);
        appAlert('Pengaturan program loyalitas berhasil disimpan.');
      } else {
        setMessage('Gagal menyimpan pengaturan.');
        appAlert('Gagal menyimpan pengaturan loyalitas.');
      }
    } catch (err) {
      console.error('Save loyalty settings failed:', err);
      setMessage('Gagal menyimpan pengaturan.');
      appAlert('Gagal menyimpan pengaturan loyalitas.');
    } finally {
      setSaving(false);
    }
  };

  if (businessId == null) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
        <p className="text-sm text-gray-500">Pilih outlet untuk mengatur program loyalitas.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Gift className="w-5 h-5 text-blue-800" />
          <h3 className="text-sm font-semibold text-gray-800">Program Loyalitas / Member</h3>
        </div>
        <button
          type="button"
          onClick={() => void saveSettings()}
          disabled={loading || saving}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm disabled:opacity-50"
        >
          {saving ? 'Menyimpan…' : 'Simpan'}
        </button>
      </div>

      {message ? (
        <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded px-2 py-1">{message}</p>
      ) : null}

      {loading ? (
        <p className="text-sm text-gray-500">Memuat pengaturan…</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="flex items-center justify-between gap-3 md:col-span-2">
            <span className="text-sm text-gray-700">Program aktif</span>
            <input
              type="checkbox"
              checked={isEnabled}
              onChange={(e) => setIsEnabled(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-gray-700">Rp per 1 poin</span>
            <input
              type="text"
              inputMode="numeric"
              value={rupiahPerPoint}
              onChange={(e) => setRupiahPerPoint(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900"
              placeholder="50000"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-gray-700">Dasar hitung poin</span>
            <select
              value={earnBasis}
              onChange={(e) => setEarnBasis(e.target.value as 'final_amount' | 'total_amount')}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900"
            >
              <option value="final_amount">Total setelah diskon (final)</option>
              <option value="total_amount">Total sebelum diskon</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 md:col-span-2">
            <span className="text-xs font-medium text-gray-700">Minimum transaksi untuk dapat poin (Rp)</span>
            <input
              type="text"
              inputMode="decimal"
              value={minEarnAmount}
              onChange={(e) => setMinEarnAmount(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900"
              placeholder="0"
            />
          </label>

          <p className="text-xs text-gray-500 md:col-span-2">
            Saat aktif, kasir memilih member di pembayaran untuk menghitung dan menampilkan saldo poin. Sinkron ke server (VPS) mengikuti fase berikutnya.
          </p>
        </div>
      )}
    </div>
  );
}
