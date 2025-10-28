import { conflictResolutionService } from './conflictResolution';

const isElectron = typeof window !== 'undefined' && (window as any).electronAPI;

interface SyncConfig {
  maxBatchSize: number;
  syncInterval: number;
  maxRetries: number;
  retryDelay: number;
  serverLoadThreshold: number;
}

interface PendingTransaction {
  id: number;
  transaction_data: string;
  created_at: number;
  sync_attempts: number;
  last_sync_attempt?: number;
}

class SmartSyncService {
  private config: SyncConfig = {
    maxBatchSize: 10, // Process max 10 transactions per batch
    syncInterval: 30000, // Sync every 30 seconds when online
    maxRetries: 3,
    retryDelay: 5000, // 5 seconds between retries
    serverLoadThreshold: 1000, // Max 1000ms response time threshold
  };

  private syncTimer: NodeJS.Timeout | null = null;
  private isOnline: boolean = false;
  private isSyncing: boolean = false;
  private lastSyncTime: number = 0;
  private consecutiveFailures: number = 0;
  private serverLoadHistory: number[] = [];

  constructor() {
    console.log('🚀 [SMART SYNC] Service initialized');
    this.startMonitoring();
  }

  /**
   * Start monitoring online status and manage sync
   */
  private startMonitoring() {
    // Monitor online status changes
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        console.log('🌐 [SMART SYNC] Online detected - starting smart sync');
        this.isOnline = true;
        this.startSmartSync();
      });

      window.addEventListener('offline', () => {
        console.log('🌐 [SMART SYNC] Offline detected - stopping sync');
        this.isOnline = false;
        this.stopSmartSync();
      });

      // Initial check
      this.isOnline = navigator.onLine;
      if (this.isOnline) {
        this.startSmartSync();
      }
    }
  }

  /**
   * Start smart sync with intelligent timing
   */
  private startSmartSync() {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
    }

    // Immediate sync if we've been offline for a while
    const timeSinceLastSync = Date.now() - this.lastSyncTime;
    if (timeSinceLastSync > 300000) { // 5 minutes
      console.log('🔄 [SMART SYNC] Long offline period - immediate sync');
      this.syncPendingTransactions();
    }

    // Start regular sync interval
    this.syncTimer = setInterval(() => {
      if (this.isOnline && !this.isSyncing) {
        this.syncPendingTransactions();
      }
    }, this.config.syncInterval);
  }

  /**
   * Stop smart sync
   */
  private stopSmartSync() {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  /**
   * Sync pending transactions with intelligent batching
   */
  private async syncPendingTransactions() {
    if (!isElectron || this.isSyncing || !this.isOnline) {
      return;
    }

    this.isSyncing = true;
    console.log('🔄 [SMART SYNC] Starting transaction sync...');

    try {
      // Check if the method is available
      if (!(window as any).electronAPI?.localDbGetPendingTransactions) {
        console.warn('⚠️ [SMART SYNC] localDbGetPendingTransactions not available - Electron may need restart');
        return;
      }

      // Get pending transactions
      const pendingTransactions = await (window as any).electronAPI.localDbGetPendingTransactions();
      
      if (pendingTransactions.length === 0) {
        console.log('✅ [SMART SYNC] No pending transactions');
        return;
      }

      console.log(`📦 [SMART SYNC] Found ${pendingTransactions.length} pending transactions`);

      // Process in batches to prevent server overload
      const batches = this.createBatches(pendingTransactions, this.config.maxBatchSize);
      
      for (const batch of batches) {
        await this.processBatch(batch);
        
        // Add delay between batches to prevent server overload
        if (batches.length > 1) {
          await this.delay(2000); // 2 second delay between batches
        }
      }

      this.consecutiveFailures = 0;
      this.lastSyncTime = Date.now();
      console.log('✅ [SMART SYNC] Sync completed successfully');

    } catch (error) {
      console.error('❌ [SMART SYNC] Sync failed:', error);
      this.consecutiveFailures++;
      
      // Exponential backoff on consecutive failures
      if (this.consecutiveFailures >= 3) {
        const backoffDelay = Math.min(300000, this.config.retryDelay * Math.pow(2, this.consecutiveFailures));
        console.log(`⏳ [SMART SYNC] Backing off for ${backoffDelay}ms due to consecutive failures`);
        await this.delay(backoffDelay);
      }
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Process a batch of transactions
   */
  private async processBatch(batch: PendingTransaction[]) {
    console.log(`🔄 [SMART SYNC] Processing batch of ${batch.length} transactions`);

    for (const transaction of batch) {
      try {
        // Check server load before processing
        const serverLoad = await this.checkServerLoad();
        if (serverLoad > this.config.serverLoadThreshold) {
          console.log(`⚠️ [SMART SYNC] Server load high (${serverLoad}ms) - delaying sync`);
          await this.delay(5000);
          continue;
        }

        // Parse transaction data
        const transactionData = JSON.parse(transaction.transaction_data);
        
        // Validate data before sync
        const validation = conflictResolutionService.validateData(transactionData);
        if (!validation.isValid) {
          console.warn(`⚠️ [SMART SYNC] Transaction ${transaction.id} validation failed:`, validation.errors);
          await (window as any).electronAPI.localDbMarkTransactionFailed(transaction.id);
          continue;
        }
        
        // Send to server
        const startTime = Date.now();
        const response = await fetch('/api/transactions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(transactionData),
        });

        const responseTime = Date.now() - startTime;
        this.serverLoadHistory.push(responseTime);

        if (response.ok) {
          const result = await response.json();
          console.log(`✅ [SMART SYNC] Transaction ${transaction.id} synced successfully`);
          
        // Mark as synced
        if ((window as any).electronAPI?.localDbMarkTransactionSynced) {
          await (window as any).electronAPI.localDbMarkTransactionSynced(transaction.id);
        }
        } else {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        // Small delay between individual transactions
        await this.delay(100);

      } catch (error) {
        console.error(`❌ [SMART SYNC] Failed to sync transaction ${transaction.id}:`, error);
        
        // Mark as failed (will retry later)
        if ((window as any).electronAPI?.localDbMarkTransactionFailed) {
          await (window as any).electronAPI.localDbMarkTransactionFailed(transaction.id);
        }
        
        // If too many failures, stop processing this batch
        if (transaction.sync_attempts >= this.config.maxRetries) {
          console.log(`🚫 [SMART SYNC] Transaction ${transaction.id} exceeded max retries - skipping`);
        }
      }
    }
  }

  /**
   * Create batches from array
   */
  private createBatches<T>(array: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < array.length; i += batchSize) {
      batches.push(array.slice(i, i + batchSize));
    }
    return batches;
  }

  /**
   * Check server load by measuring response time
   */
  private async checkServerLoad(): Promise<number> {
    try {
      const startTime = Date.now();
      const response = await fetch('/api/health-check', {
        method: 'GET',
        cache: 'no-store',
      });
      const responseTime = Date.now() - startTime;
      
      // Keep only last 10 measurements
      if (this.serverLoadHistory.length > 10) {
        this.serverLoadHistory = this.serverLoadHistory.slice(-10);
      }
      
      return responseTime;
    } catch (error) {
      console.warn('⚠️ [SMART SYNC] Could not check server load:', error);
      return 0;
    }
  }

  /**
   * Queue a transaction for offline sync
   */
  async queueTransaction(transactionData: any): Promise<{ success: boolean; offlineTransactionId?: number }> {
    if (!isElectron || !(window as any).electronAPI?.localDbQueueOfflineTransaction) {
      console.warn('⚠️ [SMART SYNC] localDbQueueOfflineTransaction not available - Electron may need restart');
      return { success: false };
    }

    try {
      const result = await (window as any).electronAPI.localDbQueueOfflineTransaction(transactionData);
      console.log('📝 [SMART SYNC] Transaction queued for offline sync');
      return result;
    } catch (error) {
      console.error('❌ [SMART SYNC] Failed to queue transaction:', error);
      return { success: false };
    }
  }

  /**
   * Force immediate sync (for manual trigger)
   */
  async forceSync(): Promise<void> {
    if (this.isOnline && !this.isSyncing) {
      await this.syncPendingTransactions();
    }
  }

  /**
   * Get sync status
   */
  getStatus() {
    return {
      isOnline: this.isOnline,
      isSyncing: this.isSyncing,
      lastSyncTime: this.lastSyncTime,
      consecutiveFailures: this.consecutiveFailures,
      averageServerLoad: this.serverLoadHistory.length > 0 
        ? this.serverLoadHistory.reduce((a, b) => a + b, 0) / this.serverLoadHistory.length 
        : 0,
    };
  }

  /**
   * Utility delay function
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get count of pending transactions
   */
  async getPendingTransactionCount(): Promise<number> {
    try {
      if (!isElectron) {
        return 0;
      }

      const electronAPI = (window as any).electronAPI;
      // Get unsynced transactions (where synced_at IS NULL)
      const transactions = await electronAPI.localDbGetUnsyncedTransactions(14);
      
      return transactions.length;
    } catch (error) {
      console.warn('⚠️ [SMART SYNC] Failed to get pending transaction count:', error);
      return 0;
    }
  }

  /**
   * Cleanup
   */
  destroy() {
    this.stopSmartSync();
  }
}

// Export singleton instance
export const smartSyncService = new SmartSyncService();
