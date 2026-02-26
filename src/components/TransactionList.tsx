'use client';

import { useState, useEffect, useCallback, useRef, useLayoutEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Clock, CreditCard, RefreshCw, Search, Filter, ChevronUp, ChevronDown, ChevronRight, Wifi, WifiOff, Calendar, X, Trash2, Columns } from 'lucide-react';
import TransactionDetailModal, { TransactionDetail, TransactionRefund } from './TransactionDetailModal';
import Printer1ToPrinter2Manager from './Printer1ToPrinter2Manager';
import { useAuth } from '@/hooks/useAuth';
import { appAlert } from '@/components/AppDialog';
import { hasPermission } from '@/lib/permissions';
import { isSuperAdmin } from '@/lib/auth';

// Format price for display (hoisted to module scope so it can be reused)
const formatPrice = (price: number | string) => {
  const numPrice = typeof price === 'string' ? parseFloat(price) : price;
  if (isNaN(numPrice)) return 'Rp 0';
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(numPrice);
};

// Amount range filter: parse display string (e.g. "Rp 100.000") to number; null if empty/invalid
const parseAmountDisplay = (s: string): number | null => {
  if (!s || typeof s !== 'string') return null;
  const digits = s.replace(/\D/g, '');
  if (digits.length === 0) return null;
  const n = parseInt(digits, 10);
  return isNaN(n) ? null : n;
};

interface Transaction {
  id: string; // Changed to string for UUID
  business_id: number;
  user_id: number;
  waiter_id?: number | null;
  shift_uuid?: string | null; // Added shift_uuid
  payment_method: 'cash' | 'debit' | 'qr' | 'ewallet' | 'cl' | 'voucher' | 'qpon' | 'gofood' | 'grabfood' | 'shopeefood' | 'tiktok';
  payment_method_id?: number; // Source of truth - foreign key to payment_methods table
  pickup_method: 'dine-in' | 'take-away';
  total_amount: number;
  voucher_discount: number;
  final_amount: number;
  amount_received: number;
  change_amount: number;
  contact_id: number | null;
  customer_name: string | null;
  customer_unit?: number | null;
  note: string | null;
  receipt_number: number | null;
  transaction_type: 'drinks' | 'bakery';
  status: string;
  created_at: string;
  updated_at?: string | null;
  paid_at?: string | null;
  user_name?: string;
  business_name?: string;
  voucher_type?: 'none' | 'percent' | 'nominal' | 'free';
  voucher_value?: number | null;
  voucher_label?: string | null;
  refund_status?: string | null;
  refund_total?: number | null;
}

/** Column keys and labels for Daftar Transaksi. Order defines table column order. */
const TRANSACTION_COLUMNS: Array<{ key: string; label: string; sortKey: string | null }> = [
  { key: 'receipt_number', label: '#', sortKey: 'receipt_number' },
  { key: 'created_at', label: 'Waktu Dibuat', sortKey: 'created_at' },
  { key: 'updated_at', label: 'Updated at', sortKey: 'updated_at' },
  { key: 'paid_at', label: 'Paid at', sortKey: 'paid_at' },
  { key: 'payment_method', label: 'Metode', sortKey: 'payment_method' },
  { key: 'pickup_method', label: 'DI/TA', sortKey: 'pickup_method' },
  { key: 'package', label: 'Pkg', sortKey: null },
  { key: 'total_amount', label: 'Total', sortKey: 'total_amount' },
  { key: 'voucher_discount', label: 'Disc/Vc', sortKey: 'voucher_discount' },
  { key: 'final_amount', label: 'Final', sortKey: 'final_amount' },
  { key: 'refund_total', label: 'Refund', sortKey: 'refund_total' },
  { key: 'customer_name', label: 'Pelanggan', sortKey: 'customer_name' },
  { key: 'waiter', label: 'Waiter', sortKey: null },
  { key: 'user_name', label: 'Kasir', sortKey: 'user_name' },
  { key: 'shift', label: 'Shift', sortKey: null },
  { key: 'actions', label: '→', sortKey: null },
];

const COLUMN_VISIBILITY_STORAGE_KEY = 'transactionListColumnVisibility';

function getDefaultColumnVisibility(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  const hiddenByDefault = new Set(['updated_at', 'package']);
  TRANSACTION_COLUMNS.forEach((c) => { out[c.key] = !hiddenByDefault.has(c.key); });
  return out;
}

function loadColumnVisibility(): Record<string, boolean> {
  if (typeof window === 'undefined') return getDefaultColumnVisibility();
  try {
    const raw = localStorage.getItem(COLUMN_VISIBILITY_STORAGE_KEY);
    if (!raw) return getDefaultColumnVisibility();
    const parsed = JSON.parse(raw) as Record<string, boolean>;
    const def = getDefaultColumnVisibility();
    TRANSACTION_COLUMNS.forEach((c) => {
      if (typeof parsed[c.key] === 'boolean') def[c.key] = parsed[c.key];
    });
    // Always apply default visibility for columns that should be hidden by default (overrides old saved prefs)
    const defaults = getDefaultColumnVisibility();
    def['updated_at'] = defaults.updated_at;
    def['package'] = defaults.package;
    return def;
  } catch {
    return getDefaultColumnVisibility();
  }
}

interface TransactionListProps {
  businessId?: number;
  onLoadTransaction?: (transactionId: string) => void;
}

// Types for electron API responses
interface ElectronTransaction {
  id: string;
  business_id: number;
  user_id: number;
  waiter_id?: number | null;
  payment_method: string;
  pickup_method: string;
  total_amount: number;
  voucher_discount: number;
  voucher_type: string;
  voucher_value: number | null;
  voucher_label: string | null;
  final_amount: number;
  amount_received: number;
  change_amount: number;
  contact_id: number | null;
  customer_name: string | null;
  customer_unit: number | null;
  note: string | null;
  receipt_number: number | null;
  transaction_type: string;
  status: string;
  created_at: string;
  updated_at?: string | null;
  paid_at?: string | null;
  shift_uuid?: string;
  refund_total?: number | null;
  refund_status?: string | null;
}

interface ElectronUser {
  id: number;
  name: string;
}

interface ElectronBusiness {
  id: number;
  name: string;
}

interface ElectronProduct {
  id: number;
  nama: string;
}

interface ElectronTransactionItem {
  id: string;
  product_id: number;
  product_name?: string; // Added: product name from JOIN with products table
  quantity: number;
  unit_price: number;
  total_price: number;
  custom_note?: string;
  production_status?: string | null; // Production status (e.g., 'cancelled', 'pending', 'completed')
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

// Type for window.electronAPI
interface ElectronAPI {
  localDbGetTransactions: (businessId: number, limit: number) => Promise<ElectronTransaction[]>;
  localDbGetTransactionItems: (transactionId: string) => Promise<ElectronTransactionItem[]>;
  localDbGetTransactionRefunds: (transactionId: string) => Promise<TransactionRefund[]>;
  localDbGetAllProducts: (businessId?: number) => Promise<ElectronProduct[]>;
  localDbGetUsers: () => Promise<ElectronUser[]>;
  localDbGetBusinesses: () => Promise<ElectronBusiness[]>;
  localDbGetEmployees?: () => Promise<Array<{ id: number | string; nama_karyawan?: string }>>;
  getPrinter1AuditLog?: (fromDate?: string, toDate?: string, limit?: number) => Promise<{ entries: Array<{ transaction_id?: string; printer1_receipt_number?: number; printed_at_epoch?: number; is_reprint?: number }> }>;
  getPrinter2AuditLog: (fromDate?: string, toDate?: string, limit?: number) => Promise<{ entries: Array<{ transaction_id?: string; printer2_receipt_number?: number; printed_at_epoch?: number; is_reprint?: number }> }>;
  navigateTo?: (path: string) => void;
  // System POS database handlers
  localDbGetSystemPosTransactions?: (businessId?: number, limit?: number) => Promise<ElectronTransaction[]>;
  localDbGetSystemPosTransactionItems?: (transactionId?: number | string) => Promise<ElectronTransactionItem[]>;
  localDbGetSystemPosTransactionRefunds?: (transactionUuid: string) => Promise<TransactionRefund[]>;
  localDbGetSystemPosUsers?: () => Promise<ElectronUser[]>;
  localDbGetSystemPosBusinesses?: () => Promise<ElectronBusiness[]>;
  localDbGetSystemPosAllProducts?: (businessId?: number) => Promise<ElectronProduct[]>;
  localDbGetSystemPosEmployees?: () => Promise<Array<{ id: number | string; nama_karyawan?: string; color?: string | null }>>;
  localDbGetShifts?: (filters?: { businessId?: number; startDate?: string; endDate?: string; limit?: number }) => Promise<{ shifts: Array<{ uuid_id?: string; shift_start?: string; user_name?: string }> }>;
  localDbGetActiveShift?: (userId: number, businessId?: number) => Promise<{ shift?: { uuid_id?: string; shift_start?: string } | null }>;
  localDbUpdateTransactionShift?: (transactionUuid: string, shiftUuid: string | null) => Promise<{ success: boolean; error?: string }>;
  localDbUpdateTransactionUser?: (transactionId: string, userId: number, useSystemPos?: boolean) => Promise<{ success: boolean; error?: string }>;
  localDbDeleteSingleTransactionPreview?: (transactionUuid: string) => Promise<{
    success: boolean;
    error?: string;
    transactionUuid?: string;
    queries?: Array<{ sql: string; params: (string | number)[]; description: string }>;
    systemPosQueries?: Array<{ sql: string; params: (string | number)[]; description: string }>;
  }>;
  localDbDeleteSingleTransaction?: (transactionUuid: string) => Promise<{ success: boolean; error?: string }>;
  localDbGetPackageLines?: (uuidTransactionItemIds: string[]) => Promise<Array<{ id: number; uuid_transaction_item_id: string; product_id: number; quantity: number; finished_at: string | null }>>;
  localDbGetTransactionIdsWithPackage?: (transactionIds: string[]) => Promise<string[]>;
  localDbGetShiftCancelledItems?: (userId: number | null, shiftStart: string, shiftEnd: string | null, businessId?: number, shiftUuid?: string | null, shiftUuids?: string[]) => Promise<Array<{
    product_name: string;
    quantity: number;
    unit_price: number;
    total_price: number;
    cancelled_at: string;
    cancelled_by_user_name: string;
    cancelled_by_waiter_name: string;
    receipt_number?: string | null;
    customer_name?: string | null;
  }>>;
  localDbGetRefundTotal?: (businessId: number | null, shiftStart: string, shiftEnd: string | null) => Promise<number>;
  localDbGetProductSales?: (userId: number | null, shiftStart: string, shiftEnd: string | null, businessId?: number, shiftUuid?: string | null, shiftUuids?: string[]) => Promise<{
    products: Array<{
      product_id: number;
      product_name: string;
      product_code: string;
      category1_id: number | null;
      category1_name: string;
      platform: string;
      transaction_type: string;
      total_quantity: number;
      total_subtotal: number;
      total_subtotal_after_refund?: number;
      customization_subtotal: number;
      base_subtotal: number;
      base_unit_price: number;
      is_bundle_item?: boolean;
    }>;
    customizations: Array<{
      option_id: number;
      option_name: string;
      customization_id: number;
      customization_name: string;
      total_quantity: number;
      total_revenue: number;
    }>;
  }>;
}

export default function TransactionList({ businessId, onLoadTransaction }: TransactionListProps) {
  const router = useRouter();
  const { user } = useAuth();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterMethod, setFilterMethod] = useState<string>('all');
  const [amountFrom, setAmountFrom] = useState<string>('');
  const [amountTo, setAmountTo] = useState<string>('');
  const [shiftFilterUuid, setShiftFilterUuid] = useState<string>(''); // '' = All, 'none' = No shift, else shift uuid (for all users)
  const [transactionIdsWithPackage, setTransactionIdsWithPackage] = useState<Set<string>>(new Set());

  // Grand Total aligned with Penjualan Produk: same APIs (product sales + refund total) for same date range
  const [reportTotals, setReportTotals] = useState<{
    gross: number;
    discount: number;
    refund: number;
    net: number;
  } | null>(null);

  // Cancelled items (for "Item Dibatalkan" card + modal). API returns uuid_transaction_id/transaction_id for mode filtering.
  type CancelledItemRow = {
    product_name: string;
    quantity: number;
    unit_price: number;
    total_price: number;
    cancelled_at: string;
    cancelled_by_user_name: string;
    cancelled_by_waiter_name: string;
    receipt_number?: string | null;
    customer_name?: string | null;
    uuid_transaction_id?: string | null;
    transaction_id?: number | string | null;
  };
  const [cancelledItems, setCancelledItems] = useState<CancelledItemRow[]>([]);
  const [showCancelledModal, setShowCancelledModal] = useState(false);

  // Use businessId from props, or fallback to user's selectedBusinessId
  const effectiveBusinessId = businessId ?? user?.selectedBusinessId;

