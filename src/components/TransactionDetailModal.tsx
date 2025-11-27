import React, { useState, useCallback, useEffect, useMemo } from 'react';
import RefundModal from './RefundModal';
import { useAuth } from '@/hooks/useAuth';

export interface TransactionItem {
  id: string; // Changed to string for UUID
  product_name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  custom_note?: string;
  customizations?: Array<{
    customization_id: number;
    customization_name: string;
    selected_options: Array<{
      option_id: number;
      option_name: string;
      price_adjustment: number;
    }>;
  }>;
  bundleSelections?: Array<{
    category2_id: number;
    category2_name: string;
    selectedProducts: Array<{
      product: { id: number; nama: string };
      quantity?: number;
      customizations?: Array<{
        customization_id: number;
        customization_name: string;
        selected_options: Array<{
          option_id: number;
          option_name: string;
          price_adjustment: number;
        }>;
      }>;
      customNote?: string;
    }>;
    requiredQuantity: number;
  }>;
}

export interface TransactionRefund {
  id?: string;
  uuid_id?: string;
  transaction_uuid: string;
  refund_amount: number;
  cash_delta: number;
  refund_type?: string;
  reason?: string | null;
  note?: string | null;
  status?: string;
  refunded_at: string;
  refunded_by?: number;
}

export interface TransactionDetail {
  id: string; // Changed to string for UUID
  business_id: number;
  user_id: number;
  user_name: string;
  business_name: string;
  payment_method: 'cash' | 'debit' | 'qr' | 'ewallet' | 'cl' | 'voucher' | 'qpon' | 'gofood' | 'grabfood' | 'shopeefood' | 'tiktok';
  payment_method_id?: number; // Source of truth - foreign key to payment_methods table
  pickup_method: 'dine-in' | 'take-away';
  total_amount: number;
  voucher_discount: number;
  final_amount: number;
  amount_received: number;
  change_amount: number;
  contact_id?: number | null;
  customer_name?: string | null;
  customer_unit?: number | null;
  receipt_number?: number | null;
  transaction_type?: 'drinks' | 'bakery';
  bank_id?: number | null;
  bank_name?: string | null;
  card_number?: string | null;
  cl_account_id?: number | null;
  cl_account_name?: string | null;
  created_at: string;
  items: TransactionItem[];
  voucher_type?: 'none' | 'percent' | 'nominal' | 'free';
  voucher_value?: number | null;
  voucher_label?: string | null;
  refund_status?: string | null;
  refund_total?: number | null;
  status?: string | null;
  shift_uuid?: string | null;
  refunds?: TransactionRefund[];
}

interface TransactionDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  transaction: TransactionDetail | null;
  isLoading?: boolean;
  canRefund?: boolean;
  onTransactionUpdated?: (transaction: TransactionDetail) => void;
}

// Removed parseJsonField - no longer using JSON for customizations

// Payment method ID to code mapping (matches database payment_methods table)
// 1=cash, 2=debit, 3=qr, 4=ewallet, 5=cl, 6=voucher,
// 14=gofood, 15=grabfood, 16=shopeefood, 17=tiktok, 18=qpon
const paymentMethodIdToCode: Record<number, string> = {
  1: 'cash',
  2: 'debit',
  3: 'qr',
  4: 'ewallet',
  5: 'cl',
  6: 'voucher',
  14: 'gofood',
  15: 'grabfood',
  16: 'shopeefood',
  17: 'tiktok',
  18: 'qpon'
};

