'use client';

import { useState, useEffect, useCallback } from 'react';
import { 
  Calendar, 
  User, 
  ChevronRight, 
  ChevronDown,
  ArrowLeft, 
  Printer,
  Wallet,
  Package,
  CreditCard,
  Filter
} from 'lucide-react';

// Types
interface Shift {
  id: number;
  uuid_id: string;
  business_id: number;
  user_id: number;
  user_name: string;
  shift_start: string;
  shift_end: string | null;
  modal_awal: number;
  status: string;
  created_at: string;
  kas_akhir?: number | null;
  kas_expected?: number | null;
  kas_selisih?: number | null;
  kas_selisih_label?: 'balanced' | 'plus' | 'minus' | null;
  cash_sales_total?: number | null;
  cash_refund_total?: number | null;
}

interface ShiftStatistics {
  order_count: number;
  total_amount: number;
  total_discount: number;
  voucher_count: number;
}

interface PaymentBreakdown {
  payment_method_name: string;
  payment_method_code: string;
  transaction_count: number;
  total_amount: number;
}

interface CashSummary {
  cash_shift: number;
  cash_whole_day: number;
  cash_shift_sales?: number;
  cash_shift_refunds?: number;
  cash_whole_day_sales?: number;
  cash_whole_day_refunds?: number;
}

interface ProductSale {
  product_id: number;
  product_name: string;
  product_code: string;
  platform: string;
  transaction_type: string;
  total_quantity: number;
  total_subtotal: number;
  customization_subtotal: number;
  base_subtotal: number;
  base_unit_price: number;
  is_bundle_item?: boolean;
}

interface CustomizationSale {
  option_id: number;
  option_name: string;
  customization_id: number;
  customization_name: string;
  total_quantity: number;
  total_revenue: number;
}

interface UserOption {
  user_id: number;
  user_name: string;
}

