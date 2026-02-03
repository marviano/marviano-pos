'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  RefreshCw,
  CheckCircle,
  AlertCircle,
  Database,
  Activity,
  Trash2,
  Archive,
  AlertTriangle,
  X,
  Copy,
  Check,
  Download
} from 'lucide-react';
import { offlineSyncService } from '@/lib/offlineSync';
import { smartSyncService } from '@/lib/smartSync';
import { getApiUrl } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { getAutoSyncEnabled, setAutoSyncEnabled, onAutoSyncSettingChanged } from '@/lib/autoSyncSettings';

type UnknownRecord = Record<string, unknown>;
// type SmartSyncStatus = ReturnType<typeof smartSyncService.getStatus>;

const getElectronAPI = () => (typeof window !== 'undefined' ? window.electronAPI : undefined);

interface SyncLog {
  id: string;
  timestamp: Date;
  type: 'info' | 'success' | 'warning' | 'error';
  message: string;
  details?: unknown;
}

interface SyncStatus {
  isOnline: boolean;
  lastSync: string | null;
  pendingTransactions: number;
  syncInProgress: boolean;
  error: string | null;
}

interface OfflineTransaction {
  id: string | number;
  business_id: number;
  user_id: number | null | undefined;
  user_name?: string | null; // Kasir name
  waiter_id?: number | null; // Waiter ID
  shift_uuid?: string; // Added shift_uuid
  payment_method: string;
  pickup_method: string;
  total_amount: number | null | undefined;
  voucher_discount?: number | null; // Discount/Voucher amount
  final_amount: number | null | undefined;
  customer_name: string | null;
  customer_unit?: number | null;
  receipt_number: number | null;
  transaction_type: string;
  status: string;
  created_at: string | null | undefined;
  sync_status?: string; // 'pending' | 'failed' | 'synced'
  sync_attempts?: number; // Number of sync attempts
  last_sync_attempt?: string | number | null; // Last sync attempt timestamp
}

interface OfflineTransactionItemRow {
  product_id: number;
  quantity: number;
  unit_price: number;
  total_price: number;
  customizations?: Array<{
    customization_id: number;
    customization_name: string;
    selected_options: Array<{
      option_id: number;
      option_name: string;
      price_adjustment: number;
    }>;
  }> | null;
  custom_note?: string | null;
}

interface OfflineShift {
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

const isOfflineShift = (value: unknown): value is OfflineShift => {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Partial<OfflineShift>;
  return (
    typeof record.id === 'number' &&
    typeof record.uuid_id === 'string' &&
    typeof record.business_id === 'number' &&
    typeof record.user_id === 'number' &&
    typeof record.shift_start === 'string'
  );
};

const normalizeOfflineShifts = (rows: unknown): OfflineShift[] =>
  Array.isArray(rows) ? rows.filter(isOfflineShift) : [];

const isOfflineTransaction = (value: unknown): value is OfflineTransaction => {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Partial<OfflineTransaction>;
  // MySQL returns DECIMAL as string, Date as Date object or ISO string
  // Allow final_amount to be number, string (will convert), or null/undefined
  // Allow created_at to be string, Date object, or null/undefined
  const finalAmountValid = (
    typeof record.final_amount === 'number' ||
    typeof record.final_amount === 'string' ||
    record.final_amount === null ||
    record.final_amount === undefined
  );
  const createdAtValid = (
    typeof record.created_at === 'string' ||
    (record.created_at as unknown) instanceof Date ||
    record.created_at === null ||
    record.created_at === undefined
  );
  const isValid = (
    (typeof record.id === 'number' || typeof record.id === 'string') &&
    typeof record.business_id === 'number' &&
    (typeof record.user_id === 'number' || record.user_id === null || record.user_id === undefined) &&
    typeof record.payment_method === 'string' &&
    typeof record.pickup_method === 'string' &&
    finalAmountValid &&
    createdAtValid
  );
  if (!isValid && value) {
  }
  return isValid;
};

const normalizeOfflineTransactions = (rows: unknown): OfflineTransaction[] => {
  if (!Array.isArray(rows)) return [];
  return rows.filter(isOfflineTransaction).map((tx) => {
    // Normalize final_amount: convert string to number if needed
    if (typeof tx.final_amount === 'string') {
      tx.final_amount = parseFloat(tx.final_amount) || 0;
    }
    // Normalize created_at: convert Date object to ISO string if needed
    if ((tx.created_at as unknown) instanceof Date) {
      tx.created_at = (tx.created_at as unknown as Date).toISOString();
    }
    return tx;
  });
};

const isOfflineTransactionItemRow = (value: unknown): value is OfflineTransactionItemRow => {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Partial<OfflineTransactionItemRow>;
  return (
    typeof record.product_id === 'number' &&
    typeof record.quantity === 'number' &&
    typeof record.unit_price === 'number' &&
    typeof record.total_price === 'number'
  );
};

const normalizeTransactionItems = (rows: unknown): OfflineTransactionItemRow[] =>
  Array.isArray(rows) ? rows.filter(isOfflineTransactionItemRow) : [];

const toRecordArray = (value: unknown): UnknownRecord[] =>
  Array.isArray(value)
    ? value.filter((item): item is UnknownRecord => typeof item === 'object' && item !== null)
    : [];

const convertUtc7ToUtcDate = (
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  isEnd: boolean
): Date => {
  const seconds = isEnd ? 59 : 0;
  const milliseconds = isEnd ? 999 : 0;
  const utcMillis = Date.UTC(year, month - 1, day, hour - 7, minute, seconds, milliseconds);
  return new Date(utcMillis);
};

const normalizeDateInput = (value: string | null | undefined, isEnd: boolean): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const dateOnlyMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnlyMatch) {
    const [, y, m, d] = dateOnlyMatch.map(Number);
    const date = convertUtc7ToUtcDate(y, m, d, isEnd ? 23 : 0, isEnd ? 59 : 0, isEnd);
    return date.toISOString();
  }

  const dateTimeMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (dateTimeMatch) {
    const [, y, m, d, h, min] = dateTimeMatch.map(Number);
    const date = convertUtc7ToUtcDate(y, m, d, h, min, isEnd);
    return date.toISOString();
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  if (isEnd) {
    parsed.setUTCMilliseconds(999);
    parsed.setUTCSeconds(59);
  }
  return parsed.toISOString();
};

// Deep compare two objects
const deepEqual = (obj1: unknown, obj2: unknown): boolean => {
  if (obj1 === obj2) return true;
  if (obj1 == null || obj2 == null) return false;
  if (typeof obj1 !== 'object' || typeof obj2 !== 'object') return false;

  const record1 = obj1 as UnknownRecord;
  const record2 = obj2 as UnknownRecord;

  const keys1 = Object.keys(record1);
  const keys2 = Object.keys(record2);

  if (keys1.length !== keys2.length) return false;

  for (const key of keys1) {
    if (!keys2.includes(key)) return false;
    if (!deepEqual(record1[key], record2[key])) return false;
  }

  return true;
};

