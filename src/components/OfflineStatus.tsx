'use client';

import { useState, useEffect } from 'react';
import { useOfflineSync } from '@/hooks/useOfflineSync';
import { smartSyncService } from '@/lib/smartSync';
import { RefreshCw, Clock, AlertTriangle, CheckCircle } from 'lucide-react';

interface OfflineStatusProps {
  className?: string;
}

interface SmartSyncStatus {
  isOnline: boolean;
  isSyncing: boolean;
  lastSyncTime: number;
  consecutiveFailures: number;
  averageServerLoad: number;
}

const getElectronAPI = () => (typeof window !== 'undefined' ? window.electronAPI : undefined);

export default function OfflineStatus({ className = '' }: OfflineStatusProps) {
  const { 
    lastSync, 
    syncInProgress 
  } = useOfflineSync();
  
  const [smartSyncStatus, setSmartSyncStatus] = useState<SmartSyncStatus | null>(null);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    const updateStatus = () => {
      const status = smartSyncService.getStatus();
      setSmartSyncStatus(status);
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
        setPendingCount(Array.isArray(pending) ? pending.length : 0);
      } catch (error) {
        console.warn('Failed to get pending transactions:', error);
      }
    };

    checkPendingTransactions();
    const interval = setInterval(checkPendingTransactions, 10000);
    return () => clearInterval(interval);
  }, []);

  const lastSyncText = lastSync ? 
    (Date.now() - lastSync < 60000 ? 'Just now' : 
     `${Math.floor((Date.now() - lastSync) / 60000)}m ago`) : 
    'Never';

  return (
    <div className={`flex items-center space-x-[6.4px] ${className}`}>
      {/* Pending Transactions Indicator */}
      {pendingCount > 0 && (
        <div className="flex items-center space-x-[3.2px] px-[6.4px] py-[3.2px] bg-blue-200 text-blue-800 text-[9.6px] border border-blue-400">
          <RefreshCw className="w-[9.6px] h-[9.6px]" />
          <span>{pendingCount} pending</span>
        </div>
      )}

      {/* Sync Status */}
      {syncInProgress && (
        <div className="flex items-center space-x-[3.2px] px-[6.4px] py-[3.2px] bg-purple-200 text-purple-800 text-[9.6px] border border-purple-400">
          <RefreshCw className="w-[9.6px] h-[9.6px] animate-spin" />
          <span>Syncing...</span>
        </div>
      )}

      {/* Last Sync Info */}
      {lastSync && (
        <div className="flex items-center space-x-[3.2px] text-[9.6px] text-gray-500">
          <Clock className="w-[9.6px] h-[9.6px]" />
          <span>Synced {lastSyncText}</span>
        </div>
      )}

      {/* Smart Sync Status */}
      {smartSyncStatus && (
        <div className="flex items-center space-x-[3.2px] text-[9.6px] text-gray-500">
          {smartSyncStatus.isSyncing ? (
            <RefreshCw className="w-[9.6px] h-[9.6px] animate-spin text-blue-500" />
          ) : smartSyncStatus.consecutiveFailures > 0 ? (
            <AlertTriangle className="w-[9.6px] h-[9.6px] text-yellow-500" />
          ) : (
            <CheckCircle className="w-[9.6px] h-[9.6px] text-green-500" />
          )}
          <span>
            {smartSyncStatus.isSyncing ? 'Syncing' : 
             smartSyncStatus.consecutiveFailures > 0 ? `${smartSyncStatus.consecutiveFailures} fails` :
             'Ready'}
          </span>
        </div>
      )}

      {/* Server Load Indicator */}
      {smartSyncStatus && smartSyncStatus.averageServerLoad > 0 && (
        <div className={`flex items-center space-x-[3.2px] text-[9.6px] ${
          smartSyncStatus.averageServerLoad > 1000 ? 'text-red-500' : 
          smartSyncStatus.averageServerLoad > 500 ? 'text-yellow-500' : 
          'text-green-500'
        }`}>
          <span>Load: {Math.round(smartSyncStatus.averageServerLoad)}ms</span>
        </div>
      )}
    </div>
  );
}