// Helper functions
const formatRupiah = (amount: number): string => {
  if (isNaN(amount) || amount === null || amount === undefined) {
    return 'Rp 0';
  }
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

const formatDateTime = (dateString: string): string => {
  return new Date(dateString).toLocaleString('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const PLATFORM_LABELS: Record<string, string> = {
  offline: 'Offline',
  gofood: 'GoFood',
  grabfood: 'GrabFood',
  shopeefood: 'ShopeeFood',
  qpon: 'Qpon',
  tiktok: 'TikTok',
};

const formatPlatformLabel = (platform: string): string => {
  const key = (platform || 'offline').toLowerCase();
  if (PLATFORM_LABELS[key]) return PLATFORM_LABELS[key];
  if (!key) return 'Offline';
  return key.charAt(0).toUpperCase() + key.slice(1);
};

const getElectronAPI = () => (typeof window !== 'undefined' ? window.electronAPI : undefined);

export default function ShiftReport() {
  // Get business ID from logged-in user (fallback to 14 for backward compatibility)
  // TODO: Get from auth context when available
  const businessId = 14; // For now, keep hardcoded as this component needs refactoring
  
  const [viewMode, setViewMode] = useState<'list' | 'detail'>('list');
  const [selectedShift, setSelectedShift] = useState<Shift | null>(null);
  
  // Filters
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>('all');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  
  // Stats state for detail view
  const [statistics, setStatistics] = useState<ShiftStatistics | null>(null);
  const [paymentBreakdown, setPaymentBreakdown] = useState<PaymentBreakdown[]>([]);
  const [cashSummary, setCashSummary] = useState<CashSummary | null>(null);
  const [productSales, setProductSales] = useState<ProductSale[]>([]);
  const [customizationSales, setCustomizationSales] = useState<CustomizationSale[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Load users on mount
  useEffect(() => {
    const loadUsers = async () => {
      const electronAPI = getElectronAPI();
      if (electronAPI?.localDbGetShiftUsers) {
        const usersData = await electronAPI.localDbGetShiftUsers();
        setUsers(usersData as UserOption[]);
      }
    };
    loadUsers();
    
    // Set default date range (Last 7 days)
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 7);
    
    setEndDate(end.toISOString().split('T')[0]); // YYYY-MM-DD
    setStartDate(start.toISOString().split('T')[0]); // YYYY-MM-DD
  }, []);

  // Fetch shifts when filters change
  const fetchShifts = useCallback(async () => {
    setIsLoading(true);
    try {
      const electronAPI = getElectronAPI();
      if (electronAPI?.localDbGetShifts) {
        const filters: { userId?: number; startDate?: string; endDate?: string } = {};
        if (selectedUserId !== 'all') filters.userId = parseInt(selectedUserId);
        if (startDate) filters.startDate = `${startDate}T00:00:00`;
        if (endDate) filters.endDate = `${endDate}T23:59:59`;
        
        const result = await electronAPI.localDbGetShifts(filters);
        // Handle both old return (array) and new return (object)
        if (Array.isArray(result)) {
            setShifts(result as Shift[]);
        } else if (result && typeof result === 'object' && 'shifts' in result) {
            setShifts(result.shifts as Shift[]);
        } else {
            setShifts([]);
        }
      }
    } catch (error) {
      console.error('Error fetching shifts:', error);
    } finally {
      setIsLoading(false);
    }
  }, [selectedUserId, startDate, endDate]);

  useEffect(() => {
    if (startDate && endDate) {
      fetchShifts();
    }
  }, [fetchShifts, startDate, endDate, selectedUserId]);

  // Fetch details for a shift
  const loadShiftDetails = async (shift: Shift) => {
    setIsLoading(true);
    try {
      const electronAPI = getElectronAPI();
      if (!electronAPI) return;

      const shiftOwnerId = shift.user_id;
      const shiftStart = shift.shift_start;
      const shiftEnd = shift.shift_end || new Date().toISOString(); // Use current time if active

      const [statsResult, breakdownResult, cashResult, productSalesResult] = await Promise.allSettled([
        electronAPI.localDbGetShiftStatistics?.(shiftOwnerId, shiftStart, shiftEnd, businessId),
        electronAPI.localDbGetPaymentBreakdown?.(shiftOwnerId, shiftStart, shiftEnd, businessId),
        electronAPI.localDbGetCashSummary?.(shiftOwnerId, shiftStart, shiftEnd, businessId),
        electronAPI.localDbGetProductSales?.(shiftOwnerId, shiftStart, shiftEnd, businessId)
      ]);

      if (statsResult.status === 'fulfilled' && statsResult.value) setStatistics(statsResult.value);
      if (breakdownResult.status === 'fulfilled' && breakdownResult.value) setPaymentBreakdown(breakdownResult.value);
      if (cashResult.status === 'fulfilled' && cashResult.value) setCashSummary(cashResult.value);
      if (productSalesResult.status === 'fulfilled' && productSalesResult.value) {
        setProductSales(productSalesResult.value.products || []);
        setCustomizationSales(productSalesResult.value.customizations || []);
      }
      
      setSelectedShift(shift);
      setViewMode('detail');
    } catch (error) {
      console.error('Error loading shift details:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePrintReport = async () => {
    if (!selectedShift || !statistics || !cashSummary) return;
    
    const electronAPI = getElectronAPI();
    if (electronAPI?.printShiftBreakdown) {
      try {
        const cashSalesTotal = selectedShift.cash_sales_total ?? cashSummary.cash_shift_sales ?? cashSummary.cash_shift ?? 0;
        const cashRefundTotal = selectedShift.cash_refund_total ?? cashSummary.cash_shift_refunds ?? 0;
        const kasMulai = selectedShift.modal_awal ?? 0;
        const kasExpected = selectedShift.kas_expected ?? (kasMulai + cashSalesTotal - cashRefundTotal);
        const kasAkhirValue = typeof selectedShift.kas_akhir === 'number' ? selectedShift.kas_akhir : null;
        let varianceValue =
          typeof selectedShift.kas_selisih === 'number'
            ? selectedShift.kas_selisih
            : kasAkhirValue !== null
              ? Number((kasAkhirValue - kasExpected).toFixed(2))
              : null;
        let varianceLabelValue: 'balanced' | 'plus' | 'minus' | null =
          selectedShift.kas_selisih_label ?? null;
        if (varianceValue !== null) {
          if (Math.abs(varianceValue) < 0.01) {
            varianceValue = 0;
            varianceLabelValue = 'balanced';
          } else if (!varianceLabelValue) {
            varianceLabelValue = varianceValue > 0 ? 'plus' : 'minus';
          }
        }
        const totalCashInCashier = kasExpected;
        const cashWholeDaySales = cashSummary.cash_whole_day_sales ?? cashSummary.cash_whole_day ?? 0;
        const cashWholeDayRefunds = cashSummary.cash_whole_day_refunds ?? 0;
        await electronAPI.printShiftBreakdown({
          user_name: selectedShift.user_name,
          shift_start: selectedShift.shift_start,
          shift_end: selectedShift.shift_end,
          modal_awal: selectedShift.modal_awal,
          statistics,
          productSales: productSales.map(p => ({
            ...p,
            platform: p.platform || 'offline',
            transaction_type: p.transaction_type || 'drinks'
          })),
          customizationSales: customizationSales,
          paymentBreakdown,
          category2Breakdown: [],
          cashSummary: {
            cash_shift: cashSummary.cash_shift,
            cash_shift_sales: cashSalesTotal,
            cash_shift_refunds: cashRefundTotal,
            cash_whole_day: cashSummary.cash_whole_day,
            cash_whole_day_sales: cashWholeDaySales,
            cash_whole_day_refunds: cashWholeDayRefunds,
            total_cash_in_cashier: totalCashInCashier,
            kas_mulai: kasMulai,
            kas_expected: kasExpected,
            kas_akhir: kasAkhirValue,
            kas_selisih: varianceValue,
            kas_selisih_label: varianceLabelValue
          },
          business_id: businessId,
          printerType: 'receiptPrinter'
        });
      } catch (error) {
        console.error('Print error:', error);
        alert('Gagal mencetak laporan');
      }
    }
  };

  if (viewMode === 'detail' && selectedShift && statistics && cashSummary) {
    const kasMulai = selectedShift.modal_awal ?? 0;
    const cashShiftSales = cashSummary.cash_shift_sales ?? cashSummary.cash_shift ?? 0;
    const fallbackRefunds =
      typeof selectedShift.cash_refund_total === 'number' ? selectedShift.cash_refund_total : 0;
    const cashShiftRefunds = cashSummary.cash_shift_refunds ?? fallbackRefunds ?? 0;
    const kasExpected =
      typeof selectedShift.kas_expected === 'number'
        ? selectedShift.kas_expected
        : kasMulai + cashShiftSales - cashShiftRefunds;
    const kasAkhir =
      typeof selectedShift.kas_akhir === 'number' ? selectedShift.kas_akhir : null;
    let kasSelisih =
      typeof selectedShift.kas_selisih === 'number'
        ? selectedShift.kas_selisih
        : kasAkhir !== null
          ? Number((kasAkhir - kasExpected).toFixed(2))
          : null;
    let kasSelisihLabel: 'balanced' | 'plus' | 'minus' | null =
      selectedShift.kas_selisih_label ?? null;
    if (kasSelisih !== null) {
      if (Math.abs(kasSelisih) < 0.01) {
        kasSelisih = 0;
        kasSelisihLabel = 'balanced';
      } else if (!kasSelisihLabel) {
        kasSelisihLabel = kasSelisih > 0 ? 'plus' : 'minus';
      }
    }
    const totalCashInCashier = kasExpected;

    return (
      <div className="flex-1 flex flex-col bg-gray-50 overflow-hidden">
        {/* Detail Header */}
        <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between shadow-sm">
          <div className="flex items-center space-x-4">
            <button 
              onClick={() => setViewMode('list')}
              className="p-2 hover:bg-gray-100 rounded-full transition-colors"
            >
              <ArrowLeft className="w-6 h-6 text-gray-900" />
            </button>
            <div>
              <h2 className="text-xl font-bold text-gray-900">Detail Shift</h2>
              <p className="text-sm text-gray-900">
                {selectedShift.user_name} • {formatDateTime(selectedShift.shift_start)}
              </p>
            </div>
          </div>
          <button
            onClick={handlePrintReport}
            className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Printer className="w-4 h-4" />
            <span>Print Report</span>
          </button>
        </div>

        {/* Detail Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Shift Info Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Shift Info */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
              <div className="text-sm font-medium text-gray-900 mb-1">Shift Info</div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-gray-900">Status</span>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                  selectedShift.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                }`}>
                  {selectedShift.status === 'active' ? 'Active' : 'Closed'}
                </span>
              </div>
              <div className="text-sm">
                <div className="flex justify-between mb-1">
                  <span className="text-gray-900">Start:</span>
                  <span className="font-medium text-gray-900">{formatDateTime(selectedShift.shift_start)}</span>
                </div>
                {selectedShift.shift_end && (
                  <div className="flex justify-between">
                    <span className="text-gray-900">End:</span>
                    <span className="font-medium text-gray-900">{formatDateTime(selectedShift.shift_end)}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Modal Awal */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
              <div className="flex items-center space-x-2 mb-2">
                <Wallet className="w-4 h-4 text-blue-600" />
                <span className="text-sm font-medium text-gray-900">Modal Awal</span>
              </div>
              <div className="text-2xl font-bold text-gray-900">{formatRupiah(kasMulai)}</div>
            </div>

            {/* Shift Summary */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
              <div className="flex items-center space-x-2 mb-3">
                <Package className="w-4 h-4 text-purple-600" />
                <span className="text-sm font-medium text-gray-900">Summary</span>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-900">Pesanan</span>
                  <span className="font-semibold text-gray-900">{statistics.order_count}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-900">Total</span>
                  <span className="font-semibold text-green-600">{formatRupiah(statistics.total_amount)}</span>
                </div>
              </div>
            </div>

            {/* Cash Summary */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
              <div className="flex items-center space-x-2 mb-3">
                <CreditCard className="w-4 h-4 text-green-600" />
                <span className="text-sm font-medium text-gray-900">Cash Summary</span>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-900">Cash Masuk (Shift)</span>
                  <span className="font-semibold text-gray-900">{formatRupiah(cashShiftSales)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-900">Cash Refund</span>
                  <span className="font-semibold text-gray-900">
                    {formatRupiah(cashShiftRefunds)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-900">Kas Diharapkan</span>
                  <span className="font-semibold text-purple-700">{formatRupiah(kasExpected)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-900">Kas Akhir</span>
                  <span className="font-semibold text-gray-900">
                    {kasAkhir !== null ? formatRupiah(kasAkhir) : '-'}
                  </span>
                </div>
                <div className="flex justify-between items-center border-t pt-2">
                  <span className="text-gray-900 font-medium">Selisih</span>
                  <span
                    className={`text-sm font-semibold ${
                      kasSelisihLabel === 'plus'
                        ? 'text-green-600'
                        : kasSelisihLabel === 'minus'
                          ? 'text-red-600'
                          : 'text-gray-900'
                    }`}
                  >
                    {kasSelisih !== null ? formatRupiah(kasSelisih) : '-'}
                  </span>
                </div>
                <div className="border-t pt-1 flex justify-between">
                  <span className="text-gray-900 font-medium">Total Cashier</span>
                  <span className="font-bold text-blue-600">{formatRupiah(totalCashInCashier)}</span>
                </div>
              </div>
            </div>
          </div>
          {/* Cash Reconciliation Banner */}
          <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3 shadow-sm">
            <div>
              <p className="text-sm text-gray-600">Status Kasir</p>
              <p className="text-lg font-semibold text-gray-900">
                {kasSelisihLabel === 'plus'
                  ? 'Plus (kembali ke owner)'
                  : kasSelisihLabel === 'minus'
                    ? 'Minus (ambil dari modal)'
                    : 'Balanced'}
              </p>
            </div>
            <div className="flex flex-wrap gap-4 text-sm">
              <div>
                <p className="text-gray-500">Kas Mulai</p>
                <p className="font-semibold text-gray-900">{formatRupiah(kasMulai)}</p>
              </div>
              <div>
                <p className="text-gray-500">Cash Masuk</p>
                <p className="font-semibold text-gray-900">{formatRupiah(cashShiftSales)}</p>
              </div>
              <div>
                <p className="text-gray-500">Cash Refund</p>
                <p className="font-semibold text-gray-900">{formatRupiah(cashShiftRefunds)}</p>
              </div>
              <div>
                <p className="text-gray-500">Kas Diharapkan</p>
                <p className="font-semibold text-purple-700">{formatRupiah(kasExpected)}</p>
              </div>
              <div>
                <p className="text-gray-500">Kas Akhir</p>
                <p className="font-semibold text-gray-900">
                  {kasAkhir !== null ? formatRupiah(kasAkhir) : '-'}
                </p>
              </div>
              <div>
                <p className="text-gray-500">Selisih</p>
                <p
                  className={`font-semibold ${
                    kasSelisihLabel === 'plus'
                      ? 'text-green-600'
                      : kasSelisihLabel === 'minus'
                        ? 'text-red-600'
                        : 'text-gray-900'
                  }`}
                >
                  {kasSelisih !== null ? formatRupiah(kasSelisih) : '-'}
                </p>
              </div>
            </div>
          </div>

          {/* Product Sales Table */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Product Sales Breakdown</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-gray-50 text-gray-900 font-medium border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-3">Product</th>
                    <th className="px-6 py-3 text-right">Quantity</th>
                    <th className="px-6 py-3 text-right">Subtotal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {productSales.length > 0 ? (
                    productSales.map((product, idx) => (
                      <tr key={`${product.product_id}-${idx}`} className="hover:bg-gray-50">
                        <td className="px-6 py-3">
                          <div className="font-medium text-gray-900">{product.product_name}</div>
                          <div className="text-xs text-gray-900">
                            {product.transaction_type} • {formatPlatformLabel(product.platform)}
                            {product.is_bundle_item && <span className="ml-1 text-purple-600">[Bundle]</span>}
                          </div>
                        </td>
                        <td className="px-6 py-3 text-right font-medium text-gray-900">{product.total_quantity}</td>
                        <td className="px-6 py-3 text-right font-medium text-gray-900">{formatRupiah(product.base_subtotal)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={3} className="px-6 py-8 text-center text-gray-900">No products sold</td>
                    </tr>
                  )}
                </tbody>
                {productSales.length > 0 && (
                  <tfoot className="bg-gray-50 font-semibold text-gray-900">
                    <tr>
                      <td className="px-6 py-3">Total</td>
                      <td className="px-6 py-3 text-right">{productSales.reduce((sum, p) => sum + p.total_quantity, 0)}</td>
                      <td className="px-6 py-3 text-right">{formatRupiah(productSales.reduce((sum, p) => sum + p.base_subtotal, 0))}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          {/* Payment Methods & Customizations Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Payment Methods */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900">Payment Methods</h3>
              </div>
              <table className="w-full text-sm text-left">
                <thead className="bg-gray-50 text-gray-900 font-medium border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-3">Method</th>
                    <th className="px-6 py-3 text-right">Transactions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {paymentBreakdown.map((item, idx) => (
                    <tr key={idx} className="hover:bg-gray-50">
                      <td className="px-6 py-3 font-medium text-gray-900">{item.payment_method_name || item.payment_method_code}</td>
                      <td className="px-6 py-3 text-right font-medium text-gray-900">{item.transaction_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Customizations */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900">Customizations</h3>
              </div>
              <table className="w-full text-sm text-left">
                <thead className="bg-gray-50 text-gray-900 font-medium border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-3">Option</th>
                    <th className="px-6 py-3 text-right">Qty</th>
                    <th className="px-6 py-3 text-right">Rev</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {customizationSales.length > 0 ? (
                    customizationSales.map((item, idx) => (
                      <tr key={idx} className="hover:bg-gray-50">
                        <td className="px-6 py-3">
                          <div className="font-medium text-gray-900">{item.option_name}</div>
                          <div className="text-xs text-gray-900">{item.customization_name}</div>
                        </td>
                        <td className="px-6 py-3 text-right font-medium text-gray-900">{item.total_quantity}</td>
                        <td className="px-6 py-3 text-right font-medium text-gray-900">{formatRupiah(item.total_revenue)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={3} className="px-6 py-8 text-center text-gray-900">No customizations</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // List View
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Filters */}
      <div className="bg-white border-b border-gray-200 p-4">
        <div className="flex flex-col md:flex-row gap-4 items-end md:items-center">
          <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-4 w-full">
            {/* Date Range */}
            <div>
              <label className="block text-xs font-medium text-gray-900 mb-1">Start Date</label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-600" />
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-900 mb-1">End Date</label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-600" />
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                />
              </div>
            </div>

            {/* User Selector */}
            <div>
              <label className="block text-xs font-medium text-gray-900 mb-1">User</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-600" />
                <select
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value)}
                  className="w-full pl-10 pr-8 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 appearance-none bg-white text-gray-900"
                >
                  <option value="all">All Users</option>
                  {users.map(user => (
                    <option key={user.user_id} value={user.user_id}>{user.user_name}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-600 pointer-events-none" />
              </div>
            </div>
          </div>

          {/* Refresh Button */}
          <button
            onClick={fetchShifts}
            disabled={isLoading}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-900 rounded-lg font-medium transition-colors text-sm disabled:opacity-50"
          >
            {isLoading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto p-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <table className="w-full text-sm text-left">
            <thead className="bg-gray-50 text-gray-900 font-semibold border-b border-gray-200">
              <tr>
                <th className="px-6 py-3">Date / Time</th>
                <th className="px-6 py-3">User</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3 text-right">Modal Awal</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {shifts.length > 0 ? (
                shifts.map((shift) => (
                  <tr 
                    key={shift.uuid_id} 
                    onClick={() => loadShiftDetails(shift)}
                    className="hover:bg-blue-50 cursor-pointer transition-colors group"
                  >
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-900">{formatDateTime(shift.shift_start)}</div>
                      <div className="text-xs text-gray-900 mt-0.5">
                        {shift.shift_end ? (
                          `Ended: ${formatDateTime(shift.shift_end)}`
                        ) : (
                          <span className="text-green-600 font-medium">Ongoing</span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-2">
                        <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-xs font-medium text-gray-900">
                          {shift.user_name.charAt(0).toUpperCase()}
                        </div>
                        <span className="font-medium text-gray-900">{shift.user_name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        shift.status === 'active' 
                          ? 'bg-green-100 text-green-800' 
                          : 'bg-gray-100 text-gray-800'
                      }`}>
                        {shift.status === 'active' ? 'Active' : 'Closed'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right font-medium text-gray-900">
                      {formatRupiah(shift.modal_awal)}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <ChevronRight className="w-5 h-5 text-gray-600 group-hover:text-blue-500 transition-colors" />
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center">
                    <div className="flex flex-col items-center justify-center text-gray-900">
                      <Filter className="w-8 h-8 mb-3 text-gray-400" />
                      <p className="font-medium">No shifts found</p>
                      <p className="text-sm mt-1">Try adjusting your filters</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
