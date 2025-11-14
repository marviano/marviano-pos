'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Clock, 
  Wallet, 
  Package, 
  DollarSign, 
  CreditCard, 
  RefreshCw, 
  StopCircle,
  AlertCircle,
  CheckCircle,
  Loader2,
  Printer,
  Ticket
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { generateUUID } from '@/lib/uuid';

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
}

interface CashSummary {
  cash_shift: number;
  cash_whole_day: number;
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

const BUSINESS_ID = 14;
const AUTO_REFRESH_INTERVAL = 30000; // 30 seconds

// Format Rupiah with Indonesian locale (dot separator)
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

// Format number for input (remove dots, allow only digits)
const formatNumberInput = (value: string): string => {
  return value.replace(/[^\d]/g, '');
};

// Format number display with dots (for input field)
const formatNumberDisplay = (value: string): string => {
  const numValue = formatNumberInput(value);
  if (!numValue) return '';
  try {
    const num = parseInt(numValue, 10);
    if (isNaN(num)) return '';
    return num.toLocaleString('id-ID');
  } catch {
    return numValue;
  }
};

// Format time for display (GMT+7)
const formatTime = (dateString: string): string => {
  const date = new Date(dateString);
  // Adjust for GMT+7
  const gmt7Date = new Date(date.getTime() + (7 * 60 * 60 * 1000));
  return gmt7Date.toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
};

// Format date for display
const formatDate = (dateString: string): string => {
  const date = new Date(dateString);
  const gmt7Date = new Date(date.getTime() + (7 * 60 * 60 * 1000));
  return gmt7Date.toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  });
};

