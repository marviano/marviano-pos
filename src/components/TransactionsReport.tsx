'use client';

/**
 * Transactions Report Component
 * 
 * All date/time handling in this component uses GMT+7 (Asia/Jakarta) timezone.
 * This ensures consistent reporting regardless of the user's local timezone.
 */

import { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react';
import { appAlert } from '@/components/AppDialog';
import { createPortal } from 'react-dom';
import {
  Calendar,
  User,
  ChevronRight,
  ChevronDown,
  Filter,
  Download,
  RefreshCw,
  CreditCard,
  Search,
  X,
  Printer
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { hasPermission } from '@/lib/permissions';
import { isSuperAdmin } from '@/lib/auth';
import TransactionDetailModal, { type TransactionDetail, type TransactionRefund } from './TransactionDetailModal';

// Types
interface Transaction {
  id: string;
  business_id: number;
  user_id: number;
  user_name?: string;
  waiter_id?: number | null;
  shift_uuid?: string;
  payment_method: string;
  payment_method_id?: number;
  pickup_method: string;
  total_amount: number;
  voucher_discount?: number;
  final_amount: number;
  amount_received?: number;
  change_amount?: number;
  customer_name: string | null;
  customer_unit?: number | null;
  receipt_number: number | null;
  transaction_type: string;
  status: string;
  refund_status?: string;
  refund_total?: number;
  created_at: string;
  synced_at?: number | null;
  platform?: string;
}

interface TransactionItem {
  id?: number;
  transaction_id: string;
  product_id: number;
  product_name?: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  custom_note?: string | null;
  customizations?: unknown;
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

// Convert UTC date to GMT+7 and format for display
const formatDateTime = (dateString: string): string => {
  const date = new Date(dateString);
  // Adjust for GMT+7 (7 hours * 60 minutes * 60 seconds * 1000 milliseconds)
  const gmt7Date = new Date(date.getTime() + (7 * 60 * 60 * 1000));

  return gmt7Date.toLocaleString('id-ID', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC', // Use UTC since we already adjusted the time
  });
};

const formatDate = (dateString: string): string => {
  const date = new Date(dateString);
  // Adjust for GMT+7
  const gmt7Date = new Date(date.getTime() + (7 * 60 * 60 * 1000));

  return gmt7Date.toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC', // Use UTC since we already adjusted the time
  });
};

const formatTime = (dateString: string): string => {
  const date = new Date(dateString);
  // Adjust for GMT+7
  const gmt7Date = new Date(date.getTime() + (7 * 60 * 60 * 1000));

  return gmt7Date.toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC', // Use UTC since we already adjusted the time
  });
};

// Get GMT+7 day boundaries for date filtering
const getGmt7DayBounds = (dateString: string): { dayStartUtc: Date; dayEndUtc: Date } => {
  const date = new Date(dateString + 'T00:00:00Z'); // Treat input as UTC

  // Calculate the start and end of the day in GMT+7
  const gmt7Offset = 7 * 60 * 60 * 1000; // 7 hours in milliseconds

  // Start of day in GMT+7 (00:00:00 GMT+7)
  const dayStartGmt7 = new Date(date.getTime());
  dayStartGmt7.setUTCHours(0, 0, 0, 0);

  // End of day in GMT+7 (23:59:59.999 GMT+7)
  const dayEndGmt7 = new Date(date.getTime());
  dayEndGmt7.setUTCHours(23, 59, 59, 999);

  // Convert to UTC by subtracting the GMT+7 offset
  const dayStartUtc = new Date(dayStartGmt7.getTime() - gmt7Offset);
  const dayEndUtc = new Date(dayEndGmt7.getTime() - gmt7Offset);

  return { dayStartUtc, dayEndUtc };
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  debit: 'Debit',
  qr: 'QR Code',
  ewallet: 'E-Wallet',
  cl: 'Credit Line',
  voucher: 'Voucher',
  gofood: 'GoFood',
  grabfood: 'GrabFood',
  shopeefood: 'ShopeeFood',
  tiktok: 'TikTok',
  qpon: 'Qpon',
};

const formatPaymentMethod = (method: string): string => {
  return PAYMENT_METHOD_LABELS[method.toLowerCase()] || method;
};

const PLATFORM_LABELS: Record<string, string> = {
  offline: 'Offline',
  gofood: 'GoFood',
  grabfood: 'GrabFood',
  shopeefood: 'ShopeeFood',
  qpon: 'Qpon',
  tiktok: 'TikTok',
};

const formatPlatform = (platform: string | undefined): string => {
  if (!platform) return 'Offline';
  return PLATFORM_LABELS[platform.toLowerCase()] || platform;
};

