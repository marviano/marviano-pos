import { useState, useEffect } from 'react';
import { offlineSyncService } from '@/lib/offlineSync';
import { smartSyncService } from '@/lib/smartSync';

interface SyncStatus {
  isOnline: boolean;
  internetConnected: boolean;
  databaseConnected: boolean;
  lastSync: number | null;
  syncInProgress: boolean;
  connectionDetails: {
    internetCheck: string | null;
    databaseCheck: string | null;
    lastCheckTime: number | null;
  };
}

export function useOfflineSync() {
  const [status, setStatus] = useState<SyncStatus>({
    isOnline: false, // Start as offline until verified
    internetConnected: false,
    databaseConnected: false,
    lastSync: null,
    syncInProgress: false,
    connectionDetails: {
      internetCheck: null,
      databaseCheck: null,
      lastCheckTime: null,
    },
  });

  useEffect(() => {
    // Force connection check when hook initializes
    offlineSyncService.forceConnectionCheck();

    // Subscribe to sync status changes
    const unsubscribe = offlineSyncService.subscribe((newStatus) => {
      setStatus(newStatus);
    });

    // Cleanup on unmount
    return () => {
      unsubscribe();
    };
  }, []);

  // Trigger manual sync (uses smart sync - upload transactions only)
  const triggerSync = () => {
    smartSyncService.forceSync();
  };

  return {
    ...status,
    triggerSync,
  };
}


