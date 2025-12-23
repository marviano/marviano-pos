import { getApiUrl } from '@/lib/api';
import { convertTransactionDatesForMySQL, convertShiftDatesForMySQL } from './syncUtils';

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
   * DISABLED: system_pos database has been dropped
   */
  private startMonitoring() {
    // Service is disabled - return early
    return;
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
   * DISABLED: system_pos database has been dropped
   */
  async sync(): Promise<{ synced: number; failed: number }> {
    // DISABLED: system_pos database has been dropped
    console.log('⚠️ [SYSTEM POS SYNC] sync() called but service is DISABLED - system_pos database has been dropped');
    return { synced: 0, failed: 0 };
    
    // Original code disabled below (system_pos database has been dropped):
    /*
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

      // Filter pending transactions (synced_at IS NULL)
      // Allow max-retry transactions through for server check (they'll be handled specially)
      const pendingQueue = Array.isArray(result.queue)
        ? result.queue.filter((q: QueuedTransaction) => !q.synced_at)
        : [];

      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'systemPosSync.ts:218',message:'Pending queue filtered',data:{totalQueue:result.queue?.length||0,pendingCount:pendingQueue.length,exceededMaxRetries:result.queue?.filter((q:QueuedTransaction)=>q.retry_count>=this.config.maxRetries&&!q.synced_at).length||0,retryCounts:pendingQueue.map((q:QueuedTransaction)=>({id:q.transaction_id,retry:q.retry_count,synced_at:q.synced_at}))},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'A'})}).catch(()=>{});
      // #endregion

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
    */
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
   * Check if transaction exists on server and get its updated_at timestamp
   * Uses the system-pos transactions endpoint to check by UUID
   */
  private async checkTransactionOnServer(transactionId: string): Promise<{ exists: boolean; updated_at: string | null }> {
    try {
      // Try to use system-pos transactions endpoint if it supports GET
      // Otherwise, fall back to regular transactions endpoint with search
      // For now, we'll use a direct query approach by fetching transactions
      // and searching for the UUID. In production, you might want to add
      // a dedicated endpoint like GET /api/system-pos/transactions/:id
      
      // Fetch recent transactions (limit to reasonable number for search)
      // We'll search in the last 1000 transactions which should cover most cases
      const response = await fetch(getApiUrl(`/api/transactions?limit=1000`), {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'systemPosSync.ts:280',message:'Server check failed - response not OK',data:{transactionId,status:response.status},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
        // #endregion
        return { exists: false, updated_at: null };
      }

      const result = await response.json();
      if (result.success && Array.isArray(result.transactions)) {
        const transaction = result.transactions.find((t: UnknownRecord) => String(t.id) === String(transactionId));
        if (transaction) {
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'systemPosSync.ts:288',message:'Transaction found on server',data:{transactionId,updated_at:transaction.updated_at||transaction.created_at},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
          // #endregion
          return { 
            exists: true, 
            updated_at: transaction.updated_at || transaction.created_at || null 
          };
        }
      }

      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'systemPosSync.ts:296',message:'Transaction not found on server',data:{transactionId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
      // #endregion
      return { exists: false, updated_at: null };
    } catch (error) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'systemPosSync.ts:319',message:'Error checking transaction on server',data:{transactionId,error:error instanceof Error?error.message:String(error),errorStack:error instanceof Error?error.stack:undefined},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
      // #endregion
      console.error(`❌ [SYSTEM POS SYNC] Error checking transaction ${transactionId} on server:`);
      if (error instanceof Error) {
        console.error(`❌ [SYSTEM POS SYNC] Error message:`, error.message);
        if (error.stack) {
          console.error(`❌ [SYSTEM POS SYNC] Error stack:`, error.stack);
        }
      } else {
        console.error(`❌ [SYSTEM POS SYNC] Error object:`, error);
      }
      return { exists: false, updated_at: null };
    }
  }

  /**
   * Process a batch of transactions
   */
  private async processBatch(batch: QueuedTransaction[]): Promise<{ synced: number; failed: number }> {
    // console.log(`🔄 [SYSTEM POS SYNC] Processing batch of ${batch.length} transactions`);

    let synced = 0;
    let failed = 0;

    for (const queuedTx of batch) {
      // Handle transactions that exceeded max retries - check server status first
      if (queuedTx.retry_count >= this.config.maxRetries) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'systemPosSync.ts:295',message:'Transaction exceeded max retries - checking server',data:{transactionId:queuedTx.transaction_id,retryCount:queuedTx.retry_count,maxRetries:this.config.maxRetries},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
        // #endregion

        try {
          // Check if transaction exists on server
          const serverCheck = await this.checkTransactionOnServer(queuedTx.transaction_id);
          
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'systemPosSync.ts:301',message:'Server check result for max-retry transaction',data:{transactionId:queuedTx.transaction_id,exists:serverCheck.exists,serverUpdatedAt:serverCheck.updated_at},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
          // #endregion

          if (serverCheck.exists) {
            // Transaction exists on server - compare updated_at timestamps
            const localTransaction = await this.fetchTransactionData(queuedTx.transaction_id);
            
            if (localTransaction && localTransaction.transaction) {
              const tx = localTransaction.transaction as { updated_at?: string | number; created_at?: string | number };
              // Use updated_at if available, otherwise fall back to created_at
              const localUpdatedAt = tx.updated_at || tx.created_at;
              const localUpdatedAtTime = localUpdatedAt ? new Date(localUpdatedAt).getTime() : 0;
              // Server already returns updated_at or created_at as fallback
              const serverUpdatedAtTime = serverCheck.updated_at ? new Date(serverCheck.updated_at).getTime() : 0;

              // #region agent log
              fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'systemPosSync.ts:312',message:'Comparing updated_at timestamps',data:{transactionId:queuedTx.transaction_id,localUpdatedAt:localUpdatedAt,localTime:localUpdatedAtTime,serverUpdatedAt:serverCheck.updated_at,serverTime:serverUpdatedAtTime,localIsNewer:localUpdatedAtTime>serverUpdatedAtTime},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
              // #endregion

              if (localUpdatedAtTime > serverUpdatedAtTime) {
                // Local is newer (e.g., refund was added) - reset retry count and retry sync
                console.log(`🔄 [SYSTEM POS SYNC] Transaction ${queuedTx.transaction_id} exists on server but local is newer (local: ${localUpdatedAt}, server: ${serverCheck.updated_at}), resetting retry count and retrying sync`);
                // #region agent log
                fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'systemPosSync.ts:363',message:'Local is newer - resetting retry count',data:{transactionId:queuedTx.transaction_id,localUpdatedAt,serverUpdatedAt:serverCheck.updated_at},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
                // #endregion
                
                // Reset retry count to allow retry
                const electronAPI = (window as { electronAPI?: UnknownRecord }).electronAPI;
                if (electronAPI?.resetSystemPosRetryCount) {
                  await (electronAPI.resetSystemPosRetryCount as (transactionIds?: string[]) => Promise<{ success: boolean; count?: number }>)([queuedTx.transaction_id]);
                }
                
                // Now retry the sync (it will be processed in the next iteration or immediately if we continue)
                try {
                  await this.syncTransaction(queuedTx);
                  synced++;
                  continue;
                } catch (error) {
                  console.error(`❌ [SYSTEM POS SYNC] Retry failed for ${queuedTx.transaction_id} after resetting retry count:`);
                  if (error instanceof Error) {
                    console.error(`❌ [SYSTEM POS SYNC] Error message:`, error.message);
                    if (error.stack) {
                      console.error(`❌ [SYSTEM POS SYNC] Error stack:`, error.stack);
                    }
                  } else {
                    console.error(`❌ [SYSTEM POS SYNC] Error object:`, error);
                  }
                  failed++;
                  continue;
                }
              } else {
                // Server is same or newer - mark as synced
                console.log(`✅ [SYSTEM POS SYNC] Transaction ${queuedTx.transaction_id} exists on server and is up-to-date (local: ${localUpdatedAt || 'N/A'}, server: ${serverCheck.updated_at}), marking as synced`);
                const electronAPI = (window as { electronAPI?: UnknownRecord }).electronAPI;
                if (electronAPI?.markSystemPosSynced) {
                  await (electronAPI.markSystemPosSynced as (transactionId: string) => Promise<{ success: boolean }>)(queuedTx.transaction_id);
                }
                synced++;
                continue;
              }
            } else {
              // Couldn't fetch local transaction - skip
              console.warn(`⚠️ [SYSTEM POS SYNC] Could not fetch local transaction ${queuedTx.transaction_id} for comparison`);
              failed++;
              continue;
            }
          } else {
            // Transaction doesn't exist on server - try to sync it again
            // This will trigger auto-sync of missing products if needed
            console.log(`🔄 [SYSTEM POS SYNC] Transaction ${queuedTx.transaction_id} exceeded max retries but doesn't exist on server. Attempting to sync (will auto-sync missing products if needed)...`);
            
            // Reset retry count to allow retry
            const electronAPI = (window as { electronAPI?: UnknownRecord }).electronAPI;
            if (electronAPI?.resetSystemPosRetryCount) {
              await (electronAPI.resetSystemPosRetryCount as (transactionIds?: string[]) => Promise<{ success: boolean; count?: number }>)([queuedTx.transaction_id]);
            }
            
            // Now try to sync - this will trigger missing products auto-sync if needed
            try {
              await this.syncTransaction(queuedTx);
              synced++;
              continue;
            } catch (error) {
              console.error(`❌ [SYSTEM POS SYNC] Retry failed for ${queuedTx.transaction_id}:`, error);
              failed++;
              continue;
            }
          }
        } catch (error) {
          console.error(`❌ [SYSTEM POS SYNC] Error checking server for transaction ${queuedTx.transaction_id}:`);
          if (error instanceof Error) {
            console.error(`❌ [SYSTEM POS SYNC] Error message:`, error.message);
            if (error.stack) {
              console.error(`❌ [SYSTEM POS SYNC] Error stack:`, error.stack);
            }
          } else {
            console.error(`❌ [SYSTEM POS SYNC] Error object:`, error);
          }
          failed++;
          continue;
        }
      }

      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'systemPosSync.ts:287',message:'About to sync transaction',data:{transactionId:queuedTx.transaction_id,retryCount:queuedTx.retry_count},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
      try {
        await this.syncTransaction(queuedTx);
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'systemPosSync.ts:289',message:'Transaction sync succeeded',data:{transactionId:queuedTx.transaction_id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
        // #endregion
        synced++;
      } catch (error) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'systemPosSync.ts:430',message:'Transaction sync failed in processBatch',data:{transactionId:queuedTx.transaction_id,retryCount:queuedTx.retry_count,error:error instanceof Error?error.message:String(error),errorStack:error instanceof Error?error.stack:undefined},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
        // #endregion
        console.error(`❌ [SYSTEM POS SYNC] Error processing transaction ${queuedTx.transaction_id} in processBatch:`);
        if (error instanceof Error) {
          console.error(`❌ [SYSTEM POS SYNC] Error message:`, error.message);
          if (error.stack) {
            console.error(`❌ [SYSTEM POS SYNC] Error stack:`, error.stack);
          }
        } else {
          console.error(`❌ [SYSTEM POS SYNC] Error object:`, error);
        }
        failed++;
      }
    }

    return { synced, failed };
  }

  /**
   * Extract product IDs from transaction items
   */
  private extractProductIdsFromTransaction(transactionData: UnknownRecord): number[] {
    const items = transactionData.items as Array<{ product_id?: number }> | undefined;
    if (!Array.isArray(items)) {
      return [];
    }
    return items
      .map(item => item.product_id)
      .filter((id): id is number => typeof id === 'number' && id > 0);
  }

  /**
   * Fetch products from SQLite by product IDs
   */
  private async fetchProductsFromSQLite(productIds: number[]): Promise<UnknownRecord[]> {
    const electronAPI = (window as { electronAPI?: UnknownRecord }).electronAPI;
    if (!electronAPI?.localDbGetAllProducts) {
      console.warn('⚠️ [SYSTEM POS SYNC] localDbGetAllProducts not available');
      return [];
    }

    try {
      const allProducts = await (electronAPI.localDbGetAllProducts as () => Promise<Array<UnknownRecord>>)();
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'systemPosSync.ts:513',message:'Fetched all products from SQLite',data:{allProductsCount:allProducts?.length||0,requestedProductIds:productIds,firstProduct:allProducts?.[0]?Object.keys(allProducts[0]):[]},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
      // #endregion
      if (!Array.isArray(allProducts)) {
        return [];
      }
      
      // Filter products by the requested IDs
      const filtered = allProducts.filter((product: UnknownRecord) => {
        const productId = product.id as number | undefined;
        return productId && productIds.includes(productId);
      });
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'systemPosSync.ts:522',message:'Filtered products by IDs',data:{filteredCount:filtered.length,filteredProductIds:filtered.map((p:UnknownRecord)=>p.id),filteredFirstProduct:filtered[0]?Object.keys(filtered[0]):[],filteredFirstProductBusinessId:filtered[0]?(filtered[0] as UnknownRecord).business_id:undefined},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
      // #endregion
      return filtered;
    } catch (error) {
      console.error('❌ [SYSTEM POS SYNC] Error fetching products from SQLite:', error);
      return [];
    }
  }

  /**
   * Sync products to System POS (or main system if System POS uses same products)
   * Note: This assumes System POS uses the same products table or can accept products via /api/products
   */
  private async syncProductsToSystemPos(products: UnknownRecord[], businessId?: number): Promise<boolean> {
    if (products.length === 0) {
      return false;
    }

    try {
      // Format products similar to smartSync format
      const productsToUpload = products.map((product: UnknownRecord) => {
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

      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'systemPosSync.ts:557',message:'Checking business_id',data:{productCount:products.length,providedBusinessId:businessId,firstProductBusinessId:products[0]?(products[0] as UnknownRecord).business_id:undefined},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'D'})}).catch(()=>{});
      // #endregion
      // Use provided business_id or try to get from first product
      const finalBusinessId = businessId || ((products[0] as UnknownRecord)?.business_id as number);
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'systemPosSync.ts:559',message:'business_id check result',data:{finalBusinessId,hasBusinessId:!!finalBusinessId},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'D'})}).catch(()=>{});
      // #endregion
      if (!finalBusinessId) {
        console.warn('⚠️ [SYSTEM POS SYNC] Cannot sync products - no business_id found');
        return false;
      }

      // Get POS API key
      const posApiKey = process.env.NEXT_PUBLIC_POS_SYNC_API_KEY || '';

      // Try System POS products endpoint first, fallback to main products endpoint
      const productsApiUrl = getApiUrl('/api/system-pos/products');
      
      let response = await fetch(productsApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          products: productsToUpload,
          businessId: finalBusinessId,
        }),
      });

      // If System POS endpoint doesn't exist (404), try main products endpoint as fallback
      if (!response.ok && response.status === 404) {
        console.warn('⚠️ [SYSTEM POS SYNC] /api/system-pos/products not found, trying /api/products as fallback');
        response = await fetch(getApiUrl('/api/products'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-POS-API-Key': posApiKey,
          },
          body: JSON.stringify({
            action: 'import',
            data: productsToUpload,
            businessId: businessId,
          }),
        });
      }

      if (response.ok) {
        const result = await response.json() as UnknownRecord;
        console.log(`✅ [SYSTEM POS SYNC] Synced ${result.successCount || productsToUpload.length} missing products to System POS`);
        return true;
      } else {
        const errorText = await response.text();
        console.warn(`⚠️ [SYSTEM POS SYNC] Failed to sync products: ${response.status} - ${errorText}`);
        return false;
      }
    } catch (error) {
      console.error('❌ [SYSTEM POS SYNC] Error syncing products:', error);
      return false;
    }
  }

  /**
   * Handle missing products error by syncing them from SQLite
   */
  private async handleMissingProductsError(
    error: unknown,
    transactionData: UnknownRecord,
    queuedTx: QueuedTransaction
  ): Promise<boolean> {
    // Check if error is about missing products (foreign key constraint)
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isProductForeignKeyError = errorMessage.includes('fk_transaction_items_product') ||
                                     errorMessage.includes('FOREIGN KEY (`product_id`)') ||
                                     errorMessage.includes('product_id') && errorMessage.includes('REFERENCES `products`');

    if (!isProductForeignKeyError) {
      return false; // Not a product-related error
    }

    console.log(`🔄 [SYSTEM POS SYNC] Detected missing products error for transaction ${queuedTx.transaction_id}, attempting to sync missing products...`);

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'systemPosSync.ts:616',message:'Detected missing products error',data:{transactionId:queuedTx.transaction_id,errorMessage},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
    // #endregion

    // Extract product IDs from transaction items
    const productIds = this.extractProductIdsFromTransaction(transactionData);
    if (productIds.length === 0) {
      console.warn(`⚠️ [SYSTEM POS SYNC] No product IDs found in transaction ${queuedTx.transaction_id}`);
      return false;
    }

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'systemPosSync.ts:477',message:'Extracted product IDs from transaction',data:{transactionId:queuedTx.transaction_id,productIds},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
    // #endregion

    // Fetch products from SQLite
    const products = await this.fetchProductsFromSQLite(productIds);
    if (products.length === 0) {
      console.warn(`⚠️ [SYSTEM POS SYNC] Products not found in SQLite for IDs: ${productIds.join(', ')}`);
      return false;
    }

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'systemPosSync.ts:485',message:'Fetched products from SQLite',data:{transactionId:queuedTx.transaction_id,productCount:products.length,productIds:products.map((p:UnknownRecord)=>p.id)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
    // #endregion

    // Sync products to System POS
    // Get business_id from transaction (products may have NULL business_id)
    // transactionData has nested structure: transactionData.transaction.business_id
    const transaction = transactionData.transaction as UnknownRecord | undefined;
    const businessId = (transaction?.business_id || transactionData.business_id) as number | undefined;
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'systemPosSync.ts:641',message:'About to sync products to System POS',data:{transactionId:queuedTx.transaction_id,productCount:products.length,transactionBusinessId:businessId,hasTransaction:!!transaction,transactionBusinessIdFromNested:transaction?.business_id,transactionBusinessIdFromTop:transactionData.business_id},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'F'})}).catch(()=>{});
    // #endregion
    const syncSuccess = await this.syncProductsToSystemPos(products, businessId);
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'systemPosSync.ts:644',message:'Product sync result',data:{transactionId:queuedTx.transaction_id,success:syncSuccess},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
    // #endregion
    if (!syncSuccess) {
      console.warn(`⚠️ [SYSTEM POS SYNC] Failed to sync products to System POS`);
      return false;
    }

    // Products synced successfully - wait a bit for database to update
    console.log(`⏳ [SYSTEM POS SYNC] Waiting 2 seconds for products to be available in System POS...`);
    await this.delay(2000);

    // Return true to indicate retry should happen
    return true;
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

      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'systemPosSync.ts:703',message:'Starting transaction sync',data:{transactionId:queuedTx.transaction_id,hasItems:!!transactionData.items,itemCount:Array.isArray(transactionData.items)?transactionData.items.length:0,productIds:Array.isArray(transactionData.items)?transactionData.items.map((i:UnknownRecord)=>i.product_id).filter(Boolean):[],transactionUserId:(transactionData.transaction as UnknownRecord)?.user_id,transactionNote:(transactionData.transaction as UnknownRecord)?.note,transactionKeys:transactionData.transaction?Object.keys(transactionData.transaction):[]},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'G'})}).catch(()=>{});
      // #endregion

      // Phase 2: Convert transaction dates to MySQL format before sending
      // Ensure status is validated (convert "completed" to "paid") for nested transaction structure
      if (transactionData.transaction && typeof transactionData.transaction === 'object') {
        const trans = transactionData.transaction as UnknownRecord;
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'systemPosSync.ts:737',message:'Before status validation',data:{transactionId:queuedTx.transaction_id,rawStatus:trans.status,statusType:typeof trans.status,statusIsArray:Array.isArray(trans.status),statusIsObject:typeof trans.status==='object'&&trans.status!==null},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'G'})}).catch(()=>{});
        // #endregion
        // Convert "completed" to "paid" (backward compatibility)
        if (trans.status === 'completed') {
          trans.status = 'paid';
        }
        // Validate status enum (should be: pending, paid, cancelled, refunded)
        if (trans.status !== undefined) {
          const { validateEnumValue } = await import('./syncUtils');
          const oldStatus = trans.status;
          const validatedStatus = validateEnumValue(trans.status, 'transactions.status', 'status');
          // Ensure status is always a string (not null, not object, not array)
          trans.status = validatedStatus !== null ? String(validatedStatus) : 'paid';
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'systemPosSync.ts:747',message:'After status validation',data:{transactionId:queuedTx.transaction_id,oldStatus,validatedStatus,newStatus:trans.status,statusType:typeof trans.status,statusIsString:typeof trans.status==='string'},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'G'})}).catch(()=>{});
          // #endregion
        }
      }
      // Convert dates - this will also validate top-level status if it exists
      const convertedTransactionData = convertTransactionDatesForMySQL(transactionData);
      // Also validate nested transaction status after conversion
      if (convertedTransactionData.transaction && typeof convertedTransactionData.transaction === 'object') {
        const trans = convertedTransactionData.transaction as UnknownRecord;
        if (trans.status !== undefined) {
          const { validateEnumValue } = await import('./syncUtils');
          const oldStatus = trans.status;
          const validatedStatus = validateEnumValue(trans.status, 'transactions.status', 'status');
          // Ensure status is always a string (not null, not object, not array)
          trans.status = validatedStatus !== null ? String(validatedStatus) : 'paid';
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'systemPosSync.ts:757',message:'After date conversion status validation',data:{transactionId:queuedTx.transaction_id,oldStatus,validatedStatus,newStatus:trans.status,statusType:typeof trans.status,statusIsString:typeof trans.status==='string'},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'G'})}).catch(()=>{});
          // #endregion
        }
      }
      
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'systemPosSync.ts:720',message:'Transaction data converted for MySQL',data:{transactionId:queuedTx.transaction_id,convertedUserId:(convertedTransactionData.transaction as UnknownRecord)?.user_id,convertedStatus:(convertedTransactionData.transaction as UnknownRecord)?.status,convertedNote:(convertedTransactionData.transaction as UnknownRecord)?.note,convertedKeys:convertedTransactionData.transaction?Object.keys(convertedTransactionData.transaction):[]},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'G'})}).catch(()=>{});
      // #endregion

      // 1. Sync Transaction (Transactions + Items + Refunds)
      // Retry logic: if it fails due to missing products, sync products and retry once
      let retryCount = 0;
      const maxRetries = 1; // Only retry once after syncing products
      
      while (retryCount <= maxRetries) {
        const transApiUrl = getApiUrl('/api/system-pos/transactions');
        
        // #region agent log
        const transactionStatus = (convertedTransactionData.transaction as UnknownRecord)?.status;
        const transactionStatusType = typeof transactionStatus;
        const transactionStatusLength = transactionStatus ? String(transactionStatus).length : 0;
        const transactionStatusIsString = typeof transactionStatus === 'string';
        const transactionStatusIsArray = Array.isArray(transactionStatus);
        const transactionStatusIsObject = typeof transactionStatus === 'object' && transactionStatus !== null;
        // Final safety check: ensure status is a string before sending
        if (convertedTransactionData.transaction && typeof convertedTransactionData.transaction === 'object') {
          const trans = convertedTransactionData.transaction as UnknownRecord;
          if (trans.status !== undefined && typeof trans.status !== 'string') {
            console.warn(`⚠️ [SYSTEM POS SYNC] Status is not a string, converting: ${trans.status} (type: ${typeof trans.status})`);
            trans.status = String(trans.status);
          }
        }
        fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'systemPosSync.ts:773',message:'About to send transaction to API',data:{transactionId:queuedTx.transaction_id,transactionStatus,transactionStatusType,transactionStatusLength,transactionStatusIsString,transactionStatusIsArray,transactionStatusIsObject,hasTransaction:!!convertedTransactionData.transaction,transactionKeys:convertedTransactionData.transaction?Object.keys(convertedTransactionData.transaction).slice(0,10):[]},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'G'})}).catch(()=>{});
        // #endregion
        
        const transResponse = await fetch(transApiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(convertedTransactionData),
        });

        if (!transResponse.ok) {
          // Try to get error details from response body
          let errorDetails = '';
          try {
            const errorBody = await transResponse.text();
            errorDetails = errorBody ? ` - ${errorBody.substring(0, 500)}` : '';
          } catch {
            // Ignore if we can't read the body
          }
          
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'systemPosSync.ts:640',message:'Transaction API response not OK',data:{transactionId:queuedTx.transaction_id,status:transResponse.status,statusText:transResponse.statusText,errorDetails,retryCount},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
          // #endregion
          
          const error = new Error(`Transaction Sync Failed: HTTP ${transResponse.status} ${transResponse.statusText}${errorDetails}`);
          
          // Check if it's a missing products error and we haven't retried yet
          if (retryCount < maxRetries) {
            const shouldRetry = await this.handleMissingProductsError(error, transactionData, queuedTx);
            if (shouldRetry) {
              console.log(`🔄 [SYSTEM POS SYNC] Retrying transaction sync for ${queuedTx.transaction_id} after syncing products...`);
              retryCount++;
              // #region agent log
              fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'systemPosSync.ts:651',message:'Retrying transaction after product sync',data:{transactionId:queuedTx.transaction_id,retryCount},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
              // #endregion
              continue; // Retry the transaction sync
            }
          }
          
          // If we get here, either it's not a product error or we've already retried
          console.error(`❌ [SYSTEM POS SYNC] Transaction API error for ${queuedTx.transaction_id}:`, {
            status: transResponse.status,
            statusText: transResponse.statusText,
            url: transApiUrl,
            errorDetails: errorDetails || 'No error details available',
          });
          
          throw error;
        }

        const transResult = await transResponse.json();
        
        if (!transResult.success) {
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'systemPosSync.ts:670',message:'Transaction API returned success=false',data:{transactionId:queuedTx.transaction_id,error:transResult.error,fullResult:transResult,retryCount},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
          // #endregion
          
          const errorMsg = transResult.error || 'Unknown Transaction Sync Error';
          const error = new Error(errorMsg);
          
          // Check if it's a missing products error and we haven't retried yet
          if (retryCount < maxRetries) {
            const shouldRetry = await this.handleMissingProductsError(error, transactionData, queuedTx);
            if (shouldRetry) {
              console.log(`🔄 [SYSTEM POS SYNC] Retrying transaction sync for ${queuedTx.transaction_id} after syncing products...`);
              retryCount++;
              // #region agent log
              fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'systemPosSync.ts:680',message:'Retrying transaction after product sync (success=false)',data:{transactionId:queuedTx.transaction_id,retryCount},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
              // #endregion
              continue; // Retry the transaction sync
            }
          }
          
          // If we get here, either it's not a product error or we've already retried
          console.error(`❌ [SYSTEM POS SYNC] Transaction API returned error for ${queuedTx.transaction_id}:`, {
            error: errorMsg,
            fullResponse: transResult,
          });
          
          throw error;
        }
        
        // Success! Break out of retry loop
        break;
      }


      // 2. Sync Shift (if available) - Non-blocking but logged
      if (convertedTransactionData.shift) {
        try {
          // Phase 2: Convert shift dates to MySQL format
          const convertedShift = convertShiftDatesForMySQL(convertedTransactionData.shift as UnknownRecord);
          const shiftApiUrl = getApiUrl('/api/system-pos/shifts');
          await fetch(shiftApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ shifts: [convertedShift] }),
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
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'systemPosSync.ts:553',message:'syncTransaction catch block - BEFORE markSystemPosFailed',data:{transactionId:queuedTx.transaction_id,retryCount:queuedTx.retry_count,error:error instanceof Error?error.message:String(error),errorStack:error instanceof Error?error.stack:undefined},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
      // #endregion
      
      // Enhanced error logging with full details
      console.error(`❌ [SYSTEM POS SYNC] Failed to sync transaction ${queuedTx.transaction_id}`);
      if (error instanceof Error) {
        console.error(`❌ [SYSTEM POS SYNC] Error message:`, error.message);
        if (error.stack) {
          console.error(`❌ [SYSTEM POS SYNC] Error stack trace:`, error.stack);
        }
        // Check if error has additional properties (e.g., from fetch responses)
        if ('response' in error || 'status' in error || 'body' in error) {
          console.error(`❌ [SYSTEM POS SYNC] Additional error details:`, {
            response: (error as { response?: unknown }).response,
            status: (error as { status?: unknown }).status,
            body: (error as { body?: unknown }).body,
          });
        }
      } else {
        console.error(`❌ [SYSTEM POS SYNC] Error object:`, error);
      }

      // Mark as failed (increment retry count)
      if (electronAPI.markSystemPosFailed) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'systemPosSync.ts:409',message:'Calling markSystemPosFailed',data:{transactionId:queuedTx.transaction_id,currentRetryCount:queuedTx.retry_count,errorMessage:errorMsg},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
        // #endregion
        const markResult = await (electronAPI.markSystemPosFailed as (transactionId: string, error: string) => Promise<{ success: boolean }>)(
          queuedTx.transaction_id,
          errorMsg
        );
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'systemPosSync.ts:414',message:'markSystemPosFailed result',data:{transactionId:queuedTx.transaction_id,success:markResult.success},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
        // #endregion
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
      console.error(`❌ [SYSTEM POS SYNC] Error fetching transaction data for ${transactionId}:`);
      if (error instanceof Error) {
        console.error(`❌ [SYSTEM POS SYNC] Error message:`, error.message);
        if (error.stack) {
          console.error(`❌ [SYSTEM POS SYNC] Error stack:`, error.stack);
        }
      } else {
        console.error(`❌ [SYSTEM POS SYNC] Error object:`, error);
      }
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
   * DISABLED: system_pos database has been dropped
   */
  async triggerSync() {
    console.log('⚠️ [SYSTEM POS SYNC] triggerSync() called but service is DISABLED - system_pos database has been dropped');
    return;
    // if (this.isSyncing) {
    //   console.log('⏳ [SYSTEM POS SYNC] Sync already in progress');
    //   return;
    // }
    // await this.sync();
  }
}

export const systemPosSyncService = new SystemPosSyncService();

