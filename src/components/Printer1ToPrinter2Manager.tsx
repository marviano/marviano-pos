'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { hasPermission } from '@/lib/permissions';
import { isSuperAdmin } from '@/lib/auth';
import { X, RefreshCw, ArrowRight, ArrowLeft, AlertCircle, ChevronUp, ChevronDown } from 'lucide-react';
import { appAlert } from '@/components/AppDialog';
import { buildReceiptLineItemsForPrint } from '@/lib/buildReceiptLineItemsForPrint';
import { getTodayUTC7 } from '@/lib/dateUtils';
import { getCalendarDateYMDInWib, wibDateRangeEpochBounds, wibNowSql } from '@/lib/wibDateTime';

interface Printer1Audit {
  transaction_id: string;
  printer1_receipt_number: number;
  global_counter: number | null;
  printed_at: string;
  printed_at_epoch: number;
  is_reprint?: number;
  reprint_count?: number;
}

interface Printer2Audit {
  transaction_id: string;
  printer2_receipt_number: number;
  print_mode: string;
  cycle_number: number | null;
  global_counter: number | null;
  printed_at: string;
  printed_at_epoch: number;
  is_reprint?: number;
  reprint_count?: number;
}

interface Transaction {
  id: string;
  business_id: number;
  user_id: number;
  waiter_id?: number | null;
  payment_method: string;
  payment_method_id?: number;
  pickup_method: string;
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
  transaction_type: string;
  status: string;
  created_at: string;
  user_name?: string;
  voucher_type?: string;
  voucher_value?: number | null;
  voucher_label?: string | null;
  refund_status?: string | null;
  refund_total?: number | null;
}

interface TransactionWithAudit extends Transaction {
  printer1_receipt_number?: number;
  printer2_receipt_number?: number;
  printed_at_epoch?: number;
}

interface ElectronAPI {
  getPrinter1AuditLog?: (fromDate?: string, toDate?: string, limit?: number) => Promise<{ entries: Array<Record<string, unknown>> }>;
  getPrinter2AuditLog?: (fromDate?: string, toDate?: string, limit?: number) => Promise<{ entries: Array<Record<string, unknown>> }>;
  localDbGetTransactions?: (
    businessId?: number,
    limit?: number,
    options?: { todayOnly?: boolean; from?: string; to?: string; uuidIds?: string[] }
  ) => Promise<Transaction[]>;
  localDbGetUsers?: () => Promise<Array<{ id: number; name: string; email: string }>>;
  localDbGetEmployees?: () => Promise<Array<{ id: number; name: string; color?: string | null }>>;
  localDbGetTransactionItems?: (transactionId: string) => Promise<unknown[]>;
  printReceipt?: (data: Record<string, unknown>) => Promise<{ success?: boolean; error?: string }>;
  moveTransactionToPrinter2?: (transactionId: string, movedByUserId?: number) => Promise<{
    success: boolean;
    error?: string;
    printer2Counter?: number;
    globalCounter?: number | null;
  }>;
  moveTransactionToPrinter1?: (transactionId: string, movedByUserId?: number) => Promise<{
    success: boolean;
    error?: string;
    printer1Counter?: number;
    globalCounter?: number | null;
  }>;
  repairMovedP2AuditPrintedDates?: (businessId?: number) => Promise<{
    success: boolean;
    scanned?: number;
    fixed?: number;
    errors?: string[];
    error?: string;
  }>;
  localDbGetRefundExcTotal?: (
    businessId: number,
    fromDate: string,
    toDate: string
  ) => Promise<{ total: number; count: number }>;
  getPrinterMoveLog?: (options?: {
    fromDate?: string;
    toDate?: string;
    limit?: number;
    offset?: number;
    businessId?: number;
  }) => Promise<{
    success: boolean;
    entries: PrinterMoveLog[];
    total?: number;
    error?: string;
  }>;
  getPrinterAuditsForTransactionIds?: (transactionIds: string[]) => Promise<{
    success: boolean;
    p1: Array<Record<string, unknown>>;
    p2: Array<Record<string, unknown>>;
    error?: string;
  }>;
}

interface PrinterMoveLog {
  id: number;
  transaction_id: string;
  from_printer: 'printer1' | 'printer2';
  to_printer: 'printer1' | 'printer2';
  moved_at: string;
  moved_at_epoch: number;
  transaction_created_at?: string | null;
}

const PRINT_ON_P1_TO_P2_STORAGE_KEY = 'tx-manager-print-on-p1-to-p2';
const MOVE_LOG_PAGE_SIZE = 50;
/** Cetak struk setelah pindah — jangan blok refresh UI jika printer offline/hang. */
const PRINT_AFTER_MOVE_TIMEOUT_MS = 12_000;

const parseMoveLogRows = (rows: Array<Record<string, unknown>>): PrinterMoveLog[] =>
  rows.map((row): PrinterMoveLog => ({
    id: Number(row.id || 0),
    transaction_id: String(row.transaction_id || ''),
    from_printer: row.from_printer === 'printer2' ? 'printer2' : 'printer1',
    to_printer: row.to_printer === 'printer1' ? 'printer1' : 'printer2',
    moved_at: row.moved_at ? String(row.moved_at) : wibNowSql(),
    moved_at_epoch: row.moved_at_epoch ? Number(row.moved_at_epoch) : Date.now(),
  }));

const readPrintOnP1ToP2Preference = (): boolean => {
  if (typeof window === 'undefined') return true;
  const saved = localStorage.getItem(PRINT_ON_P1_TO_P2_STORAGE_KEY);
  if (saved === null) return true;
  return saved === 'true';
};

const formatPrinterLabel = (printer: 'printer1' | 'printer2') =>
  printer === 'printer1' ? 'P1' : 'P2';

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

// Payment method ID to code mapping
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
  18: 'qpon',
  19: 'room_charge',
};

const getPaymentMethodCode = (transaction: Transaction): string => {
  if (transaction.payment_method_id && paymentMethodIdToCode[transaction.payment_method_id]) {
    return paymentMethodIdToCode[transaction.payment_method_id];
  }
  return transaction.payment_method?.toLowerCase() || 'cash';
};

/** Calendar YYYY-MM-DD in WIB for transaction created_at. */
const isTransactionCreatedTodayUTC7 = (createdAt: string): boolean => {
  const txDay = getCalendarDateYMDInWib(createdAt);
  const today = getTodayUTC7();
  return txDay !== '' && txDay === today;
};

/** Same scope as Daftar Transaksi Grand Total (completed only — excludes cancelled & pending). */
const isCompletedForGrandTotal = (tx: Transaction): boolean => {
  const s = (tx.status || '').toLowerCase();
  return s !== 'cancelled' && s !== 'pending';
};

const parseDistribNum = (v: unknown, fallback = 0): number => {
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return Number.isNaN(n) ? fallback : n;
  }
  return fallback;
};

/** Net per row: final_amount − refund_total (selaras Grand Total Net Daftar Transaksi). */
const sumNetAmount = (rows: Transaction[]) =>
  rows.reduce(
    (sum, row) => sum + Math.max(0, parseDistribNum(row.final_amount) - parseDistribNum(row.refund_total)),
    0
  );

/** Same WIB day bounds as Daftar Transaksi P2 audit filter (`getPrinter1/2AuditLog`). */
const isAuditPrintedInWibDateRange = (
  epoch: number,
  fromDate: string,
  toDate: string
): boolean => {
  const { fromEpoch, toEpoch } = wibDateRangeEpochBounds(fromDate, toDate);
  if (fromEpoch != null && epoch < fromEpoch) return false;
  if (toEpoch != null && epoch > toEpoch) return false;
  return true;
};

const filterAuditsByPrintedAtRange = <T extends { printed_at_epoch?: number }>(
  audits: T[],
  fromDate: string,
  toDate: string
): T[] =>
  audits.filter((a) => isAuditPrintedInWibDateRange(a.printed_at_epoch ?? 0, fromDate, toDate));

