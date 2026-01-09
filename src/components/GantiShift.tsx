'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Wallet,
  Package,
  DollarSign,
  // CreditCard,
  RefreshCw,
  StopCircle,
  AlertCircle,
  CheckCircle,
  Loader2,
  Printer,
  Ticket,
  ChevronDown,
  ChevronUp,
  Settings
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
  total_amount: number;
}

interface Category2Breakdown {
  category2_name: string;
  category2_id: number;
  total_quantity: number;
  total_amount: number;
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
  shifts: Shift[];
}

interface ShiftPrintSelection {
  shiftId: number;
  shiftIndex: number;
  selected: boolean;
}

type TabView = 'all-day' | number; // 'all-day' or shift ID

interface ReportDataPayload {
  statistics: ShiftStatistics;
  paymentBreakdown: PaymentBreakdown[];
  category2Breakdown: Category2Breakdown[];
  cashSummary: CashSummary;
  productSales: ProductSale[];
  customizationSales: CustomizationSale[];
}

interface RefundDetail {
  refund_uuid: string;
  transaction_uuid: string;
  transaction_uuid_id: string;
  refund_amount: number;
  cash_delta: number;
  refunded_at: string;
  refunded_by: number;
  payment_method_id: number;
  payment_method: string;
  final_amount: number;
  transaction_created_at: string;
  reason?: string | null;
  note?: string | null;
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

// Format full date and time in Indonesian (e.g., "Senin, 27 Desember 2025 14.53 PM")
const formatDateTime = (dateString: string): string => {
  const date = new Date(dateString);
  // Adjust for GMT+7
  const gmt7Date = new Date(date.getTime() + (7 * 60 * 60 * 1000));
  
  // Get day name
  const dayNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const dayName = dayNames[gmt7Date.getUTCDay()];
  
  // Format date
  const datePart = gmt7Date.toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  });
  
  // Format time in 24-hour format with dot separator and AM/PM
  const hours = gmt7Date.getUTCHours();
  const minutes = gmt7Date.getUTCMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const timePart = `${hours.toString().padStart(2, '0')}.${minutes.toString().padStart(2, '0')} ${ampm}`;
  
  return `${dayName}, ${datePart} ${timePart}`;
};

