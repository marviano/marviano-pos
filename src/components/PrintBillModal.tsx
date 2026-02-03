'use client';

import { useState, useEffect } from 'react';
import { X } from 'lucide-react';

type PromotionSelection = 'none' | 'percent_10' | 'percent_15' | 'percent_20' | 'percent_25' | 'percent_30' | 'percent_35' | 'percent_50' | 'custom' | 'free';

export interface PrintBillModalData {
  transactionId: string;
  transaction: Record<string, unknown>;
  receiptItems: Array<{ name: string; quantity: number; price: number; total_price: number }>;
  total: number;
  tableNumber: string;
  cashier: string;
  date: string;
  transactionType: string;
  pickupMethod: string;
  businessId: number;
}

interface PrintBillModalProps {
  isOpen: boolean;
  onClose: () => void;
  data: PrintBillModalData | null;
  onPrinted?: () => void;
}

const percentOptions: Array<{ id: PromotionSelection; label: string }> = [
  { id: 'percent_10', label: '10%' },
  { id: 'percent_15', label: '15%' },
  { id: 'percent_20', label: '20%' },
  { id: 'percent_25', label: '25%' },
  { id: 'percent_30', label: '30%' },
  { id: 'percent_35', label: '35%' },
  { id: 'percent_50', label: '50%' },
];

const getElectronAPI = () => (typeof window !== 'undefined' ? window.electronAPI : undefined);

function promotionFromTransaction(tx: Record<string, unknown>): { selection: PromotionSelection; customAmount: string } {
  const vt = typeof tx.voucher_type === 'string' ? tx.voucher_type.toLowerCase() : '';
  const vv = typeof tx.voucher_value === 'number' ? tx.voucher_value : (typeof tx.voucher_value === 'string' ? parseFloat(tx.voucher_value) : NaN);
  const vd = typeof tx.voucher_discount === 'number' ? tx.voucher_discount : (typeof tx.voucher_discount === 'string' ? parseFloat(tx.voucher_discount) : 0);

  if (vt === 'free') return { selection: 'free', customAmount: '' };
  if (vt === 'percent' && !Number.isNaN(vv)) {
    const s: PromotionSelection = `percent_${vv}` as PromotionSelection;
    if (['percent_10', 'percent_15', 'percent_20', 'percent_25', 'percent_30', 'percent_35', 'percent_50'].includes(s))
      return { selection: s, customAmount: '' };
  }
  if (vt === 'nominal' && (vd > 0 || (!Number.isNaN(vv) && vv > 0))) {
    const amt = vd > 0 ? vd : vv;
    return { selection: 'custom', customAmount: String(Math.round(amt)) };
  }
  return { selection: 'none', customAmount: '' };
}

