'use client';

import React, { useState, useCallback } from 'react';
import { RefreshCw, Cloud, CloudOff, AlertCircle, Upload, Download } from 'lucide-react';
import { offlineSyncService } from '@/lib/offlineSync';
import { smartSyncService } from '@/lib/smartSync';
import { getApiUrl } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';

type UnknownRecord = Record<string, unknown>;
type TransactionRow = UnknownRecord & { id?: number | string; synced_at?: number | null };
const isUnknownRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null;

const toUnknownRecordArray = (value: unknown): UnknownRecord[] =>
  Array.isArray(value) ? value.filter(isUnknownRecord) : [];

const toTransactionRows = (value: unknown): TransactionRow[] =>
  toUnknownRecordArray(value).map((row) => row as TransactionRow);

const getElectronAPI = () => (typeof window !== 'undefined' ? window.electronAPI : undefined);

const getNumericTransactionId = (transaction: TransactionRow): number | undefined => {
  if (typeof transaction.id === 'number' && Number.isFinite(transaction.id)) {
    return transaction.id;
  }
  if (typeof transaction.id === 'string') {
    const parsed = Number(transaction.id);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

interface SyncStatus {
  isOnline: boolean;
  lastSync: number | null;
  pendingTransactions: number;
  syncInProgress: boolean;
  error: string | null;
}

interface SyncButtonProps {
  className?: string;
  showDetails?: boolean;
}

export default function SyncButton({ className = '', showDetails = true }: SyncButtonProps) {
  const { user } = useAuth();

  // Get business ID from logged-in user (fallback to 14 for backward compatibility)
  const businessId = user?.selectedBusinessId ?? 14;

  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    isOnline: true,
    lastSync: null,
    pendingTransactions: 0,
    syncInProgress: false,
    error: null
  });

  // Check if we're in Electron environment
  const isElectron = typeof window !== 'undefined' && Boolean(window.electronAPI);

  // Get current sync status
  const getSyncStatus = useCallback(async (): Promise<SyncStatus> => {
    try {
      const connectionStatus = offlineSyncService.getDetailedStatus();
      const pendingCount = await smartSyncService.getPendingTransactionCount();

      return {
        isOnline: connectionStatus.isOnline,
        lastSync: connectionStatus.lastSyncTime ?? null,
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
  const updateSyncStatus = useCallback(async () => {
    const status = await getSyncStatus();
    setSyncStatus(status);
  }, [getSyncStatus]);

  // Full database sync (Download from cloud)
  const syncFromCloud = async () => {
    if (!isElectron) {
      setSyncStatus(prev => ({ ...prev, error: 'Offline database not available' }));
      return;
    }

    setSyncStatus(prev => ({ ...prev, syncInProgress: true, error: null }));

    try {
      console.log('🔄 [SYNC] Starting full database sync from cloud...');

      // Get all data from cloud
      const response = await fetch(getApiUrl('/api/sync'));
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const jsonData = await response.json();
      const data = (jsonData.data || jsonData) as Record<string, unknown>;
      // const targetBusinessId = Number(jsonData.businessId ?? 14);
      const describeLength = (value: unknown) => (Array.isArray(value) ? value.length : 0);
      console.log('📥 [SYNC] Received data from cloud:', {
        products: describeLength(data.products),
        transactions: describeLength(data.transactions),
        paymentMethods: describeLength(data.paymentMethods),
        banks: describeLength(data.banks),
        organizations: describeLength(data.organizations),
        managementGroups: describeLength(data.managementGroups),
        category1: describeLength(data.category1),
        category2: describeLength(data.category2),
        clAccounts: describeLength(data.clAccounts),
        bundleItems: describeLength(data.bundleItems)
      });

      // Save to local database
      const electronAPI = getElectronAPI();
      if (!electronAPI) {
        throw new Error('Electron API not available');
      }

      const products = toUnknownRecordArray(data.products);
      if (products.length > 0 && electronAPI.localDbUpsertProducts) {
        await electronAPI.localDbUpsertProducts(products);
        console.log(`✅ ${products.length} products synced to local database`);
      }

      const bundleItems = toUnknownRecordArray(data.bundleItems);
      if (bundleItems.length > 0 && electronAPI.localDbUpsertBundleItems) {
        await electronAPI.localDbUpsertBundleItems(bundleItems);
        console.log(`✅ ${bundleItems.length} bundle items synced to local database`);
      }

      const transactions = toTransactionRows(data.transactions);
      if (transactions.length > 0 && electronAPI.localDbUpsertTransactions) {
        // Mark downloaded transactions as already synced (they came from cloud)
        const transactionsWithSyncStatus = transactions.map((tx) => ({
          ...tx,
          synced_at: Date.now()
        }));
        await electronAPI.localDbUpsertTransactions(transactionsWithSyncStatus);
        console.log(`✅ ${transactions.length} transactions synced to local database`);
      }

      const paymentMethods = toUnknownRecordArray(data.paymentMethods);
      if (paymentMethods.length > 0 && electronAPI.localDbUpsertPaymentMethods) {
        await electronAPI.localDbUpsertPaymentMethods(paymentMethods);
        console.log(`✅ ${paymentMethods.length} payment methods synced to local database`);
      }

      const banks = toUnknownRecordArray(data.banks);
      if (banks.length > 0 && electronAPI.localDbUpsertBanks) {
        await electronAPI.localDbUpsertBanks(banks);
        console.log(`✅ ${banks.length} banks synced to local database`);
      }

      const organizations = toUnknownRecordArray(data.organizations);
      if (organizations.length > 0 && electronAPI.localDbUpsertOrganizations) {
        await electronAPI.localDbUpsertOrganizations(organizations);
        console.log(`✅ ${organizations.length} organizations synced to local database`);
      }

      const managementGroups = toUnknownRecordArray(data.managementGroups);
      if (managementGroups.length > 0 && electronAPI.localDbUpsertManagementGroups) {
        await electronAPI.localDbUpsertManagementGroups(managementGroups);
        console.log(`✅ ${managementGroups.length} management groups synced to local database`);
      }

      const category1 = toUnknownRecordArray(data.category1);
      if (category1.length > 0 && electronAPI.localDbUpsertCategory1) {
        await electronAPI.localDbUpsertCategory1(category1);
        console.log(`✅ ${category1.length} category1 synced to local database`);
      }

      const category2 = toUnknownRecordArray(data.category2);
      if (category2.length > 0 && electronAPI.localDbUpsertCategory2) {
        // Get junction table data (REQUIRED - junction table only, no business_id column)
        const junctionTableData = (data.category2Businesses as Array<{ category2_id: number; business_id: number }> | undefined) || undefined;
        if (!junctionTableData || junctionTableData.length === 0) {
          console.warn(`⚠️ [SYNC] No junction table data provided for category2 - skipping sync`);
        } else {
          await (electronAPI.localDbUpsertCategory2 as (rows: unknown[], junctionData?: Array<{ category2_id: number; business_id: number }>) => Promise<{ success: boolean }>)(category2, junctionTableData);
          console.log(`✅ ${category2.length} category2 synced to local database with ${junctionTableData.length} business relationships`);
        }
      }

      const clAccounts = toUnknownRecordArray(data.clAccounts);
      if (clAccounts.length > 0 && electronAPI.localDbUpsertClAccounts) {
        await electronAPI.localDbUpsertClAccounts(clAccounts);
        console.log(`✅ ${clAccounts.length} CL accounts synced to local database`);
      }

      // Printer audits/counters are local source of truth - not downloaded from server

      console.log('🎉 [SYNC] Full database sync completed successfully!');

      // Update status
      await updateSyncStatus();

      // Show success message
      alert('✅ Database berhasil disinkronkan dari cloud!\n\nSemua data terbaru telah diunduh ke database lokal.');

    } catch (error) {
      console.error('❌ [SYNC] Full database sync failed:', error);
      setSyncStatus(prev => ({
        ...prev,
        syncInProgress: false,
        error: error instanceof Error ? error.message : 'Sync failed'
      }));
      alert(`❌ Gagal menyinkronkan database: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  // Upload offline transactions to cloud
  const syncToCloud = async () => {
    if (!isElectron) {
      setSyncStatus(prev => ({ ...prev, error: 'Offline database not available' }));
      return;
    }

    setSyncStatus(prev => ({ ...prev, syncInProgress: true, error: null }));

    try {
      console.log('🔄 [SYNC] Starting upload of offline transactions to cloud...');

      // Get pending transactions from local database
      const electronAPI = getElectronAPI();
      if (!electronAPI) {
        throw new Error('Electron API not available');
      }

      let transactionsToUpload: TransactionRow[] = [];
      if (electronAPI.localDbGetUnsyncedTransactions) {
        const rows = await electronAPI.localDbGetUnsyncedTransactions(businessId);
        transactionsToUpload = toTransactionRows(rows);
      } else if (electronAPI.localDbGetTransactions) {
        const localTransactions = await electronAPI.localDbGetTransactions(businessId, 1000);
        transactionsToUpload = toTransactionRows(localTransactions);
      }

      if (transactionsToUpload.length === 0) {
        console.log('ℹ️ [SYNC] No transactions to upload - proceeding to download step');
        await updateSyncStatus();
        return; // Return early but don't fail - allows download step to proceed
      }

      console.log(`📤 [SYNC] Uploading ${transactionsToUpload.length} transactions to cloud...`);

      // Upload transactions to cloud
      for (const transaction of transactionsToUpload) {
        try {
          const response = await fetch(getApiUrl('/api/transactions'), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(transaction),
          });

          if (response.ok) {
            console.log(`✅ Transaction ${transaction.id ?? 'unknown'} uploaded successfully`);
            const transactionId = getNumericTransactionId(transaction);
            if (transactionId !== undefined && electronAPI.localDbMarkTransactionsSyncedByIds) {
              await electronAPI.localDbMarkTransactionsSyncedByIds([transactionId]);
            }
          } else {
            console.warn(`⚠️ Failed to upload transaction ${transaction.id}: ${response.status}`);
          }
        } catch (error) {
          console.error(`❌ Error uploading transaction ${transaction.id}:`, error);
        }
      }

      console.log('🎉 [SYNC] Offline transactions upload completed!');

      // Also sync printer audit logs
      try {
        await offlineSyncService.syncPrinterAudits();
        console.log('✅ [SYNC] Printer audit logs synced');
      } catch (error) {
        console.warn('⚠️ [SYNC] Printer audit sync failed:', error);
      }

      // Update status
      await updateSyncStatus();

      // Show success message
      alert(`✅ ${transactionsToUpload.length} transaksi offline berhasil diunggah ke cloud!\n\nSemua transaksi lokal telah disinkronkan.`);

    } catch (error) {
      console.error('❌ [SYNC] Upload to cloud failed:', error);
      setSyncStatus(prev => ({
        ...prev,
        syncInProgress: false,
        error: error instanceof Error ? error.message : 'Upload failed'
      }));
      alert(`❌ Gagal mengunggah transaksi offline: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  // Full bidirectional sync
  const fullSync = async () => {
    if (!isElectron) {
      setSyncStatus(prev => ({ ...prev, error: 'Offline database not available' }));
      return;
    }

    setSyncStatus(prev => ({ ...prev, syncInProgress: true, error: null }));

    try {
      console.log('🔄 [SYNC] Starting full bidirectional sync...');

      // Step 1: Upload offline transactions to cloud
      await syncToCloud();

      // Step 2: Download latest data from cloud
      await syncFromCloud();

      console.log('🎉 [SYNC] Full bidirectional sync completed!');

      // Update status
      await updateSyncStatus();
      setSyncStatus(prev => ({ ...prev, syncInProgress: false }));

      alert('✅ Sinkronisasi lengkap berhasil!\n\n• Transaksi offline telah diunggah ke cloud\n• Data terbaru telah diunduh dari cloud');

    } catch (error) {
      console.error('❌ [SYNC] Full sync failed:', error);
      setSyncStatus(prev => ({
        ...prev,
        syncInProgress: false,
        error: error instanceof Error ? error.message : 'Sync failed'
      }));
      alert(`❌ Gagal melakukan sinkronisasi lengkap: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  // Initialize sync status on component mount
  React.useEffect(() => {
    updateSyncStatus();
  }, [updateSyncStatus]);

  const formatLastSync = (lastSync: number | null) => {
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

  return (
    <div className={`sync-button-container ${className}`}>
      {/* Main Sync Button */}
      <div className="flex flex-col gap-2">
        <button
          onClick={fullSync}
          disabled={syncStatus.syncInProgress}
          className={`
            flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-medium transition-all
            ${syncStatus.syncInProgress
              ? 'bg-gray-400 text-white cursor-not-allowed'
              : 'bg-blue-600 hover:bg-blue-700 text-white'
            }
          `}
        >
          {syncStatus.syncInProgress ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>Sinkronisasi...</span>
            </>
          ) : (
            <>
              <RefreshCw className="w-4 h-4" />
              <span>Sinkronisasi Lengkap</span>
            </>
          )}
        </button>

        {/* Individual Sync Buttons */}
        <div className="flex gap-2">
          <button
            onClick={syncFromCloud}
            disabled={syncStatus.syncInProgress}
            className="flex items-center gap-1 px-3 py-1 text-xs bg-green-600 hover:bg-green-700 text-white rounded transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            <Download className="w-3 h-3" />
            <span>Download</span>
          </button>

          <button
            onClick={syncToCloud}
            disabled={syncStatus.syncInProgress}
            className="flex items-center gap-1 px-3 py-1 text-xs bg-orange-600 hover:bg-orange-700 text-white rounded transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            <Upload className="w-3 h-3" />
            <span>Upload</span>
          </button>
        </div>
      </div>

      {/* Sync Status Details */}
      {showDetails && (
        <div className="mt-4 p-3 bg-gray-50 rounded-lg text-xs">
          <div className="flex items-center gap-2 mb-2">
            {syncStatus.isOnline ? (
              <Cloud className="w-4 h-4 text-green-600" />
            ) : (
              <CloudOff className="w-4 h-4 text-red-600" />
            )}
            <span className="font-medium">
              Status: {syncStatus.isOnline ? 'Online' : 'Offline'}
            </span>
          </div>

          <div className="space-y-1 text-gray-600">
            <div>Terakhir sinkronisasi: {formatLastSync(syncStatus.lastSync)}</div>
            <div>Transaksi tertunda: {syncStatus.pendingTransactions}</div>

            {syncStatus.error && (
              <div className="flex items-center gap-1 text-red-600">
                <AlertCircle className="w-3 h-3" />
                <span>{syncStatus.error}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
