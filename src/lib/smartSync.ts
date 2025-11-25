import { conflictResolutionService } from './conflictResolution';
import { getApiUrl } from '@/lib/api';

type UnknownRecord = Record<string, unknown>;

const isElectron = typeof window !== 'undefined' && (window as { electronAPI?: UnknownRecord }).electronAPI;

/**
 * Map payment method strings to their IDs (matching actual database IDs)
 * Based on payment_methods table:
 * 1=cash, 2=debit, 3=qr, 4=ewallet, 5=cl, 6=voucher,
 * 14=gofood, 15=grabfood, 16=shopeefood, 17=tiktok, 18=qpon
 */
function getPaymentMethodId(paymentMethod: string): number {
  const paymentMethodMap: Record<string, number> = {
    'cash': 1,
    'debit': 2,
    'qr': 3,
    'ewallet': 4,
    'cl': 5,
    'voucher': 6,
    'gofood': 14,
    'grabfood': 15,
    'shopeefood': 16,
    'tiktok': 17,
    'qpon': 18
  };
  
  return paymentMethodMap[paymentMethod.toLowerCase()] || 1; // Default to cash (ID: 1)
}

/**
 * Normalize payment method string (preserve original, just clean it)
 * The database uses VARCHAR(50), not ENUM, so we preserve the original payment method
 */