/**
 * One row per transaction: multiple printer audit rows (e.g. reprints) collapse to the latest print.
 * Avoids duplicate React keys and double-counted totals.
 */
const mergePrinter1Audits = (
  audits: Printer1Audit[],
  txMap: Map<string, Transaction>
): TransactionWithAudit[] => {
  const merged = new Map<string, TransactionWithAudit>();
  for (const audit of audits) {
    const tx = txMap.get(audit.transaction_id);
    if (!tx || !isCompletedForGrandTotal(tx)) continue;
    const epoch = audit.printed_at_epoch ?? 0;
    const existing = merged.get(audit.transaction_id);
    if (!existing || epoch > (existing.printed_at_epoch ?? 0)) {
      merged.set(audit.transaction_id, {
        ...tx,
        printer1_receipt_number: audit.printer1_receipt_number,
        printed_at_epoch: audit.printed_at_epoch,
      });
    }
  }
  return Array.from(merged.values());
};

const mergePrinter2Audits = (
  audits: Printer2Audit[],
  txMap: Map<string, Transaction>
): TransactionWithAudit[] => {
  const merged = new Map<string, TransactionWithAudit>();
  for (const audit of audits) {
    const tx = txMap.get(audit.transaction_id);
    if (!tx || !isCompletedForGrandTotal(tx)) continue;
    const epoch = audit.printed_at_epoch ?? 0;
    const existing = merged.get(audit.transaction_id);
    if (!existing || epoch > (existing.printed_at_epoch ?? 0)) {
      merged.set(audit.transaction_id, {
        ...tx,
        printer2_receipt_number: audit.printer2_receipt_number,
        printed_at_epoch: audit.printed_at_epoch,
      });
    }
  }
  return Array.from(merged.values());
};

const getPaymentMethodLabel = (transaction: Transaction | string) => {
  const method = typeof transaction === 'string'
    ? transaction.toLowerCase()
    : getPaymentMethodCode(transaction as Transaction);

  const labels: { [key: string]: string } = {
    'cash': 'Cash',
    'debit': 'Debit',
    'qr': 'QR Code',
    'ewallet': 'E-Wallet',
    'cl': 'City Ledger',
    'room_charge': 'Room Charge',
    'voucher': 'Voucher',
    'qpon': 'Qpon',
    'gofood': 'GoFood',
    'grabfood': 'GrabFood',
    'shopeefood': 'ShopeeFood',
    'tiktok': 'TikTok'
  };
  return labels[method] || method;
};

const getPaymentMethodColor = (transaction: Transaction | string) => {
  const method = typeof transaction === 'string'
    ? transaction.toLowerCase()
    : getPaymentMethodCode(transaction as Transaction);

  const colors: { [key: string]: string } = {
    'cash': 'bg-green-100 text-green-800',
    'debit': 'bg-blue-100 text-blue-800',
    'qr': 'bg-purple-100 text-purple-800',
    'ewallet': 'bg-orange-100 text-orange-800',
    'cl': 'bg-gray-100 text-gray-800',
    'room_charge': 'bg-indigo-100 text-indigo-800',
    'voucher': 'bg-yellow-100 text-yellow-800',
    'qpon': 'bg-indigo-100 text-indigo-800',
    'gofood': 'bg-teal-100 text-teal-800',
    'grabfood': 'bg-green-100 text-green-800',
    'shopeefood': 'bg-orange-100 text-orange-800',
    'tiktok': 'bg-red-100 text-red-800'
  };
  return colors[method] || 'bg-gray-100 text-gray-800';
};

// Get platform indicator (online platforms vs offline)
const getPlatformInfo = (transaction: Transaction): { label: string; color: string; isOnline: boolean } => {
  const code = getPaymentMethodCode(transaction);
  const isOnline = ['gofood', 'grabfood', 'shopeefood', 'tiktok'].includes(code);

  if (isOnline) {
    const platformLabels: { [key: string]: string } = {
      'gofood': 'GoFood',
      'grabfood': 'GrabFood',
      'shopeefood': 'ShopeeFood',
      'tiktok': 'TikTok'
    };
    const platformColors: { [key: string]: string } = {
      'gofood': 'bg-teal-100 text-teal-800',
      'grabfood': 'bg-green-100 text-green-800',
      'shopeefood': 'bg-orange-100 text-orange-800',
      'tiktok': 'bg-red-100 text-red-800'
    };
    return {
      label: platformLabels[code] || code,
      color: platformColors[code] || 'bg-gray-100 text-gray-800',
      isOnline: true
    };
  }

  return {
    label: 'Offline',
    color: 'bg-gray-100 text-gray-800',
    isOnline: false
  };
};