// Payment method label/color for Daftar Transaksi-style table
const PAYMENT_LABELS: Record<string, string> = {
  cash: 'Cash', debit: 'Debit', qr: 'QR Code', ewallet: 'E-Wallet', cl: 'City Ledger',
  voucher: 'Voucher', qpon: 'Qpon', gofood: 'GoFood', grabfood: 'GrabFood', shopeefood: 'ShopeeFood', tiktok: 'TikTok',
};
const PAYMENT_COLORS: Record<string, string> = {
  cash: 'bg-green-100 text-green-800', debit: 'bg-blue-100 text-blue-800', qr: 'bg-purple-100 text-purple-800',
  ewallet: 'bg-orange-100 text-orange-800', cl: 'bg-gray-100 text-gray-800', voucher: 'bg-yellow-100 text-yellow-800',
  qpon: 'bg-indigo-100 text-indigo-800', gofood: 'bg-teal-100 text-teal-800', grabfood: 'bg-green-100 text-green-800',
  shopeefood: 'bg-orange-100 text-orange-800', tiktok: 'bg-red-100 text-red-800',
};
const getPaymentLabel = (method: string) => PAYMENT_LABELS[method?.toLowerCase()] || method;
const getPaymentColor = (method: string) => PAYMENT_COLORS[method?.toLowerCase()] || 'bg-gray-100 text-gray-800';

// Amount range filter: parse display string (e.g. "Rp 100.000" or "100000") to number; null if empty/invalid
const parseAmountDisplay = (s: string): number | null => {
  if (!s || typeof s !== 'string') return null;
  const digits = s.replace(/\D/g, '');
  if (digits.length === 0) return null;
  const n = parseInt(digits, 10);
  return isNaN(n) ? null : n;
};

const getElectronAPI = () => (typeof window !== 'undefined' ? window.electronAPI : undefined);

