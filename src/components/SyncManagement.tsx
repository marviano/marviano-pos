'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { 
  RefreshCw, 
  Cloud, 
  CloudOff, 
  CheckCircle, 
  AlertCircle, 
  Database,
  Clock,
  Activity,
  Trash2,
  Eye,
  EyeOff,
  Archive,
  AlertTriangle,
  X
} from 'lucide-react';
import { offlineSyncService } from '@/lib/offlineSync';
import { smartSyncService } from '@/lib/smartSync';
import { restorePrinterStateFromCloud } from '@/lib/printerSyncUtils';
import { getApiUrl } from '@/lib/api';

type UnknownRecord = Record<string, unknown>;
type SmartSyncStatus = ReturnType<typeof smartSyncService.getStatus>;

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
  user_id: number;
  shift_uuid?: string; // Added shift_uuid
  payment_method: string;
  pickup_method: string;
  total_amount: number;
  final_amount: number;
  customer_name: string | null;
  customer_unit?: number | null;
  receipt_number: number | null;
  transaction_type: string;
  status: string;
  created_at: string;
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
  return (
    (typeof record.id === 'number' || typeof record.id === 'string') &&
    typeof record.business_id === 'number' &&
    typeof record.user_id === 'number' &&
    typeof record.payment_method === 'string' &&
    typeof record.pickup_method === 'string' &&
    typeof record.final_amount === 'number' &&
    typeof record.created_at === 'string'
  );
};

const normalizeOfflineTransactions = (rows: unknown): OfflineTransaction[] =>
  Array.isArray(rows) ? rows.filter(isOfflineTransaction) : [];

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

