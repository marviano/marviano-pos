'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { hasPermission } from '@/lib/permissions';
import { isSuperAdmin } from '@/lib/auth';
import { X, RefreshCw, ArrowRight, AlertCircle, ChevronUp, ChevronDown } from 'lucide-react';
import { appAlert } from '@/components/AppDialog';

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
  localDbGetTransactions?: (businessId?: number, limit?: number) => Promise<Transaction[]>;
  localDbGetUsers?: () => Promise<Array<{ id: number; name: string; email: string }>>;
  localDbGetEmployees?: () => Promise<Array<{ id: number; name: string; color?: string | null }>>;
  moveTransactionToPrinter2?: (transactionId: string) => Promise<{ success: boolean; error?: string }>;
}

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
  18: 'qpon'
};

const getPaymentMethodCode = (transaction: Transaction): string => {
  if (transaction.payment_method_id && paymentMethodIdToCode[transaction.payment_method_id]) {
    return paymentMethodIdToCode[transaction.payment_method_id];
  }
  return transaction.payment_method?.toLowerCase() || 'cash';
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
  const [activeTab, setActiveTab] = useState<'printer1' | 'printer2'>('printer1');
  const [printer1AuditLogs, setPrinter1AuditLogs] = useState<Printer1Audit[]>([]);
  const [printer2AuditLogs, setPrinter2AuditLogs] = useState<Printer2Audit[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [users, setUsers] = useState<Map<number, { id: number; name: string; email: string }>>(new Map());
  const [employees, setEmployees] = useState<Map<number, { id: number; name: string; color?: string | null }>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [movingTransactionId, setMovingTransactionId] = useState<string | null>(null);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [transactionToMove, setTransactionToMove] = useState<TransactionWithAudit | null>(null);
  const [sortField, setSortField] = useState<string>('created_at');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  const hasPermissionToAccess = isSuperAdmin(user) || hasPermission(user, 'access_printer1printer2manager');

  // Get today's date in UTC+7 (Jakarta timezone)
  const getTodayInUTC7 = useCallback(() => {
    const nowUtc = new Date();
    const utcMs = nowUtc.getTime() + (nowUtc.getTimezoneOffset() * 60000);
    const utc7 = new Date(utcMs + 7 * 60 * 60 * 1000);
    const y = utc7.getUTCFullYear();
    const m = String(utc7.getUTCMonth() + 1).padStart(2, '0');
    const d = String(utc7.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }, []);

  const [fromDate, setFromDate] = useState<string>(getTodayInUTC7());
  const [toDate, setToDate] = useState<string>(getTodayInUTC7());

  const loadData = useCallback(async () => {
    if (!businessId) return;

    setIsLoading(true);
    setError(null);

    const electronAPI = typeof window !== 'undefined' ? (window as { electronAPI?: ElectronAPI }).electronAPI : undefined;

    try {
      if (!electronAPI?.getPrinter1AuditLog || !electronAPI?.getPrinter2AuditLog || !electronAPI?.localDbGetTransactions) {
        throw new Error('Electron local database API is not available. This page requires offline database support.');
      }

      // Load audit logs
      const [p1Result, p2Result, txResult, usersResult, empResult] = await Promise.all([
        electronAPI.getPrinter1AuditLog(fromDate, toDate, 50000),
        electronAPI.getPrinter2AuditLog(fromDate, toDate, 50000),
        electronAPI.localDbGetTransactions(businessId, 100000),
        electronAPI.localDbGetUsers?.() || Promise.resolve([]),
        electronAPI.localDbGetEmployees?.() || Promise.resolve([])
      ]);

      // Parse audit logs
      const p1Logs = ((p1Result?.entries || []) as Array<Record<string, unknown>>).map((a: Record<string, unknown>): Printer1Audit => ({
        transaction_id: String(a.transaction_id || ''),
        printer1_receipt_number: Number(a.printer1_receipt_number || 0),
        global_counter: a.global_counter !== null && a.global_counter !== undefined ? Number(a.global_counter) : null,
        printed_at: a.printed_at ? String(a.printed_at) : new Date().toISOString(),
        printed_at_epoch: a.printed_at_epoch ? Number(a.printed_at_epoch) : (a.printed_at ? new Date(String(a.printed_at)).getTime() : Date.now()),
        is_reprint: a.is_reprint !== null && a.is_reprint !== undefined ? Number(a.is_reprint) : undefined,
        reprint_count: a.reprint_count !== null && a.reprint_count !== undefined ? Number(a.reprint_count) : undefined,
      }));

      const p2Logs = ((p2Result?.entries || []) as Array<Record<string, unknown>>).map((a: Record<string, unknown>): Printer2Audit => ({
        transaction_id: String(a.transaction_id || ''),
        printer2_receipt_number: Number(a.printer2_receipt_number || 0),
        print_mode: String(a.print_mode || ''),
        cycle_number: a.cycle_number !== null && a.cycle_number !== undefined ? Number(a.cycle_number) : null,
        global_counter: a.global_counter !== null && a.global_counter !== undefined ? Number(a.global_counter) : null,
        printed_at: a.printed_at ? String(a.printed_at) : new Date().toISOString(),
        printed_at_epoch: a.printed_at_epoch ? Number(a.printed_at_epoch) : (a.printed_at ? new Date(String(a.printed_at)).getTime() : Date.now()),
        is_reprint: a.is_reprint !== null && a.is_reprint !== undefined ? Number(a.is_reprint) : undefined,
        reprint_count: a.reprint_count !== null && a.reprint_count !== undefined ? Number(a.reprint_count) : undefined,
      }));

      setPrinter1AuditLogs(p1Logs);
      setPrinter2AuditLogs(p2Logs);
      setTransactions(txResult || []);

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
      const errorMessage = e instanceof Error ? e.message : String(e);
      console.error('❌ Failed to load data:', e);
      setError(errorMessage);
      setPrinter1AuditLogs([]);
      setPrinter2AuditLogs([]);
      setTransactions([]);
    } finally {
      setIsLoading(false);
    }
  }, [businessId, fromDate, toDate]);

  useEffect(() => {
    if (businessId && hasPermissionToAccess) {
      loadData();
    }
  }, [businessId, hasPermissionToAccess, fromDate, toDate, loadData]);

  // Combine transactions with audit log data
  const transactionsWithAudit = useMemo(() => {
    const txMap = new Map<string, Transaction>();
    transactions.forEach(tx => {
      txMap.set(tx.id, tx);
    });

    const result: TransactionWithAudit[] = [];

    if (activeTab === 'printer1') {
      printer1AuditLogs.forEach(audit => {
        const tx = txMap.get(audit.transaction_id);
        if (tx) {
          result.push({
            ...tx,
            printer1_receipt_number: audit.printer1_receipt_number,
            printed_at_epoch: audit.printed_at_epoch
          });
        }
      });
    } else {
      printer2AuditLogs.forEach(audit => {
        const tx = txMap.get(audit.transaction_id);
        if (tx) {
          result.push({
            ...tx,
            printer2_receipt_number: audit.printer2_receipt_number,
            printed_at_epoch: audit.printed_at_epoch
          });
        }
      });
    }

    return result;
  }, [activeTab, printer1AuditLogs, printer2AuditLogs, transactions]);

  // Calculate totals for percentage
  const printer1Total = useMemo(() => {
    const txMap = new Map<string, Transaction>();
    transactions.forEach(tx => txMap.set(tx.id, tx));
    return printer1AuditLogs.reduce((sum, audit) => {
      const tx = txMap.get(audit.transaction_id);
      if (tx) {
        const amount = typeof tx.final_amount === 'string' ? parseFloat(tx.final_amount) : tx.final_amount;
        return sum + (isNaN(amount) ? 0 : amount);
      }
      return sum;
    }, 0);
  }, [printer1AuditLogs, transactions]);

  const printer2Total = useMemo(() => {
    const txMap = new Map<string, Transaction>();
    transactions.forEach(tx => txMap.set(tx.id, tx));
    return printer2AuditLogs.reduce((sum, audit) => {
      const tx = txMap.get(audit.transaction_id);
      if (tx) {
        const amount = typeof tx.final_amount === 'string' ? parseFloat(tx.final_amount) : tx.final_amount;
        return sum + (isNaN(amount) ? 0 : amount);
      }
      return sum;
    }, 0);
  }, [printer2AuditLogs, transactions]);

  const totalAmount = printer1Total + printer2Total;
  const printer1Percentage = totalAmount > 0 ? (printer1Total / totalAmount) * 100 : 0;
  const printer2Percentage = totalAmount > 0 ? (printer2Total / totalAmount) * 100 : 0;

  // Sort transactions
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

  const handleMoveClick = (tx: TransactionWithAudit) => {
    setTransactionToMove(tx);
    setShowConfirmDialog(true);
  };

  const handleConfirmMove = async () => {
    if (!transactionToMove) return;

    const electronAPI = typeof window !== 'undefined' ? (window as { electronAPI?: ElectronAPI }).electronAPI : undefined;

    if (!electronAPI?.moveTransactionToPrinter2) {
      appAlert('Error: Move functionality not available. Please ensure you are running the Electron app.');
      return;
    }

    setMovingTransactionId(transactionToMove.id);
    setShowConfirmDialog(false);

    try {
      const result = await electronAPI.moveTransactionToPrinter2(transactionToMove.id);

      if (result.success) {
        await loadData();
        appAlert(`✅ Transaction ${transactionToMove.id} successfully moved to Printer 2 audit log.`);
      } else {
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
            {totalAmount > 0 && (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 px-3 py-1.5">
                <div className="text-xs font-semibold text-gray-700 mb-1">Total Distribusi Omset</div>
                <div className="flex gap-4">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-gray-700">P1:</span>
                    <span className="text-xs font-semibold text-blue-600">{printer1Percentage.toFixed(1)}%</span>
                    <span className="text-xs text-gray-600">{formatPrice(printer1Total)}</span>
                  </div>
                  <div className="h-4 w-px bg-gray-300"></div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-gray-700">P2:</span>
                    <span className="text-xs font-semibold text-green-600">{printer2Percentage.toFixed(1)}%</span>
                    <span className="text-xs text-gray-600">{formatPrice(printer2Total)}</span>
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
            Printer 1 ({printer1AuditLogs.length})
          </button>
          <button
            onClick={() => setActiveTab('printer2')}
            className={`px-6 py-3 font-medium text-sm transition-colors ${activeTab === 'printer2'
                ? 'text-green-600 border-b-2 border-green-600 bg-green-50'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              }`}
          >
            Printer 2 ({printer2AuditLogs.length})
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
              <strong>Error:</strong> {error}
            </div>
          )}

          {/* Date Range Filter */}
          <div className="flex flex-col md:flex-row md:items-end gap-3 mb-4">
            <div className="flex items-center gap-2">
              <label htmlFor="from-date" className="text-sm text-gray-700">From</label>
              <input
                id="from-date"
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="border border-gray-300 rounded px-2 py-1 text-black"
              />
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="to-date" className="text-sm text-gray-700">To</label>
              <input
                id="to-date"
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
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
          </div>

          {/* Transactions Table */}
          {isLoading ? (
            <div className="text-center py-8 text-gray-600">
              <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-2" />
              <p>Loading transactions...</p>
            </div>
          ) : sortedTransactions.length === 0 ? (
            <div className="text-center py-8 text-gray-600">
              <p>No transactions found in {activeTab === 'printer1' ? 'Printer 1' : 'Printer 2'} audit log for the selected date range.</p>
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
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {sortedTransactions.map((transaction, index) => (
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
                            {new Date(transaction.created_at).toLocaleString('id-ID')}
                          </span>
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
                              onClick={() => handleMoveClick(transaction)}
                              disabled={movingTransactionId === transaction.id}
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
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Confirmation Dialog */}
        {showConfirmDialog && transactionToMove && (
          <div className="fixed inset-0 z-[10000] bg-black/50 backdrop-blur-sm flex items-center justify-center">
            <div className="bg-white rounded-lg shadow-xl p-6 max-w-md mx-4">
              <div className="flex items-center gap-3 mb-4">
                <AlertCircle className="w-6 h-6 text-yellow-500" />
                <h2 className="text-xl font-semibold text-gray-800">Confirm Move</h2>
              </div>
              <p className="text-gray-600 mb-4">
                Are you sure you want to move transaction <code className="bg-gray-100 px-2 py-1 rounded">{transactionToMove.id}</code> from Printer 1 audit log to Printer 2 audit log?
              </p>
              <p className="text-sm text-gray-500 mb-4">
                This will:
                <ul className="list-disc list-inside mt-2 space-y-1">
                  <li>Delete the entry from printer1_audit_log</li>
                  <li>Create a new entry in printer2_audit_log with Printer 2 daily counter</li>
                  <li>Insert the transaction into system_pos database (if not already there)</li>
                </ul>
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowConfirmDialog(false);
                    setTransactionToMove(null);
                  }}
                  className="flex-1 px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmMove}
                  className="flex-1 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                >
                  Confirm Move
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
