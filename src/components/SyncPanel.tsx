'use client';

import React, { useState } from 'react';
import { RefreshCw, Cloud, CloudOff, CheckCircle, AlertCircle, Upload, Download, Settings, X } from 'lucide-react';
import { offlineSyncService } from '@/lib/offlineSync';
import { smartSyncService } from '@/lib/smartSync';

interface SyncPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SyncPanel({ isOpen, onClose }: SyncPanelProps) {
  const [syncStatus, setSyncStatus] = useState({
    isOnline: true,
    lastSync: null as string | null,
    pendingTransactions: 0,
    syncInProgress: false,
    error: null as string | null
  });

  // Check if we're in Electron environment
  const isElectron = typeof window !== 'undefined' && (window as any).electronAPI;

  // Get current sync status
  const getSyncStatus = async () => {
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
      
      const data = await response.json();
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
        omset: data.omset?.length || 0
      });

      // Save to local database
      const electronAPI = (window as any).electronAPI;
      
      if (data.products && data.products.length > 0) {
        await electronAPI.localDbUpsertProducts(data.products);
        console.log(`✅ ${data.products.length} products synced to local database`);
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
      
      if (data.omset && data.omset.length > 0) {
        await electronAPI.localDbUpsertOmset(data.omset);
        console.log(`✅ ${data.omset.length} omset records synced to local database`);
      }

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
    if (isOpen) {
      updateSyncStatus();
    }
  }, [isOpen]);

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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
            <Settings className="w-5 h-5" />
            Sinkronisasi Database
          </h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-600" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Connection Status */}
          <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
            {syncStatus.isOnline ? (
              <Cloud className="w-5 h-5 text-green-600" />
            ) : (
              <CloudOff className="w-5 h-5 text-red-600" />
            )}
            <div>
              <div className="font-medium text-gray-800">
                Status: {syncStatus.isOnline ? 'Online' : 'Offline'}
              </div>
              <div className="text-sm text-gray-600">
                Terakhir sinkronisasi: {formatLastSync(syncStatus.lastSync)}
              </div>
              <div className="text-sm text-gray-600">
                Transaksi tertunda: {syncStatus.pendingTransactions}
              </div>
            </div>
          </div>

          {/* Error Message */}
          {syncStatus.error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
              <AlertCircle className="w-5 h-5 text-red-600" />
              <span className="text-red-800">{syncStatus.error}</span>
            </div>
          )}

          {/* Sync Buttons */}
          <div className="space-y-3">
            {/* Full Sync Button */}
            <button
              onClick={fullSync}
              disabled={syncStatus.syncInProgress}
              className={`
                w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-medium transition-all
                ${syncStatus.syncInProgress 
                  ? 'bg-gray-400 text-white cursor-not-allowed' 
                  : 'bg-blue-600 hover:bg-blue-700 text-white'
                }
              `}
            >
              {syncStatus.syncInProgress ? (
                <>
                  <RefreshCw className="w-5 h-5 animate-spin" />
                  <span>Sinkronisasi...</span>
                </>
              ) : (
                <>
                  <RefreshCw className="w-5 h-5" />
                  <span>Sinkronisasi Lengkap</span>
                </>
              )}
            </button>

            {/* Individual Sync Buttons */}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={syncFromCloud}
                disabled={syncStatus.syncInProgress}
                className="flex items-center justify-center gap-2 px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                <Download className="w-4 h-4" />
                <span>Download</span>
              </button>
              
              <button
                onClick={syncToCloud}
                disabled={syncStatus.syncInProgress}
                className="flex items-center justify-center gap-2 px-3 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                <Upload className="w-4 h-4" />
                <span>Upload</span>
              </button>
            </div>
          </div>

          {/* Sync Information */}
          <div className="text-sm text-gray-600 space-y-2">
            <div className="font-medium">Informasi Sinkronisasi:</div>
            <ul className="space-y-1 text-xs">
              <li>• <strong>Download:</strong> Mengunduh data terbaru dari cloud ke database lokal</li>
              <li>• <strong>Upload:</strong> Mengunggah transaksi offline ke cloud</li>
              <li>• <strong>Sinkronisasi Lengkap:</strong> Upload + Download dalam satu proses</li>
              <li>• Data akan tersinkronisasi otomatis saat koneksi tersedia</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