export default function SyncManagement() {
  const { user } = useAuth();

  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    isOnline: true,
    lastSync: null,
    pendingTransactions: 0,
    syncInProgress: false,
    error: null
  });

  const [syncLogs, setSyncLogs] = useState<SyncLog[]>([]);
  const [offlineTransactions, setOfflineTransactions] = useState<OfflineTransaction[]>([]);
  // const [offlineShifts, setOfflineShifts] = useState<OfflineShift[]>([]);
  const [isLoadingOfflineData, setIsLoadingOfflineData] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  // Get business ID from logged-in user
  const businessId = user?.selectedBusinessId;
  
  if (!businessId) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
        <p className="text-red-700">No business selected. Please log in and select a business.</p>
      </div>
    );
  }
  const [copiedUuid, setCopiedUuid] = useState<string | null>(null);
  const [offlineTransactionCount, setOfflineTransactionCount] = useState<number>(0);
  const [onlineTransactionCount, setOnlineTransactionCount] = useState<number>(0);
  const [syncProgress, setSyncProgress] = useState<number>(0);
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [checkResults, setCheckResults] = useState<Map<string, { exists: boolean; checked: boolean; identical?: boolean }>>(new Map());
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [isArchiving, setIsArchiving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDeletingByEmail, setIsDeletingByEmail] = useState(false);
  const [activePasswordAction, setActivePasswordAction] = useState<'archive' | 'delete' | null>(null);
  const [showDangerZone, setShowDangerZone] = useState(false);
  const [showGatePasswordModal, setShowGatePasswordModal] = useState(false);
  const [orphanedTransactions, setOrphanedTransactions] = useState<OfflineTransaction[]>([]);
  const [showOrphanedData, setShowOrphanedData] = useState(false);
  const [dangerFrom, setDangerFrom] = useState<string>('');
  const [dangerTo, setDangerTo] = useState<string>('');
  const [copiedSqlPreview, setCopiedSqlPreview] = useState<string | null>(null);
  const [isResyncing, setIsResyncing] = useState(false);
  const [resyncProgress, setResyncProgress] = useState<{ current: number; total: number; transactionId: string | number; status: string } | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const gatePasswordInputRef = useRef<HTMLInputElement>(null);
  // const activePasswordInputRef = useRef<HTMLInputElement>(null);

  const [autoSyncEnabled, setAutoSyncEnabledState] = useState<boolean>(true);
  
  // Printer audit log state for R/RR badges
  const [receiptCounters, setReceiptCounters] = useState<Record<string, number>>({});
  const [receiptizeCounters, setReceiptizeCounters] = useState<Record<string, number>>({});
  const [receiptizePrintedIds, setReceiptizePrintedIds] = useState<Set<string>>(new Set());
  const [employeesMap, setEmployeesMap] = useState<Map<number, { name: string; color: string | null }>>(new Map());

  // Initialize auto-sync enabled state
  useEffect(() => {
    setAutoSyncEnabledState(getAutoSyncEnabled());

    // Listen to setting changes
    const unsubscribe = onAutoSyncSettingChanged((enabled) => {
      setAutoSyncEnabledState(enabled);
    });

    return unsubscribe;
  }, []);

  // Handle toggle change
  const handleAutoSyncToggle = (enabled: boolean) => {
    setAutoSyncEnabled(enabled);
    setAutoSyncEnabledState(enabled);
  };

  // Check if we're in Electron environment
  const isElectron = Boolean(getElectronAPI());

  // useEffect(() => {
  //   const updateStatus = () => {
  //     setSmartSyncStatus(smartSyncService.getStatus());
  //   };
  //   updateStatus();
  //   const interval = setInterval(updateStatus, 5000);
  //   return () => clearInterval(interval);
  // }, []);

  useEffect(() => {
    const checkPendingTransactions = async () => {
      const electronAPI = getElectronAPI();
      if (!electronAPI?.localDbGetUnsyncedTransactions) {
        return;
      }
      try {
        const pending = await electronAPI.localDbGetUnsyncedTransactions();
        // Pending count is now managed by syncStatus state
        console.log('Pending transactions:', Array.isArray(pending) ? pending.length : 0);
      } catch (error) {
        console.warn('Failed to get pending transactions:', error);
      }
    };

    checkPendingTransactions();
    const interval = setInterval(checkPendingTransactions, 10000);
    return () => clearInterval(interval);
  }, []);

  // Add log entry
  const addLog = useCallback((type: SyncLog['type'], message: string, details?: unknown) => {
    const log: SyncLog = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      type,
      message,
      details
    };
    setSyncLogs(prev => [...prev, log]);

    // Disabled auto-scroll to prevent main page from scrolling
    // Users can manually scroll the log container if needed
  }, []);

  // Get current sync status
  const getSyncStatus = useCallback(async (): Promise<SyncStatus> => {
    try {
      const connectionStatus = offlineSyncService.getDetailedStatus();
      const pendingCount = await smartSyncService.getPendingTransactionCount();

      return {
        isOnline: connectionStatus.isOnline,
        lastSync: connectionStatus.lastSyncTime ? (typeof connectionStatus.lastSyncTime === 'number' ? new Date(connectionStatus.lastSyncTime).toISOString() : String(connectionStatus.lastSyncTime)) : null,
        pendingTransactions: pendingCount,
        syncInProgress: false,
        error: null
      };
    } catch (error) {
      return {
        isOnline: false,
        lastSync: null,
        pendingTransactions: 0,
        syncInProgress: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }, []);

  // Update sync status
  const updateSyncStatus = useCallback(async (logChanges: boolean = false) => {
    const status = await getSyncStatus();
    setSyncStatus(prev => {
      if (
        logChanges ||
        prev.isOnline !== status.isOnline ||
        prev.pendingTransactions !== status.pendingTransactions
      ) {
        addLog(
          'info',
          `Status updated: ${status.isOnline ? 'Online' : 'Offline'}, Pending: ${status.pendingTransactions}`
        );
      }
      return status;
    });
  }, [addLog, getSyncStatus]);

  // Handle UUID copy with notification
  const handleCopyUuid = async (uuid: string) => {
    try {
      // Try modern clipboard API
      if (window.isSecureContext) {
        await navigator.clipboard.writeText(uuid);
      } else {
        // Fallback for non-secure contexts
        const textArea = document.createElement('textarea');
        textArea.value = uuid;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      setCopiedUuid(uuid);
      // Auto-hide after 2 seconds
      setTimeout(() => {
        setCopiedUuid(null);
      }, 2000);
    } catch (error) {
      console.error('Failed to copy UUID:', error);
    }
  };

  // Load offline shifts
  // const loadOfflineShifts = useCallback(async () => {
  //   const electronAPI = getElectronAPI();
  //   if (!electronAPI?.localDbGetUnsyncedShifts) {
  //     return;
  //   }

  //   try {
  //     const shifts = await electronAPI.localDbGetUnsyncedShifts(businessId);
  //     const normalized = normalizeOfflineShifts(shifts);
  //     setOfflineShifts(normalized);
  //     if (normalized.length > 0) {
  //       addLog('info', `Found ${normalized.length} offline shifts pending upload`);
  //     }
  //   } catch (error) {
  //     addLog(
  //       'error',
  //       `Failed to load offline shifts: ${error instanceof Error ? error.message : 'Unknown error'}`
  //     );
  //   }
  // }, [addLog, businessId]);

  // Load printer audit logs to determine R/RR badges
  const loadPrinterAuditLogs = useCallback(async () => {
    const electronAPI = getElectronAPI();
    if (!electronAPI?.getPrinter1AuditLog || !electronAPI?.getPrinter2AuditLog) {
      return;
    }

    try {
      // Fetch Receiptize (Printer2) audit log
      const printer2Response = await electronAPI.getPrinter2AuditLog(undefined, undefined, 5000);
      const printer2Entries = (Array.isArray(printer2Response?.entries) ? printer2Response.entries : []) as Array<{ transaction_id?: string; printer2_receipt_number?: number; is_reprint?: number }>;
      
      const receiptizeCountersMap: Record<string, number> = {};
      const receiptizePrintedIdsSet = new Set<string>();

      printer2Entries.forEach((entry) => {
        if (entry.transaction_id && entry.printer2_receipt_number && entry.is_reprint === 0) {
          const txId = String(entry.transaction_id);
          receiptizeCountersMap[txId] = entry.printer2_receipt_number;
          receiptizePrintedIdsSet.add(txId);
        }
      });

      setReceiptizeCounters(receiptizeCountersMap);
      setReceiptizePrintedIds(receiptizePrintedIdsSet);

      // Fetch Receipt (Printer1) audit log
      const printer1Response = await electronAPI.getPrinter1AuditLog(undefined, undefined, 5000);
      const printer1Entries = (Array.isArray(printer1Response?.entries) ? printer1Response.entries : []) as Array<{ transaction_id?: string; printer1_receipt_number?: number; is_reprint?: number }>;

      const receiptCountersMap: Record<string, number> = {};

      printer1Entries.forEach((entry) => {
        if (entry.transaction_id && entry.printer1_receipt_number && entry.is_reprint === 0) {
          const txId = String(entry.transaction_id);
          receiptCountersMap[txId] = entry.printer1_receipt_number;
        }
      });

      setReceiptCounters(receiptCountersMap);
    } catch (error) {
      console.warn('Failed to load printer audit logs:', error);
    }
  }, []);

  // Load employees to get waiter names
  const loadEmployees = useCallback(async () => {
    const electronAPI = getElectronAPI();
    if (!electronAPI?.localDbGetEmployees) {
      return;
    }

    try {
      const allEmployees = await electronAPI.localDbGetEmployees();
      const employeesArray = Array.isArray(allEmployees) ? allEmployees : [];
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
      console.warn('Failed to load employees:', error);
    }
  }, []);

  // Load offline transactions
  const loadOfflineTransactions = useCallback(async () => {
    const electronAPI = getElectronAPI();
    if (!electronAPI?.localDbGetUnsyncedTransactions) {
      addLog('error', 'Offline database not available');
      return;
    }

    setIsLoadingOfflineData(true);
    try {
      const transactions = await electronAPI.localDbGetUnsyncedTransactions(businessId);
      const normalized = normalizeOfflineTransactions(transactions);
      setOfflineTransactions(normalized);
      const pendingCount = normalized.filter(t => t.sync_status === 'pending' || !t.sync_status).length;
      const failedCount = normalized.filter(t => t.sync_status === 'failed').length;
      if (failedCount > 0) {
        addLog('success', `Loaded ${normalized.length} offline transactions (${pendingCount} pending, ${failedCount} failed)`);
      } else {
        addLog('success', `Loaded ${normalized.length} offline transactions pending upload`);
      }
      
      // Load printer audit logs and employees after loading transactions
      await loadPrinterAuditLogs();
      await loadEmployees();
    } catch (error) {
      addLog(
        'error',
        `Failed to load offline transactions: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    } finally {
      setIsLoadingOfflineData(false);
    }
  }, [addLog, businessId, loadPrinterAuditLogs, loadEmployees]);

  const fetchTransactionCounts = useCallback(async () => {
    try {
      const electronAPI = getElectronAPI();
      if (electronAPI?.localDbGetTransactions) {
        const offlineTx = await electronAPI.localDbGetTransactions(businessId, 10000);
        setOfflineTransactionCount(Array.isArray(offlineTx) ? offlineTx.length : 0);
      }

      try {
        const response = await fetch(getApiUrl(`/api/transactions?business_id=${businessId}&limit=10000`));
        if (response.ok) {
          const data = await response.json();
          setOnlineTransactionCount(Array.isArray(data.transactions) ? data.transactions.length : 0);
        } else {
          setOnlineTransactionCount(0);
        }
      } catch {
        setOnlineTransactionCount(0);
      }
    } catch (error) {
      console.error('Failed to fetch transaction counts:', error);
    }
  }, [businessId]);

  // Delete unsynced transactions
  const handleDeleteUnsyncedTransactions = useCallback(async () => {
    if (offlineTransactions.length === 0) {
      return;
    }

    const confirmMessage = `⚠️ HAPUS DATA OFFLINE YANG AKAN DIUNGGAH ⚠️\n\n` +
      `Anda akan menghapus ${offlineTransactions.length} transaksi offline yang belum diunggah.\n\n` +
      `⚠️ PERINGATAN:\n` +
      `• Data yang dihapus TIDAK dapat dikembalikan\n` +
      `• Transaksi ini akan hilang dari database lokal\n` +
      `• Jika transaksi ini belum ada di server, data akan hilang selamanya\n\n` +
      `Apakah Anda yakin ingin melanjutkan?`;

    if (!window.confirm(confirmMessage)) {
      addLog('info', 'Penghapusan data offline dibatalkan');
      return;
    }

    // Second confirmation
    const secondConfirm = window.confirm(
      '⚠️ KONFIRMASI FINAL ⚠️\n\n' +
      `Anda akan menghapus ${offlineTransactions.length} transaksi offline.\n\n` +
      '⚠️ PERINGATAN: Tindakan ini TIDAK DAPAT DIBATALKAN!\n\n' +
      'Apakah Anda BENAR-BENAR yakin ingin melanjutkan?'
    );

    if (!secondConfirm) {
      addLog('warning', 'Penghapusan dibatalkan pada konfirmasi kedua');
      return;
    }

    const electronAPI = getElectronAPI();
    console.log('[DELETE] electronAPI available:', !!electronAPI);
    console.log('[DELETE] electronAPI keys:', electronAPI ? Object.keys(electronAPI) : 'N/A');
    console.log('[DELETE] localDbDeleteUnsyncedTransactions available:', !!electronAPI?.localDbDeleteUnsyncedTransactions);

    if (!electronAPI?.localDbDeleteUnsyncedTransactions) {
      addLog('error', 'Fitur penghapusan tidak tersedia. Silakan restart aplikasi untuk memuat perubahan terbaru.');
      alert('⚠️ Fitur penghapusan tidak tersedia.\n\nSilakan restart aplikasi Electron untuk memuat perubahan terbaru.');
      return;
    }

    try {
      addLog('info', `Menghapus ${offlineTransactions.length} transaksi offline...`);
      console.log('[DELETE] Calling localDbDeleteUnsyncedTransactions with businessId:', businessId);
      const result = await electronAPI.localDbDeleteUnsyncedTransactions(businessId);
      console.log('[DELETE] Result:', result);

      if (result?.success) {
        const deletedCount = result.deletedCount || 0;
        addLog('success', `✅ Berhasil menghapus ${deletedCount} transaksi offline`);
        // Reload the list
        await loadOfflineTransactions();
        await fetchTransactionCounts();
        alert(`✅ Berhasil menghapus ${deletedCount} transaksi offline`);
      } else {
        const errorMsg = result?.error || 'Unknown error';
        addLog('error', `Gagal menghapus: ${errorMsg}`);
        alert(`❌ Gagal menghapus: ${errorMsg}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[DELETE] Error:', error);
      addLog('error', `Error menghapus transaksi offline: ${errorMessage}`);
      alert(`❌ Error: ${errorMessage}`);
    }
  }, [offlineTransactions.length, businessId, addLog, loadOfflineTransactions, fetchTransactionCounts]);

  // Normalize transaction data for comparison (ignore timestamps and synced_at)
  const normalizeTransactionForComparison = (tx: OfflineTransaction | UnknownRecord): UnknownRecord => {
    const record = tx as UnknownRecord;
    return {
      id: record.uuid_id || record.id,
      business_id: record.business_id,
      user_id: record.user_id,
      shift_uuid: record.shift_uuid || null,
      payment_method: record.payment_method,
      payment_method_id: record.payment_method_id || null,
      pickup_method: record.pickup_method,
      total_amount: Number(record.total_amount) || 0,
      final_amount: Number(record.final_amount) || 0,
      amount_received: Number(record.amount_received) || 0,
      change_amount: Number(record.change_amount) || 0,
      voucher_discount: Number(record.voucher_discount) || 0,
      voucher_type: record.voucher_type || null,
      voucher_value: record.voucher_value || null,
      voucher_label: record.voucher_label || null,
      status: record.status,
      refund_status: record.refund_status || 'none',
      refund_total: Number(record.refund_total) || 0,
      customer_name: record.customer_name || null,
      customer_unit: record.customer_unit || null,
      note: record.note || null,
      bank_name: record.bank_name || null,
      card_number: record.card_number || null,
      cl_account_id: record.cl_account_id || null,
      cl_account_name: record.cl_account_name || null,
      bank_id: record.bank_id || null,
      receipt_number: record.receipt_number || null,
      transaction_type: record.transaction_type || 'drinks',
    };
  };

  // Normalize transaction items for comparison
  const normalizeItemsForComparison = (items: UnknownRecord[]): UnknownRecord[] => {
    if (!Array.isArray(items)) return [];
    return items
      .map(item => ({
        product_id: Number(item.product_id) || 0,
        quantity: Number(item.quantity) || 1,
        unit_price: Number(item.unit_price) || 0,
        total_price: Number(item.total_price) || 0,
        custom_note: item.custom_note || null,
        bundle_selections_json: item.bundle_selections_json || null,
      }))
      .sort((a, b) => (a.product_id as number) - (b.product_id as number)); // Sort for consistent comparison
  };

  // Deep compare moved outside component

  // Check if transactions exist on server and compare data
  const handleCheckTransactionStatus = useCallback(async () => {
    if (offlineTransactions.length === 0) {
      return;
    }

    setCheckingStatus(true);
    addLog('info', `Memeriksa status ${Math.min(50, offlineTransactions.length)} transaksi pertama ke server...`);

    const results = new Map<string, { exists: boolean; checked: boolean; identical: boolean }>();
    const transactionsToCheck = offlineTransactions.slice(0, 50); // Check first 50 transactions
    const transactionsToAutoUpdate: string[] = [];

    try {
      const electronAPI = getElectronAPI();
      if (!electronAPI) {
        throw new Error('Electron API not available');
      }

      // Fetch all transactions from server for this business
      const response = await fetch(getApiUrl(`/api/transactions?business_id=${businessId}&limit=10000`));

      if (!response.ok) {
        throw new Error(`Failed to fetch transactions: ${response.status}`);
      }

      const data = await response.json() as { transactions?: UnknownRecord[] };
      const serverTransactions = Array.isArray(data.transactions) ? data.transactions : [];
      const serverTxMap = new Map(serverTransactions.map((tx: UnknownRecord) => [String(tx.uuid_id || tx.id), tx]));

      // Check each offline transaction
      let foundCount = 0;
      let notFoundCount = 0;
      let identicalCount = 0;

      for (const offlineTx of transactionsToCheck) {
        const txUuid = String(offlineTx.id);
        const serverTx = serverTxMap.get(txUuid);
        const exists = !!serverTx;

        let identical = false;

        if (exists && electronAPI.localDbGetTransactionItems && electronAPI.localDbGetTransactionItemCustomizationsNormalized) {
          try {
            // Fetch complete local transaction data
            const localItems = await (electronAPI.localDbGetTransactionItems as (transactionId: string) => Promise<Array<UnknownRecord>>)(txUuid);
            // const localCustomizations = await (electronAPI.localDbGetTransactionItemCustomizationsNormalized as (transactionId: string) => Promise<{
            //   customizations: Array<UnknownRecord>;
            //   options: Array<UnknownRecord>;
            // }>)(txUuid);

            // Fetch server transaction items
            let serverItems: UnknownRecord[] = [];
            try {
              const itemsResponse = await fetch(getApiUrl(`/api/transaction-items?transaction_uuid=${txUuid}`));
              if (itemsResponse.ok) {
                const itemsData = await itemsResponse.json();
                serverItems = Array.isArray(itemsData.items) ? itemsData.items : [];
              }
            } catch (itemsError) {
              console.warn(`[CHECK STATUS] Could not fetch items for ${txUuid} from server:`, itemsError);
            }

            // Normalize local transaction
            const normalizedLocal = normalizeTransactionForComparison(offlineTx);
            const normalizedServer = normalizeTransactionForComparison(serverTx);

            // Compare transaction data
            const txIdentical = deepEqual(normalizedLocal, normalizedServer);

            // Compare items
            const normalizedLocalItems = normalizeItemsForComparison(localItems);
            const normalizedServerItems = normalizeItemsForComparison(serverItems);
            const itemsIdentical = deepEqual(normalizedLocalItems, normalizedServerItems);

            // Transaction is identical only if both transaction data AND items are identical
            if (txIdentical && itemsIdentical) {
              identical = true;
              identicalCount++;
              transactionsToAutoUpdate.push(txUuid);
            }
          } catch (error) {
            console.error(`[CHECK STATUS] Error comparing transaction ${txUuid}:`, error);
          }
        }

        results.set(txUuid, { exists, checked: true, identical });

        if (exists) {
          foundCount++;
        } else {
          notFoundCount++;
        }
      }

      setCheckResults(results);

      // Auto-update transactions that are identical
      if (transactionsToAutoUpdate.length > 0 && electronAPI.localDbMarkTransactionsSynced) {
        try {
          addLog('info', `🔄 Mengupdate ${transactionsToAutoUpdate.length} transaksi yang identik dengan server...`);
          await electronAPI.localDbMarkTransactionsSynced(transactionsToAutoUpdate);
          addLog('success', `✅ Otomatis mengupdate ${transactionsToAutoUpdate.length} transaksi yang identik`);

          // Reload offline transactions
          await loadOfflineTransactions();
          await fetchTransactionCounts();
        } catch (error) {
          console.error('[CHECK STATUS] Error auto-updating:', error);
          addLog('error', `Gagal auto-update: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }

      addLog('success', `✅ Pemeriksaan selesai: ${foundCount} sudah ada di server (${identicalCount} identik), ${notFoundCount} belum ada`);

      if (foundCount > identicalCount) {
        const differentCount = foundCount - identicalCount;
        addLog('warning', `⚠️ ${differentCount} transaksi sudah ada di server tetapi datanya berbeda.`);
        addLog('info', `💡 Gunakan tombol "Update Status" untuk menandai transaksi yang sudah ada sebagai sudah di-sync.`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      addLog('error', `Gagal memeriksa status: ${errorMessage}`);
      console.error('[CHECK STATUS] Error:', error);
    } finally {
      setCheckingStatus(false);
    }
  }, [offlineTransactions, businessId, addLog, loadOfflineTransactions, fetchTransactionCounts]);


  // Update synced_at for transactions that exist on server
  const handleUpdateSyncedStatus = useCallback(async () => {
    if (checkResults.size === 0) {
      addLog('warning', 'Silakan jalankan "Cek Status" terlebih dahulu');
      return;
    }

    // Get all transaction UUIDs that exist on server
    const transactionsToUpdate: string[] = [];
    checkResults.forEach((result, uuid) => {
      if (result.exists && result.checked) {
        transactionsToUpdate.push(uuid);
      }
    });

    if (transactionsToUpdate.length === 0) {
      addLog('info', 'Tidak ada transaksi yang perlu di-update (semua belum ada di server)');
      return;
    }

    const confirmMessage = `⚠️ UPDATE STATUS SYNC ⚠️\n\n` +
      `Anda akan menandai ${transactionsToUpdate.length} transaksi sebagai sudah di-sync.\n\n` +
      `Transaksi-transaksi ini sudah ada di server, jadi akan ditandai sebagai sudah di-sync\n` +
      `dan tidak akan muncul lagi di "Data Offline yang Akan Diunggah".\n\n` +
      `Apakah Anda yakin ingin melanjutkan?`;

    if (!window.confirm(confirmMessage)) {
      addLog('info', 'Update status dibatalkan');
      return;
    }

    const electronAPI = getElectronAPI();
    if (!electronAPI?.localDbMarkTransactionsSynced) {
      addLog('error', 'Fitur update status tidak tersedia');
      return;
    }

    try {
      addLog('info', `Mengupdate status ${transactionsToUpdate.length} transaksi...`);
      await electronAPI.localDbMarkTransactionsSynced(transactionsToUpdate);

      addLog('success', `✅ Berhasil mengupdate status ${transactionsToUpdate.length} transaksi`);

      // Clear check results and reload offline transactions
      setCheckResults(new Map());
      await loadOfflineTransactions();
      await fetchTransactionCounts();

      alert(`✅ Berhasil mengupdate status ${transactionsToUpdate.length} transaksi`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      addLog('error', `Gagal mengupdate status: ${errorMessage}`);
      console.error('[UPDATE STATUS] Error:', error);
    }
  }, [checkResults, addLog, loadOfflineTransactions, fetchTransactionCounts]);

  // Restore database from server (Emergency recovery)

  // REMOVED: syncFromCloud function - now using offlineSyncService.syncFromOnline() instead
  // The redundant syncFromCloud implementation has been removed (was ~330 lines)

  // Upload products and prices from local to server (overwrite server)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _uploadProductsToServer = useCallback(async (businessId: number) => {
    const electronAPI = getElectronAPI();
    if (!electronAPI?.localDbGetAllProducts) {
      addLog('warning', '⚠️ Cannot upload products - localDbGetAllProducts not available');
      return;
    }

    try {
      addLog('info', '📤 Uploading products and prices to server (overwriting server data)...');
      const localProducts = await electronAPI.localDbGetAllProducts();

      if (!Array.isArray(localProducts) || localProducts.length === 0) {
        addLog('info', 'ℹ️ No products to upload');
        return;
      }

      // Format products for server import API
      const productsToUpload = (localProducts as UnknownRecord[]).map((product) => {
        // Map local fields to server import format
        return {
          menu_code: product.menu_code || '',
          nama: product.nama || '',
          satuan: product.satuan || '',
          kategori: product.category1_name || '',
          jenis: product.category2_name || product.jenis || '',
          keterangan: product.keterangan || '',
          harga_beli: product.harga_beli || 0,
          ppn: product.ppn || 0,
          harga_umum: product.harga_jual || 0,
          harga_khusus: product.harga_khusus || 0,
          harga_online: product.harga_online || 0,
          fee_kerja: product.fee_kerja || 0,
        };
      });

      // Get POS API key from environment (works in both Electron and browser)
      // In Electron, env vars are available via process.env
      // In browser, they're available via NEXT_PUBLIC_ prefix
      const posApiKey = (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_POS_SYNC_API_KEY)
        || (typeof window !== 'undefined' && (window as unknown as { process?: { env?: Record<string, string> } }).process?.env?.NEXT_PUBLIC_POS_SYNC_API_KEY)
        || '';

      console.log('[SYNC] Products sync - API key:', {
        hasKey: !!posApiKey,
        keyLength: posApiKey?.length || 0,
        keyPreview: posApiKey ? `${posApiKey.substring(0, 4)}...` : 'MISSING',
        envCheck: {
          processExists: typeof process !== 'undefined',
          windowExists: typeof window !== 'undefined',
          processEnv: typeof process !== 'undefined' ? !!process.env : false,
        }
      });

      const response = await fetch(getApiUrl('/api/products'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-POS-API-Key': posApiKey, // Send API key for authentication
        },
        body: JSON.stringify({
          action: 'import',
          data: productsToUpload,
          businessId: businessId,
        }),
      });

      if (response.ok) {
        const result = await response.json();
        addLog('success', `✅ ${result.successCount || productsToUpload.length} products uploaded to server (${result.errorCount || 0} errors)`);
      } else {
        const errorText = await response.text();
        addLog('warning', `⚠️ Failed to upload products: ${response.status} - ${errorText}`);
      }
    } catch (error) {
      addLog('error', `❌ Error uploading products: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }, [addLog]);

  // Upload offline transactions to cloud
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _syncToCloud = useCallback(async (skipTransactions: boolean = false) => {
    const electronAPI = getElectronAPI();
    if (!electronAPI?.localDbGetUnsyncedTransactions || !electronAPI?.localDbGetUnsyncedShifts) {
      addLog('error', 'Offline database not available');
      return;
    }

    setSyncStatus(prev => ({ ...prev, syncInProgress: true, error: null }));
    addLog('info', 'Starting upload of offline data to cloud...');

    try {
      // NOTE: Products are NOT uploaded here - server is source of truth for master data
      // Products should only be downloaded from server, not uploaded

      // 1. Upload Shifts First (skip if transactions are skipped)
      if (skipTransactions) {
        addLog('info', '⏭️ Skipping shift upload (user requested - skipping all uploads)');
      } else {
        // Get all unsynced shifts regardless of business_id (each shift has its business_id in the data)
        const localShifts = await electronAPI.localDbGetUnsyncedShifts(undefined);
        const shifts = normalizeOfflineShifts(localShifts);

        if (shifts.length > 0) {
          addLog('info', `📤 Uploading ${shifts.length} shifts to cloud...`);

          try {
            // Format shifts for server (server expects { shifts: [...] })
            // Map local field names to server field names
            const formattedShifts = shifts.map(shift => {
              const shiftRecord = shift as unknown as UnknownRecord;
              return {
                id: shift.uuid_id || String(shift.id),
                uuid: shift.uuid_id || String(shift.id),
                business_id: shift.business_id,
                user_id: shift.user_id,
                shift_start: shift.shift_start,
                shift_end: shift.shift_end || null,
                starting_cash: shiftRecord.modal_awal || shiftRecord.starting_cash || 0,
                ending_cash: shiftRecord.kas_akhir || shiftRecord.ending_cash || null,
                cash_drawer_difference: shiftRecord.kas_selisih || shiftRecord.cash_drawer_difference || null,
                status: shift.status || 'active',
                closed_by: shiftRecord.closed_by || null,
                closed_at: shiftRecord.closed_at || null,
                created_at: shift.created_at || shift.shift_start,
              };
            });

            const response = await fetch(getApiUrl('/api/shifts'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ shifts: formattedShifts }),
            });

            if (response.ok) {
              const result = await response.json();
              const syncedShiftIds: number[] = shifts.map(s => s.id);

              if (syncedShiftIds.length > 0 && electronAPI.localDbMarkShiftsSynced) {
                await electronAPI.localDbMarkShiftsSynced(syncedShiftIds);
              }

              addLog('success', `✅ ${result.insertedCount || shifts.length} shifts uploaded successfully (${result.skippedCount || 0} skipped)`);
            } else {
              const errorText = await response.text();
              addLog('warning', `⚠️ Failed to upload shifts: ${response.status} - ${errorText}`);
            }
          } catch (error) {
            addLog('error', `❌ Error uploading shifts: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        }
      }

      // 2. Upload Transactions (if not skipped)
      if (skipTransactions) {
        addLog('info', '⏭️ Skipping transaction upload (user requested)');
      } else {
        if (!businessId) {
          addLog('error', 'No business ID available. Cannot fetch transactions.');
          return;
        }
        const localTransactions = await electronAPI.localDbGetUnsyncedTransactions(businessId);
        const transactions = normalizeOfflineTransactions(localTransactions);

        if (transactions.length === 0) {
          addLog('info', 'ℹ️ No transactions to upload - proceeding to download step');
          setSyncProgress(50); // Skip to download step
          await updateSyncStatus();
          return;
        }

        if (transactions.length > 0) {
          addLog('info', `📤 Uploading ${transactions.length} transactions to cloud...`);
          setSyncProgress(0);

          let successCount = 0;
          let errorCount = 0;
          const syncedIds: Array<number | string> = [];

          for (let i = 0; i < transactions.length; i++) {
            const transaction = transactions[i];
            try {
              const progress = Math.round((i / transactions.length) * 50); // Upload takes 50%
              setSyncProgress(progress);

              const rawItems = electronAPI.localDbGetTransactionItems ? await electronAPI.localDbGetTransactionItems(transaction.id) : [];
              const items = normalizeTransactionItems(rawItems).map(item => ({
                id: (item as unknown as UnknownRecord).id as string,  // Include item UUID
                product_id: item.product_id,
                quantity: item.quantity,
                unit_price: item.unit_price,
                total_price: item.total_price,
                custom_note: item.custom_note ?? undefined,
                bundle_selections_json: (item as unknown as UnknownRecord).bundle_selections_json ?? undefined,
              }));

              // Get normalized customizations for this transaction
              const normalizedCustomizations = electronAPI.localDbGetTransactionItemCustomizationsNormalized
                ? await electronAPI.localDbGetTransactionItemCustomizationsNormalized(String(transaction.id))
                : { customizations: [], options: [] };

              const uploadData: UnknownRecord = {
                id: transaction.id,
                business_id: transaction.business_id,
                user_id: transaction.user_id,
                shift_uuid: transaction.shift_uuid ?? null, // Include shift_uuid
                payment_method: transaction.payment_method,
                pickup_method: transaction.pickup_method,
                total_amount: transaction.total_amount,
                voucher_discount: (transaction as unknown as UnknownRecord).voucher_discount ?? 0,
                voucher_type: (transaction as unknown as UnknownRecord).voucher_type ?? 'none',
                voucher_value: (transaction as unknown as UnknownRecord).voucher_value ?? null,
                voucher_label: (transaction as unknown as UnknownRecord).voucher_label ?? null,
                final_amount: transaction.final_amount,
                amount_received: (transaction as unknown as UnknownRecord).amount_received ?? transaction.final_amount,
                change_amount: (transaction as unknown as UnknownRecord).change_amount ?? 0,
                contact_id: (transaction as unknown as UnknownRecord).contact_id ?? null,
                customer_name: transaction.customer_name,
                customer_unit: transaction.customer_unit ?? null,
                bank_id: (transaction as unknown as UnknownRecord).bank_id ?? null,
                card_number: (transaction as unknown as UnknownRecord).card_number ?? null,
                cl_account_id: (transaction as unknown as UnknownRecord).cl_account_id ?? null,
                cl_account_name: (transaction as unknown as UnknownRecord).cl_account_name ?? null,
                transaction_type: transaction.transaction_type,
                created_at: transaction.created_at,
                items,
                // NEW: Send normalized customization data
                transaction_item_customizations: normalizedCustomizations.customizations,
                transaction_item_customization_options: normalizedCustomizations.options,
              };

              const response = await fetch(getApiUrl('/api/transactions'), {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify(uploadData),
              });

              if (response.ok) {
                successCount++;
                syncedIds.push(transaction.id);
                addLog('success', `✅ Transaction ${transaction.id} uploaded successfully`);
              } else {
                const errorText = await response.text();
                errorCount++;
                addLog('warning', `⚠️ Failed to upload transaction ${transaction.id}: ${response.status} - ${errorText}`);
              }
            } catch (error) {
              errorCount++;
              addLog('error', `❌ Error uploading transaction ${transaction.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
          }

          if (syncedIds.length > 0 && electronAPI.localDbMarkTransactionsSynced) {
            await electronAPI.localDbMarkTransactionsSynced(syncedIds.map(String));
            addLog('info', `Marked ${syncedIds.length} transactions as synced`);
          }

          addLog('success', `🎉 Upload completed! Success: ${successCount}, Errors: ${errorCount}`);
          setSyncProgress(50);

          await updateSyncStatus(true);
          await loadOfflineTransactions();
          // await loadOfflineShifts();
        }
      }

      // 3. Upload Printer Audit Logs
      addLog('info', '📤 Uploading printer audit logs...');
      try {
        if (electronAPI?.localDbGetUnsyncedPrinterAudits) {
          const unsyncedAudits = await electronAPI.localDbGetUnsyncedPrinterAudits();
          const printer1Audits = Array.isArray(unsyncedAudits?.p1) ? unsyncedAudits.p1 : [];
          const printer2Audits = Array.isArray(unsyncedAudits?.p2) ? unsyncedAudits.p2 : [];

          if (printer1Audits.length > 0 || printer2Audits.length > 0) {
            addLog('info', `📦 Found ${printer1Audits.length} Printer 1 and ${printer2Audits.length} Printer 2 audit logs`);

            const response = await fetch(getApiUrl('/api/printer-audits'), {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                printer1: printer1Audits,
                printer2: printer2Audits
              }),
            });

            if (response.ok) {
              addLog('success', '✅ Printer audit logs uploaded successfully');

              // Mark as synced
              if (electronAPI.localDbMarkPrinterAuditsSynced) {
                const toIdArray = (audits: unknown[]): number[] => {
                  return audits
                    .map((audit) => (audit as UnknownRecord)?.id)
                    .filter((id): id is number => typeof id === 'number')
                    .concat(
                      audits
                        .map((audit) => (audit as UnknownRecord)?.id)
                        .filter((id): id is string => typeof id === 'string')
                        .map((id) => parseInt(id, 10))
                        .filter((id) => !isNaN(id))
                    );
                };

                await electronAPI.localDbMarkPrinterAuditsSynced({
                  p1Ids: toIdArray(printer1Audits),
                  p2Ids: toIdArray(printer2Audits),
                });
                addLog('info', `Marked ${printer1Audits.length + printer2Audits.length} printer audits as synced`);
              }
            } else {
              addLog('warning', `⚠️ Failed to upload printer audits: ${response.status}`);
            }
          } else {
            addLog('info', '✅ No printer audit logs to upload');
          }
        }
      } catch (error) {
        addLog('warning', `⚠️ Printer audit sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        // Continue anyway - printer audits are important but not critical
      }

      // 4. Upload Refunds
      addLog('info', '📤 Uploading refunds...');
      try {
        if (electronAPI?.localDbGetPendingRefunds) {
          const pendingRefunds = await electronAPI.localDbGetPendingRefunds();

          if (Array.isArray(pendingRefunds) && pendingRefunds.length > 0) {
            addLog('info', `📦 Found ${pendingRefunds.length} pending refunds`);

            let refundSuccessCount = 0;
            let refundErrorCount = 0;

            for (const refund of pendingRefunds) {
              try {
                const payload = typeof (refund as UnknownRecord).refund_data === 'string'
                  ? JSON.parse((refund as UnknownRecord).refund_data as string) as UnknownRecord
                  : ((refund as UnknownRecord).refund_data as UnknownRecord);

                if (!payload || typeof payload !== 'object') {
                  throw new Error('Invalid refund payload');
                }

                const transactionUuid = String(
                  payload.transaction_uuid ??
                  payload.transactionId ??
                  payload.id ??
                  ''
                );

                if (!transactionUuid) {
                  addLog('warning', `⚠️ Refund ${(refund as UnknownRecord).id} missing transaction UUID`);
                  if (electronAPI.localDbMarkRefundFailed) {
                    await electronAPI.localDbMarkRefundFailed((refund as UnknownRecord).id as number);
                  }
                  refundErrorCount++;
                  continue;
                }

                const response = await fetch(getApiUrl(`/api/transactions/${transactionUuid}/refund`), {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify(payload),
                });

                if (response.ok) {
                  const result = await response.json();

                  // IMPORTANT: Do NOT download transaction data from server response
                  // Local database is the source of truth for transactions
                  // Refund was accepted by server (response.ok), that's all we need

                  // Apply refund locally using LOCAL data only
                  if (result.refund && electronAPI.localDbApplyTransactionRefund) {
                    // Do NOT use server transaction data - pass undefined to avoid overwriting local transaction
                    await electronAPI.localDbApplyTransactionRefund({
                      refund: result.refund,
                      transactionUpdate: undefined, // Do NOT use server transaction data
                    });
                  }

                  // Mark as synced
                  if (electronAPI.localDbMarkRefundSynced) {
                    await electronAPI.localDbMarkRefundSynced((refund as UnknownRecord).id as number);
                  }

                  refundSuccessCount++;
                  addLog('success', `✅ Refund ${(refund as UnknownRecord).id} uploaded successfully`);
                } else {
                  refundErrorCount++;
                  addLog('warning', `⚠️ Failed to upload refund: ${response.status}`);
                  if (electronAPI.localDbMarkRefundFailed) {
                    await electronAPI.localDbMarkRefundFailed((refund as UnknownRecord).id as number);
                  }
                }
              } catch (error) {
                refundErrorCount++;
                addLog('error', `❌ Error uploading refund: ${error instanceof Error ? error.message : 'Unknown error'}`);
                if (electronAPI.localDbMarkRefundFailed) {
                  await electronAPI.localDbMarkRefundFailed((refund as UnknownRecord).id as number);
                }
              }
            }

            addLog('success', `🎉 Refund upload completed! Success: ${refundSuccessCount}, Errors: ${refundErrorCount}`);
          } else {
            addLog('info', '✅ No refunds to upload');
          }
        }
      } catch (error) {
        addLog('warning', `⚠️ Refund sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        // Continue anyway - refunds will be retried on next sync
      }

    } catch (error) {
      addLog('error', `❌ Upload to cloud failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setSyncProgress(0);
      setSyncStatus(prev => ({
        ...prev,
        syncInProgress: false,
        error: error instanceof Error ? error.message : 'Upload failed'
      }));
    }
  }, [addLog, loadOfflineTransactions, updateSyncStatus]);

  // Re-sync ALL transactions (force re-upload to salespulse.cc)
  const handleResyncAllTransactions = useCallback(async () => {
    if (!isElectron) {
      addLog('error', 'Offline database not available');
      return;
    }

    const confirmMessage = `🔄 RE-SYNC SEMUA TRANSAKSI\n\n` +
      `Anda akan mengunggah ulang SEMUA transaksi dari marviano-pos ke salespulse.cc.\n\n` +
      `⚠️ PERINGATAN:\n` +
      `• Proses ini akan mengunggah ulang semua transaksi (termasuk yang sudah di-sync)\n` +
      `• Transaksi yang sudah ada di server akan ditandai sebagai duplicate dan di-skip\n` +
      `• Proses ini mungkin memakan waktu lama tergantung jumlah transaksi\n\n` +
      `Apakah Anda yakin ingin melanjutkan?`;

    if (!window.confirm(confirmMessage)) {
      addLog('info', 'Re-sync dibatalkan');
      return;
    }

    setIsResyncing(true);
    setResyncProgress(null);
    addLog('info', '🔄 Memulai re-sync semua transaksi...');

    try {
      const result = await smartSyncService.resyncAllTransactions(
        businessId,
        (progress) => {
          setResyncProgress(progress);
          addLog('info', `📤 Memproses transaksi ${progress.current}/${progress.total}: ${progress.transactionId} - ${progress.status}`);
        }
      );

      if (result.success) {
        addLog('success', `✅ Re-sync selesai: ${result.syncedCount} berhasil, ${result.skippedCount} di-skip, ${result.failedCount} gagal`);
        addLog('info', result.message);
      } else {
        addLog('error', `❌ Re-sync gagal: ${result.message}`);
      }

      // Reload offline transactions to reflect updated sync status
      await loadOfflineTransactions();
      await fetchTransactionCounts();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      addLog('error', `❌ Error during re-sync: ${errorMessage}`);
      console.error('[RE-SYNC] Error:', error);
    } finally {
      setIsResyncing(false);
      setResyncProgress(null);
    }
  }, [businessId, addLog, loadOfflineTransactions, fetchTransactionCounts]);

  // Download master data from server
  const handleFullSyncClick = useCallback(async () => {
    if (!isElectron) {
      addLog('error', 'Offline database not available');
      return;
    }

    setSyncStatus(prev => ({ ...prev, syncInProgress: true, error: null }));
    addLog('info', '🔄 Starting sync (downloading products/prices from server, overwriting local)...');
    setSyncProgress(0);

    let unsubscribe: (() => void) | undefined;

    try {
      // Check connection first
      await offlineSyncService.forceConnectionCheck();
      const status = offlineSyncService.getStatus();

      if (!status.isOnline) {
        throw new Error('Perangkat belum terhubung ke internet. Harap sambungkan terlebih dahulu.');
      }

      // Subscribe to progress updates
      if (typeof offlineSyncService.subscribeSyncProgress === 'function') {
        unsubscribe = offlineSyncService.subscribeSyncProgress(progress => {
          if (progress !== null) {
            setSyncProgress(progress);
          }
        });
      }

      // Download master data from server (excludes transactions, shifts, refunds, printer audits)
      await offlineSyncService.syncFromOnline(businessId);

      addLog('success', '🎉 Sync completed! Products/prices downloaded from server (local overwritten).');
      setSyncProgress(100);

      await updateSyncStatus(true);
      await fetchTransactionCounts();
      await loadOfflineTransactions();
      // await loadOfflineShifts();

      setTimeout(() => setSyncProgress(0), 1500);
    } catch (error) {
      addLog('error', `❌ Sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setSyncProgress(0);
      setSyncStatus(prev => ({
        ...prev,
        syncInProgress: false,
        error: error instanceof Error ? error.message : 'Sync failed'
      }));
    } finally {
      if (unsubscribe) {
        try {
          unsubscribe();
        } catch (error) {
          console.warn('Gagal unsubscribe dari progress sync:', error);
        }
      }
    }
  }, [addLog, fetchTransactionCounts, loadOfflineTransactions, updateSyncStatus]);


  // Archive all transactions
  const archiveAllTransactions = async () => {
    // Close all modals immediately upon confirm
    setShowPasswordModal(false);
    setShowArchiveModal(false);
    setShowGatePasswordModal(false);
    setShowDangerZone(false);
    setIsArchiving(true);
    const rangeSuffix = hasDangerRange ? ` (range: ${rangeDescription})` : '';
    addLog('info', `🚀 Starting archive process${rangeSuffix}...`);

    try {
      const electronAPI = getElectronAPI();
      if (!electronAPI?.localDbArchiveTransactions || !electronAPI.localDbResetPrinterDailyCounters) {
        addLog('error', 'Offline database not available');
        setIsArchiving(false);
        return;
      }
      const archiveCount = await electronAPI.localDbArchiveTransactions({
        businessId: businessId,
        from: dangerRange.fromIso,
        to: dangerRange.toIso
      });
      addLog('success', `✅ Archived ${archiveCount} offline transactions${rangeSuffix}`);

      // Also archive online transactions
      try {
        const response = await fetch(getApiUrl('/api/transactions/archive'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ business_id: businessId, from: dangerRange.fromIso, to: dangerRange.toIso })
        });

        if (response.ok) {
          const data = await response.json();
          addLog('success', `✅ Archived ${data.archived} online transactions${rangeSuffix}`);
        } else {
          addLog('warning', '⚠️ Could not archive online transactions (may be offline)');
        }
      } catch (error) {
        addLog(
          'warning',
          `⚠️ Could not archive online transactions${rangeSuffix ? ` ${rangeSuffix}` : ''}: ${error instanceof Error ? error.message : 'Unknown error'
          }`
        );
      }

      const resetCounters = await electronAPI.localDbResetPrinterDailyCounters(businessId);
      if (resetCounters?.success) {
        addLog('info', '🧹 Reset offline printer daily counters');
      }
      addLog('success', '🎉 Archive process completed!');
      await fetchTransactionCounts();
      // already closed at confirm time
    } catch (error) {
      addLog('error', `❌ Archive failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsArchiving(false);
      setPasswordInput('');
    }
  };

  // Handle password verification
  const handlePasswordSubmit = () => {
    if (passwordInput === 'magnumopus2761') {
      setShowPasswordModal(false);
      if (activePasswordAction === 'archive') {
        setShowArchiveModal(true);
      } else if (activePasswordAction === 'delete') {
        setShowDeleteModal(true);
      }
      setPasswordInput('');
      setActivePasswordAction(null);
    } else {
      addLog('error', '❌ Incorrect password');
      setPasswordInput('');
    }
  };

  // Handle archive button click
  const handleArchiveClick = () => {
    setActivePasswordAction('archive');
    setShowPasswordModal(true);
  };

  // Handle delete button click
  const handleDeleteClick = () => {
    setActivePasswordAction('delete');
    setShowPasswordModal(true);
  };


  // Copy SQL preview to clipboard
  const copySqlToClipboard = async (text: string, previewId: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedSqlPreview(previewId);
      setTimeout(() => setCopiedSqlPreview(null), 2000);
    } catch {
      addLog('error', '❌ Failed to copy to clipboard');
    }
  };

  // Cleanup test transactions (hardcoded: marviano.austin@gmail.com OR user_id IS NULL)
  const cleanupTestTransactions = async () => {
    const confirmed = window.confirm(
      `⚠️ WARNING: This will PERMANENTLY DELETE ALL transactions from all 2 databases:\n\n` +
      `1. Local MySQL (local POS)\n` +
      `2. SalesPulse MySQL (online)\n\n` +
      `Target: marviano.austin@gmail.com OR user_id IS NULL\n\n` +
      `This action CANNOT be undone!\n\n` +
      `Are you absolutely sure you want to proceed?`
    );

    if (!confirmed) {
      console.log('[CLEANUP] ❌ Cleanup cancelled by user');
      addLog('info', '❌ Cleanup cancelled by user');
      return;
    }

    setIsDeletingByEmail(true);
    console.log(`[CLEANUP] 🗑️ Starting cleanup of test transactions (marviano.austin@gmail.com OR user_id IS NULL)...`);
    addLog('info', `🗑️ Starting cleanup of test transactions (marviano.austin@gmail.com OR user_id IS NULL)...`);

    try {
      const electronAPI = getElectronAPI();
      if (!electronAPI?.localDbDeleteTransactionsByRole) {
        console.error('[CLEANUP] ❌ Offline database API not available');
        addLog('error', '❌ Offline database API not available');
        setIsDeletingByEmail(false);
        return;
      }

      // ============================================
      // DATABASE 1: LOCAL (salespulse + system_pos)
      // ============================================
      console.log('[CLEANUP] 📦 [Database 1/2] Local (salespulse + system_pos) - Starting deletion...');
      addLog('info', '📦 [Database 1/2] Local (salespulse + system_pos) - Starting deletion...');
      const offlineResult = await electronAPI.localDbDeleteTransactionsByRole();
      console.log('[CLEANUP] [Local] Result:', offlineResult);

      if (offlineResult.success && offlineResult.details) {
        const d = offlineResult.details;
        console.log(`[CLEANUP] [Local MySQL] Target User IDs: ${d.targetUserIds?.join(', ') || 'NULL'}`);
        console.log(`[CLEANUP] [Local MySQL] transactions: ${d.transactions} rows`);
        console.log(`[CLEANUP] [system_pos] queue: ${(d as { system_pos_queue?: number }).system_pos_queue ?? 0}, transactions: ${(d as { system_pos_transactions?: number }).system_pos_transactions ?? 0}`);
        console.log(`[CLEANUP] [Counters] reset for businesses: ${(d as { counters_reset_businesses?: number[] }).counters_reset_businesses?.join(', ') ?? 'none'}`);

        addLog('success', `✅ [Local MySQL + system_pos] Target User IDs: ${d.targetUserIds?.join(', ') || 'NULL'}`);
        addLog('info', `   └─ transactions: ${d.transactions} deleted (salespulse)`);
        addLog('info', `   └─ system_pos: ${(d as { system_pos_transactions?: number }).system_pos_transactions ?? 0} transactions, ${(d as { system_pos_queue?: number }).system_pos_queue ?? 0} queue rows`);
        addLog('info', `   └─ printer daily counters reset for: ${(d as { counters_reset_businesses?: number[] }).counters_reset_businesses?.join(', ') ?? 'none'}`);
        addLog('success', `✅ [Local] Completed: ${d.transactions} transactions, ${d.transaction_items} items`);
      } else {
        const errorMsg = offlineResult.error || 'Unknown error';
        console.error(`[CLEANUP] [Local] ❌ Failed: ${errorMsg}`);
        addLog('error', `❌ [Local (salespulse + system_pos)] Failed: ${errorMsg}`);
      }

      // ============================================
      // DATABASE 2: SALESPULSE MYSQL
      // ============================================
      console.log('[CLEANUP] 🌐 [Database 2/2] Online MySQL (SalesPulse) - Starting deletion...');
      addLog('info', '🌐 [Database 2/2] Online MySQL (SalesPulse) - Starting deletion...');
      try {
        const apiUrl = getApiUrl('/api/admin/transactions/cleanup');
        const apiKey = process.env.NEXT_PUBLIC_POS_SYNC_API_KEY || '';
        console.log('[CLEANUP] API URL:', apiUrl);
        console.log('[CLEANUP] Using API Key:', apiKey ? `${apiKey.substring(0, 5)}...` : '(Empty/Undefined)');

        const response = await fetch(apiUrl, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            'X-POS-API-Key': process.env.NEXT_PUBLIC_POS_SYNC_API_KEY || '',
          },
          credentials: 'include',
        });

        console.log('[CLEANUP] Online response status:', response.status);
        if (response.ok) {
          const data = await response.json();
          console.log('[CLEANUP] Online response data:', data);

          // Check if new detailed format is available
          if (data.details && data.details.salespulse) {
            // New format with detailed breakdown
            // SalesPulse MySQL
            const sp = data.details.salespulse;
            console.log(`[CLEANUP] [SalesPulse MySQL] Target User IDs: ${sp.targetUserIds?.join(', ') || 'NULL'}`);
            console.log(`[CLEANUP] [SalesPulse MySQL] printer_audit_log: ${sp.printer_audit_log || 0} rows`);
            console.log(`[CLEANUP] [SalesPulse MySQL] printer1_audit_log: ${sp.printer1_audit_log} rows`);
            console.log(`[CLEANUP] [SalesPulse MySQL] printer_audits: ${sp.printer_audits} rows`);
            console.log(`[CLEANUP] [SalesPulse MySQL] printer2_audit_log: ${sp.printer2_audit_log} rows`);
            console.log(`[CLEANUP] [SalesPulse MySQL] transaction_items: ${sp.transaction_items} rows`);
            console.log(`[CLEANUP] [SalesPulse MySQL] transactions: ${sp.transactions} rows`);

            if (sp.success) {
              addLog('success', `✅ [SalesPulse MySQL] Target User IDs: ${sp.targetUserIds?.join(', ') || 'NULL'}`);
              if (sp.printer_audit_log) {
                addLog('info', `   └─ printer_audit_log: ${sp.printer_audit_log} rows deleted`);
              }
              addLog('info', `   └─ printer1_audit_log: ${sp.printer1_audit_log} rows deleted`);
              addLog('info', `   └─ printer_audits: ${sp.printer_audits} rows deleted`);
              addLog('info', `   └─ printer2_audit_log: ${sp.printer2_audit_log} rows deleted`);
              addLog('info', `   └─ transaction_items: ${sp.transaction_items} rows deleted`);
              addLog('info', `   └─ transactions: ${sp.transactions} rows deleted`);
              addLog('success', `✅ [SalesPulse MySQL] Completed: ${sp.transactions} transactions, ${sp.transaction_items} items`);
            } else {
              addLog('error', `❌ [SalesPulse MySQL] Failed: ${sp.error || 'Unknown error'}`);
            }
          } else {
            // Old format (backward compatibility) - API not yet updated
            console.warn('[CLEANUP] ⚠️ Backend API returned old format. Detailed breakdown not available.');
            console.log('[CLEANUP] Response format:', data);
            addLog('warning', '⚠️ Backend API returned old format. Detailed breakdown not available.');
            if (data.results) {
              addLog('info', `   └─ SalesPulse: ${data.results.salespulse?.deleted || 0} transactions`);
            }
            addLog('warning', '⚠️ Please redeploy backend API to get detailed per-database breakdown');
          }

          const totalDeleted = data.deleted || data.results?.total || 0;
          const totalDeletedItems = data.deletedItems || 0;
          addLog('success', `🎉 Overall: ${totalDeleted} transactions, ${totalDeletedItems} transaction items deleted across all databases`);
        } else {
          const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
          console.warn(`[CLEANUP] ⚠️ Could not delete online transactions: ${errorData.error || 'Unknown error'}`);
          addLog('warning', `⚠️ Could not delete online transactions: ${errorData.error || 'Unknown error'} (may be offline or unauthorized)`);
        }
      } catch (error) {
        console.error('[CLEANUP] ⚠️ Online deletion error:', error);
        addLog('warning', `⚠️ Could not delete online transactions: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }

      console.log(`[CLEANUP] 🎉 Cleanup process completed`);
      await fetchTransactionCounts();
    } catch (error) {
      console.error('[CLEANUP] ❌ Cleanup failed:', error);
      addLog('error', `❌ Cleanup failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsDeletingByEmail(false);
    }
  };

  // Delete all transactions permanently
  const deleteAllTransactions = async () => {
    // Close all modals immediately upon confirm
    setShowDeleteModal(false);
    setShowPasswordModal(false);
    setShowGatePasswordModal(false);
    setShowDangerZone(false);
    setIsDeleting(true);
    const rangeSuffix = hasDangerRange ? ` (range: ${rangeDescription})` : '';
    addLog('info', `🗑️ Starting permanent deletion process${rangeSuffix}...`);

    try {
      const electronAPI = getElectronAPI();
      if (
        !electronAPI?.localDbDeleteTransactions ||
        !electronAPI.localDbDeleteTransactionItems ||
        !electronAPI.localDbResetPrinterDailyCounters
      ) {
        addLog('error', 'Offline database not available');
        setIsDeleting(false);
        return;
      }
      // Delete from offline database
      const deleteCount = await electronAPI.localDbDeleteTransactions({
        businessId: businessId,
        from: dangerRange.fromIso,
        to: dangerRange.toIso
      });
      addLog('success', `✅ Deleted ${deleteCount} offline transactions permanently${rangeSuffix}`);

      // Delete transaction items
      const itemsResult = await electronAPI.localDbDeleteTransactionItems({
        businessId: businessId,
        from: dangerRange.fromIso,
        to: dangerRange.toIso
      });
      const deletedItems = itemsResult?.deleted ?? 0;
      addLog('success', `✅ Deleted ${deletedItems} offline transaction items`);

      // Delete from online database
      try {
        const apiUrl = getApiUrl('/api/transactions/delete');
        const body = { business_id: businessId, from: dangerRange.fromIso, to: dangerRange.toIso };
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body)
        });
        const responseText = await response.text();
        let parsed: { deleted?: number; error?: string } = {};
        try { parsed = JSON.parse(responseText); } catch { parsed = {}; }

        if (response.ok) {
          const data = parsed as { deleted?: number };
          addLog('success', `✅ Deleted ${data.deleted} online transactions permanently${rangeSuffix}`);
        } else {
          addLog('warning', '⚠️ Could not delete online transactions (may be offline)');
        }
      } catch (error) {
        addLog(
          'warning',
          `⚠️ Could not delete online transactions${rangeSuffix ? ` ${rangeSuffix}` : ''}: ${error instanceof Error ? error.message : 'Unknown error'
          }`
        );
      }

      const resetCounters = await electronAPI.localDbResetPrinterDailyCounters(businessId);
      if (resetCounters?.success) {
        addLog('info', '🧹 Reset offline printer daily counters');
      }
      addLog('success', '🎉 Permanent deletion process completed!');
      await fetchTransactionCounts();
    } catch (error) {
      addLog('error', `❌ Deletion failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsDeleting(false);
      // Close all related modals after deletion
      setShowDeleteModal(false);
      setShowArchiveModal(false);
      setShowPasswordModal(false);
      setShowGatePasswordModal(false);
      setShowDangerZone(false);
      setPasswordInput('');
      if (gatePasswordInputRef.current) {
        gatePasswordInputRef.current.value = '';
      }
    }
  };

  // Fetch transaction counts
  // Find orphaned transactions (exist offline but not online, even if marked as synced)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _findOrphanedTransactions = useCallback(async () => {
    const electronAPI = getElectronAPI();
    if (!electronAPI?.localDbGetTransactions) {
      addLog('error', 'Offline database not available');
      return;
    }

    addLog('info', '🔍 Searching for orphaned transactions...');

    try {
      if (!businessId) {
        addLog('error', 'No business ID available. Cannot fetch transactions.');
        return;
      }
      const allOfflineTransactionsRaw = await electronAPI.localDbGetTransactions(businessId, 10000);
      const allOfflineTransactions = normalizeOfflineTransactions(allOfflineTransactionsRaw);

      let onlineTransactionIds: string[] = [];
      try {
        const response = await fetch(getApiUrl(`/api/transactions?business_id=${businessId}&limit=10000`));
        if (response.ok) {
          const data = await response.json();
          onlineTransactionIds = Array.isArray(data.transactions)
            ? data.transactions.map((t: UnknownRecord) => String(t.id ?? ''))
            : [];
        }
      } catch {
        addLog('warning', '⚠️ Cannot connect to online database - showing all offline transactions');
      }

      const orphaned = allOfflineTransactions.filter(offlineTx =>
        !onlineTransactionIds.includes(String(offlineTx.id))
      );

      setOrphanedTransactions(orphaned);
      setShowOrphanedData(true);

      if (orphaned.length > 0) {
        addLog('warning', `⚠️ Found ${orphaned.length} orphaned transaction(s) that exist offline but not online`);
      } else {
        addLog('success', '✅ No orphaned transactions found - all offline transactions exist online');
      }
    } catch (error) {
      addLog('error', `❌ Failed to find orphaned transactions: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }, [addLog, businessId]);

  // Reset synced_at for orphaned transactions so they can be re-uploaded
  const resetOrphanedTransactions = useCallback(async () => {
    if (orphanedTransactions.length === 0) return;
    const electronAPI = getElectronAPI();
    if (!electronAPI?.localDbResetTransactionSync) {
      addLog('error', 'Offline database not available');
      return;
    }

    addLog('info', '🔄 Resetting synced_at for orphaned transactions...');

    try {
      const orphanedIds = orphanedTransactions.map(t => t.id);
      let successCount = 0;
      let failCount = 0;
      for (const id of orphanedIds) {
        const result = await electronAPI.localDbResetTransactionSync(id);
        if (result.success) {
          successCount++;
        } else {
          failCount++;
          console.warn(`Failed to reset transaction ${id}:`, result.error);
        }
      }
      
      if (failCount > 0) {
        addLog('warning', `⚠️ Reset ${successCount} transaksi, gagal ${failCount} transaksi. Cek console untuk detail.`);
      } else {
        addLog('success', `✅ Berhasil reset ${successCount} transaksi orphaned`);
      }

      addLog('success', `✅ Reset ${orphanedIds.length} transaction(s) - they will now appear in upload list`);

      await loadOfflineTransactions();
      await fetchTransactionCounts();
      await updateSyncStatus(true);
      setOrphanedTransactions([]);
    } catch (error) {
      addLog('error', `❌ Failed to reset transactions: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }, [addLog, fetchTransactionCounts, loadOfflineTransactions, orphanedTransactions, updateSyncStatus]);

  // Initialize on component mount
  useEffect(() => {
    if (isInitialized) return;

    // Prevent duplicate initialization by checking if logs already exist
    if (syncLogs.length > 0) {
      setIsInitialized(true);
      return;
    }

    updateSyncStatus(false);
    loadOfflineTransactions();
    // loadOfflineShifts();
    fetchTransactionCounts();
    addLog('info', 'Sync management initialized');
    setIsInitialized(true);
  }, [addLog, fetchTransactionCounts, isInitialized, loadOfflineTransactions, updateSyncStatus, syncLogs.length]);

  // const formatLastSync = (lastSync: string | null) => {
  //   if (!lastSync) return 'Belum pernah';
  //   const date = new Date(lastSync);
  //   return date.toLocaleString('id-ID', {
  //     day: '2-digit',
  //     month: '2-digit',
  //     year: 'numeric',
  //     hour: '2-digit',
  //     minute: '2-digit'
  //   });
  // };

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(price);
  };

  const getLogIcon = (type: SyncLog['type']) => {
    switch (type) {
      case 'success': return <CheckCircle className="w-4 h-4 text-green-600" />;
      case 'error': return <AlertCircle className="w-4 h-4 text-red-600" />;
      case 'warning': return <AlertCircle className="w-4 h-4 text-yellow-600" />;
      default: return <Activity className="w-4 h-4 text-blue-600" />;
    }
  };

  const getLogColor = (type: SyncLog['type']) => {
    switch (type) {
      case 'success': return 'text-green-800 bg-green-50';
      case 'error': return 'text-red-800 bg-red-50';
      case 'warning': return 'text-yellow-800 bg-yellow-50';
      default: return 'text-blue-800 bg-blue-50';
    }
  };

  const dangerRange = useMemo(() => {
    const fromIso = normalizeDateInput(dangerFrom, false);
    const toIso = normalizeDateInput(dangerTo, true);
    return { fromIso, toIso };
  }, [dangerFrom, dangerTo]);

  const hasDangerRange = Boolean(dangerRange.fromIso || dangerRange.toIso);

  const formatHumanDateTime = (iso: string | null) => {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Jakarta',
      timeZoneName: 'short'
    });
  };

  const rangeDescription = hasDangerRange
    ? `${dangerRange.fromIso ? formatHumanDateTime(dangerRange.fromIso) : 'Awal'} → ${dangerRange.toIso ? formatHumanDateTime(dangerRange.toIso) : 'Akhir'} (UTC+7)`
    : 'Semua tanggal (UTC+7)';

  const formatSqlPreviewDate = (iso: string | null) => {
    if (!iso) return '';
    const jakarta = new Date(new Date(iso).getTime() + (7 * 60 * 60 * 1000));
    const pad = (num: number) => num.toString().padStart(2, '0');
    const jakartaString = `${jakarta.getUTCFullYear()}-${pad(jakarta.getUTCMonth() + 1)}-${pad(jakarta.getUTCDate())} ${pad(jakarta.getUTCHours())}:${pad(jakarta.getUTCMinutes())}:${pad(jakarta.getUTCSeconds())}`;
    return `${iso} /* UTC+7: ${jakartaString} */`;
  };

  const buildSqlWherePreview = useCallback((alias?: string, statusCondition?: string) => {
    const prefix = alias ? `${alias}.` : '';
    const clauses: string[] = [`${prefix}business_id = ${businessId}`];
    if (dangerRange.fromIso) {
      clauses.push(`${prefix}created_at >= '${formatSqlPreviewDate(dangerRange.fromIso)}'`);
    }
    if (dangerRange.toIso) {
      clauses.push(`${prefix}created_at <= '${formatSqlPreviewDate(dangerRange.toIso)}'`);
    }
    if (statusCondition) {
      clauses.push(statusCondition);
    }
    return clauses.join('\n  AND ');
  }, [dangerRange.fromIso, dangerRange.toIso, businessId]);

  const UPDATED_AT_PLACEHOLDER = '<current_epoch_ms>';

  const offlineArchivePreview = useMemo(() => {
    const baseWhere = buildSqlWherePreview('', "status != 'archived'");
    const archivedWhere = buildSqlWherePreview('', "status = 'archived'");
    return `UPDATE transactions
SET status = 'archived', updated_at = ${UPDATED_AT_PLACEHOLDER}
WHERE ${baseWhere};

-- Purge local printer audits (by uuid_id, not id)
DELETE FROM printer1_audit_log
WHERE transaction_id IN (
  SELECT uuid_id FROM transactions
  WHERE ${archivedWhere}
);

DELETE FROM printer2_audit_log
WHERE transaction_id IN (
  SELECT uuid_id FROM transactions
  WHERE ${archivedWhere}
);`;
  }, [buildSqlWherePreview]);

  const onlineArchivePreview = useMemo(() => {
    const baseWhere = buildSqlWherePreview('t', "t.status != 'archived'");
    const archivedWhere = buildSqlWherePreview('t', "t.status = 'archived'");
    return `UPDATE transactions
SET status = 'archived', updated_at = NOW()
WHERE ${baseWhere};

DELETE pa FROM printer_audits pa
INNER JOIN transactions t ON pa.transaction_uuid = t.uuid_id
WHERE ${archivedWhere};`;
  }, [buildSqlWherePreview]);

  const offlineDeletePreview = useMemo(() => {
    const baseWhere = buildSqlWherePreview();
    return `-- salespulse: printer audits (by uuid_id), then transactions (CASCADE removes items, etc.)
DELETE FROM printer1_audit_log
WHERE transaction_id IN (
  SELECT uuid_id FROM transactions
  WHERE ${baseWhere}
);

DELETE FROM printer2_audit_log
WHERE transaction_id IN (
  SELECT uuid_id FROM transactions
  WHERE ${baseWhere}
);

DELETE FROM transactions
WHERE ${baseWhere};

-- system_pos: queue then transactions (same UUIDs)
DELETE FROM system_pos_queue
WHERE transaction_id IN (
  SELECT uuid_id FROM transactions WHERE ${baseWhere}
);
DELETE FROM transactions
WHERE uuid_id IN (
  SELECT uuid_id FROM transactions WHERE ${baseWhere}
);
-- (runs in system_pos DB)

-- Reset printer daily counters
DELETE FROM printer_daily_counters
WHERE business_id = ${businessId ?? '?'};`;
  }, [buildSqlWherePreview, businessId]);

  const onlineDeletePreview = useMemo(() => {
    const aliasWhere = buildSqlWherePreview('t');
    const baseWhere = buildSqlWherePreview();
    return `-- Delete items first
DELETE ti FROM transaction_items ti
INNER JOIN transactions t ON ti.uuid_transaction_id = t.uuid_id
WHERE ${aliasWhere};

-- Delete server printer audits
DELETE pa FROM printer_audits pa
INNER JOIN transactions t ON pa.transaction_uuid = t.uuid_id
WHERE ${aliasWhere};

-- Then delete transactions
DELETE FROM transactions
WHERE ${baseWhere};`;
  }, [buildSqlWherePreview]);

  return (
    <div className="flex-1 flex flex-col bg-white h-full relative overflow-y-auto">
      {/* Floating Danger Zone Button - Bottom Right */}
      <button
        onClick={() => setShowGatePasswordModal(true)}
        className="fixed bottom-4 right-4 z-40 flex items-center justify-center w-8 h-8 bg-red-600 text-white rounded-full hover:bg-red-700 transition-colors shadow-lg hover:shadow-xl"
        title="Danger Zone"
      >
        <AlertTriangle className="w-3.5 h-3.5" />
      </button>

      <div className="flex-1 flex flex-col max-w-7xl mx-auto w-full px-6 pb-6 pt-6 overflow-y-auto">
        {/* Header */}
        <div className="mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                <Database className="w-6 h-6" />
                Sinkronisasi Database
              </h1>

              {/* Transaction Count Display */}
              <div className="mt-3 flex items-center gap-4">
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-gray-600">Offline:</span>
                  <span className="font-semibold text-blue-600">{offlineTransactionCount}</span>
                  <span className="text-gray-500">transaksi</span>
                </div>
                <span className="text-gray-400">•</span>
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-gray-600">Online:</span>
                  <span className="font-semibold text-green-600">{onlineTransactionCount}</span>
                  <span className="text-gray-500">transaksi</span>
                </div>
              </div>
            </div>

            {/* Sync Buttons */}
            <div className="flex gap-3 items-center">
              {/* Auto Sync Toggle */}
              <div className="flex items-center gap-3 bg-white rounded-lg shadow-sm border border-gray-200 px-4 py-2">
                <Activity className="w-5 h-5 text-blue-600" />
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">Auto Sync (Smart Sync)</h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Otomatis mengunggah transaksi ke server setiap 30 detik
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer ml-4">
                  <input
                    type="checkbox"
                    checked={autoSyncEnabled}
                    onChange={(e) => handleAutoSyncToggle(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                  <span className="ml-3 text-sm font-medium text-gray-700">
                    {autoSyncEnabled ? 'Aktif' : 'Nonaktif'}
                  </span>
                </label>
              </div>

              <button
                onClick={handleFullSyncClick}
                disabled={syncStatus.syncInProgress || isResyncing}
                className={`
                  flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-medium transition-all text-sm
                  ${syncStatus.syncInProgress || isResyncing
                    ? 'bg-gray-400 text-white cursor-not-allowed'
                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                  }
                `}
              >
                {syncStatus.syncInProgress ? (
                  <>
                    <Download className="w-4 h-4 animate-spin" />
                    <span>Syncing...</span>
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    <div className="flex flex-col items-center">
                      <span className="font-semibold">Download Master Data</span>
                      <span className="text-xs opacity-80">Knowledge Base PoS</span>
                    </div>
                  </>
                )}
              </button>

              <button
                onClick={handleResyncAllTransactions}
                disabled={syncStatus.syncInProgress || isResyncing}
                className={`
                  flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-medium transition-all text-sm
                  ${syncStatus.syncInProgress || isResyncing
                    ? 'bg-gray-400 text-white cursor-not-allowed'
                    : 'bg-green-600 hover:bg-green-700 text-white'
                  }
                `}
                title="Re-upload semua transaksi dari marviano-pos ke salespulse.cc"
              >
                {isResyncing ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <div className="flex flex-col items-start">
                      <span className="font-semibold">Re-syncing...</span>
                      {resyncProgress && (
                        <span className="text-xs opacity-80">
                          {resyncProgress.current}/{resyncProgress.total} - {resyncProgress.status}
                        </span>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4" />
                    <div className="flex flex-col items-start">
                      <span className="font-semibold">Re-sync Semua Transaksi</span>
                      <span className="text-xs opacity-80">Upload ulang ke salespulse.cc</span>
                    </div>
                  </>
                )}
              </button>

            </div>
          </div>
        </div>

        {/* Sync Progress Bar - Always visible */}
        <div className="mb-6">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">
                {syncStatus.syncInProgress ? 'Sinkronisasi sedang berlangsung...' : 'Tidak ada sinkronisasi'}
              </span>
              <span className={`text-sm font-semibold ${syncStatus.syncInProgress ? 'text-blue-600' : 'text-gray-400'}`}>
                {syncProgress}%
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className={`h-2 rounded-full transition-all duration-300 ${syncStatus.syncInProgress ? 'bg-blue-600' : 'bg-gray-400'}`}
                style={{ width: `${syncProgress}%` }}
              />
            </div>
          </div>
        </div>

        {/* Error Message */}
        {syncStatus.error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-red-600" />
              <p className="text-red-800">{syncStatus.error}</p>
            </div>
          </div>
        )}

        {/* Two Column Layout: Logs and Offline Data */}
        <div className="grid grid-cols-1 lg:grid-cols-[30%_70%] gap-6 mb-6">
          {/* Sync Logs */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 flex flex-col h-[420px]">
            <h2 className="text-sm font-semibold text-gray-800 flex items-center gap-2 mb-4 flex-shrink-0">
              <Activity className="w-4 h-4" />
              Log Sinkronisasi
            </h2>

            <div className="flex-1 overflow-y-auto border border-gray-200 rounded-lg min-h-0">
              {syncLogs.length === 0 ? (
                <div className="p-4 text-center text-gray-500 text-xs">
                  Belum ada log sinkronisasi
                </div>
              ) : (
                <div className="space-y-1 p-2">
                  {syncLogs.map((log) => (
                    <div key={log.id} className={`p-1.5 rounded text-xs ${getLogColor(log.type)}`}>
                      <div className="flex items-center gap-2">
                        {getLogIcon(log.type)}
                        <span className="font-medium text-[10px]">
                          {log.timestamp.toLocaleTimeString('id-ID')}
                        </span>
                        <span className="text-[10px]">{log.message}</span>
                      </div>
                      {log.details != null && (
                        <div className="mt-1 ml-6 text-[9px] opacity-75">
                          {JSON.stringify(log.details)}
                        </div>
                      )}
                    </div>
                  ))}
                  <div ref={logsEndRef} />
                </div>
              )}
            </div>
          </div>

          {/* Offline Transactions */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 flex flex-col h-[420px]">
            <div className="flex items-center justify-between mb-4 flex-shrink-0">
              <h2 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                <Database className="w-4 h-4" />
                Data Offline yang Akan Diunggah
                {offlineTransactions.length > 0 && (
                  <span className="text-xs font-normal text-gray-500">
                    ({offlineTransactions.length} transaksi)
                  </span>
                )}
              </h2>
              {offlineTransactions.length > 0 && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCheckTransactionStatus}
                    disabled={checkingStatus}
                    className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-50 hover:bg-blue-100 text-blue-700 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Cek apakah transaksi sudah ada di server"
                  >
                    <RefreshCw className={`w-3 h-3 ${checkingStatus ? 'animate-spin' : ''}`} />
                    <span>{checkingStatus ? 'Mengecek...' : 'Cek Status'}</span>
                  </button>
                  {Array.from(checkResults.values()).some(r => r.exists && r.checked) && (
                    <button
                      onClick={handleUpdateSyncedStatus}
                      className="flex items-center gap-1 px-2 py-1 text-xs bg-green-50 hover:bg-green-100 text-green-700 rounded transition-colors"
                      title="Update synced_at untuk transaksi yang sudah ada di server"
                    >
                      <CheckCircle className="w-3 h-3" />
                      <span>Update Status</span>
                    </button>
                  )}
                  <button
                    onClick={handleDeleteUnsyncedTransactions}
                    className="flex items-center gap-1 px-2 py-1 text-xs bg-red-50 hover:bg-red-100 text-red-700 rounded transition-colors"
                    title="Hapus semua data offline yang akan diunggah"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Hapus</span>
                  </button>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto border border-gray-200 rounded-lg min-h-0">
              {isLoadingOfflineData ? (
                <div className="p-4 text-center text-gray-500 text-xs">
                  <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
                  Memuat data offline...
                </div>
              ) : offlineTransactions.length === 0 ? (
                <div className="p-4 text-center text-gray-500 text-xs">
                  Tidak ada transaksi offline
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[10px]">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="px-2 py-1 text-left font-medium text-gray-700">R/RR</th>
                        <th className="px-2 py-1 text-left font-medium text-gray-700">Waktu</th>
                        <th className="px-2 py-1 text-left font-medium text-gray-700">Total</th>
                        <th className="px-2 py-1 text-left font-medium text-gray-700">Disc/Vc</th>
                        <th className="px-2 py-1 text-left font-medium text-gray-700">Final</th>
                        <th className="px-2 py-1 text-left font-medium text-gray-700">Pelanggan</th>
                        <th className="px-2 py-1 text-left font-medium text-gray-700">Waiter</th>
                        <th className="px-2 py-1 text-left font-medium text-gray-700">Kasir</th>
                        <th className="px-2 py-1 text-left font-medium text-gray-700">Sync Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {offlineTransactions.map((transaction) => {
                        const txUuid = String(transaction.id);
                        const checkResult = checkResults.get(txUuid);
                        const isChecked = checkResult?.checked || false;
                        const existsOnServer = checkResult?.exists || false;
                        const isIdentical = checkResult?.identical || false;

                        // Determine R/RR badge
                        const receiptizeCounter = receiptizeCounters[txUuid];
                        const receiptCounter = receiptCounters[txUuid];
                        const hasReceiptizeCounter = typeof receiptizeCounter === 'number' && receiptizeCounter > 0;
                        const hasReceiptCounter = typeof receiptCounter === 'number' && receiptCounter > 0;
                        const isInReceiptizeIds = receiptizePrintedIds.has(txUuid);
                        const isReceiptize = isInReceiptizeIds || hasReceiptizeCounter;

                        // Get waiter name
                        const waiterId = transaction.waiter_id ? (typeof transaction.waiter_id === 'number' ? transaction.waiter_id : parseInt(String(transaction.waiter_id), 10)) : null;
                        const waiter = waiterId ? employeesMap.get(waiterId) : null;

                        return (
                          <tr
                            key={transaction.id}
                            className={`hover:bg-gray-50 ${isChecked && existsOnServer ? 'bg-yellow-50' : ''
                              }`}
                          >
                            {/* R/RR Badge */}
                            <td className="px-2 py-1">
                              <div className="flex items-center gap-1">
                                {isReceiptize ? (
                                  <>
                                    <span className="inline-flex items-center px-1 py-0.5 rounded text-[9px] font-medium bg-green-100 text-green-800">
                                      RR
                                    </span>
                                    <span className="text-[9px] font-medium text-blue-600">
                                      {hasReceiptizeCounter ? receiptizeCounter : (transaction.receipt_number || '-')}
                                    </span>
                                  </>
                                ) : hasReceiptCounter ? (
                                  <>
                                    <span className="inline-flex items-center px-1 py-0.5 rounded text-[9px] font-medium bg-blue-100 text-blue-800">
                                      R
                                    </span>
                                    <span className="text-[9px] font-medium text-blue-600">
                                      {receiptCounter}
                                    </span>
                                  </>
                                ) : (
                                  <span className="text-[9px] text-gray-500">
                                    {transaction.receipt_number || '-'}
                                  </span>
                                )}
                              </div>
                            </td>
                            {/* Waktu */}
                            <td className="px-2 py-1 text-gray-600">
                              {transaction.created_at ? new Date(transaction.created_at).toLocaleString('id-ID', {
                                year: 'numeric',
                                month: '2-digit',
                                day: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit'
                              }) : 'N/A'}
                            </td>
                            {/* Total */}
                            <td className="px-2 py-1 font-medium text-gray-900">
                              {formatPrice(transaction.total_amount ?? 0)}
                            </td>
                            {/* Disc/Vc */}
                            <td className="px-2 py-1 text-gray-600">
                              {formatPrice(transaction.voucher_discount ?? 0)}
                            </td>
                            {/* Final */}
                            <td className="px-2 py-1 font-medium text-gray-900">
                              {formatPrice(transaction.final_amount ?? 0)}
                            </td>
                            {/* Pelanggan */}
                            <td className="px-2 py-1 text-gray-600">
                              {transaction.customer_name || 'Guest'}
                            </td>
                            {/* Waiter */}
                            <td className="px-2 py-1">
                              {waiter ? (
                                <span className="text-[9px] text-gray-900">{waiter.name}</span>
                              ) : (
                                <span className="text-[9px] text-gray-400">-</span>
                              )}
                            </td>
                            {/* Kasir */}
                            <td className="px-2 py-1 text-gray-600 text-[9px]">
                              {transaction.user_name || '-'}
                            </td>
                            {/* Sync Status */}
                            <td className="px-2 py-1">
                              <div className="flex items-center gap-1">
                                {transaction.sync_status === 'failed' ? (
                                  <span 
                                    className="inline-flex px-1.5 py-0.5 text-[9px] font-semibold rounded-full bg-red-100 text-red-800"
                                    title={`Gagal upload${transaction.sync_attempts ? ` (${transaction.sync_attempts} percobaan)` : ''}`}
                                  >
                                    ❌ Failed
                                    {transaction.sync_attempts && transaction.sync_attempts > 0 && (
                                      <span className="ml-1">({transaction.sync_attempts})</span>
                                    )}
                                  </span>
                                ) : (
                                  <span 
                                    className="inline-flex px-1.5 py-0.5 text-[9px] font-semibold rounded-full bg-blue-100 text-blue-800"
                                    title="Menunggu upload"
                                  >
                                    ⏳ Pending
                                  </span>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Orphaned Transactions (exist offline but not online) */}
        {showOrphanedData && (
          <div className="bg-orange-50 rounded-lg shadow-sm border-2 border-orange-300 p-6 mt-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-orange-900 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5" />
                Transaksi Hilang (Offline tapi Tidak di Online)
              </h2>
              <button
                onClick={() => setShowOrphanedData(false)}
                className="flex items-center gap-1 px-3 py-1 text-sm bg-orange-100 hover:bg-orange-200 text-orange-700 rounded transition-colors"
              >
                <X className="w-4 h-4" />
                <span>Tutup</span>
              </button>
            </div>

            {orphanedTransactions.length === 0 ? (
              <div className="p-4 text-center text-orange-700 bg-orange-100 rounded-lg">
                <CheckCircle className="w-8 h-8 mx-auto mb-2" />
                <p className="font-medium">Semua transaksi offline sudah ada di online!</p>
                <p className="text-sm">Tidak ada transaksi yang hilang.</p>
              </div>
            ) : (
              <>
                <div className="bg-orange-100 border border-orange-300 rounded-lg p-4 mb-4">
                  <p className="text-sm text-orange-900 mb-2">
                    <strong>Ditemukan {orphanedTransactions.length} transaksi</strong> yang ada di offline database tapi tidak ada di online database.
                  </p>
                  <p className="text-sm text-orange-800">
                    Transaksi ini mungkin sudah ditandai sebagai &quot;synced&quot; tapi gagal diupload. Klik tombol di bawah untuk reset status mereka sehingga bisa diupload ulang.
                  </p>
                </div>

                <div className="max-h-64 overflow-y-auto border border-orange-200 rounded-lg mb-4">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-orange-100">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium text-orange-900">#</th>
                          <th className="px-3 py-2 text-center font-medium text-orange-900">UUID</th>
                          <th className="px-3 py-2 text-left font-medium text-orange-900">Tanggal</th>
                          <th className="px-3 py-2 text-left font-medium text-orange-900">Customer</th>
                          <th className="px-3 py-2 text-center font-medium text-orange-900">CU</th>
                          <th className="px-3 py-2 text-left font-medium text-orange-900">Metode</th>
                          <th className="px-3 py-2 text-left font-medium text-orange-900">Total</th>
                          <th className="px-3 py-2 text-left font-medium text-orange-900">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-orange-200 bg-white">
                        {orphanedTransactions.map((transaction) => (
                          <tr key={transaction.id} className="hover:bg-orange-50">
                            <td className="px-3 py-2 font-medium text-orange-600">
                              #{transaction.receipt_number || 'N/A'}
                            </td>
                            <td className="px-3 py-2 text-center">
                              <button
                                onClick={() => handleCopyUuid(String(transaction.id))}
                                className="p-1 hover:bg-orange-200 rounded transition-colors"
                                title={`Copy UUID: ${String(transaction.id)}`}
                              >
                                <svg className="w-4 h-4 text-orange-500 hover:text-orange-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                </svg>
                              </button>
                            </td>
                            <td className="px-3 py-2 text-gray-600">
                              {transaction.created_at ? new Date(transaction.created_at).toLocaleString('id-ID') : 'N/A'}
                            </td>
                            <td className="px-3 py-2 text-gray-600">
                              {transaction.customer_name || 'Guest'}
                            </td>
                            <td className="px-3 py-2 text-center text-orange-900">
                              {transaction.customer_unit ?? '-'}
                            </td>
                            <td className="px-3 py-2">
                              <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800">
                                {transaction.payment_method}
                              </span>
                            </td>
                            <td className="px-3 py-2 font-medium text-gray-900">
                              {formatPrice(transaction.final_amount ?? 0)}
                            </td>
                            <td className="px-3 py-2">
                              <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${transaction.status === 'paid' || transaction.status === 'completed'
                                ? 'bg-green-100 text-green-800'
                                : 'bg-yellow-100 text-yellow-800'
                                }`}>
                                {transaction.status === 'completed' ? 'paid' : transaction.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <button
                  onClick={resetOrphanedTransactions}
                  className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-orange-600 hover:bg-orange-700 text-white rounded-lg transition-colors font-medium"
                >
                  <RefreshCw className="w-5 h-5" />
                  Reset & Siapkan untuk Upload Ulang ({orphanedTransactions.length} transaksi)
                </button>
              </>
            )}
          </div>
        )}
      </div>

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

      {/* Password Modal */}
      {/* Gate Password Modal (to open Danger Zone) */}
      {showGatePasswordModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">Password</label>
              <input
                ref={gatePasswordInputRef}
                type="password"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const password = gatePasswordInputRef.current?.value || '';
                    if (password === 'magnumopus2761') {
                      setShowGatePasswordModal(false);
                      if (gatePasswordInputRef.current) {
                        gatePasswordInputRef.current.value = '';
                      }
                      setShowDangerZone(true);
                    } else {
                      addLog('error', '❌ Incorrect password');
                      if (gatePasswordInputRef.current) {
                        gatePasswordInputRef.current.value = '';
                      }
                    }
                  }
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                placeholder="Enter password..."
                autoFocus
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowGatePasswordModal(false);
                  if (gatePasswordInputRef.current) {
                    gatePasswordInputRef.current.value = '';
                  }
                }}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const password = gatePasswordInputRef.current?.value || '';
                  if (password === 'magnumopus2761') {
                    setShowGatePasswordModal(false);
                    if (gatePasswordInputRef.current) {
                      gatePasswordInputRef.current.value = '';
                    }
                    setShowDangerZone(true);
                  } else {
                    addLog('error', '❌ Incorrect password');
                    if (gatePasswordInputRef.current) {
                      gatePasswordInputRef.current.value = '';
                    }
                  }
                }}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Password Modal */}
      {showPasswordModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-xl font-bold text-gray-900 mb-4">
              {activePasswordAction === 'delete' ? 'Delete All Transactions' : 'Archive All Transactions'}
            </h3>
            <p className="text-gray-600 mb-4">
              {activePasswordAction === 'delete'
                ? 'This will PERMANENTLY DELETE all transactions from salespulse, system_pos, and db_host (selected business). Printer daily counters will be reset. This action CANNOT be undone.'
                : 'This will archive all transactions in both online and offline databases. Archived data can be restored if needed.'}
            </p>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">Enter Password</label>
              <input
                type="password"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handlePasswordSubmit();
                  }
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                placeholder="Enter password..."
                autoFocus
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowPasswordModal(false);
                  setPasswordInput('');
                }}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handlePasswordSubmit}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {showArchiveModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
                <Archive className="w-6 h-6 text-red-600" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-gray-900">Confirm Archive</h3>
                <p className="text-sm text-gray-500">
                  {hasDangerRange
                    ? `This will archive transactions created within ${rangeDescription}.`
                    : 'This will archive every transaction for this business.'}
                </p>
              </div>
            </div>
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
              <p className="text-sm text-red-800">
                <strong>Warning:</strong>{' '}
                {hasDangerRange
                  ? `Only transactions between ${rangeDescription} will be archived. They will be hidden but still stored.`
                  : `This will archive all transactions for business ID ${businessId}. Archived transactions will be hidden from the transaction list but preserved.`}
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowArchiveModal(false);
                  setPasswordInput('');
                }}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
                disabled={isArchiving}
              >
                Cancel
              </button>
              <button
                onClick={archiveAllTransactions}
                disabled={isArchiving}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isArchiving ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Archiving...
                  </>
                ) : (
                  <>
                    <Archive className="w-4 h-4" />
                    Archive All
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete All Transactions Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
                <Trash2 className="w-6 h-6 text-red-600" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-gray-900">⚠️ Confirm Permanent Deletion</h3>
                <p className="text-sm text-gray-500">This action cannot be undone</p>
              </div>
            </div>
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
              <p className="text-sm text-red-800 font-medium mb-2">
                <strong>WARNING: This will PERMANENTLY DELETE:</strong>
              </p>
              <ul className="text-sm text-red-700 list-disc list-inside space-y-1">
                <li>
                  {hasDangerRange
                    ? `Transactions for business ID ${businessId} between ${rangeDescription}`
                    : `All transactions for business ID ${businessId}`}
                </li>
                <li>All transaction items</li>
                <li>Data in salespulse, system_pos, and db_host (selected business)</li>
                <li>Printer daily counters will be reset</li>
                <li>This action CANNOT be undone</li>
              </ul>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowDeleteModal(false);
                  setPasswordInput('');
                }}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
                disabled={isDeleting}
              >
                Cancel
              </button>
              <button
                onClick={deleteAllTransactions}
                disabled={isDeleting}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center gap-2 font-bold"
              >
                {isDeleting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    DELETE ALL
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Danger Zone Modal - Floating Panel */}
      {showDangerZone && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              {/* Header */}
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
                    <AlertTriangle className="w-6 h-6 text-red-600" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-gray-900">Danger Zone</h3>
                  </div>
                </div>
                <button
                  onClick={() => setShowDangerZone(false)}
                  className="w-8 h-8 flex items-center justify-center hover:bg-gray-100 rounded-full transition-colors"
                >
                  <X className="w-5 h-5 text-gray-600" />
                </button>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Card 1: Cleanup Test Transactions */}
                <div className="border-2 border-red-200 rounded-lg p-5 bg-gradient-to-br from-red-50 to-orange-50">
                  <div className="flex items-center gap-2 mb-4">
                    <Trash2 className="w-5 h-5 text-red-600" />
                    <h4 className="font-semibold text-gray-900 text-lg">Cleanup Test Transactions</h4>
                  </div>
                  <p className="text-sm text-gray-700 mb-4">
                    Permanently delete ALL test transactions from salespulse, system_pos, and SalesPulse API. Printer daily counters (and any other counters) are reset for each affected business.
                  </p>
                  <div className="bg-red-100 border border-red-300 rounded-lg p-3 mb-4">
                    <p className="text-xs text-red-800 font-medium mb-1">
                      <strong>Target Criteria:</strong>
                    </p>
                    <ul className="text-xs text-red-700 list-disc list-inside space-y-0.5">
                      <li><code className="bg-red-200 px-1 rounded">marviano.austin@gmail.com</code></li>
                      <li><code className="bg-red-200 px-1 rounded">user_id IS NULL</code></li>
                    </ul>
                  </div>
                  <button
                    onClick={cleanupTestTransactions}
                    disabled={isDeletingByEmail}
                    className="w-full px-4 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {isDeletingByEmail ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Cleaning Up...
                      </>
                    ) : (
                      <>
                        <Trash2 className="w-4 h-4" />
                        Cleanup Test Transactions
                      </>
                    )}
                  </button>
                  <p className="text-xs text-red-700 mt-3">
                    ⚠️ This action cannot be undone. All transactions, items, and audit logs matching the criteria are permanently deleted from salespulse, system_pos, and online. Counters are reset.
                  </p>
                </div>

                {/* Card 2: Delete whole transactions (Date-Range Based) */}
                <div className="border-2 border-orange-200 rounded-lg p-5 bg-gradient-to-br from-orange-50 to-yellow-50">
                  <div className="flex items-center gap-2 mb-4">
                    <Archive className="w-5 h-5 text-orange-600" />
                    <h4 className="font-semibold text-gray-900 text-lg">Delete whole transactions</h4>
                  </div>
                  <p className="text-sm text-gray-700 mb-4">
                    Delete all transactions for the selected business from salespulse, system_pos, and db_host. Optional date filter below. Printer daily counters (and any other counters) are reset for this business.
                  </p>

                  {/* Date Range Filters */}
                  <div className="mb-4">
                    <h5 className="font-medium text-gray-900 mb-2 text-sm">Filter by Transaction Date</h5>
                    <div className="grid grid-cols-1 gap-3 mb-3">
                      <label className="flex flex-col text-sm text-gray-700">
                        <span className="mb-1">From (created_at)</span>
                        <input
                          type="datetime-local"
                          value={dangerFrom}
                          onChange={(e) => setDangerFrom(e.target.value)}
                          className="px-3 py-2 border border-orange-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent text-black bg-white"
                        />
                      </label>
                      <label className="flex flex-col text-sm text-gray-700">
                        <span className="mb-1">To (created_at)</span>
                        <input
                          type="datetime-local"
                          value={dangerTo}
                          onChange={(e) => setDangerTo(e.target.value)}
                          className="px-3 py-2 border border-orange-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent text-black bg-white"
                        />
                      </label>
                    </div>
                    <div className="flex items-center gap-2 mb-2">
                      <button
                        onClick={() => {
                          setDangerFrom('');
                          setDangerTo('');
                        }}
                        className="px-3 py-1.5 text-xs border border-orange-300 rounded-lg text-gray-700 hover:bg-orange-100 transition-colors bg-white"
                      >
                        Reset Range
                      </button>
                      <span className="text-xs text-gray-600 flex-1">
                        Leave blank for all dates
                      </span>
                    </div>
                    <div className="text-xs text-gray-600 mb-4">
                      Target: <span className="font-medium text-gray-700">{rangeDescription}</span>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="space-y-2 mb-4">
                    <button
                      onClick={handleArchiveClick}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors font-medium text-sm"
                    >
                      <Archive className="w-4 h-4" />
                      Archive Matching Transactions
                    </button>

                    <button
                      onClick={handleDeleteClick}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium text-sm"
                    >
                      <Trash2 className="w-4 h-4" />
                      Delete Matching Transactions
                    </button>
                  </div>

                  {/* Unified SQL Preview */}
                  <div className="bg-white rounded-lg p-3 border border-orange-300">
                    <div className="flex items-center justify-between mb-2">
                      <h5 className="font-semibold text-gray-900 text-sm">SQL Queries to be Executed (Preview)</h5>
                      <button
                        onClick={() => {
                          const fullSql = `-- Archive (Keeps Data)\n-- Local MySQL:\n${offlineArchivePreview}\n\n-- Online MySQL:\n${onlineArchivePreview}\n\n-- Delete (Permanent)\n-- Local (salespulse + system_pos + counter reset):\n${offlineDeletePreview}\n\n-- Online MySQL (SalesPulse API):\n${onlineDeletePreview}`;
                          copySqlToClipboard(fullSql, 'bulkActions');
                        }}
                        className="flex items-center gap-1 px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded transition-colors"
                        title="Copy SQL"
                      >
                        {copiedSqlPreview === 'bulkActions' ? (
                          <>
                            <Check className="w-3 h-3 text-green-600" />
                            <span className="text-green-600">Copied!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            <span>Copy</span>
                          </>
                        )}
                      </button>
                    </div>
                    <div className="bg-gray-50 p-3 rounded border border-orange-200 font-mono text-xs max-h-40 overflow-y-auto">
                      <div className="mb-3">
                        <div className="flex items-center gap-2 mb-2">
                          <CheckCircle className="w-3 h-3 text-orange-600" />
                          <strong className="text-gray-900 text-xs">Archive (Keeps Data):</strong>
                        </div>
                        <div className="text-orange-700 text-xs mb-1">-- Local MySQL:</div>
                        <pre className="text-gray-800 whitespace-pre-wrap text-xs mb-2">{offlineArchivePreview}</pre>
                        <div className="text-orange-700 text-xs mb-1">-- Online MySQL:</div>
                        <pre className="text-gray-800 whitespace-pre-wrap text-xs">{onlineArchivePreview}</pre>
                      </div>
                      <div className="border-t border-orange-200 pt-3">
                        <div className="flex items-center gap-2 mb-2">
                          <Trash2 className="w-3 h-3 text-red-600" />
                          <strong className="text-red-900 text-xs">Delete (Permanent):</strong>
                        </div>
                        <div className="text-red-700 text-xs mb-1">-- Local (salespulse + system_pos + counter reset):</div>
                        <pre className="text-red-900 whitespace-pre-wrap text-xs mb-2">{offlineDeletePreview}</pre>
                        <div className="text-red-700 text-xs mb-1">-- Online MySQL (SalesPulse API):</div>
                        <pre className="text-red-900 whitespace-pre-wrap text-xs">{onlineDeletePreview}</pre>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
