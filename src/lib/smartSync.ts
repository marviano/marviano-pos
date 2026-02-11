import { conflictResolutionService } from './conflictResolution';
import { getApiUrl, cleanUrl } from '@/lib/api';
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

    console.log('🚀 [SMART SYNC] ===== STARTING SYNC =====', {
      isElectron,
      isSyncing: this.isSyncing,
      isOnline: this.isOnline,
      timestamp: new Date().toISOString()
    });

    if (!isElectron || this.isSyncing || !this.isOnline) {
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
      const electronAPI = typeof window !== 'undefined' ? (window as { electronAPI?: UnknownRecord }).electronAPI : undefined;if (!electronAPI?.localDbGetUnsyncedTransactions) {console.error('❌ [SMART SYNC] localDbGetUnsyncedTransactions not available - Electron may need restart', {
          electronAPI: !!electronAPI,
          hasLocalDbGetUnsyncedTransactions: !!electronAPI?.localDbGetUnsyncedTransactions
        });
        return { success: false, syncedCount: 0, message: 'Electron API not available' };
      }

      console.log('🔍 [SMART SYNC] Fetching pending transactions...');
      // Get pending transactions (sync_status = 'pending')
      const pendingTransactions = await (electronAPI.localDbGetUnsyncedTransactions as (businessId?: number) => Promise<PendingTransaction[]>)();
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
          const batchResult = await this.processBatch(batch, false);
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
        await this.syncPrinterAudits();
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
      const syncDuration = Date.now() - syncStartTime;console.error('❌ [SMART SYNC] ===== SYNC FAILED =====', {
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
   * Returns count of successfully synced transactions, skipped, and failed
   */
  private async processBatch(
    batch: PendingTransaction[], 
    forceSync: boolean = false,
    onProgress?: (transaction: PendingTransaction, status: string) => void
  ): Promise<{ syncedCount: number; skippedCount: number; failedCount: number }> {

    console.log(`🔄 [SMART SYNC] Processing batch of ${batch.length} transactions${forceSync ? ' (FORCE SYNC)' : ''}`);
    let syncedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

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
          skippedCount++;
          if (onProgress) onProgress(transaction, 'skipped: server load high');
          continue;
        }


        // Use transaction data directly from transactions table
        let transactionData = transaction as UnknownRecord;

        // Ensure all important columns are included (even if they're null/undefined)
        // Add missing columns that might not be in the transaction object
        if (!transactionData.uuid_id && transactionData.id) {
          // uuid_id might be the same as id if id is UUID string
          transactionData.uuid_id = typeof transactionData.id === 'string' ? transactionData.id : transactionData.uuid_id;
        }
        
        // Ensure these columns are included (they might be null/undefined, which is fine)
        if (transactionData.shift_uuid === undefined) transactionData.shift_uuid = null;
        if (transactionData.refund_status === undefined) transactionData.refund_status = 'none';
        if (transactionData.refund_total === undefined) transactionData.refund_total = 0;
        if (transactionData.last_refunded_at === undefined) transactionData.last_refunded_at = null;
        if (transactionData.contact_id === undefined) transactionData.contact_id = null;
        if (transactionData.receipt_number === undefined) transactionData.receipt_number = null;
        if (transactionData.table_id === undefined) transactionData.table_id = null;
        if (transactionData.waiter_id === undefined) transactionData.waiter_id = null;

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
          skippedCount++;
          if (onProgress) onProgress(transaction, 'skipped: missing id');
          continue;
        }

        // Validate business_id (required by API)
        if (!transactionData.business_id) {
          console.warn(`⚠️ [SMART SYNC] Transaction ${transaction.id} missing required field: business_id`);
          const electronAPI = typeof window !== 'undefined' ? (window as { electronAPI?: UnknownRecord }).electronAPI : undefined;
          if (electronAPI?.localDbMarkTransactionFailed) {
            await (electronAPI.localDbMarkTransactionFailed as (id: string) => Promise<void>)(String(transaction.id));
          }
          skippedCount++;
          if (onProgress) onProgress(transaction, 'skipped: missing business_id');
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
          skippedCount++;
          if (onProgress) onProgress(transaction, `skipped: missing fields (${missingFields.join(', ')})`);
          continue;
        }// Phase 2: Convert all date fields to MySQL format
        transactionData = convertTransactionDatesForMySQL(transactionData);// Ensure created_at exists (required by MySQL)
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
        // For pending transactions, skip the "too old" check since they need to be synced regardless of age
        // Only validate required fields, not age
        const fieldValidation = validateNotNullFields(transactionData, transactionRequiredFields);
        if (fieldValidation.length > 0) {
          console.warn(`⚠️ [SMART SYNC] Transaction ${transaction.id} missing required fields: ${fieldValidation.join(', ')}`);
          const electronAPI = typeof window !== 'undefined' ? (window as { electronAPI?: UnknownRecord }).electronAPI : undefined;
          if (electronAPI?.localDbMarkTransactionFailed) {
            await (electronAPI.localDbMarkTransactionFailed as (id: string) => Promise<void>)(String(transaction.id));
          }
          skippedCount++;
          if (onProgress) onProgress(transaction, `skipped: missing fields (${fieldValidation.join(', ')})`);
          continue;
        }
        // Skip conflictResolutionService.validateData() for pending transactions - it checks age which blocks old pending transactions
        // Pending transactions should be synced regardless of age

        // Log transaction data being sent (for debugging)
        console.log(`📤 [SMART SYNC] Sending transaction ${transaction.id}:`, {
          id: transactionData.id,
          uuid_id: transactionData.uuid_id,
          business_id: transactionData.business_id,
          user_id: transactionData.user_id,
          shift_uuid: transactionData.shift_uuid,
          items_count: Array.isArray(transactionData.items) ? transactionData.items.length : 0,
          total_amount: transactionData.total_amount,
          final_amount: transactionData.final_amount,
          payment_method: transactionData.payment_method,
          payment_method_id: transactionData.payment_method_id,
          pickup_method: transactionData.pickup_method,
          refund_status: transactionData.refund_status,
          refund_total: transactionData.refund_total,
          contact_id: transactionData.contact_id,
          receipt_number: transactionData.receipt_number,
          table_id: transactionData.table_id,
          created_at: transactionData.created_at,
          customizations_count: Array.isArray(transactionData.transaction_item_customizations) 
            ? transactionData.transaction_item_customizations.length 
            : 0,
          options_count: Array.isArray(transactionData.transaction_item_customization_options) 
            ? transactionData.transaction_item_customization_options.length 
            : 0,
          activity_logs_count: Array.isArray(transactionData.activity_logs) 
            ? transactionData.activity_logs.length 
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
                  // All required and important columns
                  id: item.id as string | number, // Numeric ID
                  uuid_id: item.uuid_id as string | undefined, // UUID
                  transaction_id: item.transaction_id as number | undefined, // Numeric transaction ID
                  uuid_transaction_id: item.uuid_transaction_id as string | undefined, // UUID transaction ID
                  product_id: item.product_id as number,
                  quantity: item.quantity as number,
                  unit_price: item.unit_price as number,
                  total_price: item.total_price as number,
                  custom_note: item.custom_note as string | undefined,
                  bundle_selections_json: item.bundle_selections_json as unknown | undefined,
                  waiter_id: item.waiter_id as number | null | undefined, // Who added this line item (per-waiter achievement)
                  // Production status columns (CRITICAL - updated by Kitchen/Barista)
                  production_status: item.production_status as string | null | undefined,
                  production_started_at: item.production_started_at ? (
                    typeof item.production_started_at === 'string' 
                      ? item.production_started_at.replace('T', ' ').slice(0, 19) 
                      : item.production_started_at
                  ) : null,
                  production_finished_at: item.production_finished_at ? (
                    typeof item.production_finished_at === 'string' 
                      ? item.production_finished_at.replace('T', ' ').slice(0, 19) 
                      : item.production_finished_at
                  ) : null,
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
                uuid_transaction_item_id: string | null;
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
                  (opt: Record<string, unknown>) => opt.transaction_item_customization_id === cust.id
                );
                return {
                  customization_id: cust.id,
                  customization_type_id: cust.customization_type_id,
                  options_count: optionsForCust.length,
                  option_names: optionsForCust.map((opt: Record<string, unknown>) => opt.option_name as string).slice(0, 5) // First 5 option names
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

        // Fetch activity_logs related to this transaction
        // Activity logs might reference transaction_id in the details JSON
        // Reuse electronAPI from outer scope or get it if not available
        const activityLogsElectronAPI = typeof window !== 'undefined' ? (window as { electronAPI?: UnknownRecord }).electronAPI : undefined;
        if (activityLogsElectronAPI?.localDbGetActivityLogsByTransactionId && transactionData.id) {
          try {
            const activityLogs = await (activityLogsElectronAPI.localDbGetActivityLogsByTransactionId as (transactionId: string) => Promise<Array<UnknownRecord>>)(String(transactionData.id));
            if (Array.isArray(activityLogs) && activityLogs.length > 0) {
              // Convert dates to MySQL format
              const formattedActivityLogs = activityLogs.map((log: UnknownRecord) => {
                const formattedLog: UnknownRecord = {
                  id: log.id,
                  user_id: log.user_id,
                  action: log.action,
                  business_id: log.business_id,
                  details: log.details,
                };
                
                // Format created_at
                if (log.created_at) {
                  formattedLog.created_at = typeof log.created_at === 'string' 
                    ? log.created_at.replace('T', ' ').slice(0, 19) 
                    : log.created_at;
                }
                
                return formattedLog;
              });
              
              transactionData.activity_logs = formattedActivityLogs;
              console.log(`✅ [SMART SYNC] Added ${formattedActivityLogs.length} activity log(s) for transaction ${transactionData.id}`);
            }
          } catch (error) {
            console.warn(`⚠️ [SMART SYNC] Failed to fetch activity logs for transaction ${transactionData.id}:`, error);
            // Continue without activity logs if fetch fails
          }
        } else {
          // If API doesn't exist, try to fetch all activity logs and filter by transaction_id in details
          // This is a fallback approach
          if (activityLogsElectronAPI?.localDbGetActivityLogs) {
            try {
              const allActivityLogs = await (activityLogsElectronAPI.localDbGetActivityLogs as (businessId?: number) => Promise<Array<UnknownRecord>>)(transactionData.business_id as number);
              if (Array.isArray(allActivityLogs)) {
                const transactionIdStr = String(transactionData.id);
                const relatedLogs = allActivityLogs.filter((log: UnknownRecord) => {
                  // Check if details JSON contains transaction_id
                  if (log.details) {
                    try {
                      const details = typeof log.details === 'string' ? JSON.parse(log.details) : log.details;
                      return details.transaction_id === transactionIdStr || 
                             details.transaction_id === transactionData.uuid_id ||
                             String(details.transaction_id) === transactionIdStr;
                    } catch {
                      // If details is not JSON, check if it contains transaction ID as string
                      const detailsStr = String(log.details);
                      return detailsStr.includes(transactionIdStr) || 
                             (transactionData.uuid_id && detailsStr.includes(String(transactionData.uuid_id)));
                    }
                  }
                  return false;
                });
                
                if (relatedLogs.length > 0) {
                  const formattedActivityLogs = relatedLogs.map((log: UnknownRecord) => {
                    const formattedLog: UnknownRecord = {
                      id: log.id,
                      user_id: log.user_id,
                      action: log.action,
                      business_id: log.business_id,
                      details: log.details,
                    };
                    
                    if (log.created_at) {
                      formattedLog.created_at = typeof log.created_at === 'string' 
                        ? log.created_at.replace('T', ' ').slice(0, 19) 
                        : log.created_at;
                    }
                    
                    return formattedLog;
                  });
                  
                  transactionData.activity_logs = formattedActivityLogs;
                  console.log(`✅ [SMART SYNC] Added ${formattedActivityLogs.length} activity log(s) for transaction ${transactionData.id} (via fallback method)`);
                }
              }
            } catch (error) {
              console.warn(`⚠️ [SMART SYNC] Failed to fetch activity logs via fallback for transaction ${transactionData.id}:`, error);
            }
          }
        }

        // Send to server
        const startTime = Date.now();
        const apiUrl = getApiUrl('/api/transactions');
        
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
        });const responseTime = Date.now() - startTime;
        this.serverLoadHistory.push(responseTime);

        console.log(`📥 [SMART SYNC] Server response for transaction ${transaction.id}:`, {
          status: response.status,
          statusText: response.statusText,
          responseTime: `${responseTime}ms`,
          headers: Object.fromEntries(response.headers.entries()),
        });

        if (response.ok) {
          const result = await response.json();
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
          if (transactionUuid && electronAPI?.localDbMarkTransactionsSynced) {
            try {
              await (electronAPI.localDbMarkTransactionsSynced as (ids: string[]) => Promise<void>)([String(transactionUuid)]);
              console.log(`✅ [SMART SYNC] Marked transaction ${transaction.id} (uuid: ${transactionUuid}) as synced in local database`);
              syncedCount++;
              if (onProgress) onProgress(transaction, 'synced');
            } catch (markError) {
              console.error(`❌ [SMART SYNC] Failed to mark transaction ${transaction.id} (uuid: ${transactionUuid}) as synced:`, {
                error: markError instanceof Error ? markError.message : String(markError),
                stack: markError instanceof Error ? markError.stack : undefined,
                errorObject: markError
              });
            }
          } else {
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
              // Handle both 409 (Conflict) and 500 (Internal Server Error) with duplicate key errors
              const errorStr = String(errorBody.error || '').toLowerCase();
              const messageStr = String(errorBody.message || '').toLowerCase();
              const errorMessageStr = String(errorMessage || '').toLowerCase();
              const isDuplicate = response.status === 409 || 
                errorStr.includes('duplicate') || 
                errorStr.includes('already exists') ||
                messageStr.includes('duplicate') ||
                messageStr.includes('already exists') ||
                errorMessageStr.includes('duplicate') ||
                (errorStr.includes('duplicate entry') && errorStr.includes('for key'));


              if (isDuplicate) {
                console.log(`⚠️ [SMART SYNC] Transaction ${transaction.id} already exists on server (duplicate), marking as synced`);
                const electronAPI = typeof window !== 'undefined' ? (window as { electronAPI?: UnknownRecord }).electronAPI : undefined;
                // Use uuid_id if available, otherwise use id
                const transactionUuid = transactionData.uuid_id || transactionData.id || transaction.id;
                if (transactionUuid && electronAPI?.localDbMarkTransactionsSynced) {
                  try {
                    await (electronAPI.localDbMarkTransactionsSynced as (ids: string[]) => Promise<void>)([String(transactionUuid)]);
                    console.log(`✅ [SMART SYNC] Marked duplicate transaction ${transaction.id} (uuid: ${transactionUuid}) as synced`);
                    syncedCount++;
                    if (onProgress) onProgress(transaction, 'synced: duplicate (already exists)');
                    continue; // Don't throw error for duplicates, continue to next transaction
                  } catch (markError) {
                    console.error(`❌ [SMART SYNC] Failed to mark duplicate transaction ${transaction.id} as synced:`, {
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
          failedCount++;
          if (onProgress) onProgress(transaction, 'failed');
        } else {
          failedCount++;
          if (onProgress) onProgress(transaction, 'failed');
        }
      }
    }

    return { syncedCount, skippedCount, failedCount };
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
  async forceSync(): Promise<{ success: boolean; syncedCount: number; message: string }> {console.log('🔘 [SMART SYNC] forceSync() called manually', {
      isOnline: this.isOnline,
      isSyncing: this.isSyncing,
      timestamp: new Date().toISOString()
    });

    if (!this.isOnline) {return { success: false, syncedCount: 0, message: 'Offline - cannot sync' };
    }

    if (this.isSyncing) {return { success: false, syncedCount: 0, message: 'Sync already in progress' };
    }const result = await this.syncPendingTransactions();
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
   * Re-sync ALL transactions (regardless of sync_status)
   * This forces a re-upload of all transactions to the server
   */
  async resyncAllTransactions(businessId?: number, onProgress?: (progress: { current: number; total: number; transactionId: string | number; status: string }) => void): Promise<{ success: boolean; syncedCount: number; skippedCount: number; failedCount: number; message: string }> {

    console.log('🔄 [RE-SYNC] Starting re-sync of ALL transactions', { businessId, isElectron, isOnline: this.isOnline });

    if (!isElectron || !this.isOnline) {
      const message = !isElectron ? 'Not Electron' : 'Offline';
      return { success: false, syncedCount: 0, skippedCount: 0, failedCount: 0, message };
    }

    const electronAPI = typeof window !== 'undefined' ? (window as { electronAPI?: UnknownRecord }).electronAPI : undefined;
    if (!electronAPI?.localDbGetAllTransactions) {
      const message = 'localDbGetAllTransactions not available';
      return { success: false, syncedCount: 0, skippedCount: 0, failedCount: 0, message };
    }

    try {
      // Get ALL transactions (not just unsynced)
      const allTransactions = await (electronAPI.localDbGetAllTransactions as (businessId?: number) => Promise<PendingTransaction[]>)(businessId);
      console.log(`📦 [RE-SYNC] Found ${allTransactions.length} transactions to re-sync`);

      let syncedCount = 0;
      let skippedCount = 0;
      let failedCount = 0;

      // Process in batches
      const batches = this.createBatches(allTransactions, this.config.maxBatchSize);
      console.log(`📊 [RE-SYNC] Processing ${batches.length} batch(es)`);

      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batch = batches[batchIndex];
        console.log(`🔄 [RE-SYNC] Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} transactions)`);

        const result = await this.processBatch(batch, true, (tx, status) => {
          if (onProgress) {
            const txIndex = allTransactions.findIndex(t => (t as any).id === (tx as any).id);
            onProgress({
              current: txIndex + 1,
              total: allTransactions.length,
              transactionId: (tx as any).id,
              status
            });
          }
        });

        syncedCount += result.syncedCount;
        skippedCount += result.skippedCount;
        failedCount += result.failedCount;

        // Small delay between batches to prevent server overload
        if (batchIndex < batches.length - 1) {
          await this.delay(1000);
        }
      }

      const message = `Re-synced ${syncedCount} transactions (${skippedCount} skipped, ${failedCount} failed)`;
      console.log(`✅ [RE-SYNC] ${message}`);
      return { success: true, syncedCount, skippedCount, failedCount, message };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('❌ [RE-SYNC] Error during re-sync:', error);
      return { success: false, syncedCount: 0, skippedCount: 0, failedCount: 0, message: errorMessage };
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
        
        let transactionUuid: string = '';
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

          transactionUuid = String(
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

          // #region agent log
          fetch('http://127.0.0.1:7243/ingest/c52d9ed7-b40f-421d-845b-2964011203fd',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'smartSync.ts:refund-pre-send',message:'Refund request payload and URL',data:{refundId:refund.id,transactionUuid,refundUrl:getApiUrl(`/api/transactions/${transactionUuid}/refund`),payloadKeys:Object.keys(payload),refund_amount:payload.refund_amount,refund_amount_type:typeof payload.refund_amount,payment_method_id:payload.payment_method_id,payment_method_id_type:typeof payload.payment_method_id,refunded_at:payload.refunded_at,refund_type:payload.refund_type,status:payload.status,fullPayload:payload},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'A'})}).catch(()=>{});
          // #endregion

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
              // #region agent log
              fetch('http://127.0.0.1:7243/ingest/c52d9ed7-b40f-421d-845b-2964011203fd',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'smartSync.ts:refund-error',message:'Refund 500 server response body',data:{refundId:refund.id,status:response.status,statusText:response.statusText,errorText:errorText,errorBody:errorBody},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'B'})}).catch(()=>{});
              // #endregion
              const errMsg = String(errorBody?.error ?? errorBody?.message ?? errorText);

              // Handle 404 Transaction not found: check local DB, delete refund if tx missing, or upsert tx then retry next cycle
              if (response.status === 404 && errMsg.includes('Transaction not found')) {
                const checkResult = electronAPI.localDbCheckTransactionExists
                  ? await (electronAPI.localDbCheckTransactionExists as (uuid: string) => Promise<{ exists: boolean }>)(transactionUuid)
                  : { exists: false };
                if (!checkResult?.exists) {
                  console.log(`🗑️ [SMART SYNC] Refund ${refund.id}: Transaction ${transactionUuid} not in local DB - deleting orphan refund`);
                  if (electronAPI.localDbDeleteRefund) {
                    await (electronAPI.localDbDeleteRefund as (id: number) => Promise<{ success?: boolean }>)(refund.id);
                  }
                  continue;
                }
                console.log(`🔄 [SMART SYNC] Refund ${refund.id}: Transaction ${transactionUuid} found locally - syncing transaction to server first`);
                if (electronAPI.localDbResetTransactionSync) {
                  await (electronAPI.localDbResetTransactionSync as (id: string) => Promise<{ success?: boolean }>)(transactionUuid);
                }
                const pendingAfterReset = await (electronAPI.localDbGetUnsyncedTransactions as (businessId?: number) => Promise<PendingTransaction[]>)();
                const txToSync = Array.isArray(pendingAfterReset) ? pendingAfterReset.find((t: PendingTransaction) => t.id === transactionUuid) : undefined;
                if (txToSync) {
                  const batchResult = await this.processBatch([txToSync], false);
                  if (batchResult.syncedCount > 0) {
                    console.log(`✅ [SMART SYNC] Transaction ${transactionUuid} synced - retrying refund ${refund.id} now`);
                    const retryResponse = await fetch(refundUrl, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(payload),
                    });
                    if (retryResponse.ok) {
                      const result = await retryResponse.json() as UnknownRecord;
                      if (result.refund && electronAPI.localDbApplyTransactionRefund) {
                        const refundData = typeof refund.refund_data === 'string'
                          ? JSON.parse(refund.refund_data) as UnknownRecord
                          : (refund.refund_data as UnknownRecord);
                        const localRefundUuid = refundData.uuid_id as string;
                        await (electronAPI.localDbApplyTransactionRefund as (p: UnknownRecord) => Promise<unknown>)({
                          refund: { ...result.refund, uuid_id: localRefundUuid },
                          transactionUpdate: { id: transactionUuid, refund_status: undefined, refund_total: undefined, last_refunded_at: undefined, status: undefined },
                        });
                      }
                      await (electronAPI.localDbMarkRefundSynced as (id: number) => Promise<{ success: boolean }>)(refund.id);
                      console.log(`✅ [SMART SYNC] Refund ${refund.id} synced successfully after transaction upsert`);
                      continue;
                    }
                    console.log(`⚠️ [SMART SYNC] Refund ${refund.id} retry returned ${retryResponse.status} - will retry next sync cycle`);
                    continue;
                  }
                }
              }

              const isDuplicateRefund = errMsg.includes('Duplicate entry') && errMsg.includes('uk_transaction_refunds_uuid');
              if (isDuplicateRefund) {
                // Refund already exists on server (idempotent retry) - mark as synced and continue
                console.log(`✅ [SMART SYNC] Refund ${refund.id} already exists on server (duplicate key), marking as synced`);
                await (electronAPI.localDbMarkRefundSynced as (id: number) => Promise<{ success: boolean }>)(refund.id);
                console.log(`✅ [SMART SYNC] Refund ${refund.id} marked as synced (idempotent)`);
                continue;
              }
              console.error(`❌ [SMART SYNC] Refund ${refund.id} server error response:`, {
                status: response.status,
                statusText: response.statusText,
                errorText: errorText.substring(0, 500),
                errorBody: errorBody,
                errorMessage: errMsg.substring(0, 200),
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
              refundId: result.refund && typeof result.refund === 'object' && 'id' in result.refund 
                ? (result.refund as { id: unknown }).id 
                : undefined,
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
   * Sync printer audit logs to server
   * Public method so it can be called from other components
   */
  async syncPrinterAudits() {
    if (!isElectron || !this.isOnline) {
      return;
    }

    const electronAPI = typeof window !== 'undefined' ? (window as { electronAPI?: UnknownRecord }).electronAPI : undefined;
    if (!electronAPI?.localDbGetUnsyncedPrinterAudits) {
      console.warn('⚠️ [SMART SYNC] localDbGetUnsyncedPrinterAudits not available');
      return;
    }

    try {
      const unsyncedAudits = await (electronAPI.localDbGetUnsyncedPrinterAudits as () => Promise<{ p1?: unknown[]; p2?: unknown[] } | null>)?.();
      const printer1Audits = Array.isArray(unsyncedAudits?.p1) ? unsyncedAudits.p1 : [];
      const printer2Audits = Array.isArray(unsyncedAudits?.p2) ? unsyncedAudits.p2 : [];

      if (printer1Audits.length === 0 && printer2Audits.length === 0) {
        console.log('✅ [SMART SYNC] No printer audit logs to sync');
        return;
      }

      console.log(`📦 [SMART SYNC] Found ${printer1Audits.length} Printer 1 and ${printer2Audits.length} Printer 2 audit logs`);

      const auditUrl = cleanUrl(getApiUrl('/api/printer-audits'));
      const response = await fetch(auditUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          printer1Audits,
          printer2Audits
        }),
      });

      if (response.ok) {
        const result = await response.json();
        console.log('✅ [SMART SYNC] Printer audits synced successfully:', JSON.stringify(result, null, 2));

        const toIdArray = (audits: unknown[]): number[] => {
          return audits
            .map((audit) => (audit as { id?: number | string })?.id)
            .filter((id): id is number => typeof id === 'number')
            .concat(
              audits
                .map((audit) => (audit as { id?: number | string })?.id)
                .filter((id): id is string => typeof id === 'string')
                .map((id) => parseInt(id, 10))
                .filter((id) => !isNaN(id))
            );
        };
        
        if (electronAPI.localDbMarkPrinterAuditsSynced) {
          await (electronAPI.localDbMarkPrinterAuditsSynced as (payload: { p1Ids: number[]; p2Ids: number[] }) => Promise<{ success: boolean }>)?.({
            p1Ids: toIdArray(printer1Audits),
            p2Ids: toIdArray(printer2Audits),
          });
          console.log(`✅ [SMART SYNC] Marked ${printer1Audits.length + printer2Audits.length} printer audits as synced`);
        }
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      console.error('❌ [SMART SYNC] Failed to sync printer audits:', error);
      throw error; // Re-throw to be caught by caller
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
