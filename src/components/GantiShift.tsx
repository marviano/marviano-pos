'use client';

import { useState, useEffect, useRef, useCallback, useMemo, Fragment } from 'react';
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
import { appConfirm } from '@/components/AppDialog';

const PLATFORM_LABELS: Record<string, string> = {
  offline: 'Offline',
  gofood: 'GoFood',
  grabfood: 'GrabFood',
  shopeefood: 'ShopeeFood',
  qpon: 'Qpon',
  tiktok: 'TikTok',
};

/** Order for displaying platform breakdown under Total Omset. */
const PLATFORM_ORDER = ['offline', 'gofood', 'grabfood', 'shopeefood', 'qpon', 'tiktok'] as const;

/** Derive transaction count and amount by platform from payment breakdown (for ringkasan). */
function orderCountByPlatform(paymentBreakdown: PaymentBreakdown[]): Array<{ label: string; count: number; amount: number }> {
  const countMap = new Map<string, number>();
  const amountMap = new Map<string, number>();
  paymentBreakdown.forEach((p) => {
    const code = (p.payment_method_code || 'offline').toLowerCase();
    const platform = PLATFORM_LABELS[code] ? code : 'offline';
    const count = Number(p.transaction_count || 0);
    const amount = Number(p.total_amount || 0);
    countMap.set(platform, (countMap.get(platform) ?? 0) + count);
    amountMap.set(platform, (amountMap.get(platform) ?? 0) + amount);
  });
  return PLATFORM_ORDER.filter((key) => (countMap.get(key) ?? 0) > 0).map((key) => ({
    label: PLATFORM_LABELS[key],
    count: countMap.get(key) ?? 0,
    amount: amountMap.get(key) ?? 0,
  }));
}

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
  total_cu: number;
}

interface PaymentBreakdown {
  payment_method_name: string;
  payment_method_code: string;
  transaction_count: number;
  total_amount: number;
}

interface Category1Breakdown {
  category1_name: string;
  category1_id: number;
  total_quantity: number;
  total_amount: number;
}

interface Category2Breakdown {
  category2_name: string;
  category2_id: number;
  total_quantity: number;
  total_amount: number;
}

interface PackageSalesBreakdownLine {
  product_id: number;
  product_name: string;
  total_quantity: number;
}

interface PackageSalesBreakdown {
  package_product_id: number;
  package_product_name: string;
  total_quantity: number;
  total_amount: number;
  base_unit_price: number;
  lines: PackageSalesBreakdownLine[];
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

type VoucherBreakdown = Record<string, { count: number; total: number }>;

interface CancelledItemDetail {
  product_name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  cancelled_at: string;
  cancelled_by_user_name: string;
  cancelled_by_waiter_name: string;
  receipt_number?: string | null;
  customer_name?: string | null;
}

interface ReportDataPayload {
  statistics: ShiftStatistics;
  paymentBreakdown: PaymentBreakdown[];
  category1Breakdown: Category1Breakdown[];
  category2Breakdown: Category2Breakdown[];
  cashSummary: CashSummary;
  productSales: ProductSale[];
  packageSalesBreakdown: PackageSalesBreakdown[];
  customizationSales: CustomizationSale[];
  voucherBreakdown: VoucherBreakdown;
  refunds: RefundDetail[];
  refundExcItems: RefundExcDetail[];
  cancelledItems: CancelledItemDetail[];
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
  transaction_created_at?: string;
  reason?: string | null;
  note?: string | null;
  customer_name?: string | null;
  issuer_email?: string | null;
  waiter_name?: string | null;
}

interface RefundExcDetail {
  uuid_id: string;
  nama: string;
  pax: number;
  tanggal: string;
  jam: string;
  no_hp: string | null;
  jumlah_refund: number;
  alasan: string | null;
  created_by_email: string | null;
  created_at: string;
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

/** Month is 1-based (1=Jan, 12=Dec). If mtd is true and (year, month) is current month, returns month start to end of today (GMT+7); else returns full month. */
const getGmt7MonthBounds = (
  year: number,
  month: number,
  mtd: boolean
): { dayStartUtc: string; dayEndUtc: string } => {
  const gmt7Offset = 7 * 60 * 60 * 1000;
  const now = new Date();
  const gmt7Now = new Date(now.getTime() + gmt7Offset);
  const currentYear = gmt7Now.getUTCFullYear();
  const currentMonth = gmt7Now.getUTCMonth() + 1; // 1-based
  const monthStartGmt7 = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const monthEndGmt7 = new Date(Date.UTC(year, month - 1, lastDay, 23, 59, 59, 999));
  const dayStartUtc = new Date(monthStartGmt7.getTime() - gmt7Offset).toISOString();
  let dayEndUtc: string;
  if (mtd && year === currentYear && month === currentMonth) {
    const today = gmt7Now.getUTCDate();
    const mtdEndGmt7 = new Date(Date.UTC(year, month - 1, today, 23, 59, 59, 999));
    dayEndUtc = new Date(mtdEndGmt7.getTime() - gmt7Offset).toISOString();
  } else {
    dayEndUtc = new Date(monthEndGmt7.getTime() - gmt7Offset).toISOString();
  }
  return { dayStartUtc, dayEndUtc };
};

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

const VOUCHER_BREAKDOWN_ORDER: { key: string; label: string }[] = [
  { key: 'percent_10', label: '10%' },
  { key: 'percent_15', label: '15%' },
  { key: 'percent_20', label: '20%' },
  { key: 'percent_25', label: '25%' },
  { key: 'percent_30', label: '30%' },
  { key: 'percent_35', label: '35%' },
  { key: 'percent_50', label: '50%' },
  { key: 'custom', label: 'Custom Nominal' },
  { key: 'free', label: 'Free' }
];

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

const WIB = 'Asia/Jakarta';

// Format time for display (UTC+7 / WIB)
const formatTime = (dateString: string): string => {
  const date = new Date(dateString);
  return date.toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: WIB
  });
};