  if (!effectiveBusinessId) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
        <p className="text-red-700">No business selected. Please log in and select a business.</p>
      </div>
    );
  }
  const [sortField, setSortField] = useState<string>('created_at');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [receiptizePrintedIds, setReceiptizePrintedIds] = useState<Set<string>>(() => new Set());
  const [receiptizeCounters, setReceiptizeCounters] = useState<Record<string, number>>({});
  const [receiptCounters, setReceiptCounters] = useState<Record<string, number>>({});
  /** Maps shift uuid -> { filterLabel, cellLabel }. filterLabel for dropdown (e.g. "Hari ini | Shift 1"); cellLabel for table cells (e.g. "03/08/26 Shift 1"). */
  const [shiftLabelByUuid, setShiftLabelByUuid] = useState<Record<string, { filterLabel: string; cellLabel: string }>>({});
  const [showAllTransactions, setShowAllTransactions] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [voucherClickCount, setVoucherClickCount] = useState(0);
  const [showPrintingLogs, setShowPrintingLogs] = useState(false);
  const [employeesMap, setEmployeesMap] = useState<Map<number, { name: string; color: string | null }>>(new Map());
  const [itemWaiterIdsByTx, setItemWaiterIdsByTx] = useState<Record<string, number[]>>({});
  const [openWaiterPopoverFor, setOpenWaiterPopoverFor] = useState<string | null>(null);
  const waiterTriggerRef = useRef<HTMLButtonElement | null>(null);
  const waiterPopoverRef = useRef<HTMLDivElement>(null);
  const [waiterPopoverPos, setWaiterPopoverPos] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    if (openWaiterPopoverFor === null) {
      setWaiterPopoverPos(null);
      return;
    }
    const el = waiterTriggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const popoverH = 120;
    const showAbove = rect.bottom + popoverH > window.innerHeight;
    setWaiterPopoverPos({
      top: showAbove ? rect.top - popoverH - 4 : rect.bottom + 4,
      left: rect.left + rect.width / 2,
    });
  }, [openWaiterPopoverFor]);
  useEffect(() => {
    if (openWaiterPopoverFor === null) return;
    const close = (e: MouseEvent) => {
      const target = e.target as Node;
      if (waiterTriggerRef.current?.contains(target) || waiterPopoverRef.current?.contains(target)) return;
      setOpenWaiterPopoverFor(null);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [openWaiterPopoverFor]);
  const [headerClickCount, setHeaderClickCount] = useState(0);
  const [showPrinterManager, setShowPrinterManager] = useState(false);
  const headerClickTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [showBindShiftModal, setShowBindShiftModal] = useState(false);
  const [transactionToBind, setTransactionToBind] = useState<Transaction | null>(null);
  const [bindShiftList, setBindShiftList] = useState<Array<{ uuid_id: string; shift_start: string; user_name: string }>>([]);
  const [isLoadingBindShifts, setIsLoadingBindShifts] = useState(false);
  const [selectedBindShiftUuid, setSelectedBindShiftUuid] = useState<string | null>(null);
  const [isSavingBindShift, setIsSavingBindShift] = useState(false);
  const [bindShiftError, setBindShiftError] = useState<string | null>(null);
  const [showDeleteTxModal, setShowDeleteTxModal] = useState(false);
  const [transactionToDelete, setTransactionToDelete] = useState<Transaction | null>(null);
  const [deletePreview, setDeletePreview] = useState<{ queries: Array<{ sql: string; params: (string | number)[]; description: string }>; systemPosQueries: Array<{ sql: string; params: (string | number)[]; description: string }> } | null>(null);
  const [isLoadingDeletePreview, setIsLoadingDeletePreview] = useState(false);
  const [isDeletingTx, setIsDeletingTx] = useState(false);
  const [deleteTxError, setDeleteTxError] = useState<string | null>(null);
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>(loadColumnVisibility);
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const columnPickerRef = useRef<HTMLDivElement>(null);
  const [usersList, setUsersList] = useState<ElectronUser[]>([]);
  const [openKasirFor, setOpenKasirFor] = useState<string | null>(null);
  const [savingKasirFor, setSavingKasirFor] = useState<string | null>(null);
  const kasirDropdownRef = useRef<HTMLDivElement>(null);
  const kasirTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [kasirDropdownPos, setKasirDropdownPos] = useState<{ top: number; left: number } | null>(null);
  /** Employees with user_id and business_id for filtering Kasir dropdown by selected business */
  const [employeesWithBusiness, setEmployeesWithBusiness] = useState<Array<{ user_id: number | null; business_id: number }>>([]);

  /** Users that are employees for the selected business only (for Ganti Kasir dropdown) */
  const kasirOptionsForBusiness = useMemo(() => {
    const allowedUserIds = new Set(
      employeesWithBusiness
        .filter((e) => e.business_id === effectiveBusinessId && e.user_id != null)
        .map((e) => e.user_id as number)
    );
    return usersList.filter((u) => allowedUserIds.has(u.id));
  }, [usersList, employeesWithBusiness, effectiveBusinessId]);

  // Persist column visibility to localStorage when it changes
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(COLUMN_VISIBILITY_STORAGE_KEY, JSON.stringify(columnVisibility));
    } catch {
      // ignore
    }
  }, [columnVisibility]);

  // Close column picker on click outside
  useEffect(() => {
    if (!showColumnPicker) return;
    const handleClick = (e: MouseEvent) => {
      if (columnPickerRef.current && !columnPickerRef.current.contains(e.target as Node)) {
        setShowColumnPicker(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showColumnPicker]);

  // Position Kasir dropdown and close on click outside
  useLayoutEffect(() => {
    if (openKasirFor === null) {
      setKasirDropdownPos(null);
      return;
    }
    const el = kasirTriggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setKasirDropdownPos({
      top: rect.bottom + 4,
      left: rect.left + rect.width / 2,
    });
  }, [openKasirFor]);

  useEffect(() => {
    if (openKasirFor === null) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (kasirTriggerRef.current?.contains(target) || kasirDropdownRef.current?.contains(target)) return;
      setOpenKasirFor(null);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [openKasirFor]);

  // Get today's date in UTC+7 timezone
  // Import from shared utility for consistency
  const getTodayUTC7 = () => {
    const now = new Date();
    const utc7Time = new Date(now.getTime() + (7 * 60 * 60 * 1000));
    return utc7Time.toISOString().split('T')[0];
  };

  const [fromDate, setFromDate] = useState<string>(getTodayUTC7());
  const [toDate, setToDate] = useState<string>(getTodayUTC7());
  const [selectedTransaction, setSelectedTransaction] = useState<TransactionDetail | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [loadingTransactionId, setLoadingTransactionId] = useState<string | null>(null);
  const [copiedUuid, setCopiedUuid] = useState<string | null>(null);
  // Default to offline mode (salespulse DB)
  const [isSystemPosMode, setIsSystemPosMode] = useState(false);

  // Permission checks
  const canViewPastData = hasPermission(user, 'daftartransaksi.viewpastdata');
  const canViewUserDataOnly = hasPermission(user, 'daftartransaksi.viewuserdataonly');
  const canViewAllData = hasPermission(user, 'daftartransaksi.viewalldata');
  const canViewPrintingLogs = hasPermission(user, 'daftartransaksi.viewprintinglogs');
  const canViewOfflineSystemPosSwitch = isSuperAdmin(user); // Only super admin can see the switch
  const canRefund = isSuperAdmin(user) || hasPermission(user, 'daftartransaksi.refund');
  const canAccessPrinterManager = isSuperAdmin(user) || hasPermission(user, 'access_printer1printer2manager');
  const canBindToShift = isSuperAdmin(user);
  const canDeleteTransaction = isSuperAdmin(user);
  const canChangeTransactionUser = isSuperAdmin(user) || hasPermission(user, 'daftartransaksi.changekasir');

  const visibleColumns = TRANSACTION_COLUMNS.filter((c) => {
    if (columnVisibility[c.key] === false) return false;
    if (isSystemPosMode && c.key === 'receipt_number') return false; // No # column in system_pos
    return true;
  });

  const setColumnVisible = (key: string, visible: boolean) => {
    setColumnVisibility((prev) => ({ ...prev, [key]: visible }));
  };

  // Check for conflicting permissions (Super Admin bypasses this check)
  const hasConflictingPermissions = !isSuperAdmin(user) && canViewUserDataOnly && canViewAllData;

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (headerClickTimeoutRef.current) {
        clearTimeout(headerClickTimeoutRef.current);
      }
    };
  }, []);
  const fetchTransactionDetail = async (transactionId: string) => {
    setIsLoadingDetail(true);
    try {
      if (typeof window === 'undefined' || !(window as { electronAPI?: ElectronAPI }).electronAPI) {
        throw new Error('Database not available');
      }

      const electronAPI = (window as { electronAPI: ElectronAPI }).electronAPI;
      const useSystemPos = isSystemPosMode;

      // Get transaction from appropriate database
      const transactions: ElectronTransaction[] = useSystemPos && electronAPI.localDbGetSystemPosTransactions
        ? await electronAPI.localDbGetSystemPosTransactions(effectiveBusinessId, 1000)
        : await electronAPI.localDbGetTransactions(effectiveBusinessId, 1000);

      // Try to find transaction by ID (UUID) or receipt_number
      let transaction = transactions.find((tx) => {
        return String(tx.id) === String(transactionId);
      });

      // If not found by ID, try by receipt_number
      if (!transaction) {
        transaction = transactions.find((tx) => {
          return tx.receipt_number !== null && String(tx.receipt_number) === String(transactionId);
        });
      }

      if (!transaction) {
        console.error(`❌ [TransactionList] Transaction not found in ${useSystemPos ? 'system_pos' : 'offline'} database:`, {
          transactionId,
          availableIds: transactions.slice(0, 5).map(tx => ({ id: String(tx.id), receipt_number: tx.receipt_number }))
        });
        throw new Error(`Transaction not found in ${useSystemPos ? 'system_pos' : 'offline'} database`);
      }

      // Get the actual UUID from the transaction (id field should be UUID)
      const transactionUuid = transaction.id;

      // Get transaction items from appropriate database
      const allItems: ElectronTransactionItem[] = useSystemPos && electronAPI.localDbGetSystemPosTransactionItems
        ? await electronAPI.localDbGetSystemPosTransactionItems(transactionUuid)
        : await electronAPI.localDbGetTransactionItems(transactionUuid);

      // Include all items, including cancelled ones, so they can be shown in the detail modal
      const items: ElectronTransactionItem[] = allItems;

      // Fetch package lines from transaction_item_package_lines table
      const itemUuids = items.map((item) => (item as { uuid_id?: string; id?: string }).uuid_id || (item as { uuid_id?: string; id?: string }).id).filter(Boolean) as string[];
      const packageLinesByItem = new Map<string, Array<{ product_id: number; quantity: number }>>();
      if (itemUuids.length > 0 && electronAPI.localDbGetPackageLines) {
        try {
          const packageLines = await electronAPI.localDbGetPackageLines(itemUuids);
          for (const line of packageLines) {
            const itemUuid = line.uuid_transaction_item_id;
            if (!packageLinesByItem.has(itemUuid)) {
              packageLinesByItem.set(itemUuid, []);
            }
            packageLinesByItem.get(itemUuid)!.push({
              product_id: line.product_id,
              quantity: line.quantity
            });
          }
        } catch (error) {
          console.warn('Failed to fetch package lines:', error);
        }
      }

      // Products fetch as fallback in case product_name wasn't in JOIN result
      // Fetch from appropriate database based on mode
      const products: ElectronProduct[] = useSystemPos && electronAPI.localDbGetSystemPosAllProducts
        ? await electronAPI.localDbGetSystemPosAllProducts(effectiveBusinessId)
        : await electronAPI.localDbGetAllProducts(effectiveBusinessId);

      // Get users and businesses to show actual names
      // Fetch from appropriate database based on mode
      const users: ElectronUser[] = useSystemPos && electronAPI.localDbGetSystemPosUsers
        ? await electronAPI.localDbGetSystemPosUsers()
        : await electronAPI.localDbGetUsers();
      const businesses: ElectronBusiness[] = useSystemPos && electronAPI.localDbGetSystemPosBusinesses
        ? await electronAPI.localDbGetSystemPosBusinesses()
        : await electronAPI.localDbGetBusinesses();

      // Get refunds from appropriate database
      const refunds: TransactionRefund[] = useSystemPos && electronAPI.localDbGetSystemPosTransactionRefunds
        ? await electronAPI.localDbGetSystemPosTransactionRefunds(transactionId)
        : await electronAPI.localDbGetTransactionRefunds(transactionId);

      const user = users.find((u) => u.id === transaction.user_id);
      const business = businesses.find((b) => b.id === transaction.business_id);

      const refundTotalValue = transaction.refund_total ?? refunds.reduce((sum, refund) => sum + (refund.refund_amount ?? 0), 0);
      const finalAmount = Number(transaction.final_amount ?? 0);
      // Always recalculate refund_status based on total refund amount vs final_amount
      // This ensures correct status even if database has incorrect values
      const refundStatusValue =
        refundTotalValue > 0
          ? refundTotalValue >= finalAmount - 0.01
            ? 'full'
            : 'partial'
          : 'none';

      const mappedItems = items.map((item) => {
        // Use product_name from JOIN first, then fallback to active products lookup
        // Ensure product_id is properly compared (handle both number and string)
        const productId = typeof item.product_id === 'number' ? item.product_id : Number(item.product_id);
        const product = products.find((p) => p.id === productId);
        // Check if product_name is null, undefined, or empty string
        const productName = (item.product_name && String(item.product_name).trim())
          ? String(item.product_name).trim()
          : (product?.nama && String(product.nama).trim())
            ? String(product.nama).trim()
            : 'Unknown Product';

        const customizations = Array.isArray(item.customizations)
          ? item.customizations
          : (item.customizations ? [item.customizations] : []);

        // Safely convert prices to numbers (handle null, undefined, string, or number)
        const parsePrice = (value: unknown): number => {
          if (typeof value === 'number' && !isNaN(value)) return value;
          if (value === null || value === undefined) return 0;
          const parsed = Number(value);
          return isNaN(parsed) ? 0 : parsed;
        };

        const itemUuid = (item as { uuid_id?: string; id?: string }).uuid_id || (item as { uuid_id?: string; id?: string }).id;
        const packageLines = itemUuid ? packageLinesByItem.get(String(itemUuid)) : undefined;
        const packageSelections = packageLines?.map((line, index) => {
          const prod = products.find((p) => p.id === line.product_id);
          return {
            package_item_id: index,
            selection_type: 'default' as const,
            product_id: line.product_id,
            product_name: (prod?.nama && String(prod.nama).trim()) ? String(prod.nama).trim() : 'Unknown Product',
            quantity: line.quantity
          };
        });

        const mappedItem = {
          id: item.id,
          product_name: productName,
          quantity: item.quantity,
          unit_price: parsePrice(item.unit_price),
          total_price: parsePrice(item.total_price),
          custom_note: item.custom_note || undefined,
          customizations: customizations,
          bundleSelections: item.bundleSelections || undefined,
          packageSelections: packageSelections || undefined,
          production_status: item.production_status || null
        };

        return mappedItem;
      });

      const response: TransactionDetail = {
        ...transaction,
        payment_method: (transaction.payment_method || 'cash') as TransactionDetail['payment_method'],
        pickup_method: (transaction.pickup_method || 'dine-in') as TransactionDetail['pickup_method'],
        transaction_type: (transaction.transaction_type || 'drinks') as TransactionDetail['transaction_type'],
        voucher_type: (transaction.voucher_type || 'none') as TransactionDetail['voucher_type'],
        items: mappedItems,
        user_name: user?.name || 'Unknown User',
        business_name: business?.name || 'Unknown Business',
        refunds,
        refund_total: refundTotalValue,
        refund_status: refundStatusValue
      };

      setSelectedTransaction(response);
      setIsDetailModalOpen(true);
    } catch (error: unknown) {
      console.error('Error fetching transaction details:', error);
      setError(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setIsLoadingDetail(false);
      setLoadingTransactionId(null);
    }
  };

  // Handle row click
  const handleRowClick = (transaction: Transaction) => {
    const transactionId = transaction.id;

    // If transaction is pending and onLoadTransaction is provided, load it into cart and navigate to kasir
    if (transaction.status === 'pending' && onLoadTransaction) {
      onLoadTransaction(transactionId);
      return;
    }

    // Otherwise, open detail modal as usual
    setLoadingTransactionId(transactionId);
    setIsLoadingDetail(true);
    setIsDetailModalOpen(true);
    fetchTransactionDetail(transactionId);
  };

  const handleTransactionUpdated = async (updatedTransaction: TransactionDetail) => {
    setSelectedTransaction(updatedTransaction);
    setTransactions((prev) =>
      prev.map((tx) =>
        tx.id === updatedTransaction.id
          ? {
            ...tx,
            refund_status: updatedTransaction.refund_status ?? tx.refund_status,
            refund_total: updatedTransaction.refund_total ?? tx.refund_total
          }
          : tx
      )
    );
    // Refresh transaction list from database to ensure we have the latest data
    await fetchTransactions();
  };

  // Close detail modal
  const handleCloseDetailModal = () => {
    setIsDetailModalOpen(false);
    setSelectedTransaction(null);
    setLoadingTransactionId(null);
  };

  // Handle UUID copy with notification
  const handleCopyUuid = async (uuid: string, event?: React.MouseEvent) => {
    try {
      // Prevent default to maintain focus
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }

      // Use fallback method that works better in Electron
      const textArea = document.createElement('textarea');
      textArea.value = uuid;
      textArea.style.position = 'fixed';
      textArea.style.left = '-9999px';
      textArea.style.top = '0';
      textArea.style.opacity = '0';
      textArea.setAttribute('readonly', '');
      document.body.appendChild(textArea);

      // Focus and select
      textArea.focus();
      textArea.select();
      textArea.setSelectionRange(0, uuid.length);

      // Try clipboard API first (with focus fix)
      try {
        if (window.isSecureContext && navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(uuid);
        } else {
          // Fallback for non-secure contexts
          const successful = document.execCommand('copy');
          if (!successful) {
            throw new Error('execCommand copy failed');
          }
        }
      } catch {
        // Final fallback: use execCommand
        const successful = document.execCommand('copy');
        if (!successful) {
          throw new Error('All copy methods failed');
        }
      }

      // Clean up
      document.body.removeChild(textArea);

      setCopiedUuid(uuid);
      // Auto-hide after 2 seconds
      setTimeout(() => {
        setCopiedUuid(null);
      }, 2000);
    } catch (error) {
      console.error('Failed to copy UUID:', error);
      // Show error to user
      appAlert('Gagal menyalin UUID. Silakan salin manual: ' + uuid);
    }
  };

  interface ReceiptizeFetchResult {
    success: boolean;
    ids: Set<string>;
    counters: Record<string, number>;
  }

  interface ReceiptFetchResult {
    success: boolean;
    counters: Record<string, number>;
  }

  // Fetch original Receiptize counters from Printer2 audit log (same logic as reprint)
  const fetchReceiptizePrintedIds = useCallback(async (): Promise<ReceiptizeFetchResult> => {
    const electronAPI = typeof window !== 'undefined' ? (window as { electronAPI?: ElectronAPI }).electronAPI : undefined;
    if (!electronAPI?.getPrinter2AuditLog) {
      console.warn('Receiptize audit log API unavailable');
      return { success: false, ids: new Set<string>(), counters: {} };
    }

    try {
      // Try with date range first
      let response = await electronAPI.getPrinter2AuditLog(fromDate, toDate, 2000);
      let entries = Array.isArray(response?.entries) ? response.entries : [];

      // If no results with date filter, try without date filter (fallback)
      if (entries.length === 0) {
        response = await electronAPI.getPrinter2AuditLog(undefined, undefined, 2000);
        entries = Array.isArray(response?.entries) ? response.entries : [];
      }

      const ids = new Set<string>();
      const originalCounters: Record<string, number> = {};

      for (const entry of entries) {
        if (entry?.transaction_id == null) continue;
        const txId = String(entry.transaction_id);
        ids.add(txId);

        // Find ORIGINAL print (is_reprint = 0 or undefined/null) - same logic as reprint
        const isReprint = entry.is_reprint;
        if (isReprint === 1) {
          // Skip reprints, only use original prints
          continue;
        }

        const counterValue = Number(entry.printer2_receipt_number);
        if (Number.isNaN(counterValue)) continue;

        // Only set if we haven't found an original print for this transaction yet
        if (!(txId in originalCounters)) {
          originalCounters[txId] = counterValue;
        }
      }

      // Debug: Log sample IDs to see what format they are
      // Removed unused sampleIds variable

      return { success: true, ids, counters: originalCounters };
    } catch (err) {
      console.error('Failed to fetch Receiptize audit log:', err);
      return { success: false, ids: new Set<string>(), counters: {} };
    }
  }, [fromDate, toDate]);

  // Fetch original Receipt counters from Printer1 audit log (same logic as reprint)
  const fetchReceiptPrintedIds = useCallback(async (): Promise<ReceiptFetchResult> => {
    const electronAPI = typeof window !== 'undefined' ? (window as { electronAPI?: ElectronAPI }).electronAPI : undefined;
    if (!electronAPI?.getPrinter1AuditLog) {
      console.warn('Receipt audit log API unavailable');
      return { success: false, counters: {} };
    }

    try {
      // Try with date range first
      let response = await electronAPI.getPrinter1AuditLog(fromDate, toDate, 2000);
      let entries = Array.isArray(response?.entries) ? response.entries : [];

      // If no results with date filter, try without date filter (fallback)
      if (entries.length === 0) {
        response = await electronAPI.getPrinter1AuditLog(undefined, undefined, 2000);
        entries = Array.isArray(response?.entries) ? response.entries : [];
      }

      const originalCounters: Record<string, number> = {};

      for (const entry of entries) {
        if (entry?.transaction_id == null) continue;
        const txId = String(entry.transaction_id);

        // Find ORIGINAL print (is_reprint = 0 or undefined/null) - same logic as reprint
        const isReprint = entry.is_reprint;
        if (isReprint === 1) {
          // Skip reprints, only use original prints
          continue;
        }

        const counterValue = Number(entry.printer1_receipt_number);
        if (Number.isNaN(counterValue)) continue;

        // Only set if we haven't found an original print for this transaction yet
        if (!(txId in originalCounters)) {
          originalCounters[txId] = counterValue;
        }
      }

      return { success: true, counters: originalCounters };
    } catch (err) {
      console.error('Failed to fetch Receipt audit log:', err);
      return { success: false, counters: {} };
    }
  }, [fromDate, toDate]);

  // Fetch transactions function
  const fetchTransactions = useCallback(async (): Promise<boolean> => {
    setIsLoading(true);
    setError(null);

    try {
      if (typeof window === 'undefined' || !(window as { electronAPI?: ElectronAPI }).electronAPI) {
        console.warn('⚠️ [TransactionList] Database not available, showing empty list');
        setTransactions([]);
        return true;
      }

      const electronAPI = (window as { electronAPI: ElectronAPI }).electronAPI;
      const useSystemPos = isSystemPosMode;

      // Fetch from appropriate database
      const dbTransactions: ElectronTransaction[] = useSystemPos && electronAPI.localDbGetSystemPosTransactions
        ? await electronAPI.localDbGetSystemPosTransactions(effectiveBusinessId, 50000)
        : await electronAPI.localDbGetTransactions(effectiveBusinessId, 50000);

      // Get users and businesses to show actual names (fetch once for all transactions)
      // Fetch from appropriate database based on mode
      const users: ElectronUser[] = useSystemPos && electronAPI.localDbGetSystemPosUsers
        ? await electronAPI.localDbGetSystemPosUsers()
        : await electronAPI.localDbGetUsers();
      const businesses: ElectronBusiness[] = useSystemPos && electronAPI.localDbGetSystemPosBusinesses
        ? await electronAPI.localDbGetSystemPosBusinesses()
        : await electronAPI.localDbGetBusinesses();
      setUsersList(users);

      // Filter by date range - need to convert to local date for accurate filtering
      // This ensures we only show transactions within the selected date range
      const dateFilteredTransactions = dbTransactions.filter((tx) => {
        // Convert UTC to local date for accurate filtering
        const localDate = new Date(tx.created_at);
        const localDateString = localDate.getFullYear() + '-' +
          String(localDate.getMonth() + 1).padStart(2, '0') + '-' +
          String(localDate.getDate()).padStart(2, '0');
        const isInRange = localDateString >= fromDate && localDateString <= toDate;
        return isInRange;
      });

      const transactionsData = dateFilteredTransactions.map((tx) => {
        const user = users.find((u) => u.id === tx.user_id);
        const business = businesses.find((b) => b.id === tx.business_id);

        // CRITICAL: Use UUID as id, not numeric ID
        // The database should have uuid_id field, but if not, use id as fallback
        // This ensures consistency with the API which uses UUIDs
        const transactionId = tx.id; // DB already uses UUID as id

        // Calculate refund_total and refund_status from the transaction data
        // The query should already include these, but ensure they're properly typed
        const refundTotal = tx.refund_total !== undefined && tx.refund_total !== null
          ? (typeof tx.refund_total === 'number' ? tx.refund_total : Number(tx.refund_total))
          : null;
        const refundStatus = tx.refund_status || null;

        return {
          id: transactionId, // Should already be UUID from DB
          business_id: tx.business_id,
          user_id: tx.user_id,
          payment_method: tx.payment_method as Transaction['payment_method'],
          pickup_method: tx.pickup_method as Transaction['pickup_method'],
          total_amount: tx.total_amount,
          voucher_discount: tx.voucher_discount || 0,
          voucher_type: (tx.voucher_type || 'none') as Transaction['voucher_type'],
          voucher_value: tx.voucher_value !== undefined && tx.voucher_value !== null ? Number(tx.voucher_value) : null,
          voucher_label: tx.voucher_label || null,
          final_amount: tx.final_amount,
          amount_received: tx.amount_received,
          change_amount: tx.change_amount || 0,
          contact_id: tx.contact_id,
          customer_name: tx.customer_name,
          customer_unit: tx.customer_unit !== undefined && tx.customer_unit !== null ? Number(tx.customer_unit) : null,
          note: tx.note || null,
          receipt_number: tx.receipt_number,
          transaction_type: (tx.transaction_type || 'drinks') as Transaction['transaction_type'],
          waiter_id: typeof tx.waiter_id === 'number' ? tx.waiter_id : (typeof tx.waiter_id === 'string' ? parseInt(tx.waiter_id, 10) : null),
          status: tx.status || 'paid',
          created_at: tx.created_at,
          updated_at: tx.updated_at ?? null,
          paid_at: tx.paid_at ?? null,
          shift_uuid: tx.shift_uuid, // Include shift_uuid
          refund_total: refundTotal,
          refund_status: refundStatus,
          user_name: user?.name || 'Unknown User',
          business_name: business?.name || 'Unknown Business'
        };
      });

      // Apply permission-based filtering
      let filteredTransactions = transactionsData;

      // Filter by user permissions (Super Admin sees all data)
      if (!isSuperAdmin(user) && canViewUserDataOnly && !canViewAllData && user) {
        filteredTransactions = filteredTransactions.filter(tx => tx.user_id === parseInt(user.id));
      }

      // Filter by date permissions (if user doesn't have viewpastdata permission, only show today's data)
      // Super Admin bypasses date restrictions
      if (!isSuperAdmin(user) && !canViewPastData) {
        const today = getTodayUTC7();
        filteredTransactions = filteredTransactions.filter(tx => {
          const txDate = new Date(tx.created_at);
          const txDateString = txDate.getFullYear() + '-' +
            String(txDate.getMonth() + 1).padStart(2, '0') + '-' +
            String(txDate.getDate()).padStart(2, '0');
          return txDateString === today;
        });
      }

      setTransactions(filteredTransactions);

      // #region agent log
      if (useSystemPos && filteredTransactions.length > 0) {
        const withRefund = filteredTransactions.filter(t => (t.refund_total ?? 0) > 0);
        if (typeof fetch === 'function') {
          fetch('http://127.0.0.1:7245/ingest/519de021-d49d-473f-a8a1-4215977c867a', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'TransactionList.tsx:fetchTransactions', message: 'system_pos mapped refund_total', data: { total: filteredTransactions.length, withRefundCount: withRefund.length, sample: withRefund.slice(0, 3).map(t => ({ id: t.id, refund_total: t.refund_total })) }, hypothesisId: 'H2', timestamp: Date.now() }) }).catch(() => { });
        }
      }
      // #endregion

      // Fetch shifts for date range to build shift labels (Shift 1, Shift 2, ...)
      // Only show shifts that fall within the selected date range
      if (!useSystemPos && electronAPI.localDbGetShifts) {
        try {
          const startDate = fromDate + 'T00:00:00.000Z';
          const endDate = toDate + 'T23:59:59.999Z';
          const { shifts } = await electronAPI.localDbGetShifts({
            businessId: effectiveBusinessId,
            startDate,
            endDate,
            limit: 200
          });
          let allShifts = [...(shifts || [])];
          // Include active shift only if it started within the selected date range
          if (electronAPI.localDbGetActiveShift && user?.id) {
            try {
              const activeRes = await electronAPI.localDbGetActiveShift(parseInt(String(user.id)), effectiveBusinessId);
              const activeShift = (activeRes as { shift?: { uuid_id?: string; shift_start?: string } })?.shift;
              if (activeShift?.uuid_id && !allShifts.some((s) => s.uuid_id === activeShift.uuid_id)) {
                const activeStart = activeShift.shift_start ? new Date(activeShift.shift_start) : null;
                const rangeStart = new Date(fromDate + 'T00:00:00');
                const rangeEnd = new Date(toDate + 'T23:59:59');
                if (activeStart && activeStart >= rangeStart && activeStart <= rangeEnd) {
                  allShifts.push(activeShift as (typeof allShifts)[0]);
                }
              }
            } catch {
              // ignore
            }
          }
          const sorted = allShifts.sort(
            (a, b) => new Date(a.shift_start || 0).getTime() - new Date(b.shift_start || 0).getTime()
          );
          const map: Record<string, { filterLabel: string; cellLabel: string }> = {};
          const getGmt7DateKey = (iso: string) => {
            const d = new Date(iso);
            const gmt7 = new Date(d.getTime() + 7 * 60 * 60 * 1000);
            return gmt7.toISOString().slice(0, 10);
          };
          const todayGmt7 = getTodayUTC7();
          const byDate = new Map<string, typeof sorted>();
          for (const s of sorted) {
            const key = getGmt7DateKey(s.shift_start || '');
            if (!byDate.has(key)) byDate.set(key, []);
            byDate.get(key)!.push(s);
          }
          for (const [dateKey, dayShifts] of byDate) {
            // Only include shifts whose date falls within the selected date range
            if (dateKey < fromDate || dateKey > toDate) continue;
            const isToday = dateKey === todayGmt7;
            const dateObj = new Date(dateKey + 'T12:00:00');
            const filterDateLabel = isToday
              ? 'Hari ini'
              : dateObj.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
            const d = dateObj.getDate();
            const m = dateObj.getMonth() + 1;
            const y = String(dateObj.getFullYear()).slice(-2);
            const cellDateLabel = `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
            dayShifts.forEach((s, i) => {
              const uuid = s.uuid_id;
              if (uuid) {
                const shiftNum = i + 1;
                map[uuid] = {
                  filterLabel: `${filterDateLabel} | Shift ${shiftNum}`,
                  cellLabel: `${cellDateLabel} Shift ${shiftNum}`
                };
              }
            });
          }
          setShiftLabelByUuid(map);
        } catch {
          setShiftLabelByUuid({});
        }
      } else {
        setShiftLabelByUuid({});
      }

      // Fetch original Receiptize counters (from Printer2 audit log)
      const receiptizeResult = await fetchReceiptizePrintedIds();
      setReceiptizePrintedIds(receiptizeResult.ids);
      setReceiptizeCounters(receiptizeResult.counters);

      if (!receiptizeResult.success) {
        setError(prev => prev ?? 'Failed to fetch Receiptize print history');
        return false;
      }

      // Fetch original Receipt counters (from Printer1 audit log)
      const receiptResult = await fetchReceiptPrintedIds();
      setReceiptCounters(receiptResult.counters);


      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch transactions';
      setError(errorMessage);
      console.error('❌ [TransactionList] Error fetching transactions:', {
        error: err,
        message: errorMessage,
        isSystemPosMode,
        businessId: effectiveBusinessId,
        fromDate,
        toDate
      });
      // Set empty array on error to show empty state
      setTransactions([]);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [isSystemPosMode, fromDate, toDate, effectiveBusinessId, fetchReceiptizePrintedIds, fetchReceiptPrintedIds, canViewUserDataOnly, canViewAllData, canViewPastData, user]);

  // Fetch report totals (same as Penjualan Produk) so Grand Total card matches that tab.
  // Only use report totals in System POS mode; in Offline/default mode use list-derived totals (filtered by current mode).
  useEffect(() => {
    if (!isSystemPosMode || !effectiveBusinessId || !fromDate || !toDate) {
      setReportTotals(null);
      // #region agent log
      if (typeof fetch === 'function') {
        fetch('http://127.0.0.1:7242/ingest/ede2961e-f205-45b6-9c27-3e60ff143b09', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'a09730' }, body: JSON.stringify({ sessionId: 'a09730', location: 'TransactionList.tsx:reportTotalsEffect', message: 'reportTotals cleared', data: { isSystemPosMode, reason: !isSystemPosMode ? 'offline' : 'missing deps' }, timestamp: Date.now(), hypothesisId: 'H1' }) }).catch(() => {});
      }
      // #endregion
      return;
    }
    const electronAPI = (typeof window !== 'undefined' ? (window as { electronAPI?: ElectronAPI }).electronAPI : undefined);
    if (!electronAPI?.localDbGetProductSales || !electronAPI?.localDbGetRefundTotal) {
      setReportTotals(null);
      return;
    }
    let cancelled = false;
    const startDateTime = `${fromDate}T00:00:00`;
    const endDateTime = `${toDate}T23:59:59`;
    Promise.all([
      electronAPI.localDbGetProductSales(null, startDateTime, endDateTime, effectiveBusinessId),
      electronAPI.localDbGetRefundTotal(effectiveBusinessId, startDateTime, endDateTime),
    ])
      .then(([result, refundTotal]) => {
        if (cancelled) return;
        const products = (result?.products ?? []) as Array<{ total_subtotal?: number; total_subtotal_after_refund?: number }>;
        const gross = products.reduce((s, p) => s + (Number(p.total_subtotal) || 0), 0);
        const afterRefund = products.reduce(
          (s, p) => s + (Number(p.total_subtotal_after_refund) ?? Number(p.total_subtotal) ?? 0),
          0
        );
        const discount = Math.max(0, gross - afterRefund);
        const refund = typeof refundTotal === 'number' ? refundTotal : 0;
        const net = Math.max(0, afterRefund - refund);
        setReportTotals({ gross, discount, refund, net });
        // #region agent log
        if (typeof fetch === 'function') {
          fetch('http://127.0.0.1:7242/ingest/ede2961e-f205-45b6-9c27-3e60ff143b09', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'a09730' }, body: JSON.stringify({ sessionId: 'a09730', location: 'TransactionList.tsx:reportTotalsSet', message: 'reportTotals set from API', data: { isSystemPosMode, gross, net, refund }, timestamp: Date.now(), hypothesisId: 'H1' }) }).catch(() => {});
        }
        // #endregion
      })
      .catch(() => {
        if (!cancelled) setReportTotals(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isSystemPosMode, fromDate, toDate, effectiveBusinessId]);

  // Fetch cancelled items for date range (for Item Dibatalkan card)
  useEffect(() => {
    if (!effectiveBusinessId || !fromDate || !toDate) {
      setCancelledItems([]);
      return;
    }
    const electronAPI = (typeof window !== 'undefined' ? (window as { electronAPI?: ElectronAPI }).electronAPI : undefined);
    if (!electronAPI?.localDbGetShiftCancelledItems) {
      setCancelledItems([]);
      return;
    }
    const startDateTime = `${fromDate}T00:00:00`;
    const endDateTime = `${toDate}T23:59:59`;
    electronAPI
      .localDbGetShiftCancelledItems(null, startDateTime, endDateTime, effectiveBusinessId)
      .then((rows) => setCancelledItems(Array.isArray(rows) ? rows : []))
      .catch(() => setCancelledItems([]));
  }, [effectiveBusinessId, fromDate, toDate]);

  // Fetch shifts for Bind to Shift modal (super admin only)
  useEffect(() => {
    if (!showBindShiftModal || !transactionToBind || isSystemPosMode) {
      setBindShiftList([]);
      return;
    }
    const electronAPI = (typeof window !== 'undefined' ? (window as { electronAPI?: ElectronAPI }).electronAPI : undefined);
    if (!electronAPI?.localDbGetShifts) {
      setBindShiftList([]);
      return;
    }
    let cancelled = false;
    setIsLoadingBindShifts(true);
    setBindShiftError(null);
    const txDate = new Date(transactionToBind.created_at);
    const y = txDate.getFullYear(), m = txDate.getMonth(), d = txDate.getDate();
    const start = new Date(y, m, d - 1);
    const end = new Date(y, m, d + 2);
    const startDate = start.toISOString().slice(0, 10) + 'T00:00:00.000Z';
    const endDate = end.toISOString().slice(0, 10) + 'T23:59:59.999Z';
    electronAPI.localDbGetShifts({
      businessId: transactionToBind.business_id,
      startDate,
      endDate,
      limit: 100
    }).then((res) => {
      if (cancelled) return;
      const raw = (res?.shifts || []) as Array<{ uuid_id?: string; shift_start?: string; user_name?: string }>;
      const sorted = [...raw].sort(
        (a, b) => new Date(a.shift_start || 0).getTime() - new Date(b.shift_start || 0).getTime()
      );
      setBindShiftList(sorted.filter((s) => s.uuid_id).map((s) => ({
        uuid_id: s.uuid_id!,
        shift_start: s.shift_start || '',
        user_name: s.user_name || '—'
      })));
    }).catch((err) => {
      if (!cancelled) setBindShiftError(err instanceof Error ? err.message : 'Gagal memuat shift');
    }).finally(() => {
      if (!cancelled) setIsLoadingBindShifts(false);
    });
    return () => { cancelled = true; };
  }, [showBindShiftModal, transactionToBind, isSystemPosMode]);

  const handleOpenBindShift = (transaction: Transaction) => {
    setTransactionToBind(transaction);
    setSelectedBindShiftUuid(transaction.shift_uuid ?? null);
    setShowBindShiftModal(true);
    setBindShiftError(null);
  };

  const handleConfirmBindShift = async () => {
    if (!transactionToBind) return;
    // selectedBindShiftUuid can be null to unbind
    const electronAPI = (typeof window !== 'undefined' ? (window as { electronAPI?: ElectronAPI }).electronAPI : undefined);
    if (!electronAPI?.localDbUpdateTransactionShift) return;
    setIsSavingBindShift(true);
    setBindShiftError(null);
    try {
      const result = await electronAPI.localDbUpdateTransactionShift(transactionToBind.id, selectedBindShiftUuid ?? null);
      if (result?.success) {
        setShowBindShiftModal(false);
        setTransactionToBind(null);
        setSelectedBindShiftUuid(null);
        await fetchTransactions();
      } else {
        setBindShiftError(result?.error || 'Gagal mengikat shift');
      }
    } catch (err) {
      setBindShiftError(err instanceof Error ? err.message : 'Gagal mengikat shift');
    } finally {
      setIsSavingBindShift(false);
    }
  };

  // Delete single transaction: load preview when modal opens
  useEffect(() => {
    if (!showDeleteTxModal || !transactionToDelete) {
      setDeletePreview(null);
      return;
    }
    const electronAPI = (typeof window !== 'undefined' ? (window as { electronAPI?: ElectronAPI }).electronAPI : undefined);
    if (!electronAPI?.localDbDeleteSingleTransactionPreview) {
      setDeleteTxError('API tidak tersedia');
      return;
    }
    let cancelled = false;
    setIsLoadingDeletePreview(true);
    setDeleteTxError(null);
    electronAPI.localDbDeleteSingleTransactionPreview(transactionToDelete.id).then((res) => {
      if (cancelled) return;
      if (res?.success && res.queries && res.systemPosQueries) {
        setDeletePreview({ queries: res.queries, systemPosQueries: res.systemPosQueries });
        setDeleteTxError(null);
      } else {
        setDeletePreview(null);
        setDeleteTxError(res?.error || 'Gagal memuat preview');
      }
    }).catch((err) => {
      if (!cancelled) {
        setDeletePreview(null);
        setDeleteTxError(err instanceof Error ? err.message : 'Gagal memuat preview');
      }
    }).finally(() => {
      if (!cancelled) setIsLoadingDeletePreview(false);
    });
    return () => { cancelled = true; };
  }, [showDeleteTxModal, transactionToDelete]);

  const handleOpenDeleteTransaction = (transaction: Transaction) => {
    setTransactionToDelete(transaction);
    setShowDeleteTxModal(true);
    setDeleteTxError(null);
    setDeletePreview(null);
  };

  const handleConfirmDeleteTransaction = async () => {
    if (!transactionToDelete) return;
    const electronAPI = (typeof window !== 'undefined' ? (window as { electronAPI?: ElectronAPI }).electronAPI : undefined);
    if (!electronAPI?.localDbDeleteSingleTransaction) return;
    setIsDeletingTx(true);
    setDeleteTxError(null);
    try {
      const result = await electronAPI.localDbDeleteSingleTransaction(transactionToDelete.id);
      if (result?.success) {
        setShowDeleteTxModal(false);
        setTransactionToDelete(null);
        setDeletePreview(null);
        await fetchTransactions();
      } else {
        setDeleteTxError(result?.error || 'Gagal menghapus transaksi');
      }
    } catch (err) {
      setDeleteTxError(err instanceof Error ? err.message : 'Gagal menghapus transaksi');
    } finally {
      setIsDeletingTx(false);
    }
  };

  const handleSelectKasir = async (transactionId: string, userId: number) => {
    const electronAPI = (typeof window !== 'undefined' ? (window as { electronAPI?: ElectronAPI }).electronAPI : undefined);
    if (!electronAPI?.localDbUpdateTransactionUser) return;
    setSavingKasirFor(transactionId);
    try {
      const result = await electronAPI.localDbUpdateTransactionUser(transactionId, userId, isSystemPosMode);
      if (result?.success) {
        const newName = usersList.find((u) => u.id === userId)?.name || 'Unknown';
        setTransactions((prev) =>
          prev.map((tx) =>
            tx.id === transactionId ? { ...tx, user_id: userId, user_name: newName } : tx
          )
        );
        setOpenKasirFor(null);
      } else {
        appAlert(result?.error || 'Gagal mengubah Kasir');
      }
    } catch (err) {
      appAlert(err instanceof Error ? err.message : 'Gagal mengubah Kasir');
    } finally {
      setSavingKasirFor(null);
    }
  };

  // Fetch employees to get waiter names
  useEffect(() => {
    const fetchEmployees = async () => {
      if (typeof window === 'undefined') return;
      const electronAPI = (window as { electronAPI?: ElectronAPI }).electronAPI;
      if (!electronAPI) return;

      try {
        // Fetch from appropriate database based on mode
        const allEmployees = isSystemPosMode && electronAPI.localDbGetSystemPosEmployees
          ? await electronAPI.localDbGetSystemPosEmployees()
          : (electronAPI.localDbGetEmployees ? await electronAPI.localDbGetEmployees() : []);

        const employeesArray = Array.isArray(allEmployees) ? allEmployees : [];
        const withBusiness = (employeesArray as Array<{ user_id?: number | null; business_id?: number }>).map((emp) => ({
          user_id: emp.user_id ?? null,
          business_id: typeof emp.business_id === 'number' ? emp.business_id : 0,
        }));
        setEmployeesWithBusiness(withBusiness);
        const map = new Map<number, { name: string; color: string | null }>();
        employeesArray.forEach((emp: { id?: number | string; nama_karyawan?: string; color?: string | null }) => {
          const empId = typeof emp.id === 'number' ? emp.id : (typeof emp.id === 'string' ? parseInt(emp.id, 10) : null);
          if (empId && typeof emp.nama_karyawan === 'string') {
            const color = typeof emp.color === 'string' && emp.color ? emp.color : null;
            map.set(empId, { name: emp.nama_karyawan, color });
          }
        });
        setEmployeesMap(map);
      } catch (error) {
        console.warn('Failed to fetch employees:', error);
      }
    };
    fetchEmployees();
  }, [isSystemPosMode]);

  // Fetch transactions on mount and when dependencies change
  useEffect(() => {
    // console.log('🔍 [TransactionList] useEffect triggered - starting fetch immediately');
    const initialLoad = async () => {
      await fetchTransactions();
      // Do NOT set showAllTransactions to true on initial load
      // Only show receiptize transactions by default
    };
    initialLoad();
  }, [fetchTransactions]);

  // Fetch distinct item-level waiter IDs per transaction (for multi-waiter tooltip)
  useEffect(() => {
    if (transactions.length === 0) {
      setItemWaiterIdsByTx({});
      return;
    }
    const electronAPI = typeof window !== 'undefined' ? (window as { electronAPI?: { localDbGetDistinctItemWaiterIdsByTransaction?: (ids: string[]) => Promise<Record<string, number[]>> } }).electronAPI : undefined;
    if (!electronAPI?.localDbGetDistinctItemWaiterIdsByTransaction) return;
    const ids = transactions.map((t) => t.id);
    electronAPI.localDbGetDistinctItemWaiterIdsByTransaction(ids).then(setItemWaiterIdsByTx).catch(() => setItemWaiterIdsByTx({}));
  }, [transactions]);

  // Fetch transaction IDs that have package lines (for package column and filter)
  useEffect(() => {
    if (transactions.length === 0) {
      setTransactionIdsWithPackage(new Set());
      return;
    }
    const electronAPI = typeof window !== 'undefined' ? (window as { electronAPI?: ElectronAPI }).electronAPI : undefined;
    if (!electronAPI?.localDbGetTransactionIdsWithPackage) {
      setTransactionIdsWithPackage(new Set());
      return;
    }
    const ids = transactions.map((t) => t.id);
    electronAPI.localDbGetTransactionIdsWithPackage(ids).then((withPkg) => {
      setTransactionIdsWithPackage(new Set(withPkg));
    }).catch(() => setTransactionIdsWithPackage(new Set()));
  }, [transactions]);

  useEffect(() => {
    setShowAllTransactions(false);
    setReceiptizeCounters({});
    setReceiptizePrintedIds(new Set<string>());
    setReceiptCounters({});
    setShiftFilterUuid(''); // Reset shift filter when date range changes so dropdown only shows shifts in new range
  }, [effectiveBusinessId, fromDate, toDate, isSystemPosMode]);

  // #region agent log
  useEffect(() => {
    if (transactions.length === 0) return;
    const t = setTimeout(() => {
      const table = document.querySelector('table.w-full.text-sm');
      if (!table) {
        if (typeof fetch === 'function') {
          fetch('http://127.0.0.1:7242/ingest/7b565785-72b5-49f7-b2c0-57606ea0d0b5', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'TransactionList.tsx:useEffect', message: 'Table not found in DOM', data: { transactionsLength: transactions.length }, timestamp: Date.now(), sessionId: 'debug-session', hypothesisId: 'H2' }) }).catch(() => { });
        }
        return;
      }
      const th6 = table.querySelector('thead tr th:nth-child(6)');
      const td6 = table.querySelector('tbody tr td:nth-child(6)');
      const thStyle = th6 ? window.getComputedStyle(th6).textAlign : null;
      const tdStyle = td6 ? window.getComputedStyle(td6).textAlign : null;
      const thInline = th6 && (th6 as HTMLElement).getAttribute ? (th6 as HTMLElement).getAttribute('style') : null;
      if (typeof fetch === 'function') {
        fetch('http://127.0.0.1:7242/ingest/7b565785-72b5-49f7-b2c0-57606ea0d0b5', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'TransactionList.tsx:useEffect', message: 'Computed style Disc/Vc column', data: { thComputedTextAlign: thStyle, tdComputedTextAlign: tdStyle, thInlineStyle: thInline }, timestamp: Date.now(), sessionId: 'debug-session', hypothesisId: 'H3' }) }).catch(() => { });
      }
    }, 300);
    return () => clearTimeout(t);
  }, [transactions.length]);
  // #endregion

  // State for refresh click counter (value is only used internally by React state)
  const [, setRefreshClickCount] = useState(0);
  const [lastRefreshClick, setLastRefreshClick] = useState(0);
  const grandTotalClickCountRef = useRef(0);
  const lastGrandTotalClickRef = useRef(0);

  // Handle 5x click logic for grand total
  const handleFiveClickToggle = useCallback(() => {
    const now = Date.now();
    const timeSinceLastClick = now - lastGrandTotalClickRef.current;

    if (timeSinceLastClick > 3000) {
      // Reset counter if more than 3 seconds passed
      grandTotalClickCountRef.current = 1;
    } else {
      grandTotalClickCountRef.current += 1;
      const newCount = grandTotalClickCountRef.current;
      if (newCount >= 5) {
        // Toggle show all transactions after 5 clicks
        setShowAllTransactions(prev => !prev);
        grandTotalClickCountRef.current = 0; // Reset counter
      }
    }
    lastGrandTotalClickRef.current = now;
  }, []);

  const handleRefresh = useCallback(async () => {
    const success = await fetchTransactions();
    if (!success) {
      return;
    }

    // Handle 5x refresh click logic
    const now = Date.now();
    if (now - lastRefreshClick > 3000) {
      // Reset counter if more than 3 seconds passed
      setRefreshClickCount(1);
    } else {
      setRefreshClickCount(prev => {
        const newCount = prev + 1;
        if (newCount >= 5) {
          // Show all transactions after 5 clicks
          setShowAllTransactions(true);
          return 0; // Reset counter
        }
        return newCount;
      });
    }
    setLastRefreshClick(now);
  }, [fetchTransactions, lastRefreshClick]);

  // Format date for display (GMT+7 / WIB)
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('id-ID', {
      timeZone: 'Asia/Jakarta',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

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

  // Get payment method code from ID or string
  const getPaymentMethodCode = (transaction: Transaction): string => {
    // Use payment_method_id as source of truth if available
    if (transaction.payment_method_id && paymentMethodIdToCode[transaction.payment_method_id]) {
      return paymentMethodIdToCode[transaction.payment_method_id];
    }
    // Fallback to payment_method string
    return transaction.payment_method?.toLowerCase() || 'cash';
  };

  // Get payment method label
  const getPaymentMethodLabel = (transaction: Transaction | string) => {
    // Handle both transaction object and string for backward compatibility
    const method = typeof transaction === 'string'
      ? transaction.toLowerCase()
      : getPaymentMethodCode(transaction as Transaction);

    const labels: { [key: string]: string } = {
      'cash': 'Cash',
      'debit': 'Debit',
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
  };

  // Get payment method color
  const getPaymentMethodColor = (transaction: Transaction | string) => {
    // Handle both transaction object and string for backward compatibility
    const method = typeof transaction === 'string'
      ? transaction.toLowerCase()
      : getPaymentMethodCode(transaction as Transaction);

    const colors: { [key: string]: string } = {
      'cash': 'bg-green-100 text-green-800',
      'debit': 'bg-blue-100 text-blue-800',
      'qr': 'bg-purple-100 text-purple-800',
      'ewallet': 'bg-orange-100 text-orange-800',
      'cl': 'bg-gray-100 text-gray-800',
      'voucher': 'bg-yellow-100 text-yellow-800',
      'qpon': 'bg-indigo-100 text-indigo-800',
      'gofood': 'bg-teal-100 text-teal-800',
      'grabfood': 'bg-green-100 text-green-800',
      'shopeefood': 'bg-orange-100 text-orange-800',
      'tiktok': 'bg-red-100 text-red-800'
    };
    return colors[method] || 'bg-gray-100 text-gray-800';
  };

  // Get sort icon for column headers
  const getSortIcon = (field: string) => {
    if (sortField !== field) {
      return <ChevronUp className="w-3 h-3 text-gray-400" />;
    }
    return sortDirection === 'asc'
      ? <ChevronUp className="w-3 h-3 text-blue-600" />
      : <ChevronDown className="w-3 h-3 text-blue-600" />;
  };

  // Handle column sorting
  const handleSort = (field: string) => {
    if (sortField === field) {
      // Toggle direction if same field
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      // New field, default to ascending
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Apply Receiptize filter unless full list unlocked (or system_pos: show all as-is, no R/RR filter)
  // In default mode, only show transactions that are in receiptizePrintedIds (printed to Printer2/receiptize).
  // If no receiptize data is available, show empty list — never fall back to all transactions.
  // In system_pos mode: show all transactions as-is (no R/RR filter).
  let baseTransactions: Transaction[];

  if (isSystemPosMode) {
    baseTransactions = transactions;
  } else if (showAllTransactions) {
    baseTransactions = transactions;
  } else if (receiptizePrintedIds.size > 0) {
    const filtered = transactions.filter(transaction => {
      const txId = String(transaction.id);
      const isInSet = receiptizePrintedIds.has(txId);
      // Show if transaction is in receiptizePrintedIds (meaning it was printed to Printer2/receiptize)
      return isInSet;
    });
    baseTransactions = filtered;
  } else {
    // No receiptize data: show empty list (no fallback to all transactions)
    baseTransactions = [];
  }

  // Item Dibatalkan: follow current mode (Printer 2 only vs all), same as Grand Total / Txs
  const displayedCancelledItems = (() => {
    if (showAllTransactions || isSystemPosMode) return cancelledItems;
    return cancelledItems.filter((item) => {
      const txId = item.uuid_transaction_id ?? (item.transaction_id != null ? String(item.transaction_id) : null);
      return txId != null && receiptizePrintedIds.has(txId);
    });
  })();

  // Creation-order rank (1-based) for default receiptize view: # = 1,2,3... by created_at asc.
  // Only used when !showAllTransactions; view-all keeps daily counter.
  const creationOrderRank: Record<string, number> = (() => {
    if (showAllTransactions || baseTransactions.length === 0) return {};
    const sorted = [...baseTransactions].sort((a, b) => {
      const tA = new Date(a.created_at).getTime();
      const tB = new Date(b.created_at).getTime();
      return tA - tB;
    });
    const rank: Record<string, number> = {};
    sorted.forEach((tx, idx) => { rank[String(tx.id)] = idx + 1; });
    return rank;
  })();

  const resolveReceiptSequence = (tx: Transaction) => {
    const txId = String(tx.id);

    // First check for Receiptize counter (from Printer2 audit log - original print)
    const receiptizeCounter = receiptizeCounters[txId];
    if (typeof receiptizeCounter === 'number' && receiptizeCounter > 0) {
      return receiptizeCounter;
    }

    // Then check for Receipt counter (from Printer1 audit log - original print)
    const receiptCounter = receiptCounters[txId];
    if (typeof receiptCounter === 'number' && receiptCounter > 0) {
      return receiptCounter;
    }

    // Fallback to transaction table value (may not match original print)
    return typeof tx.receipt_number === 'number' ? tx.receipt_number : 0;
  };

  // Filter and sort transactions
  const filteredTransactions = baseTransactions
    .filter(transaction => {
      const matchesSearch = searchTerm === '' ||
        transaction.user_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        transaction.customer_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (transaction.customer_unit !== undefined && transaction.customer_unit !== null && transaction.customer_unit.toString().includes(searchTerm)) ||
        transaction.payment_method.toLowerCase().includes(searchTerm.toLowerCase()) ||
        transaction.receipt_number?.toString().includes(searchTerm) ||
        transaction.voucher_label?.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesFilter = filterMethod === 'all' || transaction.payment_method === filterMethod;

      const matchesShiftFilter =
        shiftFilterUuid === '' ||
        (shiftFilterUuid === 'none' ? !transaction.shift_uuid : transaction.shift_uuid === shiftFilterUuid);

      // Amount range filter (total_amount = pre-discount)
      const fromNum = parseAmountDisplay(amountFrom);
      const toNum = parseAmountDisplay(amountTo);
      let matchesAmount = true;
      if (fromNum != null && toNum != null) {
        matchesAmount = (transaction.total_amount ?? 0) >= fromNum && (transaction.total_amount ?? 0) <= toNum;
      } else if (toNum != null) {
        matchesAmount = (transaction.total_amount ?? 0) > 0 && (transaction.total_amount ?? 0) <= toNum;
      } else if (fromNum != null) {
        matchesAmount = (transaction.total_amount ?? 0) >= fromNum;
      }

      return matchesSearch && matchesFilter && matchesShiftFilter && matchesAmount;
    })
    .sort((a, b) => {
      let aValue: string | number = a[sortField as keyof Transaction] as string | number;
      let bValue: string | number = b[sortField as keyof Transaction] as string | number;

      // Handle different data types
      if (sortField === 'receipt_number') {
        if (!showAllTransactions && Object.keys(creationOrderRank).length > 0) {
          aValue = creationOrderRank[String(a.id)] ?? 0;
          bValue = creationOrderRank[String(b.id)] ?? 0;
        } else {
          aValue = resolveReceiptSequence(a);
          bValue = resolveReceiptSequence(b);
        }
      } else if (sortField === 'id' || sortField === 'total_amount' || sortField === 'voucher_discount' || sortField === 'final_amount' || sortField === 'amount_received' || sortField === 'change_amount' || sortField === 'customer_unit' || sortField === 'refund_total') {
        aValue = typeof aValue === 'string' ? parseFloat(aValue) : (aValue as number || 0);
        bValue = typeof bValue === 'string' ? parseFloat(bValue) : (bValue as number || 0);
      } else if (sortField === 'created_at' || sortField === 'updated_at' || sortField === 'paid_at') {
        aValue = (aValue && typeof aValue === 'string') ? new Date(aValue).getTime() : 0;
        bValue = (bValue && typeof bValue === 'string') ? new Date(bValue).getTime() : 0;
      } else {
        // String fields
        aValue = (aValue?.toString().toLowerCase() || '') as string;
        bValue = (bValue?.toString().toLowerCase() || '') as string;
      }

      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

  // Grand Total scope: completed vs pending (aligned with Laporan Penjualan Produk — completed only for main figures)
  const completedTransactions = filteredTransactions.filter(
    (t) => (t.status || '').toLowerCase() !== 'cancelled' && (t.status || '').toLowerCase() !== 'pending'
  );
  const pendingTransactions = filteredTransactions.filter((t) => (t.status || '').toLowerCase() === 'pending');

  const parseNum = (v: unknown, fallback = 0): number => {
    if (typeof v === 'number' && !isNaN(v)) return v;
    if (typeof v === 'string') {
      const n = parseFloat(v);
      return isNaN(n) ? fallback : n;
    }
    return fallback;
  };

  // Grand Total (completed only): Gross = sum(total_amount), Discount = sum(total_amount − final_amount), Net = (Gross − Discount) − Refund
  const grossCompleted = completedTransactions.reduce((sum, t) => sum + parseNum(t.total_amount), 0);
  const refundCompleted = completedTransactions.reduce((sum, t) => sum + parseNum(t.refund_total), 0);
  const totalRevenueCompleted = completedTransactions.reduce((sum, t) => sum + parseNum(t.final_amount), 0);
  const discountCompleted = Math.max(0, grossCompleted - totalRevenueCompleted);
  const netCompleted = Math.max(0, totalRevenueCompleted - refundCompleted);

  const grossPending = pendingTransactions.reduce((sum, t) => sum + parseNum(t.total_amount), 0);
  const refundPending = pendingTransactions.reduce((sum, t) => sum + parseNum(t.refund_total), 0);
  const totalRevenuePending = pendingTransactions.reduce((sum, t) => sum + parseNum(t.final_amount), 0);
  const discountPending = Math.max(0, grossPending - totalRevenuePending);
  const netPending = Math.max(0, totalRevenuePending - refundPending);

  // Legacy totals (all non-cancelled) for Payment Methods card, Voucher card, etc. — list behaviour unchanged
  const totalRevenue = filteredTransactions
    .filter((t) => (t.status || '').toLowerCase() !== 'cancelled')
    .reduce((sum, t) => sum + parseNum(t.final_amount), 0);
  const sumTotalAmount = filteredTransactions
    .filter((t) => (t.status || '').toLowerCase() !== 'cancelled')
    .reduce((sum, t) => sum + parseNum(t.total_amount), 0);
  const totalRefund = filteredTransactions.reduce((sum, t) => sum + parseNum(t.refund_total), 0);
  const totalVoucherDiscount = filteredTransactions.reduce((sum, t) => sum + parseNum(t.voucher_discount), 0);
  // Txs/CU follow current mode: use the same list as Grand Total (filteredTransactions = visible rows).
  const completedForCount = filteredTransactions.filter(
    (t) => (t.status || '').toLowerCase() !== 'cancelled' && (t.status || '').toLowerCase() !== 'pending'
  );
  const totalTransactionCount = completedForCount.length;
  const totalCustomerUnit = completedForCount.reduce(
    (sum, t) => sum + (typeof t.customer_unit === 'number' && Number.isFinite(t.customer_unit) ? t.customer_unit : 0),
    0
  );

  // Aggregations for footer: count and total amount per payment method (based on table shown)
  const paymentMethodCounts: Record<string, number> = {
    cash: 0,
    debit: 0,
    qr: 0,
    ewallet: 0,
    cl: 0,
    voucher: 0,
    qpon: 0,
    gofood: 0,
    grabfood: 0,
    shopeefood: 0,
    tiktok: 0,
  };
  const paymentMethodTotals: Record<string, number> = {
    cash: 0,
    debit: 0,
    qr: 0,
    ewallet: 0,
    cl: 0,
    voucher: 0,
    qpon: 0,
    gofood: 0,
    grabfood: 0,
    shopeefood: 0,
    tiktok: 0,
  };

  let dineInCount = 0;
  let takeAwayCount = 0;
  let voucherCount = 0;

  filteredTransactions.forEach((t) => {
    const code = getPaymentMethodCode(t);
    paymentMethodCounts[code] = (paymentMethodCounts[code] || 0) + 1;
    const amount = typeof t.final_amount === 'string' ? parseFloat(t.final_amount) : t.final_amount;
    paymentMethodTotals[code] = (paymentMethodTotals[code] || 0) + (isNaN(amount) ? 0 : amount);
    if (t.pickup_method === 'dine-in') dineInCount += 1;
    if (t.pickup_method === 'take-away') takeAwayCount += 1;
    const vd = typeof t.voucher_discount === 'string' ? parseFloat(t.voucher_discount) : t.voucher_discount;
    if (!isNaN(vd) && vd > 0) voucherCount += 1;
  });

  // #region agent log — log per-row checksums to find which rows have different values
  const debugChecksumsLogKeyRef = useRef<string>('');
  useEffect(() => {
    if (!showAllTransactions || isLoading) return;
    const parseNum = (v: unknown) => (typeof v === 'number' && !isNaN(v) ? v : typeof v === 'string' ? (parseFloat(v) || 0) : 0);
    const rows = completedTransactions.map((t) => ({
      id: t.id,
      c: `${(t.payment_method || '').toLowerCase()}|${(t.pickup_method || '').toLowerCase()}|${parseNum(t.total_amount)}|${parseNum(t.final_amount)}|${parseNum(t.refund_total)}`,
    }));
    const key = `${effectiveBusinessId}|${fromDate}|${toDate}|${rows.length}`;
    if (key === debugChecksumsLogKeyRef.current && rows.length > 0) return;
    debugChecksumsLogKeyRef.current = key;
    fetch('http://127.0.0.1:7495/ingest/20000880-6f22-4a8b-8a8e-250eeb7d84f4', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '14f9d6' }, body: JSON.stringify({ sessionId: '14f9d6', location: 'TransactionList.tsx:rowChecksums', message: 'Per-row checksums for diff', data: { source: 'marviano-pos', fromDate, toDate, effectiveBusinessId, count: rows.length, rows }, timestamp: Date.now(), hypothesisId: 'H4' }) }).catch(() => {});
  }, [showAllTransactions, isLoading, fromDate, toDate, effectiveBusinessId, completedTransactions]);
  // #endregion

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-white">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
          <p className="text-gray-600 text-lg">Loading transactions...</p>
        </div>
      </div>
    );
  }

  // Permission error handling
  if (hasConflictingPermissions) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center p-8 bg-red-50 rounded-lg border border-red-200">
          <div className="text-red-600 text-lg font-semibold mb-2">Permission Error</div>
          <div className="text-red-700">User have both permissions, contact admin        </div>
        </div>
        {showPrinterManager && (
          <Printer1ToPrinter2Manager onClose={() => setShowPrinterManager(false)} />
        )}
      </div>
    );
  }


  return (
    <div className="flex-1 flex flex-col bg-white h-full w-full min-w-0 overflow-x-hidden">
      <div className="flex-1 flex flex-col w-full min-w-0 max-w-[95%] xl:max-w-[1600px] mx-auto px-4 sm:px-6 py-6">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <h1
            className="text-lg font-bold text-gray-800 cursor-pointer select-none"
            onClick={() => {
              if (!canAccessPrinterManager) return;

              // Clear existing timeout
              if (headerClickTimeoutRef.current) {
                clearTimeout(headerClickTimeoutRef.current);
              }

              const newCount = headerClickCount + 1;
              setHeaderClickCount(newCount);

              // Reset counter after 2 seconds
              headerClickTimeoutRef.current = setTimeout(() => {
                setHeaderClickCount(0);
              }, 2000);

              // If clicked 5 times, open the manager
              if (newCount >= 5) {
                setShowPrinterManager(true);
                setHeaderClickCount(0);
              }
            }}
            title={canAccessPrinterManager ? "Click 5 times to open Printer 1 → Printer 2 Manager" : undefined}
          >
            Daftar Transaksi | {new Date(fromDate).toLocaleDateString('id-ID', {
              day: 'numeric',
              month: 'short',
              year: 'numeric'
            })} - {new Date(toDate).toLocaleDateString('id-ID', {
              day: 'numeric',
              month: 'short',
              year: 'numeric'
            })}
            {' '}
            |{' '}
            <span className="bg-green-600 text-white py-1 pl-2 pr-2 rounded">
              NET + Pesanan belum dibayar = {formatPrice((reportTotals?.net ?? netCompleted) + netPending)}
            </span>
          </h1>

          {/* Offline/System POS Toggle - Only show for super admin */}
          {canViewOfflineSystemPosSwitch && (
            <div className="flex items-center gap-3">
              <span className={`text-sm font-medium ${!isSystemPosMode ? 'text-gray-900' : 'text-gray-500'}`}>
                <WifiOff className="inline w-4 h-4 mr-1" />
                Offline
              </span>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={isSystemPosMode}
                  onChange={(e) => setIsSystemPosMode(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
              <span className={`text-sm font-medium ${isSystemPosMode ? 'text-gray-900' : 'text-gray-500'}`}>
                <Wifi className="inline w-4 h-4 mr-1" />
                System POS
              </span>
            </div>
          )}
        </div>

        {/* Summary Cards — custom 4-track grid: Metode 25% narrower; Ringkasan 75%, Grand Total gets 25% of Ringkasan width; all cards same height */}
        <div className="grid grid-cols-1 md:grid-cols-[2.25fr_0.75fr_0.807fr_1.057fr] md:auto-rows-[10.5rem] gap-4 mb-1 flex-shrink-0">
          {/* Payment Methods Card — first track (2.25fr, was 3fr) */}
          <div className="bg-white shadow-sm border border-gray-200 pl-4 pt-4 pb-4 pr-2 md:col-span-1 min-w-0 flex flex-col min-h-[10.5rem] md:h-full md:min-h-0">
            <div className="flex items-center gap-2 mb-2 flex-shrink-0 pr-2">
              <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
              <h3 className="font-semibold text-gray-900 text-sm">Metode Pembayaran</h3>
            </div>
            <div className="min-h-0 min-w-0 flex-1 overflow-hidden flex flex-col">
              <table className="text-xs border-collapse w-full min-w-0" style={{ tableLayout: 'fixed' }}>
                <colgroup>
                  <col style={{ width: '22%' }} />
                  <col style={{ width: '13%' }} />
                  <col style={{ width: '25%' }} />
                  <col style={{ width: '22%' }} />
                  <col style={{ width: '13%' }} />
                  <col style={{ width: '25%' }} />
                </colgroup>
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-0.5 pr-1 font-medium text-gray-600 truncate">Metode</th>
                    <th className="text-right py-0.5 px-0.5 font-medium text-gray-600 whitespace-nowrap">Jml</th>
                    <th className="text-left py-0.5 pl-0.5 pr-1 font-medium text-gray-600 tabular-nums">Total</th>
                    <th className="text-left py-0.5 pr-1 font-medium text-gray-600 truncate">Metode</th>
                    <th className="text-right py-0.5 px-0.5 font-medium text-gray-600 whitespace-nowrap">Jml</th>
                    <th className="text-left py-0.5 pl-0.5 font-medium text-gray-600 tabular-nums">Total</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-gray-100">
                    <td className="py-0.5 pr-1 text-gray-600 truncate">Cash</td>
                    <td className="py-0.5 px-0.5 text-right tabular-nums font-medium text-gray-900">{paymentMethodCounts.cash}</td>
                    <td className="py-0.5 pl-0.5 pr-1 text-left tabular-nums font-medium text-gray-900 truncate" title={formatPrice(paymentMethodTotals.cash)}>{formatPrice(paymentMethodTotals.cash)}</td>
                    <td className="py-0.5 pr-1 text-gray-600 truncate">ShopeeFood</td>
                    <td className="py-0.5 px-0.5 text-right tabular-nums font-medium text-gray-900">{paymentMethodCounts.shopeefood}</td>
                    <td className="py-0.5 pl-0.5 pr-1 text-left tabular-nums font-medium text-gray-900 truncate" title={formatPrice(paymentMethodTotals.shopeefood)}>{formatPrice(paymentMethodTotals.shopeefood)}</td>
                  </tr>
                  <tr className="border-b border-gray-100">
                    <td className="py-0.5 pr-1 text-gray-600 truncate">Debit</td>
                    <td className="py-0.5 px-0.5 text-right tabular-nums font-medium text-gray-900">{paymentMethodCounts.debit}</td>
                    <td className="py-0.5 pl-0.5 pr-1 text-left tabular-nums font-medium text-gray-900 truncate" title={formatPrice(paymentMethodTotals.debit)}>{formatPrice(paymentMethodTotals.debit)}</td>
                    <td className="py-0.5 pr-1 text-gray-600 truncate">GrabFood</td>
                    <td className="py-0.5 px-0.5 text-right tabular-nums font-medium text-gray-900">{paymentMethodCounts.grabfood}</td>
                    <td className="py-0.5 pl-0.5 pr-1 text-left tabular-nums font-medium text-gray-900 truncate" title={formatPrice(paymentMethodTotals.grabfood)}>{formatPrice(paymentMethodTotals.grabfood)}</td>
                  </tr>
                  <tr className="border-b border-gray-100">
                    <td className="py-0.5 pr-1 text-gray-600 truncate">QR</td>
                    <td className="py-0.5 px-0.5 text-right tabular-nums font-medium text-gray-900">{paymentMethodCounts.qr}</td>
                    <td className="py-0.5 pl-0.5 pr-1 text-left tabular-nums font-medium text-gray-900 truncate" title={formatPrice(paymentMethodTotals.qr)}>{formatPrice(paymentMethodTotals.qr)}</td>
                    <td className="py-0.5 pr-1 text-gray-600 truncate">TikTok</td>
                    <td className="py-0.5 px-0.5 text-right tabular-nums font-medium text-gray-900">{paymentMethodCounts.tiktok}</td>
                    <td className="py-0.5 pl-0.5 pr-1 text-left tabular-nums font-medium text-gray-900 truncate" title={formatPrice(paymentMethodTotals.tiktok)}>{formatPrice(paymentMethodTotals.tiktok)}</td>
                  </tr>
                  <tr className="border-b border-gray-100">
                    <td className="py-0.5 pr-1 text-gray-600 truncate">E-Wallet</td>
                    <td className="py-0.5 px-0.5 text-right tabular-nums font-medium text-gray-900">{paymentMethodCounts.ewallet}</td>
                    <td className="py-0.5 pl-0.5 pr-1 text-left tabular-nums font-medium text-gray-900 truncate" title={formatPrice(paymentMethodTotals.ewallet)}>{formatPrice(paymentMethodTotals.ewallet)}</td>
                    <td className="py-0.5 pr-1 text-gray-600 truncate">Qpon</td>
                    <td className="py-0.5 px-0.5 text-right tabular-nums font-medium text-gray-900">{paymentMethodCounts.qpon}</td>
                    <td className="py-0.5 pl-0.5 text-left tabular-nums font-medium text-gray-900 truncate" title={formatPrice(paymentMethodTotals.qpon)}>{formatPrice(paymentMethodTotals.qpon)}</td>
                  </tr>
                  <tr className="border-b border-gray-100">
                    <td className="py-0.5 pr-1 text-gray-600 truncate">CL</td>
                    <td className="py-0.5 px-0.5 text-right tabular-nums font-medium text-gray-900">{paymentMethodCounts.cl}</td>
                    <td className="py-0.5 pl-0.5 pr-1 text-left tabular-nums font-medium text-gray-900 truncate" title={formatPrice(paymentMethodTotals.cl)}>{formatPrice(paymentMethodTotals.cl)}</td>
                    <td className="py-0.5 pr-1 text-gray-600 truncate">GoFood</td>
                    <td className="py-0.5 px-0.5 text-right tabular-nums font-medium text-gray-900">{paymentMethodCounts.gofood}</td>
                    <td className="py-0.5 pl-0.5 pr-1 text-left tabular-nums font-medium text-gray-900 truncate" title={formatPrice(paymentMethodTotals.gofood)}>{formatPrice(paymentMethodTotals.gofood)}</td>
                  </tr>
                  <tr className="border-b border-gray-100">
                    <td className="py-0.5 pr-1 text-gray-600 truncate">Voucher</td>
                    <td className="py-0.5 px-0.5 text-right tabular-nums font-medium text-gray-900">{paymentMethodCounts.voucher}</td>
                    <td className="py-0.5 pl-0.5 pr-1 text-left tabular-nums font-medium text-gray-900 truncate" title={formatPrice(paymentMethodTotals.voucher)}>{formatPrice(paymentMethodTotals.voucher)}</td>
                    <td className="py-0.5 pr-1"></td>
                    <td className="py-0.5 px-0.5"></td>
                    <td className="py-0.5 pl-0.5"></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Single card: Dine in / Take away counters + Total diskon */}
          <div className="bg-white shadow-sm border border-gray-200 p-4 md:col-span-1 min-h-[10.5rem] md:h-full md:min-h-0 flex flex-col min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-3 h-3 bg-green-500 rounded-full"></div>
              <h3 className="font-semibold text-gray-900 text-sm">Ringkasan</h3>
            </div>
            <div className="space-y-2 text-xs flex-1">
              <div className="flex justify-between items-baseline">
                <span className="text-gray-600">Dine in counter</span>
                <span className="font-medium text-gray-900 tabular-nums">{dineInCount}</span>
              </div>
              <div className="flex justify-between items-baseline">
                <span className="text-gray-600">Take away counter</span>
                <span className="font-medium text-gray-900 tabular-nums">{takeAwayCount}</span>
              </div>
            </div>
          </div>

          {/* Item Dibatalkan card — before Grand Total; follows current mode (Printer 2 only vs all). Button opens modal. */}
          <div className="bg-white shadow-sm border border-gray-200 p-4 md:col-span-1 min-h-[10.5rem] md:h-full md:min-h-0 flex flex-col min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-3 h-3 bg-red-400 rounded-full"></div>
              <h3 className="font-semibold text-gray-900 text-sm">Item Dibatalkan</h3>
            </div>
            <div className="flex flex-col gap-1 text-xs flex-1">
              <div className="flex justify-between items-baseline">
                <span className="text-gray-600">Jumlah item</span>
                <span className="font-medium text-gray-900 tabular-nums">
                  {displayedCancelledItems.reduce((s, i) => s + Number(i.quantity || 0), 0)}
                </span>
              </div>
              <div className="flex justify-between items-baseline">
                <span className="text-gray-600">Total nilai</span>
                <span className="font-medium text-red-700 tabular-nums">
                  {formatPrice(displayedCancelledItems.reduce((s, i) => s + Number(i.total_price || 0), 0))}
                </span>
              </div>
              {displayedCancelledItems.length === 0 && (
                <span className="text-gray-400 mt-1">Tidak ada</span>
              )}
            </div>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setShowCancelledModal(true); }}
              className="mt-2 w-full py-1.5 px-2 rounded border border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-700 text-xs font-medium transition-colors"
            >
              Lihat pembatalan
            </button>
          </div>

          {/* Grand Total Card — takes remaining width (5 cols) */}
          <GrandTotalCard
            grossAmount={reportTotals?.gross ?? grossCompleted}
            totalDiscount={reportTotals?.discount ?? discountCompleted}
            totalRefund={reportTotals?.refund ?? refundCompleted}
            totalRevenue={reportTotals ? reportTotals.net + reportTotals.refund : totalRevenueCompleted}
            netAmount={reportTotals?.net ?? netCompleted}
            totalCustomerUnit={totalCustomerUnit}
            totalTransactionCount={totalTransactionCount}
            onFiveClick={handleFiveClickToggle}
          />
        </div>

        {/* Modal: Tabel Item Dibatalkan (same columns as Ganti Shift). Shows items for current mode. */}
        {showCancelledModal && createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50" onClick={() => setShowCancelledModal(false)} role="dialog" aria-modal="true" aria-labelledby="cancelled-modal-title">
            <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between p-4 border-b border-gray-200">
                <h2 id="cancelled-modal-title" className="font-semibold text-gray-900 text-lg">Item Dibatalkan</h2>
                <button type="button" onClick={() => setShowCancelledModal(false)} className="p-2 rounded hover:bg-gray-100 text-gray-600" aria-label="Tutup">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="overflow-auto flex-1 p-4">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-gray-200 text-left text-gray-600 font-medium">
                      <th className="py-2 pr-2 whitespace-nowrap">Waktu</th>
                      <th className="py-2 pr-2">Produk</th>
                      <th className="py-2 pr-2 text-right whitespace-nowrap text-black">Qty</th>
                      <th className="py-2 pr-2 text-right whitespace-nowrap text-black">Harga</th>
                      <th className="py-2 pr-2 whitespace-nowrap">#Struk</th>
                      <th className="py-2 pr-2">Pelanggan</th>
                      <th className="py-2">Dibatalkan Oleh</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedCancelledItems.map((item, idx) => {
                      const cancelledBy = [item.cancelled_by_user_name, item.cancelled_by_waiter_name]
                        .filter((n) => n && n !== 'Tidak diketahui')
                        .join(' / ') || '–';
                      return (
                        <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="py-1.5 pr-2 text-gray-700 whitespace-nowrap">{item.cancelled_at ? formatDate(item.cancelled_at) : '–'}</td>
                          <td className="py-1.5 pr-2 text-gray-900">{item.product_name || '–'}</td>
                          <td className="py-1.5 pr-2 text-right tabular-nums text-black">{item.quantity ?? 0}</td>
                          <td className="py-1.5 pr-2 text-right tabular-nums text-black">{formatPrice(item.total_price ?? 0)}</td>
                          <td className="py-1.5 pr-2 text-gray-700">#{item.receipt_number ?? '–'}</td>
                          <td className="py-1.5 pr-2 text-gray-700">{item.customer_name ?? '–'}</td>
                          <td className="py-1.5 text-gray-700">{cancelledBy}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-gray-200 font-medium text-gray-900">
                      <td colSpan={2} className="py-2 pr-2">Total</td>
                      <td className="py-2 pr-2 text-right tabular-nums text-black">{displayedCancelledItems.reduce((s, i) => s + Number(i.quantity || 0), 0)}</td>
                      <td className="py-2 pr-2 text-right tabular-nums text-black">{formatPrice(displayedCancelledItems.reduce((s, i) => s + Number(i.total_price || 0), 0))}</td>
                      <td colSpan={3} className="py-2" />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>,
          document.body
        )}

        {/* Search and Filter — same style as Semua Transaksi, full width */}
        <div className="w-full bg-gray-50 rounded-lg p-3 mb-1 flex-shrink-0">
          <div className="flex flex-wrap items-center gap-2 w-full">
            <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
              <div className="relative flex-1 min-w-[100px] max-w-[153px]">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search..."
                  className="w-full pl-8 pr-7 py-1.5 border border-gray-300 rounded text-xs focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                />
                {searchTerm && (
                  <button
                    onClick={() => setSearchTerm('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
              <div className="min-w-0 max-w-[130px]">
                <div className="relative">
                  <Calendar className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
                  <input
                    type="date"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                    className="w-full pl-7 pr-2 py-1.5 border border-gray-300 rounded text-xs focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                  />
                </div>
              </div>
              <div className="min-w-0 max-w-[130px]">
                <div className="relative">
                  <Calendar className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
                  <input
                    type="date"
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                    className="w-full pl-7 pr-2 py-1.5 border border-gray-300 rounded text-xs focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                  />
                </div>
              </div>
              {/* Amount range — Total (min) / Total (max) */}
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <div className="min-w-0 w-[115px]">
                  <input
                    type="text"
                    value={amountFrom}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/\D/g, '');
                      setAmountFrom(raw === '' ? '' : 'Rp ' + raw.replace(/\B(?=(\d{3})+(?!\d))/g, '.'));
                    }}
                    placeholder="Total (min)"
                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                  />
                </div>
                <span className="text-gray-400 text-xs">–</span>
                <div className="min-w-0 w-[115px]">
                  <input
                    type="text"
                    value={amountTo}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/\D/g, '');
                      setAmountTo(raw === '' ? '' : 'Rp ' + raw.replace(/\B(?=(\d{3})+(?!\d))/g, '.'));
                    }}
                    placeholder="Total (max)"
                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                  />
                </div>
              </div>
              <div className="min-w-0 max-w-[120px]">
                <div className="relative">
                  <select
                    value={shiftFilterUuid}
                    onChange={(e) => setShiftFilterUuid(e.target.value)}
                    className="w-full pl-2 pr-6 py-1.5 border border-gray-300 rounded text-xs focus:ring-2 focus:ring-blue-500 focus:border-blue-500 appearance-none bg-white text-gray-900"
                    title="Filter by shift"
                  >
                    <option value="">Shift: All</option>
                    <option value="none">Shift: No shift</option>
                    {Object.entries(shiftLabelByUuid)
                      .sort((a, b) => a[1].filterLabel.localeCompare(b[1].filterLabel))
                      .map(([uuid, info]) => (
                        <option key={uuid} value={uuid}>
                          Shift: {info.filterLabel}
                        </option>
                      ))}
                  </select>
                  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
                </div>
              </div>
              <div className="min-w-0 max-w-[110px]">
                <div className="relative">
                  <CreditCard className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
                  <select
                    value={filterMethod}
                    onChange={(e) => setFilterMethod(e.target.value)}
                    className="w-full pl-6 pr-6 py-1.5 border border-gray-300 rounded text-xs focus:ring-2 focus:ring-blue-500 focus:border-blue-500 appearance-none bg-white text-gray-900"
                  >
                    <option value="all">Payment</option>
                    <option value="cash">Cash</option>
                    <option value="debit">Debit</option>
                    <option value="qr">QR Code</option>
                    <option value="ewallet">E-Wallet</option>
                    <option value="cl">City Ledger</option>
                    <option value="voucher">Voucher</option>
                    <option value="gofood">GoFood</option>
                    <option value="grabfood">GrabFood</option>
                    <option value="shopeefood">ShopeeFood</option>
                    <option value="qpon">Qpon</option>
                    <option value="tiktok">TikTok</option>
                  </select>
                  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
                </div>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    const today = getTodayUTC7();
                    setFromDate(today);
                    setToDate(today);
                  }}
                  className="px-2 py-1 text-[10px] bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 rounded"
                >
                  1D
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const today = getTodayUTC7();
                    const [y, m, d] = today.split('-').map(Number);
                    const end = new Date(y, m - 1, d);
                    const start = new Date(end);
                    start.setDate(start.getDate() - 6);
                    const fmt = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
                    setFromDate(fmt(start));
                    setToDate(fmt(end));
                  }}
                  className="px-2 py-1 text-[10px] bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 rounded"
                >
                  7D
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const today = getTodayUTC7();
                    const [y, m, d] = today.split('-').map(Number);
                    const end = new Date(y, m - 1, d);
                    const start = new Date(end);
                    start.setDate(start.getDate() - 29);
                    const fmt = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
                    setFromDate(fmt(start));
                    setToDate(fmt(end));
                  }}
                  className="px-2 py-1 text-[10px] bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 rounded"
                >
                  30D
                </button>
              </div>
              <div className="relative" ref={columnPickerRef}>
                <button
                  type="button"
                  onClick={() => setShowColumnPicker((v) => !v)}
                  title="Tampilkan / sembunyikan kolom"
                  className="flex items-center justify-center min-w-8 px-2 py-1.5 text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded transition-colors flex-shrink-0"
                >
                  <Columns className="w-3.5 h-3.5" />
                </button>
                {showColumnPicker && (
                  <div className="absolute right-0 top-full mt-1 z-50 w-56 bg-white border border-gray-200 rounded-lg shadow-lg p-3 max-h-80 overflow-y-auto">
                    <p className="text-xs font-semibold text-gray-700 mb-2">Tampilkan kolom</p>
                    <div className="space-y-1.5">
                      {TRANSACTION_COLUMNS.map((col) => (
                        <label key={col.key} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 rounded px-2 py-1">
                          <input
                            type="checkbox"
                            checked={columnVisibility[col.key] !== false}
                            onChange={() => setColumnVisible(col.key, columnVisibility[col.key] === false)}
                            className="w-4 h-4 text-blue-600 rounded border-gray-300"
                          />
                          <span className="text-xs text-gray-800">{col.label || col.key}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <button
                onClick={handleRefresh}
                disabled={isLoading}
                title="Refresh"
                className="flex items-center justify-center min-w-8 px-2 py-1.5 text-white bg-blue-600 hover:bg-blue-700 rounded border border-blue-600 transition-colors disabled:opacity-50 flex-shrink-0"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              </button>
              <button
                onClick={() => {
                  setSearchTerm('');
                  setFilterMethod('all');
                  setAmountFrom('');
                  setAmountTo('');
                  setShiftFilterUuid('');
                  setShiftLabelByUuid({}); // Clear to avoid stale shift labels before refetch
                  const gmt7Offset = 7 * 60 * 60 * 1000;
                  const now = new Date();
                  const nowGmt7 = new Date(now.getTime() + gmt7Offset);
                  const end = new Date(nowGmt7);
                  const start = new Date(nowGmt7);
                  start.setUTCDate(start.getUTCDate() - 30);
                  const formatDateInput = (d: Date) =>
                    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
                  setToDate(formatDateInput(end));
                  setFromDate(formatDateInput(start));
                }}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-gray-200 hover:bg-gray-300 text-gray-700 rounded transition-colors flex-shrink-0"
              >
                <X className="w-3 h-3" />
                Clear
              </button>
            </div>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 flex-shrink-0">
            <p className="text-red-800">{error}</p>
          </div>
        )}

        {/* Info Message for Offline Mode */}
        {!isSystemPosMode && transactions.length === 0 && !error && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6 flex-shrink-0">
            <div className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-blue-600" />
              <div>
                <p className="text-blue-800 font-medium">No transactions found for this date in offline database</p>
                <p className="text-blue-600 text-sm mt-1">
                  Try syncing data from online database or select a different date.
                  Check console for available dates in offline database.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Info Message for System POS Mode */}
        {isSystemPosMode && transactions.length === 0 && !error && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6 flex-shrink-0">
            <div className="flex items-center gap-2">
              <Wifi className="w-5 h-5 text-yellow-600" />
              <div>
                <p className="text-yellow-800 font-medium">No transactions found for this date range in system_pos database</p>
                <p className="text-yellow-600 text-sm mt-1">
                  Only transactions printed to Printer 2 are stored in system_pos database.
                  Make sure transactions have been printed to Printer 2.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Transactions Table Container — min-w-0 so wide table scrolls inside page instead of growing layout */}
        <div className="flex-1 flex flex-col min-h-0 min-w-0 mb-8" style={{ maxHeight: 'calc(100vh - 390px)' }}>
          {filteredTransactions.length === 0 ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <CreditCard className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-600 mb-2">Tidak ada transaksi</h3>
                <p className="text-gray-500">Belum ada transaksi hari ini</p>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col p-4 min-h-0 min-w-0">
              <p className="text-xs text-gray-500 mb-2 flex-shrink-0" aria-live="polite">
                {filteredTransactions.length} baris
              </p>
              <div className="flex-1 min-h-0 overflow-auto rounded-xl border border-gray-200 bg-white shadow-sm">
                <table className="w-full text-sm" style={{ tableLayout: 'auto' }}>
                  <thead className="bg-gray-50 text-gray-900 font-semibold border-b border-gray-200 sticky top-0 z-10 shadow-[0_1px_0_0_rgba(229,231,235,1)]">
                    <tr className="[&_th]:align-middle">
                      {visibleColumns.map((col) => (
                        <th
                          key={col.key}
                          style={{ textAlign: 'center', padding: col.key === 'actions' ? '4px' : '4px 6px', margin: 0, width: col.key === 'actions' ? 28 : undefined }}
                          className={`text-[10px] font-medium text-gray-500 uppercase tracking-wider select-none whitespace-nowrap ${col.sortKey ? 'cursor-pointer hover:bg-gray-100' : ''}`}
                          onClick={col.sortKey ? () => handleSort(col.sortKey!) : undefined}
                        >
                          {col.label} {col.sortKey ? getSortIcon(col.sortKey) : null}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 [&_td]:align-middle">
                    {filteredTransactions.map((transaction) => (
                      <tr
                        key={transaction.id}
                        className={`hover:bg-blue-50 cursor-pointer transition-colors group ${loadingTransactionId === transaction.id ? 'opacity-50' : ''}`}
                        onClick={() => handleRowClick(transaction)}
                      >
                        {visibleColumns.map((col) => (
                          <td
                            key={col.key}
                            style={{
                              textAlign: 'center',
                              padding: col.key === 'actions' ? '4px' : '4px 6px',
                              margin: 0,
                              width: col.key === 'actions' ? 28 : undefined
                            }}
                            className={
                              col.key === 'customer_name' || col.key === 'user_name' ? 'min-w-0 align-middle' :
                                col.key === 'waiter' ? 'whitespace-nowrap' :
                                  col.key === 'voucher_discount' ? 'whitespace-nowrap cursor-pointer tabular-nums' :
                                    col.key === 'refund_total' ? 'whitespace-nowrap tabular-nums' :
                                      col.key === 'actions' ? '' : 'whitespace-nowrap'
                            }
                            onClick={col.key === 'voucher_discount' ? (e) => { e.stopPropagation(); setVoucherClickCount(prev => { const next = prev + 1; if (next >= 5 && canViewPrintingLogs) { setShowPrintingLogs(true); return 0; } return next; }); } : undefined}
                          >
                            {col.key === 'receipt_number' && (
                              <div className="flex items-center justify-center gap-1">
                                {transaction.status === 'pending' ? (
                                  <span className="text-xs text-gray-400">-</span>
                                ) : (() => {
                                  const txId = String(transaction.id);
                                  const receiptizeCounter = receiptizeCounters[txId];
                                  const receiptCounter = receiptCounters[txId];
                                  const hasReceiptizeCounter = typeof receiptizeCounter === 'number' && receiptizeCounter > 0;
                                  const hasReceiptCounter = typeof receiptCounter === 'number' && receiptCounter > 0;
                                  const isInReceiptizeIds = receiptizePrintedIds.has(txId);
                                  const isReceiptize = isInReceiptizeIds || hasReceiptizeCounter;
                                  let displayNumber: number;
                                  if (hasReceiptizeCounter) displayNumber = receiptizeCounter;
                                  else if (hasReceiptCounter) displayNumber = receiptCounter;
                                  else displayNumber = typeof transaction.receipt_number === 'number' && transaction.receipt_number > 0 ? transaction.receipt_number : 0;
                                  const numberToShow = !showAllTransactions && creationOrderRank[txId] != null ? creationOrderRank[txId]! : displayNumber;
                                  if (isReceiptize) {
                                    if (showAllTransactions) return <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800"><span>{displayNumber}</span><span className="inline-block min-w-[1.75rem] text-center">RR</span></span>;
                                    return <span className="text-xs font-medium text-blue-600">{numberToShow}</span>;
                                  }
                                  if (showAllTransactions && hasReceiptCounter && !isReceiptize) return <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800"><span>{displayNumber}</span><span className="inline-block min-w-[1.75rem] text-center">R</span></span>;
                                  if (numberToShow > 0) return <span className="text-xs font-medium text-blue-600">{numberToShow}</span>;
                                  return <span className="inline-flex items-center px-1 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">N/A</span>;
                                })()}
                              </div>
                            )}
                            {col.key === 'created_at' && <span className="text-[10px] text-gray-900">{formatDate(transaction.created_at)}</span>}
                            {col.key === 'updated_at' && <span className="text-[10px] text-gray-700">{transaction.updated_at ? formatDate(transaction.updated_at) : '-'}</span>}
                            {col.key === 'paid_at' && <span className="text-[10px] text-gray-700">{transaction.paid_at ? formatDate(transaction.paid_at) : '-'}</span>}
                            {col.key === 'payment_method' && (
                              <div className="flex flex-col gap-1 items-center">
                                <span className={`inline-flex px-1.5 py-0.5 text-xs font-semibold rounded-full ${getPaymentMethodColor(transaction)}`}>
                                  {getPaymentMethodLabel(transaction)}
                                </span>
                                {transaction.status === 'pending' && (
                                  <span className="inline-flex px-1.5 py-0.5 text-[10px] font-semibold rounded-full bg-orange-100 text-orange-800">Belum Bayar</span>
                                )}
                              </div>
                            )}
                            {col.key === 'pickup_method' && <span className="text-xs text-gray-900 capitalize">{transaction.pickup_method.replace('-', ' ')}</span>}
                            {col.key === 'package' && (
                              transactionIdsWithPackage.has(String(transaction.id))
                                ? <span className="inline-flex px-1.5 py-0.5 text-[10px] font-medium rounded bg-amber-100 text-amber-800" title="Memiliki item paket">Pkg</span>
                                : <span className="text-xs text-gray-400">-</span>
                            )}
                            {col.key === 'total_amount' && <span className="text-xs font-medium text-gray-900 tabular-nums">{formatPrice(transaction.total_amount)}</span>}
                            {col.key === 'voucher_discount' && (
                              transaction.voucher_discount > 0 ? (
                                <div style={{ textAlign: 'center' }} className="flex flex-col items-center">
                                  <span className="text-xs text-green-600 font-medium tabular-nums">-{formatPrice(transaction.voucher_discount)}</span>
                                  {transaction.voucher_label && <span className="text-[10px] text-green-500 font-medium">{transaction.voucher_label}</span>}
                                </div>
                              ) : <span className="text-xs text-gray-400">-</span>
                            )}
                            {col.key === 'final_amount' && <span className="text-xs font-bold text-gray-900 tabular-nums">{formatPrice(transaction.final_amount)}</span>}
                            {col.key === 'refund_total' && (() => {
                              const refundAmount = transaction.refund_total != null ? (typeof transaction.refund_total === 'number' ? transaction.refund_total : parseFloat(String(transaction.refund_total))) : 0;
                              if (refundAmount > 0) return (
                                <div style={{ textAlign: 'center' }} className="flex flex-col items-center">
                                  <span className="text-xs text-red-600 font-medium tabular-nums">-{formatPrice(refundAmount)}</span>
                                  {transaction.refund_status && <span className={`text-[10px] font-medium ${transaction.refund_status === 'full' ? 'text-red-600' : 'text-orange-600'}`}>{transaction.refund_status === 'full' ? 'Full' : 'Partial'}</span>}
                                </div>
                              );
                              return <span className="text-xs text-gray-400">-</span>;
                            })()}
                            {col.key === 'customer_name' && <span className="text-xs text-gray-900 truncate block" title={transaction.customer_name || 'Guest'}>{transaction.customer_name || 'Guest'}</span>}
                            {col.key === 'waiter' && (() => {
                              const itemIds = itemWaiterIdsByTx[transaction.id] || [];
                              const allIds = [...new Set([transaction.waiter_id, ...itemIds].filter((id): id is number => id != null))];
                              const primaryId = transaction.waiter_id ?? allIds[0];
                              const names = allIds.map((id) => employeesMap.get(id)?.name).filter((n): n is string => Boolean(n));
                              return (
                                <div className="relative inline-block">
                                  <button
                                    ref={openWaiterPopoverFor === transaction.id ? waiterTriggerRef : undefined}
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); setOpenWaiterPopoverFor((id) => (id === transaction.id ? null : transaction.id)); }}
                                    className="cursor-pointer rounded focus:outline-none focus:ring-2 focus:ring-blue-400"
                                    title={names.length > 1 ? names.join(', ') : undefined}
                                  >
                                    {!primaryId || !employeesMap.has(primaryId) ? <span className="text-xs text-gray-900">-</span> : (() => {
                                      const waiter = employeesMap.get(primaryId)!;
                                      const hasMultiple = allIds.length > 1;
                                      if (waiter.color) return <span className="text-xs font-medium text-white px-2 py-1 inline-block" style={{ backgroundColor: waiter.color }}>{waiter.name}{hasMultiple && <span className="text-white/80 ml-0.5">(+{allIds.length - 1})</span>}</span>;
                                      return <span className="text-xs text-gray-900">{waiter.name}{hasMultiple && <span className="text-gray-500 ml-0.5">(+{allIds.length - 1})</span>}</span>;
                                    })()}
                                  </button>
                                  {openWaiterPopoverFor === transaction.id && names.length > 0 && waiterPopoverPos && typeof document !== 'undefined' && createPortal(
                                    <div
                                      ref={waiterPopoverRef}
                                      className="fixed z-[9999] min-w-[120px] rounded-lg border border-gray-200 bg-white py-2 shadow-lg"
                                      style={{ top: waiterPopoverPos.top, left: waiterPopoverPos.left, transform: 'translateX(-50%)' }}
                                    >
                                      <div className="px-3 py-1 text-xs font-semibold text-gray-500 uppercase">Waiters</div>
                                      {names.map((name, i) => <div key={i} className="px-3 py-1.5 text-sm text-gray-900">{name}</div>)}
                                    </div>,
                                    document.body
                                  )}
                                </div>
                              );
                            })()}
                            {col.key === 'user_name' && (
                              <div className="flex flex-col items-center gap-0.5">
                                <span className="text-xs text-gray-900 truncate block" title={transaction.user_name || 'Unknown'}>{transaction.user_name || 'Unknown'}</span>
                                {canChangeTransactionUser && (
                                  <>
                                    <button
                                      ref={openKasirFor === transaction.id ? kasirTriggerRef : undefined}
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); setOpenKasirFor((id) => (id === transaction.id ? null : transaction.id)); }}
                                      disabled={savingKasirFor === transaction.id}
                                      className="text-[10px] text-blue-600 hover:text-blue-800 hover:underline disabled:opacity-50"
                                    >
                                      {savingKasirFor === transaction.id ? '...' : 'Ubah'}
                                    </button>
                                    {openKasirFor === transaction.id && kasirDropdownPos && typeof document !== 'undefined' && createPortal(
                                      <div
                                        ref={kasirDropdownRef}
                                        className="fixed z-[9999] min-w-[140px] max-h-[200px] overflow-y-auto rounded-lg border border-gray-200 bg-white py-2 shadow-lg"
                                        style={{ top: kasirDropdownPos.top, left: kasirDropdownPos.left, transform: 'translateX(-50%)' }}
                                      >
                                        <div className="px-3 py-1 text-xs font-semibold text-gray-500 uppercase">Ganti Kasir</div>
                                        {kasirOptionsForBusiness.map((u) => (
                                          <button
                                            key={u.id}
                                            type="button"
                                            onClick={(e) => { e.stopPropagation(); handleSelectKasir(transaction.id, u.id); }}
                                            className="block w-full px-3 py-2 text-left text-sm text-gray-900 hover:bg-gray-100"
                                          >
                                            {u.name}
                                          </button>
                                        ))}
                                        {kasirOptionsForBusiness.length === 0 && <div className="px-3 py-2 text-sm text-gray-500">Tidak ada user</div>}
                                      </div>,
                                      document.body
                                    )}
                                  </>
                                )}
                              </div>
                            )}
                            {col.key === 'shift' && (
                              <div className="flex flex-col items-center gap-0.5">
                                <span className="text-xs text-gray-700" title={transaction.shift_uuid ?? undefined}>{transaction.shift_uuid ? (shiftLabelByUuid[transaction.shift_uuid]?.cellLabel ?? 'Shift') : '-'}</span>
                                {canBindToShift && <button type="button" onClick={(e) => { e.stopPropagation(); handleOpenBindShift(transaction); }} className="text-[10px] text-blue-600 hover:text-blue-800 hover:underline">{transaction.shift_uuid ? 'Ubah' : 'Bind'}</button>}
                                {canDeleteTransaction && <button type="button" onClick={(e) => { e.stopPropagation(); handleOpenDeleteTransaction(transaction); }} className="text-[10px] text-red-600 hover:text-red-800 hover:underline flex items-center gap-0.5 justify-center" title="Hapus transaksi (Super Admin)"><Trash2 className="w-3 h-3" /> Hapus</button>}
                              </div>
                            )}
                            {col.key === 'actions' && <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-blue-500 transition-colors" />}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Transaction Detail Modal */}
      <TransactionDetailModal
        isOpen={isDetailModalOpen}
        onClose={handleCloseDetailModal}
        transaction={selectedTransaction}
        isLoading={isLoadingDetail}
        canRefund={canRefund}
        onTransactionUpdated={handleTransactionUpdated}
      />

      {/* Delete Transaction Modal (Super Admin only) */}
      {showDeleteTxModal && transactionToDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => !isDeletingTx && setShowDeleteTxModal(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <Trash2 className="w-5 h-5 text-red-600" />
                Hapus transaksi
              </h3>
              <p className="text-sm text-gray-600 mt-1">
                Transaksi #{transactionToDelete.receipt_number ?? transactionToDelete.id.slice(0, 8)} — ID: <code className="text-xs bg-gray-100 px-1 rounded">{transactionToDelete.id}</code>
              </p>
              <p className="text-xs text-amber-700 mt-2 bg-amber-50 border border-amber-200 rounded p-2">
                Hanya transaksi ini yang akan dihapus. Penghapusan akan menghapus dari semua tabel terkait (items, customizations, refunds, printer audit, system_pos).
              </p>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {deleteTxError && (
                <p className="text-sm text-red-600 mb-3">{deleteTxError}</p>
              )}
              {isLoadingDeletePreview ? (
                <p className="text-sm text-gray-500">Memuat preview query...</p>
              ) : deletePreview ? (
                <div className="space-y-4">
                  <div>
                    <p className="text-xs font-semibold text-gray-700 mb-1">Main DB (salespulse):</p>
                    <pre className="text-xs bg-gray-900 text-gray-100 p-3 rounded-lg overflow-x-auto max-h-48 overflow-y-auto">
                      {deletePreview.queries.map((q, i) => (
                        <span key={i} className="block text-green-300 mb-1">
                          {q.description}: {q.sql} {JSON.stringify(q.params)}
                        </span>
                      ))}
                    </pre>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-gray-700 mb-1">System POS DB:</p>
                    <pre className="text-xs bg-gray-900 text-gray-100 p-3 rounded-lg overflow-x-auto max-h-32 overflow-y-auto">
                      {deletePreview.systemPosQueries.map((q, i) => (
                        <span key={i} className="block text-green-300 mb-1">
                          {q.description}: {q.sql} {JSON.stringify(q.params)}
                        </span>
                      ))}
                    </pre>
                  </div>
                </div>
              ) : null}
            </div>
            <div className="flex justify-end gap-2 p-6 border-t border-gray-200 bg-gray-50">
              <button
                type="button"
                onClick={() => { setShowDeleteTxModal(false); setTransactionToDelete(null); setDeletePreview(null); setDeleteTxError(null); }}
                disabled={isDeletingTx}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 disabled:opacity-50 rounded-lg"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteTransaction}
                disabled={isDeletingTx || isLoadingDeletePreview || !deletePreview}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-lg flex items-center gap-2"
              >
                {isDeletingTx ? 'Menghapus...' : 'Ya, Hapus transaksi'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bind to Shift Modal (Super Admin only) */}
      {showBindShiftModal && transactionToBind && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowBindShiftModal(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Bind transaksi ke shift</h3>
            <p className="text-sm text-gray-600 mb-4">
              Transaksi #{transactionToBind.receipt_number ?? transactionToBind.id.slice(0, 8)} — pilih shift:
            </p>
            {bindShiftError && (
              <p className="text-sm text-red-600 mb-2">{bindShiftError}</p>
            )}
            {isLoadingBindShifts ? (
              <p className="text-sm text-gray-500 py-4">Memuat daftar shift...</p>
            ) : bindShiftList.length === 0 ? (
              <p className="text-sm text-gray-500 py-4">Tidak ada shift untuk periode transaksi ini.</p>
            ) : (
              <ul className="space-y-2 max-h-64 overflow-y-auto mb-4">
                <li>
                  <label className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 cursor-pointer">
                    <input
                      type="radio"
                      name="bindShift"
                      checked={selectedBindShiftUuid === null}
                      onChange={() => setSelectedBindShiftUuid(null)}
                      className="w-4 h-4 text-blue-600"
                    />
                    <span className="text-sm text-gray-800">— Tidak ada shift (lepas)</span>
                  </label>
                </li>
                {bindShiftList.map((shift, idx) => (
                  <li key={shift.uuid_id}>
                    <label className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 cursor-pointer">
                      <input
                        type="radio"
                        name="bindShift"
                        checked={selectedBindShiftUuid === shift.uuid_id}
                        onChange={() => setSelectedBindShiftUuid(shift.uuid_id)}
                        className="w-4 h-4 text-blue-600"
                      />
                      <span className="text-sm font-medium text-gray-900">Shift {idx + 1}</span>
                      <span className="text-sm text-gray-800">{shift.user_name}</span>
                      <span className="text-xs text-gray-600">
                        {new Date(shift.shift_start).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'short', timeStyle: 'short' })}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setShowBindShiftModal(false); setTransactionToBind(null); setSelectedBindShiftUuid(null); setBindShiftError(null); }}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmBindShift}
                disabled={isSavingBindShift || isLoadingBindShifts}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg"
              >
                {isSavingBindShift ? 'Menyimpan...' : 'Simpan'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Printing Logs Modal */}
      {showPrintingLogs && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[80vh] overflow-hidden">
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <h2 className="text-xl font-semibold text-gray-900">Printing Logs</h2>
              <button
                onClick={() => setShowPrintingLogs(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6 overflow-y-auto max-h-[60vh]">
              <div className="text-center py-8">
                <div className="text-gray-500 mb-4">
                  <svg className="w-16 h-16 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <h3 className="text-lg font-medium text-gray-900 mb-2">Printing Logs</h3>
                <p className="text-gray-600 mb-4">
                  This feature shows receipt printing history, reprint logs, and voucher printing activities.
                </p>
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <p className="text-sm text-blue-800">
                    <strong>Access granted:</strong> You have permission to view printing logs.
                  </p>
                  <p className="text-xs text-blue-600 mt-1">
                    Feature implementation pending - this is a placeholder for the printing logs functionality.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Copy Notification */}
      {copiedUuid && (
        <div className="fixed bottom-8 left-1/2 transform -translate-x-1/2 z-50 animate-fade-in-out">
          <div className="bg-black text-white px-6 py-3 rounded-lg shadow-lg flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span className="text-sm font-medium">Copied UUID!</span>
          </div>
        </div>
      )}
      {showPrinterManager && (
        <Printer1ToPrinter2Manager onClose={() => setShowPrinterManager(false)} />
      )}
    </div>
  );
}

interface PendingTotals {
  grossAmount: number;
  totalDiscount: number;
  totalRefund: number;
  netAmount: number;
}

interface GrandTotalCardProps {
  grossAmount: number;
  totalDiscount: number;
  totalRefund: number;
  totalRevenue: number;
  netAmount: number;
  totalCustomerUnit: number;
  totalTransactionCount: number;
  onFiveClick: () => void;
}

function GrandTotalCard({
  grossAmount,
  totalDiscount,
  totalRefund,
  netAmount,
  totalCustomerUnit,
  totalTransactionCount,
  onFiveClick,
}: GrandTotalCardProps) {
  return (
    <div
      className="bg-white shadow-sm border border-gray-200 p-4 md:col-span-1 min-w-0 cursor-pointer hover:bg-gray-50 transition-colors min-h-[10.5rem] md:h-full md:min-h-0 flex flex-col"
      onClick={onFiveClick}
      title="Click 5 times to toggle R/RR badge display"
    >
      <div className="flex items-center gap-2 mb-2">
        <div className="w-3 h-3 bg-purple-500 rounded-full"></div>
        <h3 className="font-semibold text-gray-900 text-sm">Grand Total</h3>
      </div>
      <table className="text-xs w-full border-collapse" style={{ tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: 'auto' }} />
          <col style={{ width: '1ch' }} />
          <col style={{ width: '45%' }} />
        </colgroup>
        <tbody>
          <tr>
            <td className="text-gray-600 py-0.5 pr-1 whitespace-nowrap">Gross</td>
            <td className="text-gray-600 py-0.5 pr-0 text-right">:</td>
            <td className="font-medium text-gray-900 tabular-nums text-right pl-1">{formatPrice(grossAmount)}</td>
          </tr>
          <tr>
            <td className="text-gray-600 py-0.5 pr-1 whitespace-nowrap">Discount</td>
            <td className="text-gray-600 py-0.5 pr-0 text-right">:</td>
            <td className="font-medium text-gray-900 tabular-nums text-right pl-1">
              {totalDiscount > 0 ? `-${formatPrice(totalDiscount)}` : formatPrice(0)}
            </td>
          </tr>
          <tr>
            <td className="text-gray-600 py-0.5 pr-1 whitespace-nowrap">Refund</td>
            <td className="text-gray-600 py-0.5 pr-0 text-right">:</td>
            <td className="font-medium text-red-600 tabular-nums text-right pl-1">
              {totalRefund > 0 ? `-${formatPrice(totalRefund)}` : formatPrice(0)}
            </td>
          </tr>
          <tr className="border-t border-gray-200 bg-green-600">
            <td className="font-semibold text-white py-1 pl-2 pr-1 whitespace-nowrap">Net</td>
            <td className="font-semibold text-white py-1 pr-0 text-right">:</td>
            <td className="font-bold text-white tabular-nums text-right pl-1 py-1 pr-2">{formatPrice(netAmount)}</td>
          </tr>
          <tr className="border-t border-gray-100">
            <td className="text-gray-600 py-0.5 pr-1 whitespace-nowrap">Txs/CU</td>
            <td className="text-gray-600 py-0.5 pr-0 text-right">:</td>
            <td className="font-semibold text-gray-900 tabular-nums text-right pl-1">
              {totalTransactionCount}/{totalCustomerUnit}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
