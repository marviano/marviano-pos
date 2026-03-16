'use client';

import { useState, useEffect, useRef } from 'react';
import { appAlert } from '@/components/AppDialog';
import { formatRupiah, formatNumberForInput, parseNumberInput } from '@/lib/formatUtils';
import { getTodayUTC7 } from '@/lib/dateUtils';
import type { ReservationRow } from './ReservationFormModal';

export type RefundExcAlasan = 'pembatalan reservasi' | 'other';

interface RefundExcModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void;
  businessId: number;
  userId?: number | string | null;
  /** When provided, form is pre-filled with reservation data (e.g. for cancellation refund). */
  initialReservation?: ReservationRow | null;
}

function normalizeTanggal(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (s.includes('T')) return s.slice(0, 10);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

function normalizeJam(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toTimeString().slice(0, 5);
  const s = String(v).trim();
  if (!s) return '';
  if (s.length >= 5 && /^\d{1,2}:\d{2}/.test(s)) return s.slice(0, 5);
  const d = new Date('1970-01-01T' + s);
  return Number.isNaN(d.getTime()) ? '' : d.toTimeString().slice(0, 5);
}

function parseMoneyFromReservation(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  if (typeof v === 'string') {
    const cleaned = String(v).trim().replace(/\s/g, '').replace(/\./g, '').replace(/,/g, '.');
    const n = parseFloat(cleaned);
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

export default function RefundExcModal({
  isOpen,
  onClose,
  onSaved,
  businessId,
  userId,
  initialReservation,
}: RefundExcModalProps) {
  const [nama, setNama] = useState('');
  const [paxDisplay, setPaxDisplay] = useState('');
  const [dateTime, setDateTime] = useState('');
  const [noHp, setNoHp] = useState('');
  const [jumlahRefundDisplay, setJumlahRefundDisplay] = useState('');
  const [alasan, setAlasan] = useState<RefundExcAlasan>('pembatalan reservasi');
  const [saving, setSaving] = useState(false);
  const backdropMousedownRef = useRef(false);

  const resolvedUserId = userId != null ? (typeof userId === 'string' ? parseInt(userId, 10) : userId) : 0;
  const isValidUser = Number.isFinite(resolvedUserId) && resolvedUserId > 0;

  useEffect(() => {
    if (!isOpen) return;
    const today = getTodayUTC7();
    if (initialReservation) {
      setNama(initialReservation.nama ?? '');
      setPaxDisplay(initialReservation.pax != null ? String(initialReservation.pax) : '');
      const t = normalizeTanggal(initialReservation.tanggal) || today;
      const j = normalizeJam(initialReservation.jam) || '00:00';
      setDateTime(`${t}T${j.length >= 5 ? j.slice(0, 5) : j}`);
      setNoHp((initialReservation.phone ?? '').replace(/\D/g, ''));
      const total = parseMoneyFromReservation(initialReservation.total_price);
      const dp = parseMoneyFromReservation(initialReservation.dp);
      const refundDefault = total > 0 ? total : dp > 0 ? dp : 0;
      setJumlahRefundDisplay(refundDefault > 0 ? formatNumberForInput(refundDefault) : '');
      setAlasan('pembatalan reservasi');
    } else {
      setNama('');
      setPaxDisplay('');
      setDateTime(`${today}T00:00`);
      setNoHp('');
      setJumlahRefundDisplay('');
      setAlasan('pembatalan reservasi');
    }
  }, [isOpen, initialReservation]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidUser) {
      await appAlert('Anda harus login untuk mencatat refund eksepsi.');
      return;
    }
    const namaTrim = nama.trim();
    if (!namaTrim) {
      await appAlert('Nama wajib diisi.');
      return;
    }
    const jumlahRefund = parseNumberInput(jumlahRefundDisplay);
    if (jumlahRefund <= 0) {
      await appAlert('Jumlah refund harus lebih dari 0.');
      return;
    }
    const paxNum = parseInt(paxDisplay.trim(), 10);
    if (!paxDisplay.trim() || Number.isNaN(paxNum) || paxNum < 1 || paxNum > 999) {
      await appAlert('Pax wajib diisi (1–999).');
      return;
    }

    const tanggalStr = dateTime.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggalStr)) {
      await appAlert('Tanggal wajib diisi.');
      return;
    }
    const timePart = '00:00';

    const api = window.electronAPI;
    if (!api?.localDbCreateRefundExc) {
      await appAlert('Fitur Refund Exc. tidak tersedia di lingkungan ini.');
      return;
    }

    setSaving(true);
    try {
      const uuid = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `ref-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
      const result = await api.localDbCreateRefundExc({
        uuid_id: uuid,
        business_id: businessId,
        nama: namaTrim,
        pax: paxNum,
        tanggal: tanggalStr,
        jam: timePart,
        no_hp: noHp.trim() || null,
        jumlah_refund: jumlahRefund,
        alasan,
        created_by_user_id: resolvedUserId,
      });
      if (result?.success) {
        onSaved?.();
        onClose();
      } else {
        await appAlert(result?.error ?? 'Gagal menyimpan refund eksepsi.');
      }
    } catch (err) {
      await appAlert(err instanceof Error ? err.message : 'Gagal menyimpan refund eksepsi.');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onMouseDown={(e) => { backdropMousedownRef.current = e.target === e.currentTarget; }}
      onClick={(e) => {
        if (e.target === e.currentTarget && backdropMousedownRef.current) onClose();
        backdropMousedownRef.current = false;
      }}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <h3 className="text-base font-semibold text-slate-800">
            {initialReservation ? 'Refund Eksepsi (pembatalan reservasi)' : 'Refund Eksepsi'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-500 hover:text-slate-700 rounded"
            aria-label="Tutup"
          >
            ✕
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col">
          <div className="px-4 py-4 space-y-3">
            {!isValidUser && (
              <div className="py-2 px-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">
                Login diperlukan untuk mencatat refund eksepsi.
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Nama *</label>
              <input
                type="text"
                value={nama}
                onChange={(e) => setNama(e.target.value)}
                placeholder="Nama pemesan"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white text-black placeholder:text-gray-400 placeholder:opacity-70"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Pax</label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={paxDisplay}
                  onChange={(e) => setPaxDisplay(e.target.value.replace(/\D/g, '').slice(0, 3))}
                  placeholder="Jumlah pax"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white text-black placeholder:text-gray-400 placeholder:opacity-70"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">No. HP</label>
                <input
                  type="text"
                  value={noHp}
                  onChange={(e) => setNoHp(e.target.value.replace(/\D/g, '').slice(0, 15))}
                  placeholder="08..."
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white text-black placeholder:text-gray-400 placeholder:opacity-70"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Tanggal *</label>
              <input
                type="date"
                value={dateTime.slice(0, 10)}
                onChange={(e) => setDateTime(`${e.target.value}T00:00`)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white text-black"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Jumlah refund (Rp) *</label>
              <input
                type="text"
                value={jumlahRefundDisplay}
                onChange={(e) => setJumlahRefundDisplay(e.target.value)}
                placeholder="0 atau 1.000.000"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white text-black placeholder:text-gray-400 placeholder:opacity-70"
              />
              {jumlahRefundDisplay && parseNumberInput(jumlahRefundDisplay) > 0 && (
                <p className="mt-1 text-xs text-slate-500">{formatRupiah(parseNumberInput(jumlahRefundDisplay))}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Alasan</label>
              <select
                value={alasan}
                onChange={(e) => setAlasan(e.target.value as RefundExcAlasan)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white text-black"
              >
                <option value="pembatalan reservasi">Pembatalan reservasi</option>
                <option value="other">Lainnya</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2 px-4 py-3 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 font-medium"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={saving || !isValidUser}
              className="px-4 py-2 rounded-lg bg-green-600 text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-green-700"
            >
              {saving ? 'Menyimpan...' : 'Simpan'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
