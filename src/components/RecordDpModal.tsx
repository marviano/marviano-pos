'use client';

import { useState, useEffect, useRef } from 'react';
import { appAlert } from '@/components/AppDialog';
import { formatNumberForInput, parseNumberInput } from '@/lib/formatUtils';
import { scheduleReservationVpsSync } from '@/lib/reservationSync';
import { getReservationRecordedDp, isDpRecorded } from '@/lib/reservationPayments';
import { RESERVATION_MANUAL_PAYMENT_METHODS } from '@/lib/reservationPaymentMethods';
import type { ReservationRow } from './ReservationFormModal';

interface RecordDpModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void;
  businessId: number;
  userId?: number | string | null;
  reservation: ReservationRow | null;
}

export default function RecordDpModal({
  isOpen,
  onClose,
  onSaved,
  businessId,
  userId,
  reservation,
}: RecordDpModalProps) {
  const [amountDisplay, setAmountDisplay] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<string>('cash');
  const [saving, setSaving] = useState(false);
  const backdropMousedownRef = useRef(false);

  const resolvedUserId = userId != null ? (typeof userId === 'string' ? parseInt(userId, 10) : userId) : 0;
  const isValidUser = Number.isFinite(resolvedUserId) && resolvedUserId > 0;

  useEffect(() => {
    if (!isOpen || !reservation) return;
    const plannedDp = Number(reservation.dp) || 0;
    const recorded = getReservationRecordedDp(reservation);
    const prefill = recorded > 0 ? recorded : plannedDp;
    setAmountDisplay(prefill > 0 ? formatNumberForInput(prefill) : '');
    setPaymentMethod('cash');
  }, [isOpen, reservation]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reservation) return;
    if (!isValidUser) {
      await appAlert('Anda harus login untuk mencatat DP.');
      return;
    }
    if (isDpRecorded(reservation)) {
      await appAlert('DP sudah tercatat untuk reservasi ini.');
      return;
    }
    const amount = parseNumberInput(amountDisplay);
    if (amount <= 0) {
      await appAlert('Nominal DP harus lebih dari 0.');
      return;
    }

    const api = window.electronAPI;
    if (!api?.localDbRecordReservationDp) {
      await appAlert('Fitur catat DP tidak tersedia.');
      return;
    }

    setSaving(true);
    try {
      const uuid = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `rdp-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
      const result = await api.localDbRecordReservationDp({
        uuid_id: uuid,
        reservation_uuid: reservation.uuid_id,
        business_id: businessId,
        amount,
        payment_method: paymentMethod,
        created_by_user_id: resolvedUserId,
      });
      if (result?.success) {
        scheduleReservationVpsSync();
        onSaved?.();
        onClose();
      } else {
        await appAlert(result?.error ?? 'Gagal mencatat DP.');
      }
    } catch (err) {
      await appAlert(err instanceof Error ? err.message : 'Gagal mencatat DP.');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen || !reservation) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onMouseDown={(e) => { backdropMousedownRef.current = e.target === e.currentTarget; }}
      onClick={(e) => {
        if (e.target === e.currentTarget && backdropMousedownRef.current) onClose();
        backdropMousedownRef.current = false;
      }}
    >
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <h3 className="text-base font-semibold text-slate-800">Catat DP — {reservation.nama}</h3>
          <button type="button" onClick={onClose} className="p-1.5 text-slate-500 hover:text-slate-700 rounded" aria-label="Tutup">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="px-4 py-4 space-y-3">
          <p className="text-sm text-slate-600">
            Mencatat DP sebagai uang masuk modul reservasi (terpisah dari omset kasir). DP akan otomatis dikurangkan saat pelunasan di kasir.
          </p>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Nominal DP</label>
            <input
              type="text"
              inputMode="numeric"
              value={amountDisplay}
              onChange={(e) => setAmountDisplay(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white text-slate-900"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Metode bayar</label>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white text-slate-900"
            >
              {RESERVATION_MANUAL_PAYMENT_METHODS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 font-medium">
              Batal
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-sky-600 text-white font-semibold hover:bg-sky-700 disabled:opacity-50"
            >
              {saving ? 'Menyimpan...' : 'Catat DP'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
