import { getApiUrl } from '@/lib/api';

type UnknownRecord = Record<string, unknown>;

const isElectron = typeof window !== 'undefined' && (window as { electronAPI?: UnknownRecord }).electronAPI;

interface QueuedTransaction {
  id: number;
  transaction_id: string;
  queued_at: number;
  synced_at: number | null;
  retry_count: number;
  last_error: string | null;
}

interface SyncConfig {
  maxBatchSize: number;
  syncInterval: number;
  maxRetries: number;
  retryDelay: number;
}

class SystemPosSyncService {
  private config: SyncConfig = {
    maxBatchSize: 10,
    syncInterval: 30000, // 30 seconds
    maxRetries: 5,
    retryDelay: 5000, // 5 seconds
  };

  private syncTimer: NodeJS.Timeout | null = null;
  private isOnline: boolean = false;
  private isSyncing: boolean = false;
  private lastSyncTime: number = 0;

  constructor() {
    // console.log('🚀 [SYSTEM POS SYNC] Service initialized');
    if (isElectron) {
      // console.log('✅ [SYSTEM POS SYNC] Running in Electron environment');
    } else {
      console.warn('⚠️ [SYSTEM POS SYNC] Not running in Electron - sync will not work');
    }
    this.startMonitoring();
  }

  /**
   * Start monitoring online status and manage sync
   */
  private startMonitoring() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        // console.log('🌐 [SYSTEM POS SYNC] Browser detected: ONLINE');
        setTimeout(() => {
          this.checkConnection();
        }, 1000);
      });

      window.addEventListener('offline', () => {
        // console.log('📴 [SYSTEM POS SYNC] Browser detected: OFFLINE');
        this.isOnline = false;
        this.stopSync();
      });

      // Initial connection check
      this.checkConnection();

      // Periodic connection check
      setInterval(() => {
        this.checkConnection();
      }, 10000); // Check every 10 seconds
    }
  }

  /**
   * Check connection status
   */
  private async checkConnection() {
    // In Electron, if we're running, assume online (Electron can bypass CORS)
    // Use navigator.onLine as fallback
    if (isElectron) {
      const isNavigatorOnline = typeof navigator !== 'undefined' && navigator.onLine;
      if (isNavigatorOnline) {
        // Try to verify with API, but don't fail if CORS blocks it
        try {
          const response = await fetch(getApiUrl('/api/health'), {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(5000),
          });

          if (response.ok) {
            if (!this.isOnline) {
              // console.log('✅ [SYSTEM POS SYNC] Connection restored');
            }
            this.isOnline = true;
            this.startSync();
            return;
          }
        } catch (error) {
          // CORS error or network error - in Electron, assume online if navigator says so
          if (error instanceof Error && (error.message.includes('CORS') || error.message.includes('Failed to fetch'))) {
            // console.log('⚠️ [SYSTEM POS SYNC] CORS/Network error, but navigator.onLine is true - assuming online');
            if (!this.isOnline) {
              // console.log('✅ [SYSTEM POS SYNC] Assuming online (Electron + navigator.onLine)');
            }
            this.isOnline = true;
            this.startSync();
            return;
          }
        }
      }

      // If navigator says offline, mark as offline
      if (!isNavigatorOnline) {
        if (this.isOnline) {
          console.log('📴 [SYSTEM POS SYNC] Navigator reports offline');
        }
        this.isOnline = false;
        this.stopSync();
        return;
      }
    } else {
      // Non-Electron: use standard fetch check
      try {
        const response = await fetch(getApiUrl('/api/health'), {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(5000),
        });

        if (response.ok) {
          if (!this.isOnline) {
            console.log('✅ [SYSTEM POS SYNC] Connection restored');
          }
          this.isOnline = true;
          this.startSync();
        } else {
          if (this.isOnline) {
            console.log('📴 [SYSTEM POS SYNC] Connection lost (HTTP ' + response.status + ')');
          }
          this.isOnline = false;
          this.stopSync();
        }
      } catch (error) {
        if (this.isOnline) {
          console.log('📴 [SYSTEM POS SYNC] Connection check failed:', error instanceof Error ? error.message : String(error));
        }
        this.isOnline = false;
        this.stopSync();
      }
    }
  }

  /**
   * Start periodic sync
   */
  private startSync() {
    if (this.syncTimer) {
      return; // Already running
    }

    // console.log('🔄 [SYSTEM POS SYNC] Starting periodic sync');
    this.syncTimer = setInterval(() => {
      if (this.isOnline && !this.isSyncing) {
        this.sync();
      }
    }, this.config.syncInterval);

    // Immediate sync on start
    if (this.isOnline && !this.isSyncing) {
      this.sync();
    }
  }

  /**
   * Stop periodic sync
   */
  private stopSync() {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
      console.log('⏸️ [SYSTEM POS SYNC] Stopped periodic sync');
    }
  }

  /**
   * Perform sync of queued transactions
   */
  async sync() {
    if (this.isSyncing || !this.isOnline) {
      return;
    }

    if (!isElectron) {
      return;
    }

    this.isSyncing = true;

    try {
      const electronAPI = (window as { electronAPI?: UnknownRecord }).electronAPI;
      if (!electronAPI?.getSystemPosQueue) {
        console.warn('⚠️ [SYSTEM POS SYNC] getSystemPosQueue not available');
        return;
      }

      // Get queued transactions (only pending ones)
      const result = await (electronAPI.getSystemPosQueue as () => Promise<{ success: boolean; queue: QueuedTransaction[] }>)();

      if (!result.success) {
        console.error('❌ [SYSTEM POS SYNC] Failed to get queue:', result);
        return;
      }

      // Filter only pending transactions (synced_at IS NULL)
      const pendingQueue = Array.isArray(result.queue)
        ? result.queue.filter((q: QueuedTransaction) => !q.synced_at)
        : [];

      if (pendingQueue.length === 0) {
        // console.log('✅ [SYSTEM POS SYNC] No pending transactions to sync');
        return;
      }

      // console.log(`📦 [SYSTEM POS SYNC] Found ${pendingQueue.length} pending transactions (out of ${result.queue.length} total)`);

      if (pendingQueue.length > 0) {
        // console.log(`📋 [SYSTEM POS SYNC] Pending transaction IDs:`, pendingQueue.slice(0, 5).map((q: QueuedTransaction) => q.transaction_id).join(', '));
      }

      // Process in batches
      const batches = this.createBatches(pendingQueue, this.config.maxBatchSize);
      // console.log(`📦 [SYSTEM POS SYNC] Processing in ${batches.length} batch(es)`);

      // let syncedCount = 0;
      // let failedCount = 0;

      for (const batch of batches) {
        await this.processBatch(batch);
        // syncedCount += batchResult.synced || 0;
        // failedCount += batchResult.failed || 0;

        if (batches.length > 1) {
          await this.delay(2000); // 2 second delay between batches
        }
      }

      this.lastSyncTime = Date.now();
      // console.log(`✅ [SYSTEM POS SYNC] Sync completed: ${syncedCount} synced, ${failedCount} failed`);

    } catch (error) {
      console.error('❌ [SYSTEM POS SYNC] Sync failed:', error);
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Create batches from array
   */
  private createBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }

  /**
   * Process a batch of transactions
   */
  private async processBatch(batch: QueuedTransaction[]): Promise<{ synced: number; failed: number }> {
    // console.log(`🔄 [SYSTEM POS SYNC] Processing batch of ${batch.length} transactions`);

    let synced = 0;
    let failed = 0;

    for (const queuedTx of batch) {
      // Skip if exceeded max retries
      if (queuedTx.retry_count >= this.config.maxRetries) {
        console.warn(`⚠️ [SYSTEM POS SYNC] Transaction ${queuedTx.transaction_id} exceeded max retries (${queuedTx.retry_count}), skipping`);
        failed++;
        continue;
      }

      try {
        await this.syncTransaction(queuedTx);
        synced++;
      } catch (error) {
        console.error(`❌ [SYSTEM POS SYNC] Error processing transaction ${queuedTx.transaction_id}:`, error);
        failed++;
      }
    }

    return { synced, failed };
  }

  /**
   * Sync a single transaction to System POS
   * RULES: Only sync if printer2_audit_log exists for this transaction.
   * If it does, sync: Transactions, Shifts, Printer Audits.
   */
  private async syncTransaction(queuedTx: QueuedTransaction) {
    const electronAPI = (window as { electronAPI?: UnknownRecord }).electronAPI;
    if (!electronAPI) {
      return;
    }

    try {
      // Fetch complete transaction data (INCLUDING Shift and Audits)
      const transactionData = await this.fetchTransactionData(queuedTx.transaction_id);

      if (!transactionData) {
        throw new Error('Failed to fetch transaction data');
      }

      // === FILTER: Printer 2 Check ===
      const audits = transactionData.printer_audits as { printer2: unknown[] } | undefined;
      const hasPrinter2 = audits && Array.isArray(audits.printer2) && audits.printer2.length > 0;

      if (!hasPrinter2) {
        console.log(`⏭️ [SYSTEM POS SYNC] Transaction ${queuedTx.transaction_id} skipped (No Printer 2 Audit Log)`);

        // Mark as "synced" locally so we don't keep checking it forever
        if (electronAPI.markSystemPosSynced) {
          await (electronAPI.markSystemPosSynced as (transactionId: string) => Promise<{ success: boolean }>)(queuedTx.transaction_id);
        }
        return;
      }

      console.log(`📤 [SYSTEM POS SYNC] Syncing Transaction ${queuedTx.transaction_id} (Printer 2 Detected)...`);

      // 1. Sync Transaction (Transactions + Items + Refunds)
      const transApiUrl = getApiUrl('/api/system-pos/transactions');
      
      const transResponse = await fetch(transApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(transactionData),
      });

      if (!transResponse.ok) {
        throw new Error(`Transaction Sync Failed: ${transResponse.status}`);
      }

      const transResult = await transResponse.json();
      
      if (!transResult.success) throw new Error(transResult.error || 'Unknown Transaction Sync Error');


      // 2. Sync Shift (if available) - Non-blocking but logged
      if (transactionData.shift) {
        try {
          const shiftApiUrl = getApiUrl('/api/system-pos/shifts');
          await fetch(shiftApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ shifts: [transactionData.shift] }),
          });
          // console.log(`   ✅ [SYSTEM POS SYNC] Shift synced`);
        } catch (error) {
          console.warn(`   ⚠️ [SYSTEM POS SYNC] Failed to sync Shift:`, error);
        }
      }

      // 3. Sync Printer Audits (if available) - Non-blocking but logged
      if (transactionData.printer_audits) {
        try {
          const auditApiUrl = getApiUrl('/api/system-pos/printer-audits');
          await fetch(auditApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              printer1Audits: (transactionData.printer_audits as { printer1: unknown[] }).printer1 || [],
              printer2Audits: (transactionData.printer_audits as { printer2: unknown[] }).printer2 || [],
            }),
          });
          // console.log(`   ✅ [SYSTEM POS SYNC] Audits synced`);
        } catch (error) {
          console.warn(`   ⚠️ [SYSTEM POS SYNC] Failed to sync Audits:`, error);
        }
      }


      // Success - Mark as synced
      if (electronAPI.markSystemPosSynced) {
        const markResult = await (electronAPI.markSystemPosSynced as (transactionId: string) => Promise<{ success: boolean }>)(queuedTx.transaction_id);
        
        if (markResult.success) {
          // console.log(`✅ [SYSTEM POS SYNC] Marked transaction ${queuedTx.transaction_id} as synced`);
        } else {
          console.warn(`⚠️ [SYSTEM POS SYNC] Failed to mark transaction ${queuedTx.transaction_id} as synced`);
        }
      }

    } catch (error) {
      console.error(`❌ [SYSTEM POS SYNC] Failed to sync transaction ${queuedTx.transaction_id}:`, error);
      if (error instanceof Error) {
        console.error(`❌ [SYSTEM POS SYNC] Error details:`, error.message);
      }

      // Mark as failed (increment retry count)
      if (electronAPI.markSystemPosFailed) {
        await (electronAPI.markSystemPosFailed as (transactionId: string, error: string) => Promise<{ success: boolean }>)(
          queuedTx.transaction_id,
          error instanceof Error ? error.message : String(error)
        );
      }
    }
  }

  /**
   * Fetch complete transaction data (transaction + items + customizations + refunds + SHIFT + AUDITS)
   */
  private async fetchTransactionData(transactionId: string): Promise<UnknownRecord | null> {
    const electronAPI = (window as { electronAPI?: UnknownRecord }).electronAPI;
    if (!electronAPI) {
      return null;
    }

    try {
      // Fetch transaction
      // console.log(`🔍 [SYSTEM POS SYNC] Fetching transaction data for ${transactionId}...`);
      const transactions = await (electronAPI.localDbGetTransactions as (businessId?: number, limit?: number) => Promise<Array<UnknownRecord>>)();
      const transaction = Array.isArray(transactions) ? transactions.find((t: UnknownRecord) => String(t.id) === String(transactionId)) : null;

      if (!transaction) {
        console.error(`❌ [SYSTEM POS SYNC] Transaction ${transactionId} not found`);
        return null;
      }

      // console.log(`✅ [SYSTEM POS SYNC] Found transaction ${transactionId}`);

      // Fetch Items
      let items: UnknownRecord[] = [];
      if (electronAPI.localDbGetTransactionItems) {
        items = await (electronAPI.localDbGetTransactionItems as (transactionId: string) => Promise<Array<UnknownRecord>>)(transactionId);
      }

      // Fetch Customizations
      let customizations: Array<UnknownRecord> = [];
      let customizationOptions: Array<UnknownRecord> = [];
      if (electronAPI.localDbGetTransactionItemCustomizationsNormalized) {
        const customData = await (electronAPI.localDbGetTransactionItemCustomizationsNormalized as (transactionId: string) => Promise<{
          customizations: Array<UnknownRecord>;
          options: Array<UnknownRecord>;
        }>)(transactionId);
        customizations = customData.customizations || [];
        customizationOptions = customData.options || [];
      }

      // Fetch Refunds
      let refunds: UnknownRecord[] = [];
      if (electronAPI.localDbGetTransactionRefunds) {
        refunds = await (electronAPI.localDbGetTransactionRefunds as (transactionUuid: string) => Promise<Array<UnknownRecord>>)(transactionId);
      }

      // === NEW: Fetch Shift ===
      let shift: UnknownRecord | null = null;
      if (transaction.shift_uuid && electronAPI.localDbGetShiftByUuid) {
        shift = await (electronAPI.localDbGetShiftByUuid as (uuid: string) => Promise<UnknownRecord | null>)(String(transaction.shift_uuid));
      }

      // === NEW: Fetch Printer Audits ===
      let printerAudits: { printer1: unknown[]; printer2: unknown[] } = { printer1: [], printer2: [] };
      if (electronAPI.localDbGetPrinterAuditsByTransactionId) {
        printerAudits = await (electronAPI.localDbGetPrinterAuditsByTransactionId as (txId: string) => Promise<{ printer1: unknown[]; printer2: unknown[] }>)(transactionId);
      }

      return {
        transaction,
        items,
        transaction_item_customizations: customizations,
        transaction_item_customization_options: customizationOptions,
        transaction_refunds: refunds,
        shift, // Add Shift
        printer_audits: printerAudits, // Add Audits
      };

    } catch (error) {
      console.error(`❌ [SYSTEM POS SYNC] Error fetching transaction data:`, error);
      return null;
    }
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Manual trigger sync (for testing or immediate sync)
   */
  async triggerSync() {
    if (this.isSyncing) {
      console.log('⏳ [SYSTEM POS SYNC] Sync already in progress');
      return;
    }
    await this.sync();
  }
}

export const systemPosSyncService = new SystemPosSyncService();

