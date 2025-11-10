'use client';

import React, { useState } from 'react';
import { RefreshCw, Cloud, CloudOff, CheckCircle, AlertCircle, Upload, Download } from 'lucide-react';
import { offlineSyncService } from '@/lib/offlineSync';
import { smartSyncService } from '@/lib/smartSync';
import { restorePrinterStateFromCloud } from '@/lib/printerSyncUtils';

interface SyncStatus {
  isOnline: boolean;
  lastSync: string | null;
  pendingTransactions: number;
  syncInProgress: boolean;
  error: string | null;
}

interface SyncButtonProps {
  className?: string;
  showDetails?: boolean;
}

export default function SyncButton({ className = '', showDetails = true }: SyncButtonProps) {
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    isOnline: true,
    lastSync: null,
    pendingTransactions: 0,
    syncInProgress: false,
    error: null
  });

  // Check if we're in Electron environment
  const isElectron = typeof window !== 'undefined' && (window as any).electronAPI;

  // Get current sync status
  const getSyncStatus = async (): Promise<SyncStatus> => {
    try {
      const connectionStatus = offlineSyncService.getDetailedStatus();
      const pendingCount = await smartSyncService.getPendingTransactionCount();
      
      return {
        isOnline: connectionStatus.isOnline,
        lastSync: connectionStatus.lastSyncTime || null,
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
  };

  // Update sync status
  const updateSyncStatus = async () => {
    const status = await getSyncStatus();
    setSyncStatus(status);
  };

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
      const response = await fetch('/api/sync');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const jsonData = await response.json();
      const data = jsonData.data || jsonData; // Support both response structures
      const targetBusinessId = Number(jsonData.businessId ?? 14);
      console.log('📥 [SYNC] Received data from cloud:', {
        products: data.products?.length || 0,
        transactions: data.transactions?.length || 0,
        paymentMethods: data.paymentMethods?.length || 0,
        banks: data.banks?.length || 0,
        organizations: data.organizations?.length || 0,
        managementGroups: data.managementGroups?.length || 0,
        category1: data.category1?.length || 0,
        category2: data.category2?.length || 0,
        clAccounts: data.clAccounts?.length || 0,
        bundleItems: data.bundleItems?.length || 0,
        omset: data.omset?.length || 0
      });

      // Save to local database
      const electronAPI = (window as any).electronAPI;
      
      if (data.products && data.products.length > 0) {
        await electronAPI.localDbUpsertProducts(data.products);
        console.log(`✅ ${data.products.length} products synced to local database`);
      }
      
      if (data.bundleItems && data.bundleItems.length > 0) {
        await electronAPI.localDbUpsertBundleItems(data.bundleItems);
        console.log(`✅ ${data.bundleItems.length} bundle items synced to local database`);
      }
      
      if (data.transactions && data.transactions.length > 0) {
        // Mark downloaded transactions as already synced (they came from cloud)
        const transactionsWithSyncStatus = data.transactions.map((tx: any) => ({
          ...tx,
          synced_at: Date.now() // Already in cloud, so mark as synced
        }));
        await electronAPI.localDbUpsertTransactions(transactionsWithSyncStatus);
        console.log(`✅ ${data.transactions.length} transactions synced to local database`);
      }
      
      if (data.paymentMethods && data.paymentMethods.length > 0) {
        await electronAPI.localDbUpsertPaymentMethods(data.paymentMethods);
        console.log(`✅ ${data.paymentMethods.length} payment methods synced to local database`);
      }
      
      if (data.banks && data.banks.length > 0) {
        await electronAPI.localDbUpsertBanks(data.banks);
        console.log(`✅ ${data.banks.length} banks synced to local database`);
      }
      
      if (data.organizations && data.organizations.length > 0) {
        await electronAPI.localDbUpsertOrganizations(data.organizations);
        console.log(`✅ ${data.organizations.length} organizations synced to local database`);
      }
      
      if (data.managementGroups && data.managementGroups.length > 0) {
        await electronAPI.localDbUpsertManagementGroups(data.managementGroups);
        console.log(`✅ ${data.managementGroups.length} management groups synced to local database`);
      }
      
      if (data.category1 && data.category1.length > 0) {
        await electronAPI.localDbUpsertCategory1(data.category1);
        console.log(`✅ ${data.category1.length} category1 synced to local database`);
      }
      
      if (data.category2 && data.category2.length > 0) {
        await electronAPI.localDbUpsertCategory2(data.category2);
        console.log(`✅ ${data.category2.length} category2 synced to local database`);
      }
      
      if (data.clAccounts && data.clAccounts.length > 0) {
        await electronAPI.localDbUpsertClAccounts(data.clAccounts);
        console.log(`✅ ${data.clAccounts.length} CL accounts synced to local database`);
      }

      await restorePrinterStateFromCloud(data, electronAPI, targetBusinessId);
      
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
      const electronAPI = (window as any).electronAPI;
      const localTransactions = await electronAPI.localDbGetTransactions(1, 1000); // Get all transactions
      
      // Filter transactions that might not be on cloud (you can add more sophisticated logic here)
      const transactionsToUpload = localTransactions.filter((tx: any) => {
        // For now, upload all transactions. In production, you might want to check timestamps
        // or add a sync_status field to track what's been uploaded
        return true;
      });

      if (transactionsToUpload.length === 0) {
        console.log('ℹ️ [SYNC] No transactions to upload - proceeding to download step');
        await updateSyncStatus();
        return; // Return early but don't fail - allows download step to proceed
      }

      console.log(`📤 [SYNC] Uploading ${transactionsToUpload.length} transactions to cloud...`);

      // Upload transactions to cloud
      for (const transaction of transactionsToUpload) {
        try {
          const response = await fetch('/api/transactions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(transaction),
          });

          if (response.ok) {
            console.log(`✅ Transaction ${transaction.id} uploaded successfully`);
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
  }, []);

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