export default function GantiShift() {
  const { user } = useAuth();

  // Get business ID from logged-in user (fallback to 14 for backward compatibility)
  const businessId = user?.selectedBusinessId ?? 14;

  const [activeShift, setActiveShift] = useState<Shift | null>(null);
  const [modalAwal, setModalAwal] = useState<string>('');
  const [isStartingShift, setIsStartingShift] = useState(false);
  const [isEndingShift, setIsEndingShift] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingInitial, setIsLoadingInitial] = useState(true);
  const [isLoadingTabData, setIsLoadingTabData] = useState(false);
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
  const [category2Breakdown, setCategory2Breakdown] = useState<Category2Breakdown[]>([]);
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
  const [refunds, setRefunds] = useState<RefundDetail[]>([]);
  const [recalculatedCategory2Breakdown, setRecalculatedCategory2Breakdown] = useState<Category2Breakdown[]>([]);
  const [groupProducts, setGroupProducts] = useState(false); // Default: ungrouped

  // Group productSales by product_id + transaction_type to combine platforms
  const groupedProductSales = useMemo(() => {
    const groupMap = new Map<string, {
      product_id: number;
      product_name: string;
      product_code: string;
      transaction_type: string;
      platforms: string[];
      unitPrices: number[];
      total_quantity: number;
      total_base_subtotal: number;
      is_bundle_item: boolean;
    }>();

    productSales.forEach((product) => {
      // Group key: product_id + transaction_type
      const groupKey = `${product.product_id}-${product.transaction_type}`;
      
      const unitPrice = product.total_quantity > 0 
        ? product.base_subtotal / product.total_quantity 
        : 0;

      const existing = groupMap.get(groupKey);
      if (existing) {
        // Add platform if not already present
        if (!existing.platforms.includes(product.platform)) {
          existing.platforms.push(product.platform);
        }
        // Add unit price if not already present (for distinct prices)
        if (unitPrice > 0 && !existing.unitPrices.some(p => Math.abs(p - unitPrice) < 0.01)) {
          existing.unitPrices.push(unitPrice);
        }
        // Sum quantities and subtotals
        existing.total_quantity += product.total_quantity;
        existing.total_base_subtotal += product.base_subtotal;
      } else {
        groupMap.set(groupKey, {
          product_id: product.product_id,
          product_name: product.product_name,
          product_code: product.product_code,
          transaction_type: product.transaction_type,
          platforms: [product.platform],
          unitPrices: unitPrice > 0 ? [unitPrice] : [],
          total_quantity: product.total_quantity,
          total_base_subtotal: product.base_subtotal,
          is_bundle_item: product.is_bundle_item || false
        });
      }
    });

    // Convert to array and sort by product_name
    return Array.from(groupMap.values()).sort((a, b) => 
      a.product_name.localeCompare(b.product_name)
    );
  }, [productSales]);

  // Use grouped or ungrouped products based on setting
  type GroupedProductType = {
    product_id: number;
    product_name: string;
    product_code: string;
    transaction_type: string;
    platforms: string[];
    unitPrices: number[];
    total_quantity: number;
    total_base_subtotal: number;
    is_bundle_item: boolean;
  };
  
  // Type guard to check if product is grouped
  const isGroupedProduct = (p: ProductSale | GroupedProductType): p is GroupedProductType => {
    return 'platforms' in p && Array.isArray((p as GroupedProductType).platforms);
  };
  
  const displayProductSales: (ProductSale | GroupedProductType)[] = groupProducts ? groupedProductSales : productSales;

  // Helper function to group productSales for printing (same logic as groupedProductSales)
  const groupProductSalesForPrint = (products: ProductSale[]): ProductSale[] => {
    const groupMap = new Map<string, {
      product_id: number;
      product_name: string;
      product_code: string;
      transaction_type: string;
      platform: string;
      platforms: string[];
      unitPrices: number[];
      total_quantity: number;
      total_base_subtotal: number;
      is_bundle_item: boolean;
    }>();

    products.forEach((product) => {
      const groupKey = `${product.product_id}-${product.transaction_type}`;
      const unitPrice = product.total_quantity > 0 
        ? product.base_subtotal / product.total_quantity 
        : 0;

      const existing = groupMap.get(groupKey);
      if (existing) {
        if (!existing.platforms.includes(product.platform)) {
          existing.platforms.push(product.platform);
        }
        if (unitPrice > 0 && !existing.unitPrices.some(p => Math.abs(p - unitPrice) < 0.01)) {
          existing.unitPrices.push(unitPrice);
        }
        existing.total_quantity += product.total_quantity;
        existing.total_base_subtotal += product.base_subtotal;
      } else {
        groupMap.set(groupKey, {
          product_id: product.product_id,
          product_name: product.product_name,
          product_code: product.product_code || '',
          transaction_type: product.transaction_type,
          platform: product.platform, // Keep first platform for compatibility
          platforms: [product.platform],
          unitPrices: unitPrice > 0 ? [unitPrice] : [],
          total_quantity: product.total_quantity,
          total_base_subtotal: product.base_subtotal,
          is_bundle_item: product.is_bundle_item || false
        });
      }
    });

    // Convert back to ProductSale[] format with combined platforms
    return Array.from(groupMap.values()).map((group) => {
      const platformsStr = group.platforms
        .map(p => {
          const key = (p || 'offline').toLowerCase();
          switch (key) {
            case 'offline': return 'Offline';
            case 'gofood': return 'GoFood';
            case 'grabfood': return 'GrabFood';
            case 'shopeefood': return 'ShopeeFood';
            case 'qpon': return 'Qpon';
            case 'tiktok': return 'TikTok';
            default: return key.charAt(0).toUpperCase() + key.slice(1);
          }
        })
        .sort()
        .join(', ');

      return {
        product_id: group.product_id,
        product_name: group.product_name,
        product_code: group.product_code,
        transaction_type: group.transaction_type,
        platform: platformsStr, // Combined platforms as string
        total_quantity: group.total_quantity,
        total_subtotal: group.total_base_subtotal, // For compatibility
        customization_subtotal: 0, // Already excluded in base_subtotal
        base_subtotal: group.total_base_subtotal,
        base_unit_price: group.total_quantity > 0 ? group.total_base_subtotal / group.total_quantity : 0,
        is_bundle_item: group.is_bundle_item
      } as ProductSale;
    }).sort((a, b) => a.product_name.localeCompare(b.product_name));
  };

  // Helper function to recalculate Category II for printing (same logic as recalculateCategory2Breakdown)
  const recalculateCategory2ForPrint = async (
    products: ProductSale[],
    originalCategory2: Category2Breakdown[],
    electronAPI: ReturnType<typeof getElectronAPI>
  ): Promise<Category2Breakdown[]> => {
    if (!electronAPI?.localDbGetAllProducts || products.length === 0) {
      return [];
    }

    try {
      const allProducts = await electronAPI.localDbGetAllProducts();
      const productsArray = Array.isArray(allProducts) ? allProducts as Record<string, unknown>[] : [];
      
      const productToCategory2NameMap = new Map<number, string>();
      productsArray.forEach((p) => {
        const productId = typeof p.id === 'number' ? p.id : (typeof p.id === 'string' ? parseInt(p.id, 10) : null);
        const category2Name = typeof p.category2_name === 'string' ? p.category2_name : null;
        if (productId && category2Name) {
          productToCategory2NameMap.set(productId, category2Name);
        }
      });

      const category2NameToIdMap = new Map<string, number>();
      originalCategory2.forEach((cat) => {
        category2NameToIdMap.set(cat.category2_name, cat.category2_id);
      });

      const category2Map = new Map<string, { category2_id: number; category2_name: string; total_quantity: number; total_amount: number }>();

      products.forEach((product) => {
        if (product.is_bundle_item) return;
        const category2Name = productToCategory2NameMap.get(product.product_id);
        if (!category2Name) return;
        const category2Id = category2NameToIdMap.get(category2Name) || 0;
        const existing = category2Map.get(category2Name);
        if (existing) {
          existing.total_quantity += product.total_quantity;
          existing.total_amount += product.base_subtotal;
        } else {
          category2Map.set(category2Name, {
            category2_id: category2Id,
            category2_name: category2Name,
            total_quantity: product.total_quantity,
            total_amount: product.base_subtotal
          });
        }
      });

      return Array.from(category2Map.values())
        .map((data) => ({
          category2_id: data.category2_id,
          category2_name: data.category2_name,
          total_quantity: data.total_quantity,
          total_amount: data.total_amount
        }))
        .sort((a, b) => a.category2_name.localeCompare(b.category2_name));
    } catch (error) {
      console.error('[Print Category II Recalc] Error:', error);
      return [];
    }
  };

  const [selectedRefundTransaction, setSelectedRefundTransaction] = useState<{
    refund: RefundDetail;
    items: Array<{
      id: string;
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
    }>;
    note?: string | null;
    userName?: string;
  } | null>(null);
  // Removed isLoadingRefundDetails - not used in render

  // Date-time picker states for custom date range printing
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [startDateTime, setStartDateTime] = useState<string>('');
  const [endDateTime, setEndDateTime] = useState<string>('');
  const [isPrintingCustomRange, setIsPrintingCustomRange] = useState(false);

  // Print selection modal states
  const [showPrintSelectionModal, setShowPrintSelectionModal] = useState(false);
  const [printSelections, setPrintSelections] = useState<ShiftPrintSelection[]>([]);
  const [printWholeDaySelected, setPrintWholeDaySelected] = useState(false);
  const [isPrintingSelected, setIsPrintingSelected] = useState(false);
  const [showPrintOptions, setShowPrintOptions] = useState(false);
  const [printSectionOptions, setPrintSectionOptions] = useState({
    barangTerjual: true,
    paymentMethod: true,
    categoryII: true,
    toppingSales: true,
    diskonVoucher: true
  });
  const [ringkasanOnly, setRingkasanOnly] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);

  // Tab view states
  const [activeTab, setActiveTab] = useState<TabView>('all-day');
  // const [tabData, setTabData] = useState<Record<string, ReportDataPayload>>({});

  // Historical date viewing states
  const [viewMode, setViewMode] = useState<'current' | 'historical'>('current');
  const [selectedDate, setSelectedDate] = useState<string>(''); // Format: YYYY-MM-DD in GMT+7
  // const [historicalShifts, setHistoricalShifts] = useState<Shift[]>([]);

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

  // Load grouping setting on mount
  useEffect(() => {
    const loadGroupingSetting = async () => {
      const electronAPI = getElectronAPI();
      if (electronAPI?.localDbGetSetting) {
        try {
          const value = await electronAPI.localDbGetSetting('groupProducts');
          if (value === 'true') {
            setGroupProducts(true);
          }
        } catch (error) {
          console.error('Error loading grouping setting:', error);
        }
      }
    };
    loadGroupingSetting();
  }, []);

  // Save grouping setting when it changes
  const handleGroupProductsChange = async (value: boolean) => {
    setGroupProducts(value);
    const electronAPI = getElectronAPI();
    if (electronAPI?.localDbSaveSetting) {
      try {
        await electronAPI.localDbSaveSetting('groupProducts', value ? 'true' : 'false');
      } catch (error) {
        console.error('Error saving grouping setting:', error);
      }
    }
  };

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
        businessId
      );
      setTodayTransactionsInfo(info);
    } catch (error) {
      console.error('Error checking today transactions:', error);
    }
  }, [activeShift, businessId]);

  // Load statistics when shift changes
  useEffect(() => {
    if (activeShift) {
      loadStatistics();
      checkTodayTransactions();
    } else {
      // Reset stats when no active shift
      setStatistics({ order_count: 0, total_amount: 0, total_discount: 0, voucher_count: 0 });
      setPaymentBreakdown([]);
      setCategory2Breakdown([]);
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
      setRecalculatedCategory2Breakdown([]);
      setTodayTransactionsInfo(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeShift?.id, checkTodayTransactions]);

  // Function to recalculate Category II breakdown using base_subtotal
  const recalculateCategory2Breakdown = useCallback(async (products: ProductSale[], originalCategory2: Category2Breakdown[]) => {
    console.log('[Category II Recalc] Starting recalculation with', products.length, 'products');
    const electronAPI = getElectronAPI();
    if (!electronAPI?.localDbGetAllProducts || products.length === 0) {
      console.warn('[Category II Recalc] Cannot recalculate - no products or API unavailable');
      // Set empty array instead of using original data with wrong totals
      setRecalculatedCategory2Breakdown([]);
      return;
    }

    try {
      // Fetch all products to get category2_id mapping
      const allProducts = await electronAPI.localDbGetAllProducts();
      const productsArray = Array.isArray(allProducts) ? allProducts as Record<string, unknown>[] : [];
      console.log('[Category II Recalc] Fetched', productsArray.length, 'products from database');
      
      // Build map: product_id -> category2_name (localDbGetAllProducts returns category2_name but not category2_id)
      const productToCategory2NameMap = new Map<number, string>();

      productsArray.forEach((p) => {
        const productId = typeof p.id === 'number' ? p.id : (typeof p.id === 'string' ? parseInt(p.id, 10) : null);
        const category2Name = typeof p.category2_name === 'string' ? p.category2_name : null;

        if (productId && category2Name) {
          productToCategory2NameMap.set(productId, category2Name);
        }
      });

      // Build map: category2_name -> category2_id from originalCategory2 (to get the ID for final result)
      const category2NameToIdMap = new Map<string, number>();
      originalCategory2.forEach((cat) => {
        category2NameToIdMap.set(cat.category2_name, cat.category2_id);
      });

      // Group productSales by category2_name and sum base_subtotal (without customizations)
      const category2Map = new Map<string, { category2_id: number; category2_name: string; total_quantity: number; total_amount: number }>();

      products.forEach((product) => {
        if (product.is_bundle_item) return; // Skip bundle items

        const category2Name = productToCategory2NameMap.get(product.product_id);
        if (!category2Name) {
          return;
        }

        const category2Id = category2NameToIdMap.get(category2Name) || 0; // Get ID from originalCategory2, or use 0 as fallback
        const existing = category2Map.get(category2Name);
        if (existing) {
          existing.total_quantity += product.total_quantity;
          existing.total_amount += product.base_subtotal; // Use base_subtotal (without customizations)
        } else {
          category2Map.set(category2Name, {
            category2_id: category2Id,
            category2_name: category2Name,
            total_quantity: product.total_quantity,
            total_amount: product.base_subtotal // Use base_subtotal (without customizations)
          });
        }
      });

      // Convert to array and sort by category2_name
      const recalculated = Array.from(category2Map.values())
        .map((data) => ({
          category2_id: data.category2_id,
          category2_name: data.category2_name,
          total_quantity: data.total_quantity,
          total_amount: data.total_amount
        }))
        .sort((a, b) => a.category2_name.localeCompare(b.category2_name));
      console.log('[Category II Recalc] Recalculated totals:', recalculated);
      setRecalculatedCategory2Breakdown(recalculated);
    } catch (error) {
      console.error('[Category II Recalc] Error recalculating Category II:', error);
      // Set empty array on error (don't use original data with wrong totals)
      setRecalculatedCategory2Breakdown([]);
    }
  }, []);

  // Recalculate Category II breakdown when productSales or category2Breakdown changes
  useEffect(() => {
    if (productSales.length > 0 && category2Breakdown.length > 0) {
      console.log('[Category II Recalc] useEffect triggered - recalculating with', productSales.length, 'products');
      recalculateCategory2Breakdown(productSales, category2Breakdown);
    } else if (category2Breakdown.length > 0 && productSales.length === 0) {
      // Only use original data if we truly have no productSales data
      console.log('[Category II Recalc] No productSales data, using original category2Breakdown');
      setRecalculatedCategory2Breakdown(category2Breakdown);
    } else {
      // Clear if no data at all
      setRecalculatedCategory2Breakdown([]);
    }
  }, [productSales, category2Breakdown, recalculateCategory2Breakdown]);

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
        dayEndUtc: bounds.dayEndUtc,
        shifts: [activeShift]
      });
      return;
    }

    let isCancelled = false;

    const loadSequence = async () => {
      try {
        const response = await localDbGetShifts({
          businessId: businessId,
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
            dayEndUtc: bounds.dayEndUtc,
            shifts: sortedShifts
          });

          // Initialize print selections
          const selections: ShiftPrintSelection[] = sortedShifts.map((shift, idx) => ({
            shiftId: shift.id,
            shiftIndex: idx + 1,
            selected: false
          }));
          setPrintSelections(selections);
        }
      } catch (error) {
        console.error('Error determining shift sequence:', error);
        if (!isCancelled) {
          setShiftSequenceInfo({
            index: 1,
            total: 1,
            dayStartUtc: bounds.dayStartUtc,
            dayEndUtc: bounds.dayEndUtc,
            shifts: [activeShift]
          });
        }
      }
    };

    loadSequence();

    return () => {
      isCancelled = true;
    };
  }, [activeShift, businessId]);

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
      const response = await electronAPI.localDbGetActiveShift(currentUserId, businessId);
      const shift = response?.shift ?? null;
      setActiveShift(shift);
      setIsCurrentUsersShift(Boolean(shift && response?.isCurrentUserShift));
      setModalAwal(shift && response?.isCurrentUserShift ? shift.modal_awal.toString() : '');
      setError(null);
    } catch (error) {
      console.error('Error loading active shift:', error);
      setError('Gagal memuat shift aktif. Silakan refresh halaman.');
    }
  }, [currentUserId, businessId]);

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
      const [statsResult, breakdownResult, category2BreakdownResult, cashResult, productSalesResult, refundsResult] = await Promise.allSettled([
        electronAPI.localDbGetShiftStatistics
          ? electronAPI.localDbGetShiftStatistics(shiftOwnerId, activeShift.shift_start, activeShift.shift_end, businessId, activeShift.uuid_id)
          : Promise.resolve(defaultStats),
        electronAPI.localDbGetPaymentBreakdown
          ? electronAPI.localDbGetPaymentBreakdown(shiftOwnerId, activeShift.shift_start, activeShift.shift_end, businessId)
          : Promise.resolve<PaymentBreakdown[]>([]),
        electronAPI.localDbGetCategory2Breakdown
          ? electronAPI.localDbGetCategory2Breakdown(shiftOwnerId, activeShift.shift_start, activeShift.shift_end, businessId)
          : Promise.resolve<Category2Breakdown[]>([]),
        electronAPI.localDbGetCashSummary
          ? electronAPI.localDbGetCashSummary(shiftOwnerId, activeShift.shift_start, activeShift.shift_end, businessId, activeShift.uuid_id)
          : Promise.resolve(defaultCash),
        electronAPI.localDbGetProductSales
          ? electronAPI.localDbGetProductSales(shiftOwnerId, activeShift.shift_start, activeShift.shift_end, businessId)
          : Promise.resolve<ProductSalesPayload>({ products: [], customizations: [] }),
        electronAPI.localDbGetShiftRefunds
          ? electronAPI.localDbGetShiftRefunds({
              userId: shiftOwnerId,
              businessId: businessId,
              shiftUuid: activeShift.uuid_id,
              shiftStart: activeShift.shift_start,
              shiftEnd: activeShift.shift_end
            })
          : Promise.resolve<RefundDetail[]>([])
      ]);

      const stats =
        statsResult.status === 'fulfilled' ? (statsResult.value as ShiftStatistics) : defaultStats;
      const breakdown =
        breakdownResult.status === 'fulfilled'
          ? (breakdownResult.value as PaymentBreakdown[])
          : [];
      const category2BreakdownData =
        category2BreakdownResult.status === 'fulfilled'
          ? (category2BreakdownResult.value as Category2Breakdown[])
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
      setCategory2Breakdown(category2BreakdownData);
      setCashSummary(cash);
      setProductSales(productSalesData.products || []);
      setCustomizationSales(productSalesData.customizations || []);
      
      // Recalculate Category II totals using base_subtotal (without customizations)
      if (productSalesData.products && productSalesData.products.length > 0) {
        recalculateCategory2Breakdown(productSalesData.products, category2BreakdownData);
      } else {
        setRecalculatedCategory2Breakdown(category2BreakdownData);
      }
      
      const refundsData = refundsResult.status === 'fulfilled' ? (refundsResult.value as RefundDetail[]) : [];
      setRefunds(refundsData);

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
  }, [activeShift, businessId, recalculateCategory2Breakdown]);

  const handleRefundClick = useCallback(async (refund: RefundDetail) => {
    const electronAPI = getElectronAPI();
    if (!electronAPI) return;

    try {
      // Fetch transaction items (this already includes customizations via readCustomizationsFromNormalizedTables)
      const allItems = electronAPI.localDbGetTransactionItems
        ? await electronAPI.localDbGetTransactionItems(refund.transaction_uuid)
        : [];
      
      // Filter out cancelled items - they should not be included in refund calculations
      const items = (allItems as Array<Record<string, unknown>>).filter((item: Record<string, unknown>) => {
        const productionStatus = typeof item.production_status === 'string' ? item.production_status : null;
        return productionStatus !== 'cancelled';
      });

      // Map items - customizations are already attached by localDbGetTransactionItems
      const itemsWithCustomizations = (items as Array<Record<string, unknown>>).map((item: Record<string, unknown>) => {
        // Handle customizations - they're already in the item object
        const customizations = Array.isArray(item.customizations) 
          ? item.customizations 
          : (item.customizations ? [item.customizations] : []);

        return {
          id: String(item.uuid_id || item.id || ''),
          product_name: String(item.product_name || ''),
          quantity: typeof item.quantity === 'number' ? item.quantity : (typeof item.quantity === 'string' ? parseFloat(item.quantity) || 0 : 0),
          unit_price: typeof item.unit_price === 'number' ? item.unit_price : (typeof item.unit_price === 'string' ? parseFloat(item.unit_price) || 0 : 0),
          total_price: typeof item.total_price === 'number' ? item.total_price : (typeof item.total_price === 'string' ? parseFloat(item.total_price) || 0 : 0),
          custom_note: typeof item.custom_note === 'string' ? item.custom_note : undefined,
          customizations: customizations.length > 0 ? customizations : undefined,
          bundleSelections: item.bundleSelections || undefined
        };
      });

      // Fetch transaction note and user info if available
      const transactions = await electronAPI.localDbGetTransactions?.(businessId, 1000);
      const transaction = (transactions as Array<Record<string, unknown>>)?.find((t: Record<string, unknown>) => t.uuid_id === refund.transaction_uuid);
      const transactionNote = typeof transaction?.note === 'string' ? transaction.note : null;
      const transactionUserId = transaction?.user_id || null;
      const transactionUserName = transaction?.user_name || null;

      // If user_name not in transaction, fetch from users table
      let userName: string | null = typeof transactionUserName === 'string' ? transactionUserName : null;
      if (!userName && transactionUserId && electronAPI.localDbGetUsers) {
        const users = await electronAPI.localDbGetUsers();
        const user = (users as Array<Record<string, unknown>>)?.find((u: Record<string, unknown>) => u.id === transactionUserId);
        const userNameFromUser = typeof user?.name === 'string' ? user.name : (typeof user?.email === 'string' ? user.email : null);
        userName = userNameFromUser || `User ID: ${transactionUserId}`;
      }

      setSelectedRefundTransaction({
        refund,
        items: itemsWithCustomizations,
        note: transactionNote,
        userName: userName || 'Unknown'
      });
    } catch (error) {
      console.error('Error loading refund transaction details:', error);
    }
  }, [businessId]);

  const fetchReportPayload = useCallback(
    async ({ start, end, userId, businessId: reportBusinessId = businessId, shiftUuid, list_of_shifts }: { start: string; end: string | null; userId: number | null; businessId?: number; shiftUuid?: string | null; list_of_shifts?: Shift[]; }): Promise<ReportDataPayload> => {
      const electronAPI = getElectronAPI();
      if (!electronAPI) {
        throw new Error('Aplikasi Electron tidak terdeteksi.');
      }
      // Allow userId to be null for "all users" queries (All Day view)
      if (userId === undefined) {
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
        const [statsResult, breakdownResult, category2BreakdownResult, cashResult, productSalesResult] = await Promise.allSettled([
          electronAPI.localDbGetShiftStatistics
            ? electronAPI.localDbGetShiftStatistics(userId, start, end, reportBusinessId)
            : Promise.resolve(defaultStats),
          electronAPI.localDbGetPaymentBreakdown
            ? electronAPI.localDbGetPaymentBreakdown(userId, start, end, reportBusinessId)
            : Promise.resolve<PaymentBreakdown[]>([]),
          electronAPI.localDbGetCategory2Breakdown
            ? electronAPI.localDbGetCategory2Breakdown(userId, start, end, reportBusinessId)
            : Promise.resolve<Category2Breakdown[]>([]),
          electronAPI.localDbGetCashSummary
            ? electronAPI.localDbGetCashSummary(userId, start, end, reportBusinessId, shiftUuid)
            : Promise.resolve(defaultCash),
          electronAPI.localDbGetProductSales
            ? electronAPI.localDbGetProductSales(userId, start, end, reportBusinessId)
            : Promise.resolve<ProductSalesPayload>({ products: [], customizations: [] })
        ]);

        const statsPayload = statsResult.status === 'fulfilled' ? (statsResult.value as ShiftStatistics) : defaultStats;
        const breakdownPayload =
          breakdownResult.status === 'fulfilled' ? (breakdownResult.value as PaymentBreakdown[]) : [];
        const category2BreakdownPayload =
          category2BreakdownResult.status === 'fulfilled' ? (category2BreakdownResult.value as Category2Breakdown[]) : [];const rawCash = cashResult.status === 'fulfilled' ? (cashResult.value as CashSummary) : defaultCash;
        const productSalesPayload =
          productSalesResult.status === 'fulfilled'
            ? (productSalesResult.value as ProductSalesPayload)
            : { products: [], customizations: [] };

        // If list_of_shifts is provided, sum up total_discount from individual shifts
        // This fixes the double-counting issue when shifts overlap in time
        let finalTotalDiscount = statsPayload.total_discount ?? 0;
        if (list_of_shifts && list_of_shifts.length > 0 && electronAPI.localDbGetShiftStatistics) {
          // Fetch all shift statistics in parallel for better performance
          const shiftStatsPromises = list_of_shifts.map(async (shift) => {
            const shiftUserId = Number(shift.user_id ?? 0);
            if (!shiftUserId || !electronAPI.localDbGetShiftStatistics) return null;
            try {
              return await electronAPI.localDbGetShiftStatistics(
                shiftUserId,
                shift.shift_start,
                shift.shift_end,
                reportBusinessId,
                shift.uuid_id
              );
            } catch (error) {
              console.error(`Error fetching discount for shift ${shift.id}:`, error);
              return null;
            }
          });
          
          const shiftStatsResults = await Promise.all(shiftStatsPromises);
          const summedDiscount = shiftStatsResults.reduce((sum, stats) => {
            return sum + (stats?.total_discount ?? 0);
          }, 0);
          finalTotalDiscount = summedDiscount;
        }

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
            total_discount: finalTotalDiscount,
            voucher_count: statsPayload.voucher_count ?? 0
          },
          paymentBreakdown: breakdownPayload,
          category2Breakdown: category2BreakdownPayload,
          cashSummary: resolvedCash,
          productSales: productSalesPayload.products || [],
          customizationSales: productSalesPayload.customizations || []
        };
      } catch (error) {
        console.error('Error fetching report payload:', error);
        throw error;
      }
    },
    [businessId]
  );

  const handleStartShift = async () => {
    if (!user?.id || !user?.name) {
      setError('User tidak ditemukan. Silakan login ulang.');
      return;
    }

    const electronAPI = getElectronAPI();

    // Check if there's already an active shift (double-check)
    try {
      const existingResponse = await electronAPI?.localDbGetActiveShift?.(currentUserId, businessId);
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
        business_id: businessId,
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
        setCategory2Breakdown([]);
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
    if (viewMode === 'historical' && selectedDate) {
      loadHistoricalShifts(selectedDate);
    } else if (activeShift) {
      loadStatistics();
      checkTodayTransactions();
    } else {
      loadActiveShift();
    }
  };

  // Get today's date in GMT+7 format (YYYY-MM-DD)
  const getTodayGmt7 = (): string => {
    const now = new Date();
    const gmt7Date = new Date(now.getTime() + (7 * 60 * 60 * 1000));
    const year = gmt7Date.getUTCFullYear();
    const month = String(gmt7Date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(gmt7Date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Load shifts for a specific date
  const loadHistoricalShifts = useCallback(async (dateStr: string) => {
    const electronAPI = getElectronAPI();
    if (!electronAPI?.localDbGetShifts) {
      setError('Fitur melihat shift historis belum tersedia. Silakan restart aplikasi.');
      return;
    }

    try {
      setIsRefreshing(true);
      setError(null);

      // Parse the date string (YYYY-MM-DD) and get day bounds in GMT+7
      const [year, month, day] = dateStr.split('-').map(Number);
      const gmt7Offset = 7 * 60 * 60 * 1000;

      // Create start and end of day in GMT+7
      const dayStartGmt7 = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
      const dayEndGmt7 = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));

      // Convert to UTC for database query
      const dayStartUtc = new Date(dayStartGmt7.getTime() - gmt7Offset).toISOString();
      const dayEndUtc = new Date(dayEndGmt7.getTime() - gmt7Offset).toISOString();

      const result = await electronAPI.localDbGetShifts({
        businessId: businessId,
        startDate: dayStartUtc,
        endDate: dayEndUtc
      });

      const shifts = result?.shifts || [];
      // setHistoricalShifts(shifts as Shift[]);

      if (shifts && shifts.length > 0) {
        // Create shift sequence info for historical view
        const shiftSeqInfo: ShiftSequenceInfo = {
          index: 0,
          total: shifts.length,
          dayStartUtc: dayStartUtc,
          dayEndUtc: dayEndUtc,
          shifts: shifts as Shift[]
        };
        setShiftSequenceInfo(shiftSeqInfo);

        // Load statistics for the first shift by default
        if (shifts[0]) {
          setActiveShift(shifts[0] as Shift);
          setActiveTab((shifts[0] as Shift).id);
        }
      } else {
        setShiftSequenceInfo(null);
        setActiveShift(null);
        setError(`Tidak ada shift ditemukan untuk tanggal ${dateStr}`);
      }
    } catch (error) {
      console.error('Error loading historical shifts:', error);
      setError('Gagal memuat shift historis. Silakan coba lagi.');
    } finally {
      setIsRefreshing(false);
    }
  }, [businessId]);

  // Handle date selection change
  const handleDateChange = (dateStr: string) => {
    setSelectedDate(dateStr);
    setViewMode('historical');
    loadHistoricalShifts(dateStr);
  };

  // Switch back to current/active shift view
  const handleBackToCurrent = () => {
    setViewMode('current');
    setSelectedDate('');
    // setHistoricalShifts([]);
    loadActiveShift();
  };

  const handlePrintAll = async () => {
    const electronAPI = getElectronAPI();
    if (!activeShift || !electronAPI?.printShiftBreakdown) {
      setError('Fitur print belum tersedia. Silakan restart aplikasi.');
      return;
    }

    if (!shiftSequenceInfo) {
      setError('Data shift belum tersedia. Silakan refresh halaman.');
      return;
    }

    // Show print selection modal
    setShowPrintSelectionModal(true);
  };

  const handlePrintSelected = async () => {
    const electronAPI = getElectronAPI();
    if (!activeShift || !electronAPI?.printShiftBreakdown || !shiftSequenceInfo) {
      setError('Fitur print belum tersedia. Silakan restart aplikasi.');
      return;
    }

    // Validate that at least one item is selected
    const selectedShifts = printSelections.filter(s => s.selected);
    if (!printWholeDaySelected && selectedShifts.length === 0) {
      setError('Silakan pilih setidaknya satu laporan untuk dicetak.');
      return;
    }

    // Check if any printer is configured
    const printerConfigs = await electronAPI.localDbGetPrinterConfigs?.();
    const hasReceiptPrinter = Array.isArray(printerConfigs) && printerConfigs.some((config) => {
      const cfg = config as { printer_type?: string; system_printer_name?: string };
      return cfg.printer_type === 'receiptPrinter' && cfg.system_printer_name;
    });

    if (!hasReceiptPrinter) {
      setError('⚠️ Receipt Printer belum dikonfigurasi! Silakan konfigurasi printer di menu Settings → Printer Selector terlebih dahulu.');
      return;
    }

    setIsPrintingSelected(true);
    setError(null);
    setShowPrintSelectionModal(false);

    try {
      const shiftOwnerId = Number(activeShift.user_id ?? 0);
      if (!shiftOwnerId) {
        throw new Error('User ID tidak valid');
      }

      console.log('🖨️ Starting print job for selected shifts...');

      // Print whole day if selected
      if (printWholeDaySelected) {
        try {
          console.log('📊 [PRINT WHOLE DAY] Starting...');
          
          // Use TODAY's date bounds (same as "All Day" tab), not the active shift's date
          const today = new Date();
          const todayStr = today.toISOString().split('T')[0]; // YYYY-MM-DD format
          const todayBounds = getGmt7DayBounds(todayStr);
          
          if (!todayBounds) {
            throw new Error('Failed to calculate today bounds for print');
          }
          
          console.log('   Day range (TODAY):', todayBounds.dayStartUtc, 'to', todayBounds.dayEndUtc);

          // Get shifts for today first (before fetching report data)
          const electronAPIForShifts = getElectronAPI();
          let todayShiftsForReport: Shift[] = [];
          
          if (electronAPIForShifts?.localDbGetShifts) {
            const shiftsResult = await electronAPIForShifts.localDbGetShifts({
              businessId: businessId,
              startDate: todayBounds.dayStartUtc,
              endDate: todayBounds.dayEndUtc
            });
            todayShiftsForReport = (shiftsResult?.shifts || []) as Shift[];
          } else {
            // Fallback to shiftSequenceInfo if API not available
            todayShiftsForReport = shiftSequenceInfo.shifts;
          }

          const dayReportData = await fetchReportPayload({
            start: todayBounds.dayStartUtc, // Use TODAY's date bounds
            end: todayBounds.dayEndUtc,
            userId: null, // null = all users for whole day report
            list_of_shifts: todayShiftsForReport // Pass TODAY's shifts to sum up discounts correctly
          });

          console.log('📊 [PRINT WHOLE DAY] Data fetched:', {
            orders: dayReportData.statistics.order_count,
            total: dayReportData.statistics.total_amount,
            products: dayReportData.productSales.length
          });const dayCash = dayReportData.cashSummary;
          const dayCashSales = dayCash.cash_shift_sales ?? dayCash.cash_shift ?? 0;
          const dayCashRefunds = dayCash.cash_shift_refunds ?? 0;
          // const dailyKasExpected = (dayCash.cash_whole_day ?? dayCash.cash_shift ?? 0) || dayCashSales - dayCashRefunds;

          // Get modal awal from today's shifts
          let modalAwalWholeDay = 0;
          if (todayShiftsForReport.length > 0) {
            modalAwalWholeDay = todayShiftsForReport[0].modal_awal || 0;
          }

          // Group products and recalculate Category II for print (only if setting is enabled)
          const productsForPrint = groupProducts 
            ? groupProductSalesForPrint(dayReportData.productSales)
            : dayReportData.productSales;
          const recalculatedCategory2 = await recalculateCategory2ForPrint(
            dayReportData.productSales,
            dayReportData.category2Breakdown || [],
            electronAPI
          );

          console.log('🖨️ [PRINT WHOLE DAY] Sending to printer...');

          // Debug logging
          fetch('http://127.0.0.1:7242/ingest/7b565785-72b5-49f7-b2c0-57606ea0d0b5',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'GantiShift.tsx:1584',message:'Print whole day - sectionOptions',data:printSectionOptions,timestamp:Date.now(),sessionId:'debug-session',runId:'pre-fix',hypothesisId:'B'})}).catch(()=>{});
          
          const result = await electronAPI.printShiftBreakdown({
            user_name: 'Semua Shift',
            shift_start: todayBounds.dayStartUtc,
            shift_end: todayBounds.dayEndUtc,
            modal_awal: modalAwalWholeDay,
            statistics: dayReportData.statistics,
            productSales: productsForPrint,
            customizationSales: dayReportData.customizationSales,
            paymentBreakdown: dayReportData.paymentBreakdown.map(p => ({
              payment_method_name: p.payment_method_name || p.payment_method_code,
              transaction_count: p.transaction_count,
              total_amount: p.total_amount || 0
            })),
            category2Breakdown: recalculatedCategory2,
            cashSummary: {
              cash_shift: dayCash.cash_shift ?? 0,
              cash_shift_sales: dayCashSales,
              cash_shift_refunds: dayCashRefunds,
              cash_whole_day: dayCash.cash_whole_day ?? 0,
              cash_whole_day_sales: dayCash.cash_whole_day_sales ?? dayCash.cash_whole_day ?? 0,
              cash_whole_day_refunds: dayCash.cash_whole_day_refunds ?? 0,
              total_cash_in_cashier: modalAwalWholeDay + dayCashSales - dayCashRefunds,
              kas_mulai: modalAwalWholeDay,
              kas_expected: modalAwalWholeDay + dayCashSales - dayCashRefunds,
              kas_akhir: null,
              kas_selisih: null,
              kas_selisih_label: null
            },
            business_id: businessId,
            printerType: 'receiptPrinter',
            sectionOptions: printSectionOptions
          });

          console.log('📄 [PRINT WHOLE DAY] Result:', result);

          if (!result.success) {
            console.error('❌ [PRINT WHOLE DAY] Failed:', result.error);
            throw new Error(result.error || 'Gagal mencetak laporan harian');
          }

          console.log('✅ [PRINT WHOLE DAY] Success!');

          // Small delay between prints
          await new Promise(r => setTimeout(r, 500));
        } catch (error) {
          console.error('Error printing whole day report:', error);
          throw error;
        }
      }

      // Print selected individual shifts
      console.log(`📋 [PRINT SHIFTS] Printing ${selectedShifts.length} individual shift(s)...`);

      for (const selection of selectedShifts) {
        const shift = shiftSequenceInfo.shifts.find(s => s.id === selection.shiftId);
        if (!shift) continue;

        try {
          console.log(`🖨️ [PRINT SHIFT ${selection.shiftIndex}] Starting - ${shift.user_name}`);

          const shiftUserId = Number(shift.user_id ?? 0);
          const shiftReportData = await fetchReportPayload({
            start: shift.shift_start,
            end: shift.shift_end,
            userId: shiftUserId
          });

          console.log(`📊 [PRINT SHIFT ${selection.shiftIndex}] Data:`, {
            orders: shiftReportData.statistics.order_count,
            total: shiftReportData.statistics.total_amount
          });

          const shiftCash = shiftReportData.cashSummary;
          const shiftCashSales = shiftCash.cash_shift_sales ?? shiftCash.cash_shift ?? 0;
          const shiftCashRefunds = shiftCash.cash_shift_refunds ?? 0;
          const shiftKasExpected = shift.modal_awal + shiftCashSales - shiftCashRefunds;

          // Group products and recalculate Category II for print (only if setting is enabled)
          const productsForPrint = groupProducts 
            ? groupProductSalesForPrint(shiftReportData.productSales)
            : shiftReportData.productSales;
          const recalculatedCategory2 = await recalculateCategory2ForPrint(
            shiftReportData.productSales,
            shiftReportData.category2Breakdown || [],
            electronAPI
          );

          console.log(`🖨️ [PRINT SHIFT ${selection.shiftIndex}] Sending to printer...`);

          const result = await electronAPI.printShiftBreakdown({
            user_name: shift.user_name,
            shift_start: shift.shift_start,
            shift_end: shift.shift_end,
            modal_awal: shift.modal_awal,
            statistics: shiftReportData.statistics,
            productSales: productsForPrint,
            customizationSales: shiftReportData.customizationSales,
            paymentBreakdown: shiftReportData.paymentBreakdown.map(p => ({
              payment_method_name: p.payment_method_name || p.payment_method_code,
              transaction_count: p.transaction_count,
              total_amount: p.total_amount || 0
            })),
            category2Breakdown: recalculatedCategory2,
            cashSummary: {
              cash_shift: shiftCash.cash_shift ?? 0,
              cash_shift_sales: shiftCashSales,
              cash_shift_refunds: shiftCashRefunds,
              cash_whole_day: shiftCash.cash_whole_day ?? 0,
              cash_whole_day_sales: shiftCash.cash_whole_day_sales ?? shiftCash.cash_whole_day ?? 0,
              cash_whole_day_refunds: shiftCash.cash_whole_day_refunds ?? 0,
              total_cash_in_cashier: shiftKasExpected,
              kas_mulai: shift.modal_awal,
              kas_expected: shiftKasExpected,
              kas_akhir: shift.kas_akhir ?? null,
              kas_selisih: shift.kas_selisih ?? null,
              kas_selisih_label: shift.kas_selisih_label ?? null
            },
            business_id: businessId,
            printerType: 'receiptPrinter',
            sectionOptions: printSectionOptions
          });

          console.log(`📄 [PRINT SHIFT ${selection.shiftIndex}] Result:`, result);

          if (!result.success) {
            console.error(`❌ [PRINT SHIFT ${selection.shiftIndex}] Failed:`, result.error);
            throw new Error(result.error || `Gagal mencetak laporan Shift ${selection.shiftIndex}`);
          }

          console.log(`✅ [PRINT SHIFT ${selection.shiftIndex}] Success!`);

          // Small delay between prints
          await new Promise(r => setTimeout(r, 500));
        } catch (error) {
          console.error(`Error printing shift ${selection.shiftIndex}:`, error);
          throw error;
        }
      }

      const printCount = (printWholeDaySelected ? 1 : 0) + selectedShifts.length;
      setSuccessMessage(`${printCount} laporan berhasil dicetak!`);
    } catch (error) {
      console.error('Error printing selected reports:', error);
      const message = error instanceof Error ? error.message : 'Gagal mencetak laporan. Silakan coba lagi.';
      setError(message);
    } finally {
      setIsPrintingSelected(false);
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

      // Group products and recalculate Category II for print (only if setting is enabled)
      const productsForPrint = groupProducts 
        ? groupProductSalesForPrint(reportData.productSales)
        : reportData.productSales;
      const recalculatedCategory2 = await recalculateCategory2ForPrint(
        reportData.productSales,
        reportData.category2Breakdown || [],
        electronAPI
      );

      const result = await electronAPI.printShiftBreakdown({
        user_name: user?.name || activeShift?.user_name || 'Cashier',
        shift_start: startDateTime,
        shift_end: endDateTime,
        modal_awal: modalAwalForCustom,
        statistics: reportData.statistics,
        productSales: productsForPrint,
        customizationSales: reportData.customizationSales,
        paymentBreakdown: reportData.paymentBreakdown.map((p) => ({
          payment_method_name: p.payment_method_name || p.payment_method_code,
          transaction_count: p.transaction_count,
          total_amount: p.total_amount || 0
        })),
        category2Breakdown: recalculatedCategory2,
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
        business_id: businessId,
        printerType: 'receiptPrinter',
        sectionOptions: printSectionOptions
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

  // Load data for a specific tab
  const loadTabData = useCallback(async (tabView: TabView) => {
    if (!shiftSequenceInfo) return;

    const electronAPI = getElectronAPI();
    if (!electronAPI) return;
    setIsLoadingTabData(true);
    try {
      if (tabView === 'all-day') {
        // Load whole day data
        const shiftOwnerId = Number(activeShift?.user_id ?? 0);
        if (!shiftOwnerId) {
          setIsLoadingTabData(false);
          return;
        }

        // For "All Day" tab, use TODAY's date, not the active shift's date
        // The active shift might be from a previous day, but "All Day" should show current day
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0]; // YYYY-MM-DD format
        const todayBounds = getGmt7DayBounds(todayStr);
        
        if (!todayBounds) {
          console.error('[All Day Tab] Failed to calculate today bounds');
          setIsLoadingTabData(false);
          return;
        }

        console.log('[All Day Tab] Loading data for all shifts:', {
          dayStart: todayBounds.dayStartUtc,
          dayEnd: todayBounds.dayEndUtc,
          shiftsCount: shiftSequenceInfo.shifts.length,
          usingToday: true,
          todayDate: todayStr
        });

        const dayData = await fetchReportPayload({
          start: todayBounds.dayStartUtc,
          end: todayBounds.dayEndUtc,
          userId: null, // null = all users for whole day report
          list_of_shifts: shiftSequenceInfo.shifts // Pass shifts to sum up discounts correctly
        });

        console.log('[All Day Tab] Data loaded:', {
          orderCount: dayData.statistics.order_count,
          totalAmount: dayData.statistics.total_amount,
          productSalesCount: dayData.productSales.length
        });

        // setTabData(prev => ({ ...prev, 'all-day': dayData }));
        setStatistics(dayData.statistics);
        setPaymentBreakdown(dayData.paymentBreakdown);
        setCategory2Breakdown(dayData.category2Breakdown);
        setCashSummary(dayData.cashSummary);
        setProductSales(dayData.productSales);
        setCustomizationSales(dayData.customizationSales);
      } else {
        // Load specific shift data
        const shift = shiftSequenceInfo.shifts.find(s => s.id === tabView);
        if (!shift) {
          setIsLoadingTabData(false);
          return;
        }

        const shiftUserId = Number(shift.user_id ?? 0);
        if (!shiftUserId) {
          setIsLoadingTabData(false);
          return;
        }

        const shiftData = await fetchReportPayload({
          start: shift.shift_start,
          end: shift.shift_end,
          userId: shiftUserId,
          shiftUuid: shift.uuid_id
        });

        // setTabData(prev => ({ ...prev, [tabView]: shiftData }));
        setStatistics(shiftData.statistics);
        setPaymentBreakdown(shiftData.paymentBreakdown);
        setCategory2Breakdown(shiftData.category2Breakdown);
        setCashSummary(shiftData.cashSummary);
        setProductSales(shiftData.productSales);
        setCustomizationSales(shiftData.customizationSales);
      }
    } catch (error) {
      console.error(`Error loading tab data for ${tabView}:`, error);
    } finally {
      setIsLoadingTabData(false);
    }
  }, [shiftSequenceInfo, activeShift, fetchReportPayload]);

  // Load tab data when active tab changes
  useEffect(() => {
    if (activeShift && shiftSequenceInfo) {
      loadTabData(activeTab);
    }
  }, [activeTab, activeShift, shiftSequenceInfo, loadTabData]);

  const handleTabChange = (tab: TabView) => {
    setActiveTab(tab);
  };

  const handleMigrateTodayTransactions = async () => {
    if (!activeShift || !todayTransactionsInfo?.earliestTime) return;

    if (!canManageActiveShift) {
      setError('Anda tidak memiliki izin untuk memigrasikan transaksi ke shift ini.');
      return;
    }

    const confirmed = window.confirm(
      `Migrasikan ${todayTransactionsInfo.count} transaksi hari ini ke shift ini?\n\n` +
      `Shift start akan diubah dari ${formatDateTime(activeShift.shift_start)} menjadi ${formatDateTime(todayTransactionsInfo.earliestTime)}.\n\n` +
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

  // Cash reconciliation helpers - based on active tab
  // Convert string values to numbers (MySQL returns decimal as strings)
  const cashShiftSales = Number(cashSummary.cash_shift_sales ?? cashSummary.cash_shift ?? 0) || 0;
  const cashShiftRefunds = Number(cashSummary.cash_shift_refunds ?? 0) || 0;
  const cashWholeDaySales = Number(cashSummary.cash_whole_day_sales ?? cashSummary.cash_whole_day ?? 0) || 0;
  const cashWholeDayRefunds = Number(cashSummary.cash_whole_day_refunds ?? 0) || 0;
  const cashNetShift = cashShiftSales - cashShiftRefunds;
  const cashNetWholeDay = cashWholeDaySales - cashWholeDayRefunds;

  // Get the correct modal awal based on active tab
  let kasMulaiActive = 0;
  let kasAkhirActive: number | null = null;
  let kasSelisihValue: number | null = null;
  let kasSelisihLabelValue: 'balanced' | 'plus' | 'minus' | null = null;

  if (activeTab === 'all-day') {
    // For all-day view, use the first shift's modal awal
    kasMulaiActive = Number(shiftSequenceInfo?.shifts[0]?.modal_awal ?? 0) || 0;
  } else {
    // For individual shift view
    const displayShift = shiftSequenceInfo?.shifts.find(s => s.id === activeTab) || activeShift;
    kasMulaiActive = Number(displayShift?.modal_awal ?? 0) || 0;
    kasAkhirActive = displayShift?.kas_akhir !== null && displayShift?.kas_akhir !== undefined ? Number(displayShift.kas_akhir) : null;

    if (kasAkhirActive !== null) {
      const kasExpectedForShift = kasMulaiActive + cashShiftSales - cashShiftRefunds;
      const delta = Number((kasAkhirActive - kasExpectedForShift).toFixed(2));
      if (Math.abs(delta) < 0.01) {
        kasSelisihValue = 0;
        kasSelisihLabelValue = 'balanced';
      } else {
        kasSelisihValue = delta;
        kasSelisihLabelValue = delta > 0 ? 'plus' : 'minus';
      }
    } else if (displayShift && typeof displayShift.kas_selisih === 'number') {
      kasSelisihValue = displayShift.kas_selisih;
      kasSelisihLabelValue = displayShift.kas_selisih_label ?? null;
    }
  }

  // Ensure all values are numbers for calculation
  const kasMulaiActiveNum = Number(kasMulaiActive) || 0;
  const kasExpectedActive = kasMulaiActiveNum + cashShiftSales - cashShiftRefunds;
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
      <div className="bg-white border-b border-gray-200 px-6 py-1">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          {/* Left Side - Title Column with 2 rows */}
          <div className="flex flex-col gap-0.5 items-center">
            <h1 className="text-lg font-bold text-gray-800">Ganti Shift</h1>
            <button
              onClick={() => setShowSettingsModal(true)}
              className="flex items-center space-x-1.5 px-2 py-1 text-xs font-medium text-gray-700 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg transition-all shadow-sm hover:shadow w-fit"
              title="Pengaturan"
            >
              <Settings className="w-3.5 h-3.5" />
              <span>Pengaturan</span>
            </button>
          </div>
          
          {/* Right Side - Control Panel */}
          <div className="flex items-center gap-3 flex-wrap">
            {/* Date Picker Section */}
            <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg">
              {!selectedDate && viewMode === 'current' ? (
                <span className="text-xs font-medium text-gray-700">Hari Ini</span>
              ) : null}
              <input
                type="date"
                value={selectedDate}
                max={getTodayGmt7()}
                onChange={(e) => handleDateChange(e.target.value)}
                className="px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 bg-white text-xs"
              />
              {viewMode === 'historical' && (
                <button
                  onClick={handleBackToCurrent}
                  className="px-3 py-1 bg-yellow-500 text-white rounded hover:bg-yellow-600 transition-colors text-[11px] font-medium"
                >
                  Kembali ke Shift Aktif
                </button>
              )}
            </div>

            {/* Action Buttons Group */}
            {activeShift && (
              <div className="flex items-center gap-2 pl-3 border-l border-gray-300">
                <button
                  onClick={handlePrintAll}
                  className="flex items-center space-x-2 px-3.5 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-all shadow-sm hover:shadow text-xs font-medium"
                >
                  <Printer className="w-4 h-4" />
                  <span>Print All</span>
                </button>
                {viewMode === 'current' && isCurrentUsersShift ? (
                  <button
                    onClick={handleEndShiftClick}
                    disabled={isEndingShift}
                    className="flex items-center justify-center space-x-2 px-3.5 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-xs font-semibold transition-all shadow-sm hover:shadow"
                  >
                    <StopCircle className="w-4.5 h-4.5" />
                    <span>{isEndingShift ? 'Mengakhiri Shift...' : 'End Shift'}</span>
                  </button>
                ) : viewMode === 'current' && canForceCloseShift ? (
                  <button
                    onClick={handleForceCloseClick}
                    disabled={isEndingShift}
                    className="flex items-center justify-center space-x-2 px-3.5 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed text-xs font-semibold transition-all shadow-sm hover:shadow"
                  >
                    <StopCircle className="w-4.5 h-4.5" />
                    <span>{isEndingShift ? 'Menutup Shift...' : 'Force Close Shift'}</span>
                  </button>
                ) : viewMode === 'current' ? (
                  <div className="px-3.5 py-2 bg-yellow-100 text-yellow-900 rounded-lg text-xs font-semibold flex items-center justify-center border border-yellow-200">
                    Shift aktif oleh {activeShift.user_name}
                  </div>
                ) : null}
                {viewMode === 'current' && (
                  <button
                    onClick={handleRefresh}
                    disabled={isRefreshing}
                    className="flex items-center justify-center w-9 h-9 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm hover:shadow"
                    title="Refresh"
                  >
                    <RefreshCw className={`w-4.5 h-4.5 ${isRefreshing ? 'animate-spin' : ''}`} />
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
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

      {activeShift && viewMode === 'current' && !isCurrentUsersShift && !canForceCloseShift && (
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

      {activeShift && viewMode === 'current' && !isCurrentUsersShift && canForceCloseShift && (
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
          {/* STATE 1: No Active Shift (Only show in current mode) */}
          {!activeShift && viewMode === 'current' && (
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
              {/* Migration Banner - only show in current mode */}
              {viewMode === 'current' && todayTransactionsInfo?.hasTransactions && (
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

              {/* Tabs for different shift views */}
              {shiftSequenceInfo && shiftSequenceInfo.shifts.length > 0 && (
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                  {/* Tab buttons */}
                  <div className="flex items-center border-b border-gray-200 overflow-x-auto">
                    {/* All Day Tab */}
                    <button
                      onClick={() => handleTabChange('all-day')}
                      className={`px-6 py-3 font-medium transition-all whitespace-nowrap relative ${activeTab === 'all-day'
                        ? 'text-blue-600 bg-blue-50 border-b-2 border-blue-600'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                        }`}
                    >
                      All Day
                    </button>

                    {/* Individual Shift Tabs */}
                    {shiftSequenceInfo.shifts.map((shift, idx) => (
                      <button
                        key={shift.id}
                        onClick={() => handleTabChange(shift.id)}
                        className={`px-6 py-3 font-medium transition-all whitespace-nowrap relative ${activeTab === shift.id
                          ? 'text-green-600 bg-green-50 border-b-2 border-green-600'
                          : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                          }`}
                      >
                        Shift {idx + 1}
                        {shift.status === 'active' && (
                          <span className="ml-2 inline-flex items-center">
                            <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                          </span>
                        )}
                      </button>
                    ))}
                  </div>

                  {/* Shift Info and Modal Awal row below tabs */}
                  <div className="flex items-center gap-6 px-6 py-3 bg-gray-50">
                    {/* Shift Info */}
                    {activeTab === 'all-day' ? (
                      <>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-600">Period:</span>
                          <span className="text-sm font-medium text-black">All Day</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-600">Shifts:</span>
                          <span className="text-sm font-medium text-black">{shiftSequenceInfo?.total || 0} shift(s)</span>
                        </div>
                      </>
                    ) : (
                      (() => {
                        const displayShift = shiftSequenceInfo?.shifts.find(s => s.id === activeTab) || activeShift;
                        return (
                          <>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-600">Cashier:</span>
                              <span className="text-sm font-medium text-black">{displayShift.user_name}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-600">Started:</span>
                              <span className="text-sm font-medium text-black">{formatDateTime(displayShift.shift_start)}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-600">Ended:</span>
                              <span className="text-sm font-medium text-black">
                                {displayShift.shift_end ? formatDateTime(displayShift.shift_end) : (
                                  <span className="inline-flex items-center text-green-600 text-xs">
                                    <span className="w-1.5 h-1.5 bg-green-500 rounded-full mr-1 animate-pulse"></span>
                                    Active
                                  </span>
                                )}
                              </span>
                            </div>
                          </>
                        );
                      })()
                    )}

                    {/* Modal Awal */}
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-600">Modal Awal:</span>
                      <span className="text-sm font-medium text-black">
                        {activeTab === 'all-day'
                          ? formatRupiah(shiftSequenceInfo?.shifts[0]?.modal_awal || 0)
                          : formatRupiah((shiftSequenceInfo?.shifts.find(s => s.id === activeTab) || activeShift).modal_awal)}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Loading Indicator for Tab Data */}
              {isLoadingTabData && (
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12">
                  <div className="flex flex-col items-center justify-center">
                    <Loader2 className="w-8 h-8 text-blue-600 animate-spin mb-4" />
                    <p className="text-gray-600 text-sm">
                      {activeTab === 'all-day' ? 'Memuat data seluruh hari...' : 'Memuat data shift...'}
                    </p>
                  </div>
                </div>
              )}

              {/* RINGKASAN (Final Summary) */}
              {!isLoadingTabData && (
                <>
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <h2 className="text-xl font-semibold text-gray-800 mb-3 text-center">RINGKASAN</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Left Column - Transaction Summary */}
                  <div className="space-y-0">
                    <h3 className="text-xs font-semibold text-gray-700 mb-2 pb-1 border-b border-gray-300">Transaksi</h3>
                    <div className="flex items-center py-0.5">
                      <span className="text-xs text-gray-700">Total Pesanan:</span>
                      <span className="flex-grow border-b border-dotted border-gray-300 mx-2"></span>
                      <span className="text-xs font-semibold text-gray-900">{statistics.order_count} transaksi</span>
                    </div>
                    <div className="flex items-center py-0.5">
                      <span className="text-xs text-gray-700">Total Transaksi:</span>
                      <span className="flex-grow border-b border-dotted border-gray-300 mx-2"></span>
                      <span className="text-xs font-semibold text-gray-900">{formatRupiah(statistics.total_amount)}</span>
                    </div>
                    <div className="flex items-center py-0.5">
                      <span className="text-xs text-gray-700">Total Topping:</span>
                      <span className="flex-grow border-b border-dotted border-gray-300 mx-2"></span>
                      <span className="text-xs font-semibold text-gray-900">
                        {formatRupiah(customizationSales.reduce((sum, c) => sum + c.total_revenue, 0))}
                      </span>
                    </div>
                    <div className="flex items-center py-0.5">
                      <span className="text-xs text-gray-700">Voucher Dipakai:</span>
                      <span className="flex-grow border-b border-dotted border-gray-300 mx-2"></span>
                      <span className="text-xs font-semibold text-gray-900">{statistics.voucher_count} transaksi</span>
                    </div>
                    <div className="flex items-center py-0.5">
                      <span className="text-xs text-gray-700">Total Diskon Voucher:</span>
                      <span className="flex-grow border-b border-dotted border-gray-300 mx-2"></span>
                      <span className="text-xs font-semibold text-green-600">
                        {statistics.total_discount > 0 ? formatRupiah(-statistics.total_discount) : formatRupiah(0)}
                      </span>
                    </div>
                  </div>

                  {/* Right Column - Cash Summary */}
                  <div className="space-y-0">
                    <h3 className="text-xs font-semibold text-gray-700 mb-2 pb-1 border-b border-gray-300">Kas</h3>
                    <div className="flex items-center py-0.5">
                      <span className="text-xs text-gray-700">Kas Mulai:</span>
                      <span className="flex-grow border-b border-dotted border-gray-300 mx-2"></span>
                      <span className="text-xs font-semibold text-gray-900">{formatRupiah(kasMulaiActive)}</span>
                    </div>
                    <div className="flex items-center py-0.5">
                      <span className="text-xs text-gray-700">Cash Sales (Shift):</span>
                      <span className="flex-grow border-b border-dotted border-gray-300 mx-2"></span>
                      <span className="text-xs font-semibold text-gray-900">{formatRupiah(cashShiftSales)}</span>
                    </div>
                    <div className="flex items-center py-0.5">
                      <span className="text-xs text-gray-700">Cash Refunds (Shift):</span>
                      <span className="flex-grow border-b border-dotted border-gray-300 mx-2"></span>
                      <span className="text-xs font-semibold text-red-600">-{formatRupiah(cashShiftRefunds)}</span>
                    </div>
                    <div className="flex items-center py-0.5">
                      <span className="text-xs text-gray-700">Net Cash (Shift):</span>
                      <span className="flex-grow border-b border-dotted border-gray-300 mx-2"></span>
                      <span className="text-xs font-semibold text-gray-900">{formatRupiah(cashNetShift)}</span>
                    </div>
                    <div className="flex items-center py-0.5">
                      <span className="text-xs text-gray-700">Cash (Hari):</span>
                      <span className="flex-grow border-b border-dotted border-gray-300 mx-2"></span>
                      <span className="text-xs font-semibold text-gray-900">{formatRupiah(cashSummary.cash_whole_day)}</span>
                    </div>
                    <div className="flex items-center py-0.5">
                      <span className="text-xs font-semibold text-gray-800">Kas Diharapkan:</span>
                      <span className="flex-grow border-b border-dotted border-gray-300 mx-2"></span>
                      <span className="text-xs font-bold text-purple-700">{formatRupiah(kasExpectedActive)}</span>
                    </div>
                    {kasAkhirActive !== null && (
                      <>
                        <div className="flex items-center py-0.5">
                          <span className="text-xs text-gray-700">Kas Akhir:</span>
                          <span className="flex-grow border-b border-dotted border-gray-300 mx-2"></span>
                          <span className="text-xs font-semibold text-gray-900">{formatRupiah(kasAkhirActive)}</span>
                        </div>
                        <div className="flex items-center py-0.5">
                          <span className="text-xs text-gray-700">Selisih Kas:</span>
                          <span className="flex-grow border-b border-dotted border-gray-300 mx-2"></span>
                          <span className={`text-xs font-semibold ${kasSelisihLabelValue === 'balanced' ? 'text-green-600' :
                            kasSelisihLabelValue === 'plus' ? 'text-blue-600' : 'text-red-600'
                            }`}>
                            {kasSelisihValue !== null ? (
                              kasSelisihValue > 0 ? `+${formatRupiah(kasSelisihValue)}` : formatRupiah(kasSelisihValue)
                            ) : '-'}
                            {kasSelisihLabelValue && ` (${kasSelisihLabelValue === 'balanced' ? 'Balanced' :
                              kasSelisihLabelValue === 'plus' ? 'Plus' : 'Minus'
                              })`}
                          </span>
                        </div>
                      </>
                    )}
                    <div className="flex items-center py-0.5">
                      <span className="text-xs font-medium text-gray-800">Cash in Cashier:</span>
                      <span className="flex-grow border-b border-dotted border-gray-300 mx-2"></span>
                      <span className="text-xs font-bold text-purple-600">{formatRupiah(totalCashInCashier)}</span>
                    </div>
                    <div>
                      <div className="flex items-center py-0.5">
                        <span className="text-xs text-gray-700">Cash Sales (Whole Day):</span>
                        <span className="flex-grow border-b border-dotted border-gray-300 mx-2"></span>
                        <span className="text-xs font-semibold text-gray-900">{formatRupiah(cashWholeDaySales)}</span>
                      </div>
                      <div className="flex items-center py-0.5">
                        <span className="text-xs text-gray-700">Cash Refunds (Whole Day):</span>
                        <span className="flex-grow border-b border-dotted border-gray-300 mx-2"></span>
                        <span className="text-xs font-semibold text-red-600">-{formatRupiah(cashWholeDayRefunds)}</span>
                      </div>
                      <div className="flex items-center py-0.5">
                        <span className="text-xs text-gray-700">Net Cash (Whole Day):</span>
                        <span className="flex-grow border-b border-dotted border-gray-300 mx-2"></span>
                        <span className="text-xs font-semibold text-gray-900">{formatRupiah(cashNetWholeDay)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* REFUND SECTION */}
              {refunds.length > 0 && (
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                  <h2 className="text-base font-semibold text-gray-800 mb-3 text-center">REFUND</h2>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b-2 border-gray-300 bg-gray-50">
                          <th className="px-2 py-2 text-left font-semibold text-gray-700">Transaction ID</th>
                          <th className="px-2 py-2 text-left font-semibold text-gray-700">Method</th>
                          <th className="px-2 py-2 text-right font-semibold text-gray-700">Total</th>
                          <th className="px-2 py-2 text-right font-semibold text-gray-700">Refund Amount</th>
                          <th className="px-2 py-2 text-left font-semibold text-gray-700">Alasan</th>
                          <th className="px-2 py-2 text-left font-semibold text-gray-700">Refund Time</th>
                          <th className="px-2 py-2 text-left font-semibold text-gray-700">Transaction Created</th>
                        </tr>
                      </thead>
                      <tbody>
                        {refunds.map((refund, idx) => {
                          const refundDate = new Date(refund.refunded_at);
                          const transactionDate = new Date(refund.transaction_created_at);
                          const formatDateTime = (date: Date) => {
                            return date.toLocaleString('id-ID', {
                              year: 'numeric',
                              month: '2-digit',
                              day: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit',
                              second: '2-digit',
                              hour12: false
                            });
                          };
                          
                          return (
                            <tr 
                              key={refund.refund_uuid || idx} 
                              className="border-b border-gray-200 hover:bg-gray-50 cursor-pointer"
                              onClick={() => handleRefundClick(refund)}
                            >
                              <td className="px-2 py-2 text-gray-900 font-mono text-[10px]">
                                {refund.transaction_uuid_id || refund.transaction_uuid}
                              </td>
                              <td className="px-2 py-2 text-gray-700">
                                {formatPlatformLabel(refund.payment_method || 'offline')}
                              </td>
                              <td className="px-2 py-2 text-right text-gray-900">
                                {formatRupiah(Number(refund.final_amount || 0))}
                              </td>
                              <td className="px-2 py-2 text-right text-red-600 font-semibold">
                                -{formatRupiah(Number(refund.refund_amount || 0))}
                              </td>
                              <td className="px-2 py-2 text-black">
                                {refund.reason || '-'}
                              </td>
                              <td className="px-2 py-2 text-gray-600">
                                {formatDateTime(refundDate)}
                              </td>
                              <td className="px-2 py-2 text-gray-600">
                                {formatDateTime(transactionDate)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Refund Transaction Detail Modal */}
              {selectedRefundTransaction && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={() => setSelectedRefundTransaction(null)}>
                  <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                    <div className="p-6">
                      <div className="flex justify-between items-center mb-4">
                        <h2 className="text-lg font-semibold text-gray-800">Transaction Details</h2>
                        <button
                          onClick={() => setSelectedRefundTransaction(null)}
                          className="text-gray-400 hover:text-gray-600"
                        >
                          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>

                      <div className="mb-4 space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-black font-medium">Transaction ID:</span>
                          <span className="font-mono text-xs text-black">{selectedRefundTransaction.refund.transaction_uuid_id || selectedRefundTransaction.refund.transaction_uuid}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-black font-medium">Created By:</span>
                          <span className="text-black">{selectedRefundTransaction.userName || 'Unknown'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-black font-medium">Payment Method:</span>
                          <span className="text-black">{formatPlatformLabel(selectedRefundTransaction.refund.payment_method || 'offline')}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-black font-medium">Total Amount:</span>
                          <span className="font-semibold text-black">{formatRupiah(Number(selectedRefundTransaction.refund.final_amount || 0))}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-black font-medium">Refund Amount:</span>
                          <span className="font-semibold text-red-600">-{formatRupiah(Number(selectedRefundTransaction.refund.refund_amount || 0))}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-black font-medium">Alasan:</span>
                          <span className="text-black">{selectedRefundTransaction.refund.reason || '-'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-black font-medium">Catatan:</span>
                          <span className="text-black">{selectedRefundTransaction.refund.note || '-'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-black font-medium">Refund Date:</span>
                          <span className="text-black">{new Date(selectedRefundTransaction.refund.refunded_at).toLocaleString('id-ID', {
                            year: 'numeric',
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                            hour12: false
                          })}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-black font-medium">Transaction Created:</span>
                          <span className="text-black">{new Date(selectedRefundTransaction.refund.transaction_created_at).toLocaleString('id-ID', {
                            year: 'numeric',
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                            hour12: false
                          })}</span>
                        </div>
                      </div>

                      <div className="border-t pt-4">
                        <h3 className="text-sm font-semibold text-black mb-3">Items</h3>
                        <div className="space-y-3">
                          {selectedRefundTransaction.items.map((item, itemIdx) => (
                            <div key={item.id || itemIdx} className="border-b pb-3 last:border-b-0">
                              <div className="flex justify-between items-start mb-1">
                                <div className="flex-1">
                                  <span className="font-medium text-black">{item.product_name}</span>
                                  <span className="text-black ml-2">x{item.quantity}</span>
                                </div>
                                <span className="font-semibold text-black">{formatRupiah(item.total_price)}</span>
                              </div>
                              {item.customizations && item.customizations.length > 0 && (
                                <div className="ml-4 mt-1 space-y-1">
                                  {item.customizations.map((cust, custIdx) => (
                                    <div key={custIdx} className="text-xs text-black">
                                      <span className="font-medium">{cust.customization_name || 'Customization'}:</span>
                                      <span className="ml-1">
                                        {cust.selected_options.map(opt => opt.option_name).join(', ')}
                                        {cust.selected_options.some(opt => opt.price_adjustment !== 0) && (
                                          <span className="text-black ml-1">
                                            ({cust.selected_options
                                              .filter(opt => opt.price_adjustment !== 0)
                                              .map(opt => `${opt.price_adjustment > 0 ? '+' : ''}${formatRupiah(opt.price_adjustment)}`)
                                              .join(', ')})
                                          </span>
                                        )}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              )}
                              {item.custom_note && (
                                <div className="ml-4 mt-1 text-xs text-black italic">
                                  Note: {item.custom_note}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>

                      {selectedRefundTransaction.note && (
                        <div className="border-t pt-4 mt-4">
                          <h3 className="text-sm font-semibold text-black mb-2">Transaction Note</h3>
                          <p className="text-sm text-black">{selectedRefundTransaction.note}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* BARANG TERJUAL */}
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                <h2 className="text-base font-semibold text-gray-800 mb-2 text-center">BARANG TERJUAL</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b-2 border-gray-300">
                        <th className="text-left py-1 px-2 font-semibold text-gray-700">Product</th>
                        <th className="text-right py-1 px-2 font-semibold text-gray-700">Qty</th>
                        <th className="text-right py-1 px-2 font-semibold text-gray-700">Unit Price</th>
                        <th className="text-right py-1 px-2 font-semibold text-gray-700">Subtotal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayProductSales.length > 0 ? (
                        <>
                          {displayProductSales.map((product, idx) => {
                            // Handle both grouped (has platforms array) and ungrouped (has platform string) formats
                            const isGrouped = isGroupedProduct(product);
                            
                            const platformsStr = isGrouped
                              ? product.platforms
                                  .map((p: string) => formatPlatformLabel(p))
                                  .sort()
                                  .join(', ')
                              : formatPlatformLabel(product.platform || 'offline');
                            
                            // Format unit prices (for grouped) or single unit price (for ungrouped)
                            const unitPricesStr = isGrouped
                              ? product.unitPrices
                                  .sort((a: number, b: number) => a - b)
                                  .map((price: number) => formatRupiah(price))
                                  .join(', ')
                              : formatRupiah(product.base_unit_price || (product.total_quantity > 0 ? product.base_subtotal / product.total_quantity : 0));

                            return (
                              <tr key={`${product.product_id}-${product.transaction_type}-${idx}`} className="border-b border-gray-200 hover:bg-gray-50">
                                <td className="py-1 px-2 font-medium">
                                  <div className="text-gray-900">
                                    {product.is_bundle_item && <span className="text-[10px] font-semibold text-purple-600">[Bundle] </span>}
                                    {product.product_name}
                                  </div>
                                  <div className="text-[10px] text-gray-600">
                                    {product.transaction_type === 'drinks' ? 'Drinks' : 'Bakery'}
                                    {' · '}
                                    {platformsStr}
                                  </div>
                                </td>
                                <td className="py-1 px-2 text-right font-medium text-gray-900">{product.total_quantity}</td>
                                <td className="py-1 px-2 text-right font-medium">
                                  {product.is_bundle_item ? (
                                    <span className="text-gray-700">-</span>
                                  ) : (
                                    <span className="text-gray-900">
                                      {unitPricesStr || '-'}
                                    </span>
                                  )}
                                </td>
                                <td className="py-1 px-2 text-right font-semibold">
                                  {product.is_bundle_item ? (
                                    <span className="text-gray-700">-</span>
                                  ) : (
                                    <span className="text-gray-900">
                                      {formatRupiah(isGrouped ? product.total_base_subtotal : product.base_subtotal)}
                                    </span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                          <tr className="border-t-2 border-gray-300 bg-gray-100">
                            <td className="py-1 px-2 font-bold text-gray-900">TOTAL</td>
                            <td className="py-1 px-2 text-right font-bold text-gray-900">
                              {displayProductSales.reduce((sum, p) => sum + p.total_quantity, 0)}
                            </td>
                            <td className="py-1 px-2 text-right font-bold">
                              {(() => {
                                const regularProducts = displayProductSales.filter(p => !p.is_bundle_item);
                                const totalsByKey = regularProducts.reduce((acc, p) => {
                                  const isPGrouped = isGroupedProduct(p);
                                  const platforms = isPGrouped 
                                    ? p.platforms 
                                    : [p.platform || 'offline'];
                                  platforms.forEach((platform: string) => {
                                    const key = `${p.transaction_type}-${platform}`;
                                    if (!acc.has(key)) {
                                      acc.set(key, { quantity: 0, base: 0 });
                                    }
                                    const current = acc.get(key)!;
                                    // Distribute quantity and base proportionally (simplified: divide by platform count)
                                    const platformCount = platforms.length;
                                    const totalQty = isPGrouped ? p.total_quantity : p.total_quantity;
                                    const baseSubtotal = isPGrouped ? p.total_base_subtotal : p.base_subtotal;
                                    current.quantity += Math.round(totalQty / platformCount);
                                    current.base += baseSubtotal / platformCount;
                                  });
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
                                return rows;
                              })()}
                            </td>
                            <td className="py-1 px-2 text-right font-bold text-gray-900">
                              {formatRupiah(displayProductSales.filter(p => !p.is_bundle_item).reduce((sum, p) => {
                                const baseSubtotal = isGroupedProduct(p) ? p.total_base_subtotal : p.base_subtotal;
                                return sum + baseSubtotal;
                              }, 0))}
                            </td>
                          </tr>
                        </>
                      ) : (
                        <tr>
                          <td colSpan={4} className="py-4 text-center text-gray-500 text-xs">
                            Belum ada produk yang terjual
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Payment Method Breakdown */}
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                <h2 className="text-base font-semibold text-gray-800 mb-2 text-center">PAYMENT METHOD</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b-2 border-gray-300">
                        <th className="text-left py-1 px-2 font-semibold text-gray-700">Payment Method</th>
                        <th className="text-right py-1 px-2 font-semibold text-gray-700">Count</th>
                        <th className="text-right py-1 px-2 font-semibold text-gray-700">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paymentBreakdown.length > 0 ? (
                        <>
                          {paymentBreakdown.map((item, idx) => (
                            <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                              <td className="py-1 px-2 text-gray-900 font-medium">{item.payment_method_name || item.payment_method_code}</td>
                              <td className="py-1 px-2 text-right font-medium text-gray-900">{item.transaction_count}</td>
                              <td className="py-1 px-2 text-right font-semibold text-gray-900">{formatRupiah(item.total_amount)}</td>
                            </tr>
                          ))}
                          <tr className="border-t-2 border-gray-300 bg-gray-100">
                            <td className="py-1 px-2 font-bold text-gray-900">TOTAL</td>
                            <td className="py-1 px-2 text-right font-bold text-gray-900">{totalPaymentCount}</td>
                            <td className="py-1 px-2 text-right font-bold text-gray-900">
                              {formatRupiah(paymentBreakdown.reduce((sum, item) => sum + item.total_amount, 0))}
                            </td>
                          </tr>
                        </>
                      ) : (
                        <tr>
                          <td colSpan={3} className="py-4 text-center text-gray-500 text-xs">
                            Belum ada transaksi
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* CATEGORY II */}
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                <h2 className="text-base font-semibold text-gray-800 mb-2 text-center">CATEGORY II</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b-2 border-gray-300">
                        <th className="text-left py-1 px-2 font-semibold text-gray-700">Category II</th>
                        <th className="text-right py-1 px-2 font-semibold text-gray-700">Quantity</th>
                        <th className="text-right py-1 px-2 font-semibold text-gray-700">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        // Always prefer recalculated data (with base_subtotal) if it exists
                        // Only fall back to original category2Breakdown if recalculation hasn't run yet
                        const displayData = recalculatedCategory2Breakdown.length > 0 
                          ? recalculatedCategory2Breakdown 
                          : (productSales.length > 0 ? [] : category2Breakdown); // If we have productSales but no recalculated data, show empty (recalculation in progress or failed)
                        
                        return displayData.length > 0 ? (
                          <>
                            {displayData.map((item, idx) => (
                              <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                                <td className="py-1 px-2 text-gray-900 font-medium">{item.category2_name}</td>
                                <td className="py-1 px-2 text-right font-medium text-gray-900">{item.total_quantity}</td>
                                <td className="py-1 px-2 text-right font-semibold text-gray-900">{formatRupiah(item.total_amount)}</td>
                              </tr>
                            ))}
                            <tr className="border-t-2 border-gray-300 bg-gray-100">
                              <td className="py-1 px-2 font-bold text-gray-900">TOTAL</td>
                              <td className="py-1 px-2 text-right font-bold text-gray-900">
                                {displayData.reduce((sum, item) => sum + item.total_quantity, 0)}
                              </td>
                              <td className="py-1 px-2 text-right font-bold text-gray-900">
                                {formatRupiah(displayData.reduce((sum, item) => sum + item.total_amount, 0))}
                              </td>
                            </tr>
                          </>
                        ) : (
                          <tr>
                            <td colSpan={3} className="py-4 text-center text-gray-500">
                              {productSales.length > 0 ? 'Menghitung...' : 'Tidak ada Category II'}
                            </td>
                          </tr>
                        );
                      })()}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* TOPPING SALES BREAKDOWN */}
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                <h2 className="text-base font-semibold text-gray-800 mb-2 text-center">TOPPING SALES BREAKDOWN</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b-2 border-gray-300">
                        <th className="text-left py-1 px-2 font-semibold text-gray-700">Customization</th>
                        <th className="text-right py-1 px-2 font-semibold text-gray-700">Qty</th>
                        <th className="text-right py-1 px-2 font-semibold text-gray-700">Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customizationSales.length > 0 ? (
                        <>
                          {customizationSales.map((item, idx) => (
                            <tr key={idx} className="border-b border-gray-200 hover:bg-gray-50">
                              <td className="py-1 px-2">
                                <div className="font-medium text-gray-900">{item.option_name}</div>
                                <div className="text-[10px] text-gray-600">{item.customization_name}</div>
                              </td>
                              <td className="py-1 px-2 text-right font-medium text-gray-900">{item.total_quantity}</td>
                              <td className="py-1 px-2 text-right font-semibold text-gray-900">{formatRupiah(item.total_revenue)}</td>
                            </tr>
                          ))}
                          <tr className="border-t-2 border-gray-300 bg-gray-100">
                            <td className="py-1 px-2 font-bold text-gray-900">TOTAL</td>
                            <td className="py-1 px-2 text-right font-bold text-gray-900">
                              {customizationSales.reduce((sum, item) => sum + item.total_quantity, 0)}
                            </td>
                            <td className="py-1 px-2 text-right font-bold text-gray-900">
                              {formatRupiah(customizationSales.reduce((sum, item) => sum + item.total_revenue, 0))}
                            </td>
                          </tr>
                        </>
                      ) : (
                        <tr>
                          <td colSpan={3} className="py-4 text-center text-gray-500">
                            Belum ada kustomisasi terjual
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* DISKON & VOUCHER */}
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                <h2 className="text-base font-semibold text-gray-800 mb-2 text-center">DISKON & VOUCHER</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <tbody>
                      <tr className="border-b border-gray-200 hover:bg-gray-50">
                        <td className="py-1 px-2 text-gray-900 font-medium">Voucher Digunakan</td>
                        <td className="py-1 px-2 text-right font-semibold text-gray-900">{statistics.voucher_count} transaksi</td>
                      </tr>
                      <tr className="border-b border-gray-200 hover:bg-gray-50">
                        <td className="py-1 px-2 text-gray-900 font-medium">Total Diskon Voucher</td>
                        <td className="py-1 px-2 text-right font-semibold text-green-600">
                          {statistics.total_discount > 0 ? formatRupiah(-statistics.total_discount) : formatRupiah(0)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
                </>
              )}
        </div>
      )}

      {/* Print Selection Modal */}
      {showPrintSelectionModal && shiftSequenceInfo && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 animate-in zoom-in">
            <h3 className="text-xl font-bold text-gray-800 mb-4">Pilih Laporan untuk Print</h3>

            <div className="space-y-3 mb-6 max-h-96 overflow-y-auto">
              {/* Whole Day Option */}
              <label className="flex items-center space-x-3 cursor-pointer p-3 rounded-lg hover:bg-gray-50 border border-gray-200">
                <input
                  type="checkbox"
                  checked={printWholeDaySelected}
                  onChange={(e) => setPrintWholeDaySelected(e.target.checked)}
                  className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                />
                <div className="flex-1">
                  <span className="font-semibold text-gray-900">Whole Day (Semua Shift)</span>
                  <p className="text-sm text-gray-600">
                    {formatDateTime(shiftSequenceInfo.dayStartUtc)} - Sekarang
                  </p>
                </div>
              </label>

              <div className="border-t border-gray-300 my-3"></div>

              {/* Individual Shift Options */}
              {printSelections.map((selection) => {
                const shift = shiftSequenceInfo.shifts.find(s => s.id === selection.shiftId);
                if (!shift) return null;

                return (
                  <label
                    key={selection.shiftId}
                    className="flex items-center space-x-3 cursor-pointer p-3 rounded-lg hover:bg-gray-50 border border-gray-200"
                  >
                    <input
                      type="checkbox"
                      checked={selection.selected}
                      onChange={(e) => {
                        setPrintSelections(prev =>
                          prev.map(s =>
                            s.shiftId === selection.shiftId
                              ? { ...s, selected: e.target.checked }
                              : s
                          )
                        );
                      }}
                      className="w-5 h-5 text-green-600 rounded focus:ring-2 focus:ring-green-500"
                    />
                    <div className="flex-1">
                      <span className="font-semibold text-gray-900">
                        Shift {selection.shiftIndex} - {shift.user_name}
                      </span>
                      <p className="text-sm text-gray-600">
                        {formatDateTime(shift.shift_start)}
                        {shift.shift_end && ` - ${formatDateTime(shift.shift_end)}`}
                        {shift.status === 'active' && <span className="ml-2 text-green-600 font-medium">(Aktif)</span>}
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>

            {/* Collapsible Print Options */}
            <div className="mb-4 border border-gray-200 rounded-lg overflow-hidden">
              <button
                type="button"
                onClick={() => setShowPrintOptions(!showPrintOptions)}
                className="w-full flex items-center justify-between p-3 bg-gray-50 hover:bg-gray-100 transition-colors"
              >
                <span className="font-semibold text-gray-800">Print Options</span>
                {showPrintOptions ? (
                  <ChevronUp className="w-5 h-5 text-gray-600" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-gray-600" />
                )}
              </button>
              
              <div
                className={`overflow-hidden transition-all duration-300 ease-in-out ${
                  showPrintOptions ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
                }`}
              >
                <div className="p-4 space-y-3 bg-white border-t border-gray-200">
                  {/* Ringkasan Only Toggle */}
                  <div className="mb-4 pb-4 border-b border-gray-200">
                    <label className="flex items-center justify-between cursor-pointer p-3 rounded-lg bg-blue-50 hover:bg-blue-100 transition-colors">
                      <div className="flex flex-col">
                        <span className="text-sm font-semibold text-gray-800">Ringkasan Only</span>
                        <span className="text-xs text-gray-600 mt-1">Hanya tampilkan ringkasan, sembunyikan semua bagian lainnya</span>
                      </div>
                      <div className="relative inline-block w-14 h-8">
                        <input
                          type="checkbox"
                          checked={ringkasanOnly}
                          onChange={(e) => {
                            const isEnabled = e.target.checked;
                            setRingkasanOnly(isEnabled);
                            setPrintSectionOptions({
                              barangTerjual: !isEnabled,
                              paymentMethod: !isEnabled,
                              categoryII: !isEnabled,
                              toppingSales: !isEnabled,
                              diskonVoucher: !isEnabled
                            });
                          }}
                          className="sr-only"
                        />
                        <div
                          className={`absolute inset-0 rounded-full transition-colors duration-200 ease-in-out ${
                            ringkasanOnly ? 'bg-blue-600' : 'bg-gray-300'
                          }`}
                        >
                          <div
                            className={`absolute top-1 left-1 w-6 h-6 bg-white rounded-full shadow-md transform transition-transform duration-200 ease-in-out ${
                              ringkasanOnly ? 'translate-x-6' : 'translate-x-0'
                            }`}
                          />
                        </div>
                      </div>
                    </label>
                  </div>
                  
                  <p className="text-sm text-gray-600 mb-3">Pilih bagian yang ingin dicetak:</p>
                  
                  <label className={`flex items-center justify-between cursor-pointer p-2 rounded hover:bg-gray-50 ${ringkasanOnly ? 'opacity-50' : ''}`}>
                    <span className="text-sm font-medium text-gray-700">BARANG TERJUAL</span>
                    <input
                      type="checkbox"
                      checked={printSectionOptions.barangTerjual}
                      onChange={(e) => {
                        const newValue = e.target.checked;
                        setPrintSectionOptions((prev) => ({
                          ...prev,
                          barangTerjual: newValue
                        }));
                        // Auto-update ringkasanOnly based on all sections
                        const allUnchecked = !newValue && !printSectionOptions.paymentMethod && !printSectionOptions.categoryII && !printSectionOptions.toppingSales && !printSectionOptions.diskonVoucher;
                        const allChecked = newValue && printSectionOptions.paymentMethod && printSectionOptions.categoryII && printSectionOptions.toppingSales && printSectionOptions.diskonVoucher;
                        if (allUnchecked) setRingkasanOnly(true);
                        else if (allChecked) setRingkasanOnly(false);
                      }}
                      disabled={ringkasanOnly}
                      className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                  </label>

                  <label className={`flex items-center justify-between cursor-pointer p-2 rounded hover:bg-gray-50 ${ringkasanOnly ? 'opacity-50' : ''}`}>
                    <span className="text-sm font-medium text-gray-700">PAYMENT METHOD</span>
                    <input
                      type="checkbox"
                      checked={printSectionOptions.paymentMethod}
                      onChange={(e) => {
                        const newValue = e.target.checked;
                        setPrintSectionOptions((prev) => ({
                          ...prev,
                          paymentMethod: newValue
                        }));
                        // Auto-update ringkasanOnly based on all sections
                        const allUnchecked = !printSectionOptions.barangTerjual && !newValue && !printSectionOptions.categoryII && !printSectionOptions.toppingSales && !printSectionOptions.diskonVoucher;
                        const allChecked = printSectionOptions.barangTerjual && newValue && printSectionOptions.categoryII && printSectionOptions.toppingSales && printSectionOptions.diskonVoucher;
                        if (allUnchecked) setRingkasanOnly(true);
                        else if (allChecked) setRingkasanOnly(false);
                      }}
                      disabled={ringkasanOnly}
                      className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                  </label>

                  <label className={`flex items-center justify-between cursor-pointer p-2 rounded hover:bg-gray-50 ${ringkasanOnly ? 'opacity-50' : ''}`}>
                    <span className="text-sm font-medium text-gray-700">CATEGORY II</span>
                    <input
                      type="checkbox"
                      checked={printSectionOptions.categoryII}
                      onChange={(e) => {
                        const newValue = e.target.checked;
                        setPrintSectionOptions((prev) => ({
                          ...prev,
                          categoryII: newValue
                        }));
                        // Auto-update ringkasanOnly based on all sections
                        const allUnchecked = !printSectionOptions.barangTerjual && !printSectionOptions.paymentMethod && !newValue && !printSectionOptions.toppingSales && !printSectionOptions.diskonVoucher;
                        const allChecked = printSectionOptions.barangTerjual && printSectionOptions.paymentMethod && newValue && printSectionOptions.toppingSales && printSectionOptions.diskonVoucher;
                        if (allUnchecked) setRingkasanOnly(true);
                        else if (allChecked) setRingkasanOnly(false);
                      }}
                      disabled={ringkasanOnly}
                      className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                  </label>

                  <label className={`flex items-center justify-between cursor-pointer p-2 rounded hover:bg-gray-50 ${ringkasanOnly ? 'opacity-50' : ''}`}>
                    <span className="text-sm font-medium text-gray-700">TOPPING SALES BREAKDOWN</span>
                    <input
                      type="checkbox"
                      checked={printSectionOptions.toppingSales}
                      onChange={(e) => {
                        const newValue = e.target.checked;
                        setPrintSectionOptions((prev) => ({
                          ...prev,
                          toppingSales: newValue
                        }));
                        // Auto-update ringkasanOnly based on all sections
                        const allUnchecked = !printSectionOptions.barangTerjual && !printSectionOptions.paymentMethod && !printSectionOptions.categoryII && !newValue && !printSectionOptions.diskonVoucher;
                        const allChecked = printSectionOptions.barangTerjual && printSectionOptions.paymentMethod && printSectionOptions.categoryII && newValue && printSectionOptions.diskonVoucher;
                        if (allUnchecked) setRingkasanOnly(true);
                        else if (allChecked) setRingkasanOnly(false);
                      }}
                      disabled={ringkasanOnly}
                      className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                  </label>

                  <label className={`flex items-center justify-between cursor-pointer p-2 rounded hover:bg-gray-50 ${ringkasanOnly ? 'opacity-50' : ''}`}>
                    <span className="text-sm font-medium text-gray-700">DISKON & VOUCHER</span>
                    <input
                      type="checkbox"
                      checked={printSectionOptions.diskonVoucher}
                      onChange={(e) => {
                        const newValue = e.target.checked;
                        setPrintSectionOptions((prev) => ({
                          ...prev,
                          diskonVoucher: newValue
                        }));
                        // Auto-update ringkasanOnly based on all sections
                        const allUnchecked = !printSectionOptions.barangTerjual && !printSectionOptions.paymentMethod && !printSectionOptions.categoryII && !printSectionOptions.toppingSales && !newValue;
                        const allChecked = printSectionOptions.barangTerjual && printSectionOptions.paymentMethod && printSectionOptions.categoryII && printSectionOptions.toppingSales && newValue;
                        if (allUnchecked) setRingkasanOnly(true);
                        else if (allChecked) setRingkasanOnly(false);
                      }}
                      disabled={ringkasanOnly}
                      className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                  </label>
                </div>
              </div>
            </div>

            <div className="flex space-x-3">
              <button
                onClick={() => {
                  setShowPrintSelectionModal(false);
                  setPrintWholeDaySelected(false);
                  setPrintSelections(prev => prev.map(s => ({ ...s, selected: false })));
                }}
                disabled={isPrintingSelected}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors"
              >
                Batal
              </button>
              <button
                onClick={handlePrintSelected}
                disabled={isPrintingSelected || (!printWholeDaySelected && printSelections.filter(s => s.selected).length === 0)}
                className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors flex items-center justify-center space-x-2"
              >
                {isPrintingSelected ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Mencetak...</span>
                  </>
                ) : (
                  <>
                    <Printer className="w-4 h-4" />
                    <span>Print ({(printWholeDaySelected ? 1 : 0) + printSelections.filter(s => s.selected).length})</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Date-Time Picker Modal */}
      {showDatePicker && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 animate-in zoom-in">
            <h3 className="text-xl font-bold text-gray-800 mb-4">Pilih Periode untuk Print</h3>

            {/* Collapsible Print Options */}
            <div className="mb-4 border border-gray-200 rounded-lg overflow-hidden">
              <button
                type="button"
                onClick={() => setShowPrintOptions(!showPrintOptions)}
                className="w-full flex items-center justify-between p-3 bg-gray-50 hover:bg-gray-100 transition-colors"
              >
                <span className="font-semibold text-gray-800">Print Options</span>
                {showPrintOptions ? (
                  <ChevronUp className="w-5 h-5 text-gray-600" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-gray-600" />
                )}
              </button>
              
              <div
                className={`overflow-hidden transition-all duration-300 ease-in-out ${
                  showPrintOptions ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
                }`}
              >
                <div className="p-4 space-y-3 bg-white border-t border-gray-200">
                  {/* Ringkasan Only Toggle */}
                  <div className="mb-4 pb-4 border-b border-gray-200">
                    <label className="flex items-center justify-between cursor-pointer p-3 rounded-lg bg-blue-50 hover:bg-blue-100 transition-colors">
                      <div className="flex flex-col">
                        <span className="text-sm font-semibold text-gray-800">Ringkasan Only</span>
                        <span className="text-xs text-gray-600 mt-1">Hanya tampilkan ringkasan, sembunyikan semua bagian lainnya</span>
                      </div>
                      <div className="relative inline-block w-14 h-8">
                        <input
                          type="checkbox"
                          checked={ringkasanOnly}
                          onChange={(e) => {
                            const isEnabled = e.target.checked;
                            setRingkasanOnly(isEnabled);
                            setPrintSectionOptions({
                              barangTerjual: !isEnabled,
                              paymentMethod: !isEnabled,
                              categoryII: !isEnabled,
                              toppingSales: !isEnabled,
                              diskonVoucher: !isEnabled
                            });
                          }}
                          className="sr-only"
                        />
                        <div
                          className={`absolute inset-0 rounded-full transition-colors duration-200 ease-in-out ${
                            ringkasanOnly ? 'bg-blue-600' : 'bg-gray-300'
                          }`}
                        >
                          <div
                            className={`absolute top-1 left-1 w-6 h-6 bg-white rounded-full shadow-md transform transition-transform duration-200 ease-in-out ${
                              ringkasanOnly ? 'translate-x-6' : 'translate-x-0'
                            }`}
                          />
                        </div>
                      </div>
                    </label>
                  </div>
                  
                  <p className="text-sm text-gray-600 mb-3">Pilih bagian yang ingin dicetak:</p>
                  
                  <label className={`flex items-center justify-between cursor-pointer p-2 rounded hover:bg-gray-50 ${ringkasanOnly ? 'opacity-50' : ''}`}>
                    <span className="text-sm font-medium text-gray-700">BARANG TERJUAL</span>
                    <input
                      type="checkbox"
                      checked={printSectionOptions.barangTerjual}
                      onChange={(e) => {
                        const newValue = e.target.checked;
                        setPrintSectionOptions((prev) => ({
                          ...prev,
                          barangTerjual: newValue
                        }));
                        // Auto-update ringkasanOnly based on all sections
                        const allUnchecked = !newValue && !printSectionOptions.paymentMethod && !printSectionOptions.categoryII && !printSectionOptions.toppingSales && !printSectionOptions.diskonVoucher;
                        const allChecked = newValue && printSectionOptions.paymentMethod && printSectionOptions.categoryII && printSectionOptions.toppingSales && printSectionOptions.diskonVoucher;
                        if (allUnchecked) setRingkasanOnly(true);
                        else if (allChecked) setRingkasanOnly(false);
                      }}
                      disabled={ringkasanOnly}
                      className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                  </label>

                  <label className={`flex items-center justify-between cursor-pointer p-2 rounded hover:bg-gray-50 ${ringkasanOnly ? 'opacity-50' : ''}`}>
                    <span className="text-sm font-medium text-gray-700">PAYMENT METHOD</span>
                    <input
                      type="checkbox"
                      checked={printSectionOptions.paymentMethod}
                      onChange={(e) => {
                        const newValue = e.target.checked;
                        setPrintSectionOptions((prev) => ({
                          ...prev,
                          paymentMethod: newValue
                        }));
                        // Auto-update ringkasanOnly based on all sections
                        const allUnchecked = !printSectionOptions.barangTerjual && !newValue && !printSectionOptions.categoryII && !printSectionOptions.toppingSales && !printSectionOptions.diskonVoucher;
                        const allChecked = printSectionOptions.barangTerjual && newValue && printSectionOptions.categoryII && printSectionOptions.toppingSales && printSectionOptions.diskonVoucher;
                        if (allUnchecked) setRingkasanOnly(true);
                        else if (allChecked) setRingkasanOnly(false);
                      }}
                      disabled={ringkasanOnly}
                      className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                  </label>

                  <label className={`flex items-center justify-between cursor-pointer p-2 rounded hover:bg-gray-50 ${ringkasanOnly ? 'opacity-50' : ''}`}>
                    <span className="text-sm font-medium text-gray-700">CATEGORY II</span>
                    <input
                      type="checkbox"
                      checked={printSectionOptions.categoryII}
                      onChange={(e) => {
                        const newValue = e.target.checked;
                        setPrintSectionOptions((prev) => ({
                          ...prev,
                          categoryII: newValue
                        }));
                        // Auto-update ringkasanOnly based on all sections
                        const allUnchecked = !printSectionOptions.barangTerjual && !printSectionOptions.paymentMethod && !newValue && !printSectionOptions.toppingSales && !printSectionOptions.diskonVoucher;
                        const allChecked = printSectionOptions.barangTerjual && printSectionOptions.paymentMethod && newValue && printSectionOptions.toppingSales && printSectionOptions.diskonVoucher;
                        if (allUnchecked) setRingkasanOnly(true);
                        else if (allChecked) setRingkasanOnly(false);
                      }}
                      disabled={ringkasanOnly}
                      className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                  </label>

                  <label className={`flex items-center justify-between cursor-pointer p-2 rounded hover:bg-gray-50 ${ringkasanOnly ? 'opacity-50' : ''}`}>
                    <span className="text-sm font-medium text-gray-700">TOPPING SALES BREAKDOWN</span>
                    <input
                      type="checkbox"
                      checked={printSectionOptions.toppingSales}
                      onChange={(e) => {
                        const newValue = e.target.checked;
                        setPrintSectionOptions((prev) => ({
                          ...prev,
                          toppingSales: newValue
                        }));
                        // Auto-update ringkasanOnly based on all sections
                        const allUnchecked = !printSectionOptions.barangTerjual && !printSectionOptions.paymentMethod && !printSectionOptions.categoryII && !newValue && !printSectionOptions.diskonVoucher;
                        const allChecked = printSectionOptions.barangTerjual && printSectionOptions.paymentMethod && printSectionOptions.categoryII && newValue && printSectionOptions.diskonVoucher;
                        if (allUnchecked) setRingkasanOnly(true);
                        else if (allChecked) setRingkasanOnly(false);
                      }}
                      disabled={ringkasanOnly}
                      className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                  </label>

                  <label className={`flex items-center justify-between cursor-pointer p-2 rounded hover:bg-gray-50 ${ringkasanOnly ? 'opacity-50' : ''}`}>
                    <span className="text-sm font-medium text-gray-700">DISKON & VOUCHER</span>
                    <input
                      type="checkbox"
                      checked={printSectionOptions.diskonVoucher}
                      onChange={(e) => {
                        const newValue = e.target.checked;
                        setPrintSectionOptions((prev) => ({
                          ...prev,
                          diskonVoucher: newValue
                        }));
                        // Auto-update ringkasanOnly based on all sections
                        const allUnchecked = !printSectionOptions.barangTerjual && !printSectionOptions.paymentMethod && !printSectionOptions.categoryII && !printSectionOptions.toppingSales && !newValue;
                        const allChecked = printSectionOptions.barangTerjual && printSectionOptions.paymentMethod && printSectionOptions.categoryII && printSectionOptions.toppingSales && newValue;
                        if (allUnchecked) setRingkasanOnly(true);
                        else if (allChecked) setRingkasanOnly(false);
                      }}
                      disabled={ringkasanOnly}
                      className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                  </label>
                </div>
              </div>
            </div>

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

      {/* Settings Modal */}
      {showSettingsModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 animate-in zoom-in">
            <h3 className="text-xl font-bold text-gray-800 mb-4">Pengaturan Laporan Shift</h3>
            
            <div className="space-y-4 mb-6">
              {/* Group Products Setting */}
              <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
                <div className="flex-1">
                  <label className="text-sm font-semibold text-gray-800 block mb-1">
                    Group Produk dengan Nama Sama
                  </label>
                  <p className="text-xs text-gray-600">
                    Aktifkan untuk menggabungkan produk dengan nama sama dari platform berbeda menjadi satu baris
                  </p>
                </div>
                <div className="relative inline-block w-14 h-8 ml-4">
                  <input
                    type="checkbox"
                    checked={groupProducts}
                    onChange={(e) => handleGroupProductsChange(e.target.checked)}
                    className="sr-only"
                  />
                  <div
                    className={`absolute inset-0 rounded-full transition-colors duration-200 ease-in-out ${
                      groupProducts ? 'bg-blue-600' : 'bg-gray-300'
                    }`}
                  >
                    <div
                      className={`absolute top-1 left-1 w-6 h-6 bg-white rounded-full shadow-md transform transition-transform duration-200 ease-in-out ${
                        groupProducts ? 'translate-x-6' : 'translate-x-0'
                      }`}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => setShowSettingsModal(false)}
                className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors font-medium"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