function normalizePaymentMethodString(paymentMethod: string): string {
  const method = paymentMethod.toLowerCase().trim();
  
  // Validate and return the original method (database supports all payment methods)
  // List of known valid methods for validation
  const validMethods = ['cash', 'debit', 'qr', 'ewallet', 'cl', 'voucher', 
                        'gofood', 'grabfood', 'shopeefood', 'tiktok', 'qpon'];
  
  // If it's a known method, return it; otherwise preserve the original
  if (validMethods.includes(method)) {
    return method;
  }
  
  // For unknown methods, return as-is (database supports VARCHAR)
  return method || 'cash';
}

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
      const electronAPI = typeof window !== 'undefined' ? (window as { electronAPI?: UnknownRecord }).electronAPI : undefined;
      if (!electronAPI?.localDbGetPendingTransactions) {
        console.warn('⚠️ [SMART SYNC] localDbGetPendingTransactions not available - Electron may need restart');
        return;
      }

      // Get pending transactions
      const pendingTransactions = await (electronAPI.localDbGetPendingTransactions as () => Promise<PendingTransaction[]>)();
      
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

      // Also sync printer audits
      try {
        const { offlineSyncService } = await import('./offlineSync');
        await offlineSyncService.syncPrinterAudits();
      } catch (error) {
        console.warn('⚠️ [SMART SYNC] Printer audit sync failed:', error);
      }

      await this.syncPendingRefunds();

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
        const transactionData = JSON.parse(transaction.transaction_data) as UnknownRecord;
        
        // Ensure items array exists (even if empty)
        if (!Array.isArray(transactionData.items)) {
          transactionData.items = [];
        }
        
        // Validate required fields
        if (!transactionData.id) {
          console.warn(`⚠️ [SMART SYNC] Transaction ${transaction.id} missing required field: id`);
          const electronAPI = typeof window !== 'undefined' ? (window as { electronAPI?: UnknownRecord }).electronAPI : undefined;
          if (electronAPI?.localDbMarkTransactionFailed) {
            await (electronAPI.localDbMarkTransactionFailed as (id: number) => Promise<void>)(transaction.id);
          }
          continue;
        }
        
        // Validate business_id (required by API)
        if (!transactionData.business_id) {
          console.warn(`⚠️ [SMART SYNC] Transaction ${transaction.id} missing required field: business_id`);
          const electronAPI = typeof window !== 'undefined' ? (window as { electronAPI?: UnknownRecord }).electronAPI : undefined;
          if (electronAPI?.localDbMarkTransactionFailed) {
            await (electronAPI.localDbMarkTransactionFailed as (id: number) => Promise<void>)(transaction.id);
          }
          continue;
        }
        
        // Ensure created_at is in a valid format (ISO string or timestamp)
        if (transactionData.created_at) {
          // If it's a number (timestamp), convert to ISO string
          if (typeof transactionData.created_at === 'number') {
            transactionData.created_at = new Date(transactionData.created_at).toISOString();
          } else if (transactionData.created_at instanceof Date) {
            transactionData.created_at = transactionData.created_at.toISOString();
          }
        } else {
          // If missing, use current time
          transactionData.created_at = new Date().toISOString();
        }
        
        // Normalize payment_method and set payment_method_id
        // The database uses VARCHAR(50), not ENUM, so we preserve the original payment method
        // payment_method_id is the source of truth for the foreign key relationship
        if (transactionData.payment_method) {
          const originalPaymentMethod = String(transactionData.payment_method)
            .replace(/\0/g, '') // Remove null bytes
            .trim();
          
          // Preserve the original payment method (database supports VARCHAR, no ENUM restriction)
          transactionData.payment_method = normalizePaymentMethodString(originalPaymentMethod);
          
          // Set payment_method_id (this is the source of truth for display/relationships)
          // Use originalPaymentMethod to get the correct ID mapping
          transactionData.payment_method_id = getPaymentMethodId(originalPaymentMethod);
        } else {
          // If payment_method is missing, set defaults
          transactionData.payment_method = 'cash';
          transactionData.payment_method_id = 1; // cash ID
        }
        
        // Normalize pickup_method similarly (in case it has the same issue)
        if (transactionData.pickup_method) {
          transactionData.pickup_method = String(transactionData.pickup_method)
            .replace(/\0/g, '')
            .trim()
            .substring(0, 50);
        }
        
        // Validate items structure
        if (Array.isArray(transactionData.items)) {
          for (let i = 0; i < transactionData.items.length; i++) {
            const item = transactionData.items[i] as UnknownRecord;
            if (!item.product_id) {
              console.warn(`⚠️ [SMART SYNC] Transaction ${transaction.id} item ${i} missing required field: product_id`);
            }
            if (typeof item.quantity !== 'number') {
              console.warn(`⚠️ [SMART SYNC] Transaction ${transaction.id} item ${i} has invalid quantity`);
            }
            if (typeof item.unit_price !== 'number') {
              console.warn(`⚠️ [SMART SYNC] Transaction ${transaction.id} item ${i} has invalid unit_price`);
            }
            if (typeof item.total_price !== 'number') {
              console.warn(`⚠️ [SMART SYNC] Transaction ${transaction.id} item ${i} has invalid total_price`);
            }
          }
        }
        
        // Validate data before sync
        const validation = conflictResolutionService.validateData(transactionData);
        if (!validation.isValid) {
          console.warn(`⚠️ [SMART SYNC] Transaction ${transaction.id} validation failed:`, validation.errors);
          const electronAPI = typeof window !== 'undefined' ? (window as { electronAPI?: UnknownRecord }).electronAPI : undefined;
          if (electronAPI?.localDbMarkTransactionFailed) {
            await (electronAPI.localDbMarkTransactionFailed as (id: number) => Promise<void>)(transaction.id);
          }
          continue;
        }
        
        // Log transaction data being sent (for debugging)
        console.log(`📤 [SMART SYNC] Sending transaction ${transaction.id}:`, {
          id: transactionData.id,
          business_id: transactionData.business_id,
          items_count: Array.isArray(transactionData.items) ? transactionData.items.length : 0,
        });
        
        // DEBUG: Log payment_method to see what's being sent
        const paymentMethodValue = transactionData.payment_method;
        const paymentMethodStr = paymentMethodValue ? String(paymentMethodValue) : 'null/undefined';
        console.log(`🔍 [DEBUG] payment_method details:`, {
          payment_method: paymentMethodStr,
          payment_method_type: typeof paymentMethodValue,
          payment_method_length: paymentMethodStr.length,
          payment_method_id: transactionData.payment_method_id,
          is_object: typeof paymentMethodValue === 'object' && paymentMethodValue !== null,
          object_stringified: typeof paymentMethodValue === 'object' ? JSON.stringify(paymentMethodValue) : 'N/A',
        });
        console.log(`🔍 [DEBUG] Full transaction data (first 500 chars):`, JSON.stringify(transactionData).substring(0, 500));
        
        // Send to server
        const startTime = Date.now();
        const response = await fetch(getApiUrl('/api/transactions'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(transactionData),
        });

        const responseTime = Date.now() - startTime;
        this.serverLoadHistory.push(responseTime);

        if (response.ok) {
          await response.json();
          console.log(`✅ [SMART SYNC] Transaction ${transaction.id} synced successfully`);
          
        // Mark as synced
        const electronAPI = typeof window !== 'undefined' ? (window as { electronAPI?: UnknownRecord }).electronAPI : undefined;
        if (electronAPI?.localDbMarkTransactionSynced) {
          await (electronAPI.localDbMarkTransactionSynced as (id: number) => Promise<void>)(transaction.id);
        }

        // ALSO mark the main transaction table as synced using the UUID
        // This ensures the SyncPanel and other UI components see it as synced
        if (transactionData.id && electronAPI?.localDbMarkTransactionsSynced) {
           await (electronAPI.localDbMarkTransactionsSynced as (ids: string[]) => Promise<void>)([String(transactionData.id)]);
        }
        } else {
          // Get error response body for better debugging
          let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
          try {
            const errorBody = await response.json();
            errorMessage = `HTTP ${response.status}: ${errorBody.error || errorBody.message || response.statusText}`;
            if (errorBody.stack) {
              console.error(`📋 [SMART SYNC] Server error details:`, errorBody);
            }
          } catch {
            // If response is not JSON, try to get text
            try {
              const errorText = await response.text();
              if (errorText) {
                errorMessage = `HTTP ${response.status}: ${errorText.substring(0, 200)}`;
              }
            } catch {
              // Ignore if we can't read the response
            }
          }
          throw new Error(errorMessage);
        }

        // Small delay between individual transactions
        await this.delay(100);

      } catch (error) {
        console.error(`❌ [SMART SYNC] Failed to sync transaction ${transaction.id}:`, error);
        
        // Mark as failed (will retry later)
        const electronAPI = typeof window !== 'undefined' ? (window as { electronAPI?: UnknownRecord }).electronAPI : undefined;
        if (electronAPI?.localDbMarkTransactionFailed) {
          await (electronAPI.localDbMarkTransactionFailed as (id: number) => Promise<void>)(transaction.id);
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
      await fetch(getApiUrl('/api/health-check'), {
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
  async queueTransaction(transactionData: UnknownRecord): Promise<{ success: boolean; offlineTransactionId?: number; error?: string }> {
    const electronAPI = typeof window !== 'undefined' ? (window as { electronAPI?: UnknownRecord }).electronAPI : undefined;
    if (!isElectron || !electronAPI?.localDbQueueOfflineTransaction) {
      console.warn('⚠️ [SMART SYNC] localDbQueueOfflineTransaction not available - Electron may need restart');
      return { success: false };
    }

    try {
      const result = await (electronAPI.localDbQueueOfflineTransaction as (data: UnknownRecord) => Promise<{ success: boolean; offlineTransactionId?: number; error?: string }>)(transactionData);
      console.log('📝 [SMART SYNC] Transaction queued for offline sync');
      return result;
    } catch (error) {
      console.error('❌ [SMART SYNC] Failed to queue transaction:', error);
      return { success: false };
    }
  }

  /**
   * Queue a refund for offline sync
   */
  async queueRefund(refundData: UnknownRecord): Promise<{ success: boolean; offlineRefundId?: number; error?: string }> {
    const electronAPI = typeof window !== 'undefined' ? (window as { electronAPI?: UnknownRecord }).electronAPI : undefined;
    if (!isElectron || !electronAPI?.localDbQueueOfflineRefund) {
      console.warn('⚠️ [SMART SYNC] localDbQueueOfflineRefund not available - Electron may need restart');
      return { success: false };
    }

    try {
      const result = await (electronAPI.localDbQueueOfflineRefund as (data: UnknownRecord) => Promise<{ success: boolean; offlineRefundId?: number; error?: string }>)(refundData);
      console.log('📝 [SMART SYNC] Refund queued for offline sync');
      return result;
    } catch (error) {
      console.error('❌ [SMART SYNC] Failed to queue refund:', error);
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

      const electronAPI = typeof window !== 'undefined' ? (window as { electronAPI?: UnknownRecord }).electronAPI : undefined;
      if (!electronAPI?.localDbGetUnsyncedTransactions) {
        return 0;
      }
      // Get unsynced transactions (where synced_at IS NULL)
      const transactions = await (electronAPI.localDbGetUnsyncedTransactions as (businessId: number) => Promise<unknown[]>)(14);
      
      return Array.isArray(transactions) ? transactions.length : 0;
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

  /**
   * Sync pending refunds when online
   */
  private async syncPendingRefunds() {
    if (!isElectron || !this.isOnline) {
      return;
    }

    const electronAPI = typeof window !== 'undefined' ? (window as { electronAPI?: UnknownRecord }).electronAPI : undefined;
    if (!electronAPI?.localDbGetPendingRefunds) {
      return;
    }

    try {
      const pendingRefunds = await (electronAPI.localDbGetPendingRefunds as () => Promise<Array<{ id: number; refund_data: string }>> )();
      if (!Array.isArray(pendingRefunds) || pendingRefunds.length === 0) {
        return;
      }

      console.log(`🔄 [SMART SYNC] Found ${pendingRefunds.length} pending refunds`);

      for (const refund of pendingRefunds) {
        try {
          const payload = typeof refund.refund_data === 'string'
            ? JSON.parse(refund.refund_data) as UnknownRecord
            : (refund.refund_data as UnknownRecord);

          if (!payload || typeof payload !== 'object') {
            throw new Error('Invalid refund payload');
          }

          const transactionUuid = String(
            payload.transaction_uuid ??
            payload.transactionId ??
            payload.id ??
            ''
          );

          if (!transactionUuid) {
            console.warn('⚠️ [SMART SYNC] Refund missing transaction UUID; marking failed');
            await (electronAPI.localDbMarkRefundFailed as (id: number) => Promise<{ success: boolean }>)(refund.id);
            continue;
          }

          const response = await fetch(getApiUrl(`/api/transactions/${transactionUuid}/refund`), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
          });

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          const result = await response.json() as UnknownRecord;

          if (result.transaction && electronAPI.localDbUpsertTransactions) {
            await (electronAPI.localDbUpsertTransactions as (rows: UnknownRecord[]) => Promise<unknown>)([result.transaction as UnknownRecord]);
          }

          if (result.refund && electronAPI.localDbApplyTransactionRefund) {
            const transaction = result.transaction as UnknownRecord | undefined;
            await (electronAPI.localDbApplyTransactionRefund as (payload: UnknownRecord) => Promise<unknown>)({
              refund: result.refund,
              transactionUpdate: transaction
                ? {
                    id: String(transaction.uuid_id || transaction.id || transactionUuid),
                    refund_status: transaction.refund_status,
                    refund_total: transaction.refund_total,
                    last_refunded_at: transaction.last_refunded_at,
                    status: transaction.status,
                  }
                : undefined,
            });
          }

          await (electronAPI.localDbMarkRefundSynced as (id: number) => Promise<{ success: boolean }>)(refund.id);
          console.log(`✅ [SMART SYNC] Refund ${refund.id} synced successfully`);
        } catch (error) {
          console.error('❌ [SMART SYNC] Failed to sync refund:', error);
          await (electronAPI.localDbMarkRefundFailed as (id: number) => Promise<{ success: boolean }>)(refund.id);
        }
      }
    } catch (error) {
      console.error('❌ [SMART SYNC] Refund sync error:', error);
    }
  }
}

// Export singleton instance
export const smartSyncService = new SmartSyncService();
