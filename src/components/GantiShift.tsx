'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { 
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
import { isSuperAdmin } from '@/lib/auth';
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
}

interface CashSummary {
  cash_shift: number;
  cash_shift_sales?: number;
  cash_shift_refunds?: number;
  cash_whole_day: number;
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

interface ProductSalesPayload {
  products?: ProductSale[];
  customizations?: CustomizationSale[];
}

interface ShiftSequenceInfo {
  index: number;
  total: number;
  dayStartUtc: string;
  dayEndUtc: string;
}

interface ReportDataPayload {
  statistics: ShiftStatistics;
  paymentBreakdown: PaymentBreakdown[];
  cashSummary: CashSummary;
  productSales: ProductSale[];
  customizationSales: CustomizationSale[];
}

const getGmt7DayBounds = (dateString?: string | null): { dayStartUtc: string; dayEndUtc: string } | null => {
  if (!dateString) {
    return null;
  }
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const gmt7Offset = 7 * 60 * 60 * 1000;
  const gmt7Date = new Date(date.getTime() + gmt7Offset);
  const year = gmt7Date.getUTCFullYear();
  const month = gmt7Date.getUTCMonth();
  const day = gmt7Date.getUTCDate();
  const dayStartGmt7 = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
  const dayEndGmt7 = new Date(Date.UTC(year, month, day, 23, 59, 59, 999));
  return {
    dayStartUtc: new Date(dayStartGmt7.getTime() - gmt7Offset).toISOString(),
    dayEndUtc: new Date(dayEndGmt7.getTime() - gmt7Offset).toISOString()
  };
};

const BUSINESS_ID = 14;
const AUTO_REFRESH_INTERVAL = 30000; // 30 seconds

const getElectronAPI = () => (typeof window !== 'undefined' ? window.electronAPI : undefined);

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
  const [kasAkhirInput, setKasAkhirInput] = useState<string>('');
  const [kasAkhirError, setKasAkhirError] = useState<string | null>(null);
  const [todayTransactionsInfo, setTodayTransactionsInfo] = useState<{
    hasTransactions: boolean;
    count: number;
    earliestTime: string | null;
  } | null>(null);
  const [isMigrating, setIsMigrating] = useState(false);
  const [shiftSequenceInfo, setShiftSequenceInfo] = useState<ShiftSequenceInfo | null>(null);
  
  const [statistics, setStatistics] = useState<ShiftStatistics>({
    order_count: 0,
    total_amount: 0,
    total_discount: 0,
    voucher_count: 0
  });
  
