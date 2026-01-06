import React, { useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { offlineSyncService } from '@/lib/offlineSync';
import { smartSyncService } from '@/lib/smartSync';
import { getApiUrl } from '@/lib/api';
import { TransactionDetail, TransactionRefund } from './TransactionDetailModal';

interface RefundModalProps {
  isOpen: boolean;
  onClose: () => void;
  transaction: TransactionDetail;
  onSuccess: (updatedTransaction: TransactionDetail) => void;
}

const REFUND_REASONS = [
  'Kesalahan order',
  'Produk rusak',
  'Permintaan pelanggan',
  'Lainnya'
];

const formatCurrency = (amount: number) =>
  `Rp ${Number(amount || 0).toLocaleString('id-ID', { maximumFractionDigits: 0 })}`;

const generateUuid = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).substring(2, 10);
};

const RefundModal: React.FC<RefundModalProps> = ({
  isOpen,
  onClose,
  transaction,
  onSuccess
}) => {
  const { user } = useAuth();
  const [amount, setAmount] = useState<string>('');
  const [reason, setReason] = useState<string>(REFUND_REASONS[0]);
  const [note, setNote] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalRefunded = useMemo(() => {
    if (typeof transaction.refund_total === 'number' && !Number.isNaN(transaction.refund_total)) {
      return transaction.refund_total;
    }
    const calculated = (transaction.refunds || []).reduce((sum, refund) => {
      const amount = typeof refund.refund_amount === 'number' ? refund.refund_amount : 0;
      return sum + (Number.isNaN(amount) ? 0 : amount);
    }, 0);
    return Number.isNaN(calculated) ? 0 : calculated;
  }, [transaction.refund_total, transaction.refunds]);

  const outstandingAmount = useMemo(() => {
    const finalAmount = Number(transaction.final_amount || 0);
    return Math.max(0, Number((finalAmount - totalRefunded).toFixed(2)));
  }, [transaction.final_amount, totalRefunded]);

  const isOnline = offlineSyncService.getStatus().isOnline;
  const electronAPI = typeof window !== 'undefined' ? (window as { electronAPI?: Record<string, unknown> }).electronAPI : undefined;

  const handleClose = () => {
    if (isSubmitting) return;
    setAmount('');
    setReason(REFUND_REASONS[0]);
    setNote('');
    setError(null);
    onClose();
  };

  const applyLocalRefund = async (
    refundRecord: TransactionRefund,
    transactionUpdate: Partial<TransactionDetail>
  ) => {
    if (electronAPI?.localDbApplyTransactionRefund) {
      await (electronAPI.localDbApplyTransactionRefund as (payload: Record<string, unknown>) => Promise<unknown>)({
        refund: refundRecord,
        transactionUpdate: {
          id: refundRecord.transaction_uuid,
          refund_status: transactionUpdate.refund_status ?? null,
          refund_total: transactionUpdate.refund_total ?? null,
          last_refunded_at: refundRecord.refunded_at,
          status: transactionUpdate.status ?? null
        }
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setError(null);

    const numericAmount = Number(amount.replace(/,/g, '.'));
    if (Number.isNaN(numericAmount) || numericAmount <= 0) {
      setError('Nominal refund harus lebih besar dari 0');
      return;
    }

    if (numericAmount > outstandingAmount + 0.01) {
      setError('Nominal refund melebihi sisa yang dapat direfund');
      return;
    }

    const refundedBy = Number(user?.id ?? 0);
    if (!refundedBy) {
      setError('Pengguna tidak dikenali. Silakan login ulang.');
      return;
    }

    setIsSubmitting(true);
    try {
      const refundUuid = generateUuid();
      const refundType = numericAmount >= outstandingAmount - 0.01 ? 'full' : 'partial';
      const paymentMethodId = Number(transaction.payment_method_id ?? 1);
      const cashDelta = paymentMethodId === 1 ? numericAmount : 0;
      const timestamp = new Date().toISOString();

      // Get shift_uuid from transaction, or try to get active shift if transaction doesn't have it
      let shiftUuid = transaction.shift_uuid ?? null;
      if (!shiftUuid) {
        try {
          const electronAPI = typeof window !== 'undefined' ? (window as { electronAPI?: { localDbGetActiveShift?: (userId: number, businessId?: number) => Promise<{ shift?: { uuid_id?: string } | null }> } }).electronAPI : undefined;
          if (electronAPI?.localDbGetActiveShift) {
            const activeShiftResponse = await electronAPI.localDbGetActiveShift(refundedBy, transaction.business_id);
            if (activeShiftResponse?.shift?.uuid_id) {
              shiftUuid = activeShiftResponse.shift.uuid_id;
              console.log(`🔗 [REFUND] Linked refund to active shift ${shiftUuid} (transaction had no shift_uuid)`);
            }
          }
        } catch (e) {
          console.warn('⚠️ [REFUND] Failed to get active shift for refund:', e);
        }
      }

      // Create refund payload - always use local transaction UUID
      const refundPayload = {
        uuid_id: refundUuid,
        transaction_uuid: transaction.id, // Always use local transaction UUID
        business_id: transaction.business_id,
        shift_uuid: shiftUuid,
        refund_amount: numericAmount,
        refund_type: refundType,
        reason: reason || null,
        note: note || null,
        refunded_by: refundedBy,
        payment_method_id: paymentMethodId,
        cash_delta: cashDelta,
        refunded_at: timestamp
      };

      // Calculate updated transaction state
      // Ensure both values are numbers before calculation
      const safeTotalRefunded = Number.isNaN(totalRefunded) ? 0 : Number(totalRefunded);
      const safeNumericAmount = Number.isNaN(numericAmount) ? 0 : Number(numericAmount);
      const newRefundTotal = Number((safeTotalRefunded + safeNumericAmount).toFixed(2));
      const newStatus = refundType === 'full' ? 'refunded' : transaction.status;
      
      const baseRefundRecord: TransactionRefund = {
        ...refundPayload,
        status: 'pending', // Always start as pending, will be marked completed if server accepts
        cash_delta: cashDelta
      };

      // Always create refund locally first (offline-first approach)
      const mergedRefunds: TransactionRefund[] = [
        baseRefundRecord,
        ...(transaction.refunds || [])
      ];

      const updatedTransaction: TransactionDetail = {
        ...transaction,
        refund_total: newRefundTotal,
        refund_status: refundType,
        status: newStatus,
        refunds: mergedRefunds
      };

      // Apply refund to local database
      await applyLocalRefund(
        baseRefundRecord,
        {
          refund_total: newRefundTotal,
          refund_status: refundType,
          status: newStatus
        }
      );

      // Queue refund for sync (will sync when transaction exists on server)
      await smartSyncService.queueRefund(refundPayload);

      // If online, try to sync immediately (but don't fail if transaction doesn't exist yet)
      if (isOnline) {
        try {
          // Try to find transaction on server
          let transactionFound = false;
          let serverTransactionUuid = transaction.id;

          try {
            const checkResponse = await fetch(getApiUrl(`/api/transactions/${transaction.id}`), {
              method: 'GET',
              headers: {
                'Content-Type': 'application/json',
              },
            });

            if (checkResponse.ok) {
              transactionFound = true;
            } else if (transaction.receipt_number) {
              // Try receipt_number as fallback
              const receiptCheckResponse = await fetch(getApiUrl(`/api/transactions/${transaction.receipt_number}`), {
                method: 'GET',
                headers: {
                  'Content-Type': 'application/json',
                },
              });
              
              if (receiptCheckResponse.ok) {
                const receiptData = await receiptCheckResponse.json();
                if (receiptData.transaction?.uuid_id) {
                  serverTransactionUuid = receiptData.transaction.uuid_id;
                  transactionFound = true;
                }
              }
            }
          } catch (checkError) {
            console.warn('[RefundModal] Transaction check failed, will sync later:', checkError);
          }

          // If transaction exists on server, try to create refund immediately
          if (transactionFound) {
            try {
              const response = await fetch(getApiUrl(`/api/transactions/${serverTransactionUuid}/refund`), {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  ...refundPayload,
                  transaction_uuid: serverTransactionUuid
                }),
              });

              if (response.ok) {
                const result = await response.json();
                // Update local refund status to uploaded (synced to server)
                // DO NOT update transaction.refund_total here - it was already updated when we created the refund locally
                // Only update the refund record status to mark it as synced
                // Use the server's refund data but keep our UUID to prevent duplicates
                const completedRefund: TransactionRefund = {
                  ...baseRefundRecord, // Use local refund data (with our UUID)
                  ...(result.refund || {}), // Merge server data (like server ID, timestamps)
                  uuid_id: baseRefundRecord.uuid_id, // IMPORTANT: Keep our UUID to match existing record
                  status: 'completed' // Mark as completed
                };
                // Update existing refund record (will update, not insert duplicate due to UUID check)
                await applyLocalRefund(completedRefund, {
                  id: transaction.id, // Need transaction ID for the query
                  // Pass undefined to avoid updating transaction - it's already been updated
                  refund_total: undefined,
                  refund_status: undefined,
                  status: undefined
                });
                console.log('[RefundModal] Refund synced to server successfully');
              } else {
                console.warn('[RefundModal] Server refund creation failed, will sync later. Status:', response.status);
                // Don't throw - refund is already saved locally and queued for sync
              }
            } catch (serverError) {
              console.warn('[RefundModal] Server refund creation error, will sync later:', serverError);
              // Don't throw - refund is already saved locally and queued for sync
            }
          } else {
            // Transaction doesn't exist on server yet - reset its sync status and queue for sync
            console.log('[RefundModal] Transaction not on server yet, marking for sync...');
            const electronAPI = typeof window !== 'undefined' ? (window as { electronAPI?: Record<string, unknown> }).electronAPI : undefined;
            if (electronAPI?.localDbResetTransactionSync) {
              try {
                await (electronAPI.localDbResetTransactionSync as (transactionId: string) => Promise<{ success: boolean }>)(transaction.id);
                // Trigger sync to upload transaction, then refund will sync
                await smartSyncService.forceSync();
              } catch (resetError) {
                console.warn('[RefundModal] Failed to reset transaction sync status:', resetError);
                // Continue - refund is queued and will sync when transaction syncs
              }
            }
          }
        } catch (onlineError) {
          console.warn('[RefundModal] Online sync attempt failed, refund will sync later:', onlineError);
          // Don't throw - refund is already saved locally and queued for sync
        }
      }

      if (updatedTransaction) {
        onSuccess(updatedTransaction);
      }

      handleClose();
    } catch (err) {
      console.error('Failed to process refund:', err);
      const message = err instanceof Error ? err.message : 'Gagal membuat refund';
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Buat Refund</h2>
            <p className="text-sm text-gray-500 mt-1">
              Refund untuk transaksi #{transaction.receipt_number ?? transaction.id}
            </p>
          </div>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Tutup"
          >
            ✕
          </button>
        </div>

        <div className="bg-gray-50 rounded-xl p-4 mb-4">
          <div className="flex items-center justify-between text-sm text-gray-600">
            <span>Total transaksi</span>
            <span className="font-semibold text-gray-900">{formatCurrency(transaction.final_amount)}</span>
          </div>
          <div className="flex items-center justify-between text-sm text-gray-600 mt-1">
            <span>Sudah direfund</span>
            <span className="font-semibold text-gray-900">{formatCurrency(totalRefunded)}</span>
          </div>
          <div className="flex items-center justify-between text-sm text-gray-600 mt-1">
            <span>Sisa dapat direfund</span>
            <span className="font-semibold text-gray-900">{formatCurrency(outstandingAmount)}</span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">
              Nominal Refund
            </label>
            <input
              type="number"
              min="0"
              max={outstandingAmount}
              step="100"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded-lg border-gray-300 focus:border-blue-500 focus:ring-blue-500 text-black"
              placeholder="Masukkan nominal"
              required
              disabled={outstandingAmount === 0}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">
              Alasan
            </label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full rounded-lg border-gray-300 focus:border-blue-500 focus:ring-blue-500 text-black"
            >
              {REFUND_REASONS.map((option) => (
                <option key={option} value={option} className="text-black">
                  {option}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">
              Catatan (opsional)
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              className="w-full rounded-lg border-gray-300 focus:border-blue-500 focus:ring-blue-500 text-black"
              placeholder="Tambahkan catatan tambahan"
            />
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          {!isOnline && (
            <div className="rounded-lg bg-yellow-50 border border-yellow-200 px-3 py-2 text-sm text-yellow-800">
              Saat ini offline. Refund akan disinkronkan otomatis ketika koneksi kembali.
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 rounded-lg text-gray-600 hover:text-gray-800"
              disabled={isSubmitting}
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={isSubmitting || outstandingAmount === 0}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:text-gray-600"
            >
              {isSubmitting ? 'Menyimpan...' : 'Simpan Refund'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default RefundModal;