export default function TransactionsReport() {
  const { user } = useAuth();
  const [detailTransaction, setDetailTransaction] = useState<TransactionDetail | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const canRefund = user ? (isSuperAdmin(user) || hasPermission(user, 'daftartransaksi.refund')) : false;

  // Filters
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [filteredTransactions, setFilteredTransactions] = useState<Transaction[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [receiptCounters, setReceiptCounters] = useState<Record<string, number>>({});
  const [receiptizeCounters, setReceiptizeCounters] = useState<Record<string, number>>({});
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
      left: rect.left,
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
  const [businessName, setBusinessName] = useState<string>('');

  const businessId = user?.selectedBusinessId;

  if (!businessId) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
        <p className="text-red-700">No business selected. Please log in and select a business.</p>
      </div>
    );
  }
  const [selectedUserId, setSelectedUserId] = useState<string>('all');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [amountFrom, setAmountFrom] = useState<string>('');
  const [amountTo, setAmountTo] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  // Load users and business name on mount
  useEffect(() => {
    const loadUsers = async () => {
      const electronAPI = getElectronAPI();
      if (electronAPI?.localDbGetShiftUsers) {
        const usersData = await electronAPI.localDbGetShiftUsers(businessId);
        setUsers(usersData as UserOption[]);
      }
      if (businessId && (electronAPI as { localDbGetBusinesses?: () => Promise<Array<{ id: number; name: string }>> })?.localDbGetBusinesses) {
        const businesses = await (electronAPI as { localDbGetBusinesses: () => Promise<Array<{ id: number; name: string }>> }).localDbGetBusinesses();
        const biz = businesses?.find((b: { id: number; name: string }) => b.id === businessId);
        if (biz) setBusinessName(biz.name);
      }
    };
    loadUsers();

    // Set default date range to today (UTC+7)
    const gmt7Offset = 7 * 60 * 60 * 1000;
    const now = new Date();
    const nowGmt7 = new Date(now.getTime() + gmt7Offset);

    const formatDateInput = (date: Date) => {
      const year = date.getUTCFullYear();
      const month = String(date.getUTCMonth() + 1).padStart(2, '0');
      const day = String(date.getUTCDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    const todayStr = formatDateInput(nowGmt7);
    setStartDate(todayStr);
    setEndDate(todayStr);
  }, [businessId]);

  // Load employees for Waiter column
  useEffect(() => {
    const loadEmployees = async () => {
      const electronAPI = getElectronAPI();
      const api = electronAPI as { localDbGetEmployees?: () => Promise<Array<{ id?: number | string; nama_karyawan?: string; color?: string | null }>> };
      if (!api?.localDbGetEmployees) return;
      try {
        const allEmployees = await api.localDbGetEmployees();
        const arr = Array.isArray(allEmployees) ? allEmployees : [];
        const map = new Map<number, { name: string; color: string | null }>();
        arr.forEach((emp: { id?: number | string; nama_karyawan?: string; color?: string | null }) => {
          const empId = typeof emp.id === 'number' ? emp.id : (typeof emp.id === 'string' ? parseInt(emp.id, 10) : null);
          if (empId != null && !isNaN(empId) && typeof emp.nama_karyawan === 'string') {
            map.set(empId, { name: emp.nama_karyawan, color: typeof emp.color === 'string' ? emp.color : null });
          }
        });
        setEmployeesMap(map);
      } catch (e) {
        console.warn('Failed to fetch employees:', e);
      }
    };
    loadEmployees();
  }, []);

  // Fetch transactions and audit logs for R/RR counters
  const fetchTransactions = useCallback(async () => {
    setIsLoading(true);
    try {
      const electronAPI = getElectronAPI();
      if (!electronAPI?.localDbGetTransactions) {
        console.error('localDbGetTransactions not available');
        return;
      }

      // Get all transactions (no limit for comprehensive report)
      const allTransactions = await electronAPI.localDbGetTransactions(businessId, 50000);

      const txList = Array.isArray(allTransactions) ? (allTransactions as Transaction[]) : [];
      setTransactions(txList);

      // Fetch audit logs for selected date range to build R/RR counters
      if (startDate && endDate) {
        const getP1 = (electronAPI as { getPrinter1AuditLog?: (from?: string, to?: string, limit?: number) => Promise<{ entries?: Array<{ transaction_id?: string; printer1_receipt_number?: number; is_reprint?: number }> }> }).getPrinter1AuditLog;
        const getP2 = (electronAPI as { getPrinter2AuditLog?: (from?: string, to?: string, limit?: number) => Promise<{ entries?: Array<{ transaction_id?: string; printer2_receipt_number?: number; is_reprint?: number }> }> }).getPrinter2AuditLog;

        const originalReceipt: Record<string, number> = {};
        const originalReceiptize: Record<string, number> = {};

        if (getP2) {
          try {
            const r2 = await getP2(startDate, endDate, 5000);
            const entries = Array.isArray(r2?.entries) ? r2.entries : [];
            for (const e of entries) {
              if (e?.transaction_id == null || e?.is_reprint === 1) continue;
              const txId = String(e.transaction_id);
              const v = Number(e.printer2_receipt_number);
              if (!isNaN(v) && !(txId in originalReceiptize)) originalReceiptize[txId] = v;
            }
            setReceiptizeCounters(originalReceiptize);
          } catch (_) {
            setReceiptizeCounters({});
          }
        }
        if (getP1) {
          try {
            const r1 = await getP1(startDate, endDate, 5000);
            const entries = Array.isArray(r1?.entries) ? r1.entries : [];
            for (const e of entries) {
              if (e?.transaction_id == null || e?.is_reprint === 1) continue;
              const txId = String(e.transaction_id);
              const v = Number(e.printer1_receipt_number);
              if (!isNaN(v) && !(txId in originalReceipt)) originalReceipt[txId] = v;
            }
            setReceiptCounters(originalReceipt);
          } catch (_) {
            setReceiptCounters({});
          }
        }
      }
    } catch (error) {
      console.error('Error fetching transactions:', error);
      setTransactions([]);
    } finally {
      setIsLoading(false);
    }
  }, [businessId, startDate, endDate]);

  // Initial load
  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  // Apply filters — show only transactions that have R or RR in the selected date range
  useEffect(() => {
    let filtered = [...transactions];

    // Date range filter using GMT+7
    if (startDate) {
      const { dayStartUtc } = getGmt7DayBounds(startDate);
      filtered = filtered.filter(tx => new Date(tx.created_at).getTime() >= dayStartUtc.getTime());
    }
    if (endDate) {
      const { dayEndUtc } = getGmt7DayBounds(endDate);
      filtered = filtered.filter(tx => new Date(tx.created_at).getTime() <= dayEndUtc.getTime());
    }

    // Restrict to transactions that have at least one R or RR in the date range
    filtered = filtered.filter(tx => {
      const txId = String(tx.id);
      const hasR = typeof receiptCounters[txId] === 'number' && receiptCounters[txId] > 0;
      const hasRR = typeof receiptizeCounters[txId] === 'number' && receiptizeCounters[txId] > 0;
      return hasR || hasRR;
    });

    // User filter
    if (selectedUserId !== 'all') {
      filtered = filtered.filter(tx => tx.user_id === parseInt(selectedUserId));
    }

    // Payment method filter
    if (selectedPaymentMethod !== 'all') {
      filtered = filtered.filter(tx => tx.payment_method.toLowerCase() === selectedPaymentMethod.toLowerCase());
    }

    // Status filter
    if (selectedStatus !== 'all') {
      filtered = filtered.filter(tx => tx.status === selectedStatus);
    }

    // Search filter (receipt number, customer name, UUID)
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      filtered = filtered.filter(tx =>
        tx.receipt_number?.toString().includes(query) ||
        tx.customer_name?.toLowerCase().includes(query) ||
        tx.id.toLowerCase().includes(query)
      );
    }

    // Amount range filter (total_amount = pre-discount)
    const fromNum = parseAmountDisplay(amountFrom);
    const toNum = parseAmountDisplay(amountTo);
    if (fromNum != null && toNum != null) {
      filtered = filtered.filter(tx => (tx.total_amount ?? 0) >= fromNum && (tx.total_amount ?? 0) <= toNum);
    } else if (toNum != null) {
      filtered = filtered.filter(tx => (tx.total_amount ?? 0) > 0 && (tx.total_amount ?? 0) <= toNum);
    } else if (fromNum != null) {
      filtered = filtered.filter(tx => (tx.total_amount ?? 0) >= fromNum);
    }

    setFilteredTransactions(filtered);
  }, [transactions, startDate, endDate, receiptCounters, receiptizeCounters, selectedUserId, selectedPaymentMethod, selectedStatus, searchQuery, amountFrom, amountTo]);

  // Fetch distinct item-level waiter IDs per transaction (for multi-waiter tooltip)
  useEffect(() => {
    if (transactions.length === 0) {
      setItemWaiterIdsByTx({});
      return;
    }
    const electronAPI = getElectronAPI() as { localDbGetDistinctItemWaiterIdsByTransaction?: (ids: string[]) => Promise<Record<string, number[]>> };
    if (!electronAPI?.localDbGetDistinctItemWaiterIdsByTransaction) return;
    const ids = transactions.map((t) => t.id);
    electronAPI.localDbGetDistinctItemWaiterIdsByTransaction(ids).then(setItemWaiterIdsByTx).catch(() => setItemWaiterIdsByTx({}));
  }, [transactions]);

  // Load full transaction detail and open TransactionDetailModal (same as Daftar Transaksi)
  const loadTransactionDetails = async (transaction: Transaction) => {
    if (transaction.status === 'pending') return;
    setIsLoadingDetail(true);
    setDetailTransaction(null);
    setIsDetailModalOpen(true);
    try {
      const electronAPI = getElectronAPI() as {
        localDbGetTransactions?: (bid: number, limit: number) => Promise<unknown[]>;
        localDbGetTransactionItems?: (uuid: string) => Promise<unknown[]>;
        localDbGetAllProducts?: (bid?: number) => Promise<Array<{ id: number; nama: string }>>;
        localDbGetUsers?: () => Promise<Array<{ id: number; name: string }>>;
        localDbGetBusinesses?: () => Promise<Array<{ id: number; name: string }>>;
        localDbGetTransactionRefunds?: (uuid: string) => Promise<TransactionRefund[]>;
      };
      if (!electronAPI?.localDbGetTransactions || !electronAPI?.localDbGetTransactionItems) {
        setIsDetailModalOpen(false);
        return;
      }
      const txList = (await electronAPI.localDbGetTransactions(businessId, 10000)) as Array<Record<string, unknown>>;
      const tx = txList.find((t) => String(t.id) === String(transaction.id)) as Record<string, unknown> | undefined;
      if (!tx) {
        setIsDetailModalOpen(false);
        return;
      }
      const transactionUuid = String(tx.id);
      const allItems = (await electronAPI.localDbGetTransactionItems(transactionUuid)) as Array<{ production_status?: string | null; product_id: number; product_name?: string; quantity: number; unit_price: number; total_price: number; custom_note?: string | null; customizations?: unknown; bundleSelections?: unknown; id: string }>;
      const items = Array.isArray(allItems) ? allItems : [];
      const products = electronAPI.localDbGetAllProducts ? await electronAPI.localDbGetAllProducts(businessId) : [];
      const usersList = electronAPI.localDbGetUsers ? await electronAPI.localDbGetUsers() : [];
      const businessesList = electronAPI.localDbGetBusinesses ? await electronAPI.localDbGetBusinesses() : [];
      const refunds: TransactionRefund[] = electronAPI.localDbGetTransactionRefunds ? await electronAPI.localDbGetTransactionRefunds(transaction.id) : [];
      const userObj = usersList.find((u) => u.id === (tx.user_id as number));
      const businessObj = businessesList.find((b) => b.id === (tx.business_id as number));
      const refundTotalValue = (tx.refund_total as number) ?? refunds.reduce((s, r) => s + (r.refund_amount ?? 0), 0);
      const finalAmount = Number(tx.final_amount ?? 0);
      const refundStatusValue = refundTotalValue > 0 ? (refundTotalValue >= finalAmount - 0.01 ? 'full' : 'partial') : 'none';
      const mappedItems = items.map((item) => {
        const product = products.find((p) => p.id === (typeof item.product_id === 'number' ? item.product_id : Number(item.product_id)));
        const productName = (item.product_name && String(item.product_name).trim()) || (product?.nama && String(product.nama).trim()) || 'Unknown Product';
        const customizations = Array.isArray(item.customizations) ? item.customizations : item.customizations ? [item.customizations] : [];
        const parsePrice = (v: unknown): number => (typeof v === 'number' && !isNaN(v) ? v : (Number(v) || 0));
        return {
          id: item.id,
          product_name: productName,
          quantity: item.quantity,
          unit_price: parsePrice(item.unit_price),
          total_price: parsePrice(item.total_price),
          custom_note: item.custom_note || undefined,
          customizations,
          bundleSelections: item.bundleSelections,
          production_status: item.production_status || null
        };
      });
      const response: TransactionDetail = {
        ...tx,
        id: transactionUuid,
        user_name: userObj?.name ?? 'Unknown User',
        business_name: businessObj?.name ?? 'Unknown Business',
        payment_method: (tx.payment_method as TransactionDetail['payment_method']) ?? 'cash',
        pickup_method: (tx.pickup_method as TransactionDetail['pickup_method']) ?? 'dine-in',
        transaction_type: (tx.transaction_type as TransactionDetail['transaction_type']) ?? 'drinks',
        voucher_type: (tx.voucher_type as TransactionDetail['voucher_type']) ?? 'none',
        items: mappedItems,
        refunds,
        refund_total: refundTotalValue,
        refund_status: refundStatusValue,
      } as TransactionDetail;
      setDetailTransaction(response);
    } catch (err) {
      console.error('Error loading transaction details:', err);
      setIsDetailModalOpen(false);
    } finally {
      setIsLoadingDetail(false);
    }
  };

  const handleCloseDetailModal = () => {
    setIsDetailModalOpen(false);
    setDetailTransaction(null);
  };

  const handleTransactionUpdated = (updated: TransactionDetail) => {
    setDetailTransaction(updated);
    setTransactions((prev) =>
      prev.map((t) => (t.id === updated.id ? { ...t, refund_status: updated.refund_status ?? t.refund_status, refund_total: updated.refund_total ?? t.refund_total } : t))
    );
    fetchTransactions();
  };

  // Export to CSV
  const exportToCSV = () => {
    const headers = [
      'Receipt #',
      'Date',
      'Customer',
      'Unit',
      'Payment Method',
      'Platform',
      'Total',
      'Discount',
      'Final Amount',
      'Status',
      'Synced',
      'UUID'
    ];

    const rows = filteredTransactions.map(tx => [
      tx.receipt_number || '',
      formatDateTime(tx.created_at),
      tx.customer_name || 'Guest',
      tx.customer_unit || '',
      formatPaymentMethod(tx.payment_method),
      formatPlatform(tx.platform),
      tx.total_amount,
      (tx.total_amount - tx.final_amount),
      tx.final_amount,
      tx.status,
      tx.synced_at ? 'Yes' : 'No',
      tx.id
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `transactions_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // User id -> name for Kasir column
  const userIdToName = Object.fromEntries((users || []).map(u => [u.user_id, u.user_name]));

  // Resolve # (daily counter): RR first, then R, then receipt_number
  const resolveReceiptSequence = (tx: Transaction) => {
    const txId = String(tx.id);
    const rr = receiptizeCounters[txId];
    if (typeof rr === 'number' && rr > 0) return rr;
    const r = receiptCounters[txId];
    if (typeof r === 'number' && r > 0) return r;
    return typeof tx.receipt_number === 'number' ? tx.receipt_number : 0;
  };

  // Print report for selected date range (like Ganti Shift)
  const handlePrintReport = async () => {
    const electronAPI = getElectronAPI() as {
      printTransactionsReport?: (payload: {
        businessId: number;
        businessName: string;
        dateRangeStart: string;
        dateRangeEnd: string;
        transactions: Array<{
          num: number;
          badge: 'R' | 'RR';
          uuid: string;
          waktu: string;
          metode: string;
          diTa: string;
          total: string;
          discVc: string;
          final: string;
          refund: string;
          pelanggan: string;
          waiter: string;
          kasir: string;
        }>;
      }) => Promise<{ success: boolean; error?: string }>
    };
    if (!electronAPI?.printTransactionsReport) {
      appAlert('Print tidak tersedia. Pastikan aplikasi berjalan di Electron.');
      return;
    }
    const rows = filteredTransactions.map(tx => {
      const txId = String(tx.id);
      const hasRR = typeof receiptizeCounters[txId] === 'number' && receiptizeCounters[txId] > 0;
      const hasR = typeof receiptCounters[txId] === 'number' && receiptCounters[txId] > 0;
      const num = resolveReceiptSequence(tx);
      const badge: 'R' | 'RR' = hasRR ? 'RR' : 'R';
      const waiterName = (tx as Transaction & { waiter_id?: number | null }).waiter_id != null && employeesMap.has((tx as Transaction & { waiter_id: number }).waiter_id)
        ? employeesMap.get((tx as Transaction & { waiter_id: number }).waiter_id)!.name
        : '-';
      return {
        num,
        badge,
        uuid: tx.id,
        waktu: formatDate(tx.created_at) + ' ' + formatTime(tx.created_at),
        metode: getPaymentLabel(tx.payment_method),
        diTa: (tx.pickup_method || '').replace('-', ' ') || '-',
        total: formatRupiah(tx.total_amount || 0),
        discVc: (tx.voucher_discount ?? 0) > 0 ? formatRupiah(tx.voucher_discount ?? 0) : '-',
        final: formatRupiah(tx.final_amount || 0),
        refund: (tx.refund_total ?? 0) > 0 ? formatRupiah(tx.refund_total ?? 0) : '-',
        pelanggan: tx.customer_name || 'Guest',
        waiter: waiterName,
        kasir: userIdToName[tx.user_id] ?? '-',
      };
    });
    try {
      const result = await electronAPI.printTransactionsReport({
        businessId,
        businessName: businessName || 'Business',
        dateRangeStart: startDate,
        dateRangeEnd: endDate,
        transactions: rows,
      });
      if (!result?.success && result?.error) appAlert(result.error);
    } catch (err) {
      console.error('Print error:', err);
      appAlert('Gagal mencetak laporan');
    }
  };

  // Get unique payment methods from transactions
  const paymentMethods = Array.from(new Set(transactions.map(tx => tx.payment_method))).sort();

  // List View — row click opens TransactionDetailModal (same as Daftar Transaksi)
  return (
    <>
      <div className="flex-1 flex flex-col overflow-hidden bg-gray-50">
        {/* Header — filters and Export/Print in one row; Export/Print stuck right */}
        <div className="bg-white border-b border-gray-200 px-6 py-3">
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
                {/* Search — no label, placeholder only */}
                <div className="relative flex-1 min-w-[100px] max-w-[153px]">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search..."
                    className="w-full pl-8 pr-7 py-1.5 border border-gray-300 rounded text-xs focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
                {/* Start — date picker, default range; no label */}
                <div className="min-w-0 max-w-[130px]">
                  <div className="relative">
                    <Calendar className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="w-full pl-7 pr-2 py-1.5 border border-gray-300 rounded text-xs focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                    />
                  </div>
                </div>
                {/* End — date picker; no label */}
                <div className="min-w-0 max-w-[130px]">
                  <div className="relative">
                    <Calendar className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
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
                {/* User — default All; no label */}
                <div className="min-w-0 max-w-[110px]">
                  <div className="relative">
                    <User className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
                    <select
                      value={selectedUserId}
                      onChange={(e) => setSelectedUserId(e.target.value)}
                      className="w-full pl-6 pr-6 py-1.5 border border-gray-300 rounded text-xs focus:ring-2 focus:ring-blue-500 focus:border-blue-500 appearance-none bg-white text-gray-900"
                    >
                      <option value="all">All Users</option>
                      {users.map(user => (
                        <option key={user.user_id} value={user.user_id}>{user.user_name}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
                  </div>
                </div>
                {/* Payment — default All; no label */}
                <div className="min-w-0 max-w-[110px]">
                  <div className="relative">
                    <CreditCard className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
                    <select
                      value={selectedPaymentMethod}
                      onChange={(e) => setSelectedPaymentMethod(e.target.value)}
                      className="w-full pl-6 pr-6 py-1.5 border border-gray-300 rounded text-xs focus:ring-2 focus:ring-blue-500 focus:border-blue-500 appearance-none bg-white text-gray-900"
                    >
                      <option value="all">All Payment</option>
                      {paymentMethods.map(method => (
                        <option key={method} value={method}>{formatPaymentMethod(method)}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
                  </div>
                </div>
                {/* Status — default All; no label */}
                <div className="min-w-0 max-w-[100px]">
                  <select
                    value={selectedStatus}
                    onChange={(e) => setSelectedStatus(e.target.value)}
                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-gray-900"
                  >
                    <option value="all">All Status</option>
                    <option value="completed">Completed</option>
                    <option value="pending">Pending</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
                {/* Refresh — icon only, same height as dropdowns/inputs (py-1.5 + border to match) */}
                <button
                  onClick={fetchTransactions}
                  disabled={isLoading}
                  title="Refresh"
                  className="flex items-center justify-center min-w-8 px-2 py-1.5 text-white bg-blue-600 hover:bg-blue-700 rounded border border-blue-600 transition-colors disabled:opacity-50 flex-shrink-0"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                </button>
                {/* Clear All Filters — same line */}
                <button
                  onClick={() => {
                    setSearchQuery('');
                    setSelectedUserId('all');
                    setSelectedPaymentMethod('all');
                    setSelectedStatus('all');
                    setAmountFrom('');
                    setAmountTo('');
                    const gmt7Offset = 7 * 60 * 60 * 1000;
                    const now = new Date();
                    const nowGmt7 = new Date(now.getTime() + gmt7Offset);
                    const formatDateInput = (d: Date) =>
                      `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
                    const todayStr = formatDateInput(nowGmt7);
                    setStartDate(todayStr);
                    setEndDate(todayStr);
                  }}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-gray-200 hover:bg-gray-300 text-gray-700 rounded transition-colors flex-shrink-0"
                >
                  <X className="w-3 h-3" />
                  Clear
                </button>
              </div>
              {/* Export CSV & Print — stuck right, same size */}
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={exportToCSV}
                  disabled={filteredTransactions.length === 0}
                  className="flex items-center justify-center gap-1.5 min-w-[7.5rem] px-3 py-1.5 text-sm bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors disabled:opacity-50"
                >
                  <Download className="w-3.5 h-3.5 flex-shrink-0" />
                  Export CSV
                </button>
                <button
                  onClick={handlePrintReport}
                  disabled={filteredTransactions.length === 0}
                  className="flex items-center justify-center gap-1.5 min-w-[7.5rem] px-3 py-1.5 text-sm bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors disabled:opacity-50"
                >
                  <Printer className="w-3.5 h-3.5 flex-shrink-0" />
                  Print
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Table — Daftar Transaksi style: #, UUID, Waktu, Metode, DI/TA, Total, Disc/Vc, Final, Refund, Pelanggan, Waiter, Kasir */}
        <div className="flex-1 overflow-auto p-4">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <table className="w-full text-sm text-left">
              <thead className="bg-gray-50 text-gray-900 font-semibold border-b border-gray-200">
                <tr>
                  <th className="pl-3 pr-2 py-3 text-[10px] font-medium text-gray-500 uppercase tracking-wider" style={{ minWidth: '4rem' }}>#</th>
                  <th className="px-2 py-3 text-[10px] font-medium text-gray-500 uppercase tracking-wider">UUID</th>
                  <th className="px-2 py-3 text-[10px] font-medium text-gray-500 uppercase tracking-wider">Waktu</th>
                  <th className="px-2 py-3 text-[10px] font-medium text-gray-500 uppercase tracking-wider">Metode</th>
                  <th className="px-2 py-3 text-[10px] font-medium text-gray-500 uppercase tracking-wider w-16">DI/TA</th>
                  <th className="px-2 py-3 text-[10px] font-medium text-gray-500 uppercase tracking-wider">Total</th>
                  <th className="px-2 py-3 text-[10px] font-medium text-gray-500 uppercase tracking-wider">Disc/Vc</th>
                  <th className="px-2 py-3 text-[10px] font-medium text-gray-500 uppercase tracking-wider">Final</th>
                  <th className="px-4 py-3 text-[10px] font-medium text-gray-500 uppercase tracking-wider">Refund</th>
                  <th className="px-2 py-3 text-[10px] font-medium text-gray-500 uppercase tracking-wider">Pelanggan</th>
                  <th className="px-2 py-3 text-[10px] font-medium text-gray-500 uppercase tracking-wider w-24">Waiter</th>
                  <th className="px-2 py-3 text-[10px] font-medium text-gray-500 uppercase tracking-wider" style={{ width: '12%' }}>Kasir</th>
                  <th className="px-2 py-3 w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {isLoading ? (
                  <tr>
                    <td colSpan={13} className="px-4 py-12 text-center">
                      <RefreshCw className="w-8 h-8 text-blue-600 animate-spin mx-auto mb-2" />
                      <p className="text-gray-600">Loading transactions...</p>
                    </td>
                  </tr>
                ) : filteredTransactions.length > 0 ? (
                  filteredTransactions.map((transaction) => {
                    const txId = String(transaction.id);
                    const hasRR = typeof receiptizeCounters[txId] === 'number' && receiptizeCounters[txId] > 0;
                    const hasR = typeof receiptCounters[txId] === 'number' && receiptCounters[txId] > 0;
                    const displayNum = resolveReceiptSequence(transaction);
                    const waiterId = (transaction as Transaction & { waiter_id?: number | null }).waiter_id;
                    const itemIds = itemWaiterIdsByTx[transaction.id] || [];
                    const allWaiterIds = [...new Set([waiterId, ...itemIds].filter((id): id is number => id != null))];
                    const primaryWaiterId = waiterId ?? allWaiterIds[0];
                    const waiterName = primaryWaiterId != null && employeesMap.has(primaryWaiterId) ? employeesMap.get(primaryWaiterId)!.name : '-';
                    const waiterNamesTooltip = allWaiterIds.length > 1 ? allWaiterIds.map((id) => employeesMap.get(id)?.name).filter(Boolean).join(', ') : undefined;
                    return (
                      <tr
                        key={transaction.id}
                        onClick={() => loadTransactionDetails(transaction)}
                        className="hover:bg-blue-50 cursor-pointer transition-colors group"
                      >
                        <td className="pl-3 pr-2 py-3 whitespace-nowrap" style={{ minWidth: '4rem' }}>
                          {hasRR ? (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                              <span>{displayNum}</span>
                              <span className="inline-block min-w-[1.75rem] text-center">RR</span>
                            </span>
                          ) : hasR ? (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                              <span>{displayNum}</span>
                              <span className="inline-block min-w-[1.75rem] text-center">R</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
                              <span>{displayNum}</span>
                            </span>
                          )}
                        </td>
                        <td className="pl-2 pr-2 py-3 whitespace-nowrap font-mono text-[10px] text-gray-600 truncate max-w-[80px]" title={transaction.id}>{transaction.id}</td>
                        <td className="px-2 py-3 whitespace-nowrap text-[10px] text-gray-900">{formatDate(transaction.created_at)} {formatTime(transaction.created_at)}</td>
                        <td className="px-2 py-3 whitespace-nowrap">
                          <span className={`inline-flex px-1.5 py-0.5 text-xs font-semibold rounded-full ${getPaymentColor(transaction.payment_method)}`}>
                            {getPaymentLabel(transaction.payment_method)}
                          </span>
                        </td>
                        <td className="px-2 py-3 whitespace-nowrap text-xs text-gray-900 capitalize">{(transaction.pickup_method || '').replace('-', ' ')}</td>
                        <td className="px-2 py-3 whitespace-nowrap text-xs font-medium text-gray-900">{formatRupiah(transaction.total_amount ?? 0)}</td>
                        <td className="px-2 py-3 whitespace-nowrap">
                          {(transaction.voucher_discount ?? 0) > 0 ? (
                            <span className="text-xs text-green-600 font-medium">-{formatRupiah(transaction.voucher_discount ?? 0)}</span>
                          ) : (
                            <span className="text-xs text-gray-400">-</span>
                          )}
                        </td>
                        <td className="px-2 py-3 whitespace-nowrap text-xs font-bold text-gray-900">{formatRupiah(transaction.final_amount ?? 0)}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {(transaction.refund_total ?? 0) > 0 ? (
                            <span className="text-xs text-red-600 font-medium">-{formatRupiah(transaction.refund_total ?? 0)}</span>
                          ) : (
                            <span className="text-xs text-gray-400">-</span>
                          )}
                        </td>
                        <td className="px-2 py-3 truncate max-w-[120px] text-xs text-gray-900" title={transaction.customer_name || 'Guest'}>{transaction.customer_name || 'Guest'}</td>
                        <td className="px-2 py-3 whitespace-nowrap text-xs text-gray-900">
                          <div className="relative inline-block">
                            <button
                              ref={openWaiterPopoverFor === String(transaction.id) ? waiterTriggerRef : undefined}
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setOpenWaiterPopoverFor((id) => (id === String(transaction.id) ? null : String(transaction.id))); }}
                              className="cursor-pointer rounded focus:outline-none focus:ring-2 focus:ring-blue-400 hover:underline"
                              title={waiterNamesTooltip}
                            >
                              {waiterName}
                              {allWaiterIds.length > 1 && <span className="text-gray-500 ml-0.5">(+{allWaiterIds.length - 1})</span>}
                            </button>
                            {openWaiterPopoverFor === String(transaction.id) && (() => {
                              const names = allWaiterIds.map((id) => employeesMap.get(id)?.name).filter(Boolean) as string[];
                              return names.length > 0 && waiterPopoverPos && typeof document !== 'undefined' && createPortal(
                                <div
                                  ref={waiterPopoverRef}
                                  className="fixed z-[9999] min-w-[120px] rounded-lg border border-gray-200 bg-white py-2 shadow-lg"
                                  style={{ top: waiterPopoverPos.top, left: waiterPopoverPos.left }}
                                >
                                  <div className="px-3 py-1 text-xs font-semibold text-gray-500 uppercase">Waiters</div>
                                  {names.map((name, i) => (
                                    <div key={i} className="px-3 py-1.5 text-sm text-gray-900">{name}</div>
                                  ))}
                                </div>,
                                document.body
                              );
                            })()}
                          </div>
                        </td>
                        <td className="px-2 py-3 text-xs text-gray-900">{userIdToName[transaction.user_id] ?? '-'}</td>
                        <td className="px-2 py-3 text-right">
                          <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-blue-500 transition-colors" />
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={13} className="px-4 py-12 text-center">
                      <div className="flex flex-col items-center justify-center text-gray-500">
                        <Filter className="w-12 h-12 mb-3 text-gray-300" />
                        <p className="font-medium">No transactions found</p>
                        <p className="text-sm mt-1">Pilih rentang tanggal dan pastikan ada transaksi dengan R/RR</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <TransactionDetailModal
        isOpen={isDetailModalOpen}
        onClose={handleCloseDetailModal}
        transaction={detailTransaction}
        isLoading={isLoadingDetail}
        canRefund={canRefund}
        onTransactionUpdated={handleTransactionUpdated}
      />
    </>
  );
}