const TransactionDetailModal: React.FC<TransactionDetailModalProps> = ({
  isOpen,
  onClose,
  transaction,
  isLoading = false,
  canRefund = false,
  onTransactionUpdated
}) => {
  const { user } = useAuth();
  const [isReprinting, setIsReprinting] = useState(false);
  const [reprintStatus, setReprintStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [receiptizeCounter, setReceiptizeCounter] = useState<number | null>(null);
  const [isReceiptize, setIsReceiptize] = useState(false);
  const [isRefundModalOpen, setIsRefundModalOpen] = useState(false);

  const totalRefunded = useMemo(() => {
    if (!transaction) {
      return 0;
    }
    if (typeof transaction.refund_total === 'number') {
      return transaction.refund_total;
    }
    return (transaction.refunds || []).reduce(
      (sum, refund) => sum + (refund.refund_amount || 0),
      0
    );
  }, [transaction]);

  const outstandingAmount = useMemo(() => {
    if (!transaction) return 0;
    return Math.max(0, Number(transaction.final_amount || 0) - totalRefunded);
  }, [transaction, totalRefunded]);

  // Get payment method code from ID or string
  const getPaymentMethodCode = useCallback((transaction: TransactionDetail): string => {
    // Use payment_method_id as source of truth if available
    if (transaction.payment_method_id && paymentMethodIdToCode[transaction.payment_method_id]) {
      return paymentMethodIdToCode[transaction.payment_method_id];
    }
    // Fallback to payment_method string
    return transaction.payment_method?.toLowerCase() || 'cash';
  }, []);

  const getPaymentMethodLabel = useCallback((transaction: TransactionDetail | string) => {
    // Handle both transaction object and string for backward compatibility
    const method = typeof transaction === 'string'
      ? transaction.toLowerCase()
      : getPaymentMethodCode(transaction as TransactionDetail);
    
    const labels: { [key: string]: string } = {
      'cash': 'Cash/Tunai',
      'debit': 'Debit Card',
      'qr': 'QR Code',
      'ewallet': 'E-Wallet',
      'cl': 'City Ledger',
      'voucher': 'Voucher',
      'qpon': 'Qpon',
      'gofood': 'GoFood',
      'grabfood': 'GrabFood',
      'shopeefood': 'ShopeeFood',
      'tiktok': 'TikTok'
    };
    return labels[method] || method;
  }, [getPaymentMethodCode]);

  // Helper function to calculate customization price adjustments
  const sumCustomizationPrice = useCallback((customizations?: TransactionItem['customizations']) => {
    if (!customizations || customizations.length === 0) return 0;
    return customizations.reduce((sum, customization) => {
      const optionTotal = customization.selected_options.reduce(
        (optionSum, option) => optionSum + (option.price_adjustment || 0),
        0
      );
      return sum + optionTotal;
    }, 0);
  }, []);

  // Reprint functionality
  const handleReprint = useCallback(async () => {
    if (!transaction || isReprinting) return;

    setIsReprinting(true);
    setReprintStatus('idle');

    try {
      const electronAPI = (window as { electronAPI?: {
        getPrinter1AuditLog?: (fromDate: string, toDate: string, limit: number) => Promise<{ entries?: unknown[] }>;
        getPrinter2AuditLog?: (fromDate: string, toDate: string, limit: number) => Promise<{ entries?: unknown[] }>;
        printReceipt?: (data: unknown) => Promise<{ success?: boolean; error?: string }>;
        logPrinter1Print?: (transactionId: string, counter: number, globalCounter: number, isReprint?: boolean) => Promise<{ success?: boolean }>;
        logPrinter2Print?: (transactionId: string, counter: number, mode: string, cycleNumber?: number, globalCounter?: number, isReprint?: boolean) => Promise<{ success?: boolean }>;
      } }).electronAPI;
      if (!electronAPI) {
        throw new Error('Electron API not available');
      }

      // Check which printer this transaction was originally printed on
      // Fetch ALL entries (no date filter) to ensure we catch all reprints regardless of when they happened
      // Use a very wide date range to catch everything
      const startDate = '2020-01-01'; // Very old date to catch all entries
      const endDate = new Date();
      endDate.setFullYear(endDate.getFullYear() + 1); // Very future date to catch all entries
      
      const printer1Result = await electronAPI.getPrinter1AuditLog?.(
        startDate,
        endDate.toISOString().split('T')[0],
        50000 // Very high limit to catch all entries
      );

      const printer2Result = await electronAPI.getPrinter2AuditLog?.(
        startDate,
        endDate.toISOString().split('T')[0],
        50000 // Very high limit to catch all entries
      );

      // Find original print record (must be is_reprint = 0 or undefined/null)
      let originalPrinterType: 'receiptPrinter' | 'receiptizePrinter' | null = null;
      let originalCounter = 0;
      let originalGlobalCounter = 0;

      // Check Printer 1 audit log - find the ORIGINAL print (not a reprint)
      if (printer1Result?.entries) {
        const printer1Entry = printer1Result.entries.find((entry: unknown) => {
          const typedEntry = entry as { transaction_id?: string; printer1_receipt_number?: number; global_counter?: number; is_reprint?: number };
          return String(typedEntry.transaction_id) === String(transaction.id) && 
                 (typedEntry.is_reprint === 0 || typedEntry.is_reprint === undefined || typedEntry.is_reprint === null);
        }) as { transaction_id?: string; printer1_receipt_number?: number; global_counter?: number } | undefined;
        if (printer1Entry) {
          originalPrinterType = 'receiptPrinter';
          originalCounter = Number(printer1Entry.printer1_receipt_number) || 0;
          originalGlobalCounter = Number(printer1Entry.global_counter) || 0;
        }
      }

      // Check Printer 2 audit log (only if not found in Printer 1) - find the ORIGINAL print (not a reprint)
      if (!originalPrinterType && printer2Result?.entries) {
        const printer2Entry = printer2Result.entries.find((entry: unknown) => {
          const typedEntry = entry as { transaction_id?: string; printer2_receipt_number?: number; global_counter?: number; is_reprint?: number };
          return String(typedEntry.transaction_id) === String(transaction.id) && 
                 (typedEntry.is_reprint === 0 || typedEntry.is_reprint === undefined || typedEntry.is_reprint === null);
        }) as { transaction_id?: string; printer2_receipt_number?: number; global_counter?: number } | undefined;
        if (printer2Entry) {
          originalPrinterType = 'receiptizePrinter';
          originalCounter = Number(printer2Entry.printer2_receipt_number) || 0;
          originalGlobalCounter = Number(printer2Entry.global_counter) || 0;
        }
      }

      if (!originalPrinterType) {
        throw new Error('No original print record found for this transaction');
      }

      // Calculate reprint count for this transaction
      // Count ALL existing reprints (is_reprint = 1) for this transaction
      let reprintCount = 1;
      if (originalPrinterType === 'receiptPrinter' && printer1Result?.entries) {
        const existingReprints = printer1Result.entries.filter((entry: unknown) => {
          const typedEntry = entry as { transaction_id?: string; is_reprint?: number };
          // Explicitly check for is_reprint === 1 (not just truthy, to avoid null/undefined)
          return String(typedEntry.transaction_id) === String(transaction.id) && 
                 typedEntry.is_reprint === 1;
        });
        reprintCount = existingReprints.length + 1;
        console.log(`[Reprint] Found ${existingReprints.length} existing reprints for transaction ${transaction.id}, new count will be ${reprintCount}`);
      } else if (originalPrinterType === 'receiptizePrinter' && printer2Result?.entries) {
        const existingReprints = printer2Result.entries.filter((entry: unknown) => {
          const typedEntry = entry as { transaction_id?: string; is_reprint?: number };
          // Explicitly check for is_reprint === 1 (not just truthy, to avoid null/undefined)
          return String(typedEntry.transaction_id) === String(transaction.id) && 
                 typedEntry.is_reprint === 1;
        });
        reprintCount = existingReprints.length + 1;
        console.log(`[Reprint] Found ${existingReprints.length} existing reprints for transaction ${transaction.id}, new count will be ${reprintCount}`);
      }

      // Transform transaction items to receipt format with customizations and bundle selections
      const receiptItems: Array<{ name: string; quantity: number; price: number; total_price: number }> = [];
      
      transaction.items.forEach(item => {
        // Calculate base price (unit_price already includes customizations, but we need to format the name)
        const itemPrice = item.unit_price;
        
        // Format item name with customizations and custom note if any
        let itemName = item.product_name;
        if (item.customizations && item.customizations.length > 0) {
          const customizationText = item.customizations.map(c => 
            `${c.customization_name}: ${c.selected_options.map(opt => opt.option_name).join(', ')}`
          ).join(', ');
          itemName = `${itemName} (${customizationText})`;
        }
        // Add custom note if exists
        if (item.custom_note) {
          if (itemName.includes('(')) {
            itemName = `${itemName}, ${item.custom_note})`;
          } else {
            itemName = `${itemName} (${item.custom_note})`;
          }
        }
        
        // Add main bundle item
        receiptItems.push({
          name: itemName,
          quantity: item.quantity,
          price: itemPrice,
          total_price: item.total_price
        });
        
        // Add bundle selections as sub-items
        if (item.bundleSelections && item.bundleSelections.length > 0) {
          item.bundleSelections.forEach(bundleSel => {
            bundleSel.selectedProducts.forEach(sp => {
              // Multiply by bundle quantity and selected product quantity
              const selectionQty =
                typeof sp.quantity === 'number' && !Number.isNaN(sp.quantity) ? sp.quantity : 1;
              const totalQty = item.quantity * selectionQty;
              const customizationDetails: string[] = [];

              if (sp.customizations && sp.customizations.length > 0) {
                sp.customizations.forEach(customization => {
                  const optionNames = customization.selected_options.map(opt => opt.option_name).join(', ');
                  if (optionNames) {
                    customizationDetails.push(
                      customization.customization_name
                        ? `${customization.customization_name}: ${optionNames}`
                        : optionNames
                    );
                  }
                });
              }

              if (sp.customNote && sp.customNote.trim() !== '') {
                customizationDetails.push(sp.customNote.trim());
              }

              let subItemName = `  └ ${sp.product.nama}${selectionQty > 1 ? ` (×${selectionQty})` : ''}`;
              if (customizationDetails.length > 0) {
                subItemName = `${subItemName} (${customizationDetails.join(', ')})`;
              }

              const perUnitAdjustment = sumCustomizationPrice(sp.customizations);
              const perUnitTotal = perUnitAdjustment;

              receiptItems.push({
                name: subItemName,
                quantity: totalQty,
                price: perUnitTotal,
                total_price: perUnitTotal * totalQty
              });
            });
          });
        }
      });

      // Get cashier name with fallback
      const cashierName = transaction.user_name || user?.name || 'Kasir';

      // Prepare reprint data using original counter
      const reprintData = {
        type: 'transaction',
        printerType: originalPrinterType,
        business_id: transaction.business_id,
        items: receiptItems,
        total: transaction.final_amount,
        paymentMethod: getPaymentMethodLabel(transaction),
        amountReceived: transaction.amount_received,
        change: transaction.change_amount,
        date: transaction.created_at,
        receiptNumber: transaction.id,
        cashier: cashierName,
        transactionType: transaction.transaction_type || 'drinks',
        pickupMethod: transaction.pickup_method,
        // Use original counters for reprint
        [originalPrinterType === 'receiptPrinter' ? 'printer1Counter' : 'printer2Counter']: originalCounter,
        globalCounter: originalGlobalCounter,
        isReprint: true, // Flag to indicate this is a reprint
        reprintCount: reprintCount // Reprint counter for display
      };

      // Print the receipt
      const printResult = await electronAPI.printReceipt?.(reprintData);
      
      if (printResult?.success) {

        // Log the reprint in audit log with reprint flag and count
        if (originalPrinterType === 'receiptPrinter') {
          const logPrinter1 = electronAPI.logPrinter1Print as ((transactionId: string, printer1ReceiptNumber: number, globalCounter?: number | null, isReprint?: boolean, reprintCount?: number) => Promise<{ success: boolean }>) | undefined;
          await logPrinter1?.(
            transaction.id, 
            originalCounter, 
            originalGlobalCounter,
            true, // isReprint flag
            reprintCount // reprint count
          );
        } else {
          const logPrinter2 = electronAPI.logPrinter2Print as ((transactionId: string, printer2ReceiptNumber: number, mode: 'auto' | 'manual', cycleNumber?: number, globalCounter?: number | null, isReprint?: boolean, reprintCount?: number) => Promise<{ success: boolean }>) | undefined;
          await logPrinter2?.(
            transaction.id, 
            originalCounter, 
            'manual', 
            undefined, 
            originalGlobalCounter,
            true, // isReprint flag
            reprintCount // reprint count
          );
        }
        
        setReprintStatus('success');
        setTimeout(() => setReprintStatus('idle'), 3000);
      } else {
        throw new Error(printResult?.error || 'Print failed');
      }

    } catch (error) {
      console.error('Reprint failed:', error);
      setReprintStatus('error');
      setTimeout(() => setReprintStatus('idle'), 5000);
    } finally {
      setIsReprinting(false);
    }
  }, [transaction, isReprinting, getPaymentMethodLabel, sumCustomizationPrice, user]);

  // Fetch receiptize counter when modal opens
  useEffect(() => {
    const fetchReceiptizeCounter = async () => {
      if (!transaction || !isOpen) {
        setReceiptizeCounter(null);
        setIsReceiptize(false);
        return;
      }

      const electronAPI = (window as { electronAPI?: {
        getPrinter2AuditLog?: (fromDate: string, toDate: string, limit: number) => Promise<{ entries?: unknown[] }>;
      } }).electronAPI;
      
      if (!electronAPI) return;

      try {
        // Fetch printer2 audit log to check if this is a receiptize transaction
        const transactionDate = new Date(transaction.created_at);
        const startDate = new Date(transactionDate);
        startDate.setDate(startDate.getDate() - 1);
        const endDate = new Date(transactionDate);
        endDate.setDate(endDate.getDate() + 1);
        
        const printer2Result = await electronAPI.getPrinter2AuditLog?.(
          startDate.toISOString().split('T')[0],
          endDate.toISOString().split('T')[0],
          1000
        );

        if (printer2Result?.entries) {
          // Find the original print (not reprint) for this transaction
          const originalEntry = printer2Result.entries.find((entry: unknown) => {
            const typedEntry = entry as { transaction_id?: string; printer2_receipt_number?: number; is_reprint?: number };
            return String(typedEntry.transaction_id) === String(transaction.id) && 
                   (typedEntry.is_reprint === 0 || typedEntry.is_reprint === undefined);
          }) as { printer2_receipt_number?: number } | undefined;

          if (originalEntry && originalEntry.printer2_receipt_number) {
            setReceiptizeCounter(originalEntry.printer2_receipt_number);
            setIsReceiptize(true);
            return;
          }
        }

        // Not a receiptize transaction
        setReceiptizeCounter(null);
        setIsReceiptize(false);
      } catch (error) {
        console.error('Error fetching receiptize counter:', error);
        setReceiptizeCounter(null);
        setIsReceiptize(false);
      }
    };

    fetchReceiptizeCounter();
  }, [transaction, isOpen]);

  if (!isOpen) return null;

  const formatPrice = (price: number) => {
    return `Rp ${price.toLocaleString('id-ID')}`;
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('id-ID', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const getPickupMethodLabel = (method: string) => {
    const labels: { [key: string]: string } = {
      'dine-in': 'Dine In',
      'take-away': 'Take Away'
    };
    return labels[method] || method;
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 rounded-t-xl">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-gray-900">
                {isLoading ? 'Memuat Detail Transaksi...' : `Detail Transaksi #${transaction?.id || ''}`}
              </h2>
              <div className="flex items-center gap-4 mt-1">
                {isLoading ? (
                  <div className="flex items-center gap-2">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                    <p className="text-sm text-gray-500">Memuat...</p>
                  </div>
                ) : (
                  <>
                    <p className="text-sm text-gray-500">
                      {formatDate(transaction?.created_at || '')}
                    </p>
                    {isReceiptize && receiptizeCounter !== null ? (
                      <span className="text-sm font-medium text-blue-600">
                        #{receiptizeCounter}
                      </span>
                    ) : transaction?.receipt_number ? (
                      <span className="text-sm font-medium text-blue-600">
                        #{transaction.receipt_number}
                      </span>
                    ) : null}
                    {transaction?.transaction_type && (
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                        transaction.transaction_type === 'drinks' 
                          ? 'bg-blue-100 text-blue-800' 
                          : 'bg-orange-100 text-orange-800'
                      }`}>
                        {transaction.transaction_type === 'drinks' ? '🥤' : '🥖'} {transaction.transaction_type}
                      </span>
                    )}
                  </>
                )}
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="p-6 flex items-center justify-center min-h-[400px]">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
              <p className="text-gray-600">Memuat detail transaksi...</p>
            </div>
          </div>
        ) : transaction ? (
          <div className="p-6 space-y-6">
          {/* Transaction Summary */}
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg p-4 border border-blue-200">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="text-center">
                <p className="text-sm font-medium text-gray-600">Total Belanja</p>
                <p className="text-xl font-bold text-blue-600">
                  {formatPrice(transaction.total_amount)}
                </p>
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-gray-600">Diskon Voucher</p>
                <p className="text-xl font-bold text-red-600">
                  -{formatPrice(transaction.voucher_discount)}
                </p>
                {transaction.voucher_label && (
                  <p className="text-xs text-red-500 font-medium mt-1">
                    {transaction.voucher_label}
                  </p>
                )}
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-gray-600">Total Bayar</p>
                <p className="text-xl font-bold text-green-600">
                  {formatPrice(transaction.final_amount)}
                </p>
              </div>
            </div>
          </div>

          {/* Customer Information */}
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center">
              <span className="w-6 h-6 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-sm font-bold mr-2">
                👤
              </span>
              Informasi Pelanggan
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="text-sm font-medium text-gray-600">Nama Pelanggan</p>
                <p className="text-base text-gray-900">
                  {transaction.customer_name || 'Tidak ada nama'}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-600">Contact ID</p>
                <p className="text-base text-gray-900">
                  {transaction.contact_id || 'Tidak ada'}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-600">Customer Unit</p>
                <p className="text-base text-gray-900">
                  {transaction.customer_unit !== undefined && transaction.customer_unit !== null
                    ? transaction.customer_unit
                    : 'Tidak dicatat'}
                </p>
              </div>
            </div>
          </div>

          {/* Payment Information */}
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center">
              <span className="w-6 h-6 bg-green-100 text-green-600 rounded-full flex items-center justify-center text-sm font-bold mr-2">
                💳
              </span>
              Informasi Pembayaran
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="text-sm font-medium text-gray-600">Metode Pembayaran</p>
                <p className="text-base text-gray-900">
                  {getPaymentMethodLabel(transaction)}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-600">Metode Pengambilan</p>
                <p className="text-base text-gray-900">
                  {getPickupMethodLabel(transaction.pickup_method)}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-600">Promo</p>
                <p className="text-base text-gray-900">
                  {transaction.voucher_discount > 0
                    ? (transaction.voucher_label || 'Diskon Voucher')
                    : 'Tidak ada promo'}
                </p>
              </div>
              
              {/* Payment Method Specific Info */}
              {getPaymentMethodCode(transaction) === 'debit' && (
                <>
                  <div>
                    <p className="text-sm font-medium text-gray-600">Bank</p>
                    <p className="text-base text-gray-900">
                      {transaction.bank_name || 'Tidak ada informasi bank'}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-600">Nomor Kartu</p>
                    <p className="text-base text-gray-900 font-mono">
                      {transaction.card_number ? 
                        `**** **** **** ${transaction.card_number.slice(-4)}` : 
                        'Tidak ada'
                      }
                    </p>
                  </div>
                </>
              )}
              
              {getPaymentMethodCode(transaction) === 'cl' && (
                <div className="md:col-span-2">
                  <p className="text-sm font-medium text-gray-600">Akun City Ledger</p>
                  <p className="text-base text-gray-900">
                    {transaction.cl_account_name || transaction.customer_name || 'Tidak ada informasi akun'}
                  </p>
                </div>
              )}
              
              {getPaymentMethodCode(transaction) !== 'cl' && (
                <>
                  <div>
                    <p className="text-sm font-medium text-gray-600">Jumlah Diterima</p>
                    <p className="text-base text-gray-900">
                      {formatPrice(transaction.amount_received)}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-600">Kembalian</p>
                    <p className="text-base text-gray-900">
                      {formatPrice(transaction.change_amount)}
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Refund Information */}
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 flex items-center">
                  <span className="w-6 h-6 bg-yellow-100 text-yellow-600 rounded-full flex items-center justify-center text-sm font-bold mr-2">
                    💸
                  </span>
                  Informasi Refund
                </h3>
                <p className="text-sm text-gray-500 mt-1">
                  Status:{' '}
                  <span className="font-semibold text-gray-800">
                    {transaction.refund_status || 'Belum ada'}
                  </span>
                </p>
              </div>
              {canRefund && (
                <button
                  onClick={() => setIsRefundModalOpen(true)}
                  disabled={outstandingAmount <= 0}
                  className="inline-flex items-center px-3 py-2 rounded-lg text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:text-gray-600"
                >
                  Buat Refund
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <div className="bg-blue-50 rounded-lg p-3 text-center">
                <p className="text-xs font-medium text-blue-600 uppercase">Sudah direfund</p>
                <p className="text-lg font-bold text-blue-800">{formatPrice(totalRefunded)}</p>
              </div>
              <div className="bg-green-50 rounded-lg p-3 text-center">
                <p className="text-xs font-medium text-green-600 uppercase">Sisa bisa refund</p>
                <p className="text-lg font-bold text-green-800">{formatPrice(outstandingAmount)}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3 text-center">
                <p className="text-xs font-medium text-gray-600 uppercase">Status</p>
                <p className="text-lg font-bold text-gray-800">
                  {transaction.refund_status ? transaction.refund_status.toUpperCase() : 'NONE'}
                </p>
              </div>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-2">Riwayat Refund</h4>
              {transaction.refunds && transaction.refunds.length > 0 ? (
                <div className="space-y-3">
                  {transaction.refunds.map((refund) => (
                    <div
                      key={refund.uuid_id || refund.id || `${refund.refunded_at}-${refund.refund_amount}`}
                      className="p-3 rounded-lg border border-gray-200 bg-gray-50"
                    >
                      <div className="flex items-center justify-between">
                        <p className="text-base font-semibold text-gray-900">
                          {formatPrice(refund.refund_amount)}
                        </p>
                        <span
                          className={`text-xs font-semibold ${
                            refund.status === 'pending'
                              ? 'text-yellow-700 bg-yellow-100'
                              : 'text-green-700 bg-green-100'
                          } px-2 py-0.5 rounded-full`}
                        >
                          {refund.status ?? 'completed'}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">{formatDate(refund.refunded_at)}</p>
                      {refund.reason && (
                        <p className="text-sm text-gray-700 mt-1">
                          Alasan: {refund.reason}
                        </p>
                      )}
                      {refund.note && (
                        <p className="text-xs text-gray-500 mt-1">
                          Catatan: {refund.note}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-500">Belum ada riwayat refund.</p>
              )}
            </div>
          </div>

          {/* Transaction Items */}
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center">
              <span className="w-6 h-6 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center text-sm font-bold mr-2">
                🛒
              </span>
              Item Transaksi ({transaction.items.length} item)
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-2 px-3 font-medium text-gray-600">Produk</th>
                    <th className="text-center py-2 px-3 font-medium text-gray-600">Qty</th>
                    <th className="text-right py-2 px-3 font-medium text-gray-600">Harga Satuan</th>
                    <th className="text-right py-2 px-3 font-medium text-gray-600">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {transaction.items.map((item, index) => (
                    <tr key={item.id} className={`border-b border-gray-100 ${index % 2 === 0 ? 'bg-gray-50' : 'bg-white'}`}>
                      <td className="py-3 px-3">
                        <div>
                          <p className="font-medium text-gray-900">{item.product_name}</p>
                          
                          {/* Customizations Display */}
                          {item.customizations && item.customizations.length > 0 && (() => {
                              const customizations = item.customizations;
                              if (!customizations || customizations.length === 0) return null;
                              
                              // Calculate total customization adjustments
                              const totalAdjustments = customizations.reduce((total, customization) => {
                                return total + customization.selected_options.reduce((optTotal, option) => {
                                  return optTotal + (option.price_adjustment || 0);
                                }, 0);
                              }, 0);
                              
                              // Calculate base price (unit price minus customization adjustments)
                              const basePrice = item.unit_price - totalAdjustments;
                              
                              return (
                                <div className="mt-2 space-y-2">
                                  {/* Base Price */}
                                  <div className="border-b border-gray-200 pb-1">
                                    <div className="flex items-center justify-between text-xs">
                                      <span className="text-gray-500 font-medium">Base Price:</span>
                                      <span className="text-gray-700 font-medium">{formatPrice(basePrice)}</span>
                                    </div>
                                  </div>
                                  
                                  {/* Customizations */}
                                  <div className="space-y-2">
                                    {customizations.map((customization, idx) => (
                                      <div key={idx} className="text-xs">
                                        <div className="border-b border-gray-100 pb-1 mb-1">
                                          <span className="text-gray-500 font-medium">{customization.customization_name}:</span>
                                        </div>
                                        <div className="ml-2 space-y-0.5">
                                          {customization.selected_options.map((option, optIdx) => (
                                            <div key={optIdx} className="flex items-center justify-between">
                                              <span className="text-gray-600">• {option.option_name}</span>
                                              {option.price_adjustment !== 0 && (
                                                <span className={`text-xs font-medium ${
                                                  option.price_adjustment > 0 ? 'text-green-600' : 'text-red-600'
                                                }`}>
                                                  {option.price_adjustment > 0 ? '+' : ''}{formatPrice(Math.abs(option.price_adjustment))}
                                                </span>
                                              )}
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                  
                                  {/* Total Line */}
                                  <div className="border-t border-gray-200 pt-1">
                                    <div className="flex items-center justify-between text-xs font-medium">
                                      <span className="text-gray-700">Total:</span>
                                      <span className="text-gray-900">{formatPrice(item.unit_price)}</span>
                                    </div>
                                  </div>
                                </div>
                              );
                          })()}
                          
                          {/* Custom Note Display */}
                          {item.custom_note && (
                            <div className="mt-1">
                              <p className="text-xs text-gray-500">
                                <span className="text-gray-400">Note:</span>
                                <span className="text-gray-700 ml-1 italic">&quot;{item.custom_note}&quot;</span>
                              </p>
                            </div>
                          )}
                          
                          {/* Bundle Selections Display */}
                          {item.bundleSelections && item.bundleSelections.length > 0 && (() => {
                              const bundleSelections = item.bundleSelections as Array<{
                                category2_name: string;
                                selectedProducts: Array<{
                                  product: { nama: string };
                                  quantity?: number;
                                  customizations?: Array<{
                                    customization_name?: string;
                                    selected_options?: Array<{
                                      option_name?: string;
                                      price_adjustment?: number;
                                    }>;
                                  }>;
                                  customNote?: string;
                                }>;
                                requiredQuantity: number;
                              }>;
                              if (!bundleSelections || bundleSelections.length === 0) return null;
                              
                              return (
                                <div className="mt-2 space-y-2">
                                  <div className="text-xs font-semibold text-purple-700">Bundle Items:</div>
                                  {bundleSelections.map((bundleSel, idx) => {
                                    // Support both old format (array of products) and new format (array of {product, quantity})
                                    const selectedProducts = bundleSel.selectedProducts || [];
                                    const isNewFormat = selectedProducts.length > 0 && selectedProducts[0]?.product;
                                    const totalQuantity = isNewFormat 
                                      ? selectedProducts.reduce((sum, sp) => sum + (sp.quantity ?? 1), 0)
                                      : selectedProducts.length;
                                    
                                    return (
                                      <div key={idx} className="ml-2 border-l-2 border-purple-300 pl-2">
                                        <div className="text-xs font-medium text-purple-600">
                                          {bundleSel.category2_name} ({totalQuantity}/{bundleSel.requiredQuantity}):
                                        </div>
                                        <div className="ml-2 mt-1 space-y-0.5">
                                          {isNewFormat 
                                            ? selectedProducts.map((sp, spIdx) => (
                                                <div key={spIdx} className="text-xs text-gray-600 space-y-1">
                                                  <div>• {sp.product?.nama || ''}</div>
                                                  {sp.customizations && Array.isArray(sp.customizations) && sp.customizations.length > 0 && (
                                                    <div className="ml-4 text-[11px] text-gray-500">
                                                      {sp.customizations.map((customization) => (
                                                        <div key={customization.customization_name || String(Math.random())} className="mt-0.5">
                                                          <div className="font-medium text-gray-600">
                                                            {customization.customization_name}
                                                          </div>
                                                          <div className="ml-2 space-y-0.5">
                                                            {(customization.selected_options || []).map((opt, optIdx) => (
                                                              <div key={opt.option_name || String(optIdx)} className="flex items-center justify-between">
                                                                <span>• {opt.option_name}</span>
                                                                {opt.price_adjustment ? (
                                                                  <span className={`text-[10px] ${opt.price_adjustment > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                                    {opt.price_adjustment > 0 ? '+' : ''}{formatPrice(opt.price_adjustment)}
                                                                  </span>
                                                                ) : null}
                                                              </div>
                                                            ))}
                                                          </div>
                                                        </div>
                                                      ))}
                                                    </div>
                                                  )}
                                                  {sp.customNote && (
                                                    <div className="ml-4 text-[11px] text-purple-600 italic">
                                                      Note: {sp.customNote}
                                                    </div>
                                                  )}
                                                </div>
                                              ))
                                            : selectedProducts.map((p, pIdx) => (
                                                <div key={pIdx} className="text-xs text-gray-600">
                                                  • {(p as { nama?: string })?.nama || ''}
                                                </div>
                                              ))
                                          }
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              );
                          })()}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-center">
                        <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded-full text-sm font-medium">
                          {item.quantity}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right font-medium text-gray-900">
                        {formatPrice(item.unit_price)}
                      </td>
                      <td className="py-3 px-3 text-right font-bold text-gray-900">
                        {formatPrice(item.total_price)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-300 bg-gray-100">
                    <td colSpan={3} className="py-3 px-3 text-right font-bold text-gray-900">
                      Total:
                    </td>
                    <td className="py-3 px-3 text-right font-bold text-lg text-gray-900">
                      {formatPrice(transaction.total_amount)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Staff Information */}
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center">
              <span className="w-6 h-6 bg-orange-100 text-orange-600 rounded-full flex items-center justify-center text-sm font-bold mr-2">
                👨‍💼
              </span>
              Informasi Staff
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="text-sm font-medium text-gray-600">Kasir</p>
                <p className="text-base text-gray-900">
                  {transaction.user_name || 'Tidak ada nama kasir'}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-600">Outlet</p>
                <p className="text-base text-gray-900">
                  {transaction.business_name || 'Tidak ada nama outlet'}
                </p>
              </div>
            </div>
          </div>
        </div>
        ) : null}

        {canRefund && transaction && (
          <RefundModal
            isOpen={isRefundModalOpen}
            onClose={() => setIsRefundModalOpen(false)}
            transaction={transaction}
            onSuccess={(updated) => {
              onTransactionUpdated?.(updated);
              setIsRefundModalOpen(false);
            }}
          />
        )}

        {/* Footer */}
        <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 rounded-b-xl">
          <div className="flex justify-between items-center">
            {/* Reprint Button */}
            <div className="flex items-center space-x-3">
              <button
                onClick={handleReprint}
                disabled={isReprinting || !transaction}
                className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center space-x-2 ${
                  isReprinting 
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    : reprintStatus === 'success'
                      ? 'bg-green-100 text-green-800 border border-green-300'
                      : reprintStatus === 'error'
                        ? 'bg-red-100 text-red-800 border border-red-300'
                        : 'bg-blue-500 text-white hover:bg-blue-600'
                }`}
              >
                {isReprinting ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-500"></div>
                    <span>Mencetak...</span>
                  </>
                ) : reprintStatus === 'success' ? (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span>Berhasil Dicetak</span>
                  </>
                ) : reprintStatus === 'error' ? (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    <span>Gagal Cetak</span>
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                    </svg>
                    <span>Cetak Ulang</span>
                  </>
                )}
              </button>
              
              {reprintStatus === 'error' && (
                <span className="text-xs text-red-600">
                  Gagal mencetak ulang. Coba lagi.
                </span>
              )}
            </div>

            {/* Close Button */}
            <button
              onClick={onClose}
              className="px-6 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
            >
              Tutup
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TransactionDetailModal;