  const [paymentBreakdown, setPaymentBreakdown] = useState<PaymentBreakdown[]>([]);
  const [cashSummary, setCashSummary] = useState<CashSummary>({
    cash_shift: 0,
    cash_shift_sales: 0,
    cash_shift_refunds: 0,
    cash_whole_day: 0,
    cash_whole_day_sales: 0,
    cash_whole_day_refunds: 0
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
  const isAdmin = isSuperAdmin(user);
  const canForceCloseShift = isAdmin || permissions.includes('marviano-pos_gantishift.closeunattendedshift');
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
    const electronAPI = getElectronAPI();
    if (!activeShift || !electronAPI?.localDbCheckTodayTransactions) {
      return;
    }

    try {
      const shiftOwnerId = Number(activeShift.user_id ?? 0);
      if (!shiftOwnerId) {
        return;
      }

      const info = await electronAPI.localDbCheckTodayTransactions(
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
      setCashSummary({
        cash_shift: 0,
        cash_shift_sales: 0,
        cash_shift_refunds: 0,
        cash_whole_day: 0,
        cash_whole_day_sales: 0,
        cash_whole_day_refunds: 0
      });
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

  useEffect(() => {
    if (!activeShift) {
      setShiftSequenceInfo(null);
      return;
    }

    const bounds = getGmt7DayBounds(activeShift.shift_start);
    if (!bounds) {
      setShiftSequenceInfo(null);
      return;
    }

    const electronAPI = getElectronAPI();
    const localDbGetShifts = electronAPI?.localDbGetShifts;
    if (!localDbGetShifts) {
      setShiftSequenceInfo({
        index: 1,
        total: 1,
        dayStartUtc: bounds.dayStartUtc,
        dayEndUtc: bounds.dayEndUtc
      });
      return;
    }

    let isCancelled = false;

    const loadSequence = async () => {
      try {
        const response = await localDbGetShifts({
          businessId: BUSINESS_ID,
          startDate: bounds.dayStartUtc,
          endDate: bounds.dayEndUtc,
          limit: 50
        });
        const rawShifts = Array.isArray(response?.shifts) ? (response?.shifts as Shift[]) : [];
        const sortedShifts = [...rawShifts].sort(
          (a, b) => new Date(a.shift_start).getTime() - new Date(b.shift_start).getTime()
        );
        const index = Math.max(0, sortedShifts.findIndex(shift => shift.id === activeShift.id)) + 1;
        if (!isCancelled) {
          setShiftSequenceInfo({
            index: index || 1,
            total: sortedShifts.length || 1,
            dayStartUtc: bounds.dayStartUtc,
            dayEndUtc: bounds.dayEndUtc
          });
        }
      } catch (error) {
        console.error('Error determining shift sequence:', error);
        if (!isCancelled) {
          setShiftSequenceInfo({
            index: 1,
            total: 1,
            dayStartUtc: bounds.dayStartUtc,
            dayEndUtc: bounds.dayEndUtc
          });
        }
      }
    };

    loadSequence();

    return () => {
      isCancelled = true;
    };
  }, [activeShift]);

  const loadActiveShift = useCallback(async () => {
    if (!currentUserId) {
      return;
    }

    // Check if Electron API is available
    const electronAPI = getElectronAPI();
    if (!electronAPI) {
      setError('Aplikasi Electron tidak terdeteksi. Silakan restart aplikasi.');
      setIsLoadingInitial(false);
      return;
    }

    if (!electronAPI.localDbGetActiveShift) {
      setError('Fitur shift belum tersedia. Silakan restart aplikasi untuk memperbarui.');
      setIsLoadingInitial(false);
      return;
    }

    try {
      const response = await electronAPI.localDbGetActiveShift(currentUserId, BUSINESS_ID);
      const shift = response?.shift ?? null;
      setActiveShift(shift);
      setIsCurrentUsersShift(Boolean(shift && response?.isCurrentUserShift));
      setModalAwal(shift && response?.isCurrentUserShift ? shift.modal_awal.toString() : '');
      setError(null);
    } catch (error) {
      console.error('Error loading active shift:', error);
      setError('Gagal memuat shift aktif. Silakan refresh halaman.');
    }
  }, [currentUserId]);

  const loadStatistics = useCallback(async () => {
    const electronAPI = getElectronAPI();
    if (!activeShift || !electronAPI) {
      return;
    }

    try {
      setIsRefreshing(true);
      const shiftOwnerId = Number(activeShift.user_id ?? 0);
      if (!shiftOwnerId) {
        setIsRefreshing(false);
        return;
      }
      
      const defaultStats: ShiftStatistics = { order_count: 0, total_amount: 0, total_discount: 0, voucher_count: 0 };
      const defaultCash: CashSummary = { cash_shift: 0, cash_whole_day: 0 };

      // Load all statistics in parallel with error handling
      const [statsResult, breakdownResult, cashResult, productSalesResult] = await Promise.allSettled([
        electronAPI.localDbGetShiftStatistics
          ? electronAPI.localDbGetShiftStatistics(shiftOwnerId, activeShift.shift_start, activeShift.shift_end, BUSINESS_ID)
          : Promise.resolve(defaultStats),
        electronAPI.localDbGetPaymentBreakdown
          ? electronAPI.localDbGetPaymentBreakdown(shiftOwnerId, activeShift.shift_start, activeShift.shift_end, BUSINESS_ID)
          : Promise.resolve<PaymentBreakdown[]>([]),
        electronAPI.localDbGetCashSummary
          ? electronAPI.localDbGetCashSummary(shiftOwnerId, activeShift.shift_start, activeShift.shift_end, BUSINESS_ID)
          : Promise.resolve(defaultCash),
        electronAPI.localDbGetProductSales
          ? electronAPI.localDbGetProductSales(shiftOwnerId, activeShift.shift_start, activeShift.shift_end, BUSINESS_ID)
          : Promise.resolve<ProductSalesPayload>({ products: [], customizations: [] })
      ]);

      const stats =
        statsResult.status === 'fulfilled' ? (statsResult.value as ShiftStatistics) : defaultStats;
      const breakdown =
        breakdownResult.status === 'fulfilled'
          ? (breakdownResult.value as PaymentBreakdown[])
          : [];
      const cash =
        cashResult.status === 'fulfilled' ? (cashResult.value as CashSummary) : defaultCash;
      const productSalesData =
        productSalesResult.status === 'fulfilled'
          ? (productSalesResult.value as ProductSalesPayload)
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
      if (
        statsResult.status === 'rejected' &&
        breakdownResult.status === 'rejected' &&
        cashResult.status === 'rejected'
      ) {
        setError('Gagal memuat statistik');
      }
    } catch (error) {
      console.error('Error loading statistics:', error);
      setError('Gagal memuat statistik');
    } finally {
      setIsRefreshing(false);
    }
  }, [activeShift]);

  const fetchReportPayload = useCallback(
    async ({ start, end, userId, businessId = BUSINESS_ID }: { start: string; end: string | null; userId: number; businessId?: number; }): Promise<ReportDataPayload> => {
      const electronAPI = getElectronAPI();
      if (!electronAPI) {
        throw new Error('Aplikasi Electron tidak terdeteksi.');
      }
      if (!userId) {
        throw new Error('User ID tidak valid untuk laporan.');
      }

      const defaultStats: ShiftStatistics = { order_count: 0, total_amount: 0, total_discount: 0, voucher_count: 0 };
      const defaultCash: CashSummary = {
        cash_shift: 0,
        cash_shift_sales: 0,
        cash_shift_refunds: 0,
        cash_whole_day: 0,
        cash_whole_day_sales: 0,
        cash_whole_day_refunds: 0
      };

      try {
        const [statsResult, breakdownResult, cashResult, productSalesResult] = await Promise.allSettled([
          electronAPI.localDbGetShiftStatistics
            ? electronAPI.localDbGetShiftStatistics(userId, start, end, businessId)
            : Promise.resolve(defaultStats),
          electronAPI.localDbGetPaymentBreakdown
            ? electronAPI.localDbGetPaymentBreakdown(userId, start, end, businessId)
            : Promise.resolve<PaymentBreakdown[]>([]),
          electronAPI.localDbGetCashSummary
            ? electronAPI.localDbGetCashSummary(userId, start, end, businessId)
            : Promise.resolve(defaultCash),
          electronAPI.localDbGetProductSales
            ? electronAPI.localDbGetProductSales(userId, start, end, businessId)
            : Promise.resolve<ProductSalesPayload>({ products: [], customizations: [] })
        ]);

        const statsPayload = statsResult.status === 'fulfilled' ? (statsResult.value as ShiftStatistics) : defaultStats;
        const breakdownPayload =
          breakdownResult.status === 'fulfilled' ? (breakdownResult.value as PaymentBreakdown[]) : [];
        const rawCash = cashResult.status === 'fulfilled' ? (cashResult.value as CashSummary) : defaultCash;
        const productSalesPayload =
          productSalesResult.status === 'fulfilled'
            ? (productSalesResult.value as ProductSalesPayload)
            : { products: [], customizations: [] };

        const resolvedCash: CashSummary = {
          cash_shift: rawCash.cash_shift ?? 0,
          cash_shift_sales: rawCash.cash_shift_sales ?? rawCash.cash_shift ?? 0,
          cash_shift_refunds: rawCash.cash_shift_refunds ?? 0,
          cash_whole_day: rawCash.cash_whole_day ?? 0,
          cash_whole_day_sales: rawCash.cash_whole_day_sales ?? rawCash.cash_whole_day ?? 0,
          cash_whole_day_refunds: rawCash.cash_whole_day_refunds ?? 0
        };

        return {
          statistics: {
            order_count: statsPayload.order_count ?? 0,
            total_amount: statsPayload.total_amount ?? 0,
            total_discount: statsPayload.total_discount ?? 0,
            voucher_count: statsPayload.voucher_count ?? 0
          },
          paymentBreakdown: breakdownPayload,
          cashSummary: resolvedCash,
          productSales: productSalesPayload.products || [],
          customizationSales: productSalesPayload.customizations || []
        };
      } catch (error) {
        console.error('Error fetching report payload:', error);
        throw error;
      }
    },
    []
  );

  const handleStartShift = async () => {
    if (!user?.id || !user?.name) {
      setError('User tidak ditemukan. Silakan login ulang.');
      return;
    }

    const electronAPI = getElectronAPI();

    // Check if there's already an active shift (double-check)
    try {
      const existingResponse = await electronAPI?.localDbGetActiveShift?.(currentUserId, BUSINESS_ID);
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
    if (!electronAPI) {
      setError('Aplikasi Electron tidak terdeteksi. Silakan restart aplikasi.');
      setIsStartingShift(false);
      return;
    }

    if (!electronAPI.localDbCreateShift) {
      setError('Fitur shift belum tersedia. Silakan restart aplikasi untuk memperbarui.');
      setIsStartingShift(false);
      return;
    }

    try {

      const uuid_id = generateUUID();
      const result = await electronAPI.localDbCreateShift({
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
    } catch (error) {
      console.error('Error starting shift:', error);
      const message = error instanceof Error ? error.message : 'Gagal memulai shift. Silakan coba lagi.';
      setError(message);
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
    setKasAkhirInput('');
    setKasAkhirError(null);
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
    const electronAPI = getElectronAPI();
    if (!electronAPI) {
      setError('Aplikasi Electron tidak terdeteksi. Silakan restart aplikasi.');
      setIsEndingShift(false);
      return;
    }

    if (!electronAPI.localDbEndShift) {
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

      let parsedKasAkhir: number | null = null;
      if (!isForce) {
        const numericValue = Number(kasAkhirInput.replace(/\./g, '').replace(',', '.'));
        if (!Number.isFinite(numericValue) || numericValue < 0) {
          setKasAkhirError('Masukkan nominal kas akhir yang valid');
          setIsEndingShift(false);
          return;
        }
        parsedKasAkhir = numericValue;
      }

      const result = await electronAPI.localDbEndShift({
        shiftId: activeShift.id,
        kasAkhir: parsedKasAkhir
      });

      if (result.success) {
        const baseText = isForce
          ? `Shift atas nama ${activeShift.user_name || 'kasir lain'} berhasil di-force close.`
          : 'Shift berhasil diakhiri!';

        let detailedMessage = baseText;
        if (result.cashSummary) {
          const variance = Number(result.cashSummary.variance ?? 0);
          const varianceLabel = result.cashSummary.variance_label ?? (variance > 0 ? 'plus' : variance < 0 ? 'minus' : 'balanced');
          const varianceText =
            varianceLabel === 'balanced'
              ? 'Seimbang'
              : `${varianceLabel === 'plus' ? 'Plus' : 'Minus'} ${formatRupiah(Math.abs(variance))}`;

          detailedMessage = `${baseText} Kas akhir ${formatRupiah(result.cashSummary.kas_akhir ?? 0)} (${varianceText}).`;
        }

        setSuccessMessage(detailedMessage);
        setKasAkhirInput('');
        setKasAkhirError(null);
        setActiveShift(null);
        setModalAwal('');
        setStatistics({ order_count: 0, total_amount: 0, total_discount: 0, voucher_count: 0 });
        setPaymentBreakdown([]);
        setCashSummary({
          cash_shift: 0,
          cash_shift_sales: 0,
          cash_shift_refunds: 0,
          cash_whole_day: 0,
          cash_whole_day_sales: 0,
          cash_whole_day_refunds: 0
        });
        await loadActiveShift();
      } else {
        throw new Error(result.error || 'Gagal mengakhiri shift');
      }
    } catch (error) {
      console.error('Error ending shift:', error);
      const message = error instanceof Error ? error.message : 'Gagal mengakhiri shift. Silakan coba lagi.';
      setError(message);
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
    const electronAPI = getElectronAPI();
    if (!activeShift || !electronAPI?.printShiftBreakdown) {
      setError('Fitur print belum tersedia. Silakan restart aplikasi.');
      return;
    }

    try {
      let wholeDayReportSection: ShiftPrintBreakdownSection | undefined;
      const shiftOwnerId = Number(activeShift.user_id ?? 0);
      const shouldIncludeWholeDay =
        Boolean(shiftSequenceInfo && shiftSequenceInfo.index >= 2) && Boolean(shiftOwnerId);

      if (shouldIncludeWholeDay && shiftSequenceInfo && shiftOwnerId) {
        try {
          const dayReportData = await fetchReportPayload({
            start: shiftSequenceInfo.dayStartUtc,
            end: shiftSequenceInfo.dayEndUtc,
            userId: shiftOwnerId
          });
          const dayCash = dayReportData.cashSummary;
          const dayCashSales = dayCash.cash_shift_sales ?? dayCash.cash_shift ?? 0;
          const dayCashRefunds = dayCash.cash_shift_refunds ?? 0;
          const dailyKasExpected = (dayCash.cash_whole_day ?? dayCash.cash_shift ?? 0) || dayCashSales - dayCashRefunds;

          wholeDayReportSection = {
            title: 'Ringkasan Harian',
            user_name: 'Semua Shift',
            shift_start: shiftSequenceInfo.dayStartUtc,
            shift_end: shiftSequenceInfo.dayEndUtc,
            modal_awal: 0,
            statistics: dayReportData.statistics,
            productSales: dayReportData.productSales,
            customizationSales: dayReportData.customizationSales,
            paymentBreakdown: dayReportData.paymentBreakdown.map(p => ({
              payment_method_name: p.payment_method_name || p.payment_method_code,
              transaction_count: p.transaction_count
            })),
            cashSummary: {
              cash_shift: dayCash.cash_shift ?? 0,
              cash_shift_sales: dayCashSales,
              cash_shift_refunds: dayCashRefunds,
              cash_whole_day: dayCash.cash_whole_day ?? 0,
              cash_whole_day_sales: dayCash.cash_whole_day_sales ?? dayCash.cash_whole_day ?? 0,
              cash_whole_day_refunds: dayCash.cash_whole_day_refunds ?? 0,
              total_cash_in_cashier: dailyKasExpected,
              kas_mulai: 0,
              kas_expected: dailyKasExpected,
              kas_akhir: null,
              kas_selisih: null,
              kas_selisih_label: null
            }
          };
        } catch (error) {
          console.error('Error preparing whole-day report:', error);
        }
      }

      const result = await electronAPI.printShiftBreakdown({
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
          transaction_type: p.transaction_type,
          is_bundle_item: p.is_bundle_item
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
          cash_shift_sales: cashShiftSales,
          cash_shift_refunds: cashShiftRefunds,
          cash_whole_day: cashSummary.cash_whole_day,
          cash_whole_day_sales: cashWholeDaySales,
          cash_whole_day_refunds: cashWholeDayRefunds,
          total_cash_in_cashier: totalCashInCashier,
          kas_mulai: kasMulaiActive,
          kas_expected: kasExpectedActive,
          kas_akhir: kasAkhirActive,
          kas_selisih: kasSelisihValue,
          kas_selisih_label: kasSelisihLabelValue
        },
        business_id: BUSINESS_ID,
        printerType: 'receiptPrinter',
        wholeDayReport: wholeDayReportSection
      });

      if (result.success) {
        setSuccessMessage('Laporan shift berhasil dicetak!');
      } else {
        throw new Error(result.error || 'Gagal mencetak laporan');
      }
    } catch (error) {
      console.error('Error printing shift breakdown:', error);
      const message = error instanceof Error ? error.message : 'Gagal mencetak laporan. Silakan coba lagi.';
      setError(message);
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

    const electronAPI = getElectronAPI();
    if (!electronAPI?.printShiftBreakdown) {
      setError('Fitur print belum tersedia. Silakan restart aplikasi.');
      return;
    }

    setIsPrintingCustomRange(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const resolvedUserId =
        typeof user?.id === 'string'
          ? parseInt(user.id, 10)
          : typeof user?.id === 'number'
            ? user.id
            : 0;
      if (!resolvedUserId || Number.isNaN(resolvedUserId)) {
        throw new Error('User ID tidak valid. Silakan login ulang.');
      }

      const reportData = await fetchReportPayload({
        start: startDateTime,
        end: endDateTime,
        userId: resolvedUserId
      });

      const modalAwalForCustom = activeShift?.modal_awal || 0;
      const customCashSales = reportData.cashSummary.cash_shift_sales ?? reportData.cashSummary.cash_shift ?? 0;
      const customCashRefunds = reportData.cashSummary.cash_shift_refunds ?? 0;
      const customKasExpected = modalAwalForCustom + customCashSales - customCashRefunds;
      const totalCashInCashierCustom = customKasExpected;

      const result = await electronAPI.printShiftBreakdown({
        user_name: user?.name || activeShift?.user_name || 'Cashier',
        shift_start: startDateTime,
        shift_end: endDateTime,
        modal_awal: modalAwalForCustom,
        statistics: reportData.statistics,
        productSales: reportData.productSales.map((p) => ({
          product_name: p.product_name,
          total_quantity: p.total_quantity,
          total_subtotal: p.total_subtotal,
          customization_subtotal: p.customization_subtotal,
          base_subtotal: p.base_subtotal,
          base_unit_price: p.base_unit_price,
          platform: p.platform,
          transaction_type: p.transaction_type,
          is_bundle_item: p.is_bundle_item
        })),
        customizationSales: reportData.customizationSales,
        paymentBreakdown: reportData.paymentBreakdown.map((p) => ({
          payment_method_name: p.payment_method_name || p.payment_method_code,
          transaction_count: p.transaction_count
        })),
        cashSummary: {
          cash_shift: reportData.cashSummary.cash_shift,
          cash_shift_sales: customCashSales,
          cash_shift_refunds: customCashRefunds,
          cash_whole_day: reportData.cashSummary.cash_whole_day,
          cash_whole_day_sales: reportData.cashSummary.cash_whole_day_sales ?? reportData.cashSummary.cash_whole_day,
          cash_whole_day_refunds: reportData.cashSummary.cash_whole_day_refunds ?? 0,
          total_cash_in_cashier: totalCashInCashierCustom,
          kas_mulai: modalAwalForCustom,
          kas_expected: customKasExpected,
          kas_akhir: null,
          kas_selisih: null,
          kas_selisih_label: null
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
    } catch (error) {
      console.error('Error printing custom range:', error);
      const message = error instanceof Error ? error.message : 'Gagal mencetak laporan. Silakan coba lagi.';
      setError(message);
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
      const electronAPI = getElectronAPI();
      if (!electronAPI?.localDbUpdateShiftStart) {
        throw new Error('Fitur migrasi belum tersedia. Silakan restart aplikasi.');
      }

      // Use earliest transaction time as new shift start
      const result = await electronAPI.localDbUpdateShiftStart(
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
    } catch (error) {
      console.error('Error migrating transactions:', error);
      const message = error instanceof Error ? error.message : 'Gagal memigrasikan transaksi. Silakan coba lagi.';
      setError(message);
    } finally {
      setIsMigrating(false);
    }
  };

  // Cash reconciliation helpers
  const cashShiftSales = cashSummary.cash_shift_sales ?? cashSummary.cash_shift ?? 0;
  const cashShiftRefunds = cashSummary.cash_shift_refunds ?? 0;
  const cashWholeDaySales = cashSummary.cash_whole_day_sales ?? cashSummary.cash_whole_day ?? 0;
  const cashWholeDayRefunds = cashSummary.cash_whole_day_refunds ?? 0;
  const kasMulaiActive = activeShift?.modal_awal ?? 0;
  const kasExpectedActive = activeShift ? kasMulaiActive + cashShiftSales - cashShiftRefunds : 0;
  const kasAkhirActive = activeShift?.kas_akhir ?? null;
  let kasSelisihValue: number | null = null;
  let kasSelisihLabelValue: 'balanced' | 'plus' | 'minus' | null = null;
  if (kasAkhirActive !== null) {
    const delta = Number((kasAkhirActive - kasExpectedActive).toFixed(2));
    if (Math.abs(delta) < 0.01) {
      kasSelisihValue = 0;
      kasSelisihLabelValue = 'balanced';
    } else {
      kasSelisihValue = delta;
      kasSelisihLabelValue = delta > 0 ? 'plus' : 'minus';
    }
  } else if (typeof activeShift?.kas_selisih === 'number') {
    kasSelisihValue = activeShift.kas_selisih;
    kasSelisihLabelValue = activeShift.kas_selisih_label ?? null;
  }
  const kasExpectedDisplay = activeShift ? kasExpectedActive : 0;
  const totalCashInCashier = activeShift ? kasExpectedActive : 0;

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
                    className="w-full pl-12 pr-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-lg font-medium text-black placeholder-gray-400"
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
                    <span className="text-sm font-medium text-black">{activeShift.user_name}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Started:</span>
                    <span className="text-sm font-medium text-black">{formatTime(activeShift.shift_start)}</span>
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
                    <span className="text-sm font-semibold text-black">{statistics.order_count} transaksi</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Total Transaksi:</span>
                    <span className="text-sm font-semibold text-black">{formatRupiah(statistics.total_amount)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Ticket className="w-4 h-4 text-orange-600" />
                      <span className="text-sm text-gray-600">Voucher Dipakai:</span>
                    </div>
                    <span className="text-sm font-semibold text-black">{statistics.voucher_count} transaksi</span>
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
                  <span className="text-sm text-gray-600">Kas Mulai:</span>
                  <span className="text-sm font-semibold text-black">
                    {formatRupiah(activeShift?.modal_awal || 0)}
                  </span>
                </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Wallet className="w-4 h-4 text-green-600" />
                      <span className="text-sm text-gray-600">Cash (Shift):</span>
                    </div>
                    <span className="text-sm font-semibold text-black">{formatRupiah(cashSummary.cash_shift)}</span>
                  </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Cash Refund:</span>
                  <span className="text-sm font-semibold text-black">
                    {formatRupiah(cashSummary.cash_shift_refunds || 0)}
                  </span>
                </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Wallet className="w-4 h-4 text-blue-600" />
                      <span className="text-sm text-gray-600">Cash (Hari):</span>
                    </div>
                    <span className="text-sm font-semibold text-black">{formatRupiah(cashSummary.cash_whole_day)}</span>
                  </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Kas Diharapkan:</span>
                  <span className="text-sm font-semibold text-black">
                    {formatRupiah(kasExpectedDisplay)}
                  </span>
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
                              <div className="text-gray-900">
                                {product.is_bundle_item && <span className="text-xs font-semibold text-purple-600">[Bundle] </span>}
                                {product.product_name}
                              </div>
                              <div className="text-xs text-gray-700">
                                {product.transaction_type === 'drinks' ? 'Drinks' : 'Bakery'}
                                {' · '}
                                {formatPlatformLabel(product.platform)}
                              </div>
                            </td>
                            <td className="py-3 px-4 text-right font-medium text-gray-900">{product.total_quantity}</td>
                            <td className="py-3 px-4 text-right font-medium">
                              {product.is_bundle_item ? (
                                <span className="text-gray-700">-</span>
                              ) : (
                                <span className="text-gray-900">
                                  {formatRupiah(
                                    product.base_unit_price ??
                                      (product.total_quantity > 0 ? product.base_subtotal / product.total_quantity : 0)
                                  )}
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-4 text-right font-semibold">
                              {product.is_bundle_item ? (
                                <span className="text-gray-700">-</span>
                              ) : (
                                <span className="text-gray-900">
                                  {formatRupiah(product.base_subtotal)}
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                        <tr className="border-t-2 border-gray-300 bg-gray-50">
                          <td className="py-3 px-4 font-bold text-gray-900">TOTAL</td>
                          <td className="py-3 px-4 text-right font-bold text-gray-900">
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
                                <div key={key} className="flex justify-between text-sm text-gray-800">
                                  <span>{label}</span>
                                  <span>{formatRupiah(unitPrice)}</span>
                                </div>
                              );
                            });
                            const totalQty = regularProducts.reduce((sum, p) => sum + p.total_quantity, 0);
                            const totalBase = regularProducts.reduce((sum, p) => sum + p.base_subtotal, 0);
                            const overallUnitPrice = totalQty > 0 ? totalBase / totalQty : 0;
                            rows.push(
                              <div key="overall" className="flex justify-between text-sm font-semibold text-gray-900">
                                <span>Overall</span>
                                <span>{formatRupiah(overallUnitPrice)}</span>
                              </div>
                            );
                            return rows;
                          })()}
                          </td>
                          <td className="py-3 px-4 text-right font-bold text-gray-900">
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
                              <div className="font-medium text-gray-900">{item.option_name}</div>
                              <div className="text-xs text-gray-700">{item.customization_name}</div>
                            </td>
                            <td className="py-3 px-4 text-right font-medium text-gray-900">{item.total_quantity}</td>
                            <td className="py-3 px-4 text-right font-semibold text-gray-900">{formatRupiah(item.total_revenue)}</td>
                          </tr>
                        ))}
                        <tr className="border-t-2 border-gray-300 bg-gray-50">
                          <td className="py-3 px-4 font-bold text-gray-900">TOTAL</td>
                          <td className="py-3 px-4 text-right font-bold text-gray-900">
                            {customizationSales.reduce((sum, item) => sum + item.total_quantity, 0)}
                          </td>
                          <td className="py-3 px-4 text-right font-bold text-gray-900">
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
                            <td className="py-3 px-4 text-gray-900 font-medium">{item.payment_method_name || item.payment_method_code}</td>
                            <td className="py-3 px-4 text-right font-medium text-gray-900">{item.transaction_count}</td>
                          </tr>
                        ))}
                        <tr className="border-t-2 border-gray-300 bg-gray-50">
                          <td className="py-3 px-4 font-bold text-gray-900">TOTAL</td>
                          <td className="py-3 px-4 text-right font-bold text-gray-900">{totalPaymentCount}</td>
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
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 text-gray-900"
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
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 text-gray-900"
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
      {showEndShiftConfirm && activeShift && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 animate-in zoom-in">
            <h3 className="text-xl font-bold text-gray-800 mb-4">Konfirmasi Akhiri Shift</h3>
            <div className="space-y-3 mb-6">
              <div className="flex justify-between">
                <span className="text-gray-800 font-medium">Total Pesanan:</span>
                <span className="font-semibold text-gray-900">{statistics.order_count} transaksi</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-800 font-medium">Total Transaksi:</span>
                <span className="font-semibold text-gray-900">{formatRupiah(statistics.total_amount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-800 font-medium">Voucher Dipakai:</span>
                <span className="font-semibold text-gray-900">{statistics.voucher_count} transaksi</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-800 font-medium">Total Diskon Voucher:</span>
                <span className="font-semibold text-green-700">
                  {statistics.total_discount > 0 ? formatRupiah(-statistics.total_discount) : formatRupiah(0)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-800 font-medium">Kas Mulai:</span>
                <span className="font-semibold text-gray-900">{formatRupiah(activeShift.modal_awal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-800 font-medium">Cash Masuk:</span>
                <span className="font-semibold text-gray-900">{formatRupiah(cashShiftSales)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-800 font-medium">Cash Refund:</span>
                <span className="font-semibold text-gray-900">{formatRupiah(cashSummary.cash_shift_refunds ?? 0)}</span>
              </div>
              <div className="flex justify-between pt-3 border-t border-gray-200">
                <span className="text-gray-900 font-semibold">Kas Diharapkan:</span>
                <span className="font-bold text-lg text-purple-700">
                  {formatRupiah(kasExpectedDisplay)}
                </span>
              </div>
            </div>
            {endShiftMode !== 'force' && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">Kas akhir di laci</label>
                <input
                  type="number"
                  min="0"
                  value={kasAkhirInput}
                  onChange={(e) => {
                    setKasAkhirInput(e.target.value);
                    setKasAkhirError(null);
                  }}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 text-gray-900"
                  placeholder="Masukkan nominal kas akhir"
                  required
                />
                {kasAkhirError && (
                  <p className="text-xs text-red-600 mt-1">{kasAkhirError}</p>
                )}
              </div>
            )}
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-6">
              <p className="text-sm text-yellow-800">
                ⚠️ Shift akan ditutup dan tidak dapat dibuka kembali. Pastikan nominal kas akhir sudah dihitung dengan benar sebelum melanjutkan.
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
            <p className="text-sm text-gray-800 mb-4">
              Shift ini dimiliki oleh <span className="font-semibold text-gray-900">{activeShift?.user_name}</span>. Pastikan kasir sebelumnya tidak tersedia sebelum melakukan force close.
            </p>
            <div className="space-y-3 mb-6">
              <div className="flex justify-between">
                <span className="text-gray-800 font-medium">Total Pesanan:</span>
                <span className="font-semibold text-gray-900">{statistics.order_count} transaksi</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-800 font-medium">Total Transaksi:</span>
                <span className="font-semibold text-gray-900">{formatRupiah(statistics.total_amount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-800 font-medium">Cash (Shift):</span>
                <span className="font-semibold text-gray-900">{formatRupiah(cashSummary.cash_shift)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-800 font-medium">Kas Mulai:</span>
                <span className="font-semibold text-gray-900">{formatRupiah(activeShift?.modal_awal || 0)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-800 font-medium">Cash Refund:</span>
                <span className="font-semibold text-gray-900">{formatRupiah(cashSummary.cash_shift_refunds || 0)}</span>
              </div>
              <div className="flex justify-between border-t border-gray-200 pt-2">
                <span className="text-gray-900 font-semibold">Kas Diharapkan:</span>
                <span className="font-bold text-lg text-purple-700">
                  {formatRupiah(kasExpectedDisplay)}
                </span>
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