export default function Printer1ToPrinter2Manager({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const businessId = user?.selectedBusinessId;
  const [activeTab, setActiveTab] = useState<'printer1' | 'printer2' | 'log'>('printer1');
  const [printer1AuditLogs, setPrinter1AuditLogs] = useState<Printer1Audit[]>([]);
  const [printer2AuditLogs, setPrinter2AuditLogs] = useState<Printer2Audit[]>([]);
  const [moveLogs, setMoveLogs] = useState<PrinterMoveLog[]>([]);
  const [moveLogPage, setMoveLogPage] = useState(1);
  const [moveLogTotal, setMoveLogTotal] = useState(0);
  const [isLoadingMoveLogs, setIsLoadingMoveLogs] = useState(false);
  const [isLoadingMoreMoveLogs, setIsLoadingMoreMoveLogs] = useState(false);
  const [moveLogError, setMoveLogError] = useState<string | null>(null);
  const moveLogsRef = useRef<PrinterMoveLog[]>([]);
  moveLogsRef.current = moveLogs;
  /** Ignore stale async loadData responses when dates change quickly. */
  const loadDataGenerationRef = useRef(0);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [users, setUsers] = useState<Map<number, { id: number; name: string; email: string }>>(new Map());
  const [employees, setEmployees] = useState<Map<number, { id: number; name: string; color?: string | null }>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [movingTransactionId, setMovingTransactionId] = useState<string | null>(null);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [transactionToMove, setTransactionToMove] = useState<TransactionWithAudit | null>(null);
  const [moveDirection, setMoveDirection] = useState<'p1-to-p2' | 'p2-to-p1'>('p1-to-p2');
  const [confirmStep, setConfirmStep] = useState<1 | 2>(1);
  const [sortField, setSortField] = useState<string>('created_at');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  const hasPermissionToAccess = isSuperAdmin(user) || hasPermission(user, 'access_printer1printer2manager');
  const canMoveToPrinter1 = isSuperAdmin(user);
  const canMovePastDates = isSuperAdmin(user);

  const [fromDate, setFromDate] = useState<string>(getTodayUTC7());
  const [toDate, setToDate] = useState<string>(getTodayUTC7());
  const [printOnMoveToP2, setPrintOnMoveToP2] = useState<boolean>(readPrintOnP1ToP2Preference);
  const [isRepairingAuditDates, setIsRepairingAuditDates] = useState(false);
  const [refundExcTotal, setRefundExcTotal] = useState(0);

  const handleFromDateChange = useCallback((value: string) => {
    setFromDate(value);
    if (value > toDate) {
      setToDate(value);
    }
  }, [toDate]);

  const handleToDateChange = useCallback((value: string) => {
    setToDate(value);
    if (value < fromDate) {
      setFromDate(value);
    }
  }, [fromDate]);

  const enrichMoveLogsWithCreatedAt = useCallback(
    async (
      electronAPI: ElectronAPI,
      logs: PrinterMoveLog[]
    ): Promise<PrinterMoveLog[]> => {
      if (!businessId || logs.length === 0) return logs;

      const moveLogTxIds = [...new Set(logs.map((l) => l.transaction_id).filter(Boolean))];
      const createdAtByTxId = new Map<string, string>();
      if (moveLogTxIds.length > 0 && electronAPI.localDbGetTransactions) {
        const moveTxResult = await electronAPI.localDbGetTransactions(businessId, moveLogTxIds.length + 100, {
          uuidIds: moveLogTxIds,
        });
        (Array.isArray(moveTxResult) ? moveTxResult : []).forEach((tx) => {
          if (tx?.id && tx.created_at) {
            createdAtByTxId.set(String(tx.id), String(tx.created_at));
          }
        });
      }

      return logs.map((log) => ({
        ...log,
        transaction_created_at: createdAtByTxId.get(log.transaction_id) ?? null,
      }));
    },
    [businessId]
  );

  const loadMoveLogs = useCallback(
    async (page: number, mode: 'replace' | 'append' = 'replace') => {
      if (!businessId) return;

      const electronAPI = typeof window !== 'undefined' ? (window as { electronAPI?: ElectronAPI }).electronAPI : undefined;
      if (!electronAPI?.getPrinterMoveLog) return;

      const safePage = Math.max(1, Math.floor(page));
      const offset =
        mode === 'append' ? moveLogsRef.current.length : (safePage - 1) * MOVE_LOG_PAGE_SIZE;

      if (mode === 'append') {
        setIsLoadingMoreMoveLogs(true);
      } else {
        setIsLoadingMoveLogs(true);
      }
      setMoveLogError(null);

      try {
        const resolvedBusinessId =
          typeof businessId === 'number' && !Number.isNaN(businessId) ? businessId : undefined;

        const moveLogResult = await electronAPI.getPrinterMoveLog({
          businessId: Number.isFinite(resolvedBusinessId) ? resolvedBusinessId : undefined,
          limit: MOVE_LOG_PAGE_SIZE,
          offset,
        });

        if (!moveLogResult?.success) {
          throw new Error(moveLogResult?.error || 'Gagal memuat log pemindahan printer');
        }

        const parsedMoveLogs = parseMoveLogRows(
          (moveLogResult.entries || []) as unknown as Array<Record<string, unknown>>
        );
        const enriched = await enrichMoveLogsWithCreatedAt(electronAPI, parsedMoveLogs);

        setMoveLogTotal(moveLogResult.total ?? enriched.length);
        if (mode === 'append') {
          setMoveLogs((prev) => {
            const seen = new Set(prev.map((l) => l.id));
            const merged = [...prev];
            for (const row of enriched) {
              if (!seen.has(row.id)) {
                merged.push(row);
                seen.add(row.id);
              }
            }
            return merged;
          });
        } else {
          setMoveLogs(enriched);
          setMoveLogPage(safePage);
        }
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        console.error('❌ Failed to load move logs:', e);
        setMoveLogError(errorMessage);
        if (mode === 'replace') {
          setMoveLogs([]);
          setMoveLogTotal(0);
        }
      } finally {
        setIsLoadingMoveLogs(false);
        setIsLoadingMoreMoveLogs(false);
      }
    },
    [businessId, enrichMoveLogsWithCreatedAt]
  );

  const loadData = useCallback(async () => {
    if (!businessId) return;
    if (fromDate > toDate) return;

    const generation = ++loadDataGenerationRef.current;
    const fetchFrom = fromDate;
    const fetchTo = toDate;

    setIsLoading(true);
    setError(null);

    const electronAPI = typeof window !== 'undefined' ? (window as { electronAPI?: ElectronAPI }).electronAPI : undefined;

    try {
      if (!electronAPI?.localDbGetTransactions) {
        throw new Error('Electron local database API is not available. This page requires offline database support.');
      }

      const auditLimit = 10000;
      const [usersResult, empResult] = await Promise.all([
        electronAPI.localDbGetUsers?.() || Promise.resolve([]),
        electronAPI.localDbGetEmployees?.() || Promise.resolve([]),
      ]);

      // Filter by transaction created_at (WIB calendar day), not printer audit printed_at
      const txResult = await electronAPI.localDbGetTransactions(businessId, auditLimit, {
        from: fetchFrom,
        to: fetchTo,
      });

      if (generation !== loadDataGenerationRef.current) return;

      const txRows = (Array.isArray(txResult) ? txResult : []).filter(isCompletedForGrandTotal);
      const uuidIds = txRows.map((tx) => tx.id).filter((id) => Boolean(id));

      let p1Raw: Array<Record<string, unknown>> = [];
      let p2Raw: Array<Record<string, unknown>> = [];
      if (uuidIds.length > 0 && electronAPI.getPrinterAuditsForTransactionIds) {
        const auditResult = await electronAPI.getPrinterAuditsForTransactionIds(uuidIds);
        if (generation !== loadDataGenerationRef.current) return;
        p1Raw = Array.isArray(auditResult?.p1) ? auditResult.p1 : [];
        p2Raw = Array.isArray(auditResult?.p2) ? auditResult.p2 : [];
      }

      const p1Logs = p1Raw.map((a: Record<string, unknown>): Printer1Audit => ({
        transaction_id: String(a.transaction_id || ''),
        printer1_receipt_number: Number(a.printer1_receipt_number || 0),
        global_counter: a.global_counter !== null && a.global_counter !== undefined ? Number(a.global_counter) : null,
        printed_at: a.printed_at ? String(a.printed_at) : wibNowSql(),
        printed_at_epoch: a.printed_at_epoch ? Number(a.printed_at_epoch) : (a.printed_at ? new Date(String(a.printed_at)).getTime() : Date.now()),
        is_reprint: a.is_reprint !== null && a.is_reprint !== undefined ? Number(a.is_reprint) : undefined,
        reprint_count: a.reprint_count !== null && a.reprint_count !== undefined ? Number(a.reprint_count) : undefined,
      }));

      const p2Logs = p2Raw.map((a: Record<string, unknown>): Printer2Audit => ({
        transaction_id: String(a.transaction_id || ''),
        printer2_receipt_number: Number(a.printer2_receipt_number || 0),
        print_mode: String(a.print_mode || ''),
        cycle_number: a.cycle_number !== null && a.cycle_number !== undefined ? Number(a.cycle_number) : null,
        global_counter: a.global_counter !== null && a.global_counter !== undefined ? Number(a.global_counter) : null,
        printed_at: a.printed_at ? String(a.printed_at) : wibNowSql(),
        printed_at_epoch: a.printed_at_epoch ? Number(a.printed_at_epoch) : (a.printed_at ? new Date(String(a.printed_at)).getTime() : Date.now()),
        is_reprint: a.is_reprint !== null && a.is_reprint !== undefined ? Number(a.is_reprint) : undefined,
        reprint_count: a.reprint_count !== null && a.reprint_count !== undefined ? Number(a.reprint_count) : undefined,
      }));

      if (generation !== loadDataGenerationRef.current) return;

      setPrinter1AuditLogs(p1Logs);
      setPrinter2AuditLogs(p2Logs);
      setTransactions(txRows);

      // Build users map
      const usersMap = new Map<number, { id: number; name: string; email: string }>();
      (usersResult || []).forEach((u: { id: number; name: string; email: string }) => {
        usersMap.set(u.id, u);
      });
      setUsers(usersMap);

      // Build employees map (API returns nama_karyawan; normalize to name for display)
      const empMap = new Map<number, { id: number; name: string; color?: string | null }>();
      (empResult || []).forEach((emp: { id: number; name?: string; nama_karyawan?: string; color?: string | null }) => {
        const name = emp.nama_karyawan ?? emp.name ?? '';
        empMap.set(emp.id, { id: emp.id, name, color: emp.color ?? null });
      });
      setEmployees(empMap);
    } catch (e) {
      if (generation !== loadDataGenerationRef.current) return;
      const errorMessage = e instanceof Error ? e.message : String(e);
      console.error('❌ Failed to load data:', e);
      setError(errorMessage);
      setPrinter1AuditLogs([]);
      setPrinter2AuditLogs([]);
      setTransactions([]);
    } finally {
      if (generation === loadDataGenerationRef.current) {
        setIsLoading(false);
      }
    }
  }, [businessId, fromDate, toDate]);

  useEffect(() => {
    if (!businessId || !hasPermissionToAccess || fromDate > toDate) return;

    const timer = window.setTimeout(() => {
      loadData();
    }, 150);

    return () => window.clearTimeout(timer);
  }, [businessId, hasPermissionToAccess, fromDate, toDate, loadData]);

  useEffect(() => {
    if (!businessId || fromDate > toDate) {
      setRefundExcTotal(0);
      return;
    }
    const electronAPI =
      typeof window !== 'undefined' ? (window as { electronAPI?: ElectronAPI }).electronAPI : undefined;
    if (!electronAPI?.localDbGetRefundExcTotal) {
      setRefundExcTotal(0);
      return;
    }
    const resolvedBusinessId =
      typeof businessId === 'number' && !Number.isNaN(businessId) ? businessId : NaN;
    if (!Number.isFinite(resolvedBusinessId)) {
      setRefundExcTotal(0);
      return;
    }
    electronAPI
      .localDbGetRefundExcTotal(resolvedBusinessId, fromDate, toDate)
      .then((res) => {
        setRefundExcTotal(typeof res?.total === 'number' ? res.total : 0);
      })
      .catch(() => setRefundExcTotal(0));
  }, [businessId, fromDate, toDate]);

  useEffect(() => {
    if (activeTab === 'log' && businessId && hasPermissionToAccess) {
      loadMoveLogs(1, 'replace');
    }
  }, [activeTab, businessId, hasPermissionToAccess, loadMoveLogs]);

  const filteredPrinter2AuditsForDistrib = useMemo(
    () => filterAuditsByPrintedAtRange(printer2AuditLogs, fromDate, toDate),
    [printer2AuditLogs, fromDate, toDate]
  );

  /** Tab P1: audit aktif Printer 1 (pool created_at). */
  const printer1DisplayRows = useMemo(() => {
    const txMap = new Map<string, Transaction>();
    transactions.forEach((tx) => txMap.set(tx.id, tx));
    return mergePrinter1Audits(printer1AuditLogs, txMap);
  }, [printer1AuditLogs, transactions]);

  /** Tab P2: audit P2 aktif di pool — supaya hasil pindah P1→P2 langsung terlihat. */
  const printer2DisplayRows = useMemo(() => {
    const txMap = new Map<string, Transaction>();
    transactions.forEach((tx) => txMap.set(tx.id, tx));
    return mergePrinter2Audits(printer2AuditLogs, txMap);
  }, [printer2AuditLogs, transactions]);

  /** Distribusi / selaras Daftar Transaksi P2: cetak P2 printed_at dalam rentang filter. */
  const printer2PrintedInRangeRows = useMemo(() => {
    const txMap = new Map<string, Transaction>();
    transactions.forEach((tx) => txMap.set(tx.id, tx));
    return mergePrinter2Audits(filteredPrinter2AuditsForDistrib, txMap);
  }, [filteredPrinter2AuditsForDistrib, transactions]);

  const transactionsWithAudit = useMemo(
    () => (activeTab === 'printer1' ? printer1DisplayRows : printer2DisplayRows),
    [activeTab, printer1DisplayRows, printer2DisplayRows]
  );

  const poolNetRaw = useMemo(() => sumNetAmount(transactions), [transactions]);
  const p2NetRaw = useMemo(() => sumNetAmount(printer2PrintedInRangeRows), [printer2PrintedInRangeRows]);

  /** Total Net pool created_at — selaras Grand Total Net Daftar Transaksi (All). */
  const allDayTotal = useMemo(
    () => Math.max(0, poolNetRaw - refundExcTotal),
    [poolNetRaw, refundExcTotal]
  );

  /** Distribusi P2 Net: printed_at dalam filter — selaras Daftar Transaksi P2. */
  const printer2DistribTotal = useMemo(
    () => Math.max(0, p2NetRaw - refundExcTotal),
    [p2NetRaw, refundExcTotal]
  );

  const printer2PrintedInRangeCount = printer2PrintedInRangeRows.length;

  /** Distribusi P1 Net = Total Net − P2 Net. */
  const printer1DistribTotal = Math.max(0, allDayTotal - printer2DistribTotal);

  const printer1Percentage = allDayTotal > 0 ? (printer1DistribTotal / allDayTotal) * 100 : 0;
  const printer2Percentage = allDayTotal > 0 ? (printer2DistribTotal / allDayTotal) * 100 : 0;

  /** Pool created_at tanpa audit P1/P2 aktif — indikasi pindah lintas hari atau audit hilang. */
  const poolOrphanTransactions = useMemo(() => {
    const p1Ids = new Set(printer1DisplayRows.map((r) => r.id));
    const p2Ids = new Set(printer2DisplayRows.map((r) => r.id));
    return transactions.filter((tx) => !p1Ids.has(tx.id) && !p2Ids.has(tx.id));
  }, [transactions, printer1DisplayRows, printer2DisplayRows]);

  // Sort transactions
  const moveLogTotalPages = Math.max(1, Math.ceil(moveLogTotal / MOVE_LOG_PAGE_SIZE));
  const canLoadMoreMoveLogs = moveLogs.length < moveLogTotal;

  const sortedTransactions = useMemo(() => {
    return [...transactionsWithAudit].sort((a, b) => {
      let aValue: string | number;
      let bValue: string | number;

      // Handle user_name sorting by using email from users map
      if (sortField === 'user_name') {
        const userA = users.get(a.user_id);
        const userB = users.get(b.user_id);
        aValue = (userA?.email || '').toLowerCase();
        bValue = (userB?.email || '').toLowerCase();
      } else {
        aValue = a[sortField as keyof TransactionWithAudit] as string | number;
        bValue = b[sortField as keyof TransactionWithAudit] as string | number;

        if (sortField === 'id' || sortField === 'total_amount' || sortField === 'voucher_discount' || sortField === 'final_amount' || sortField === 'refund_total') {
          aValue = typeof aValue === 'string' ? parseFloat(aValue) : (aValue as number || 0);
          bValue = typeof bValue === 'string' ? parseFloat(bValue) : (bValue as number || 0);
        } else if (sortField === 'created_at' || sortField === 'printed_at_epoch') {
          aValue = sortField === 'created_at' ? new Date(aValue as string).getTime() : (aValue as number || 0);
          bValue = sortField === 'created_at' ? new Date(bValue as string).getTime() : (bValue as number || 0);
        } else {
          aValue = (aValue?.toString().toLowerCase() || '') as string;
          bValue = (bValue?.toString().toLowerCase() || '') as string;
        }
      }

      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [transactionsWithAudit, sortField, sortDirection, users]);

  const getSortIcon = (field: string) => {
    if (sortField !== field) {
      return <ChevronUp className="w-3 h-3 text-gray-400" />;
    }
    return sortDirection === 'asc'
      ? <ChevronUp className="w-3 h-3 text-blue-600" />
      : <ChevronDown className="w-3 h-3 text-blue-600" />;
  };

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const handleRepairMovedP2AuditDates = useCallback(async () => {
    if (!businessId || !canMovePastDates) return;
    const electronAPI = typeof window !== 'undefined' ? (window as { electronAPI?: ElectronAPI }).electronAPI : undefined;
    if (!electronAPI?.repairMovedP2AuditPrintedDates) {
      appAlert('Fitur perbaikan tidak tersedia. Restart aplikasi Electron setelah update.');
      return;
    }
    const ok = window.confirm(
      'Perbaiki tanggal audit P2 untuk transaksi yang pernah dipindah P1→P2 dengan bug (printed_at ikut hari pindah)?\n\n' +
        'Akan diset ke created_at transaksi (hari omset WIB). transactions.created_at tidak diubah.'
    );
    if (!ok) return;
    setIsRepairingAuditDates(true);
    try {
      const result = await electronAPI.repairMovedP2AuditPrintedDates(businessId);
      await loadData();
      if (result.success) {
        appAlert(
          `✅ Perbaikan selesai: ${result.fixed ?? 0} audit P2 diperbarui (dari ${result.scanned ?? 0} log pindah).` +
            (result.errors?.length ? `\nPeringatan: ${result.errors.join('; ')}` : '')
        );
      } else {
        appAlert(`❌ Gagal: ${result.error || result.errors?.join('; ') || 'Unknown error'}`);
      }
    } catch (e) {
      appAlert(`❌ Gagal: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsRepairingAuditDates(false);
    }
  }, [businessId, canMovePastDates, loadData]);

  const handleMoveClick = (tx: TransactionWithAudit, direction: 'p1-to-p2' | 'p2-to-p1') => {
    if (direction === 'p2-to-p1' && !canMoveToPrinter1) return;
    if (direction === 'p1-to-p2' && !canMovePastDates && !isTransactionCreatedTodayUTC7(tx.created_at)) {
      appAlert('Move is only allowed for transactions created today (WIB, UTC+7).');
      return;
    }
    setConfirmStep(1);
    setMoveDirection(direction);
    setTransactionToMove(tx);
    setShowConfirmDialog(true);
  };

  const closeConfirmDialog = () => {
    setShowConfirmDialog(false);
    setTransactionToMove(null);
    setConfirmStep(1);
  };

  const printReceiptAfterMove = async (
    txSnapshot: TransactionWithAudit,
    direction: 'p1-to-p2' | 'p2-to-p1',
    counter: number,
    globalCounter: number | null | undefined,
    electronAPI: ElectronAPI
  ): Promise<string> => {
    if (!electronAPI.printReceipt || !electronAPI.localDbGetTransactionItems) {
      return ' Perhatian: cetak struk tidak dijalankan (API tidak tersedia).';
    }

    const num = (v: unknown) => {
      if (typeof v === 'number' && !Number.isNaN(v)) return v;
      const p = parseFloat(String(v ?? ''));
      return Number.isFinite(p) ? p : 0;
    };

    try {
      const rawItems = await electronAPI.localDbGetTransactionItems(txSnapshot.id);
      const receiptItems = buildReceiptLineItemsForPrint(Array.isArray(rawItems) ? rawItems : []);
      const vd = num(txSnapshot.voucher_discount);
      const hasVoucher = vd > 0;
      const finalAmt = num(txSnapshot.final_amount);
      const totalAmt = num(txSnapshot.total_amount);
      const cashierUser = users.get(txSnapshot.user_id);
      const cashierName =
        (cashierUser?.name && String(cashierUser.name).trim()) ||
        cashierUser?.email ||
        'Kasir';

      const isToPrinter2 = direction === 'p1-to-p2';
      const printResult = await electronAPI.printReceipt({
        type: 'normal',
        printerType: isToPrinter2 ? 'receiptizePrinter' : 'receiptPrinter',
        business_id: txSnapshot.business_id,
        items: receiptItems,
        total: hasVoucher ? (totalAmt || finalAmt) : finalAmt,
        final_amount: finalAmt,
        voucherDiscount: hasVoucher ? vd : undefined,
        voucherLabel: hasVoucher ? (txSnapshot.voucher_label ?? 'Voucher') : undefined,
        paymentMethod: getPaymentMethodLabel(txSnapshot),
        amountReceived: num(txSnapshot.amount_received),
        change: num(txSnapshot.change_amount),
        date: txSnapshot.created_at,
        receiptNumber: txSnapshot.id,
        cashier: cashierName,
        customerName: txSnapshot.customer_name ?? '',
        transactionType: txSnapshot.transaction_type || 'drinks',
        pickupMethod: txSnapshot.pickup_method,
        ...(isToPrinter2
          ? { printer2Counter: counter }
          : { printer1Counter: counter }),
        globalCounter:
          globalCounter != null && globalCounter !== undefined
            ? Number(globalCounter)
            : undefined,
        isReprint: false,
      });

      if (!printResult?.success) {
        const printerLabel = isToPrinter2 ? 'Receiptize (Printer 2)' : 'Printer 1';
        console.warn(`[Printer1ToPrinter2Manager] ${printerLabel} print after move failed:`, printResult?.error);
        return ` Perhatian: gagal cetak ${printerLabel} (${printResult?.error || 'unknown'}).`;
      }
      return '';
    } catch (printErr) {
      const msg = printErr instanceof Error ? printErr.message : String(printErr);
      const printerLabel = direction === 'p1-to-p2' ? 'Receiptize (Printer 2)' : 'Printer 1';
      console.error(`[Printer1ToPrinter2Manager] ${printerLabel} print error:`, printErr);
      return ` Perhatian: gagal cetak ${printerLabel} (${msg}).`;
    }
  };

  const handleConfirmMove = async () => {
    if (!transactionToMove) return;

    if (moveDirection === 'p1-to-p2' && !canMovePastDates && !isTransactionCreatedTodayUTC7(transactionToMove.created_at)) {
      appAlert('Move is only allowed for transactions created today (WIB, UTC+7).');
      closeConfirmDialog();
      return;
    }

    if (moveDirection === 'p2-to-p1' && !canMoveToPrinter1) {
      appAlert('Hanya Super Admin yang dapat memindahkan transaksi dari Printer 2 ke Printer 1.');
      closeConfirmDialog();
      return;
    }

    const isPastMove = !isTransactionCreatedTodayUTC7(transactionToMove.created_at);

    if (isPastMove && canMovePastDates && confirmStep === 1) {
      setConfirmStep(2);
      return;
    }

    const electronAPI = typeof window !== 'undefined' ? (window as { electronAPI?: ElectronAPI }).electronAPI : undefined;
    const isToPrinter2 = moveDirection === 'p1-to-p2';

    if (isToPrinter2 && !electronAPI?.moveTransactionToPrinter2) {
      appAlert('Error: Move functionality not available. Please ensure you are running the Electron app.');
      return;
    }
    if (!isToPrinter2 && !electronAPI?.moveTransactionToPrinter1) {
      appAlert('Error: Move to Printer 1 not available. Please ensure you are running the Electron app.');
      return;
    }

    const txSnapshot = transactionToMove;
    const parsedUserId = user?.id != null ? Number(user.id) : NaN;
    const movedByUserId = Number.isFinite(parsedUserId) ? parsedUserId : undefined;
    setMovingTransactionId(txSnapshot.id);
    setShowConfirmDialog(false);
    setConfirmStep(1);

    try {
      const result = isToPrinter2
        ? await electronAPI!.moveTransactionToPrinter2!(txSnapshot.id, movedByUserId)
        : await electronAPI!.moveTransactionToPrinter1!(txSnapshot.id, movedByUserId);

      if (result.success) {
        // Refresh dulu — jangan tunggu cetak struk (printer offline bisa hang lama).
        await loadData();
        await loadMoveLogs(1, 'replace');

        let printNote = '';
        if (isToPrinter2 && printOnMoveToP2) {
          const counter = (result as { printer2Counter?: number }).printer2Counter;
          if (typeof counter === 'number' && counter > 0) {
            const printPromise = printReceiptAfterMove(
              txSnapshot,
              moveDirection,
              counter,
              result.globalCounter,
              electronAPI!
            );
            printNote = await Promise.race([
              printPromise,
              new Promise<string>((resolve) => {
                setTimeout(
                  () =>
                    resolve(
                      ' Perhatian: cetak Receiptize timeout (printer tidak merespons). Pemindahan audit sudah tersimpan — cek tab Printer 2.'
                    ),
                  PRINT_AFTER_MOVE_TIMEOUT_MS
                );
              }),
            ]);
          }
        }

        const targetLabel = isToPrinter2 ? 'Printer 2' : 'Printer 1';
        appAlert(`✅ Transaction ${txSnapshot.id} dipindah ke audit ${targetLabel}.${printNote}`);
      } else {
        await loadData();
        appAlert(`❌ Failed to move transaction: ${result.error || 'Unknown error'}`);
      }
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      console.error('❌ Error moving transaction:', e);
      appAlert(`❌ Error moving transaction: ${errorMessage}`);
    } finally {
      setMovingTransactionId(null);
      setTransactionToMove(null);
    }
  };

  if (!hasPermissionToAccess) {
    return (
      <div className="fixed inset-0 z-[9999] bg-black/50 backdrop-blur-sm flex items-center justify-center">
        <div className="bg-white rounded-lg shadow-xl p-6 max-w-md mx-4">
          <div className="flex items-center gap-3 mb-4">
            <AlertCircle className="w-6 h-6 text-red-500" />
            <h2 className="text-xl font-semibold text-gray-800">Access Denied</h2>
          </div>
          <p className="text-gray-600 mb-4">
            You do not have permission to access this page. Required permission: <code className="bg-gray-100 px-2 py-1 rounded">access_printer1printer2manager</code>
          </p>
          <button
            onClick={onClose}
            className="w-full px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[9999] bg-black/50 backdrop-blur-sm">
      <div className="absolute inset-0 bg-white w-screen h-screen rounded-none shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-3 border-b border-gray-200 bg-white">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold text-gray-900">Transaction Manager</h1>
            {/* Percentage Card */}
            {allDayTotal > 0 && (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 px-3 py-2">
                <div className="text-sm font-semibold text-gray-800">
                  Total Distribusi Omset (Net):{' '}
                  <span className="text-gray-900">{formatPrice(allDayTotal)}</span>
                </div>
                <div className="flex items-start gap-8 mt-1.5">
                  <div className="text-xs">
                    <div className="font-medium text-gray-700">P1:</div>
                    <div className="font-semibold text-blue-600 tabular-nums">{printer1Percentage.toFixed(1)}%</div>
                    <div className="text-gray-800 tabular-nums">{formatPrice(printer1DistribTotal)}</div>
                  </div>
                  <div className="text-xs">
                    <div className="font-medium text-gray-700">P2:</div>
                    <div className="font-semibold text-green-600 tabular-nums">{printer2Percentage.toFixed(1)}%</div>
                    <div className="text-gray-800 tabular-nums">{formatPrice(printer2DistribTotal)}</div>
                  </div>
                </div>
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5 text-gray-600" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 bg-white">
          <button
            onClick={() => setActiveTab('printer1')}
            className={`px-6 py-3 font-medium text-sm transition-colors ${activeTab === 'printer1'
                ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              }`}
          >
            Printer 1 ({printer1DisplayRows.length})
          </button>
          <button
            onClick={() => setActiveTab('printer2')}
            className={`px-6 py-3 font-medium text-sm transition-colors ${activeTab === 'printer2'
                ? 'text-green-600 border-b-2 border-green-600 bg-green-50'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              }`}
          >
            Printer 2 ({printer2DisplayRows.length}
            {printer2DisplayRows.length !== printer2PrintedInRangeCount
              ? ` · ${printer2PrintedInRangeCount} cetak di filter`
              : ''}
            )
          </button>
          <button
            onClick={() => setActiveTab('log')}
            className={`px-6 py-3 font-medium text-sm transition-colors ${activeTab === 'log'
                ? 'text-purple-600 border-b-2 border-purple-600 bg-purple-50'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              }`}
          >
            Log ({moveLogTotal > 0 ? moveLogTotal : moveLogs.length})
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
              <strong>Error:</strong> {error}
            </div>
          )}

          {activeTab !== 'log' && poolOrphanTransactions.length > 0 && (
            <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded text-amber-900 text-sm">
              <strong>{poolOrphanTransactions.length} transaksi</strong> di pool tanggal ini tidak ada di tab P1
              maupun P2 (audit aktif). Biasanya sudah dipindah ke P2 hari lain — cek tab{' '}
              <strong>Printer 2</strong> atau filter tanggal = hari pindah. Data transaksi tidak dihapus.
            </div>
          )}

          {/* Date Range Filter — tidak berlaku untuk tab Log */}
          {activeTab !== 'log' && (
          <div className="mb-4">
          <div className="flex flex-col md:flex-row md:items-end gap-3">
            <div className="flex items-center gap-2">
              <label htmlFor="from-date" className="text-sm text-gray-700">From</label>
              <input
                id="from-date"
                type="date"
                value={fromDate}
                onChange={(e) => handleFromDateChange(e.target.value)}
                className="border border-gray-300 rounded px-2 py-1 text-black"
              />
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="to-date" className="text-sm text-gray-700">To</label>
              <input
                id="to-date"
                type="date"
                value={toDate}
                onChange={(e) => handleToDateChange(e.target.value)}
                className="border border-gray-300 rounded px-2 py-1 text-black"
              />
            </div>
            <button
              onClick={loadData}
              disabled={isLoading}
              className="px-4 py-1 bg-gray-700 text-white rounded hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <label
              className="flex items-center gap-2 cursor-pointer select-none ml-1"
              title="Opsional. Matikan jika printer Receiptize tidak terhubung — pemindahan audit P1→P2 tetap jalan tanpa cetak fisik."
            >
              <span className={`text-sm ${printOnMoveToP2 ? 'text-gray-900 font-medium' : 'text-gray-500'}`}>
                Cetak P1→P2
              </span>
              <span className="relative inline-flex items-center">
                <input
                  type="checkbox"
                  checked={printOnMoveToP2}
                  onChange={(e) => {
                    const next = e.target.checked;
                    setPrintOnMoveToP2(next);
                    if (typeof window !== 'undefined') {
                      localStorage.setItem(PRINT_ON_P1_TO_P2_STORAGE_KEY, String(next));
                    }
                  }}
                  className="sr-only peer"
                  aria-label="Cetak struk saat pindah dari Printer 1 ke Printer 2"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-green-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600" />
              </span>
            </label>
          </div>
          </div>
          )}

          {/* Log tab */}
          {activeTab === 'log' ? (
            <>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                <p className="text-sm text-gray-600">
                  Menampilkan {moveLogs.length} dari {moveLogTotal} aktivitas pemindahan terakhir (tidak terfilter tanggal).
                </p>
                <div className="flex flex-wrap gap-2 self-start">
                {canMovePastDates && (
                  <button
                    type="button"
                    onClick={handleRepairMovedP2AuditDates}
                    disabled={isRepairingAuditDates}
                    className="px-4 py-1 bg-amber-600 text-white rounded hover:bg-amber-700 disabled:opacity-50 text-sm"
                    title="Set printed_at audit P2 ke hari omset (created_at) untuk pindahan P1→P2 yang salah tanggal"
                  >
                    {isRepairingAuditDates ? 'Memperbaiki…' : 'Perbaiki tanggal audit P2'}
                  </button>
                )}
                <button
                  onClick={() => loadMoveLogs(moveLogPage, 'replace')}
                  disabled={isLoadingMoveLogs}
                  className="px-4 py-1 bg-gray-700 text-white rounded hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                >
                  <RefreshCw className={`w-4 h-4 ${isLoadingMoveLogs ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
                </div>
              </div>
              {moveLogError && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
                  <strong>Error:</strong> {moveLogError}
                </div>
              )}
            {isLoadingMoveLogs && moveLogs.length === 0 ? (
              <div className="text-center py-8 text-gray-600">
                <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-2" />
                <p>Memuat log pemindahan...</p>
              </div>
            ) : moveLogs.length === 0 ? (
              <div className="text-center py-8 text-gray-600">
                <p>Belum ada log pemindahan printer.</p>
              </div>
            ) : (
              <div className="border border-gray-200 rounded overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ID Transaksi</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Waktu Transaksi</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-24">Dari</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-24">Ke</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Waktu Pindah</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {moveLogs.map((log) => (
                        <tr key={log.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-[10px] font-mono text-gray-900">{log.transaction_id}</td>
                          <td className="px-4 py-3 text-xs text-gray-900">
                            {log.transaction_created_at
                              ? new Date(log.transaction_created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })
                              : '—'}
                          </td>
                          <td className="px-4 py-3 text-xs font-semibold text-blue-700">{formatPrinterLabel(log.from_printer)}</td>
                          <td className="px-4 py-3 text-xs font-semibold text-green-700">{formatPrinterLabel(log.to_printer)}</td>
                          <td className="px-4 py-3 text-xs text-gray-900">
                            {new Date(log.moved_at_epoch).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 bg-gray-50 border-t border-gray-200">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => loadMoveLogs(moveLogPage - 1, 'replace')}
                      disabled={isLoadingMoveLogs || moveLogPage <= 1}
                      className="px-3 py-1.5 text-sm border border-gray-300 rounded bg-white hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Sebelumnya
                    </button>
                    <span className="text-sm text-gray-600">
                      Halaman {moveLogPage} dari {moveLogTotalPages}
                    </span>
                    <button
                      type="button"
                      onClick={() => loadMoveLogs(moveLogPage + 1, 'replace')}
                      disabled={isLoadingMoveLogs || moveLogPage >= moveLogTotalPages}
                      className="px-3 py-1.5 text-sm border border-gray-300 rounded bg-white hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Berikutnya
                    </button>
                  </div>
                  {canLoadMoreMoveLogs && (
                    <button
                      type="button"
                      onClick={() => loadMoveLogs(1, 'append')}
                      disabled={isLoadingMoreMoveLogs || isLoadingMoveLogs}
                      className="px-4 py-1.5 text-sm bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                      {isLoadingMoreMoveLogs && <RefreshCw className="w-4 h-4 animate-spin" />}
                      Muat lebih banyak
                    </button>
                  )}
                </div>
              </div>
            )}
            </>
          ) : (
          <>
          {/* Transactions Table */}
          {isLoading ? (
            <div className="text-center py-8 text-gray-600">
              <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-2" />
              <p>Loading transactions...</p>
            </div>
          ) : sortedTransactions.length === 0 ? (
            <div className="text-center py-8 text-gray-600">
              <p>No paid or completed transactions found in {activeTab === 'printer1' ? 'Printer 1' : 'Printer 2'} for transactions created in the selected date range (WIB).</p>
            </div>
          ) : (
            <div className="border border-gray-200 rounded overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full table-fixed">
                  <thead className="bg-gray-50 sticky top-0 z-10">
                    <tr>
                      <th
                        className="px-2 py-3 text-left text-[10px] font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none w-12"
                        onClick={() => handleSort(activeTab === 'printer1' ? 'printer1_receipt_number' : 'printer2_receipt_number')}
                      >
                        <div className="flex items-center gap-1">
                          <span className="text-[10px]">#</span>
                          {getSortIcon(activeTab === 'printer1' ? 'printer1_receipt_number' : 'printer2_receipt_number')}
                        </div>
                      </th>
                      <th className="px-2 py-3 text-left text-[10px] font-medium text-gray-500 uppercase tracking-wider w-32">
                        <div className="flex items-center gap-1">
                          <span className="text-[10px]">UUID</span>
                        </div>
                      </th>
                      <th
                        className="px-6 py-3 text-left text-[10px] font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                        onClick={() => handleSort('created_at')}
                      >
                        <div className="flex items-center gap-1">
                          Waktu
                          {getSortIcon('created_at')}
                        </div>
                      </th>
                      <th
                        className="px-2 py-3 text-center text-[10px] font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none w-28"
                        onClick={() => handleSort('payment_method')}
                      >
                        <div className="flex items-center justify-center gap-1">
                          <span className="text-[10px]">Metode</span>
                          {getSortIcon('payment_method')}
                        </div>
                      </th>
                      <th
                        className="px-2 py-3 text-left text-[10px] font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none w-16"
                        onClick={() => handleSort('pickup_method')}
                      >
                        <div className="flex items-center gap-1">
                          <span className="text-[10px]">DI/TA</span>
                          {getSortIcon('pickup_method')}
                        </div>
                      </th>
                      <th className="px-2 py-3 text-left text-[10px] font-medium text-gray-500 uppercase tracking-wider w-20">
                        <div className="flex items-center gap-1">
                          <span className="text-[10px]">Platform</span>
                        </div>
                      </th>
                      <th
                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                        onClick={() => handleSort('total_amount')}
                      >
                        <div className="flex items-center gap-1">
                          Total
                          {getSortIcon('total_amount')}
                        </div>
                      </th>
                      <th
                        className="px-6 py-3 text-left text-[10px] font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                        onClick={() => handleSort('voucher_discount')}
                      >
                        <div className="flex items-center gap-1">
                          Disc/Vc
                          {getSortIcon('voucher_discount')}
                        </div>
                      </th>
                      <th
                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                        onClick={() => handleSort('final_amount')}
                      >
                        <div className="flex items-center gap-1">
                          Final
                          {getSortIcon('final_amount')}
                        </div>
                      </th>
                      <th
                        className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                        onClick={() => handleSort('refund_total')}
                      >
                        <div className="flex items-center gap-1">
                          Refund
                          {getSortIcon('refund_total')}
                        </div>
                      </th>
                      <th
                        className="px-6 py-3 text-left text-[10px] font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                        onClick={() => handleSort('customer_name')}
                      >
                        <div className="flex items-center gap-1">
                          Pelanggan
                          {getSortIcon('customer_name')}
                        </div>
                      </th>
                      <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-24">
                        <div className="flex items-center gap-1">
                          Waiter
                        </div>
                      </th>
                      <th
                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                        onClick={() => handleSort('user_name')}
                      >
                        <div className="flex items-center gap-1">
                          Kasir
                          {getSortIcon('user_name')}
                        </div>
                      </th>
                      {activeTab === 'printer1' && (
                        <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-32">
                          Action
                        </th>
                      )}
                      {activeTab === 'printer2' && canMoveToPrinter1 && (
                        <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-32">
                          Action
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {sortedTransactions.map((transaction, index) => {
                      const canMoveToday = isTransactionCreatedTodayUTC7(transaction.created_at);
                      const p2OutsideFilter =
                        activeTab === 'printer2' &&
                        !isAuditPrintedInWibDateRange(transaction.printed_at_epoch ?? 0, fromDate, toDate);
                      return (
                      <tr
                        key={transaction.id}
                        className={`transition-colors ${index % 2 === 0 ? 'bg-blue-50 hover:bg-gray-50' : 'bg-white hover:bg-gray-50'}`}
                      >
                        <td className="px-2 py-4 whitespace-nowrap">
                          <span className="text-xs text-gray-900">
                            {activeTab === 'printer1' ? transaction.printer1_receipt_number : transaction.printer2_receipt_number}
                          </span>
                        </td>
                        <td className="px-2 py-4 whitespace-nowrap">
                          <span className="text-[10px] font-mono text-gray-900">{transaction.id}</span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="text-xs text-gray-900">
                            {new Date(transaction.created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}
                          </span>
                          {p2OutsideFilter && (
                            <span
                              className="block mt-0.5 text-[10px] text-amber-700"
                              title="Cetak P2 di luar rentang From–To; tidak masuk distribusi P2 / Daftar Transaksi P2 untuk tanggal filter ini"
                            >
                              P2 cetak hari lain
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-4 whitespace-nowrap text-center">
                          <div className="flex flex-col gap-1 items-center">
                            <span className={`inline-flex px-1.5 py-0.5 text-xs font-semibold rounded-full ${getPaymentMethodColor(transaction)}`}>
                              {getPaymentMethodLabel(transaction)}
                            </span>
                            {transaction.status === 'pending' && (
                              <span className="inline-flex px-1.5 py-0.5 text-[10px] font-semibold rounded-full bg-orange-100 text-orange-800">
                                Belum Bayar
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-2 py-4 whitespace-nowrap">
                          <span className="text-xs text-gray-900 capitalize">
                            {transaction.pickup_method.replace('-', ' ')}
                          </span>
                        </td>
                        <td className="px-2 py-4 whitespace-nowrap">
                          {(() => {
                            const platform = getPlatformInfo(transaction);
                            return (
                              <span className={`inline-flex px-1.5 py-0.5 text-[10px] font-semibold rounded-full ${platform.color}`}>
                                {platform.label}
                              </span>
                            );
                          })()}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="text-xs font-medium text-gray-900">
                            {formatPrice(transaction.total_amount)}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {transaction.voucher_discount > 0 ? (
                            <div className="flex flex-col">
                              <span className="text-xs text-green-600 font-medium">
                                -{formatPrice(transaction.voucher_discount)}
                              </span>
                              {transaction.voucher_label && (
                                <span className="text-[10px] text-green-500 font-medium">
                                  {transaction.voucher_label}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-gray-400">-</span>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="text-xs font-bold text-gray-900">
                            {formatPrice(transaction.final_amount)}
                          </span>
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap">
                          {(() => {
                            const refundAmount = transaction.refund_total !== null && transaction.refund_total !== undefined
                              ? (typeof transaction.refund_total === 'number'
                                ? transaction.refund_total
                                : parseFloat(String(transaction.refund_total)))
                              : 0;

                            if (refundAmount > 0) {
                              return (
                                <div className="flex flex-col">
                                  <span className="text-xs text-red-600 font-medium">
                                    -{formatPrice(refundAmount)}
                                  </span>
                                  {transaction.refund_status && (
                                    <span className={`text-[10px] font-medium ${transaction.refund_status === 'full'
                                      ? 'text-red-600'
                                      : 'text-orange-600'
                                      }`}>
                                      {transaction.refund_status === 'full' ? 'Full' : 'Partial'}
                                    </span>
                                  )}
                                </div>
                              );
                            }
                            return <span className="text-xs text-gray-400">-</span>;
                          })()}
                        </td>
                        <td className="px-6 py-4">
                          <span
                            className="text-xs text-gray-900 truncate block max-w-[120px]"
                            title={transaction.customer_name || 'Guest'}
                          >
                            {transaction.customer_name || 'Guest'}
                          </span>
                        </td>
                        <td className="px-3 py-4 whitespace-nowrap">
                          {(() => {
                            if (!transaction.waiter_id || !employees.has(transaction.waiter_id)) {
                              return <span className="text-xs text-gray-900">-</span>;
                            }
                            const waiter = employees.get(transaction.waiter_id)!;
                            const color = waiter.color;

                            if (color) {
                              return (
                                <span
                                  className="text-xs font-medium text-white px-2 py-1"
                                  style={{ backgroundColor: color }}
                                >
                                  {waiter.name}
                                </span>
                              );
                            }

                            return <span className="text-xs text-gray-900">{waiter.name}</span>;
                          })()}
                        </td>
                        <td className="px-6 py-4">
                          {(() => {
                            const user = users.get(transaction.user_id);
                            const displayEmail = user?.email || 'Unknown';
                            return (
                              <span
                                className="text-xs text-gray-900 truncate block max-w-[120px]"
                                title={displayEmail}
                              >
                                {displayEmail}
                              </span>
                            );
                          })()}
                        </td>
                        {activeTab === 'printer1' && (
                          <td className="px-3 py-4 text-center">
                            <button
                              type="button"
                              onClick={() => handleMoveClick(transaction, 'p1-to-p2')}
                              disabled={movingTransactionId === transaction.id || (!canMovePastDates && !canMoveToday)}
                              title={
                                !canMovePastDates && !canMoveToday
                                  ? 'Move is only allowed for transactions created today (WIB, UTC+7).'
                                  : 'Pindah ke Printer 2'
                              }
                              className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1 mx-auto text-xs"
                            >
                              {movingTransactionId === transaction.id ? (
                                <>
                                  <RefreshCw className="w-3 h-3 animate-spin" />
                                  Moving...
                                </>
                              ) : (
                                <>
                                  <ArrowRight className="w-3 h-3" />
                                  Move
                                </>
                              )}
                            </button>
                          </td>
                        )}
                        {activeTab === 'printer2' && canMoveToPrinter1 && (
                          <td className="px-3 py-4 text-center">
                            <button
                              type="button"
                              onClick={() => handleMoveClick(transaction, 'p2-to-p1')}
                              disabled={movingTransactionId === transaction.id}
                              title="Pindah ke Printer 1 (Super Admin)"
                              className="px-3 py-1 bg-orange-500 text-white rounded hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1 mx-auto text-xs"
                            >
                              {movingTransactionId === transaction.id ? (
                                <>
                                  <RefreshCw className="w-3 h-3 animate-spin" />
                                  Moving...
                                </>
                              ) : (
                                <>
                                  <ArrowLeft className="w-3 h-3" />
                                  Move
                                </>
                              )}
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          </>
          )}
        </div>

        {/* Confirmation Dialog */}
        {showConfirmDialog && transactionToMove && (() => {
          const isPastMove = !isTransactionCreatedTodayUTC7(transactionToMove.created_at);
          const isFinalStep = confirmStep === 2;

          return (
          <div className="fixed inset-0 z-[10000] bg-black/50 backdrop-blur-sm flex items-center justify-center">
            <div className="bg-white rounded-lg shadow-xl p-6 max-w-md mx-4">
              <div className="flex items-center gap-3 mb-4">
                <AlertCircle className={`w-6 h-6 ${isFinalStep ? 'text-red-500' : 'text-yellow-500'}`} />
                <h2 className="text-xl font-semibold text-gray-800">
                  {isFinalStep ? 'Konfirmasi Akhir' : 'Confirm Move'}
                </h2>
              </div>

              {isPastMove && canMovePastDates && !isFinalStep && (
                <div className="mb-4 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-800">
                  Transaksi ini <strong>bukan dari hari ini</strong> ({new Date(transactionToMove.created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB).
                  {moveDirection === 'p2-to-p1'
                    ? ' Pindah audit P2 → P1 akan menghapus transaksi dari system_pos.'
                    : ' Pindah audit P1 → P2 akan menambahkan transaksi ke system_pos.'}
                </div>
              )}

              {isFinalStep && (
                <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                  Anda yakin ingin memindahkan transaksi lama ini? Tindakan ini tidak dapat dibatalkan.
                </div>
              )}

              <p className="text-gray-600 mb-4">
                {moveDirection === 'p1-to-p2' ? (
                  <>
                    Are you sure you want to move transaction{' '}
                    <code className="bg-gray-100 px-2 py-1 rounded">{transactionToMove.id}</code> from Printer 1 audit log to Printer 2 audit log?
                  </>
                ) : (
                  <>
                    Yakin ingin memindahkan transaksi{' '}
                    <code className="bg-gray-100 px-2 py-1 rounded">{transactionToMove.id}</code> dari audit Printer 2 ke Printer 1?
                  </>
                )}
              </p>
              <p className="text-sm text-gray-500 mb-4">
                This will:
                <ul className="list-disc list-inside mt-2 space-y-1">
                  {moveDirection === 'p1-to-p2' ? (
                    <>
                      <li>Delete the entry from printer1_audit_log</li>
                      <li>Create a new entry in printer2_audit_log with Printer 2 daily counter</li>
                      {printOnMoveToP2 ? (
                        <li>Print the receipt to the Receiptize printer (Printer 2), if configured</li>
                      ) : (
                        <li>Tidak cetak struk (switch Cetak P1→P2 mati)</li>
                      )}
                      <li>Insert the transaction into system_pos database (if not already there)</li>
                    </>
                  ) : (
                    <>
                      <li>Hapus entri dari printer2_audit_log</li>
                      <li>Buat entri baru di printer1_audit_log dengan counter harian Printer 1</li>
                      <li>Hapus transaksi dari database system_pos (jika ada)</li>
                      <li>Tidak ada cetak struk</li>
                    </>
                  )}
                </ul>
              </p>
              <div className="flex gap-3">
                <button
                  onClick={closeConfirmDialog}
                  className="flex-1 px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmMove}
                  className={`flex-1 px-4 py-2 text-white rounded-lg transition-colors ${
                    isFinalStep
                      ? 'bg-red-600 hover:bg-red-700'
                      : moveDirection === 'p1-to-p2'
                        ? 'bg-blue-500 hover:bg-blue-600'
                        : 'bg-orange-500 hover:bg-orange-600'
                  }`}
                >
                  {isFinalStep ? 'Ya, pindahkan' : isPastMove && canMovePastDates ? 'Lanjut' : 'Confirm Move'}
                </button>
              </div>
            </div>
          </div>
          );
        })()}
      </div>
    </div>
  );
}
