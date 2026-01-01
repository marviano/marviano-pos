import { conflictResolutionService } from './conflictResolution';
import { getApiUrl } from '@/lib/api';
import { getAutoSyncEnabled, onAutoSyncSettingChanged } from './autoSyncSettings';
import { validateNotNullFields, convertTransactionDatesForMySQL, convertShiftDatesForMySQL, cleanRefundForMySQL } from './syncUtils';

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

// Date conversion and validation functions moved to syncUtils.ts

interface SyncConfig {
  maxBatchSize: number;
  syncInterval: number;
  maxRetries: number;
  retryDelay: number;
  serverLoadThreshold: number;
}

interface PendingTransaction {
  id: string; // Transaction UUID
  business_id: number;
  user_id: number;
  [key: string]: unknown; // All transaction fields
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
  private autoSyncEnabled: boolean = true;
  private settingChangeUnsubscribe: (() => void) | null = null;

  constructor() {
    // console.log('🚀 [SMART SYNC] Service initialized');
    this.autoSyncEnabled = getAutoSyncEnabled();
    this.startMonitoring();
    this.setupSettingListener();
  }

  /**
   * Start monitoring online status and manage sync
   */
  private startMonitoring() {
    // Monitor online status changes
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        console.log('🌐 [SMART SYNC] Online detected');
        this.isOnline = true;
        if (this.autoSyncEnabled) {
          this.startSmartSync();
        } else {
          // console.log('⏸️ [SMART SYNC] Auto-sync is disabled - not starting');
        }
      });

      window.addEventListener('offline', () => {
        // console.log('🌐 [SMART SYNC] Offline detected - stopping sync');
        this.isOnline = false;
        this.stopSmartSync();
      });

      // Initial check
      this.isOnline = navigator.onLine;
      if (this.isOnline && this.autoSyncEnabled) {
        this.startSmartSync();
      } else if (this.isOnline && !this.autoSyncEnabled) {
        // console.log('⏸️ [SMART SYNC] Auto-sync is disabled - not starting');
      }
    }
  }

  /**
   * Setup listener for auto-sync setting changes
   */
  private setupSettingListener() {
    if (typeof window !== 'undefined') {
      this.settingChangeUnsubscribe = onAutoSyncSettingChanged((enabled) => {
        // console.log(`🔄 [SMART SYNC] Auto-sync setting changed: ${enabled ? 'ENABLED' : 'DISABLED'}`);
        this.autoSyncEnabled = enabled;

        if (enabled && this.isOnline) {
          // Setting enabled and we're online - start sync
          this.startSmartSync();
        } else {
          // Setting disabled - stop sync
          this.stopSmartSync();
        }
      });
    }
  }

  /**
   * Start smart sync with intelligent timing
   */
  private startSmartSync() {
    // Check if auto-sync is enabled
    if (!this.autoSyncEnabled) {
      // console.log('⏸️ [SMART SYNC] Auto-sync is disabled - not starting');
      return;
    }

    if (this.syncTimer) {
      clearInterval(this.syncTimer);
    }

    // Immediate sync if we've been offline for a while
    const timeSinceLastSync = Date.now() - this.lastSyncTime;
    if (timeSinceLastSync > 300000) { // 5 minutes
      // console.log('🔄 [SMART SYNC] Long offline period - immediate sync');
      this.syncPendingTransactions();
    }

    // Start regular sync interval
    this.syncTimer = setInterval(() => {
      if (this.isOnline && !this.isSyncing && this.autoSyncEnabled) {
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
   * Returns sync result with count of synced transactions
   */
  private async syncPendingTransactions(): Promise<{ success: boolean; syncedCount: number; message: string }> {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'smartSync.ts:191',message:'syncPendingTransactions entry',data:{isElectron,isSyncing:this.isSyncing,isOnline:this.isOnline},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
    // #endregion
    console.log('🚀 [SMART SYNC] ===== STARTING SYNC =====', {
      isElectron,
      isSyncing: this.isSyncing,
      isOnline: this.isOnline,
      timestamp: new Date().toISOString()
    });

    if (!isElectron || this.isSyncing || !this.isOnline) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'smartSync.ts:199',message:'Sync skipped early return',data:{reason:!isElectron?'Not Electron':this.isSyncing?'Already syncing':'Offline',isElectron,isSyncing:this.isSyncing,isOnline:this.isOnline},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
      console.log('⏸️ [SMART SYNC] Sync skipped:', {
        reason: !isElectron ? 'Not Electron' : this.isSyncing ? 'Already syncing' : 'Offline',
        isElectron,
        isSyncing: this.isSyncing,
        isOnline: this.isOnline
      });
      return { success: false, syncedCount: 0, message: !isElectron ? 'Not Electron' : this.isSyncing ? 'Already syncing' : 'Offline' };
    }

    this.isSyncing = true;
    const syncStartTime = Date.now();

    try {
      // Check if the method is available
      const electronAPI = typeof window !== 'undefined' ? (window as { electronAPI?: UnknownRecord }).electronAPI : undefined;
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'smartSync.ts:214',message:'Electron API check',data:{hasElectronAPI:!!electronAPI,hasLocalDbGetUnsyncedTransactions:!!electronAPI?.localDbGetUnsyncedTransactions},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
      // #endregion
      if (!electronAPI?.localDbGetUnsyncedTransactions) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'smartSync.ts:216',message:'Electron API missing',data:{electronAPI:!!electronAPI,hasLocalDbGetUnsyncedTransactions:!!electronAPI?.localDbGetUnsyncedTransactions},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
        // #endregion
        console.error('❌ [SMART SYNC] localDbGetUnsyncedTransactions not available - Electron may need restart', {
          electronAPI: !!electronAPI,
          hasLocalDbGetUnsyncedTransactions: !!electronAPI?.localDbGetUnsyncedTransactions
        });
        return { success: false, syncedCount: 0, message: 'Electron API not available' };
      }

      console.log('🔍 [SMART SYNC] Fetching pending transactions...');
      // Get pending transactions (sync_status = 'pending')
      const pendingTransactions = await (electronAPI.localDbGetUnsyncedTransactions as (businessId?: number) => Promise<PendingTransaction[]>)();
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'smartSync.ts:225',message:'Pending transactions fetched',data:{count:pendingTransactions.length,firstIds:pendingTransactions.slice(0,5).map(t=>t.id)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
      // #endregion

      console.log(`📦 [SMART SYNC] Found ${pendingTransactions.length} pending transactions`, {
        count: pendingTransactions.length,
        transactionIds: pendingTransactions.slice(0, 10).map(t => t.id) // Show first 10 IDs
      });

      let syncedTransactionCount = 0;
      if (pendingTransactions.length === 0) {
        console.log('✅ [SMART SYNC] No pending transactions - proceeding to sync shifts/refunds/audits');
      } else {

        // Process in batches to prevent server overload
        const batches = this.createBatches(pendingTransactions, this.config.maxBatchSize);
        console.log(`📊 [SMART SYNC] Created ${batches.length} batch(es) of max ${this.config.maxBatchSize} transactions each`);

        for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
          const batch = batches[batchIndex];
          console.log(`🔄 [SMART SYNC] Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} transactions)`);
          const batchResult = await this.processBatch(batch);
          syncedTransactionCount += batchResult.syncedCount;

          // Add delay between batches to prevent server overload
          if (batches.length > 1 && batchIndex < batches.length - 1) {
            console.log('⏳ [SMART SYNC] Waiting 2 seconds before next batch...');
            await this.delay(2000); // 2 second delay between batches
          }
        }
        console.log('✅ [SMART SYNC] All transaction batches processed');
      }

      // Also sync shifts
      console.log('🔄 [SMART SYNC] Starting shift sync...');
      try {
        await this.syncPendingShifts();
        console.log('✅ [SMART SYNC] Shift sync completed');
      } catch (error) {
        console.error('❌ [SMART SYNC] Shift sync failed:', {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          errorObject: error
        });
      }

      // Also sync printer audits
      console.log('🔄 [SMART SYNC] Starting printer audit sync...');
      try {
        const { offlineSyncService } = await import('./offlineSync');
        await offlineSyncService.syncPrinterAudits();
        console.log('✅ [SMART SYNC] Printer audit sync completed');
      } catch (error) {
        console.error('❌ [SMART SYNC] Printer audit sync failed:', {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          errorObject: error
        });
      }

      // Also sync printer daily counters
      console.log('🔄 [SMART SYNC] Starting printer daily counters sync...');
      try {
        await this.syncPrinterDailyCounters();
        console.log('✅ [SMART SYNC] Printer daily counters sync completed');
      } catch (error) {
        console.error('❌ [SMART SYNC] Printer daily counters sync failed:', {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          errorObject: error
        });
      }

      // NOTE: Products are NOT uploaded here - server is source of truth for master data
      // Products should only be downloaded from server, not uploaded

      console.log('🔄 [SMART SYNC] Starting refund sync...');
      await this.syncPendingRefunds();
      console.log('✅ [SMART SYNC] Refund sync completed');

      this.consecutiveFailures = 0;
      this.lastSyncTime = Date.now();
      const syncDuration = Date.now() - syncStartTime;
      console.log(`✅ [SMART SYNC] ===== SYNC COMPLETED SUCCESSFULLY =====`, {
        duration: `${syncDuration}ms`,
        timestamp: new Date().toISOString(),
        syncedTransactions: syncedTransactionCount
      });

      const message = syncedTransactionCount === 0 
        ? 'No pending transactions to sync' 
        : `Synced ${syncedTransactionCount} transaction(s)`;
      return { success: true, syncedCount: syncedTransactionCount, message };

    } catch (error) {
      const syncDuration = Date.now() - syncStartTime;
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'smartSync.ts:325',message:'Sync error caught',data:{error:error instanceof Error?error.message:String(error),stack:error instanceof Error?error.stack:undefined,duration:syncDuration},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
      // #endregion
      console.error('❌ [SMART SYNC] ===== SYNC FAILED =====', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        errorObject: error,
        duration: `${syncDuration}ms`,
        timestamp: new Date().toISOString()
      });
      this.consecutiveFailures++;
      return { 
        success: false, 
        syncedCount: 0, 
        message: `Sync failed: ${error instanceof Error ? error.message : String(error)}` 
      };

      // Exponential backoff on consecutive failures
      if (this.consecutiveFailures >= 3) {
        const backoffDelay = Math.min(300000, this.config.retryDelay * Math.pow(2, this.consecutiveFailures));
        console.log(`⏳ [SMART SYNC] Backing off for ${backoffDelay}ms due to consecutive failures (count: ${this.consecutiveFailures})`);
        await this.delay(backoffDelay);
      }
    } finally {
      this.isSyncing = false;
      console.log('🏁 [SMART SYNC] Sync process finished (isSyncing set to false)');
    }
  }

  /**
   * Process a batch of transactions
   * Returns count of successfully synced transactions
   */
  private async processBatch(batch: PendingTransaction[]): Promise<{ syncedCount: number }> {
    console.log(`🔄 [SMART SYNC] Processing batch of ${batch.length} transactions`);
    let syncedCount = 0;

    for (let i = 0; i < batch.length; i++) {
      const transaction = batch[i];
      const transactionIndex = i + 1;
      console.log(`📤 [SMART SYNC] Processing transaction ${transactionIndex}/${batch.length}: ${transaction.id || 'unknown'}`);
      
      try {
        // Check server load before processing
        const serverLoad = await this.checkServerLoad();
        if (serverLoad > this.config.serverLoadThreshold) {
          console.log(`⚠️ [SMART SYNC] Server load high (${serverLoad}ms) - delaying sync`);
          await this.delay(5000);
          continue;
        }

        // Use transaction data directly from transactions table
        let transactionData = transaction as UnknownRecord;

        // Ensure items array exists (even if empty)
        if (!Array.isArray(transactionData.items)) {
          transactionData.items = [];
        }

        // Validate required fields
        if (!transactionData.id) {
          console.warn(`⚠️ [SMART SYNC] Transaction missing required field: id`);
          const electronAPI = typeof window !== 'undefined' ? (window as { electronAPI?: UnknownRecord }).electronAPI : undefined;
          if (electronAPI?.localDbMarkTransactionFailed && transaction.id) {
            await (electronAPI.localDbMarkTransactionFailed as (id: string) => Promise<void>)(String(transaction.id));
          }
          continue;
        }

        // Validate business_id (required by API)
        if (!transactionData.business_id) {
          console.warn(`⚠️ [SMART SYNC] Transaction ${transaction.id} missing required field: business_id`);
          const electronAPI = typeof window !== 'undefined' ? (window as { electronAPI?: UnknownRecord }).electronAPI : undefined;
          if (electronAPI?.localDbMarkTransactionFailed) {
            await (electronAPI.localDbMarkTransactionFailed as (id: string) => Promise<void>)(String(transaction.id));
          }
          continue;
        }

        // Phase 2: Validate NOT NULL constraints for transactions
        const transactionRequiredFields = ['id', 'business_id', 'user_id', 'payment_method', 'pickup_method', 
          'total_amount', 'final_amount', 'amount_received', 'payment_method_id', 'created_at'];
        const missingFields = validateNotNullFields(transactionData, transactionRequiredFields);
        
        if (missingFields.length > 0) {
          console.warn(`⚠️ [SMART SYNC] Transaction ${transaction.id} missing required fields: ${missingFields.join(', ')}`);
          const electronAPI = typeof window !== 'undefined' ? (window as { electronAPI?: UnknownRecord }).electronAPI : undefined;
          if (electronAPI?.localDbMarkTransactionFailed) {
            await (electronAPI.localDbMarkTransactionFailed as (id: string) => Promise<void>)(String(transaction.id));
          }
          continue;
        }

        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'smartSync.ts:335',message:'Before date conversion',data:{transactionId:transaction.id,created_at:transactionData.created_at,updated_at:transactionData.updated_at},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
        // #endregion
        // Phase 2: Convert all date fields to MySQL format
        transactionData = convertTransactionDatesForMySQL(transactionData);
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'smartSync.ts:336',message:'After date conversion',data:{transactionId:transaction.id,created_at:transactionData.created_at,updated_at:transactionData.updated_at},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
        // #endregion
        
        // Ensure created_at exists (required by MySQL)
        if (!transactionData.created_at) {
          transactionData.created_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
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

        // Validate items structure and convert DECIMAL strings to numbers
        if (Array.isArray(transactionData.items)) {
          for (let i = 0; i < transactionData.items.length; i++) {
            const item = transactionData.items[i] as UnknownRecord;
            if (!item.product_id) {
              console.warn(`⚠️ [SMART SYNC] Transaction ${transaction.id} item ${i} missing required field: product_id`);
            }
            // Convert DECIMAL strings to numbers (MySQL returns DECIMAL as strings)
            if (item.quantity !== undefined && typeof item.quantity !== 'number') {
              item.quantity = Number(item.quantity);
              if (Number.isNaN(item.quantity)) {
                console.warn(`⚠️ [SMART SYNC] Transaction ${transaction.id} item ${i} has invalid quantity`);
              }
            }
            if (item.unit_price !== undefined && typeof item.unit_price !== 'number') {
              item.unit_price = Number(item.unit_price);
              if (Number.isNaN(item.unit_price)) {
                console.warn(`⚠️ [SMART SYNC] Transaction ${transaction.id} item ${i} has invalid unit_price`);
              }
            }
            if (item.total_price !== undefined && typeof item.total_price !== 'number') {
              item.total_price = Number(item.total_price);
              if (Number.isNaN(item.total_price)) {
                console.warn(`⚠️ [SMART SYNC] Transaction ${transaction.id} item ${i} has invalid total_price`);
              }
            }
          }
        }

        // Phase 2: Enhanced validation with NOT NULL constraints
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'smartSync.ts:391',message:'Before validation',data:{transactionId:transaction.id,created_at:transactionData.created_at,updated_at:transactionData.updated_at},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
        // #endregion
        const validation = conflictResolutionService.validateData(transactionData, transactionRequiredFields);
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'smartSync.ts:392',message:'Validation result',data:{transactionId:transaction.id,isValid:validation.isValid,errors:validation.errors},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
        // #endregion
        if (!validation.isValid) {
          console.warn(`⚠️ [SMART SYNC] Transaction ${transaction.id} validation failed:`, validation.errors);
          const electronAPI = typeof window !== 'undefined' ? (window as { electronAPI?: UnknownRecord }).electronAPI : undefined;
          if (electronAPI?.localDbMarkTransactionFailed) {
            await (electronAPI.localDbMarkTransactionFailed as (id: string) => Promise<void>)(String(transaction.id));
          }
          continue;
        }

        // Log transaction data being sent (for debugging)
        console.log(`📤 [SMART SYNC] Sending transaction ${transaction.id}:`, {
          id: transactionData.id,
          business_id: transactionData.business_id,
          user_id: transactionData.user_id,
          items_count: Array.isArray(transactionData.items) ? transactionData.items.length : 0,
          total_amount: transactionData.total_amount,
          final_amount: transactionData.final_amount,
          payment_method: transactionData.payment_method,
          payment_method_id: transactionData.payment_method_id,
          pickup_method: transactionData.pickup_method,
          created_at: transactionData.created_at,
          customizations_count: Array.isArray(transactionData.transaction_item_customizations) 
            ? transactionData.transaction_item_customizations.length 
            : 0,
          options_count: Array.isArray(transactionData.transaction_item_customization_options) 
            ? transactionData.transaction_item_customization_options.length 
            : 0,
        });

        // Log full payload structure (summary)
        console.log(`📋 [SMART SYNC] Transaction payload structure:`, {
          topLevelKeys: Object.keys(transactionData),
          items: Array.isArray(transactionData.items) 
            ? transactionData.items.map((item: UnknownRecord) => ({
                id: item.id,
                product_id: item.product_id,
                quantity: item.quantity,
                unit_price: item.unit_price,
                total_price: item.total_price,
                has_custom_note: !!item.custom_note,
                has_bundle_selections: !!item.bundle_selections_json,
              }))
            : [],
          hasCustomizations: Array.isArray(transactionData.transaction_item_customizations) && 
            transactionData.transaction_item_customizations.length > 0,
          hasOptions: Array.isArray(transactionData.transaction_item_customization_options) && 
            transactionData.transaction_item_customization_options.length > 0,
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
        
        // Log full payload (truncated for readability, but more than before)
        const fullPayloadStr = JSON.stringify(transactionData, null, 2);
        console.log(`📦 [SMART SYNC] Full transaction payload (first 2000 chars):`, fullPayloadStr.substring(0, 2000));
        if (fullPayloadStr.length > 2000) {
          console.log(`📦 [SMART SYNC] ... (payload truncated, total length: ${fullPayloadStr.length} chars)`);
        }

        // Fetch transaction items and normalized customizations from actual database tables
        // This ensures we get the latest data with UUIDs and proper structure
        const electronAPI = typeof window !== 'undefined' ? (window as { electronAPI?: UnknownRecord }).electronAPI : undefined;
        if (electronAPI?.localDbGetTransactionItems && electronAPI?.localDbGetTransactionItemCustomizationsNormalized && transactionData.id) {
          try {
            // Fetch transaction items from transaction_items table (source of truth)
            const rawItems = await (electronAPI.localDbGetTransactionItems as (transactionId: string) => Promise<Array<UnknownRecord>>)(String(transactionData.id));

            // Map items to upload format (with UUIDs and ALL columns)
            if (Array.isArray(rawItems) && rawItems.length > 0) {
              transactionData.items = rawItems.map(item => {
                const itemData: UnknownRecord = {
                  id: item.id as string, // UUID
                  product_id: item.product_id as number,
                  quantity: item.quantity as number,
                  unit_price: item.unit_price as number,
                  total_price: item.total_price as number,
                  custom_note: item.custom_note as string | undefined,
                  bundle_selections_json: item.bundle_selections_json as unknown | undefined,
                };

                // Add created_at if it exists (convert to MySQL format)
                if (item.created_at) {
                  itemData.created_at = typeof item.created_at === 'string' 
                    ? item.created_at.replace('T', ' ').slice(0, 19) 
                    : item.created_at;
                }

                return itemData;
              });
              console.log(`✅ [SMART SYNC] Fetched ${rawItems.length} items from transaction_items table for transaction ${transactionData.id}`);
            }

            // Fetch normalized customizations
            const normalizedCustomizations = await (electronAPI.localDbGetTransactionItemCustomizationsNormalized as (transactionId: string) => Promise<{
              customizations: Array<{
                id: number;
                transaction_item_id: string;
                customization_type_id: number;
                bundle_product_id: number | null;
                created_at: string;
              }>;
              options: Array<{
                id: number;
                transaction_item_customization_id: number;
                customization_option_id: number;
                option_name: string;
                price_adjustment: number;
                created_at: string;
              }>;
            }>)(String(transactionData.id));

            // Add normalized customization arrays to transaction data
            transactionData.transaction_item_customizations = normalizedCustomizations.customizations;
            transactionData.transaction_item_customization_options = normalizedCustomizations.options;

            // Log customization details for debugging
            console.log(`✅ [SMART SYNC] Added ${normalizedCustomizations.customizations.length} customizations and ${normalizedCustomizations.options.length} options to transaction ${transactionData.id}`);
            
            // Debug: Log customization details to detect if all options are being sent
            if (normalizedCustomizations.customizations.length > 0) {
              const customizationDetails = normalizedCustomizations.customizations.map(cust => {
                const optionsForCust = normalizedCustomizations.options.filter(
                  (opt: any) => opt.transaction_item_customization_id === cust.id
                );
                return {
                  customization_id: cust.id,
                  customization_type_id: cust.customization_type_id,
                  options_count: optionsForCust.length,
                  option_names: optionsForCust.map((opt: any) => opt.option_name).slice(0, 5) // First 5 option names
                };
              });
              console.log(`🔍 [SMART SYNC] Customization details:`, JSON.stringify(customizationDetails, null, 2));
              
              // Warn if there are suspiciously many options (might indicate all options are stored)
              const totalOptions = normalizedCustomizations.options.length;
              const totalCustomizations = normalizedCustomizations.customizations.length;
              if (totalOptions > 0 && totalCustomizations > 0) {
                const avgOptionsPerCust = totalOptions / totalCustomizations;
                if (avgOptionsPerCust > 10) {
                  console.warn(`⚠️ [SMART SYNC] WARNING: Average ${avgOptionsPerCust.toFixed(1)} options per customization - this might indicate all available options are stored instead of just selected ones!`);
                }
              }
            }
          } catch (error) {
            console.warn(`⚠️ [SMART SYNC] Failed to fetch transaction items or normalized customizations for transaction ${transactionData.id}:`, error);
            // Continue with items from JSON blob if fetch fails - backward compatibility
          }
        }

        // Send to server
        const startTime = Date.now();
        const apiUrl = getApiUrl('/api/transactions');
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'smartSync.ts:567',message:'Before fetch transaction',data:{apiUrl,transactionId:transaction.id,uuidId:transactionData.uuid_id||transactionData.id,businessId:transactionData.business_id,envApiUrl:process.env.NEXT_PUBLIC_API_URL,hasItems:Array.isArray(transactionData.items),itemsCount:Array.isArray(transactionData.items)?transactionData.items.length:0,transactionKeys:Object.keys(transactionData).slice(0,20)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
        // #endregion
        console.log(`🌐 [SMART SYNC] Sending transaction ${transaction.id} to server:`, {
          url: apiUrl,
          transactionId: transaction.id,
          businessId: transactionData.business_id,
          itemsCount: Array.isArray(transactionData.items) ? transactionData.items.length : 0
        });

        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(transactionData),
        });
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'smartSync.ts:580',message:'Fetch response received',data:{status:response.status,statusText:response.statusText,ok:response.ok,transactionId:transaction.id,uuidId:transactionData.uuid_id||transactionData.id,responseHeaders:Object.fromEntries(response.headers.entries())},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
        // #endregion

        const responseTime = Date.now() - startTime;
        this.serverLoadHistory.push(responseTime);

        console.log(`📥 [SMART SYNC] Server response for transaction ${transaction.id}:`, {
          status: response.status,
          statusText: response.statusText,
          responseTime: `${responseTime}ms`,
          headers: Object.fromEntries(response.headers.entries()),
        });

        if (response.ok) {
          const result = await response.json();
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'smartSync.ts:632',message:'Response OK - parsing result',data:{transactionId:transaction.id,uuidId:transactionData.uuid_id||transactionData.id,resultSuccess:result.success,resultMessage:result.message,resultKeys:Object.keys(result),fullResult:JSON.stringify(result).substring(0,500)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
          // #endregion
          console.log(`✅ [SMART SYNC] Transaction ${transaction.id} synced successfully`, {
            responseTime: `${responseTime}ms`,
            resultKeys: Object.keys(result),
            resultSummary: {
              success: result.success,
              message: result.message,
              transactionId: result.transaction?.id || result.id,
              transactionUuid: result.transaction?.uuid_id || result.uuid_id || transactionData.uuid_id,
              serverInsertId: result.insertId || result.transaction?.id,
              insertedCount: result.insertedCount,
              updatedCount: result.updatedCount,
              receiptNumber: result.receiptNumber || result.transaction?.receipt_number,
            },
            fullResult: result,
          });
          
          // Log server confirmation details for verification
          if (result.success) {
            console.log(`🔍 [SMART SYNC] Server confirmed transaction:`, {
              localId: transaction.id,
              localUuid: transactionData.uuid_id,
              serverId: result.insertId || result.transaction?.id || result.id,
              serverUuid: result.transaction?.uuid_id || result.uuid_id || transactionData.uuid_id,
              receiptNumber: result.receiptNumber || result.transaction?.receipt_number,
              message: result.message,
            });
          }

          // Mark transaction as synced
          // CRITICAL FIX: Use uuid_id instead of id, because localDbMarkTransactionsSynced expects UUID strings
          // Ensure we have the UUID - use uuid_id if available, otherwise use id (which should be the UUID string from the database)
          const electronAPI = typeof window !== 'undefined' ? (window as { electronAPI?: UnknownRecord }).electronAPI : undefined;
          const transactionUuid = transactionData.uuid_id || transactionData.id || transaction.id;
          
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'smartSync.ts:640',message:'Before marking as synced',data:{transactionId:transaction.id,uuidId:transactionUuid,hasUuidId:!!transactionUuid,hasElectronAPI:!!electronAPI,hasMarkFunction:!!electronAPI?.localDbMarkTransactionsSynced,transactionDataUuidId:transactionData.uuid_id,transactionDataId:transactionData.id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
          // #endregion
          
          if (transactionUuid && electronAPI?.localDbMarkTransactionsSynced) {
            try {
              await (electronAPI.localDbMarkTransactionsSynced as (ids: string[]) => Promise<void>)([String(transactionUuid)]);
              // #region agent log
              fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'smartSync.ts:644',message:'Marked as synced successfully',data:{transactionId:transaction.id,uuidId:transactionUuid},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
              // #endregion
              console.log(`✅ [SMART SYNC] Marked transaction ${transaction.id} (uuid: ${transactionUuid}) as synced in local database`);
              syncedCount++;
            } catch (markError) {
              // #region agent log
              fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'smartSync.ts:648',message:'Failed to mark as synced',data:{transactionId:transaction.id,uuidId:transactionUuid,error:markError instanceof Error?markError.message:String(markError)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
              // #endregion
              console.error(`❌ [SMART SYNC] Failed to mark transaction ${transaction.id} (uuid: ${transactionUuid}) as synced:`, {
                error: markError instanceof Error ? markError.message : String(markError),
                stack: markError instanceof Error ? markError.stack : undefined,
                errorObject: markError
              });
            }
          } else {
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'smartSync.ts:655',message:'Cannot mark as synced - missing requirements',data:{transactionId:transaction.id,transactionUuid,hasUuidId:!!transactionUuid,hasElectronAPI:!!electronAPI,hasMarkFunction:!!electronAPI?.localDbMarkTransactionsSynced},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
            // #endregion
            console.warn(`⚠️ [SMART SYNC] Cannot mark transaction as synced:`, {
              transactionUuid,
              hasUuidId: !!transactionUuid,
              hasElectronAPI: !!electronAPI,
              hasMarkFunction: !!electronAPI?.localDbMarkTransactionsSynced
            });
          }
        } else {
          // Get error response body for better debugging
          let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
          let errorBody: UnknownRecord | null = null;
          try {
            errorBody = await response.json();
            console.error(`❌ [SMART SYNC] Server error response for transaction ${transaction.id}:`, {
              status: response.status,
              statusText: response.statusText,
              responseTime: `${responseTime}ms`,
              headers: Object.fromEntries(response.headers.entries()),
              errorBodyKeys: errorBody ? Object.keys(errorBody) : [],
              errorBody: errorBody,
              errorMessage: errorBody?.error || errorBody?.message || errorBody?.errorMessage || 'Unknown error',
            });

            if (errorBody) {
              errorMessage = `HTTP ${response.status}: ${errorBody.error || errorBody.message || response.statusText}`;

              // Check if transaction already exists (duplicate) - should mark as synced
              if (response.status === 409 || (errorBody.error && typeof errorBody.error === 'string' && (errorBody.error.includes('already exists') || errorBody.error.includes('duplicate')))) {
                console.log(`⚠️ [SMART SYNC] Transaction ${transaction.id} already exists on server (duplicate), marking as synced`);
                const electronAPI = typeof window !== 'undefined' ? (window as { electronAPI?: UnknownRecord }).electronAPI : undefined;
                if (transactionData.id && electronAPI?.localDbMarkTransactionsSynced) {
                  try {
                    await (electronAPI.localDbMarkTransactionsSynced as (ids: string[]) => Promise<void>)([String(transactionData.id)]);
                    console.log(`✅ [SMART SYNC] Marked duplicate transaction ${transactionData.id} as synced`);
                    syncedCount++;
                    continue; // Don't throw error for duplicates, continue to next transaction
                  } catch (markError) {
                    console.error(`❌ [SMART SYNC] Failed to mark duplicate transaction ${transactionData.id} as synced:`, {
                      error: markError instanceof Error ? markError.message : String(markError),
                      stack: markError instanceof Error ? markError.stack : undefined,
                      errorObject: markError
                    });
                  }
                }
              }

              if (errorBody.stack) {
                console.error(`📋 [SMART SYNC] Server error stack trace:`, errorBody.stack);
              }
            }
          } catch (parseError) {
            // If response is not JSON, try to get text
            console.warn(`⚠️ [SMART SYNC] Failed to parse error response as JSON for transaction ${transaction.id}:`, parseError);
            try {
              const errorText = await response.text();
              if (errorText) {
                errorMessage = `HTTP ${response.status}: ${errorText.substring(0, 200)}`;
                console.error(`❌ [SMART SYNC] Server error text for transaction ${transaction.id}:`, errorText.substring(0, 500));
              }
            } catch (textError) {
              console.error(`❌ [SMART SYNC] Failed to read error response text for transaction ${transaction.id}:`, textError);
              // Ignore if we can't read the response
            }
          }
          throw new Error(errorMessage);
        }

        // Small delay between individual transactions
        await this.delay(100);

      } catch (error) {
        console.error(`❌ [SMART SYNC] Failed to sync transaction ${transaction.id}:`, {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          errorObject: error,
          transactionId: transaction.id
        });

        // Mark as failed (will retry later)
        const electronAPI = typeof window !== 'undefined' ? (window as { electronAPI?: UnknownRecord }).electronAPI : undefined;
        if (electronAPI?.localDbMarkTransactionFailed && transaction.id) {
          try {
            await (electronAPI.localDbMarkTransactionFailed as (id: string) => Promise<void>)(String(transaction.id));
            console.log(`⚠️ [SMART SYNC] Marked transaction ${transaction.id} as failed for retry`);
          } catch (markError) {
            console.error(`❌ [SMART SYNC] Failed to mark transaction ${transaction.id} as failed:`, {
              error: markError instanceof Error ? markError.message : String(markError),
              stack: markError instanceof Error ? markError.stack : undefined
            });
          }
        }

        // If too many failures, stop processing this batch
        const syncAttempts = (transaction as UnknownRecord).sync_attempts as number | undefined;
        if (syncAttempts !== undefined && syncAttempts >= this.config.maxRetries) {
          console.warn(`🚫 [SMART SYNC] Transaction ${transaction.id} exceeded max retries (${syncAttempts}/${this.config.maxRetries}) - skipping`);
        }
      }
    }
    return { syncedCount };
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
   * Returns sync result with count of synced transactions
   */
  async forceSync(): Promise<{ success: boolean; syncedCount: number; message: string }> {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'smartSync.ts:792',message:'forceSync entry',data:{isOnline:this.isOnline,isSyncing:this.isSyncing,navigatorOnLine:typeof navigator!=='undefined'?navigator.onLine:undefined},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    console.log('🔘 [SMART SYNC] forceSync() called manually', {
      isOnline: this.isOnline,
      isSyncing: this.isSyncing,
      timestamp: new Date().toISOString()
    });

    if (!this.isOnline) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'smartSync.ts:802',message:'forceSync skipped offline',data:{isOnline:this.isOnline},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
      return { success: false, syncedCount: 0, message: 'Offline - cannot sync' };
    }

    if (this.isSyncing) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'smartSync.ts:807',message:'forceSync skipped already syncing',data:{isSyncing:this.isSyncing},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
      return { success: false, syncedCount: 0, message: 'Sync already in progress' };
    }

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'smartSync.ts:812',message:'Calling syncPendingTransactions',data:{timestamp:Date.now()},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    const result = await this.syncPendingTransactions();
    return result;
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
      autoSyncEnabled: this.autoSyncEnabled,
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
      // Use localDbGetUnsyncedTransactions to get ALL pending transactions (sync_status = 'pending')
      // This matches what the sync process uses and ensures we count all pending transactions
      if (!electronAPI?.localDbGetUnsyncedTransactions) {
        return 0;
      }

      const pendingTransactions = await (electronAPI.localDbGetUnsyncedTransactions as (businessId?: number) => Promise<PendingTransaction[]>)();
      return Array.isArray(pendingTransactions) ? pendingTransactions.length : 0;
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
    if (this.settingChangeUnsubscribe) {
      this.settingChangeUnsubscribe();
      this.settingChangeUnsubscribe = null;
    }
  }

  /**
   * Sync pending refunds when online
   */
  /**
   * Sync pending shifts to server
   */
  private async syncPendingShifts() {
    console.log('🔄 [SMART SYNC] Starting shift sync...', {
      isElectron,
      isOnline: this.isOnline
    });

    if (!isElectron || !this.isOnline) {
      console.log('⏸️ [SMART SYNC] Shift sync skipped:', {
        reason: !isElectron ? 'Not Electron' : 'Offline'
      });
      return;
    }

    const electronAPI = typeof window !== 'undefined' ? (window as { electronAPI?: UnknownRecord }).electronAPI : undefined;
    if (!electronAPI?.localDbGetUnsyncedShifts) {
      console.warn('⚠️ [SMART SYNC] localDbGetUnsyncedShifts not available');
      return;
    }

    try {
      // Get all unsynced shifts regardless of business_id
      // Each shift already has its business_id in the data, so we sync all of them
      console.log('🔍 [SMART SYNC] Fetching unsynced shifts...');
      const unsyncedShifts = await (electronAPI.localDbGetUnsyncedShifts as (businessId?: number) => Promise<unknown[]>)(undefined);

      if (!Array.isArray(unsyncedShifts) || unsyncedShifts.length === 0) {
        console.log('✅ [SMART SYNC] No unsynced shifts found');
        return;
      }

      console.log(`🔄 [SMART SYNC] Found ${unsyncedShifts.length} unsynced shifts`, {
        count: unsyncedShifts.length,
        shiftIds: unsyncedShifts.slice(0, 10).map((s: unknown) => (s as UnknownRecord).id || (s as UnknownRecord).uuid_id) // Show first 10 IDs
      });

      // Format shifts for server (server expects { shifts: [...] })
      const formattedShifts = unsyncedShifts.map(shift => {
        const shiftRecord = shift as unknown as UnknownRecord;
        
        // Phase 2: Validate NOT NULL constraints for shifts
        const shiftRequiredFields = ['uuid_id', 'business_id', 'user_id', 'shift_start'];
        const missingFields = validateNotNullFields(shiftRecord, shiftRequiredFields);
        
        if (missingFields.length > 0) {
          console.warn(`⚠️ [SMART SYNC] Shift missing required fields: ${missingFields.join(', ')}`);
          return null; // Will be filtered out
        }

        // Phase 2: Convert all date fields to MySQL format
        const convertedShift = convertShiftDatesForMySQL(shiftRecord);

        return {
          id: convertedShift.uuid_id || String(convertedShift.id),
          uuid: convertedShift.uuid_id || String(convertedShift.id),
          business_id: convertedShift.business_id,
          user_id: convertedShift.user_id,
          shift_start: convertedShift.shift_start,
          shift_end: convertedShift.shift_end || null,
          starting_cash: convertedShift.modal_awal || convertedShift.starting_cash || 0,
          ending_cash: convertedShift.kas_akhir || convertedShift.ending_cash || null,
          cash_drawer_difference: convertedShift.kas_selisih || convertedShift.cash_drawer_difference || null,
          status: convertedShift.status || 'active',
          closed_by: convertedShift.closed_by || null,
          closed_at: convertedShift.closed_at || null,
          created_at: convertedShift.created_at || convertedShift.shift_start,
          updated_at: convertedShift.updated_at || null,
        };
      }).filter((shift): shift is NonNullable<typeof shift> => shift !== null); // Remove null entries

      try {
        const shiftsUrl = getApiUrl('/api/shifts');
        console.log(`🌐 [SMART SYNC] Sending ${formattedShifts.length} shifts to server:`, {
          url: shiftsUrl,
          shiftsCount: formattedShifts.length,
          shiftIds: formattedShifts.slice(0, 10).map(s => s.id || s.uuid),
          payloadSummary: formattedShifts.map(s => ({
            id: s.id || s.uuid,
            business_id: s.business_id,
            user_id: s.user_id,
            shift_start: s.shift_start,
            status: s.status,
          })),
        });

        const shiftsPayload = { shifts: formattedShifts };
        console.log(`📦 [SMART SYNC] Shifts payload (first 1500 chars):`, JSON.stringify(shiftsPayload, null, 2).substring(0, 1500));

        const response = await fetch(shiftsUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(shiftsPayload),
        });

        console.log(`📥 [SMART SYNC] Server response for shifts:`, {
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries()),
        });

        if (response.ok) {
          const result = await response.json();
          console.log(`✅ [SMART SYNC] Shifts sync server response:`, {
            resultKeys: Object.keys(result),
            resultSummary: {
              success: result.success,
              message: result.message,
              insertedCount: result.insertedCount,
              updatedCount: result.updatedCount,
              skippedCount: result.skippedCount,
            },
            fullResult: result,
          });
          
          const syncedShiftIds: number[] = unsyncedShifts.map(s => (s as UnknownRecord).id).filter((id): id is number => typeof id === 'number');

          if (syncedShiftIds.length > 0 && electronAPI?.localDbMarkShiftsSynced) {
            await (electronAPI.localDbMarkShiftsSynced as (shiftIds: number[]) => Promise<unknown>)(syncedShiftIds);
            console.log(`✅ [SMART SYNC] Marked ${syncedShiftIds.length} shifts as synced in local database`);
          }

          console.log(`✅ [SMART SYNC] ${result.insertedCount || formattedShifts.length} shifts synced successfully (${result.updatedCount || 0} updated, ${result.skippedCount || 0} skipped)`);
        } else {
          const errorText = await response.text();
          console.error(`❌ [SMART SYNC] Failed to sync shifts:`, {
            status: response.status,
            statusText: response.statusText,
            errorText: errorText.substring(0, 500)
          });
        }
      } catch (error) {
        console.error('❌ [SMART SYNC] Failed to sync shifts:', {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          errorObject: error
        });
      }


    } catch (error) {
      console.error('❌ [SMART SYNC] Shift sync error (outer catch):', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        errorObject: error
      });
    }
  }

  /**
   * Sync products and prices from local to server (overwrite server)
   */
  private async syncProductsToServer() {
    if (!isElectron || !this.isOnline) {
      return;
    }

    const electronAPI = typeof window !== 'undefined' ? (window as { electronAPI?: UnknownRecord }).electronAPI : undefined;
    if (!electronAPI?.localDbGetAllProducts) {
      return;
    }

    try {
      console.log('🔄 [SMART SYNC] Starting products and prices sync (upload to server)...');

      // Get business_id from the first product or use default
      const allProducts = await (electronAPI.localDbGetAllProducts as () => Promise<Array<UnknownRecord>>)();

      if (!Array.isArray(allProducts) || allProducts.length === 0) {
        console.log('✅ [SMART SYNC] No products to sync');
        return;
      }

      // Get business_id from first product (assuming all products are for same business)
      const businessId = (allProducts[0] as UnknownRecord)?.business_id as number;
      if (!businessId) {
        console.warn('⚠️ [SMART SYNC] Cannot sync products - no business_id found');
        return;
      }

      // Format products for server import API
      const productsToUpload = allProducts.map((product: UnknownRecord) => {
        return {
          menu_code: product.menu_code || '',
          nama: product.nama || '',
          satuan: product.satuan || '',
          kategori: product.category1_name || '',
          jenis: product.category2_name || product.jenis || '',
          keterangan: product.keterangan || '',
          harga_beli: product.harga_beli || 0,
          ppn: product.ppn || 0,
          harga_umum: product.harga_jual || 0,
          harga_khusus: product.harga_khusus || 0,
          harga_online: product.harga_online || 0,
          fee_kerja: product.fee_kerja || 0,
        };
      });

      // Get POS API key from environment
      // In Next.js, NEXT_PUBLIC_ vars are embedded at build time
      const posApiKey = process.env.NEXT_PUBLIC_POS_SYNC_API_KEY || '';

      if (!posApiKey) {
        console.warn('⚠️ [SMART SYNC] POS_SYNC_API_KEY not found - products sync will fail');
      }

      const response = await fetch(getApiUrl('/api/products'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-POS-API-Key': posApiKey, // Send API key for authentication
        },
        body: JSON.stringify({
          action: 'import',
          data: productsToUpload,
          businessId: businessId,
        }),
      });

      if (response.ok) {
        const result = await response.json() as UnknownRecord;
        console.log(`✅ [SMART SYNC] ${result.successCount || productsToUpload.length} products synced to server (${result.errorCount || 0} errors)`);
      } else {
        const errorText = await response.text();
        console.warn(`⚠️ [SMART SYNC] Failed to sync products: ${response.status} - ${errorText}`);
      }
    } catch (error) {
      console.error('❌ [SMART SYNC] Products sync error:', error);
    }
  }

  /**
   * Sync pending refunds to server
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
      const pendingRefunds = await (electronAPI.localDbGetPendingRefunds as () => Promise<Array<{ id: number; refund_data: string }>>)();
      if (!Array.isArray(pendingRefunds) || pendingRefunds.length === 0) {
        return;
      }

      console.log(`🔄 [SMART SYNC] Found ${pendingRefunds.length} pending refunds`, {
        refundIds: pendingRefunds.map(r => r.id)
      });

      for (let i = 0; i < pendingRefunds.length; i++) {
        const refund = pendingRefunds[i];
        console.log(`🔄 [SMART SYNC] Processing refund ${i + 1}/${pendingRefunds.length}: ${refund.id}`);
        
        try {
          const payload = typeof refund.refund_data === 'string'
            ? JSON.parse(refund.refund_data) as UnknownRecord
            : (refund.refund_data as UnknownRecord);

          if (!payload || typeof payload !== 'object') {
            throw new Error('Invalid refund payload');
          }

          // Phase 2: Validate NOT NULL constraints for refunds
          const refundRequiredFields = ['transaction_uuid', 'business_id', 'refunded_by', 'refund_amount', 
            'payment_method_id', 'refunded_at'];
          const missingFields = validateNotNullFields(payload, refundRequiredFields);
          
          if (missingFields.length > 0) {
            console.warn(`⚠️ [SMART SYNC] Refund ${refund.id} missing required fields: ${missingFields.join(', ')}`);
            await (electronAPI.localDbMarkRefundFailed as (id: number) => Promise<{ success: boolean }>)(refund.id);
            continue;
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

          // Phase 2 Part 2: Clean and validate refund data (ENUMs, dates, etc.)
          const cleanedPayload = cleanRefundForMySQL(payload);
          
          // Ensure refunded_at exists (required by MySQL)
          if (!cleanedPayload.refunded_at) {
            cleanedPayload.refunded_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
          }
          
          // Update payload with cleaned data
          Object.assign(payload, cleanedPayload);

          const refundUrl = getApiUrl(`/api/transactions/${transactionUuid}/refund`);
          console.log(`🌐 [SMART SYNC] Sending refund ${refund.id} to server:`, {
            url: refundUrl,
            refundId: refund.id,
            transactionUuid,
            refundAmount: payload.refund_amount,
            payloadKeys: Object.keys(payload),
          });

          console.log(`📦 [SMART SYNC] Refund payload:`, {
            transaction_uuid: payload.transaction_uuid,
            business_id: payload.business_id,
            refunded_by: payload.refunded_by,
            refund_amount: payload.refund_amount,
            payment_method_id: payload.payment_method_id,
            refunded_at: payload.refunded_at,
            reason: payload.reason,
            fullPayload: payload,
          });

          const response = await fetch(refundUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
          });

          console.log(`📥 [SMART SYNC] Server response for refund ${refund.id}:`, {
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries()),
          });

          if (!response.ok) {
            let errorText = '';
            let errorBody: UnknownRecord | null = null;
            try {
              errorText = await response.text();
              try {
                errorBody = JSON.parse(errorText);
              } catch {
                // Not JSON, use as text
              }
              console.error(`❌ [SMART SYNC] Refund ${refund.id} server error response:`, {
                status: response.status,
                statusText: response.statusText,
                errorText: errorText.substring(0, 500),
                errorBody: errorBody,
                errorMessage: errorBody?.error || errorBody?.message || errorText.substring(0, 200),
              });
            } catch {
              // Ignore if we can't read response
            }
            throw new Error(`HTTP ${response.status}: ${response.statusText}${errorText ? ` - ${errorText.substring(0, 200)}` : ''}`);
          }

          // IMPORTANT: Do NOT download transaction data from server response
          // Local database is the source of truth for transactions
          // We only verify the refund was accepted by the server (response.ok)
          const result = await response.json() as UnknownRecord;
          console.log(`✅ [SMART SYNC] Refund ${refund.id} server response data:`, {
            resultKeys: Object.keys(result),
            resultSummary: {
              success: result.success,
              message: result.message,
              refundId: result.refund?.id,
            },
            fullResult: result,
          });

          // If refund was successfully created on server, just mark it as synced locally
          // Do NOT update local transaction with server data - local DB is source of truth
          // The refund record was already inserted and transaction was already updated when the refund was created locally
          if (result.refund && electronAPI.localDbApplyTransactionRefund) {
            console.log(`🔄 [SMART SYNC] Marking refund ${refund.id} as synced (transaction already updated locally)`);
            // Use the UUID from the original refund data (offline_refunds table) to match the existing record
            // This prevents creating duplicate refund records
            const refundData = typeof refund.refund_data === 'string'
              ? JSON.parse(refund.refund_data) as UnknownRecord
              : (refund.refund_data as UnknownRecord);
            const localRefundUuid = refundData.uuid_id as string;
            
            // Only update the refund record's synced_at, do NOT update transaction
            // Pass empty transactionUpdate object to skip transaction update
            await (electronAPI.localDbApplyTransactionRefund as (payload: UnknownRecord) => Promise<unknown>)({
              refund: {
                ...result.refund,
                uuid_id: localRefundUuid // Use local UUID to match existing record
              },
              transactionUpdate: {
                id: transactionUuid,
                // Explicitly pass undefined for all fields to prevent transaction update
                refund_status: undefined,
                refund_total: undefined,
                last_refunded_at: undefined,
                status: undefined
              }
            });
          }

          await (electronAPI.localDbMarkRefundSynced as (id: number) => Promise<{ success: boolean }>)(refund.id);
          console.log(`✅ [SMART SYNC] Refund ${refund.id} synced successfully and marked as synced`);
        } catch (error) {
          console.error(`❌ [SMART SYNC] Failed to sync refund ${refund.id}:`, {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            errorObject: error,
            refundId: refund.id,
            transactionUuid
          });
          try {
            await (electronAPI.localDbMarkRefundFailed as (id: number) => Promise<{ success: boolean }>)(refund.id);
            console.log(`⚠️ [SMART SYNC] Marked refund ${refund.id} as failed for retry`);
          } catch (markError) {
            console.error(`❌ [SMART SYNC] Failed to mark refund ${refund.id} as failed:`, {
              error: markError instanceof Error ? markError.message : String(markError),
              stack: markError instanceof Error ? markError.stack : undefined
            });
          }
        }
      }
    } catch (error) {
      console.error('❌ [SMART SYNC] Refund sync error (outer catch):', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        errorObject: error
      });
    }
  }

  /**
   * Sync printer daily counters to server
   */
  private async syncPrinterDailyCounters() {
    if (!isElectron || !this.isOnline) {
      return;
    }

    const electronAPI = typeof window !== 'undefined' ? (window as { electronAPI?: UnknownRecord }).electronAPI : undefined;
    if (!electronAPI?.localDbGetAllPrinterDailyCounters) {
      console.warn('⚠️ [SMART SYNC] localDbGetAllPrinterDailyCounters not available');
      return;
    }

    try {
      console.log('🔄 [SMART SYNC] Starting printer daily counters sync...');

      const allCounters = await (electronAPI.localDbGetAllPrinterDailyCounters as () => Promise<Array<{ printer_type: string; business_id: number; date: string; counter: number }>>)();

      if (!Array.isArray(allCounters) || allCounters.length === 0) {
        console.log('✅ [SMART SYNC] No printer daily counters to sync');
        return;
      }

      console.log(`📦 [SMART SYNC] Found ${allCounters.length} printer daily counters to sync`);

      const response = await fetch(getApiUrl('/api/printer-daily-counters'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          counters: allCounters
        }),
      });

      if (response.ok) {
        const result = await response.json() as UnknownRecord;
        console.log(`✅ [SMART SYNC] ${result.insertedCount || allCounters.length} printer daily counters synced to server (${result.updatedCount || 0} updated, ${result.skippedCount || 0} skipped)`);
      } else {
        const errorText = await response.text();
        console.warn(`⚠️ [SMART SYNC] Failed to sync printer daily counters: ${response.status} - ${errorText}`);
      }
    } catch (error) {
      console.error('❌ [SMART SYNC] Printer daily counters sync error:', error);
    }
  }
}

// Export singleton instance
export const smartSyncService = new SmartSyncService();