export default function GantiShift() {
  const { user } = useAuth();
  const [activeShift, setActiveShift] = useState<Shift | null>(null);
  const [modalAwal, setModalAwal] = useState<string>('');
  const [isStartingShift, setIsStartingShift] = useState(false);
  const [isEndingShift, setIsEndingShift] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingInitial, setIsLoadingInitial] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showEndShiftConfirm, setShowEndShiftConfirm] = useState(false);
  const [showForceCloseConfirm, setShowForceCloseConfirm] = useState(false);
  const [isCurrentUsersShift, setIsCurrentUsersShift] = useState(false);
  const [endShiftMode, setEndShiftMode] = useState<'normal' | 'force'>('normal');
  const [todayTransactionsInfo, setTodayTransactionsInfo] = useState<{
    hasTransactions: boolean;
    count: number;
    earliestTime: string | null;
  } | null>(null);
  const [isMigrating, setIsMigrating] = useState(false);
  
  const [statistics, setStatistics] = useState<ShiftStatistics>({
    order_count: 0,
    total_amount: 0,
    total_discount: 0,
    voucher_count: 0
  });
  
  const [paymentBreakdown, setPaymentBreakdown] = useState<PaymentBreakdown[]>([]);
  const [cashSummary, setCashSummary] = useState<CashSummary>({
    cash_shift: 0,
    cash_whole_day: 0
  });
  const [productSales, setProductSales] = useState<ProductSale[]>([]);
  const [customizationSales, setCustomizationSales] = useState<CustomizationSale[]>([]);
  
  // Date-time picker states for custom date range printing
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [startDateTime, setStartDateTime] = useState<string>('');
  const [endDateTime, setEndDateTime] = useState<string>('');
  const [isPrintingCustomRange, setIsPrintingCustomRange] = useState(false);
  
  const modalInputRef = useRef<HTMLInputElement>(null);
  const autoRefreshIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const permissions = user?.permissions ?? [];
  const canForceCloseShift = permissions.includes('marviano-pos_gantishift.closeunattendedshift');
  const currentUserId = Number(user?.id ?? 0);
  const canManageActiveShift = Boolean(activeShift && (isCurrentUsersShift || canForceCloseShift));

  // Load active shift on mount
  useEffect(() => {
    const load = async () => {
      setIsLoadingInitial(true);
      try {
        await loadActiveShift();
      } finally {
        setIsLoadingInitial(false);
      }
    };
    if (currentUserId) {
      load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId]);

  // Auto-focus modal awal input when no active shift
  useEffect(() => {
    if (!activeShift && modalInputRef.current && !isLoadingInitial) {
      // Small delay to ensure DOM is ready
      setTimeout(() => {
        modalInputRef.current?.focus();
      }, 100);
    }
  }, [activeShift, isLoadingInitial]);

  // Check for transactions before shift start
  const checkTodayTransactions = useCallback(async () => {
    if (!activeShift || !window.electronAPI?.localDbCheckTodayTransactions) {
      return;
    }

    try {
      const shiftOwnerId = Number(activeShift.user_id ?? 0);
      if (!shiftOwnerId) {
        return;
      }

      const info = await window.electronAPI.localDbCheckTodayTransactions(
        shiftOwnerId,
        activeShift.shift_start,
        BUSINESS_ID
      );
      setTodayTransactionsInfo(info);
    } catch (error) {
      console.error('Error checking today transactions:', error);
    }
  }, [activeShift]);

  // Load statistics when shift changes
  useEffect(() => {
    if (activeShift) {
      loadStatistics();
      checkTodayTransactions();
    } else {
      // Reset stats when no active shift
      setStatistics({ order_count: 0, total_amount: 0, total_discount: 0, voucher_count: 0 });
      setPaymentBreakdown([]);
      setCashSummary({ cash_shift: 0, cash_whole_day: 0 });
      setProductSales([]);
      setCustomizationSales([]);
      setTodayTransactionsInfo(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeShift?.id, checkTodayTransactions]);

  // Auto-refresh statistics when shift is active
  useEffect(() => {
    if (activeShift) {
      // Clear any existing interval
      if (autoRefreshIntervalRef.current) {
        clearInterval(autoRefreshIntervalRef.current);
      }
      
      // Set up auto-refresh
      autoRefreshIntervalRef.current = setInterval(() => {
        loadStatistics();
      }, AUTO_REFRESH_INTERVAL);
    }
    
    // Cleanup on unmount or when shift/user changes
    return () => {
      if (autoRefreshIntervalRef.current) {
        clearInterval(autoRefreshIntervalRef.current);
        autoRefreshIntervalRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeShift?.id]);

  // Auto-dismiss success messages
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => {
        setSuccessMessage(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  const loadActiveShift = useCallback(async () => {
    if (!currentUserId) {
      return;
    }

    // Check if Electron API is available
    if (!window.electronAPI) {
      setError('Aplikasi Electron tidak terdeteksi. Silakan restart aplikasi.');
      setIsLoadingInitial(false);
      return;
    }

    if (!window.electronAPI.localDbGetActiveShift) {
      setError('Fitur shift belum tersedia. Silakan restart aplikasi untuk memperbarui.');
      setIsLoadingInitial(false);
      return;
    }

    try {
      const response = await window.electronAPI.localDbGetActiveShift(currentUserId, BUSINESS_ID);
      const shift = response?.shift ?? null;
      setActiveShift(shift);
      setIsCurrentUsersShift(Boolean(shift && response?.isCurrentUserShift));
      setModalAwal(shift && response?.isCurrentUserShift ? shift.modal_awal.toString() : '');
      setError(null);
    } catch (error: any) {
      console.error('Error loading active shift:', error);
      setError('Gagal memuat shift aktif. Silakan refresh halaman.');
    }
  }, [currentUserId]);

  const loadStatistics = useCallback(async () => {
    if (!activeShift || !window.electronAPI) {
      return;
    }

    try {
      setIsRefreshing(true);
      const shiftOwnerId = Number(activeShift.user_id ?? 0);
      if (!shiftOwnerId) {
        setIsRefreshing(false);
        return;
      }
      
      // Load all statistics in parallel with error handling
      const [statsResult, breakdownResult, cashResult, productSalesResult] = await Promise.allSettled([
        window.electronAPI.localDbGetShiftStatistics?.(
          shiftOwnerId,
          activeShift.shift_start,
          activeShift.shift_end,
          BUSINESS_ID
        ) || Promise.resolve({ order_count: 0, total_amount: 0, total_discount: 0, voucher_count: 0 }),
        window.electronAPI.localDbGetPaymentBreakdown?.(
          shiftOwnerId,
          activeShift.shift_start,
          activeShift.shift_end,
          BUSINESS_ID
        ) || Promise.resolve([]),
        window.electronAPI.localDbGetCashSummary?.(
          shiftOwnerId,
          activeShift.shift_start,
          activeShift.shift_end,
          BUSINESS_ID
        ) || Promise.resolve({ cash_shift: 0, cash_whole_day: 0 }),
        window.electronAPI.localDbGetProductSales?.(
          shiftOwnerId,
          activeShift.shift_start,
          activeShift.shift_end,
          BUSINESS_ID
        ) || Promise.resolve([])
      ]);

      // Handle results with fallbacks
      const stats = statsResult.status === 'fulfilled' 
        ? statsResult.value 
        : { order_count: 0, total_amount: 0, total_discount: 0, voucher_count: 0 };
      
      const breakdown = breakdownResult.status === 'fulfilled' 
        ? breakdownResult.value 
        : [];
      
      const cash = cashResult.status === 'fulfilled' 
        ? cashResult.value 
        : { cash_shift: 0, cash_whole_day: 0 };

      const productSalesData = productSalesResult.status === 'fulfilled'
        ? productSalesResult.value
        : { products: [], customizations: [] };

      setStatistics({
        order_count: stats.order_count ?? 0,
        total_amount: stats.total_amount ?? 0,
        total_discount: stats.total_discount ?? 0,
        voucher_count: stats.voucher_count ?? 0
      });
      setPaymentBreakdown(breakdown);
      setCashSummary(cash);
      setProductSales(productSalesData.products || []);
      setCustomizationSales(productSalesData.customizations || []);
      
      // Only show error if all requests failed
      if (statsResult.status === 'rejected' && breakdownResult.status === 'rejected' && cashResult.status === 'rejected') {
        setError('Gagal memuat statistik');
      }
    } catch (error: any) {
      console.error('Error loading statistics:', error);
      setError('Gagal memuat statistik');
    } finally {
      setIsRefreshing(false);
    }
  }, [activeShift]);

  const handleStartShift = async () => {
    if (!user?.id || !user?.name) {
      setError('User tidak ditemukan. Silakan login ulang.');
      return;
    }

    // Check if there's already an active shift (double-check)
    try {
      const existingResponse = await window.electronAPI?.localDbGetActiveShift?.(currentUserId, BUSINESS_ID);
      const existingShift = existingResponse?.shift ?? null;
      if (existingShift) {
        const ownerName = existingShift.user_name || 'Kasir lain';
        if (existingResponse?.isCurrentUserShift) {
          setError('Anda sudah memiliki shift aktif. Silakan tutup shift yang aktif terlebih dahulu.');
        } else if (canForceCloseShift) {
          setError(`Shift atas nama ${ownerName} masih aktif. Force close shift tersebut sebelum memulai shift baru.`);
        } else {
          setError(`Shift atas nama ${ownerName} masih aktif. Minta kasir tersebut untuk mengakhiri shift sebelum memulai shift baru.`);
        }
        await loadActiveShift(); // Reload to show the active shift
        return;
      }
    } catch (error) {
      console.error('Error checking existing shift:', error);
    }

    const cleanValue = formatNumberInput(modalAwal);
    const amount = parseFloat(cleanValue);
    
    if (!cleanValue || isNaN(amount) || amount < 0) {
      setError('Modal awal harus berupa angka >= 0');
      return;
    }

    setIsStartingShift(true);
    setError(null);
    setSuccessMessage(null);

    // Check Electron API availability
    if (!window.electronAPI) {
      setError('Aplikasi Electron tidak terdeteksi. Silakan restart aplikasi.');
      setIsStartingShift(false);
      return;
    }

    if (!window.electronAPI.localDbCreateShift) {
      setError('Fitur shift belum tersedia. Silakan restart aplikasi untuk memperbarui.');
      setIsStartingShift(false);
      return;
    }

    try {

      const uuid_id = generateUUID();
      const result = await window.electronAPI.localDbCreateShift({
        uuid_id,
        business_id: BUSINESS_ID,
        user_id: currentUserId,
        user_name: user.name,
        modal_awal: amount
      });

      if (result.success) {
        setSuccessMessage('Shift berhasil dimulai!');
        await loadActiveShift();
        setModalAwal(''); // Clear input after successful start
      } else {
        if (result.error === 'ACTIVE_SHIFT_EXISTS' && result.activeShift) {
          const ownerName = result.activeShift.user_name || 'Kasir lain';
          const message = canForceCloseShift
            ? `Shift atas nama ${ownerName} masih aktif. Force close shift tersebut sebelum memulai shift baru.`
            : `Shift atas nama ${ownerName} masih aktif. Minta kasir tersebut untuk mengakhiri shift sebelum memulai shift baru.`;
          throw new Error(message);
        }
        throw new Error(result.error || 'Gagal membuat shift');
      }
    } catch (error: any) {
      console.error('Error starting shift:', error);
      setError(error.message || 'Gagal memulai shift. Silakan coba lagi.');
    } finally {
      setIsStartingShift(false);
    }
  };

  const handleEndShiftClick = () => {
    if (!activeShift) {
      return;
    }

    if (!isCurrentUsersShift) {
      setError(`Shift aktif saat ini dimiliki oleh ${activeShift.user_name || 'kasir lain'}. Anda tidak dapat mengakhirinya.`);
      return;
    }

    setEndShiftMode('normal');
    setShowEndShiftConfirm(true);
  };

  const handleForceCloseClick = () => {
    if (!activeShift) {
      return;
    }

    if (!canForceCloseShift) {
      setError('Anda tidak memiliki izin untuk force close shift.');
      return;
    }

    setEndShiftMode('force');
    setShowForceCloseConfirm(true);
  };

  const handleEndShiftConfirm = async () => {
    if (!activeShift) return;

    setIsEndingShift(true);
    setError(null);
    setSuccessMessage(null);
    setShowEndShiftConfirm(false);
    setShowForceCloseConfirm(false);

    // Check Electron API availability
    if (!window.electronAPI) {
      setError('Aplikasi Electron tidak terdeteksi. Silakan restart aplikasi.');
      setIsEndingShift(false);
      return;
    }

    if (!window.electronAPI.localDbEndShift) {
      setError('Fitur shift belum tersedia. Silakan restart aplikasi untuk memperbarui.');
      setIsEndingShift(false);
      return;
    }

    try {
      const isForce = endShiftMode === 'force';
      if (!isCurrentUsersShift && !isForce) {
        setIsEndingShift(false);
        setError(`Shift aktif dimiliki oleh ${activeShift.user_name || 'kasir lain'}. Anda tidak dapat mengakhirinya.`);
        return;
      }

      if (isForce && !canForceCloseShift) {
        setIsEndingShift(false);
        setError('Anda tidak memiliki izin untuk force close shift.');
        return;
      }

      const result = await window.electronAPI.localDbEndShift(activeShift.id);

      if (result.success) {
        const successText = isForce
          ? `Shift atas nama ${activeShift.user_name || 'kasir lain'} berhasil di-force close.`
          : 'Shift berhasil diakhiri!';
        setSuccessMessage(successText);
        setActiveShift(null);
        setModalAwal('');
        // Reset statistics
        setStatistics({ order_count: 0, total_amount: 0, total_discount: 0, voucher_count: 0 });
        setPaymentBreakdown([]);
        setCashSummary({ cash_shift: 0, cash_whole_day: 0 });
        await loadActiveShift();
      } else {
        throw new Error(result.error || 'Gagal mengakhiri shift');
      }
    } catch (error: any) {
      console.error('Error ending shift:', error);
      setError(error.message || 'Gagal mengakhiri shift. Silakan coba lagi.');
    } finally {
      setIsEndingShift(false);
      setEndShiftMode('normal');
    }
  };

  const handleRefresh = () => {
    if (activeShift) {
      loadStatistics();
      checkTodayTransactions();
    } else {
      loadActiveShift();
    }
  };

  const handlePrintAll = async () => {
    if (!activeShift || !window.electronAPI?.printShiftBreakdown) {
      setError('Fitur print belum tersedia. Silakan restart aplikasi.');
      return;
    }

    try {
      const result = await window.electronAPI.printShiftBreakdown({
        user_name: activeShift.user_name,
        shift_start: activeShift.shift_start,
        shift_end: activeShift.shift_end,
        modal_awal: activeShift.modal_awal,
        statistics: {
          order_count: statistics.order_count,
          total_amount: statistics.total_amount,
          total_discount: statistics.total_discount,
          voucher_count: statistics.voucher_count
        },
        productSales: productSales.map(p => ({
          product_name: p.product_name,
          total_quantity: p.total_quantity,
          total_subtotal: p.total_subtotal,
          customization_subtotal: p.customization_subtotal,
          base_subtotal: p.base_subtotal,
          base_unit_price: p.base_unit_price,
          platform: p.platform,
          transaction_type: p.transaction_type
        })),
        customizationSales: customizationSales.map(item => ({
          option_id: item.option_id,
          option_name: item.option_name,
          customization_id: item.customization_id,
          customization_name: item.customization_name,
          total_quantity: item.total_quantity,
          total_revenue: item.total_revenue
        })),
        paymentBreakdown: paymentBreakdown.map(p => ({
          payment_method_name: p.payment_method_name || p.payment_method_code,
          transaction_count: p.transaction_count
        })),
        cashSummary: {
          cash_shift: cashSummary.cash_shift,
          cash_whole_day: cashSummary.cash_whole_day,
          total_cash_in_cashier: totalCashInCashier
        },
        business_id: BUSINESS_ID,
        printerType: 'receiptPrinter'
      });

      if (result.success) {
        setSuccessMessage('Laporan shift berhasil dicetak!');
      } else {
        throw new Error(result.error || 'Gagal mencetak laporan');
      }
    } catch (error: any) {
      console.error('Error printing shift breakdown:', error);
      setError(error.message || 'Gagal mencetak laporan. Silakan coba lagi.');
    }
  };

  const handlePrintCustomRange = async () => {
    if (!startDateTime || !endDateTime) {
      setError('Silakan pilih tanggal dan waktu mulai serta selesai.');
      return;
    }

    if (new Date(startDateTime) > new Date(endDateTime)) {
      setError('Tanggal mulai harus sebelum tanggal selesai.');
      return;
    }

    if (!window.electronAPI?.printShiftBreakdown) {
      setError('Fitur print belum tersedia. Silakan restart aplikasi.');
      return;
    }

    setIsPrintingCustomRange(true);
    setError(null);
    setSuccessMessage(null);

    try {
      // Fetch statistics for custom date range
      const [statsResult, breakdownResult, cashResult, productSalesResult] = await Promise.allSettled([
        window.electronAPI.localDbGetShiftStatistics?.(
          user?.id || 0,
          startDateTime,
          endDateTime,
          BUSINESS_ID
        ) || Promise.resolve({ order_count: 0, total_amount: 0, total_discount: 0, voucher_count: 0 }),
        window.electronAPI.localDbGetPaymentBreakdown?.(
          user?.id || 0,
          startDateTime,
          endDateTime,
          BUSINESS_ID
        ) || Promise.resolve([]),
        window.electronAPI.localDbGetCashSummary?.(
          user?.id || 0,
          startDateTime,
          endDateTime,
          BUSINESS_ID
        ) || Promise.resolve({ cash_shift: 0, cash_whole_day: 0 }),
        window.electronAPI.localDbGetProductSales?.(
          user?.id || 0,
          startDateTime,
          endDateTime,
          BUSINESS_ID
        ) || Promise.resolve([])
      ]);

      const customStats = statsResult.status === 'fulfilled' ? statsResult.value : { order_count: 0, total_amount: 0, total_discount: 0, voucher_count: 0 };
      const customBreakdown = breakdownResult.status === 'fulfilled' ? breakdownResult.value : [];
      const customCash = cashResult.status === 'fulfilled' ? cashResult.value : { cash_shift: 0, cash_whole_day: 0 };
      const customProductSales = productSalesResult.status === 'fulfilled' ? productSalesResult.value : { products: [], customizations: [] };

      // Calculate total cash (using modal awal from active shift if available, otherwise 0)
      const modalAwalForCustom = activeShift?.modal_awal || 0;
      const totalCashInCashierCustom = modalAwalForCustom + customCash.cash_shift;

      const result = await window.electronAPI.printShiftBreakdown({
        user_name: user?.name || activeShift?.user_name || 'Cashier',
        shift_start: startDateTime,
        shift_end: endDateTime,
        modal_awal: modalAwalForCustom,
        statistics: {
          order_count: customStats.order_count ?? 0,
          total_amount: customStats.total_amount ?? 0,
          total_discount: customStats.total_discount ?? 0,
          voucher_count: customStats.voucher_count ?? 0
        },
        productSales: (customProductSales.products || []).map((p: any) => ({
          product_name: p.product_name,
          total_quantity: p.total_quantity,
          total_subtotal: p.total_subtotal,
          customization_subtotal: p.customization_subtotal,
          base_subtotal: p.base_subtotal,
          base_unit_price: p.base_unit_price,
          platform: p.platform,
          transaction_type: p.transaction_type
        })),
        customizationSales: customProductSales.customizations || [],
        paymentBreakdown: customBreakdown.map((p: any) => ({
          payment_method_name: p.payment_method_name || p.payment_method_code,
          transaction_count: p.transaction_count
        })),
        cashSummary: {
          cash_shift: customCash.cash_shift,
          cash_whole_day: customCash.cash_whole_day,
          total_cash_in_cashier: totalCashInCashierCustom
        },
        business_id: BUSINESS_ID,
        printerType: 'receiptPrinter'
      });

      if (result.success) {
        setSuccessMessage('Laporan untuk periode yang dipilih berhasil dicetak!');
        setShowDatePicker(false);
        setStartDateTime('');
        setEndDateTime('');
      } else {
        throw new Error(result.error || 'Gagal mencetak laporan');
      }
    } catch (error: any) {
      console.error('Error printing custom range:', error);
      setError(error.message || 'Gagal mencetak laporan. Silakan coba lagi.');
    } finally {
      setIsPrintingCustomRange(false);
    }
  };

  const handleMigrateTodayTransactions = async () => {
    if (!activeShift || !todayTransactionsInfo?.earliestTime) return;

    if (!canManageActiveShift) {
      setError('Anda tidak memiliki izin untuk memigrasikan transaksi ke shift ini.');
      return;
    }

    const confirmed = window.confirm(
      `Migrasikan ${todayTransactionsInfo.count} transaksi hari ini ke shift ini?\n\n` +
      `Shift start akan diubah dari ${formatTime(activeShift.shift_start)} menjadi ${formatTime(todayTransactionsInfo.earliestTime)}.\n\n` +
      `Transaksi yang sudah ada akan otomatis termasuk dalam statistik shift.`
    );

    if (!confirmed) return;

    setIsMigrating(true);
    setError(null);

    try {
      if (!window.electronAPI?.localDbUpdateShiftStart) {
        throw new Error('Fitur migrasi belum tersedia. Silakan restart aplikasi.');
      }

      // Use earliest transaction time as new shift start
      const result = await window.electronAPI.localDbUpdateShiftStart(
        activeShift.id,
        todayTransactionsInfo.earliestTime
      );

      if (result.success) {
        setSuccessMessage(`Berhasil! ${todayTransactionsInfo.count} transaksi telah ditambahkan ke shift.`);
        // Reload shift and statistics
        await loadActiveShift();
        setTodayTransactionsInfo(null); // Clear the banner
      } else {
        throw new Error(result.error || 'Gagal memigrasikan transaksi');
      }
    } catch (error: any) {
      console.error('Error migrating transactions:', error);
      setError(error.message || 'Gagal memigrasikan transaksi. Silakan coba lagi.');
    } finally {
      setIsMigrating(false);
    }
  };

  // Calculate total cash in cashier
  const totalCashInCashier = activeShift 
    ? activeShift.modal_awal + cashSummary.cash_shift 
    : 0;

  // Calculate total payment method count
  const totalPaymentCount = paymentBreakdown.reduce(
    (sum, item) => sum + item.transaction_count,
    0
  );

  return (
    <div className="flex-1 flex flex-col h-full bg-gray-50 overflow-y-auto">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-4">
        <h1 className="text-2xl font-bold text-gray-800">Ganti Shift</h1>
        {activeShift && (
          <>
            <button
              onClick={() => {
                // Set default to today's date range
                const now = new Date();
                const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
                const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
                
                // Format as YYYY-MM-DDTHH:mm for datetime-local input
                const formatForInput = (date: Date) => {
                  const year = date.getFullYear();
                  const month = String(date.getMonth() + 1).padStart(2, '0');
                  const day = String(date.getDate()).padStart(2, '0');
                  const hours = String(date.getHours()).padStart(2, '0');
                  const minutes = String(date.getMinutes()).padStart(2, '0');
                  return `${year}-${month}-${day}T${hours}:${minutes}`;
                };
                
                setStartDateTime(formatForInput(todayStart));
                setEndDateTime(formatForInput(todayEnd));
                setShowDatePicker(true);
              }}
              className="flex items-center space-x-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
            >
              <Printer className="w-4 h-4" />
              <span>Print Custom Range</span>
            </button>
            <button
              onClick={handlePrintAll}
              className="flex items-center space-x-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
            >
              <Printer className="w-4 h-4" />
              <span>Print All</span>
            </button>
            {isCurrentUsersShift ? (
              <button
                onClick={handleEndShiftClick}
                disabled={isEndingShift}
                className="flex-1 flex items-center justify-center space-x-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed font-semibold transition-colors"
              >
                <StopCircle className="w-5 h-5" />
                <span>{isEndingShift ? 'Mengakhiri Shift...' : 'End Shift'}</span>
              </button>
            ) : canForceCloseShift ? (
              <button
                onClick={handleForceCloseClick}
                disabled={isEndingShift}
                className="flex-1 flex items-center justify-center space-x-2 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed font-semibold transition-colors"
              >
                <StopCircle className="w-5 h-5" />
                <span>{isEndingShift ? 'Menutup Shift...' : 'Force Close Shift'}</span>
              </button>
            ) : (
              <div className="flex-1 px-4 py-2 bg-yellow-100 text-yellow-900 rounded-lg text-sm font-semibold flex items-center justify-center">
                Shift aktif oleh {activeShift.user_name}
              </div>
            )}
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </>
        )}
      </div>

      {/* Error Message */}
      {error && (
        <div className="mx-6 mt-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center space-x-2 animate-in slide-in-from-top">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
          <span className="text-red-800 flex-1">{error}</span>
          <button
            onClick={() => setError(null)}
            className="text-red-600 hover:text-red-800 hover:bg-red-100 rounded-full p-1 transition-colors"
            aria-label="Close error"
          >
            ✕
          </button>
        </div>
      )}

      {/* Success Message */}
      {successMessage && (
        <div className="mx-6 mt-4 p-4 bg-green-50 border border-green-200 rounded-lg flex items-center space-x-2 animate-in slide-in-from-top">
          <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
          <span className="text-green-800 flex-1">{successMessage}</span>
          <button
            onClick={() => setSuccessMessage(null)}
            className="text-green-600 hover:text-green-800 hover:bg-green-100 rounded-full p-1 transition-colors"
            aria-label="Close success message"
          >
            ✕
          </button>
        </div>
      )}

      {activeShift && !isCurrentUsersShift && !canForceCloseShift && (
        <div className="mx-6 mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg flex items-start space-x-3">
          <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1 text-sm text-yellow-900">
            <p className="font-semibold">
              Shift atas nama {activeShift.user_name} masih berlangsung.
            </p>
            <p className="mt-1">
              Minta kasir tersebut login kembali dan mengakhiri shift sebelum memulai shift baru.
            </p>
          </div>
        </div>
      )}

      {activeShift && !isCurrentUsersShift && canForceCloseShift && (
        <div className="mx-6 mt-4 p-4 bg-orange-50 border border-orange-200 rounded-lg flex items-start space-x-3">
          <AlertCircle className="w-5 h-5 text-orange-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1 text-sm text-orange-900">
            <p className="font-semibold">
              Shift atas nama {activeShift.user_name} masih berlangsung.
            </p>
            <p className="mt-1">
              Anda memiliki izin untuk force close shift ini bila kasir sebelumnya tidak tersedia.
            </p>
          </div>
        </div>
      )}

      {/* Loading State */}
      {isLoadingInitial && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <Loader2 className="w-8 h-8 text-blue-600 animate-spin mx-auto mb-4" />
            <p className="text-gray-600">Memuat data shift...</p>
          </div>
        </div>
      )}

      {!isLoadingInitial && (
      <div className="flex-1 px-6 py-6 space-y-6">
        {/* STATE 1: No Active Shift */}
        {!activeShift && (
          <>
            {/* Modal Awal Input */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex items-center space-x-3 mb-4">
                <Wallet className="w-6 h-6 text-blue-600" />
                <h2 className="text-xl font-semibold text-gray-800">Modal Awal (Starting Cash)</h2>
              </div>
              <p className="text-gray-600 mb-4">
                Mulai shift dengan memasukkan modal awal
              </p>
              <div className="flex items-center space-x-4">
                <div className="flex-1 relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 font-medium">Rp</span>
                  <input
                    ref={modalInputRef}
                    type="text"
                    value={formatNumberDisplay(modalAwal)}
                    onChange={(e) => {
                      const value = formatNumberInput(e.target.value);
                      setModalAwal(value);
                      setError(null); // Clear error on input change
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !isStartingShift && modalAwal) {
                        e.preventDefault();
                        handleStartShift();
                      }
                      // Allow Escape to clear
                      if (e.key === 'Escape') {
                        setModalAwal('');
                        setError(null);
                      }
                    }}
                    placeholder="Masukkan modal awal (contoh: 500000)"
                    className="w-full pl-12 pr-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-lg font-medium"
                    disabled={isStartingShift}
                    inputMode="numeric"
                    autoComplete="off"
                    aria-label="Modal awal (starting cash)"
                  />
                </div>
                <button
                  onClick={handleStartShift}
                  disabled={isStartingShift || !modalAwal}
                  className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors"
                >
                  {isStartingShift ? 'Memulai...' : 'Mulai Shift'}
                </button>
              </div>
              <p className="text-sm text-gray-500 mt-2">
                Shift akan otomatis dimulai setelah input modal awal
              </p>
            </div>

            {/* Empty Statistics */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h2 className="text-xl font-semibold text-gray-800 mb-4">Shift Summary</h2>
              <div className="space-y-3">
                <div className="flex items-center space-x-3">
                  <Package className="w-5 h-5 text-gray-400" />
                  <span className="text-gray-600">Jumlah Pesanan: <strong>0 transaksi</strong></span>
                </div>
                <div className="flex items-center space-x-3">
                  <DollarSign className="w-5 h-5 text-gray-400" />
                  <span className="text-gray-600">Total Transaksi: <strong>Rp 0</strong></span>
                </div>
                <div className="flex items-center space-x-3">
                  <Ticket className="w-5 h-5 text-gray-400" />
                  <span className="text-gray-600">Voucher Dipakai: <strong>0 transaksi</strong></span>
                </div>
                <div className="flex items-center space-x-3">
                  <Ticket className="w-5 h-5 text-gray-400" />
                  <span className="text-gray-600">Total Diskon Voucher: <strong>Rp 0</strong></span>
                </div>
              </div>
            </div>

            {/* Disabled End Shift Button */}
            <button
              disabled
              className="w-full px-6 py-4 bg-gray-300 text-gray-500 rounded-lg cursor-not-allowed font-medium"
            >
              End Shift
            </button>
          </>
        )}

        {/* STATE 2: Active Shift */}
        {activeShift && (
          <>
            {/* Migration Banner */}
            {todayTransactionsInfo?.hasTransactions && (
              <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded-lg">
                <div className="flex items-start">
                  <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5 mr-3 flex-shrink-0" />
                  <div className="flex-1">
                    <h3 className="text-sm font-semibold text-yellow-800 mb-1">
                      Transaksi Sebelum Shift Ditemukan
                    </h3>
                    <p className="text-sm text-yellow-700 mb-3">
                      Terdapat <strong>{todayTransactionsInfo.count} transaksi</strong> yang dibuat sebelum shift ini dimulai ({formatTime(todayTransactionsInfo.earliestTime || '')}).
                      Transaksi tersebut belum termasuk dalam statistik shift saat ini.
                    </p>
                    <button
                      onClick={handleMigrateTodayTransactions}
                      disabled={isMigrating || !canManageActiveShift}
                      className="px-4 py-2 bg-yellow-600 text-white text-sm font-medium rounded-lg hover:bg-yellow-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      title={!canManageActiveShift ? 'Anda tidak memiliki izin untuk memigrasikan transaksi ke shift ini.' : undefined}
                    >
                      {isMigrating ? 'Memproses...' : 'Sertakan Transaksi Hari Ini ke Shift'}
                    </button>
                  </div>
                  <button
                    onClick={() => setTodayTransactionsInfo(null)}
                    className="ml-2 text-yellow-600 hover:text-yellow-800"
                    aria-label="Tutup"
                  >
                    ✕
                  </button>
                </div>
              </div>
            )}

            {/* Shift Info, Modal Awal, Shift Summary, and Cash Summary - Compact 4 columns */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Shift Info */}
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                <h2 className="text-base font-semibold text-gray-800 mb-3">Shift Info</h2>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Cashier:</span>
                    <span className="text-sm font-medium">{activeShift.user_name}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Started:</span>
                    <span className="text-sm font-medium">{formatTime(activeShift.shift_start)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Status:</span>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                      <span className="w-1.5 h-1.5 bg-green-500 rounded-full mr-1.5"></span>
                      Aktif
                    </span>
                  </div>
                </div>
              </div>

              {/* Modal Awal */}
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                <h2 className="text-base font-semibold text-gray-800 mb-3">Modal Awal</h2>
                <div className="text-xl font-bold text-blue-600">
                  {formatRupiah(activeShift.modal_awal)}
                </div>
                <p className="text-xs text-gray-500 mt-1">(saat mulai shift)</p>
              </div>

              {/* Shift Summary */}
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                <h2 className="text-base font-semibold text-gray-800 mb-3">Shift Summary</h2>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Package className="w-4 h-4 text-blue-600" />
                      <span className="text-sm text-gray-600">Pesanan:</span>
                    </div>
                    <span className="text-sm font-semibold">{statistics.order_count} transaksi</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Total Transaksi:</span>
                    <span className="text-sm font-semibold">{formatRupiah(statistics.total_amount)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Ticket className="w-4 h-4 text-orange-600" />
                      <span className="text-sm text-gray-600">Voucher Dipakai:</span>
                    </div>
                    <span className="text-sm font-semibold">{statistics.voucher_count} transaksi</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Ticket className="w-4 h-4 text-green-600" />
                      <span className="text-sm text-gray-600">Total Diskon Voucher:</span>
                    </div>
                    <span className="text-sm font-semibold text-green-600">
                      {statistics.total_discount > 0 ? formatRupiah(-statistics.total_discount) : formatRupiah(0)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Cash Summary */}
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                <h2 className="text-base font-semibold text-gray-800 mb-3">Cash Summary</h2>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Wallet className="w-4 h-4 text-green-600" />
                      <span className="text-sm text-gray-600">Cash (Shift):</span>
                    </div>
                    <span className="text-sm font-semibold">{formatRupiah(cashSummary.cash_shift)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Wallet className="w-4 h-4 text-blue-600" />
                      <span className="text-sm text-gray-600">Cash (Hari):</span>
                    </div>
                    <span className="text-sm font-semibold">{formatRupiah(cashSummary.cash_whole_day)}</span>
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t border-gray-200">
                    <div className="flex items-center space-x-2">
                      <CreditCard className="w-4 h-4 text-purple-600" />
                      <span className="text-sm font-medium text-gray-800">Cash in Cashier:</span>
                    </div>
                    <span className="text-sm font-bold text-purple-600">{formatRupiah(totalCashInCashier)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Product Sales Breakdown */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h2 className="text-xl font-semibold text-gray-800 mb-4">Product Sales Breakdown</h2>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-3 px-4 font-semibold text-gray-700">Product</th>
                      <th className="text-right py-3 px-4 font-semibold text-gray-700">Quantity</th>
                      <th className="text-right py-3 px-4 font-semibold text-gray-700">Unit Price</th>
                      <th className="text-right py-3 px-4 font-semibold text-gray-700">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productSales.length > 0 ? (
                      <>
                        {productSales.map((product, idx) => (
                          <tr key={`${product.product_id}-${product.platform}-${product.transaction_type}-${idx}`} className="border-b border-gray-200 hover:bg-gray-50">
                            <td className="py-3 px-4 font-medium">
                              <div>
                                {product.is_bundle_item && <span className="text-xs font-semibold text-purple-600">[Bundle] </span>}
                                {product.product_name}
                              </div>
                              <div className="text-xs text-gray-500">
                                {product.transaction_type === 'drinks' ? 'Drinks' : 'Bakery'}
                                {' · '}
                                {formatPlatformLabel(product.platform)}
                              </div>
                            </td>
                            <td className="py-3 px-4 text-right font-medium">{product.total_quantity}</td>
                            <td className="py-3 px-4 text-right font-medium">
                              {product.is_bundle_item ? (
                                <span className="text-gray-400">-</span>
                              ) : (
                                formatRupiah(
                                  product.base_unit_price ??
                                    (product.total_quantity > 0 ? product.base_subtotal / product.total_quantity : 0)
                                )
                              )}
                            </td>
                            <td className="py-3 px-4 text-right font-semibold">
                              {product.is_bundle_item ? (
                                <span className="text-gray-400">-</span>
                              ) : (
                                formatRupiah(product.base_subtotal)
                              )}
                            </td>
                          </tr>
                        ))}
                        <tr className="border-t-2 border-gray-300 bg-gray-50">
                          <td className="py-3 px-4 font-bold">TOTAL</td>
                          <td className="py-3 px-4 text-right font-bold">
                            {productSales.reduce((sum, p) => sum + p.total_quantity, 0)}
                          </td>
                          <td className="py-3 px-4 text-right font-bold">
                          {(() => {
                            const regularProducts = productSales.filter(p => !p.is_bundle_item);
                            const totalsByKey = regularProducts.reduce((acc, product) => {
                              const key = `${product.transaction_type}-${product.platform}`;
                              if (!acc.has(key)) {
                                acc.set(key, { quantity: 0, base: 0 });
                              }
                              const current = acc.get(key)!;
                              current.quantity += product.total_quantity;
                              current.base += product.base_subtotal;
                              return acc;
                            }, new Map<string, { quantity: number; base: number }>());

                            const rows = Array.from(totalsByKey.entries()).map(([key, value]) => {
                              const [transactionType, platform] = key.split('-');
                              const label = `${transactionType === 'drinks' ? 'Drinks' : 'Bakery'} · ${formatPlatformLabel(platform)}`;
                              const unitPrice = value.quantity > 0 ? value.base / value.quantity : 0;
                              return (
                                <div key={key} className="flex justify-between text-sm text-gray-600">
                                  <span>{label}</span>
                                  <span>{formatRupiah(unitPrice)}</span>
                                </div>
                              );
                            });
                            const totalQty = regularProducts.reduce((sum, p) => sum + p.total_quantity, 0);
                            const totalBase = regularProducts.reduce((sum, p) => sum + p.base_subtotal, 0);
                            const overallUnitPrice = totalQty > 0 ? totalBase / totalQty : 0;
                            rows.push(
                              <div key="overall" className="flex justify-between text-sm font-semibold text-gray-700">
                                <span>Overall</span>
                                <span>{formatRupiah(overallUnitPrice)}</span>
                              </div>
                            );
                            return rows;
                          })()}
                          </td>
                          <td className="py-3 px-4 text-right font-bold">
                            {formatRupiah(productSales.filter(p => !p.is_bundle_item).reduce((sum, p) => sum + p.base_subtotal, 0))}
                          </td>
                        </tr>
                      </>
                    ) : (
                      <tr>
                        <td colSpan={4} className="py-8 text-center text-gray-500">
                          Belum ada produk yang terjual
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Customization Sales Breakdown */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h2 className="text-xl font-semibold text-gray-800 mb-4">Customization Sales Breakdown</h2>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-3 px-4 font-semibold text-gray-700">Customization</th>
                      <th className="text-right py-3 px-4 font-semibold text-gray-700">Quantity</th>
                      <th className="text-right py-3 px-4 font-semibold text-gray-700">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customizationSales.length > 0 ? (
                      <>
                        {customizationSales.map((item, idx) => (
                          <tr key={idx} className="border-b border-gray-200 hover:bg-gray-50">
                            <td className="py-3 px-4">
                              <div className="font-medium text-gray-800">{item.option_name}</div>
                              <div className="text-xs text-gray-500">{item.customization_name}</div>
                            </td>
                            <td className="py-3 px-4 text-right font-medium">{item.total_quantity}</td>
                            <td className="py-3 px-4 text-right font-semibold">{formatRupiah(item.total_revenue)}</td>
                          </tr>
                        ))}
                        <tr className="border-t-2 border-gray-300 bg-gray-50">
                          <td className="py-3 px-4 font-bold">TOTAL</td>
                          <td className="py-3 px-4 text-right font-bold">
                            {customizationSales.reduce((sum, item) => sum + item.total_quantity, 0)}
                          </td>
                          <td className="py-3 px-4 text-right font-bold">
                            {formatRupiah(customizationSales.reduce((sum, item) => sum + item.total_revenue, 0))}
                          </td>
                        </tr>
                      </>
                    ) : (
                      <tr>
                        <td colSpan={3} className="py-8 text-center text-gray-500">
                          Belum ada kustomisasi terjual
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Payment Method Breakdown */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h2 className="text-xl font-semibold text-gray-800 mb-4">Payment Method Breakdown</h2>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-3 px-4 font-semibold text-gray-700">Payment Method</th>
                      <th className="text-right py-3 px-4 font-semibold text-gray-700">Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paymentBreakdown.length > 0 ? (
                      <>
                        {paymentBreakdown.map((item, idx) => (
                          <tr key={idx} className="border-b border-gray-100">
                            <td className="py-3 px-4">{item.payment_method_name || item.payment_method_code}</td>
                            <td className="py-3 px-4 text-right font-medium">{item.transaction_count}</td>
                          </tr>
                        ))}
                        <tr className="border-t-2 border-gray-300 bg-gray-50">
                          <td className="py-3 px-4 font-bold">TOTAL</td>
                          <td className="py-3 px-4 text-right font-bold">{totalPaymentCount}</td>
                        </tr>
                      </>
                    ) : (
                      <tr>
                        <td colSpan={2} className="py-8 text-center text-gray-500">
                          Belum ada transaksi
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
      )}

      {/* Date-Time Picker Modal */}
      {showDatePicker && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 animate-in zoom-in">
            <h3 className="text-xl font-bold text-gray-800 mb-4">Pilih Periode untuk Print</h3>
            
            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Tanggal & Waktu Mulai
                </label>
                <input
                  type="datetime-local"
                  value={startDateTime}
                  onChange={(e) => setStartDateTime(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                  required
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Tanggal & Waktu Selesai
                </label>
                <input
                  type="datetime-local"
                  value={endDateTime}
                  onChange={(e) => setEndDateTime(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                  required
                />
              </div>
            </div>
            
            <div className="flex space-x-3">
              <button
                onClick={() => {
                  setShowDatePicker(false);
                  setStartDateTime('');
                  setEndDateTime('');
                }}
                disabled={isPrintingCustomRange}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors"
              >
                Batal
              </button>
              <button
                onClick={handlePrintCustomRange}
                disabled={isPrintingCustomRange || !startDateTime || !endDateTime}
                className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors flex items-center justify-center space-x-2"
              >
                {isPrintingCustomRange ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Mencetak...</span>
                  </>
                ) : (
                  <>
                    <Printer className="w-4 h-4" />
                    <span>Print</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* End Shift Confirmation Modal */}
      {showEndShiftConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 animate-in zoom-in">
            <h3 className="text-xl font-bold text-gray-800 mb-4">Konfirmasi Akhiri Shift</h3>
            <div className="space-y-3 mb-6">
              <div className="flex justify-between">
                <span className="text-gray-600">Total Pesanan:</span>
                <span className="font-semibold">{statistics.order_count} transaksi</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Total Transaksi:</span>
                <span className="font-semibold">{formatRupiah(statistics.total_amount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Voucher Dipakai:</span>
                <span className="font-semibold">{statistics.voucher_count} transaksi</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Total Diskon Voucher:</span>
                <span className="font-semibold text-green-600">
                  {statistics.total_discount > 0 ? formatRupiah(-statistics.total_discount) : formatRupiah(0)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Cash (Shift):</span>
                <span className="font-semibold">{formatRupiah(cashSummary.cash_shift)}</span>
              </div>
              <div className="flex justify-between pt-3 border-t border-gray-200">
                <span className="text-gray-800 font-medium">Cash in Cashier:</span>
                <span className="font-bold text-lg text-purple-600">{formatRupiah(totalCashInCashier)}</span>
              </div>
            </div>
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-6">
              <p className="text-sm text-yellow-800">
                ⚠️ Shift akan ditutup dan tidak dapat dibuka kembali.
              </p>
            </div>
            <div className="flex space-x-3">
              <button
                onClick={() => setShowEndShiftConfirm(false)}
                disabled={isEndingShift}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors"
              >
                Batal
              </button>
              <button
                onClick={handleEndShiftConfirm}
                disabled={isEndingShift}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors"
              >
                {isEndingShift ? 'Mengakhiri...' : 'Akhiri Shift'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Force Close Confirmation Modal */}
      {showForceCloseConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 animate-in zoom-in">
            <h3 className="text-xl font-bold text-gray-800 mb-4">Force Close Shift</h3>
            <p className="text-sm text-gray-600 mb-4">
              Shift ini dimiliki oleh <span className="font-semibold text-gray-800">{activeShift?.user_name}</span>. Pastikan kasir sebelumnya tidak tersedia sebelum melakukan force close.
            </p>
            <div className="space-y-3 mb-6">
              <div className="flex justify-between">
                <span className="text-gray-600">Total Pesanan:</span>
                <span className="font-semibold">{statistics.order_count} transaksi</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Total Transaksi:</span>
                <span className="font-semibold">{formatRupiah(statistics.total_amount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Cash (Shift):</span>
                <span className="font-semibold">{formatRupiah(cashSummary.cash_shift)}</span>
              </div>
            </div>
            <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 mb-6">
              <p className="text-sm text-orange-800">
                ⚠️ Force close akan menutup shift tanpa konfirmasi dari kasir asli dan sebaiknya digunakan hanya dalam keadaan darurat.
              </p>
            </div>
            <div className="flex space-x-3">
              <button
                onClick={() => setShowForceCloseConfirm(false)}
                disabled={isEndingShift}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors"
              >
                Batal
              </button>
              <button
                onClick={handleEndShiftConfirm}
                disabled={isEndingShift}
                className="flex-1 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors"
              >
                {isEndingShift ? 'Menutup...' : 'Force Close Shift'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