// Format full date and time in Indonesian in UTC+7 (e.g., "Senin, 27 Desember 2025 14.53 PM")
const formatDateTime = (dateString: string): string => {
  const date = new Date(dateString);
  const parts = new Intl.DateTimeFormat('id-ID', {
    timeZone: WIB,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const hour = get('hour').padStart(2, '0');
  const minute = get('minute').padStart(2, '0');
  const h = parseInt(hour, 10);
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${get('weekday')}, ${get('day')} ${get('month')} ${get('year')} ${hour}.${minute} ${ampm}`;
};

export default function GantiShift() {
  const { user } = useAuth();

  const [activeShift, setActiveShift] = useState<Shift | null>(null);
  const [modalAwal, setModalAwal] = useState<string>('');
  const [isStartingShift, setIsStartingShift] = useState(false);
  const [isEndingShift, setIsEndingShift] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingInitial, setIsLoadingInitial] = useState(true);
  const [isLoadingTabData, setIsLoadingTabData] = useState(false);

  // Get business ID from logged-in user
  const businessId = user?.selectedBusinessId;


  useEffect(() => {
  }, [user?.id, user?.selectedBusinessId]);

  if (!businessId) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
        <p className="text-red-700">No business selected. Please log in and select a business.</p>
      </div>
    );
  }
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
    voucher_count: 0,
    total_cu: 0
  });

  const [paymentBreakdown, setPaymentBreakdown] = useState<PaymentBreakdown[]>([]);
  const [category1Breakdown, setCategory1Breakdown] = useState<Category1Breakdown[]>([]);
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
  const [packageSalesBreakdown, setPackageSalesBreakdown] = useState<PackageSalesBreakdown[]>([]);
  const [customizationSales, setCustomizationSales] = useState<CustomizationSale[]>([]);
  const [voucherBreakdown, setVoucherBreakdown] = useState<VoucherBreakdown>({});
  const [refunds, setRefunds] = useState<RefundDetail[]>([]);
  const [refundExcItems, setRefundExcItems] = useState<RefundExcDetail[]>([]);
  const [cancelledItems, setCancelledItems] = useState<CancelledItemDetail[]>([]);
  const [recalculatedCategory1Breakdown, setRecalculatedCategory1Breakdown] = useState<Category1Breakdown[]>([]);
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
        // Sum quantities and subtotals (tanpa topping)
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

  /** Barang Terjual: total qty and amount by platform (from productSales, excludes bundle). Tanpa topping. */
  const barangTerjualByPlatform = useMemo(() => {
    const countMap = new Map<string, number>();
    const amountMap = new Map<string, number>();
    productSales.forEach((p) => {
      if (p.is_bundle_item) return;
      const code = (p.platform || 'offline').toLowerCase();
      const platform = PLATFORM_LABELS[code] ? code : 'offline';
      const qty = Number(p.total_quantity || 0);
      const amount = Number(p.base_subtotal ?? p.total_subtotal ?? 0);
      countMap.set(platform, (countMap.get(platform) ?? 0) + qty);
      amountMap.set(platform, (amountMap.get(platform) ?? 0) + amount);
    });
    return PLATFORM_ORDER.filter((key) => (countMap.get(key) ?? 0) > 0).map((key) => ({
      label: PLATFORM_LABELS[key],
      qty: countMap.get(key) ?? 0,
      amount: amountMap.get(key) ?? 0,
    }));
  }, [productSales]);

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

  // Helper function to recalculate Category I for printing (only product's category1)
  const recalculateCategory1ForPrint = async (
    products: ProductSale[],
    originalCategory1: Category1Breakdown[],
    electronAPI: ReturnType<typeof getElectronAPI>,
    businessId?: number
  ): Promise<Category1Breakdown[]> => {
    if (!electronAPI?.localDbGetAllProducts || products.length === 0) {
      return originalCategory1.length > 0 ? originalCategory1 : [];
    }
    try {
      const allProducts = await electronAPI.localDbGetAllProducts(businessId);
      const productsArray = Array.isArray(allProducts) ? allProducts as Record<string, unknown>[] : [];
      const productToCategory1NameMap = new Map<number, string>();
      productsArray.forEach((p) => {
        const productId = typeof p.id === 'number' ? p.id : (typeof p.id === 'string' ? parseInt(p.id, 10) : null);
        const category1Name = typeof p.category1_name === 'string' ? p.category1_name : (typeof (p as { kategori?: string }).kategori === 'string' ? (p as { kategori: string }).kategori : null);
        if (productId && category1Name) {
          productToCategory1NameMap.set(productId, category1Name);
        }
      });
      const category1NameToIdMap = new Map<string, number>();
      originalCategory1.forEach((cat) => {
        category1NameToIdMap.set(cat.category1_name, cat.category1_id);
      });
      const category1Map = new Map<string, { category1_id: number; category1_name: string; total_quantity: number; total_amount: number }>();
      products.forEach((product) => {
        if (product.is_bundle_item) return;
        const category1Name = productToCategory1NameMap.get(product.product_id);
        if (!category1Name) return;
        const category1Id = category1NameToIdMap.get(category1Name) || 0;
        const existing = category1Map.get(category1Name);
        if (existing) {
          existing.total_quantity += product.total_quantity;
          existing.total_amount += product.base_subtotal;
        } else {
          category1Map.set(category1Name, {
            category1_id: category1Id,
            category1_name: category1Name,
            total_quantity: product.total_quantity,
            total_amount: product.base_subtotal
          });
        }
      });
      return Array.from(category1Map.values())
        .map((data) => ({
          category1_id: data.category1_id,
          category1_name: data.category1_name,
          total_quantity: data.total_quantity,
          total_amount: data.total_amount
        }))
        .sort((a, b) => a.category1_name.localeCompare(b.category1_name));
    } catch (error) {
      console.error('[Print Category I Recalc] Error:', error);
      return originalCategory1;
    }
  };

  // Helper function to recalculate Category II for printing (only product's category2)
  const recalculateCategory2ForPrint = async (
    products: ProductSale[],
    originalCategory2: Category2Breakdown[],
    electronAPI: ReturnType<typeof getElectronAPI>,
    businessId?: number
  ): Promise<Category2Breakdown[]> => {
    if (!electronAPI?.localDbGetAllProducts || products.length === 0) {
      return [];
    }

    try {
      const allProducts = await electronAPI.localDbGetAllProducts(businessId);
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
    ringkasan: true,
    barangTerjual: true,
    paymentMethod: true,
    categoryI: true,
    categoryII: true,
    toppingSales: true,
    itemDibatalkan: true
  });
  const [ringkasanOnly, setRingkasanOnly] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [printMonthlySelected, setPrintMonthlySelected] = useState(false);
  const [printSelectedMonth, setPrintSelectedMonth] = useState<string>(() => {
    const d = new Date();
    const gmt7 = new Date(d.getTime() + 7 * 60 * 60 * 1000);
    const y = gmt7.getUTCFullYear();
    const m = gmt7.getUTCMonth() + 1;
    return `${y}-${String(m).padStart(2, '0')}`;
  });

  // Tab view states
  const [activeTab, setActiveTab] = useState<TabView>('all-day');
  // const [tabData, setTabData] = useState<Record<string, ReportDataPayload>>({});

  // Historical date viewing states
  const [viewMode, setViewMode] = useState<'current' | 'historical'>('current');
  const [selectedDate, setSelectedDate] = useState<string>(''); // Format: YYYY-MM-DD in GMT+7
  // const [historicalShifts, setHistoricalShifts] = useState<Shift[]>([]);

  const modalInputRef = useRef<HTMLInputElement>(null);
  const lastLoadedTabRef = useRef<TabView | null>(null);
  const loadingTabRef = useRef<TabView | null>(null);
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
      setStatistics({ order_count: 0, total_amount: 0, total_discount: 0, voucher_count: 0, total_cu: 0 });
      setPaymentBreakdown([]);
      setCategory1Breakdown([]);
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
      setPackageSalesBreakdown([]);
      setCustomizationSales([]);
      setVoucherBreakdown({});
      setRecalculatedCategory1Breakdown([]);
      setRecalculatedCategory2Breakdown([]);
      setTodayTransactionsInfo(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeShift?.id, checkTodayTransactions]);

  // Function to recalculate Category I breakdown using base_subtotal. Only uses product's category1 (no category2 requirement).
  const recalculateCategory1Breakdown = useCallback(async (products: ProductSale[], originalCategory1: Category1Breakdown[], businessId?: number) => {
    const electronAPI = getElectronAPI();
    if (!electronAPI?.localDbGetAllProducts || products.length === 0) {
      setRecalculatedCategory1Breakdown([]);
      return;
    }
    try {
      const allProducts = await electronAPI.localDbGetAllProducts(businessId);
      const productsArray = Array.isArray(allProducts) ? allProducts as Record<string, unknown>[] : [];
      const productToCategory1NameMap = new Map<number, string>();
      productsArray.forEach((p) => {
        const productId = typeof p.id === 'number' ? p.id : (typeof p.id === 'string' ? parseInt(p.id, 10) : null);
        const category1Name = typeof p.category1_name === 'string' ? p.category1_name : (typeof (p as { kategori?: string }).kategori === 'string' ? (p as { kategori: string }).kategori : null);
        if (productId && category1Name) {
          productToCategory1NameMap.set(productId, category1Name);
        }
      });
      const category1NameToIdMap = new Map<string, number>();
      originalCategory1.forEach((cat) => {
        category1NameToIdMap.set(cat.category1_name, cat.category1_id);
      });
      const category1Map = new Map<string, { category1_id: number; category1_name: string; total_quantity: number; total_amount: number }>();
      products.forEach((product) => {
        if (product.is_bundle_item) return;
        const category1Name = productToCategory1NameMap.get(product.product_id);
        if (!category1Name) return;
        const category1Id = category1NameToIdMap.get(category1Name) || 0;
        const existing = category1Map.get(category1Name);
        if (existing) {
          existing.total_quantity += product.total_quantity;
          existing.total_amount += product.base_subtotal;
        } else {
          category1Map.set(category1Name, {
            category1_id: category1Id,
            category1_name: category1Name,
            total_quantity: product.total_quantity,
            total_amount: product.base_subtotal
          });
        }
      });
      const recalculated = Array.from(category1Map.values())
        .map((data) => ({
          category1_id: data.category1_id,
          category1_name: data.category1_name,
          total_quantity: data.total_quantity,
          total_amount: data.total_amount
        }))
        .sort((a, b) => a.category1_name.localeCompare(b.category1_name));
      setRecalculatedCategory1Breakdown(recalculated);
    } catch (error) {
      console.error('[Category I Recalc] Error:', error);
      setRecalculatedCategory1Breakdown([]);
    }
  }, []);

  // Function to recalculate Category II breakdown using base_subtotal. Only uses product's category2.
  const recalculateCategory2Breakdown = useCallback(async (products: ProductSale[], originalCategory2: Category2Breakdown[], businessId?: number) => {
    const electronAPI = getElectronAPI();
    if (!electronAPI?.localDbGetAllProducts || products.length === 0) {
      setRecalculatedCategory2Breakdown([]);
      return;
    }

    try {
      const allProducts = await electronAPI.localDbGetAllProducts(businessId);
      const productsArray = Array.isArray(allProducts) ? allProducts as Record<string, unknown>[] : [];
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

      // Group productSales by category2_name and sum base_subtotal (tanpa topping)
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

  // Recalculate Category I breakdown when productSales or category1Breakdown changes
  useEffect(() => {
    if (productSales.length > 0 && category1Breakdown.length > 0) {
      recalculateCategory1Breakdown(productSales, category1Breakdown, businessId);
    } else if (category1Breakdown.length > 0 && productSales.length === 0) {
      setRecalculatedCategory1Breakdown(category1Breakdown);
    } else {
      setRecalculatedCategory1Breakdown([]);
    }
  }, [productSales, category1Breakdown, recalculateCategory1Breakdown, businessId]);

  // Recalculate Category II breakdown when productSales or category2Breakdown changes
  useEffect(() => {
    if (productSales.length > 0 && category2Breakdown.length > 0) {
      recalculateCategory2Breakdown(productSales, category2Breakdown, businessId);
    } else if (category2Breakdown.length > 0 && productSales.length === 0) {
      setRecalculatedCategory2Breakdown(category2Breakdown);
    } else {
      setRecalculatedCategory2Breakdown([]);
    }
  }, [productSales, category2Breakdown, recalculateCategory2Breakdown, businessId]);

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
      lastLoadedTabRef.current = null;
      return;
    }

    const bounds = getGmt7DayBounds(activeShift.shift_start);
    if (!bounds) {
      setShiftSequenceInfo(null);
      lastLoadedTabRef.current = null;
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

      const defaultStats: ShiftStatistics = { order_count: 0, total_amount: 0, total_discount: 0, voucher_count: 0, total_cu: 0 };
      const defaultCash: CashSummary = { cash_shift: 0, cash_whole_day: 0 };

      // Load all statistics in parallel with error handling
      const [statsResult, breakdownResult, category1BreakdownResult, category2BreakdownResult, cashResult, productSalesResult, packageSalesResult, refundsResult, refundExcResult, voucherBreakdownResult, cancelledItemsResult] = await Promise.allSettled([
        electronAPI.localDbGetShiftStatistics
          ? electronAPI.localDbGetShiftStatistics(null, activeShift.shift_start, activeShift.shift_end, businessId, activeShift.uuid_id)
          : Promise.resolve(defaultStats),
        electronAPI.localDbGetPaymentBreakdown
          ? electronAPI.localDbGetPaymentBreakdown(null, activeShift.shift_start, activeShift.shift_end, businessId, activeShift.uuid_id)
          : Promise.resolve<PaymentBreakdown[]>([]),
        electronAPI.localDbGetCategory1Breakdown
          ? electronAPI.localDbGetCategory1Breakdown(null, activeShift.shift_start, activeShift.shift_end, businessId, activeShift.uuid_id)
          : Promise.resolve<Category1Breakdown[]>([]),
        electronAPI.localDbGetCategory2Breakdown
          ? electronAPI.localDbGetCategory2Breakdown(null, activeShift.shift_start, activeShift.shift_end, businessId, activeShift.uuid_id)
          : Promise.resolve<Category2Breakdown[]>([]),
        electronAPI.localDbGetCashSummary
          ? electronAPI.localDbGetCashSummary(null, activeShift.shift_start, activeShift.shift_end, businessId, activeShift.uuid_id)
          : Promise.resolve(defaultCash),
        electronAPI.localDbGetProductSales
          ? electronAPI.localDbGetProductSales(null, activeShift.shift_start, activeShift.shift_end, businessId, activeShift.uuid_id)
          : Promise.resolve<ProductSalesPayload>({ products: [], customizations: [] }),
        electronAPI.localDbGetPackageSalesBreakdown
          ? electronAPI.localDbGetPackageSalesBreakdown(null, activeShift.shift_start, activeShift.shift_end, businessId, activeShift.uuid_id)
          : Promise.resolve<PackageSalesBreakdown[]>([]),
        electronAPI.localDbGetShiftRefunds
          ? electronAPI.localDbGetShiftRefunds({
            userId: shiftOwnerId,
            businessId: businessId,
            shiftUuid: activeShift.uuid_id,
            shiftStart: activeShift.shift_start,
            shiftEnd: activeShift.shift_end
          })
          : Promise.resolve<RefundDetail[]>([]),
        electronAPI.localDbGetShiftRefundExc
          ? electronAPI.localDbGetShiftRefundExc({
            businessId: businessId,
            shiftUuid: activeShift.uuid_id,
            shiftStart: activeShift.shift_start,
            shiftEnd: activeShift.shift_end ?? undefined
          })
          : Promise.resolve<RefundExcDetail[]>([]),
        electronAPI.localDbGetVoucherBreakdown
          ? electronAPI.localDbGetVoucherBreakdown(null, activeShift.shift_start, activeShift.shift_end, businessId, activeShift.uuid_id)
          : Promise.resolve<VoucherBreakdown>({}),
        electronAPI.localDbGetShiftCancelledItems
          ? electronAPI.localDbGetShiftCancelledItems(null, activeShift.shift_start, activeShift.shift_end, businessId, activeShift.uuid_id)
          : Promise.resolve<CancelledItemDetail[]>([])
      ]);

      const stats =
        statsResult.status === 'fulfilled' ? (statsResult.value as ShiftStatistics) : defaultStats;
      const breakdown =
        breakdownResult.status === 'fulfilled'
          ? (breakdownResult.value as PaymentBreakdown[])
          : [];
      const category1BreakdownData =
        category1BreakdownResult.status === 'fulfilled'
          ? (category1BreakdownResult.value as Category1Breakdown[])
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
      const packageBreakdownData =
        packageSalesResult.status === 'fulfilled'
          ? ((packageSalesResult.value as PackageSalesBreakdown[]) ?? [])
          : [];

      setStatistics({
        order_count: stats.order_count ?? 0,
        total_amount: stats.total_amount ?? 0,
        total_discount: stats.total_discount ?? 0,
        voucher_count: stats.voucher_count ?? 0,
        total_cu: stats.total_cu ?? 0
      });
      setPaymentBreakdown(breakdown);
      setCategory1Breakdown(category1BreakdownData);
      setCategory2Breakdown(category2BreakdownData);
      // Do not overwrite cashSummary: RINGKASAN uses loadTabData as source of truth.
      // loadStatistics overwriting it caused Cash (Hari) to flip (e.g. 92k -> 0) after a few seconds.
      setProductSales(productSalesData.products || []);
      setPackageSalesBreakdown(packageBreakdownData);
      setCustomizationSales(productSalesData.customizations || []);
      const vb = voucherBreakdownResult.status === 'fulfilled' ? (voucherBreakdownResult.value as VoucherBreakdown) : {};
      setVoucherBreakdown(vb ?? {});

      // Recalculate Category I and Category II totals using base_subtotal (without customizations)
      if (productSalesData.products && productSalesData.products.length > 0) {
        recalculateCategory1Breakdown(productSalesData.products, category1BreakdownData, businessId);
        recalculateCategory2Breakdown(productSalesData.products, category2BreakdownData, businessId);
      } else {
        setRecalculatedCategory1Breakdown(category1BreakdownData);
        setRecalculatedCategory2Breakdown(category2BreakdownData);
      }

      const refundsData = refundsResult.status === 'fulfilled' ? (refundsResult.value as RefundDetail[]) : [];
      setRefunds(refundsData);
      const refundExcData = refundExcResult.status === 'fulfilled' ? (refundExcResult.value as RefundExcDetail[]) : [];
      setRefundExcItems(refundExcData);
      const cancelledItemsData = cancelledItemsResult.status === 'fulfilled' ? (cancelledItemsResult.value as CancelledItemDetail[]) : [];
      setCancelledItems(cancelledItemsData);

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
  }, [activeShift, businessId, recalculateCategory1Breakdown, recalculateCategory2Breakdown]);

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
    async ({ start, end, userId, businessId: reportBusinessId = businessId, shiftUuid, shiftUuids, list_of_shifts }: { start: string; end: string | null; userId: number | null; businessId?: number; shiftUuid?: string | null; shiftUuids?: string[]; list_of_shifts?: Shift[]; }): Promise<ReportDataPayload> => {
      const electronAPI = getElectronAPI();
      if (!electronAPI) {
        throw new Error('Aplikasi Electron tidak terdeteksi.');
      }
      if (userId === undefined) {
        throw new Error('User ID tidak valid untuk laporan.');
      }

      const defaultStats: ShiftStatistics = { order_count: 0, total_amount: 0, total_discount: 0, voucher_count: 0, total_cu: 0 };
      const defaultCash: CashSummary = {
        cash_shift: 0,
        cash_shift_sales: 0,
        cash_shift_refunds: 0,
        cash_whole_day: 0,
        cash_whole_day_sales: 0,
        cash_whole_day_refunds: 0
      };

      const dayShiftUuids = shiftUuids ?? (list_of_shifts?.map((s) => s.uuid_id) ?? []);

      try {
        const refundsRequestPayload = electronAPI.localDbGetShiftRefunds
          ? {
            userId: userId ?? 0,
            businessId: reportBusinessId ?? 0,
            shiftUuid: shiftUuid ?? undefined,
            shiftUuids: dayShiftUuids.length > 0 ? dayShiftUuids : undefined,
            shiftStart: start,
            shiftEnd: end ?? undefined
          }
          : null;

        const refundExcRequestPayload = electronAPI.localDbGetShiftRefundExc
          ? { businessId: reportBusinessId ?? 0, shiftUuid: shiftUuid ?? undefined, shiftStart: start, shiftEnd: end ?? undefined }
          : null;

        const [statsResult, breakdownResult, category1BreakdownResult, category2BreakdownResult, cashResult, productSalesResult, packageSalesResult, voucherBreakdownResult, refundsResult, refundExcResult, cancelledItemsResult] = await Promise.allSettled([
          electronAPI.localDbGetShiftStatistics
            ? electronAPI.localDbGetShiftStatistics(userId, start, end, reportBusinessId, shiftUuid ?? undefined, dayShiftUuids.length > 0 ? dayShiftUuids : undefined)
            : Promise.resolve(defaultStats),
          electronAPI.localDbGetPaymentBreakdown
            ? electronAPI.localDbGetPaymentBreakdown(userId, start, end, reportBusinessId, shiftUuid ?? undefined, dayShiftUuids.length > 0 ? dayShiftUuids : undefined)
            : Promise.resolve<PaymentBreakdown[]>([]),
          electronAPI.localDbGetCategory1Breakdown
            ? electronAPI.localDbGetCategory1Breakdown(userId, start, end, reportBusinessId, shiftUuid ?? undefined, dayShiftUuids.length > 0 ? dayShiftUuids : undefined)
            : Promise.resolve<Category1Breakdown[]>([]),
          electronAPI.localDbGetCategory2Breakdown
            ? electronAPI.localDbGetCategory2Breakdown(userId, start, end, reportBusinessId, shiftUuid ?? undefined, dayShiftUuids.length > 0 ? dayShiftUuids : undefined)
            : Promise.resolve<Category2Breakdown[]>([]),
          electronAPI.localDbGetCashSummary
            ? electronAPI.localDbGetCashSummary(userId, start, end, reportBusinessId, shiftUuid ?? undefined, dayShiftUuids.length > 0 ? dayShiftUuids : undefined)
            : Promise.resolve(defaultCash),
          electronAPI.localDbGetProductSales
            ? electronAPI.localDbGetProductSales(userId, start, end, reportBusinessId, shiftUuid ?? undefined, dayShiftUuids.length > 0 ? dayShiftUuids : undefined)
            : Promise.resolve<ProductSalesPayload>({ products: [], customizations: [] }),
          electronAPI.localDbGetPackageSalesBreakdown
            ? electronAPI.localDbGetPackageSalesBreakdown(userId, start, end, reportBusinessId, shiftUuid ?? undefined, dayShiftUuids.length > 0 ? dayShiftUuids : undefined)
            : Promise.resolve<PackageSalesBreakdown[]>([]),
          electronAPI.localDbGetVoucherBreakdown
            ? electronAPI.localDbGetVoucherBreakdown(userId, start, end, reportBusinessId, shiftUuid ?? undefined, dayShiftUuids.length > 0 ? dayShiftUuids : undefined)
            : Promise.resolve<VoucherBreakdown>({}),
          refundsRequestPayload && electronAPI.localDbGetShiftRefunds
            ? electronAPI.localDbGetShiftRefunds(refundsRequestPayload)
            : Promise.resolve<RefundDetail[]>([]),
          refundExcRequestPayload && electronAPI.localDbGetShiftRefundExc
            ? electronAPI.localDbGetShiftRefundExc(refundExcRequestPayload)
            : Promise.resolve<RefundExcDetail[]>([]),
          electronAPI.localDbGetShiftCancelledItems
            ? electronAPI.localDbGetShiftCancelledItems(userId, start, end ?? start, reportBusinessId, shiftUuid ?? undefined, dayShiftUuids.length > 0 ? dayShiftUuids : undefined)
            : Promise.resolve<CancelledItemDetail[]>([])
        ]);

        const statsPayload = statsResult.status === 'fulfilled' ? (statsResult.value as ShiftStatistics) : defaultStats;
        const breakdownPayload =
          breakdownResult.status === 'fulfilled' ? (breakdownResult.value as PaymentBreakdown[]) : [];
        const category1BreakdownPayload =
          category1BreakdownResult.status === 'fulfilled' ? (category1BreakdownResult.value as Category1Breakdown[]) : [];
        const category2BreakdownPayload =
          category2BreakdownResult.status === 'fulfilled' ? (category2BreakdownResult.value as Category2Breakdown[]) : [];
        const rawCash = cashResult.status === 'fulfilled' ? (cashResult.value as CashSummary) : defaultCash;
        const productSalesPayload =
          productSalesResult.status === 'fulfilled'
            ? (productSalesResult.value as ProductSalesPayload)
            : { products: [], customizations: [] };
        const packageSalesPayload =
          packageSalesResult.status === 'fulfilled'
            ? ((packageSalesResult.value as PackageSalesBreakdown[]) ?? [])
            : [];

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

        const voucherBreakdownPayload = voucherBreakdownResult.status === 'fulfilled' ? (voucherBreakdownResult.value as VoucherBreakdown) : {};
        const refundsPayload = refundsResult.status === 'fulfilled' ? (refundsResult.value as RefundDetail[]) : [];
        const refundExcPayload = refundExcResult.status === 'fulfilled' ? (refundExcResult.value as RefundExcDetail[]) : [];
        const cancelledItemsPayload = cancelledItemsResult.status === 'fulfilled' ? (cancelledItemsResult.value as CancelledItemDetail[]) : [];
        return {
          statistics: {
            order_count: statsPayload.order_count ?? 0,
            total_amount: statsPayload.total_amount ?? 0,
            total_discount: finalTotalDiscount,
            voucher_count: statsPayload.voucher_count ?? 0,
            total_cu: statsPayload.total_cu ?? 0
          },
          paymentBreakdown: breakdownPayload,
          category1Breakdown: category1BreakdownPayload,
          category2Breakdown: category2BreakdownPayload,
          cashSummary: resolvedCash,
          productSales: productSalesPayload.products || [],
          packageSalesBreakdown: packageSalesPayload,
          customizationSales: productSalesPayload.customizations || [],
          voucherBreakdown: voucherBreakdownPayload ?? {},
          refunds: refundsPayload,
          refundExcItems: refundExcPayload,
          cancelledItems: cancelledItemsPayload
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
        setStatistics({ order_count: 0, total_amount: 0, total_discount: 0, voucher_count: 0, total_cu: 0 });
        setPaymentBreakdown([]);
        setCategory1Breakdown([]);
        setCategory2Breakdown([]);
        setVoucherBreakdown({});
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
    } else if (activeShift && shiftSequenceInfo) {
      loadTabData(activeTab);
      checkTodayTransactions();
    } else if (activeShift) {
      loadStatistics();
      checkTodayTransactions();
    } else {
      loadActiveShift();
    }
  };

  // Refresh Ringkasan when a refund is completed (e.g. from RefundModal)
  const handleRefreshRef = useRef(handleRefresh);
  handleRefreshRef.current = handleRefresh;
  useEffect(() => {
    const handler = () => handleRefreshRef.current();
    window.addEventListener('refund-completed', handler);
    return () => window.removeEventListener('refund-completed', handler);
  }, []);

  // Refresh Ringkasan when a Refund Exc. is created (e.g. from RefundExcModal)
  useEffect(() => {
    const handler = () => handleRefreshRef.current();
    window.addEventListener('refund-exc-created', handler);
    return () => window.removeEventListener('refund-exc-created', handler);
  }, []);

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

    // Pre-select based on active tab: Whole Day or the currently viewed shift
    if (activeTab === 'all-day') {
      setPrintWholeDaySelected(true);
      setPrintSelections(prev => prev.map(s => ({ ...s, selected: false })));
    } else if (typeof activeTab === 'number') {
      setPrintWholeDaySelected(false);
      setPrintSelections(prev => prev.map(s => ({ ...s, selected: s.shiftId === activeTab })));
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

    // Validate exactly one selection: Whole Day OR one shift OR Monthly (with month chosen)
    const selectedShifts = printSelections.filter(s => s.selected);
    const hasValidSelection = (printWholeDaySelected && selectedShifts.length === 0 && !printMonthlySelected) ||
      (printMonthlySelected && printSelectedMonth) ||
      (!printWholeDaySelected && !printMonthlySelected && selectedShifts.length === 1);
    if (!hasValidSelection) {
      setError('Silakan pilih satu laporan untuk dicetak (Whole Day, Bulanan, atau satu shift).');
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

          // Use selectedDate in historical view, otherwise today (same as "All Day" tab)
          const dateStr = (viewMode === 'historical' && selectedDate)
            ? selectedDate
            : new Date().toISOString().split('T')[0];
          const dayBounds = getGmt7DayBounds(dateStr);

          if (!dayBounds) {
            throw new Error('Failed to calculate day bounds for print');
          }

          console.log('   Day range:', dayBounds.dayStartUtc, 'to', dayBounds.dayEndUtc, viewMode === 'historical' ? '(historical)' : '(today)');

          // Get shifts for the day (same as display)
          const electronAPIForShifts = getElectronAPI();
          let dayShiftsForReport: Shift[] = [];

          if (electronAPIForShifts?.localDbGetShifts) {
            const shiftsResult = await electronAPIForShifts.localDbGetShifts({
              businessId: businessId,
              startDate: dayBounds.dayStartUtc,
              endDate: dayBounds.dayEndUtc
            });
            dayShiftsForReport = (shiftsResult?.shifts || []) as Shift[];
          } else {
            dayShiftsForReport = shiftSequenceInfo.shifts;
          }

          const dayReportData = await fetchReportPayload({
            start: dayBounds.dayStartUtc,
            end: dayBounds.dayEndUtc,
            userId: null, // null = all users for whole day report
            list_of_shifts: dayShiftsForReport
          });

          console.log('📊 [PRINT WHOLE DAY] Data fetched:', {
            orders: dayReportData.statistics.order_count,
            total: dayReportData.statistics.total_amount,
            products: dayReportData.productSales.length
          }); const dayCash = dayReportData.cashSummary;
          const dayCashSales = dayCash.cash_shift_sales ?? dayCash.cash_shift ?? 0;
          // Whole-day: use cash_whole_day_refunds for correct Grand Total calculation (matches print handler)
          const dayCashRefunds = dayCash.cash_whole_day_refunds ?? dayCash.cash_shift_refunds ?? 0;
          // const dailyKasExpected = (dayCash.cash_whole_day ?? dayCash.cash_shift ?? 0) || dayCashSales - dayCashRefunds;

          // Get modal awal from day's shifts
          let modalAwalWholeDay = 0;
          if (dayShiftsForReport.length > 0) {
            modalAwalWholeDay = dayShiftsForReport[0].modal_awal || 0;
          }

          // For whole-day print: Kas Diharapkan = Kas Mulai + Cash Sales (same as screen; no minus refund)
          const wholeDayKasExpected = modalAwalWholeDay + dayCashSales;
          const lastShiftWithKas = dayShiftsForReport.length > 0
            ? [...dayShiftsForReport].reverse().find((s) => s.kas_akhir != null && s.kas_akhir !== undefined) ?? null
            : null;
          const wholeDayKasAkhir = lastShiftWithKas != null ? Number(lastShiftWithKas.kas_akhir) : null;
          let wholeDayKasSelisih: number | null = null;
          let wholeDayKasSelisihLabel: 'balanced' | 'plus' | 'minus' | null = null;
          if (wholeDayKasAkhir != null) {
            const computed = Math.round(Number((wholeDayKasAkhir - wholeDayKasExpected).toFixed(2)));
            wholeDayKasSelisih = computed;
            wholeDayKasSelisihLabel = Math.abs(computed) < 1 ? 'balanced' : (computed > 0 ? 'plus' : 'minus');
          }

          // Group products and recalculate Category I & II for print
          const productsForPrint = groupProducts
            ? groupProductSalesForPrint(dayReportData.productSales)
            : dayReportData.productSales;
          const recalculatedCategory1 = await recalculateCategory1ForPrint(
            dayReportData.productSales,
            dayReportData.category1Breakdown || [],
            electronAPI,
            businessId
          );
          const recalculatedCategory2 = await recalculateCategory2ForPrint(
            dayReportData.productSales,
            dayReportData.category2Breakdown || [],
            electronAPI,
            businessId
          );

          console.log('🖨️ [PRINT WHOLE DAY] Sending to printer...');

          // Use same effective discount as screen (voucher breakdown sum when > 0, else total_discount) so printed Total Omset/Grand Total match RINGKASAN
          const dayVoucherSum = VOUCHER_BREAKDOWN_ORDER.reduce(
            (sum, { key }) => sum + (Number((dayReportData.voucherBreakdown ?? {})[key]?.total) || 0),
            0
          );
          const dayEffectiveDiscount = dayVoucherSum > 0 ? dayVoucherSum : (Number(dayReportData.statistics.total_discount) || 0);
          const dayGrossOmset = Math.round((Number(dayReportData.statistics.total_amount) || 0) + (Number(dayCashRefunds) || 0) + dayEffectiveDiscount);
          const result = await electronAPI.printShiftBreakdown({
            user_name: 'Semua Shift',
            shift_start: dayBounds.dayStartUtc,
            shift_end: dayBounds.dayEndUtc,
            modal_awal: modalAwalWholeDay,
            statistics: dayReportData.statistics,
            gross_total_omset: dayGrossOmset,
            refunds: dayReportData.refunds ?? [],
            refundExcItems: dayReportData.refundExcItems ?? [],
            cancelledItems: dayReportData.cancelledItems ?? [],
            productSales: productsForPrint,
            packageSalesBreakdown: dayReportData.packageSalesBreakdown ?? [],
            customizationSales: dayReportData.customizationSales,
            paymentBreakdown: dayReportData.paymentBreakdown.map(p => ({
              payment_method_name: p.payment_method_name || p.payment_method_code,
              transaction_count: p.transaction_count,
              total_amount: p.total_amount || 0
            })),
            category1Breakdown: recalculatedCategory1,
            category2Breakdown: recalculatedCategory2,
            voucherBreakdown: dayReportData.voucherBreakdown ?? {},
            cashSummary: {
              cash_shift: dayCash.cash_shift ?? 0,
              cash_shift_sales: dayCashSales,
              cash_shift_refunds: dayCashRefunds,
              cash_whole_day: dayCash.cash_whole_day ?? 0,
              cash_whole_day_sales: dayCash.cash_whole_day_sales ?? dayCash.cash_whole_day ?? 0,
              cash_whole_day_refunds: dayCash.cash_whole_day_refunds ?? 0,
              total_cash_in_cashier: wholeDayKasExpected,
              kas_mulai: modalAwalWholeDay,
              kas_expected: wholeDayKasExpected,
              kas_akhir: wholeDayKasAkhir,
              kas_selisih: wholeDayKasSelisih,
              kas_selisih_label: wholeDayKasSelisihLabel
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
      } else if (printMonthlySelected && printSelectedMonth) {
        try {
          const [y, m] = printSelectedMonth.split('-').map(Number);
          const now = new Date();
          const gmt7 = new Date(now.getTime() + 7 * 60 * 60 * 1000);
          const isCurrentMonth = y === gmt7.getUTCFullYear() && m === gmt7.getUTCMonth() + 1;
          const lastDayOfMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
          const isMonthFinished = !isCurrentMonth || gmt7.getUTCDate() >= lastDayOfMonth;
          const isMtd = isCurrentMonth && !isMonthFinished;
          const monthBounds = getGmt7MonthBounds(y, m, isMtd);
          const monthName = new Date(y, m - 1, 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
          const reportLabel = `Laporan Bulanan - ${monthName}${isMtd ? ' (MTD)' : ''}`;

          console.log('📊 [PRINT MONTHLY] Starting...', monthBounds, reportLabel);

          const electronAPIForShifts = getElectronAPI();
          let dayShiftsForReport: Shift[] = [];
          if (electronAPIForShifts?.localDbGetShifts) {
            const shiftsResult = await electronAPIForShifts.localDbGetShifts({
              businessId: businessId,
              startDate: monthBounds.dayStartUtc,
              endDate: monthBounds.dayEndUtc
            });
            dayShiftsForReport = (shiftsResult?.shifts || []) as Shift[];
          }

          const dayReportData = await fetchReportPayload({
            start: monthBounds.dayStartUtc,
            end: monthBounds.dayEndUtc,
            userId: null,
            list_of_shifts: dayShiftsForReport
          });

          const dayCash = dayReportData.cashSummary;
          const dayCashSales = dayCash.cash_shift_sales ?? dayCash.cash_shift ?? 0;
          const dayCashRefunds = dayCash.cash_whole_day_refunds ?? dayCash.cash_shift_refunds ?? 0;
          let modalAwalWholeDay = 0;
          if (dayShiftsForReport.length > 0) {
            modalAwalWholeDay = dayShiftsForReport[0].modal_awal || 0;
          }
          const wholeDayKasExpected = modalAwalWholeDay + dayCashSales;
          const lastShiftWithKas = dayShiftsForReport.length > 0
            ? [...dayShiftsForReport].reverse().find((s) => s.kas_akhir != null && s.kas_akhir !== undefined) ?? null
            : null;
          const wholeDayKasAkhir = lastShiftWithKas != null ? Number(lastShiftWithKas.kas_akhir) : null;
          let wholeDayKasSelisih: number | null = null;
          let wholeDayKasSelisihLabel: 'balanced' | 'plus' | 'minus' | null = null;
          if (wholeDayKasAkhir != null) {
            const computed = Math.round(Number((wholeDayKasAkhir - wholeDayKasExpected).toFixed(2)));
            wholeDayKasSelisih = computed;
            wholeDayKasSelisihLabel = Math.abs(computed) < 1 ? 'balanced' : (computed > 0 ? 'plus' : 'minus');
          }

          const productsForPrint = groupProducts
            ? groupProductSalesForPrint(dayReportData.productSales)
            : dayReportData.productSales;
          const recalculatedCategory1 = await recalculateCategory1ForPrint(
            dayReportData.productSales,
            dayReportData.category1Breakdown || [],
            electronAPI,
            businessId
          );
          const recalculatedCategory2 = await recalculateCategory2ForPrint(
            dayReportData.productSales,
            dayReportData.category2Breakdown || [],
            electronAPI,
            businessId
          );

          const dayVoucherSum = VOUCHER_BREAKDOWN_ORDER.reduce(
            (sum, { key }) => sum + (Number((dayReportData.voucherBreakdown ?? {})[key]?.total) || 0),
            0
          );
          const dayEffectiveDiscount = dayVoucherSum > 0 ? dayVoucherSum : (Number(dayReportData.statistics.total_discount) || 0);
          const dayGrossOmset = Math.round((Number(dayReportData.statistics.total_amount) || 0) + (Number(dayCashRefunds) || 0) + dayEffectiveDiscount);
          const result = await electronAPI.printShiftBreakdown({
            user_name: reportLabel,
            shift_start: monthBounds.dayStartUtc,
            shift_end: monthBounds.dayEndUtc,
            modal_awal: modalAwalWholeDay,
            statistics: dayReportData.statistics,
            gross_total_omset: dayGrossOmset,
            refunds: dayReportData.refunds ?? [],
            refundExcItems: dayReportData.refundExcItems ?? [],
            cancelledItems: dayReportData.cancelledItems ?? [],
            productSales: productsForPrint,
            packageSalesBreakdown: dayReportData.packageSalesBreakdown ?? [],
            customizationSales: dayReportData.customizationSales,
            paymentBreakdown: dayReportData.paymentBreakdown.map(p => ({
              payment_method_name: p.payment_method_name || p.payment_method_code,
              transaction_count: p.transaction_count,
              total_amount: p.total_amount || 0
            })),
            category1Breakdown: recalculatedCategory1,
            category2Breakdown: recalculatedCategory2,
            voucherBreakdown: dayReportData.voucherBreakdown ?? {},
            cashSummary: {
              cash_shift: dayCash.cash_shift ?? 0,
              cash_shift_sales: dayCashSales,
              cash_shift_refunds: dayCashRefunds,
              cash_whole_day: dayCash.cash_whole_day ?? 0,
              cash_whole_day_sales: dayCash.cash_whole_day_sales ?? dayCash.cash_whole_day ?? 0,
              cash_whole_day_refunds: dayCash.cash_whole_day_refunds ?? 0,
              total_cash_in_cashier: wholeDayKasExpected,
              kas_mulai: modalAwalWholeDay,
              kas_expected: wholeDayKasExpected,
              kas_akhir: wholeDayKasAkhir,
              kas_selisih: wholeDayKasSelisih,
              kas_selisih_label: wholeDayKasSelisihLabel
            },
            business_id: businessId,
            printerType: 'receiptPrinter',
            sectionOptions: printSectionOptions
          });

          if (!result.success) {
            throw new Error(result.error || 'Gagal mencetak laporan bulanan');
          }
          console.log('✅ [PRINT MONTHLY] Success!');
          await new Promise(r => setTimeout(r, 500));
        } catch (error) {
          console.error('Error printing monthly report:', error);
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
            userId: shiftUserId,
            shiftUuid: shift.uuid_id
          });

          console.log(`📊 [PRINT SHIFT ${selection.shiftIndex}] Data:`, {
            orders: shiftReportData.statistics.order_count,
            total: shiftReportData.statistics.total_amount
          });

          const shiftCash = shiftReportData.cashSummary;
          const shiftCashSales = shiftCash.cash_shift_sales ?? shiftCash.cash_shift ?? 0;
          const shiftCashRefunds = shiftCash.cash_shift_refunds ?? 0;
          // Kas Diharapkan = Kas Mulai + Cash Sales (same as screen; no minus refund)
          const shiftKasExpected = Number(shift.modal_awal ?? 0) + shiftCashSales;
          // If shift has kas_akhir but kas_selisih not set, compute so print shows same as app
          let printKasSelisih = shift.kas_selisih ?? null;
          let printKasSelisihLabel = shift.kas_selisih_label ?? null;
          if (printKasSelisih == null && shift.kas_akhir != null && shift.kas_akhir !== undefined) {
            const computed = Math.round(Number((Number(shift.kas_akhir) - shiftKasExpected).toFixed(2)));
            printKasSelisih = computed;
            printKasSelisihLabel = Math.abs(computed) < 1 ? 'balanced' : (computed > 0 ? 'plus' : 'minus');
          }

          // Group products and recalculate Category I & II for print
          const productsForPrint = groupProducts
            ? groupProductSalesForPrint(shiftReportData.productSales)
            : shiftReportData.productSales;
          const recalculatedCategory1 = await recalculateCategory1ForPrint(
            shiftReportData.productSales,
            shiftReportData.category1Breakdown || [],
            electronAPI,
            businessId
          );
          const recalculatedCategory2 = await recalculateCategory2ForPrint(
            shiftReportData.productSales,
            shiftReportData.category2Breakdown || [],
            electronAPI,
            businessId
          );

          console.log(`🖨️ [PRINT SHIFT ${selection.shiftIndex}] Sending to printer...`);

          // Use same effective discount as screen (voucher breakdown sum when > 0, else total_discount) so printed Total Omset/Grand Total match RINGKASAN
          const shiftVoucherSum = VOUCHER_BREAKDOWN_ORDER.reduce(
            (sum, { key }) => sum + (Number((shiftReportData.voucherBreakdown ?? {})[key]?.total) || 0),
            0
          );
          const shiftEffectiveDiscount = shiftVoucherSum > 0 ? shiftVoucherSum : (Number(shiftReportData.statistics.total_discount) || 0);
          const shiftGrossOmset = Math.round((Number(shiftReportData.statistics.total_amount) || 0) + (Number(shiftCashRefunds) || 0) + shiftEffectiveDiscount);
          const result = await electronAPI.printShiftBreakdown({
            user_name: shift.user_name,
            shift_start: shift.shift_start,
            shift_end: shift.shift_end,
            modal_awal: shift.modal_awal,
            statistics: shiftReportData.statistics,
            gross_total_omset: shiftGrossOmset,
            refunds: shiftReportData.refunds ?? [],
            refundExcItems: shiftReportData.refundExcItems ?? [],
            cancelledItems: shiftReportData.cancelledItems ?? [],
            productSales: productsForPrint,
            packageSalesBreakdown: shiftReportData.packageSalesBreakdown ?? [],
            customizationSales: shiftReportData.customizationSales,
            paymentBreakdown: shiftReportData.paymentBreakdown.map(p => ({
              payment_method_name: p.payment_method_name || p.payment_method_code,
              transaction_count: p.transaction_count,
              total_amount: p.total_amount || 0
            })),
            category1Breakdown: recalculatedCategory1,
            category2Breakdown: recalculatedCategory2,
            voucherBreakdown: shiftReportData.voucherBreakdown ?? {},
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
              kas_selisih: printKasSelisih,
              kas_selisih_label: printKasSelisihLabel
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

      // Group products and recalculate Category I & II for print
      const productsForPrint = groupProducts
        ? groupProductSalesForPrint(reportData.productSales)
        : reportData.productSales;
      const recalculatedCategory1 = await recalculateCategory1ForPrint(
        reportData.productSales,
        reportData.category1Breakdown || [],
        electronAPI,
        businessId
      );
      const recalculatedCategory2 = await recalculateCategory2ForPrint(
        reportData.productSales,
        reportData.category2Breakdown || [],
        electronAPI,
        businessId
      );

      const customGrossOmset = Math.round((Number(reportData.statistics.total_amount) || 0) + (Number(customCashRefunds) || 0) + (Number(reportData.statistics.total_discount) || 0));
      const result = await electronAPI.printShiftBreakdown({
        user_name: user?.name || activeShift?.user_name || 'Cashier',
        shift_start: startDateTime,
        shift_end: endDateTime,
        modal_awal: modalAwalForCustom,
        statistics: reportData.statistics,
        gross_total_omset: customGrossOmset,
        refunds: reportData.refunds ?? [],
        refundExcItems: reportData.refundExcItems ?? [],
        cancelledItems: reportData.cancelledItems ?? [],
        productSales: productsForPrint,
        packageSalesBreakdown: reportData.packageSalesBreakdown ?? [],
        customizationSales: reportData.customizationSales,
        paymentBreakdown: reportData.paymentBreakdown.map((p) => ({
          payment_method_name: p.payment_method_name || p.payment_method_code,
          transaction_count: p.transaction_count,
          total_amount: p.total_amount || 0
        })),
        category1Breakdown: recalculatedCategory1,
        category2Breakdown: recalculatedCategory2,
        voucherBreakdown: reportData.voucherBreakdown ?? {},
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
    if (loadingTabRef.current === tabView) return;
    loadingTabRef.current = tabView;
    const isNewTab = lastLoadedTabRef.current !== tabView;
    if (isNewTab) setIsLoadingTabData(true);
    let didLoad = false;
    try {
      if (tabView === 'all-day') {
        // Load whole day data
        const shiftOwnerId = Number(activeShift?.user_id ?? 0);
        if (!shiftOwnerId) {
          if (isNewTab) setIsLoadingTabData(false);
          return;
        }

        // For "All Day" tab: use selectedDate in historical view, otherwise today
        const dateStr = (viewMode === 'historical' && selectedDate)
          ? selectedDate
          : new Date().toISOString().split('T')[0];
        const dayBounds = getGmt7DayBounds(dateStr);

        if (!dayBounds) {
          console.error('[All Day Tab] Failed to calculate day bounds');
          if (isNewTab) setIsLoadingTabData(false);
          return;
        }

        console.log('[All Day Tab] Loading data for all shifts:', {
          dayStart: dayBounds.dayStartUtc,
          dayEnd: dayBounds.dayEndUtc,
          shiftsCount: shiftSequenceInfo.shifts.length,
          dateStr,
          isHistorical: viewMode === 'historical'
        });

        const dayData = await fetchReportPayload({
          start: dayBounds.dayStartUtc,
          end: dayBounds.dayEndUtc,
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
        setCategory1Breakdown(dayData.category1Breakdown ?? []);
        setCategory2Breakdown(dayData.category2Breakdown);
        setCashSummary(dayData.cashSummary);
        setProductSales(dayData.productSales);
        setPackageSalesBreakdown(dayData.packageSalesBreakdown ?? []);
        setCustomizationSales(dayData.customizationSales);
        setVoucherBreakdown(dayData.voucherBreakdown ?? {});
        setRefunds(dayData.refunds ?? []);
        setRefundExcItems(dayData.refundExcItems ?? []);
        setCancelledItems(dayData.cancelledItems ?? []);
        didLoad = true;
      } else {
        // Load specific shift data
        const shift = shiftSequenceInfo.shifts.find(s => s.id === tabView);
        if (!shift) {
          if (isNewTab) setIsLoadingTabData(false);
          return;
        }

        const shiftUserId = Number(shift.user_id ?? 0);
        if (!shiftUserId) {
          if (isNewTab) setIsLoadingTabData(false);
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
        setCategory1Breakdown(shiftData.category1Breakdown ?? []);
        setCategory2Breakdown(shiftData.category2Breakdown);
        setCashSummary(shiftData.cashSummary);
        setProductSales(shiftData.productSales);
        setPackageSalesBreakdown(shiftData.packageSalesBreakdown ?? []);
        setCustomizationSales(shiftData.customizationSales);
        setVoucherBreakdown(shiftData.voucherBreakdown ?? {});
        setRefunds(shiftData.refunds ?? []);
        setRefundExcItems(shiftData.refundExcItems ?? []);
        setCancelledItems(shiftData.cancelledItems ?? []);
        didLoad = true;
      }
    } catch (error) {
      console.error(`Error loading tab data for ${tabView}:`, error);
    } finally {
      loadingTabRef.current = null;
      if (didLoad) lastLoadedTabRef.current = tabView;
      if (isNewTab) setIsLoadingTabData(false);
    }
  }, [shiftSequenceInfo, activeShift, fetchReportPayload, viewMode, selectedDate]);

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

    const confirmed = await appConfirm(
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
  // Selisih Kas formula (must match backend end-shift and get-cash-summary):
  //   Kas Expected = Modal Awal + Penjualan Tunai (net of cancelled) - Refund Tunai
  //   Selisih = Kas Akhir - Kas Expected (plus = surplus, minus = shortfall)
  // Convert string values to numbers (MySQL returns decimal as strings)
  const cashShiftSales = Number(cashSummary.cash_shift_sales ?? cashSummary.cash_shift ?? 0) || 0;
  const cashShiftRefunds = Number(cashSummary.cash_shift_refunds ?? 0) || 0;
  const cashWholeDayRefunds = Number(cashSummary.cash_whole_day_refunds ?? 0) || 0;
  const totalRefundsActive = activeTab === 'all-day' ? cashWholeDayRefunds : cashShiftRefunds;
  const totalRefundExcActive = refundExcItems.reduce((s, r) => s + (Number(r.jumlah_refund) || 0), 0);
  const totalRefundCombined = (Number(totalRefundsActive) || 0) + totalRefundExcActive;

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
      // Kas Diharapkan = Kas Mulai + Cash Sales; Selisih = Kas Akhir - Kas Diharapkan
      const kasExpectedForShift = kasMulaiActive + cashShiftSales;
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
  const kasExpectedActive = kasMulaiActiveNum + cashShiftSales;
  const kasExpectedDisplay = activeShift ? kasExpectedActive : 0;

  // Calculate total payment method count and total amount (use Number() – API may return strings)
  const totalPaymentCount = paymentBreakdown.reduce(
    (sum, item) => sum + Number(item.transaction_count || 0),
    0
  );
  const totalPaymentAmount = paymentBreakdown.reduce(
    (sum, item) => sum + Number(item.total_amount || 0),
    0
  );

  // Effective total discount: use sum of voucher breakdown when stats.total_discount is 0 but breakdown has values
  const voucherBreakdownSum = VOUCHER_BREAKDOWN_ORDER.reduce(
    (sum, { key }) => sum + (Number(voucherBreakdown[key]?.total) || 0),
    0
  );
  const effectiveTotalDiscount =
    voucherBreakdownSum > 0 ? voucherBreakdownSum : (Number(statistics.total_discount) || 0);

  // Total of cancelled items (sum of total_price) - used for deduction in Category I, II, Paket, Barang Terjual
  const totalCancelledAmount = cancelledItems.reduce((s, i) => s + Number(i.total_price || 0), 0);

  // Gross total omset (before refund & discount) for Ringkasan. Backend statistics.total_amount is already net of cancelled items.
  const grossTotalOmset =
    (Number(statistics.total_amount) || 0) +
    totalRefundCombined +
    effectiveTotalDiscount;
  const totalToppingRevenue = customizationSales.reduce((sum, c) => sum + (c.total_revenue || 0), 0);

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
                    <span className="text-gray-600">Total Omset (sudah dibayar): <strong>Rp 0</strong></span>
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
                      {/* Left Column - LKKH (font size via parent; no text-xs/text-sm so it inherits) */}
                      <div className="space-y-0" style={{ fontSize: '1em' }}>
                        <h3 className="font-semibold text-gray-700 mb-2 pb-1 border-b border-gray-300">LKKH</h3>
                        <table className="w-max border-collapse">
                          <tbody>
                            {(() => {
                              const byCat1 = (name: string) =>
                                category1Breakdown.find((c) => c.category1_name?.toLowerCase() === name.toLowerCase())?.total_amount ?? 0;
                              const byPayment = (code: string) =>
                                paymentBreakdown.find((p) => (p.payment_method_code || '').toLowerCase() === code)?.total_amount ?? 0;
                              const rows: { label: string; value: number; isDeduction?: boolean }[] = [
                                { label: 'Makanan', value: byCat1('Makanan') },
                                { label: 'Minuman', value: byCat1('Minuman') },
                                { label: 'Discount', value: effectiveTotalDiscount, isDeduction: true },
                                { label: 'Refund', value: totalRefundCombined, isDeduction: true },
                                { label: 'GOFOOD', value: byPayment('gofood') },
                                { label: 'SHOPEEFOOD', value: byPayment('shopeefood') },
                                { label: 'GRABFOOD', value: byPayment('grabfood') },
                                { label: 'TRANSFER (DEBIT)', value: byPayment('debit') + byPayment('transfer') },
                                { label: 'QRIS', value: byPayment('qris') + byPayment('qr') },
                                { label: 'CL/CityLedger', value: byPayment('cl') + byPayment('cityledger') },
                              ];
                              return rows.map(({ label, value, isDeduction }) => (
                                <tr key={label} className="border-b border-gray-100">
                                  <td className="py-0.5 pr-1 text-gray-700 whitespace-nowrap">{label}</td>
                                  <td className="py-0.5 px-0.5 text-center text-gray-500 w-px">:</td>
                                  <td className={`py-0.5 pl-1 text-right font-semibold whitespace-nowrap ${isDeduction && value > 0 ? 'text-red-600' : 'text-gray-900'}`}>
                                    {isDeduction && value > 0 ? `-${formatRupiah(value)}` : formatRupiah(value)}
                                  </td>
                                </tr>
                              ));
                            })()}
                          </tbody>
                        </table>
                      </div>

                      {/* Right Column - Transaksi then Kas (stacked) */}
                      <div className="flex flex-col gap-4">
                        {/* Transaksi */}
                        <div className="space-y-0">
                          <h3 className="text-xs font-semibold text-gray-700 mb-2 pb-1 border-b border-gray-300">Transaksi</h3>
                          <div className="rounded-lg bg-amber-50 border border-amber-200/60 mb-2 px-3 py-2">
                            <div className="flex items-center py-1">
                              <span className="text-sm font-semibold text-amber-900">Total Omset <span className="text-xs font-normal text-amber-700/80">(sebelum refund & diskon)</span>:</span>
                              <span className="flex-grow border-b border-dotted border-amber-300 mx-2"></span>
                              <span className="text-sm font-bold text-amber-900">{formatRupiah(grossTotalOmset)}</span>
                            </div>
                          </div>
                          <div className="rounded-lg px-3 py-1.5 mb-2 bg-red-50 border border-red-200">
                            <div className="flex items-center py-1">
                              <span className="text-xs font-semibold text-red-800">Refund:</span>
                              <span className="flex-grow border-b border-dotted border-red-200 mx-2"></span>
                              <span className="text-xs font-bold text-red-700">-{formatRupiah(totalRefundCombined)}</span>
                            </div>
                            <div className="flex items-center py-0.5 pl-4">
                              <span className="text-xs text-red-700">↳ Refund Transaksi:</span>
                              <span className="flex-grow border-b border-dotted border-red-200 mx-2"></span>
                              <span className="text-xs font-semibold text-red-600">-{formatRupiah(Number(totalRefundsActive) || 0)}</span>
                            </div>
                            <div className="flex items-center py-0.5 pl-4">
                              <span className="text-xs text-red-700">↳ Refund Exc.:</span>
                              <span className="flex-grow border-b border-dotted border-red-200 mx-2"></span>
                              <span className="text-xs font-semibold text-red-600">-{formatRupiah(totalRefundExcActive)}</span>
                            </div>
                          </div>
                          <div className="rounded-lg px-3 py-1.5 mb-2 bg-green-50 border border-green-200/60">
                            <div className="flex items-center py-0.5">
                              <span className="text-xs font-semibold text-green-800">Diskon Voucher:</span>
                              <span className="flex-grow border-b border-dotted border-green-200 mx-2"></span>
                              <span className="text-xs font-bold text-green-700">
                                {effectiveTotalDiscount > 0 ? `-${formatRupiah(effectiveTotalDiscount)}` : formatRupiah(0)}
                              </span>
                            </div>
                            {VOUCHER_BREAKDOWN_ORDER.map(({ key, label }) => {
                              const e = voucherBreakdown[key];
                              if (!e || e.count <= 0) return null;
                              return (
                                <div key={key} className="flex items-center py-0.5 pl-4">
                                  <span className="text-xs text-gray-600">{label} ({e.count}):</span>
                                  <span className="flex-grow border-b border-dotted border-gray-200 mx-2"></span>
                                  <span className="text-xs font-semibold text-green-600">-{formatRupiah(e.total)}</span>
                                </div>
                              );
                            })}
                          </div>
                          <div className="flex items-center py-1.5 rounded-lg px-3 bg-gray-100 border border-gray-200">
                            <span className="text-xs font-bold text-gray-800">Grand Total:</span>
                            <span className="flex-grow border-b border-dotted border-gray-300 mx-2"></span>
                            <span className="text-sm font-bold text-gray-900">
                              {formatRupiah(Math.max(0, grossTotalOmset - totalRefundCombined - effectiveTotalDiscount))}
                            </span>
                          </div>
                        </div>

                        {/* Kas */}
                        <div className="space-y-0">
                          <h3 className="text-xs font-semibold text-gray-700 mb-2 pb-1 border-b border-gray-300">Kas</h3>
                          <div className="flex items-center py-0.5">
                            <span className="text-xs text-gray-700">Kas Mulai:</span>
                            <span className="flex-grow border-b border-dotted border-gray-300 mx-2"></span>
                            <span className="text-xs font-semibold text-gray-900">{formatRupiah(kasMulaiActive)}</span>
                          </div>
                          <div className="flex items-center py-0.5">
                            <span className="text-xs text-gray-700">Cash Sales:</span>
                            <span className="flex-grow border-b border-dotted border-gray-300 mx-2"></span>
                            <span className="text-xs font-semibold text-gray-900">{formatRupiah(cashShiftSales)}</span>
                          </div>
                          <div className="flex items-center py-0.5">
                            <span className="text-xs font-semibold text-gray-800">Kas Diharapkan:</span>
                            <span className="flex-grow border-b border-dotted border-gray-300 mx-2"></span>
                            <span className="text-xs font-bold text-purple-700">{formatRupiah(kasExpectedActive)}</span>
                          </div>
                          <div className="border-t border-gray-300 my-1.5" />
                          <div className="flex items-center py-0.5">
                            <span className="text-xs text-gray-700">Jumlah Pesanan:</span>
                            <span className="flex-grow border-b border-dotted border-gray-300 mx-2"></span>
                            <span className="text-xs font-semibold text-gray-900">{statistics.order_count} transaksi</span>
                          </div>
                          <div className="flex items-center py-0.5">
                            <span className="text-xs text-gray-700">Jumlah CU:</span>
                            <span className="flex-grow border-b border-dotted border-gray-300 mx-2"></span>
                            <span className="text-xs font-semibold text-gray-900">{statistics.total_cu ?? 0}</span>
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
                              <th className="px-2 py-2 text-left font-semibold text-gray-700">Issuer</th>
                              <th className="px-2 py-2 text-left font-semibold text-gray-700">Waiter</th>
                              <th className="px-2 py-2 text-left font-semibold text-gray-700">Nama Pelanggan</th>
                            </tr>
                          </thead>
                          <tbody>
                            {refunds.map((refund, idx) => {
                              const refundDate = new Date(refund.refunded_at);
                              const formatDateTime = (date: Date) => {
                                return date.toLocaleString('id-ID', {
                                  year: 'numeric',
                                  month: '2-digit',
                                  day: '2-digit',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                  second: '2-digit',
                                  hour12: false,
                                  timeZone: 'Asia/Jakarta'
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
                                    {refund.issuer_email || '-'}
                                  </td>
                                  <td className="px-2 py-2 text-gray-600">
                                    {refund.waiter_name || '-'}
                                  </td>
                                  <td className="px-2 py-2 text-gray-600">
                                    {refund.customer_name || '-'}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* REFUND EXC. SECTION */}
                  {refundExcItems.length > 0 && (
                    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                      <h2 className="text-base font-semibold text-gray-800 mb-3 text-center">REFUND EXC.</h2>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b-2 border-gray-300 bg-gray-50">
                              <th className="px-2 py-2 text-left font-semibold text-gray-700">Nama</th>
                              <th className="px-2 py-2 text-right font-semibold text-gray-700">Pax</th>
                              <th className="px-2 py-2 text-left font-semibold text-gray-700">Tanggal & Jam</th>
                              <th className="px-2 py-2 text-left font-semibold text-gray-700">No. HP</th>
                              <th className="px-2 py-2 text-left font-semibold text-gray-700">Alasan</th>
                              <th className="px-2 py-2 text-right font-semibold text-gray-700">Jumlah Refund</th>
                              <th className="px-2 py-2 text-left font-semibold text-gray-700">Dibuat Oleh</th>
                            </tr>
                          </thead>
                          <tbody>
                            {refundExcItems.map((row, idx) => {
                              const datePart = row.tanggal ? new Date(row.tanggal).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';
                              const timePart = row.jam ?? '-';
                              const dateTimeStr = row.tanggal && row.jam ? `${datePart}, ${timePart}` : (row.tanggal ? datePart : timePart);
                              return (
                                <tr key={row.uuid_id || idx} className="border-b border-gray-200 hover:bg-gray-50">
                                  <td className="px-2 py-2 text-gray-900">{row.nama ?? '-'}</td>
                                  <td className="px-2 py-2 text-right text-gray-700">{row.pax ?? 0}</td>
                                  <td className="px-2 py-2 text-gray-600">{dateTimeStr}</td>
                                  <td className="px-2 py-2 text-gray-600">{row.no_hp ?? '-'}</td>
                                  <td className="px-2 py-2 text-gray-700">{row.alasan ?? '-'}</td>
                                  <td className="px-2 py-2 text-right text-red-600 font-semibold">-{formatRupiah(Number(row.jumlah_refund) || 0)}</td>
                                  <td className="px-2 py-2 text-gray-600">{row.created_by_email ?? '-'}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                          <tfoot>
                            <tr className="border-t-2 border-gray-300 bg-gray-100 font-semibold">
                              <td className="px-2 py-2 text-gray-800" colSpan={5}>TOTAL</td>
                              <td className="px-2 py-2 text-right text-red-700">-{formatRupiah(totalRefundExcActive)}</td>
                              <td className="px-2 py-2"></td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* ITEM DIBATALKAN - Cancelled items with who cancelled (user/waiter) */}
                  {cancelledItems.length > 0 && (
                    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                      <h2 className="text-base font-semibold text-gray-800 mb-3 text-center">ITEM DIBATALKAN</h2>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b-2 border-gray-300 bg-gray-50">
                              <th className="px-2 py-2 text-left font-semibold text-gray-700">Waktu Pembatalan</th>
                              <th className="px-2 py-2 text-left font-semibold text-gray-700">Item</th>
                              <th className="px-2 py-2 text-right font-semibold text-gray-700">Jumlah</th>
                              <th className="px-2 py-2 text-right font-semibold text-gray-700">Harga</th>
                              <th className="px-2 py-2 text-left font-semibold text-gray-700">Transaksi</th>
                              <th className="px-2 py-2 text-left font-semibold text-gray-700">Pelanggan</th>
                              <th className="px-2 py-2 text-left font-semibold text-gray-700">Dibatalkan Oleh</th>
                            </tr>
                          </thead>
                          <tbody>
                            {cancelledItems.map((item, idx) => {
                              const cancelledDate = new Date(item.cancelled_at);
                              const formatDateTime = (d: Date) =>
                                d.toLocaleString('id-ID', {
                                  year: 'numeric',
                                  month: '2-digit',
                                  day: '2-digit',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                  second: '2-digit',
                                  hour12: false,
                                  timeZone: 'Asia/Jakarta'
                                });
                              const cancelledByDisplay = (() => {
                                const userName = item.cancelled_by_user_name && item.cancelled_by_user_name !== 'Tidak diketahui' ? item.cancelled_by_user_name : null;
                                const waiterName = item.cancelled_by_waiter_name && item.cancelled_by_waiter_name !== 'Tidak diketahui' ? item.cancelled_by_waiter_name : null;
                                if (userName && waiterName && waiterName !== userName)
                                  return `${userName} / Waiters ${waiterName}`;
                                if (userName) return userName;
                                if (waiterName) return `Waiters ${waiterName}`;
                                return '-';
                              })();
                              return (
                                <tr key={`${item.receipt_number}-${item.product_name}-${item.cancelled_at}-${idx}`} className="border-b border-gray-200 hover:bg-gray-50">
                                  <td className="px-2 py-2 text-gray-600">{formatDateTime(cancelledDate)}</td>
                                  <td className="px-2 py-2 text-gray-900">{item.product_name}</td>
                                  <td className="px-2 py-2 text-right text-gray-900">{item.quantity}x</td>
                                  <td className="px-2 py-2 text-right text-gray-900">{formatRupiah(Number(item.total_price || 0))}</td>
                                  <td className="px-2 py-2 text-gray-700 font-mono text-[10px]">#{item.receipt_number || '-'}</td>
                                  <td className="px-2 py-2 text-gray-600">{item.customer_name || 'Guest'}</td>
                                  <td className="px-2 py-2 text-gray-800">{cancelledByDisplay}</td>
                                </tr>
                              );
                            })}
                            <tr className="border-t-2 border-gray-300 bg-gray-100">
                              <td className="py-1 px-2 font-bold text-gray-900">TOTAL</td>
                              <td className="py-1 px-2"></td>
                              <td className="py-1 px-2 text-right font-bold text-gray-900">
                                {cancelledItems.reduce((s, i) => s + i.quantity, 0)}x
                              </td>
                              <td className="py-1 px-2 text-right font-bold text-gray-900">
                                {formatRupiah(totalCancelledAmount)}
                              </td>
                              <td colSpan={3} className="py-1 px-2"></td>
                            </tr>
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
                                hour12: false,
                                timeZone: 'Asia/Jakarta'
                              })}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-black font-medium">Issuer:</span>
                              <span className="text-black">{selectedRefundTransaction.refund.issuer_email || '-'}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-black font-medium">Waiter:</span>
                              <span className="text-black">{selectedRefundTransaction.refund.waiter_name || '-'}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-black font-medium">Nama Pelanggan:</span>
                              <span className="text-black">{selectedRefundTransaction.refund.customer_name || '-'}</span>
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
                                  <td className="py-1 px-2 text-right font-medium text-gray-900">{Number(item.transaction_count || 0)}</td>
                                  <td className="py-1 px-2 text-right font-semibold text-gray-900">{formatRupiah(Number(item.total_amount || 0))}</td>
                                </tr>
                              ))}
                              <tr className="border-t-2 border-gray-300 bg-gray-100">
                                <td className="py-1 px-2 font-bold text-gray-900">TOTAL</td>
                                <td className="py-1 px-2 text-right font-bold text-gray-900">{totalPaymentCount}</td>
                                <td className="py-1 px-2 text-right font-bold text-gray-900">
                                  {formatRupiah(totalPaymentAmount)}
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

                  {/* CATEGORY I */}
                  <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                    <h2 className={`text-base font-semibold text-gray-800 text-center ${totalToppingRevenue > 0 ? 'mb-0.5' : 'mb-2'}`}>CATEGORY I</h2>
                    {totalToppingRevenue > 0 && <p className="text-xs text-gray-500 mb-2 text-center">(tanpa topping)</p>}
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b-2 border-gray-300">
                            <th className="text-left py-1 px-2 font-semibold text-gray-700">Category I</th>
                            <th className="text-right py-1 px-2 font-semibold text-gray-700">Quantity</th>
                            <th className="text-right py-1 px-2 font-semibold text-gray-700">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(() => {
                            const displayData = recalculatedCategory1Breakdown.length > 0
                              ? recalculatedCategory1Breakdown
                              : (productSales.length > 0 ? [] : category1Breakdown);
                            return displayData.length > 0 ? (
                              <>
                                {displayData.map((item, idx) => (
                                  <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                                    <td className="py-1 px-2 text-gray-900 font-medium">{item.category1_name}</td>
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
                                  {productSales.length > 0 ? 'Menghitung...' : 'Tidak ada Category I'}
                                </td>
                              </tr>
                            );
                          })()}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* CATEGORY II */}
                  <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                    <h2 className={`text-base font-semibold text-gray-800 text-center ${totalToppingRevenue > 0 ? 'mb-0.5' : 'mb-2'}`}>CATEGORY II</h2>
                    {totalToppingRevenue > 0 && <p className="text-xs text-gray-500 mb-2 text-center">(tanpa topping)</p>}
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

                  {/* PAKET */}
                  <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                    <h2 className={`text-base font-semibold text-gray-800 text-center ${totalToppingRevenue > 0 ? 'mb-0.5' : 'mb-2'}`}>PAKET</h2>
                    {totalToppingRevenue > 0 && <p className="text-xs text-gray-500 mb-2 text-center">(tanpa topping)</p>}
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b-2 border-gray-300">
                            <th className="text-left py-1 px-2 font-semibold text-gray-700">Paket</th>
                            <th className="text-right py-1 px-2 font-semibold text-gray-700">Qty</th>
                            <th className="text-right py-1 px-2 font-semibold text-gray-700">Unit Price</th>
                            <th className="text-right py-1 px-2 font-semibold text-gray-700">Subtotal</th>
                          </tr>
                        </thead>
                        <tbody>
                          {packageSalesBreakdown.length > 0 ? (
                            <>
                              {packageSalesBreakdown.map((pkg) => (
                                <Fragment key={`pkg-${pkg.package_product_id}`}>
                                  <tr className="border-b border-gray-200 hover:bg-gray-50">
                                    <td className="py-1 px-2 font-medium text-gray-900">{pkg.package_product_name}</td>
                                    <td className="py-1 px-2 text-right font-medium text-gray-900">{pkg.total_quantity}</td>
                                    <td className="py-1 px-2 text-right font-medium text-gray-900">
                                      {formatRupiah(pkg.base_unit_price || (pkg.total_quantity > 0 ? pkg.total_amount / pkg.total_quantity : 0))}
                                    </td>
                                    <td className="py-1 px-2 text-right font-semibold text-gray-900">{formatRupiah(pkg.total_amount)}</td>
                                  </tr>
                                  {(pkg.lines || []).length > 0 ? (
                                    pkg.lines.map((line) => (
                                      <tr key={`pkg-${pkg.package_product_id}-line-${line.product_id}`} className="border-b border-gray-100 hover:bg-gray-50">
                                        <td className="py-1 px-2 text-gray-700">
                                          <div className="pl-4 text-[10px]">• {line.product_name}</div>
                                        </td>
                                        <td className="py-1 px-2 text-right text-[10px] text-gray-700">{line.total_quantity}</td>
                                        <td className="py-1 px-2 text-right text-[10px] text-gray-400">-</td>
                                        <td className="py-1 px-2 text-right text-[10px] text-gray-400">-</td>
                                      </tr>
                                    ))
                                  ) : (
                                    <tr className="border-b border-gray-100">
                                      <td colSpan={4} className="py-2 px-2 text-center text-gray-500 text-[10px]">
                                        Tidak ada data isi paket
                                      </td>
                                    </tr>
                                  )}
                                </Fragment>
                              ))}
                              <tr className="border-t-2 border-gray-300 bg-gray-100">
                                <td className="py-1 px-2 font-bold text-gray-900">TOTAL</td>
                                <td className="py-1 px-2 text-right font-bold text-gray-900">
                                  {packageSalesBreakdown.reduce((sum, p) => sum + Number(p.total_quantity || 0), 0)}
                                </td>
                                <td className="py-1 px-2 text-right font-bold text-gray-900">-</td>
                                <td className="py-1 px-2 text-right font-bold text-gray-900">
                                  {formatRupiah(packageSalesBreakdown.reduce((sum, p) => sum + Number(p.total_amount || 0), 0))}
                                </td>
                              </tr>
                            </>
                          ) : (
                            <tr>
                              <td colSpan={4} className="py-4 text-center text-gray-500">
                                Tidak ada paket terjual
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* BARANG TERJUAL - below Category II */}
                  <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                    <h2 className={`text-base font-semibold text-gray-800 text-center ${totalToppingRevenue > 0 ? 'mb-0.5' : 'mb-2'}`}>BARANG TERJUAL</h2>
                    {totalToppingRevenue > 0 && <p className="text-xs text-gray-500 mb-2 text-center">(tanpa topping)</p>}
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
                                const isGrouped = isGroupedProduct(product);
                                const platformsStr = isGrouped
                                  ? product.platforms
                                    .map((p: string) => formatPlatformLabel(p))
                                    .sort()
                                    .join(', ')
                                  : formatPlatformLabel(product.platform || 'offline');
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
                                      {product.is_bundle_item ? <span className="text-gray-700">-</span> : <span className="text-gray-900">{unitPricesStr || '-'}</span>}
                                    </td>
                                    <td className="py-1 px-2 text-right font-semibold">
                                      {product.is_bundle_item ? <span className="text-gray-700">-</span> : <span className="text-gray-900">{formatRupiah(isGrouped ? product.total_base_subtotal : product.base_subtotal)}</span>}
                                    </td>
                                  </tr>
                                );
                              })}
                              <tr className="border-t-2 border-gray-300 bg-gray-100">
                                <td className="py-1 px-2 font-bold text-gray-900">TOTAL</td>
                                <td className="py-1 px-2 text-right font-bold text-gray-900">
                                  {displayProductSales.reduce((sum, p) => sum + p.total_quantity, 0)}
                                </td>
                                <td className="py-1 px-2 text-right font-bold text-gray-900">-</td>
                                <td className="py-1 px-2 text-right font-bold text-gray-900">
                                  {formatRupiah(displayProductSales.reduce((sum, p) => {
                                    const baseSubtotal = isGroupedProduct(p) ? (p as GroupedProductType).total_base_subtotal : (p as ProductSale).base_subtotal;
                                    return sum + baseSubtotal;
                                  }, 0))}
                                </td>
                              </tr>
                              {barangTerjualByPlatform.map(({ label, qty, amount }) => (
                                <tr key={label} className="border-b border-gray-100">
                                  <td className="py-0.5 px-2 pl-4 text-gray-600 text-xs">{label}</td>
                                  <td className="py-0.5 px-2 text-right text-gray-600 text-xs">{qty}</td>
                                  <td className="py-0.5 px-2 text-right text-gray-400">-</td>
                                  <td className="py-0.5 px-2 text-right font-medium text-gray-800 text-xs">{formatRupiah(amount)}</td>
                                </tr>
                              ))}
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

                  {/* TOPPING SALES BREAKDOWN - only when total > 0 */}
                  {totalToppingRevenue > 0 && (
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
                  )}
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
              {/* Whole Day Option - radio-style: selecting deselects all shifts */}
              <label className="flex items-center space-x-3 cursor-pointer p-3 rounded-lg hover:bg-gray-50 border border-gray-200">
                <input
                  type="checkbox"
                  checked={printWholeDaySelected}
                  onChange={() => {
                    setPrintWholeDaySelected(true);
                    setPrintMonthlySelected(false);
                    setPrintSelections(prev => prev.map(s => ({ ...s, selected: false })));
                  }}
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

              {/* Monthly Option */}
              <label className="flex items-start space-x-3 cursor-pointer p-3 rounded-lg hover:bg-gray-50 border border-gray-200">
                <input
                  type="checkbox"
                  checked={printMonthlySelected}
                  onChange={() => {
                    setPrintMonthlySelected(true);
                    setPrintWholeDaySelected(false);
                    setPrintSelections(prev => prev.map(s => ({ ...s, selected: false })));
                  }}
                  className="w-5 h-5 text-indigo-600 rounded focus:ring-2 focus:ring-indigo-500 mt-0.5"
                />
                <div className="flex-1 min-w-0">
                  <span className="font-semibold text-gray-900">Bulanan (Monthly)</span>
                  <p className="text-sm text-gray-600 mt-1">
                    Laporan satu bulan penuh, atau MTD jika bulan berjalan belum selesai.
                  </p>
                  {printMonthlySelected && (
                    <div className="mt-3 flex items-center gap-2">
                      <span className="text-sm text-gray-700">Bulan:</span>
                      <input
                        type="month"
                        value={printSelectedMonth}
                        onChange={(e) => setPrintSelectedMonth(e.target.value)}
                        className="px-3 py-1.5 border border-gray-300 rounded-md text-sm text-gray-900 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                      />
                      {(() => {
                        const [y, m] = printSelectedMonth.split('-').map(Number);
                        const now = new Date();
                        const gmt7 = new Date(now.getTime() + 7 * 60 * 60 * 1000);
                        const isCurrentMonth = y === gmt7.getUTCFullYear() && m === gmt7.getUTCMonth() + 1;
                        const isMonthFinished = !isCurrentMonth || (gmt7.getUTCDate() === new Date(gmt7.getUTCFullYear(), gmt7.getUTCMonth() + 1, 0).getDate());
                        const isMtd = isCurrentMonth && !isMonthFinished;
                        return (
                          <span className="text-xs text-gray-500">
                            {isMtd ? '(MTD)' : '(Bulan penuh)'}
                          </span>
                        );
                      })()}
                    </div>
                  )}
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
                        if (e.target.checked) {
                          setPrintWholeDaySelected(false);
                          setPrintMonthlySelected(false);
                          setPrintSelections(prev =>
                            prev.map(s => ({ ...s, selected: s.shiftId === selection.shiftId }))
                          );
                        }
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
                className={`overflow-hidden transition-all duration-300 ease-in-out ${showPrintOptions ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
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
                              ringkasan: true,
                              barangTerjual: !isEnabled,
                              paymentMethod: !isEnabled,
                              categoryI: !isEnabled,
                              categoryII: !isEnabled,
                              toppingSales: !isEnabled,
                              itemDibatalkan: !isEnabled
                            });
                          }}
                          className="sr-only"
                        />
                        <div
                          className={`absolute inset-0 rounded-full transition-colors duration-200 ease-in-out ${ringkasanOnly ? 'bg-blue-600' : 'bg-gray-300'
                            }`}
                        >
                          <div
                            className={`absolute top-1 left-1 w-6 h-6 bg-white rounded-full shadow-md transform transition-transform duration-200 ease-in-out ${ringkasanOnly ? 'translate-x-6' : 'translate-x-0'
                              }`}
                          />
                        </div>
                      </div>
                    </label>
                  </div>

                  <p className="text-sm text-gray-600 mb-3">Pilih bagian yang ingin dicetak:</p>

                  <label className={`flex items-center justify-between cursor-pointer p-2 rounded hover:bg-gray-50 ${ringkasanOnly ? 'opacity-50' : ''}`}>
                    <span className="text-sm font-medium text-gray-700">RINGKASAN</span>
                    <input
                      type="checkbox"
                      checked={printSectionOptions.ringkasan}
                      onChange={(e) => {
                        const newValue = e.target.checked;
                        setPrintSectionOptions((prev) => ({ ...prev, ringkasan: newValue }));
                        if (!newValue) setRingkasanOnly(false);
                      }}
                      disabled={ringkasanOnly}
                      className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                  </label>

                  <label className={`flex items-center justify-between cursor-pointer p-2 rounded hover:bg-gray-50 ${ringkasanOnly ? 'opacity-50' : ''}`}>
                    <span className="text-sm font-medium text-gray-700">BARANG TERJUAL</span>
                    <input
                      type="checkbox"
                      checked={printSectionOptions.barangTerjual}
                      onChange={(e) => {
                        const newValue = e.target.checked;
                        setPrintSectionOptions((prev) => ({ ...prev, barangTerjual: newValue }));
                        const allUnchecked = !newValue && !printSectionOptions.paymentMethod && !printSectionOptions.categoryI && !printSectionOptions.categoryII && !printSectionOptions.toppingSales;
                        const allChecked = newValue && printSectionOptions.paymentMethod && printSectionOptions.categoryI && printSectionOptions.categoryII && printSectionOptions.toppingSales;
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
                        setPrintSectionOptions((prev) => ({ ...prev, paymentMethod: newValue }));
                        const allUnchecked = !printSectionOptions.barangTerjual && !newValue && !printSectionOptions.categoryI && !printSectionOptions.categoryII && !printSectionOptions.toppingSales;
                        const allChecked = printSectionOptions.barangTerjual && newValue && printSectionOptions.categoryI && printSectionOptions.categoryII && printSectionOptions.toppingSales;
                        if (allUnchecked) setRingkasanOnly(true);
                        else if (allChecked) setRingkasanOnly(false);
                      }}
                      disabled={ringkasanOnly}
                      className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                  </label>

                  <label className={`flex items-center justify-between cursor-pointer p-2 rounded hover:bg-gray-50 ${ringkasanOnly ? 'opacity-50' : ''}`}>
                    <span className="text-sm font-medium text-gray-700">CATEGORY I</span>
                    <input
                      type="checkbox"
                      checked={printSectionOptions.categoryI}
                      onChange={(e) => {
                        const newValue = e.target.checked;
                        setPrintSectionOptions((prev) => ({ ...prev, categoryI: newValue }));
                        const allUnchecked = !printSectionOptions.barangTerjual && !printSectionOptions.paymentMethod && !newValue && !printSectionOptions.categoryII && !printSectionOptions.toppingSales;
                        const allChecked = printSectionOptions.barangTerjual && printSectionOptions.paymentMethod && newValue && printSectionOptions.categoryII && printSectionOptions.toppingSales;
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
                        setPrintSectionOptions((prev) => ({ ...prev, categoryII: newValue }));
                        const allUnchecked = !printSectionOptions.barangTerjual && !printSectionOptions.paymentMethod && !printSectionOptions.categoryI && !newValue && !printSectionOptions.toppingSales;
                        const allChecked = printSectionOptions.barangTerjual && printSectionOptions.paymentMethod && printSectionOptions.categoryI && newValue && printSectionOptions.toppingSales;
                        if (allUnchecked) setRingkasanOnly(true);
                        else if (allChecked) setRingkasanOnly(false);
                      }}
                      disabled={ringkasanOnly}
                      className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                  </label>

                  <label className={`flex items-center justify-between cursor-pointer p-2 rounded hover:bg-gray-50 ${ringkasanOnly ? 'opacity-50' : ''}`}>
                    <span className="text-sm font-medium text-gray-700">TOPPING SALES</span>
                    <input
                      type="checkbox"
                      checked={printSectionOptions.toppingSales}
                      onChange={(e) => {
                        const newValue = e.target.checked;
                        setPrintSectionOptions((prev) => ({ ...prev, toppingSales: newValue }));
                        const allUnchecked = !printSectionOptions.barangTerjual && !printSectionOptions.paymentMethod && !printSectionOptions.categoryI && !printSectionOptions.categoryII && !newValue;
                        const allChecked = printSectionOptions.barangTerjual && printSectionOptions.paymentMethod && printSectionOptions.categoryI && printSectionOptions.categoryII && newValue;
                        if (allUnchecked) setRingkasanOnly(true);
                        else if (allChecked) setRingkasanOnly(false);
                      }}
                      disabled={ringkasanOnly}
                      className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                  </label>

                  <label className={`flex items-center justify-between cursor-pointer p-2 rounded hover:bg-gray-50 ${ringkasanOnly ? 'opacity-50' : ''}`}>
                    <span className="text-sm font-medium text-gray-700">ITEM DIBATALKAN</span>
                    <input
                      type="checkbox"
                      checked={printSectionOptions.itemDibatalkan}
                      onChange={(e) => {
                        setPrintSectionOptions((prev) => ({ ...prev, itemDibatalkan: e.target.checked }));
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
                  setPrintMonthlySelected(false);
                  setPrintSelections(prev => prev.map(s => ({ ...s, selected: false })));
                }}
                disabled={isPrintingSelected}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors"
              >
                Batal
              </button>
              <button
                onClick={handlePrintSelected}
                disabled={isPrintingSelected || (!printWholeDaySelected && !printMonthlySelected && printSelections.filter(s => s.selected).length === 0)}
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
                    <span>Print ({printWholeDaySelected || printMonthlySelected ? 1 : printSelections.filter(s => s.selected).length})</span>
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
                className={`overflow-hidden transition-all duration-300 ease-in-out ${showPrintOptions ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
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
                              ringkasan: true,
                              barangTerjual: !isEnabled,
                              paymentMethod: !isEnabled,
                              categoryI: !isEnabled,
                              categoryII: !isEnabled,
                              toppingSales: !isEnabled,
                              itemDibatalkan: !isEnabled
                            });
                          }}
                          className="sr-only"
                        />
                        <div
                          className={`absolute inset-0 rounded-full transition-colors duration-200 ease-in-out ${ringkasanOnly ? 'bg-blue-600' : 'bg-gray-300'
                            }`}
                        >
                          <div
                            className={`absolute top-1 left-1 w-6 h-6 bg-white rounded-full shadow-md transform transition-transform duration-200 ease-in-out ${ringkasanOnly ? 'translate-x-6' : 'translate-x-0'
                              }`}
                          />
                        </div>
                      </div>
                    </label>
                  </div>

                  <p className="text-sm text-gray-600 mb-3">Pilih bagian yang ingin dicetak:</p>

                  <label className={`flex items-center justify-between cursor-pointer p-2 rounded hover:bg-gray-50 ${ringkasanOnly ? 'opacity-50' : ''}`}>
                    <span className="text-sm font-medium text-gray-700">RINGKASAN</span>
                    <input
                      type="checkbox"
                      checked={printSectionOptions.ringkasan}
                      onChange={(e) => {
                        setPrintSectionOptions((prev) => ({ ...prev, ringkasan: e.target.checked }));
                        if (!e.target.checked) setRingkasanOnly(false);
                      }}
                      disabled={ringkasanOnly}
                      className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                  </label>

                  <label className={`flex items-center justify-between cursor-pointer p-2 rounded hover:bg-gray-50 ${ringkasanOnly ? 'opacity-50' : ''}`}>
                    <span className="text-sm font-medium text-gray-700">BARANG TERJUAL</span>
                    <input
                      type="checkbox"
                      checked={printSectionOptions.barangTerjual}
                      onChange={(e) => {
                        const newValue = e.target.checked;
                        setPrintSectionOptions((prev) => ({ ...prev, barangTerjual: newValue }));
                        const allUnchecked = !newValue && !printSectionOptions.paymentMethod && !printSectionOptions.categoryI && !printSectionOptions.categoryII && !printSectionOptions.toppingSales;
                        const allChecked = newValue && printSectionOptions.paymentMethod && printSectionOptions.categoryI && printSectionOptions.categoryII && printSectionOptions.toppingSales;
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
                        setPrintSectionOptions((prev) => ({ ...prev, paymentMethod: newValue }));
                        const allUnchecked = !printSectionOptions.barangTerjual && !newValue && !printSectionOptions.categoryI && !printSectionOptions.categoryII && !printSectionOptions.toppingSales;
                        const allChecked = printSectionOptions.barangTerjual && newValue && printSectionOptions.categoryI && printSectionOptions.categoryII && printSectionOptions.toppingSales;
                        if (allUnchecked) setRingkasanOnly(true);
                        else if (allChecked) setRingkasanOnly(false);
                      }}
                      disabled={ringkasanOnly}
                      className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                  </label>

                  <label className={`flex items-center justify-between cursor-pointer p-2 rounded hover:bg-gray-50 ${ringkasanOnly ? 'opacity-50' : ''}`}>
                    <span className="text-sm font-medium text-gray-700">CATEGORY I</span>
                    <input
                      type="checkbox"
                      checked={printSectionOptions.categoryI}
                      onChange={(e) => {
                        const newValue = e.target.checked;
                        setPrintSectionOptions((prev) => ({ ...prev, categoryI: newValue }));
                        const allUnchecked = !printSectionOptions.barangTerjual && !printSectionOptions.paymentMethod && !newValue && !printSectionOptions.categoryII && !printSectionOptions.toppingSales;
                        const allChecked = printSectionOptions.barangTerjual && printSectionOptions.paymentMethod && newValue && printSectionOptions.categoryII && printSectionOptions.toppingSales;
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
                        setPrintSectionOptions((prev) => ({ ...prev, categoryII: newValue }));
                        const allUnchecked = !printSectionOptions.barangTerjual && !printSectionOptions.paymentMethod && !printSectionOptions.categoryI && !newValue && !printSectionOptions.toppingSales;
                        const allChecked = printSectionOptions.barangTerjual && printSectionOptions.paymentMethod && printSectionOptions.categoryI && newValue && printSectionOptions.toppingSales;
                        if (allUnchecked) setRingkasanOnly(true);
                        else if (allChecked) setRingkasanOnly(false);
                      }}
                      disabled={ringkasanOnly}
                      className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                  </label>

                  <label className={`flex items-center justify-between cursor-pointer p-2 rounded hover:bg-gray-50 ${ringkasanOnly ? 'opacity-50' : ''}`}>
                    <span className="text-sm font-medium text-gray-700">TOPPING SALES</span>
                    <input
                      type="checkbox"
                      checked={printSectionOptions.toppingSales}
                      onChange={(e) => {
                        const newValue = e.target.checked;
                        setPrintSectionOptions((prev) => ({ ...prev, toppingSales: newValue }));
                        const allUnchecked = !printSectionOptions.barangTerjual && !printSectionOptions.paymentMethod && !printSectionOptions.categoryI && !printSectionOptions.categoryII && !newValue;
                        const allChecked = printSectionOptions.barangTerjual && printSectionOptions.paymentMethod && printSectionOptions.categoryI && printSectionOptions.categoryII && newValue;
                        if (allUnchecked) setRingkasanOnly(true);
                        else if (allChecked) setRingkasanOnly(false);
                      }}
                      disabled={ringkasanOnly}
                      className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                  </label>

                  <label className={`flex items-center justify-between cursor-pointer p-2 rounded hover:bg-gray-50 ${ringkasanOnly ? 'opacity-50' : ''}`}>
                    <span className="text-sm font-medium text-gray-700">ITEM DIBATALKAN</span>
                    <input
                      type="checkbox"
                      checked={printSectionOptions.itemDibatalkan}
                      onChange={(e) => {
                        setPrintSectionOptions((prev) => ({ ...prev, itemDibatalkan: e.target.checked }));
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
                <span className="text-gray-800 font-medium">Jumlah Pesanan:</span>
                <span className="font-semibold text-gray-900">{statistics.order_count} transaksi</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-800 font-medium">Jumlah CU:</span>
                <span className="font-semibold text-gray-900">{statistics.total_cu ?? 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-800 font-medium">Total Omset <span className="text-gray-500 font-normal">(sudah dibayar)</span>:</span>
                <span className="font-semibold text-gray-900">{formatRupiah(statistics.total_amount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-800 font-medium">Voucher Dipakai:</span>
                <span className="font-semibold text-gray-900">{statistics.voucher_count} transaksi</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-800 font-medium">Total Diskon Voucher:</span>
                <span className="font-semibold text-green-700">
                  {effectiveTotalDiscount > 0 ? formatRupiah(-effectiveTotalDiscount) : formatRupiah(0)}
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
                <span className="text-gray-800 font-medium">Jumlah Pesanan:</span>
                <span className="font-semibold text-gray-900">{statistics.order_count} transaksi</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-800 font-medium">Jumlah CU:</span>
                <span className="font-semibold text-gray-900">{statistics.total_cu ?? 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-800 font-medium">Total Omset <span className="text-gray-500 font-normal">(sudah dibayar)</span>:</span>
                <span className="font-semibold text-gray-900">{formatRupiah(statistics.total_amount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-800 font-medium">Cash:</span>
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
                    className={`absolute inset-0 rounded-full transition-colors duration-200 ease-in-out ${groupProducts ? 'bg-blue-600' : 'bg-gray-300'
                      }`}
                  >
                    <div
                      className={`absolute top-1 left-1 w-6 h-6 bg-white rounded-full shadow-md transform transition-transform duration-200 ease-in-out ${groupProducts ? 'translate-x-6' : 'translate-x-0'
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

