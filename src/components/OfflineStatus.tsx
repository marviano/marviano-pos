'use client';

import { useState, useEffect } from 'react';
import { useOfflineSync } from '@/hooks/useOfflineSync';
import { smartSyncService } from '@/lib/smartSync';
import { getAutoSyncEnabled, onAutoSyncSettingChanged } from '@/lib/autoSyncSettings';
import { RefreshCw, Clock, AlertTriangle, CheckCircle, Pause } from 'lucide-react';

interface OfflineStatusProps {
  className?: string;
}

interface SmartSyncStatus {
  isOnline: boolean;
  isSyncing: boolean;
  lastSyncTime: number;
  consecutiveFailures: number;
  averageServerLoad: number;
  autoSyncEnabled?: boolean;
}

const getElectronAPI = () => (typeof window !== 'undefined' ? window.electronAPI : undefined);

export default function OfflineStatus({ className = '' }: OfflineStatusProps) {
  const { 
    lastSync, 
    syncInProgress 
  } = useOfflineSync();
  
  const [smartSyncStatus, setSmartSyncStatus] = useState<SmartSyncStatus | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [autoSyncEnabled, setAutoSyncEnabled] = useState<boolean>(true);

  useEffect(() => {
    // Initialize auto sync status
    setAutoSyncEnabled(getAutoSyncEnabled());
    
    // Listen for auto sync setting changes
    const unsubscribe = onAutoSyncSettingChanged((enabled) => {
      setAutoSyncEnabled(enabled);
    });

    return () => {
      unsubscribe();
    };
  }, []);

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
      if (!electronAPI?.localDbGetUnsyncedTransactions) {
        return;
      }
      try {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/7b565785-72b5-49f7-b2c0-57606ea0d0b5',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'OfflineStatus.tsx:65',message:'Calling localDbGetUnsyncedTransactions without businessId',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
        // #endregion
        const pending = await electronAPI.localDbGetUnsyncedTransactions();
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/7b565785-72b5-49f7-b2c0-57606ea0d0b5',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'OfflineStatus.tsx:67',message:'Received pending transactions (no filter)',data:{rawCount:Array.isArray(pending)?pending.length:0,firstTx:pending&&Array.isArray(pending)&&pending.length>0?(()=>{const p=pending[0] as Record<string,unknown>;return{id:p?.id,business_id:p?.business_id,sync_status:p?.sync_status};})():null},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
        // #endregion
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
    <div className={`flex items-center space-x-[6px] ${className}`} style={{ fontFamily: 'Tahoma, "MS Sans Serif", sans-serif' }}>
      {/* Pending Transactions Indicator */}
      {pendingCount > 0 && (
        <div 
          className="flex items-center space-x-[3px] px-[6px] py-[2px] text-[10px]"
          style={{
            background: 'linear-gradient(to bottom, #ece9d8 0%, #d4d0c8 100%)',
            border: '1px solid #808080',
            borderTopColor: '#ffffff',
            borderLeftColor: '#ffffff',
            borderRightColor: '#404040',
            borderBottomColor: '#404040',
            color: '#000080',
            boxShadow: '1px 1px 0 rgba(0,0,0,0.1)'
          }}
        >
          <RefreshCw className="w-[10px] h-[10px]" style={{ color: '#000080' }} />
          <span>{pendingCount} pending</span>
        </div>
      )}

      {/* Sync Status */}
      {syncInProgress && (
        <div 
          className="flex items-center space-x-[3px] px-[6px] py-[2px] text-[10px]"
          style={{
            background: 'linear-gradient(to bottom, #ece9d8 0%, #d4d0c8 100%)',
            border: '1px solid #808080',
            borderTopColor: '#ffffff',
            borderLeftColor: '#ffffff',
            borderRightColor: '#404040',
            borderBottomColor: '#404040',
            color: '#000080',
            boxShadow: '1px 1px 0 rgba(0,0,0,0.1)'
          }}
        >
          <RefreshCw className="w-[10px] h-[10px] animate-spin" style={{ color: '#000080' }} />
          <span>Syncing...</span>
        </div>
      )}

      {/* Last Sync Info */}
      {lastSync && (
        <div className="flex items-center space-x-[3px] text-[10px] text-white" style={{ textShadow: '0 1px 1px rgba(0,0,0,0.5)' }}>
          <Clock className="w-[10px] h-[10px]" />
          <span>Synced {lastSyncText}</span>
        </div>
      )}

      {/* Auto Sync Disabled Warning */}
      {!autoSyncEnabled && (
        <div 
          className="flex items-center space-x-[3px] px-[6px] py-[2px] text-[10px]"
          style={{
            background: 'linear-gradient(to bottom, #fff4e6 0%, #ffe4b5 100%)',
            border: '1px solid #808080',
            borderTopColor: '#ffffff',
            borderLeftColor: '#ffffff',
            borderRightColor: '#404040',
            borderBottomColor: '#404040',
            color: '#8b4513',
            boxShadow: '1px 1px 0 rgba(0,0,0,0.1)'
          }}
        >
          <Pause className="w-[10px] h-[10px]" style={{ color: '#8b4513' }} />
          <span>Auto Sync Off</span>
        </div>
      )}

      {/* Smart Sync Status */}
      {smartSyncStatus && autoSyncEnabled && (
        <div className="flex items-center space-x-[3px] text-[10px] text-white" style={{ textShadow: '0 1px 1px rgba(0,0,0,0.5)' }}>
          {smartSyncStatus.isSyncing ? (
            <RefreshCw className="w-[10px] h-[10px] animate-spin" style={{ color: '#ffff00' }} />
          ) : smartSyncStatus.consecutiveFailures > 0 ? (
            <AlertTriangle className="w-[10px] h-[10px]" style={{ color: '#ffaa00' }} />
          ) : (
            <CheckCircle className="w-[10px] h-[10px]" style={{ color: '#00ff00' }} />
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
        <div 
          className="flex items-center space-x-[3px] text-[10px]"
          style={{
            color: smartSyncStatus.averageServerLoad > 1000 ? '#ff0000' : 
                   smartSyncStatus.averageServerLoad > 500 ? '#ffaa00' : 
                   '#00ff00',
            textShadow: '0 1px 1px rgba(0,0,0,0.5)'
          }}
        >
          <span>Load: {Math.round(smartSyncStatus.averageServerLoad)}ms</span>
        </div>
      )}
    </div>
  );
}