export default function PrintBillModal({ isOpen, onClose, data, onPrinted }: PrintBillModalProps) {
  const [promotionSelection, setPromotionSelection] = useState<PromotionSelection>('none');
  const [customVoucherAmount, setCustomVoucherAmount] = useState<string>('');
  const [isPrinting, setIsPrinting] = useState(false);

  const orderTotal = data?.total ?? 0;

  const promotionDetails = (() => {
    switch (promotionSelection) {
      case 'percent_10': return { type: 'percent' as const, value: 10, label: '10%', discount: Math.round(orderTotal * 0.1) };
      case 'percent_15': return { type: 'percent' as const, value: 15, label: '15%', discount: Math.round(orderTotal * 0.15) };
      case 'percent_20': return { type: 'percent' as const, value: 20, label: '20%', discount: Math.round(orderTotal * 0.2) };
      case 'percent_25': return { type: 'percent' as const, value: 25, label: '25%', discount: Math.round(orderTotal * 0.25) };
      case 'percent_30': return { type: 'percent' as const, value: 30, label: '30%', discount: Math.round(orderTotal * 0.3) };
      case 'percent_35': return { type: 'percent' as const, value: 35, label: '35%', discount: Math.round(orderTotal * 0.35) };
      case 'percent_50': return { type: 'percent' as const, value: 50, label: '50%', discount: Math.round(orderTotal * 0.5) };
      case 'custom': {
        const nominal = parseFloat(customVoucherAmount) || 0;
        const effective = Math.min(nominal, orderTotal);
        const label = effective > 0 ? `Voucher Custom Rp ${effective.toLocaleString('id-ID')}` : 'Voucher Custom';
        return { type: 'nominal' as const, value: effective, label, discount: effective };
      }
      case 'free':
        return { type: 'free' as const, value: null, label: 'Gratis 100%', discount: orderTotal };
      default:
        return { type: 'none' as const, value: null, label: '', discount: 0 };
    }
  })();

  const voucherDiscount = Math.min(orderTotal, Math.max(0, promotionDetails.discount || 0));
  const finalTotal = Math.max(0, orderTotal - voucherDiscount);

  useEffect(() => {
    if (isOpen && data?.transaction) {
      const { selection, customAmount } = promotionFromTransaction(data.transaction);
      setPromotionSelection(selection);
      setCustomVoucherAmount(customAmount);
    }
  }, [isOpen, data?.transaction]);

  const handlePromotionSelect = (selection: PromotionSelection) => {
    if (selection === 'none' || promotionSelection === selection) {
      setPromotionSelection('none');
      setCustomVoucherAmount('');
      return;
    }
    setPromotionSelection(selection);
    if (selection !== 'custom') setCustomVoucherAmount('');
  };

  const handlePrint = async () => {
    if (!data) return;
    const api = getElectronAPI();
    if (!api?.localDbUpdateTransactionVoucher || !api?.printReceipt) {
      alert('Print Bill tidak tersedia. Pastikan aplikasi terhubung dengan database lokal.');
      return;
    }

    setIsPrinting(true);
    try {
      const voucherType = promotionDetails.type === 'none' ? 'none' : promotionDetails.type;
      const voucherValue = promotionDetails.type === 'percent' ? (promotionDetails.value ?? null)
        : promotionDetails.type === 'nominal' ? (promotionDetails.value ?? null)
          : promotionDetails.type === 'free' ? 100 : null;
      const voucherLabel = promotionDetails.label || null;

      const updateRes = await api.localDbUpdateTransactionVoucher(data.transactionId, {
        voucher_discount: voucherDiscount,
        voucher_type: voucherType,
        voucher_value: voucherValue,
        voucher_label: voucherLabel,
        final_amount: finalTotal,
      });
      if (updateRes && !(updateRes as { success?: boolean }).success) {
        alert(`Gagal menyimpan diskon: ${(updateRes as { error?: string }).error || 'Unknown error'}`);
        return;
      }

      const printData = {
        type: 'transaction',
        printerType: 'receiptPrinter',
        printerName: '',
        business_id: data.businessId,
        items: data.receiptItems,
        total: orderTotal,
        final_amount: finalTotal,
        voucherDiscount: voucherDiscount > 0 ? voucherDiscount : undefined,
        voucherLabel: voucherLabel ?? undefined,
        date: data.date,
        tableNumber: data.tableNumber,
        cashier: data.cashier,
        transactionType: data.transactionType,
        pickupMethod: data.pickupMethod,
        isBill: true,
      };

      const printResult = await api.printReceipt(printData);
      if (printResult && typeof printResult === 'object' && 'success' in printResult && !(printResult as { success: boolean }).success) {
        alert(`Gagal mencetak bill: ${(printResult as { error?: string }).error || 'Unknown error'}`);
        return;
      }
      onPrinted?.();
      onClose();
    } catch (e) {
      console.error('PrintBillModal print error:', e);
      alert('Terjadi kesalahan saat mencetak bill');
    } finally {
      setIsPrinting(false);
    }
  };

  if (!isOpen) return null;

  const hasValidCustom = promotionSelection !== 'custom' || (parseFloat(customVoucherAmount) || 0) > 0;
  const canPrint = hasValidCustom && !isPrinting;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h2 className="text-lg font-bold text-black">Print Bill</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isPrinting}
            className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-50 text-black"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 space-y-4 overflow-y-auto flex-1">
          {data && (
            <>
              <div className="flex justify-between text-sm">
                <span className="text-black">Total pesanan</span>
                <span className="font-semibold text-black">Rp {orderTotal.toLocaleString('id-ID')}</span>
              </div>
              {voucherDiscount > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-black">Diskon</span>
                  <span className="font-semibold text-green-700">- Rp {voucherDiscount.toLocaleString('id-ID')}</span>
                </div>
              )}
              <div className="flex justify-between text-base font-bold border-t border-gray-200 pt-2 text-black">
                <span>Total bayar</span>
                <span>Rp {finalTotal.toLocaleString('id-ID')}</span>
              </div>

              <div className="pt-2">
                <p className="text-xs font-medium text-black mb-2">Diskon & Potongan</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => handlePromotionSelect('none')}
                    className={`px-3 py-1.5 rounded-lg border text-xs font-medium text-black ${promotionSelection === 'none' ? 'bg-gray-200 border-gray-400' : 'bg-white border-gray-300 hover:bg-gray-50'}`}
                  >
                    None
                  </button>
                  {percentOptions.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => handlePromotionSelect(opt.id)}
                      className={`px-3 py-1.5 rounded-lg border text-xs font-medium text-black ${promotionSelection === opt.id ? 'bg-green-100 border-green-400' : 'bg-white border-gray-300 hover:bg-gray-50'}`}
                    >
                      {opt.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => handlePromotionSelect('free')}
                    className={`px-3 py-1.5 rounded-lg border text-xs font-medium text-black ${promotionSelection === 'free' ? 'bg-green-100 border-green-400' : 'bg-white border-gray-300 hover:bg-gray-50'}`}
                  >
                    FREE
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap gap-2 items-center">
                  <button
                    type="button"
                    onClick={() => handlePromotionSelect('custom')}
                    className={`px-3 py-1.5 rounded-lg border text-xs font-medium text-black ${promotionSelection === 'custom' ? 'bg-green-100 border-green-400' : 'bg-white border-gray-300 hover:bg-gray-50'}`}
                  >
                    Custom Nominal
                  </button>
                  {promotionSelection === 'custom' && (
                    <input
                      type="text"
                      value={customVoucherAmount}
                      onChange={(e) => setCustomVoucherAmount(e.target.value.replace(/\D/g, ''))}
                      placeholder="Nominal"
                      className="w-32 px-2 py-1.5 border border-gray-300 rounded-lg text-sm text-black bg-white"
                    />
                  )}
                </div>
              </div>
            </>
          )}
        </div>
        <div className="p-4 border-t border-gray-200 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isPrinting}
            className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-black hover:bg-gray-50 disabled:opacity-50"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={handlePrint}
            disabled={!canPrint}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
          >
            {isPrinting ? 'Mencetak...' : 'Print'}
          </button>
        </div>
      </div>
    </div>
  );
}