export default function SyncManagement() {
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    isOnline: true,
    lastSync: null,
    pendingTransactions: 0,
    syncInProgress: false,
    error: null
  });

  const [syncLogs, setSyncLogs] = useState<SyncLog[]>([]);
  const [offlineTransactions, setOfflineTransactions] = useState<OfflineTransaction[]>([]);
  const [offlineShifts, setOfflineShifts] = useState<OfflineShift[]>([]);
  const [showLogs, setShowLogs] = useState(true);
  const [showOfflineData, setShowOfflineData] = useState(true);
  const [isLoadingOfflineData, setIsLoadingOfflineData] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [copiedUuid, setCopiedUuid] = useState<string | null>(null);
  const [offlineTransactionCount, setOfflineTransactionCount] = useState<number>(0);
  const [onlineTransactionCount, setOnlineTransactionCount] = useState<number>(0);
  const [syncProgress, setSyncProgress] = useState<number>(0);
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [isArchiving, setIsArchiving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [activePasswordAction, setActivePasswordAction] = useState<'archive' | 'delete' | null>(null);
  const [showDangerZone, setShowDangerZone] = useState(false);
  const [showGatePasswordModal, setShowGatePasswordModal] = useState(false);
  const [gatePasswordInput, setGatePasswordInput] = useState('');
  const [orphanedTransactions, setOrphanedTransactions] = useState<OfflineTransaction[]>([]);
  const [showOrphanedData, setShowOrphanedData] = useState(false);
  const [dangerFrom, setDangerFrom] = useState<string>('');
  const [dangerTo, setDangerTo] = useState<string>('');
  const [deleteByEmailPreview, setDeleteByEmailPreview] = useState<string>('');
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Initialize preview with default email when danger zone opens
  useEffect(() => {
    if (showDangerZone) {
      // Set initial preview with default email
      const defaultEmail = 'marviano.austin@gmail.com';
      setDeleteByEmailPreview(defaultEmail);
      // Also set the input field value after a short delay to ensure DOM is ready
      setTimeout(() => {
        const emailInput = document.getElementById('deleteUserEmail') as HTMLInputElement;
        if (emailInput && !emailInput.value) {
          emailInput.value = defaultEmail;
        }
      }, 100);
    }
  }, [showDangerZone]);

  const [smartSyncStatus, setSmartSyncStatus] = useState<SmartSyncStatus | null>(null);

  // Check if we're in Electron environment
  const isElectron = Boolean(getElectronAPI());

  useEffect(() => {
    const updateStatus = () => {
      setSmartSyncStatus(smartSyncService.getStatus());
    };
    updateStatus();
    const interval = setInterval(updateStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const checkPendingTransactions = async () => {
      const electronAPI = getElectronAPI();
      if (!electronAPI?.localDbGetPendingTransactions) {
        return;
      }
      try {
        const pending = await electronAPI.localDbGetPendingTransactions();
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
    
    // Auto-scroll to bottom
    setTimeout(() => {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
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
  const loadOfflineShifts = useCallback(async () => {
    const electronAPI = getElectronAPI();
    if (!electronAPI?.localDbGetUnsyncedShifts) {
      return;
    }

    try {
      const shifts = await electronAPI.localDbGetUnsyncedShifts(14);
      const normalized = normalizeOfflineShifts(shifts);
      setOfflineShifts(normalized);
      if (normalized.length > 0) {
        addLog('info', `Found ${normalized.length} offline shifts pending upload`);
      }
    } catch (error) {
      addLog(
        'error',
        `Failed to load offline shifts: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }, [addLog]);

  // Load offline transactions
  const loadOfflineTransactions = useCallback(async () => {
    const electronAPI = getElectronAPI();
    if (!electronAPI?.localDbGetUnsyncedTransactions) {
      addLog('error', 'Offline database not available');
      return;
    }

    setIsLoadingOfflineData(true);
    try {
      const transactions = await electronAPI.localDbGetUnsyncedTransactions(14);
      const normalized = normalizeOfflineTransactions(transactions);
      setOfflineTransactions(normalized);
      addLog('success', `Loaded ${normalized.length} offline transactions pending upload`);
    } catch (error) {
      addLog(
        'error',
        `Failed to load offline transactions: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    } finally {
      setIsLoadingOfflineData(false);
    }
  }, [addLog]);

  const fetchTransactionCounts = useCallback(async () => {
    try {
      const electronAPI = getElectronAPI();
      if (electronAPI?.localDbGetTransactions) {
        const offlineTx = await electronAPI.localDbGetTransactions(14, 10000);
        setOfflineTransactionCount(Array.isArray(offlineTx) ? offlineTx.length : 0);
      }

      try {
        const response = await fetch(getApiUrl('/api/transactions?business_id=14&limit=10000'));
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
  }, []);

  // Full database sync (Download from cloud)
  const syncFromCloud = useCallback(async () => {
    const electronAPI = getElectronAPI();
    if (!electronAPI) {
      addLog('error', 'Offline database not available');
      return;
    }

    setSyncStatus(prev => ({ ...prev, syncInProgress: true, error: null }));
    addLog('info', 'Starting download from cloud...');
    setSyncProgress(50); // Start download at 50%

    try {
      const response = await fetch(getApiUrl('/api/sync'));
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const jsonData: UnknownRecord = await response.json();
      addLog('info', `Received data from cloud: ${JSON.stringify(jsonData.counts ?? {})}`);

      const data = (jsonData.data ?? {}) as UnknownRecord;
      const targetBusinessId = Number(jsonData.businessId ?? 14);

      // 1. SYNC DEPENDENCIES FIRST (Categories, Types, Options)
      const category1 = toRecordArray(data.category1);
      if (category1.length > 0 && electronAPI.localDbUpsertCategory1) {
        await electronAPI.localDbUpsertCategory1(category1);
        addLog('success', `✅ ${category1.length} category1 synced to local database`);
      }
      
      const category2 = toRecordArray(data.category2);
      if (category2.length > 0 && electronAPI.localDbUpsertCategory2) {
        await electronAPI.localDbUpsertCategory2(category2);
        addLog('success', `✅ ${category2.length} category2 synced to local database`);
      }

      const customizationTypes = toRecordArray(data.customizationTypes);
      if (customizationTypes.length > 0 && electronAPI.localDbUpsertCustomizationTypes) {
        await electronAPI.localDbUpsertCustomizationTypes(customizationTypes);
        addLog('success', `✅ ${customizationTypes.length} customization types synced to local database`);
      }

      const customizationOptions = toRecordArray(data.customizationOptions);
      if (customizationOptions.length > 0 && electronAPI.localDbUpsertCustomizationOptions) {
        await electronAPI.localDbUpsertCustomizationOptions(customizationOptions);
        addLog('success', `✅ ${customizationOptions.length} customization options synced to local database`);
      }

      // 2. SYNC PRODUCTS
      const products = Array.isArray(data.products) ? (data.products as UnknownRecord[]) : [];
      if (products.length > 0 && electronAPI.localDbUpsertProducts) {
        await electronAPI.localDbUpsertProducts(products);
        addLog('success', `✅ ${products.length} products synced to local database`);
      } else {
        addLog('warning', `⚠️ No products found in sync data (received: ${products.length})`);
      }

      // 3. SYNC DEPENDENTS (Product Customizations, Bundle Items)
      const productCustomizations = toRecordArray(data.productCustomizations);
      if (productCustomizations.length > 0 && electronAPI.localDbUpsertProductCustomizations) {
        await electronAPI.localDbUpsertProductCustomizations(productCustomizations);
        addLog('success', `✅ ${productCustomizations.length} product customizations synced`);
      }

      const bundleItems = toRecordArray(data.bundleItems);
      if (bundleItems.length > 0 && electronAPI.localDbUpsertBundleItems) {
        await electronAPI.localDbUpsertBundleItems(bundleItems);
        addLog('success', `✅ ${bundleItems.length} bundle items synced`);
      }
      
      // 4. Sync Transactions and other tables
      const cloudTransactions = toRecordArray(data.transactions);
      if (cloudTransactions.length > 0 && electronAPI.localDbUpsertTransactions) {
        addLog('info', `🔄 Syncing ${cloudTransactions.length} transactions to local database...`);
        const syncedDates = [
          ...new Set(
            cloudTransactions
              .map(tx => (typeof tx.created_at === 'string' ? tx.created_at : null))
              .filter(Boolean)
              .map(date => new Date(String(date)).toISOString().split('T')[0])
          ),
        ].sort();
        console.log('📅 [SYNC] Dates being synced:', syncedDates);

        const transactionsWithSyncStatus = cloudTransactions.map(tx => ({
          ...tx,
          synced_at: Date.now(),
        }));

        await electronAPI.localDbUpsertTransactions(transactionsWithSyncStatus);
        addLog('success', `✅ Downloaded ${cloudTransactions.length} transactions from cloud`);
      } else {
        addLog('info', 'ℹ️ No transactions to download from cloud');
      }
      
      const transactionItems = toRecordArray(data.transactionItems);
      if (transactionItems.length > 0 && electronAPI.localDbUpsertTransactionItems) {
        addLog('info', `🔄 Syncing ${transactionItems.length} transaction items to local database...`);
        await electronAPI.localDbUpsertTransactionItems(transactionItems);
        addLog('success', `✅ Downloaded ${transactionItems.length} transaction items from cloud`);
      } else {
        addLog('info', 'ℹ️ No transaction items to download from cloud');
      }

      await restorePrinterStateFromCloud(data, electronAPI, targetBusinessId);
      
      const paymentMethods = toRecordArray(data.paymentMethods);
      if (paymentMethods.length > 0 && electronAPI.localDbUpsertPaymentMethods) {
        await electronAPI.localDbUpsertPaymentMethods(paymentMethods);
        addLog('success', `✅ ${paymentMethods.length} payment methods synced to local database`);
      }
      
      const banks = toRecordArray(data.banks);
      if (banks.length > 0 && electronAPI.localDbUpsertBanks) {
        await electronAPI.localDbUpsertBanks(banks);
        addLog('success', `✅ ${banks.length} banks synced to local database`);
      }
      
      const organizations = toRecordArray(data.organizations);
      if (organizations.length > 0 && electronAPI.localDbUpsertOrganizations) {
        await electronAPI.localDbUpsertOrganizations(organizations);
        addLog('success', `✅ ${organizations.length} organizations synced to local database`);
      }
      
      const managementGroups = toRecordArray(data.managementGroups);
      if (managementGroups.length > 0 && electronAPI.localDbUpsertManagementGroups) {
        await electronAPI.localDbUpsertManagementGroups(managementGroups);
        addLog('success', `✅ ${managementGroups.length} management groups synced to local database`);
      }
      
      const clAccounts = toRecordArray(data.clAccounts);
      if (clAccounts.length > 0 && electronAPI.localDbUpsertClAccounts) {
        await electronAPI.localDbUpsertClAccounts(clAccounts);
        addLog('success', `✅ ${clAccounts.length} CL accounts synced to local database`);
      }
      
      addLog('success', '🎉 Full database sync completed successfully!');
      
      await updateSyncStatus(true);
      await fetchTransactionCounts();
    } catch (error) {
      addLog('error', `❌ Full database sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setSyncStatus(prev => ({ 
        ...prev, 
        syncInProgress: false, 
        error: error instanceof Error ? error.message : 'Sync failed' 
      }));
    }
  }, [addLog, fetchTransactionCounts, updateSyncStatus]);

  // Upload offline transactions to cloud
  const syncToCloud = useCallback(async () => {
    const electronAPI = getElectronAPI();
    if (!electronAPI?.localDbGetUnsyncedTransactions || !electronAPI?.localDbGetUnsyncedShifts) {
      addLog('error', 'Offline database not available');
      return;
    }

    setSyncStatus(prev => ({ ...prev, syncInProgress: true, error: null }));
    addLog('info', 'Starting upload of offline data to cloud...');

    try {
      // 1. Upload Shifts First
      const localShifts = await electronAPI.localDbGetUnsyncedShifts(14);
      const shifts = normalizeOfflineShifts(localShifts);
      
      if (shifts.length > 0) {
        addLog('info', `📤 Uploading ${shifts.length} shifts to cloud...`);
        
        const syncedShiftIds: number[] = [];

        for (const shift of shifts) {
          try {
            const response = await fetch(getApiUrl('/api/shifts/sync'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(shift),
            });

            if (response.ok) {
              syncedShiftIds.push(shift.id);
              addLog('success', `✅ Shift ${shift.id} uploaded successfully`);
            } else {
              addLog('warning', `⚠️ Failed to upload shift ${shift.id}: ${response.status}`);
            }
          } catch (error) {
            addLog('error', `❌ Error uploading shift ${shift.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        }

        if (syncedShiftIds.length > 0 && electronAPI.localDbMarkShiftsSynced) {
          await electronAPI.localDbMarkShiftsSynced(syncedShiftIds);
          addLog('info', `Marked ${syncedShiftIds.length} shifts as synced`);
        }
      }

      // 2. Upload Transactions
      const localTransactions = await electronAPI.localDbGetUnsyncedTransactions(14);
      const transactions = normalizeOfflineTransactions(localTransactions);
      
      if (transactions.length === 0 && shifts.length === 0) {
        addLog('info', 'ℹ️ No data to upload - proceeding to download step');
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
            product_id: item.product_id,
            quantity: item.quantity,
            unit_price: item.unit_price,
            total_price: item.total_price,
            customizations: item.customizations || undefined,
            customNote: item.custom_note ?? undefined,
          }));

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
      await loadOfflineShifts();
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
  }, [addLog, loadOfflineTransactions, loadOfflineShifts, updateSyncStatus]);

  // Full bidirectional sync
  const fullSync = useCallback(async () => {
    if (!isElectron) {
      addLog('error', 'Offline database not available');
      return;
    }

    setSyncStatus(prev => ({ ...prev, syncInProgress: true, error: null }));
    addLog('info', '🔄 Starting full bidirectional sync...');

    try {
      await syncToCloud();
      await syncFromCloud();
      
      addLog('success', '🎉 Full bidirectional sync completed!');
      setSyncProgress(100);
      
      await updateSyncStatus(true);
      await fetchTransactionCounts();
      await loadOfflineTransactions();
      await loadOfflineShifts();
      
      setTimeout(() => setSyncProgress(0), 1500);
    } catch (error) {
      addLog('error', `❌ Full sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setSyncProgress(0);
      setSyncStatus(prev => ({ 
        ...prev, 
        syncInProgress: false, 
        error: error instanceof Error ? error.message : 'Sync failed' 
      }));
    }
  }, [addLog, fetchTransactionCounts, isElectron, loadOfflineTransactions, loadOfflineShifts, syncFromCloud, syncToCloud, updateSyncStatus]);

  // Clear logs
  const clearLogs = () => {
    setSyncLogs([]);
    addLog('info', 'Logs cleared');
  };

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
        businessId: 14,
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
          body: JSON.stringify({ business_id: 14, from: dangerRange.fromIso, to: dangerRange.toIso })
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
          `⚠️ Could not archive online transactions${rangeSuffix ? ` ${rangeSuffix}` : ''}: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`
        );
      }
      
      const resetCounters = await electronAPI.localDbResetPrinterDailyCounters(14);
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

  // Generate SQL preview for delete by email
  const generateDeleteByEmailPreview = (email: string, type: 'offline' | 'online'): string => {
    const queries = [
      `-- Step 1: Get user ID from email`,
      `SELECT id FROM users WHERE email = '${email}' LIMIT 1;`,
      ``,
      `-- Step 2: Delete printer1 audit logs`,
      `DELETE FROM printer1_audit_log`,
      `WHERE transaction_id IN (`,
      `  SELECT id FROM transactions WHERE user_id = ?`,
      `);`,
      ``,
      `-- Step 3: Delete printer2 audit logs`,
      `DELETE FROM printer2_audit_log`,
      `WHERE transaction_id IN (`,
      `  SELECT id FROM transactions WHERE user_id = ?`,
      `);`,
      ``,
      `-- Step 4: Delete transaction items (foreign key constraint)`,
      `DELETE FROM transaction_items`,
      `WHERE transaction_id IN (`,
      `  SELECT id FROM transactions WHERE user_id = ?`,
      `);`,
      ``,
      `-- Step 5: Delete transactions`,
      `DELETE FROM transactions WHERE user_id = ?;`
    ];
    return queries.join('\n');
  };

  // Update preview when email changes
  const updateDeleteByEmailPreview = (email: string) => {
    if (email && email.trim()) {
      setDeleteByEmailPreview(email.trim());
    } else {
      setDeleteByEmailPreview('');
    }
  };

  // Delete transactions by user email
  const deleteTransactionsByEmail = async (userEmail: string) => {
    if (!userEmail || !userEmail.trim()) {
      addLog('error', '❌ User email is required');
      return;
    }

    const confirmed = window.confirm(
      `⚠️ WARNING: This will PERMANENTLY DELETE ALL transactions created by user "${userEmail}" from both offline and online databases.\n\n` +
      `This action CANNOT be undone!\n\n` +
      `Are you absolutely sure you want to proceed?`
    );

    if (!confirmed) {
      addLog('info', '❌ Deletion cancelled by user');
      return;
    }

    addLog('info', `🗑️ Starting deletion of all transactions for user: ${userEmail}...`);
    
    try {
      const electronAPI = getElectronAPI();
      if (!electronAPI?.localDbDeleteTransactionsByEmail) {
        addLog('error', '❌ Offline database API not available');
        return;
      }

      // Delete from offline database
      const offlineResult = await electronAPI.localDbDeleteTransactionsByEmail({ userEmail });
      
      if (offlineResult.success) {
        addLog('success', `✅ Deleted ${offlineResult.deleted} offline transactions and ${offlineResult.deletedItems || 0} transaction items for user: ${userEmail}`);
      } else {
        addLog('error', `❌ Failed to delete offline transactions: ${offlineResult.error || 'Unknown error'}`);
      }

      // Delete from online database
      try {
        const response = await fetch(getApiUrl('/api/transactions/delete-by-email'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ user_email: userEmail })
        });
        
        if (response.ok) {
          const data = await response.json();
          addLog('success', `✅ Deleted ${data.deleted || 0} online transactions for user: ${userEmail}`);
        } else {
          const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
          addLog('warning', `⚠️ Could not delete online transactions: ${errorData.error || 'Unknown error'} (may be offline)`);
        }
      } catch (error) {
        addLog('warning', `⚠️ Could not delete online transactions: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }

      addLog('success', `🎉 Deletion process completed for user: ${userEmail}`);
      await fetchTransactionCounts();
    } catch (error) {
      addLog('error', `❌ Deletion failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
        businessId: 14,
        from: dangerRange.fromIso,
        to: dangerRange.toIso
      });
      addLog('success', `✅ Deleted ${deleteCount} offline transactions permanently${rangeSuffix}`);
      
      // Delete transaction items
      const itemsResult = await electronAPI.localDbDeleteTransactionItems({
        businessId: 14,
        from: dangerRange.fromIso,
        to: dangerRange.toIso
      });
      const deletedItems = itemsResult?.deleted ?? 0;
      addLog('success', `✅ Deleted ${deletedItems} offline transaction items`);
      
      // Delete from online database
      try {
        const response = await fetch(getApiUrl('/api/transactions/delete'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ business_id: 14, from: dangerRange.fromIso, to: dangerRange.toIso })
        });
        
        if (response.ok) {
          const data = await response.json();
          addLog('success', `✅ Deleted ${data.deleted} online transactions permanently${rangeSuffix}`);
        } else {
          addLog('warning', '⚠️ Could not delete online transactions (may be offline)');
        }
      } catch (error) {
        addLog(
          'warning',
          `⚠️ Could not delete online transactions${rangeSuffix ? ` ${rangeSuffix}` : ''}: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`
        );
      }
      
      const resetCounters = await electronAPI.localDbResetPrinterDailyCounters(14);
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
      setGatePasswordInput('');
    }
  };

  // Fetch transaction counts
  // Find orphaned transactions (exist offline but not online, even if marked as synced)
  const findOrphanedTransactions = useCallback(async () => {
    const electronAPI = getElectronAPI();
    if (!electronAPI?.localDbGetTransactions) {
      addLog('error', 'Offline database not available');
      return;
    }

    addLog('info', '🔍 Searching for orphaned transactions...');
    
    try {
      const allOfflineTransactionsRaw = await electronAPI.localDbGetTransactions(14, 10000);
      const allOfflineTransactions = normalizeOfflineTransactions(allOfflineTransactionsRaw);
      
      let onlineTransactionIds: string[] = [];
      try {
        const response = await fetch(getApiUrl('/api/transactions?business_id=14&limit=10000'));
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
  }, [addLog]);

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
      for (const id of orphanedIds) {
        await electronAPI.localDbResetTransactionSync(id);
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
    updateSyncStatus(false);
    loadOfflineTransactions();
    loadOfflineShifts();
    fetchTransactionCounts();
    addLog('info', 'Sync management initialized');
    setIsInitialized(true);
  }, [addLog, fetchTransactionCounts, isInitialized, loadOfflineTransactions, loadOfflineShifts, updateSyncStatus]);

  const formatLastSync = (lastSync: string | null) => {
    if (!lastSync) return 'Belum pernah';
    const date = new Date(lastSync);
    return date.toLocaleString('id-ID', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

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
    const clauses: string[] = [`${prefix}business_id = 14`];
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
  }, [dangerRange.fromIso, dangerRange.toIso]);

  const UPDATED_AT_PLACEHOLDER = '<current_epoch_ms>';

  const offlineArchivePreview = useMemo(() => {
    const baseWhere = buildSqlWherePreview('', "status != 'archived'");
    const archivedWhere = buildSqlWherePreview('', "status = 'archived'");
    return `UPDATE transactions
SET status = 'archived', updated_at = ${UPDATED_AT_PLACEHOLDER}
WHERE ${baseWhere};

-- Purge local printer audits for archived transactions
DELETE FROM printer1_audit_log
WHERE transaction_id IN (
  SELECT id FROM transactions
  WHERE ${archivedWhere}
);

DELETE FROM printer2_audit_log
WHERE transaction_id IN (
  SELECT id FROM transactions
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
    return `-- Delete local printer audits first
DELETE FROM printer1_audit_log
WHERE transaction_id IN (
  SELECT id FROM transactions
  WHERE ${baseWhere}
);

DELETE FROM printer2_audit_log
WHERE transaction_id IN (
  SELECT id FROM transactions
  WHERE ${baseWhere}
);

-- Then delete items and transactions
DELETE FROM transaction_items
WHERE transaction_id IN (
  SELECT id FROM transactions
  WHERE ${baseWhere}
);

DELETE FROM transactions
WHERE ${baseWhere};`;
  }, [buildSqlWherePreview]);

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
    <div className="flex-1 flex flex-col bg-white h-full relative">
      {/* Floating Danger Zone Button - Bottom Right */}
      <button
        onClick={() => setShowGatePasswordModal(true)}
        className="fixed bottom-4 right-4 z-40 flex items-center justify-center w-8 h-8 bg-red-600 text-white rounded-full hover:bg-red-700 transition-colors shadow-lg hover:shadow-xl"
        title="Danger Zone"
      >
        <AlertTriangle className="w-3.5 h-3.5" />
      </button>

      <div className="flex-1 flex flex-col max-w-7xl mx-auto w-full px-6 py-6">
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
            <div className="flex gap-3">
              <button
                onClick={fullSync}
                disabled={syncStatus.syncInProgress}
                className={`
                  flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-medium transition-all text-sm
                  ${syncStatus.syncInProgress 
                    ? 'bg-gray-400 text-white cursor-not-allowed' 
                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                  }
                `}
              >
                {syncStatus.syncInProgress ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Syncing...</span>
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4" />
                    <span>Sinkronisasi Lengkap</span>
                  </>
                )}
              </button>

              <button
                onClick={loadOfflineTransactions}
                disabled={isLoadingOfflineData}
                className="flex items-center justify-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed text-sm"
                title="Refresh Data"
              >
                <RefreshCw className="w-4 h-4" />
              </button>

              <button
                onClick={findOrphanedTransactions}
                className="flex items-center justify-center gap-2 px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg transition-colors text-sm"
                title="Find Missing Transactions"
              >
                <AlertTriangle className="w-4 h-4" />
                <span>Cari Transaksi Hilang</span>
              </button>
            </div>
          </div>
        </div>

        {/* Sync Progress Bar */}
        {syncStatus.syncInProgress && (
          <div className="mb-6">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-700">Sinkronisasi sedang berlangsung...</span>
                <span className="text-sm font-semibold text-blue-600">{syncProgress}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${syncProgress}%` }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Connection Status */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <div className="flex items-center gap-2 mb-2">
              {syncStatus.isOnline ? (
                <Cloud className="w-5 h-5 text-green-600" />
              ) : (
                <CloudOff className="w-5 h-5 text-red-600" />
              )}
              <h3 className="font-semibold text-gray-900">Status Koneksi</h3>
            </div>
            <div className="text-sm text-gray-600">
              <div>Status: <span className={syncStatus.isOnline ? 'text-green-600' : 'text-red-600'}>{syncStatus.isOnline ? 'Online' : 'Offline'}</span></div>
              <div>Terakhir sinkronisasi: {formatLastSync(syncStatus.lastSync)}</div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="w-5 h-5 text-blue-600" />
              <h3 className="font-semibold text-gray-900">Transaksi Tertunda</h3>
            </div>
            <div className="text-sm text-gray-600">
              <div>Jumlah: <span className="font-medium">{syncStatus.pendingTransactions}</span></div>
              <div>Status: {syncStatus.syncInProgress ? 'Sinkronisasi...' : 'Siap sinkronisasi'}</div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <div className="flex items-center gap-2 mb-2">
              <Activity className="w-5 h-5 text-purple-600" />
              <h3 className="font-semibold text-gray-900">Aktivitas Terakhir</h3>
            </div>
            <div className="text-sm text-gray-600">
              <div>Log entries: <span className="font-medium">{syncLogs.length}</span></div>
              <div>Offline transactions: <span className="font-medium">{offlineTransactions.length}</span></div>
              <div>Offline shifts: <span className="font-medium">{offlineShifts.length}</span></div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <div className="flex items-center gap-2 mb-2">
              <Activity className="w-5 h-5 text-indigo-600" />
              <h3 className="font-semibold text-gray-900">Smart Sync</h3>
            </div>
            <div className="text-sm text-gray-600">
              {smartSyncStatus ? (
                <>
                  <div>
                    Status:{' '}
                    <span className={smartSyncStatus.isSyncing ? 'text-blue-600' : 'text-green-600'}>
                      {smartSyncStatus.isSyncing
                        ? 'Syncing'
                        : smartSyncStatus.consecutiveFailures > 0
                          ? `${smartSyncStatus.consecutiveFailures} fails`
                          : 'Ready'}
                    </span>
                  </div>
                  <div>
                    Avg load:{' '}
                    <span
                      className={
                        smartSyncStatus.averageServerLoad > 1000
                          ? 'text-red-600'
                          : smartSyncStatus.averageServerLoad > 500
                            ? 'text-yellow-600'
                            : 'text-green-600'
                      }
                    >
                      {Math.round(smartSyncStatus.averageServerLoad)} ms
                    </span>
                  </div>
                </>
              ) : (
                <div className="text-gray-500">Belum ada data</div>
              )}
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

        {/* Sync Logs */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
              <Activity className="w-5 h-5" />
              Log Sinkronisasi
            </h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowLogs(!showLogs)}
                className="flex items-center gap-1 px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded transition-colors"
              >
                {showLogs ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                <span>{showLogs ? 'Sembunyikan' : 'Tampilkan'}</span>
              </button>
              <button
                onClick={clearLogs}
                className="flex items-center gap-1 px-3 py-1 text-sm bg-red-100 hover:bg-red-200 text-red-700 rounded transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                <span>Hapus Log</span>
              </button>
            </div>
          </div>

          {showLogs && (
            <div className="max-h-64 overflow-y-auto border border-gray-200 rounded-lg">
              {syncLogs.length === 0 ? (
                <div className="p-4 text-center text-gray-500">
                  Belum ada log sinkronisasi
                </div>
              ) : (
                <div className="space-y-1 p-2">
                  {syncLogs.map((log) => (
                    <div key={log.id} className={`p-2 rounded text-sm ${getLogColor(log.type)}`}>
                      <div className="flex items-center gap-2">
                        {getLogIcon(log.type)}
                        <span className="font-medium">
                          {log.timestamp.toLocaleTimeString('id-ID')}
                        </span>
                        <span>{log.message}</span>
                      </div>
                      {log.details != null && (
                        <div className="mt-1 ml-6 text-xs opacity-75">
                          {JSON.stringify(log.details)}
                        </div>
                      )}
                    </div>
                  ))}
                  <div ref={logsEndRef} />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Offline Transactions */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
              <Database className="w-5 h-5" />
              Data Offline yang Akan Diunggah
            </h2>
            <button
              onClick={() => setShowOfflineData(!showOfflineData)}
              className="flex items-center gap-1 px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded transition-colors"
            >
              {showOfflineData ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              <span>{showOfflineData ? 'Sembunyikan' : 'Tampilkan'}</span>
            </button>
          </div>

          {showOfflineData && (
            <div className="max-h-64 overflow-y-auto border border-gray-200 rounded-lg">
              {isLoadingOfflineData ? (
                <div className="p-4 text-center text-gray-500">
                  <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
                  Memuat data offline...
                </div>
              ) : offlineTransactions.length === 0 ? (
                <div className="p-4 text-center text-gray-500">
                  Tidak ada transaksi offline
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-gray-700">#</th>
                        <th className="px-3 py-2 text-center font-medium text-gray-700">UUID</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-700">Tanggal</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-700">Customer</th>
                        <th className="px-3 py-2 text-center font-medium text-gray-700">CU</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-700">Metode</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-700">Total</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-700">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {offlineTransactions.map((transaction) => (
                        <tr key={transaction.id} className="hover:bg-gray-50">
                          <td className="px-3 py-2 font-medium text-blue-600">
                            #{transaction.receipt_number || 'N/A'}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <button
                              onClick={() => {
                                handleCopyUuid(String(transaction.id));
                              }}
                              className="p-1 hover:bg-gray-200 rounded transition-colors"
                              title={`Copy UUID: ${String(transaction.id)}`}
                            >
                              <svg className="w-4 h-4 text-gray-500 hover:text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                              </svg>
                            </button>
                          </td>
                          <td className="px-3 py-2 text-gray-600">
                            {new Date(transaction.created_at).toLocaleString('id-ID')}
                          </td>
                          <td className="px-3 py-2 text-gray-600">
                            {transaction.customer_name || 'Guest'}
                          </td>
                          <td className="px-3 py-2 text-center text-gray-700">
                            {transaction.customer_unit ?? '-'}
                          </td>
                          <td className="px-3 py-2">
                            <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800">
                              {transaction.payment_method}
                            </span>
                          </td>
                          <td className="px-3 py-2 font-medium text-gray-900">
                            {formatPrice(transaction.final_amount)}
                          </td>
                          <td className="px-3 py-2">
                            <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                              transaction.status === 'completed' 
                                ? 'bg-green-100 text-green-800' 
                                : 'bg-yellow-100 text-yellow-800'
                            }`}>
                              {transaction.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
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
                              {new Date(transaction.created_at).toLocaleString('id-ID')}
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
                              {formatPrice(transaction.final_amount)}
                            </td>
                            <td className="px-3 py-2">
                              <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                                transaction.status === 'completed' 
                                  ? 'bg-green-100 text-green-800' 
                                  : 'bg-yellow-100 text-yellow-800'
                              }`}>
                                {transaction.status}
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
                type="password"
                value={gatePasswordInput}
                onChange={(e) => setGatePasswordInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    if (gatePasswordInput === 'magnumopus2761') {
                      setShowGatePasswordModal(false);
                      setGatePasswordInput('');
                      setShowDangerZone(true);
                    } else {
                      addLog('error', '❌ Incorrect password');
                      setGatePasswordInput('');
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
                  setGatePasswordInput('');
                }}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (gatePasswordInput === 'magnumopus2761') {
                    setShowGatePasswordModal(false);
                    setGatePasswordInput('');
                    setShowDangerZone(true);
                  } else {
                    addLog('error', '❌ Incorrect password');
                    setGatePasswordInput('');
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
                ? 'This will PERMANENTLY DELETE all transactions in both online and offline databases. This action CANNOT be undone.'
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
                  : 'This will archive all transactions for business ID 14. Archived transactions will be hidden from the transaction list but preserved.'}
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
                    ? `Transactions for business ID 14 between ${rangeDescription}`
                    : 'All transactions for business ID 14'}
                </li>
                <li>All transaction items</li>
                <li>Data in both online and offline databases</li>
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
          <div className="bg-white rounded-lg shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
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

              {/* Range Filters */}
              <div className="mb-6">
                <h4 className="font-semibold text-gray-900 mb-3">Filter by Transaction Date</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="flex flex-col text-sm text-gray-700">
                    <span className="mb-1">From (created_at)</span>
                    <input
                      type="datetime-local"
                      value={dangerFrom}
                      onChange={(e) => setDangerFrom(e.target.value)}
                      className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent text-black"
                    />
                  </label>
                  <label className="flex flex-col text-sm text-gray-700">
                    <span className="mb-1">To (created_at)</span>
                    <input
                      type="datetime-local"
                      value={dangerTo}
                      onChange={(e) => setDangerTo(e.target.value)}
                      className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent text-black"
                    />
                  </label>
                </div>
                <div className="flex items-center gap-3 mt-3">
                  <button
                    onClick={() => {
                      setDangerFrom('');
                      setDangerTo('');
                    }}
                    className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-100 transition-colors"
                  >
                    Reset Range
                  </button>
                  <span className="text-xs text-gray-600">
                    Leave both fields blank to target all dates. Range applies to transaction <code>created_at</code>.
                  </span>
                </div>
                <div className="mt-2 text-xs text-gray-500">
                  Target range: <span className="font-medium text-gray-700">{rangeDescription}</span>
                </div>
              </div>

              {/* Delete by User Email Section */}
              <div className="mb-6 border-t border-gray-200 pt-6">
                <h4 className="font-semibold text-gray-900 mb-3">Delete Transactions by User Email</h4>
                <p className="text-sm text-gray-600 mb-4">
                  Permanently delete ALL transactions created by a specific user from both offline and online databases.
                </p>
                <div className="flex gap-3">
                  <input
                    type="email"
                    id="deleteUserEmail"
                    placeholder="marviano.austin@gmail.com"
                    defaultValue="marviano.austin@gmail.com"
                    onChange={(e) => {
                      const email = e.target.value.trim();
                      updateDeleteByEmailPreview(email);
                    }}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent text-black"
                  />
                  <button
                    onClick={() => {
                      const emailInput = document.getElementById('deleteUserEmail') as HTMLInputElement;
                      const email = emailInput?.value?.trim();
                      if (email) {
                        deleteTransactionsByEmail(email);
                      } else {
                        addLog('error', '❌ Please enter a user email');
                      }
                    }}
                    className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium"
                  >
                    Delete by Email
                  </button>
                </div>
                <p className="text-xs text-red-600 mt-2">
                  ⚠️ This action cannot be undone. All transactions, transaction items, and audit logs for this user will be permanently deleted.
                </p>
                
                {/* SQL Query Preview */}
                {deleteByEmailPreview && (
                  <div className="mt-4 bg-gradient-to-r from-red-50 to-orange-50 rounded-lg p-4 border border-red-200">
                    <h5 className="font-semibold text-gray-900 mb-3">SQL Queries to be Executed:</h5>
                    <div className="bg-white p-3 rounded border border-red-300 font-mono text-xs overflow-x-auto">
                      <div className="text-red-700 mb-2 font-semibold">-- Offline SQLite:</div>
                      <pre className="text-red-900 whitespace-pre-wrap mb-4">{generateDeleteByEmailPreview(deleteByEmailPreview, 'offline')}</pre>
                      <div className="text-red-700 mb-2 font-semibold border-t border-red-200 pt-2">-- Online MySQL:</div>
                      <pre className="text-red-900 whitespace-pre-wrap">{generateDeleteByEmailPreview(deleteByEmailPreview, 'online')}</pre>
                    </div>
                  </div>
                )}
              </div>

              {/* Information Box */}
              <div className="bg-gradient-to-r from-red-50 to-orange-50 rounded-lg p-4 border border-red-200 mb-6">
                <h4 className="font-semibold text-gray-900 mb-3">SQL Queries to be Executed:</h4>
                <div className="space-y-4 text-xs">
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <CheckCircle className="w-4 h-4 text-orange-600" />
                      <strong className="text-gray-900">Archive (Keeps Data):</strong>
                    </div>
                    <div className="bg-white p-2 rounded border border-orange-200 font-mono text-xs overflow-x-auto">
                      <div className="text-orange-700">-- Offline SQLite:</div>
                      <pre className="text-gray-800 whitespace-pre-wrap">{offlineArchivePreview}</pre>
                      <div className="text-orange-700 mt-2">-- Online MySQL:</div>
                      <pre className="text-gray-800 whitespace-pre-wrap">{onlineArchivePreview}</pre>
                    </div>
                  </div>
                  <div className="border-t border-red-200 pt-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Trash2 className="w-4 h-4 text-red-600" />
                      <strong className="text-red-900">Delete (Permanent):</strong>
                    </div>
                    <div className="bg-white p-2 rounded border border-red-300 font-mono text-xs overflow-x-auto">
                      <div className="text-red-700">-- Offline SQLite:</div>
                      <pre className="text-red-900 whitespace-pre-wrap">{offlineDeletePreview}</pre>
                      <div className="text-red-700 mt-2">-- Online MySQL:</div>
                      <pre className="text-red-900 whitespace-pre-wrap">{onlineDeletePreview}</pre>
                    </div>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="space-y-3">
                <button
                  onClick={handleArchiveClick}
                  className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors font-medium"
                >
                  <Archive className="w-5 h-5" />
                  Archive Matching Transactions
                </button>
                
                <button
                  onClick={handleDeleteClick}
                  className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium"
                >
                  <Trash2 className="w-5 h-5" />
                  Delete Matching Transactions (Permanent)
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
