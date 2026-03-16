'use client';

import { useState, useEffect, useRef } from 'react';
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
  lastVerifikasiRequeuedTotal?: number;
  lastSyncedCount?: number;
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
  const [showSyncTooltip, setShowSyncTooltip] = useState(false);
  const syncAreaRef = useRef<HTMLDivElement>(null);

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
        const pending = await electronAPI.localDbGetUnsyncedTransactions();
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

      {/* Smart Sync Status: badge shows diff count when present; click shows last run summary */}
      {smartSyncStatus && autoSyncEnabled && (
        <div
          ref={syncAreaRef}
          className="relative flex items-center space-x-[3px] text-[10px] text-white cursor-pointer select-none"
          style={{ textShadow: '0 1px 1px rgba(0,0,0,0.5)' }}
          onClick={() => setShowSyncTooltip(prev => !prev)}
          onBlur={() => setShowSyncTooltip(false)}
          tabIndex={0}
          role="button"
          aria-label="Sync status and last run summary"
        >
          {smartSyncStatus.isSyncing ? (
            <RefreshCw className="w-[10px] h-[10px] animate-spin shrink-0" style={{ color: '#ffff00' }} />
          ) : smartSyncStatus.consecutiveFailures > 0 ? (
            <AlertTriangle className="w-[10px] h-[10px] shrink-0" style={{ color: '#ffaa00' }} />
          ) : (
            <CheckCircle className="w-[10px] h-[10px] shrink-0" style={{ color: '#00ff00' }} />
          )}
          <span>
            {smartSyncStatus.isSyncing ? 'Syncing' : 
             smartSyncStatus.consecutiveFailures > 0 ? `${smartSyncStatus.consecutiveFailures} fails` :
             'Ready'}
          </span>
          {/* Badge: number of differences found and re-queued in last run (or upserted if no diffs) */}
          {!smartSyncStatus.isSyncing && ((smartSyncStatus.lastVerifikasiRequeuedTotal ?? 0) > 0 || (smartSyncStatus.lastSyncedCount ?? 0) > 0) ? (
            <span
              className="flex items-center justify-center min-w-[14px] h-[14px] px-1 rounded-full text-[9px] font-bold bg-amber-500 text-white border border-amber-600"
              title="Last run: differences re-queued / upserted — click for detail"
            >
              {(smartSyncStatus.lastVerifikasiRequeuedTotal ?? 0) > 0
                ? smartSyncStatus.lastVerifikasiRequeuedTotal
                : smartSyncStatus.lastSyncedCount}
            </span>
          ) : null}
          {showSyncTooltip && (
            <div
              className="absolute top-full right-0 mt-1 z-[100] px-2 py-1.5 rounded shadow-lg bg-gray-900 text-white text-[10px] whitespace-nowrap"
              role="tooltip"
            >
              <div>Differences re-queued: {smartSyncStatus.lastVerifikasiRequeuedTotal ?? 0}</div>
              <div>Upserted to salespulse: {smartSyncStatus.lastSyncedCount ?? 0}</div>
            </div>
          )}
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
