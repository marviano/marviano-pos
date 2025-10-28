'use client';

import { useState, useEffect } from 'react';
import { useOfflineSync } from '@/hooks/useOfflineSync';
import { smartSyncService } from '@/lib/smartSync';
import { Wifi, WifiOff, RefreshCw, Clock, AlertTriangle, CheckCircle } from 'lucide-react';

interface OfflineStatusProps {
  className?: string;
}

export default function OfflineStatus({ className = '' }: OfflineStatusProps) {
  const { 
    isOnline, 
    internetConnected, 
    databaseConnected, 
    lastSync, 
    syncInProgress 
  } = useOfflineSync();
  
  const [smartSyncStatus, setSmartSyncStatus] = useState<any>(null);
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
      if (window.electronAPI?.localDbGetPendingTransactions) {
        try {
          const pending = await window.electronAPI.localDbGetPendingTransactions();
          setPendingCount(pending.length);
        } catch (error) {
          console.warn('Failed to get pending transactions:', error);
        }
      }
    };

    checkPendingTransactions();
    const interval = setInterval(checkPendingTransactions, 10000);
    return () => clearInterval(interval);
  }, []);

  const getStatusDisplay = () => {
    if (internetConnected && databaseConnected) {
      return { 
        text: 'Online', 
        color: 'bg-green-100 text-green-700 border-green-300',
        icon: Wifi,
        description: 'Internet & Database Connected'
      };
    } else if (!internetConnected && databaseConnected) {
      return { 
        text: 'Offline', 
        color: 'bg-orange-100 text-orange-700 border-orange-300',
        icon: WifiOff,
        description: 'Local Database Only'
      };
    } else if (internetConnected && !databaseConnected) {
      return { 
        text: 'Error', 
        color: 'bg-yellow-100 text-yellow-700 border-yellow-300',
        icon: AlertTriangle,
        description: 'Internet OK, DB Error'
      };
    } else {
      return { 
        text: 'Offline', 
        color: 'bg-red-100 text-red-700 border-red-300',
        icon: WifiOff,
        description: 'No Connection'
      };
    }
  };

  const statusDisplay = getStatusDisplay();
  const lastSyncText = lastSync ? 
    (Date.now() - lastSync < 60000 ? 'Just now' : 
     `${Math.floor((Date.now() - lastSync) / 60000)}m ago`) : 
    'Never';

  return (
    <div className={`flex items-center space-x-2 ${className}`}>
      {/* Main Status Badge */}
      <div
        className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border ${statusDisplay.color}`}
        title={statusDisplay.description}
      >
        <statusDisplay.icon className="w-3.5 h-3.5" />
        <span>{statusDisplay.text}</span>
      </div>

      {/* Pending Transactions Indicator */}
      {pendingCount > 0 && (
        <div className="flex items-center space-x-1 px-2 py-1 bg-blue-100 text-blue-700 rounded-lg text-xs border border-blue-300">
          <RefreshCw className="w-3 h-3" />
          <span>{pendingCount} pending</span>
        </div>
      )}

      {/* Sync Status */}
      {syncInProgress && (
        <div className="flex items-center space-x-1 px-2 py-1 bg-purple-100 text-purple-700 rounded-lg text-xs border border-purple-300">
          <RefreshCw className="w-3 h-3 animate-spin" />
          <span>Syncing...</span>
        </div>
      )}

      {/* Last Sync Info */}
      {lastSync && (
        <div className="flex items-center space-x-1 text-xs text-gray-500">
          <Clock className="w-3 h-3" />
          <span>Synced {lastSyncText}</span>
        </div>
      )}

      {/* Smart Sync Status */}
      {smartSyncStatus && (
        <div className="flex items-center space-x-1 text-xs text-gray-500">
          {smartSyncStatus.isSyncing ? (
            <RefreshCw className="w-3 h-3 animate-spin text-blue-500" />
          ) : smartSyncStatus.consecutiveFailures > 0 ? (
            <AlertTriangle className="w-3 h-3 text-yellow-500" />
          ) : (
            <CheckCircle className="w-3 h-3 text-green-500" />
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
        <div className={`flex items-center space-x-1 text-xs ${
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
