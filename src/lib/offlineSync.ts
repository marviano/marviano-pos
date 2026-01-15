import { getApiUrl, cleanUrl } from '@/lib/api';

type ElectronAPI = typeof window extends { electronAPI: infer T } ? T : never;

const getElectronAPI = (): ElectronAPI | undefined =>
  typeof window !== 'undefined' ? window.electronAPI : undefined;

/**
 * Offline Sync Service
 * Handles data synchronization between online MySQL and local MySQL database
 */

export interface ConnectionDetails {
  internetCheck: string | null;
  databaseCheck: string | null;
  lastCheckTime: number | null;
}

export interface SyncStatus {
  isOnline: boolean;
  internetConnected: boolean;
  databaseConnected: boolean;
  lastSync: number | null;
  syncInProgress: boolean;
  connectionDetails: ConnectionDetails;
}

export interface DetailedSyncStatus extends SyncStatus {
  timestamp: string;
  userAgent: string;
  platform: string;
  lastSyncTime: number | null;
}

export interface EndpointTestResult {
  endpoint: string;
  success: boolean;
  error?: string;
}

export interface DatabaseTestResult {
  success: boolean;
  error?: string;
}

export interface EndpointTestResults {
  internet: EndpointTestResult[];
  database: DatabaseTestResult;
}

class OfflineSyncService {
  private syncStatus: SyncStatus = {
    isOnline: false, // Start as offline until we verify connection
    internetConnected: false,
    databaseConnected: false,
    lastSync: null,
    syncInProgress: false,
    connectionDetails: {
      internetCheck: null,
      databaseCheck: null,
      lastCheckTime: null,
    },
  };

  private listeners: Set<(status: SyncStatus) => void> = new Set();
  private checkInterval: NodeJS.Timeout | null = null;
  private progressListeners: Set<(progress: number | null) => void> = new Set();

  constructor() {
    // console.log('🚀 [OFFLINE SYNC] Service initializing...');
    if (typeof window !== 'undefined') {
      // Immediately check connection status on initialization
      // console.log('🔍 [OFFLINE SYNC] Starting initial connection check...');
      this.checkConnection();
      this.initializeConnectionMonitoring();
    }
  }

  /**
   * Initialize connection monitoring
   */
  private initializeConnectionMonitoring() {
    // console.log('🔄 [OFFLINE SYNC] Setting up connection monitoring...');
    // Check online status periodically
    this.checkInterval = setInterval(() => {
      this.checkConnection();
    }, 5000); // Check every 5 seconds

    // Listen to browser online/offline events
    window.addEventListener('online', () => {
      // console.log('🌐 [OFFLINE SYNC] Browser detected: ONLINE');
      // Don't immediately trust browser online event - verify with actual API call
      setTimeout(() => {
        this.checkConnection();
      }, 1000); // Wait 1 second then verify
    });

    window.addEventListener('offline', () => {
      // console.log('🌐 [OFFLINE SYNC] Browser detected: OFFLINE');
      // Browser offline event is usually reliable
      this.handleConnectionChange(false);
    });

    // Initial check
    this.checkConnection();
  }

  /**
   * Check internet connectivity by testing external endpoints
   */
  private async checkInternetConnectivity(): Promise<{ connected: boolean; endpoint: string | null }> {
    // Only test external endpoints for internet connectivity
    const internetEndpoints = [
      'https://www.google.com/generate_204', // Google's connectivity check
      'https://httpbin.org/status/200',      // External test endpoint
      'https://www.cloudflare.com/cdn-cgi/trace', // Cloudflare trace (very reliable)
    ];

    for (const endpoint of internetEndpoints) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000); // 4 second timeout per endpoint

        await fetch(endpoint, {
          method: 'GET',
          cache: 'no-store',
          signal: controller.signal,
          mode: 'no-cors' // Use no-cors for external endpoints
        });

        clearTimeout(timeoutId);

        // For no-cors requests, we can't read response status, but if we don't get an error, we're online
        return { connected: true, endpoint };

      } catch {
        continue;
      }
    }

    return { connected: false, endpoint: null };
  }

  /**
   * Check local database connectivity
   */
  private async checkDatabaseConnectivity(): Promise<{ connected: boolean; details: string }> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout

      const healthUrl = cleanUrl(getApiUrl('/api/health-check'));
      const response = await fetch(healthUrl, {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
        mode: 'cors'
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        return { connected: true, details: `Database connected (${data.status})` };
      } else {
        return { connected: false, details: `Health check failed (${response.status})` };
      }

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { connected: false, details: `Connection failed: ${message}` };
    }
  }

  /**
   * Comprehensive connection check - separates internet vs database connectivity
   */
  private async checkConnection() {
    try {
      // Check both internet and database connectivity in parallel
      const [internetResult, databaseResult] = await Promise.all([
        this.checkInternetConnectivity(),
        this.checkDatabaseConnectivity()
      ]);

      // Update connection details
      this.syncStatus.connectionDetails = {
        internetCheck: internetResult.connected ? internetResult.endpoint : 'Failed',
        databaseCheck: databaseResult.details,
        lastCheckTime: Date.now(),
      };

      // Determine overall online status
      // We're "online" only if we have internet connectivity (for sync purposes)
      const wasInternetConnected = this.syncStatus.internetConnected;

      this.syncStatus.internetConnected = internetResult.connected;
      this.syncStatus.databaseConnected = databaseResult.connected;
      this.syncStatus.isOnline = internetResult.connected; // Only online if we have internet

      // Log status changes (commented out to reduce log flooding)
      // console.log(`📊 [CONNECTION CHECK] Status Update (${checkTime}ms):`);
      // console.log(`   Internet: ${wasInternetConnected ? 'ONLINE' : 'OFFLINE'} → ${internetResult.connected ? 'ONLINE' : 'OFFLINE'}`);
      // console.log(`   Database: ${wasDatabaseConnected ? 'ONLINE' : 'OFFLINE'} → ${databaseResult.connected ? 'ONLINE' : 'OFFLINE'}`);
      // console.log(`   Overall:  ${wasOnline ? 'ONLINE' : 'OFFLINE'} → ${internetResult.connected ? 'ONLINE' : 'OFFLINE'}`);

      // Trigger sync only if we just got internet connectivity back
      if (!wasInternetConnected && this.syncStatus.internetConnected) {
        this.syncFromOnline();
      }

      this.notifyListeners();

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      // console.log('❌ [CONNECTION CHECK] Connection check failed:', message);

      // Mark everything as failed on error
      this.syncStatus.internetConnected = false;
      this.syncStatus.databaseConnected = false;
      this.syncStatus.isOnline = false;
      this.syncStatus.connectionDetails = {
        internetCheck: 'Error',
        databaseCheck: `Error: ${message}`,
        lastCheckTime: Date.now(),
      };

      this.notifyListeners();
    }
  }

  /**
   * Handle connection change (for browser events)
   */
  private handleConnectionChange(isOnline: boolean) {
    console.log(`🌐 [BROWSER EVENT] Browser detected: ${isOnline ? 'ONLINE' : 'OFFLINE'}`);

    // Browser events are usually reliable for internet connectivity
    const wasInternetConnected = this.syncStatus.internetConnected;
    this.syncStatus.internetConnected = isOnline;
    this.syncStatus.isOnline = isOnline; // Overall status follows internet connectivity

    // If we just came back online, trigger sync
    if (!wasInternetConnected && isOnline) {
      console.log('✅ [BROWSER EVENT] Internet restored - triggering sync');
      this.syncFromOnline();
    }

    this.notifyListeners();
  }

  /**
   * Sync data from online MySQL to local MySQL - COMPREHENSIVE SYNC
   * Downloads ALL POS tables for complete offline functionality
   * Uses smart sync to prevent server overload
   */
  async syncFromOnline() {
    const electronAPI = getElectronAPI();
    if (!electronAPI || this.syncStatus.syncInProgress || !this.syncStatus.isOnline) {
      return;
    }

    // console.log('🔄 Starting comprehensive sync from online database...');
    // console.log('📥 This will download ALL POS tables for complete offline functionality');
    this.syncStatus.syncInProgress = true;
    this.notifyListeners();
    this.notifyProgress(0);

    // NOTE: Smart Sync handles uploads automatically in the background
    // No need to trigger it here - this function only downloads master data

    let apiUrl: string = 'URL tidak diketahui';
    try {
      // Use the comprehensive sync endpoint
      try {
        const rawUrl = getApiUrl('/api/sync');
        apiUrl = cleanUrl(rawUrl);
        // Validate URL format
        try {
          new URL(apiUrl);
        } catch {
          throw new Error(`Invalid URL format: ${apiUrl.substring(0, 100)}`);
        }
      } catch (urlError) {
        const errorMsg = urlError instanceof Error ? urlError.message : 'API URL tidak dikonfigurasi';
        throw new Error(`Gagal mendapatkan URL API: ${errorMsg}. Pastikan URL API sudah diisi di Settings.`);
      }
      
      const syncResponse = await fetch(apiUrl);
      
      // Handle redirects explicitly
      if (syncResponse.type === 'opaqueredirect' || (syncResponse.status >= 300 && syncResponse.status < 400)) {
        throw new Error(`Server redirected from ${apiUrl} to ${syncResponse.url || 'unknown'}. The API endpoint may not exist on this server.`);
      }
      
      if (!syncResponse.ok) {
        const errorText = await syncResponse.text().catch(() => 'Unknown error');
        throw new Error(`Server mengembalikan error ${syncResponse.status}: ${errorText}. Pastikan API server berjalan di ${apiUrl}`);
      }
      
      // Check if response is actually JSON before parsing
      const contentType = syncResponse.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await syncResponse.text();
        throw new Error(`Server returned non-JSON response (${contentType}). Response: ${text.substring(0, 200)}`);
      }
      
      const syncData = await syncResponse.json();
      
      if (!syncData.success) {
          throw new Error(`API mengembalikan success=false. Pesan: ${syncData.message || syncData.error || 'Tidak ada pesan error'}`);
        }
        
        if (!syncData.data) {
          throw new Error('API tidak mengembalikan data. Response tidak memiliki field "data".');
        }
        
        const { data } = syncData;
        
        // const targetBusinessId = Number(syncData.businessId ?? 14);

          const totalSteps = 30; // Updated: added 2 steps for employees_position and employees
          let completedSteps = 0;
          const advanceProgress = () => {
            completedSteps = Math.min(totalSteps, completedSteps + 1);
            const percent = Math.round((completedSteps / totalSteps) * 100);
            this.notifyProgress(percent);
          };

          // CRITICAL: Sync order matters due to foreign key constraints
          // Handle circular dependency: Organizations <-> Users <-> Roles
          // Strategy: Sync in multiple passes, allowing partial data
          
          // Pass 1: Try to sync organizations (FIRST PASS - skip owner validation to break circular dependency)
          if (Array.isArray(data.organizations) && data.organizations.length > 0) {
            try {
              const result = await (electronAPI.localDbUpsertOrganizations as (rows: unknown[], skipValidation?: boolean) => Promise<{ success: boolean }>)?.(data.organizations, true);
              if (result && !result.success) {
              }
            } catch (err) {
              console.error('Failed to upsert organizations:', err);
              throw new Error(`Gagal menyinkronkan organizations: ${err instanceof Error ? err.message : String(err)}`);
            }
          }
          advanceProgress();

          // Pass 2: Permission Categories (needed by permissions)
          // Note: localDbUpsertPermissionCategories method doesn't exist in electronAPI
          // if (Array.isArray(data.permissionCategories) && data.permissionCategories.length > 0) {
          //   await (electronAPI.localDbUpsertPermissionCategories as (rows: unknown[]) => Promise<{ success: boolean }>)?.(data.permissionCategories);
          // }
          advanceProgress();

          // Pass 3: Roles (needs organizations - may skip if org doesn't exist)
          if (Array.isArray(data.roles)) {
            await (electronAPI.localDbUpsertRoles as (rows: unknown[]) => Promise<{ success: boolean }>)?.(data.roles);
          }
          advanceProgress();

          // Pass 4: Users (FIRST PASS - skip role validation to break circular dependency)
          if (Array.isArray(data.users) && data.users.length > 0) {
            await (electronAPI.localDbUpsertUsers as (rows: unknown[], skipValidation?: boolean) => Promise<{ success: boolean }>)?.(data.users, true);
          }
          advanceProgress();

          // Pass 5: Retry organizations now that users might exist (WITH validation)
          if (Array.isArray(data.organizations) && data.organizations.length > 0) {
            await (electronAPI.localDbUpsertOrganizations as (rows: unknown[], skipValidation?: boolean) => Promise<{ success: boolean }>)?.(data.organizations, false);
          }
          advanceProgress();

          // Pass 6: Retry roles now that organizations might exist
          if (Array.isArray(data.roles)) {
            await (electronAPI.localDbUpsertRoles as (rows: unknown[]) => Promise<{ success: boolean }>)?.(data.roles);
          }
          advanceProgress();

          // Pass 7: Retry users now that roles might exist (WITH validation)
          if (Array.isArray(data.users) && data.users.length > 0) {
            await (electronAPI.localDbUpsertUsers as (rows: unknown[], skipValidation?: boolean) => Promise<{ success: boolean }>)?.(data.users, false);
          }
          advanceProgress();

          // Pass 8: Retry employees now that users, businesses, and employees_position might exist (WITH validation)
          if (Array.isArray(data.employees) && data.employees.length > 0) {
            try {
              const result = await (electronAPI.localDbUpsertEmployees as (rows: unknown[], skipValidation?: boolean) => Promise<{ success: boolean; skipped?: number; error?: string }>)?.(data.employees, false);
              if (result && !result.success) {
                if (result.error) {
                  console.error('Employees retry error:', result.error);
                }
              } else {
                // Cleanup orphaned employees after successful sync
                // Extract employee IDs that were successfully synced
                const syncedEmployeeIds = data.employees
                  .map((emp: Record<string, unknown>) => {
                    const id = emp.id;
                    if (typeof id === 'number') return id;
                    if (typeof id === 'string') {
                      const num = Number(id);
                      return isNaN(num) ? null : num;
                    }
                    return null;
                  })
                  .filter((id: number | null): id is number => id !== null);
                
                const businessId = syncData.businessId || 14; // Default to 14 if not provided
                
                if (syncedEmployeeIds.length > 0 && electronAPI.localDbCleanupOrphanedEmployees) {
                  try {
                    const cleanupResult = await electronAPI.localDbCleanupOrphanedEmployees(businessId, syncedEmployeeIds);
                    if (cleanupResult.success && cleanupResult.deletedCount && cleanupResult.deletedCount > 0) {
                      // Cleaned up orphaned employees
                    }
                  } catch (cleanupError) {
                    // Failed to cleanup orphaned employees
                  }
                }
              }
            } catch (err) {
              console.error('Failed to upsert employees on retry:', err);
              if (err instanceof Error) {
                console.error('Error details:', err.message, err.stack);
              }
              // Don't throw - some employees may still have missing dependencies
            }
          }
          advanceProgress();

          // 6. Businesses (needs organizations)
          if (Array.isArray(data.businesses) && data.businesses.length > 0) {
            try {
              const result = await (electronAPI.localDbUpsertBusinesses as (rows: unknown[]) => Promise<{ success: boolean }>)?.(data.businesses);
              if (result && !result.success) {
                // Businesses upsert returned success=false
              }
            } catch (err) {
              console.error('❌ [SYNC] Failed to upsert businesses:', err);
              throw new Error(`Gagal menyinkronkan businesses: ${err instanceof Error ? err.message : String(err)}`);
            }
          }
          advanceProgress();

          // Sync Employees Position (must be before employees due to foreign key)
          if (Array.isArray(data.employeesPosition) && data.employeesPosition.length > 0) {
            try {
              const result = await (electronAPI.localDbUpsertEmployeesPosition as (rows: unknown[]) => Promise<{ success: boolean }>)?.(data.employeesPosition);
              if (result && !result.success) {
                // EmployeesPosition upsert returned success=false
              }
            } catch (err) {
              console.error('❌ [SYNC] Failed to upsert employeesPosition:', err);
              if (err instanceof Error) {
                console.error('❌ [SYNC] Error details:', err.message, err.stack);
              }
              throw new Error(`Gagal menyinkronkan employeesPosition: ${err instanceof Error ? err.message : String(err)}`);
            }
          } else {
          }
          advanceProgress();

          // Sync Employees (depends on employees_position, users, businesses)
          if (Array.isArray(data.employees) && data.employees.length > 0) {
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/7b565785-72b5-49f7-b2c0-57606ea0d0b5',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'offlineSync.ts:463',message:'Starting employees sync',data:{employeesCount:data.employees.length,employees:data.employees.map((e:any)=>({id:e.id,business_id:e.business_id,jabatan_id:e.jabatan_id,nama:e.nama_karyawan}))},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
            // #endregion
            try {
              const result = await (electronAPI.localDbUpsertEmployees as (rows: unknown[], skipValidation?: boolean) => Promise<{ success: boolean; skipped?: number }>)?.(data.employees, true);
              // #region agent log
              fetch('http://127.0.0.1:7242/ingest/7b565785-72b5-49f7-b2c0-57606ea0d0b5',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'offlineSync.ts:466',message:'Employees sync result',data:{success:result?.success,skipped:result?.skipped,error:result&&'error' in result?result.error:null},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
              // #endregion
              if (result && !result.success) {
                if (result && 'error' in result) {
                  console.error('Employees error:', result.error);
                }
              }
            } catch (err) {
              // #region agent log
              fetch('http://127.0.0.1:7242/ingest/7b565785-72b5-49f7-b2c0-57606ea0d0b5',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'offlineSync.ts:472',message:'Employees sync error',data:{error:err instanceof Error?err.message:String(err)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
              // #endregion
              console.error('Failed to upsert employees:', err);
              if (err instanceof Error) {
                console.error('Error details:', err.message, err.stack);
              }
              // Don't throw - employees may have foreign key issues, will retry later
            }
          }
          advanceProgress();

          // PRIORITIZE DEPENDENCIES: Category1, Category2, Types, Options
          if (Array.isArray(data.category1) && data.category1.length > 0) {
            try {
              const result = await (electronAPI.localDbUpsertCategory1 as (rows: unknown[]) => Promise<{ success: boolean }>)?.(data.category1);
              if (result && !result.success) {
                // Category1 upsert returned success=false
              }
            } catch (err) {
              console.error('Failed to upsert category1:', err);
              throw new Error(`Gagal menyinkronkan category1: ${err instanceof Error ? err.message : String(err)}`);
            }
          }
          advanceProgress();

          if (Array.isArray(data.category2) && data.category2.length > 0) {
            // Get junction table data (REQUIRED - junction table only, no business_id column)
            const junctionTableData = (data.category2Businesses as Array<{ category2_id: number; business_id: number }> | undefined) || undefined;
            if (!junctionTableData || junctionTableData.length === 0) {
            } else {
              await (electronAPI.localDbUpsertCategory2 as (rows: unknown[], junctionData?: Array<{ category2_id: number; business_id: number }>) => Promise<{ success: boolean }>)?.(data.category2, junctionTableData);
              // console.log(`✅ ${data.category2.length} category2 records synced to local database with ${junctionTableData.length} business relationships`);
            }
          }
          advanceProgress();

          if (Array.isArray(data.customizationTypes) && data.customizationTypes.length > 0) {
            await (electronAPI.localDbUpsertCustomizationTypes as (rows: unknown[]) => Promise<{ success: boolean }>)?.(data.customizationTypes);
            // console.log(`✅ ${data.customizationTypes.length} customization types synced to local database`);
          }
          advanceProgress();

          if (Array.isArray(data.customizationOptions) && data.customizationOptions.length > 0) {
            await (electronAPI.localDbUpsertCustomizationOptions as (rows: unknown[]) => Promise<{ success: boolean }>)?.(data.customizationOptions);
            // console.log(`✅ ${data.customizationOptions.length} customization options synced to local database`);
          }
          advanceProgress();

          // Skip legacy 'categories' table - it doesn't exist in MySQL schema
          // Category2 table is the source of truth
          advanceProgress();

          if (Array.isArray(data.products)) {
            if (data.products.length > 0) {
              try {
                const result = await (electronAPI.localDbUpsertProducts as (rows: unknown[]) => Promise<{ success: boolean; inserted?: number; errors?: number; error?: string }>)?.(data.products);
                if (!result) {
                  console.error('Products upsert returned null/undefined');
                  throw new Error('Gagal menyimpan products - tidak ada response dari database');
                } else if (!result.success) {
                  console.error('Products upsert returned success=false');
                  console.error('Error details:', result.error || 'Unknown error');
                  throw new Error(`Gagal menyimpan products ke database lokal: ${result.error || 'Unknown error'}`);
                }
              } catch (err) {
                console.error('❌ [SYNC] Failed to upsert products:', err);
                throw new Error(`Gagal menyinkronkan products: ${err instanceof Error ? err.message : String(err)}`);
              }
              
              // Cleanup orphaned products (products that exist locally but not in sync data)
              const businessId = syncData.businessId || 14; // Default to 14 if not provided
              const syncedProductIds = data.products.map((p: Record<string, unknown>) => p.id).filter((id: unknown): id is number => typeof id === 'number');
              if (syncedProductIds.length > 0 && electronAPI.localDbCleanupOrphanedProducts) {
                try {
                  const cleanupResult = await electronAPI.localDbCleanupOrphanedProducts(businessId, syncedProductIds);
                  if (cleanupResult.success && cleanupResult.deletedCount && cleanupResult.deletedCount > 0) {
                    console.log(`🧹 [SYNC] Cleaned up ${cleanupResult.deletedCount} orphaned products`);
                  }
                } catch (cleanupError) {
                  console.warn('⚠️ [SYNC] Failed to cleanup orphaned products:', cleanupError);
                }
              }
            }
          } else {
          }
          
          // Sync product_businesses junction table (REQUIRED for product filtering)
          if (Array.isArray(data.productBusinesses) && data.productBusinesses.length > 0) {
            try {
              const result = await (electronAPI.localDbUpsertProductBusinesses as (rows: Array<{ product_id: number; business_id: number }>) => Promise<{ success: boolean }>)?.(data.productBusinesses);
              if (result && !result.success) {
                console.error('❌ [SYNC] ProductBusinesses upsert returned success=false');
                throw new Error('Gagal menyimpan product-business relationships ke database lokal');
              } else {
              }
            } catch (err) {
              console.error('❌ [SYNC] Failed to upsert productBusinesses:', err);
              throw new Error(`Gagal menyinkronkan product-business relationships: ${err instanceof Error ? err.message : String(err)}`);
            }
          } else {
          }
          advanceProgress();

          if (Array.isArray(data.productCustomizations) && data.productCustomizations.length > 0) {
            await (electronAPI.localDbUpsertProductCustomizations as (rows: unknown[]) => Promise<{ success: boolean }>)?.(data.productCustomizations);
            // console.log(`✅ ${data.productCustomizations.length} product customizations synced to local database`);
          }
          advanceProgress();

          if (Array.isArray(data.ingredients) && data.ingredients.length > 0) {
            await (electronAPI.localDbUpsertIngredients as (rows: unknown[]) => Promise<{ success: boolean }>)?.(data.ingredients);
            // console.log(`✅ ${data.ingredients.length} ingredients synced to local database`);
          }
          advanceProgress();

          if (Array.isArray(data.cogs) && data.cogs.length > 0) {
            await (electronAPI.localDbUpsertCogs as (rows: unknown[]) => Promise<{ success: boolean }>)?.(data.cogs);
            // console.log(`✅ ${data.cogs.length} COGS records synced to local database`);
          }
          advanceProgress();

          if (Array.isArray(data.contacts) && data.contacts.length > 0) {
            await (electronAPI.localDbUpsertContacts as (rows: unknown[]) => Promise<{ success: boolean }>)?.(data.contacts);
            // console.log(`✅ ${data.contacts.length} contacts synced to local database`);
          }
          advanceProgress();

          if (Array.isArray(data.teams) && data.teams.length > 0) {
            await (electronAPI.localDbUpsertTeams as (rows: unknown[]) => Promise<{ success: boolean }>)?.(data.teams);
            // console.log(`✅ ${data.teams.length} teams synced to local database`);
          }
          advanceProgress();

          // Permissions (needs permission_categories)
          if (Array.isArray(data.permissions)) {
            await (electronAPI.localDbUpsertPermissions as (rows: unknown[]) => Promise<{ success: boolean }>)?.(data.permissions);
            // console.log(`✅ ${data.permissions.length} permissions synced to local database`);
          }
          advanceProgress();

          if (Array.isArray(data.rolePermissions)) {
            await (electronAPI.localDbUpsertRolePermissions as (rows: unknown[]) => Promise<{ success: boolean }>)?.(data.rolePermissions);
            // console.log(`✅ ${data.rolePermissions.length} role-permission mappings synced to local database`);
          }
          advanceProgress();

          // Skip source table - not needed in POS app (CRM-only)
          // if (Array.isArray(data.source) && data.source.length > 0) {
          //   await (electronAPI.localDbUpsertSource as (rows: unknown[]) => Promise<{ success: boolean }>)?.(data.source);
          // }
          advanceProgress();

          // Skip pekerjaan table - not needed in POS app (CRM-only)
          // if (Array.isArray(data.pekerjaan) && data.pekerjaan.length > 0) {
          //   await (electronAPI.localDbUpsertPekerjaan as (rows: unknown[]) => Promise<{ success: boolean }>)?.(data.pekerjaan);
          // }
          advanceProgress();

          // Sync new tables for enhanced offline support
          if (Array.isArray(data.paymentMethods) && data.paymentMethods.length > 0) {
            await (electronAPI.localDbUpsertPaymentMethods as (rows: unknown[]) => Promise<{ success: boolean }>)?.(data.paymentMethods);
            // console.log(`✅ ${data.paymentMethods.length} payment methods synced to local database`);
          }
          advanceProgress();

          if (Array.isArray(data.banks) && data.banks.length > 0) {
            await (electronAPI.localDbUpsertBanks as (rows: unknown[]) => Promise<{ success: boolean }>)?.(data.banks);
            // console.log(`✅ ${data.banks.length} banks synced to local database`);
          }
          advanceProgress();

          if (Array.isArray(data.organizations) && data.organizations.length > 0) {
            await (electronAPI.localDbUpsertOrganizations as (rows: unknown[]) => Promise<{ success: boolean }>)?.(data.organizations);
            // console.log(`✅ ${data.organizations.length} organizations synced to local database`);
          }
          advanceProgress();

          if (Array.isArray(data.managementGroups) && data.managementGroups.length > 0) {
            await (electronAPI.localDbUpsertManagementGroups as (rows: unknown[]) => Promise<{ success: boolean }>)?.(data.managementGroups);
            // console.log(`✅ ${data.managementGroups.length} management groups synced to local database`);
          }
          advanceProgress();

          // Categories and Customizations moved up

          if (Array.isArray(data.bundleItems)) {
            if (data.bundleItems.length > 0) {
              await (electronAPI.localDbUpsertBundleItems as (rows: unknown[]) => Promise<{ success: boolean }>)?.(data.bundleItems);
            }
          }
          advanceProgress();

          if (Array.isArray(data.clAccounts) && data.clAccounts.length > 0) {
            await (electronAPI.localDbUpsertClAccounts as (rows: unknown[]) => Promise<{ success: boolean }>)?.(data.clAccounts);
            // console.log(`✅ ${data.clAccounts.length} CL accounts synced to local database`);
          }
          advanceProgress();

          // Restaurant Table Layout (rooms first, then tables due to foreign key)
          if (Array.isArray(data.restaurantRooms) && data.restaurantRooms.length > 0) {
            await (electronAPI.localDbUpsertRestaurantRooms as (rows: unknown[]) => Promise<{ success: boolean }>)?.(data.restaurantRooms);
            // console.log(`✅ ${data.restaurantRooms.length} restaurant rooms synced to local database`);
          }
          advanceProgress();

          if (Array.isArray(data.restaurantTables) && data.restaurantTables.length > 0) {
            await (electronAPI.localDbUpsertRestaurantTables as (rows: unknown[]) => Promise<{ success: boolean }>)?.(data.restaurantTables);
            // console.log(`✅ ${data.restaurantTables.length} restaurant tables synced to local database`);
          }
          advanceProgress();

          // SKIP PRINTER AUDIT LOGS AND PRINTER DAILY COUNTERS
          // Local database is source of truth for printer data
          // Printer audits/counters are local source of truth - not downloaded from server
          // console.log('⚠️ [OFFLINE SYNC] Skipping printer audit logs and printer daily counters (local is source of truth)');
          advanceProgress();

          // Update sync status
          this.syncStatus.lastSync = Date.now();
          await (electronAPI.localDbUpdateSyncStatus as (key: string, status: string) => Promise<{ success: boolean }>)?.(
            'last_full_sync',
            'success'
          );
          this.notifyProgress(100);

          // Verify data was actually written by checking a few key tables
          try {
            if (electronAPI.localDbGetAllProducts) {
              const verifyProducts = await electronAPI.localDbGetAllProducts();
              const productCount = Array.isArray(verifyProducts) ? verifyProducts.length : 0;
              if (productCount === 0 && data.products && Array.isArray(data.products) && data.products.length > 0) {
                console.error('WARNING: Products were synced but database is empty!');
                console.error('This suggests the data was not actually written to the database.');
                console.error('Check the Electron terminal/console for transaction errors.');
              }
            }
          } catch (verifyError) {
            // Could not verify sync results
          }
    } catch (error) {
      console.error('Comprehensive sync failed:', error);
      this.notifyProgress(null);
      
      // Create a more user-friendly error message
      let errorMessage = 'Sinkronisasi gagal';
      if (error instanceof Error) {
        if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
          errorMessage = `Tidak dapat terhubung ke API server. Periksa:\n` +
            `1. URL API sudah benar (contoh: http://192.168.1.16:3000)\n` +
            `2. API server berjalan di ${apiUrl || 'URL yang dikonfigurasi'}\n` +
            `3. Firewall tidak memblokir koneksi\n` +
            `4. Server dapat diakses dari komputer ini`;
        } else if (error.message.includes('API URL')) {
          errorMessage = error.message;
        } else {
          errorMessage = error.message;
        }
      }
      
      // Re-throw the error so it can be caught by the caller
      throw new Error(errorMessage);
    } finally {
      this.syncStatus.syncInProgress = false;
      this.notifyListeners();
    }
  }

  /**
   * Fetch data with offline fallback
   */
  async fetchWithFallback<T>(
    onlineFetch: () => Promise<T>,
    offlineFetch: () => Promise<T>
  ): Promise<T> {
    // If we're offline, skip online fetch and go straight to offline
    if (!this.syncStatus.isOnline || !this.syncStatus.internetConnected) {
      return offlineFetch();
    }

    try {
      const result = await onlineFetch();
      return result;
    } catch (error) {
      this.checkConnection();
      return offlineFetch();
    }
  }

  /**
   * Sync printer audit logs to server
   */
  async syncPrinterAudits() {
    const electronAPI = getElectronAPI();
    if (!electronAPI || !this.syncStatus.isOnline) {
      return;
    }

    try {
      const unsyncedAudits = await (electronAPI.localDbGetUnsyncedPrinterAudits as () => Promise<{ p1?: unknown[]; p2?: unknown[] } | null>)?.();
      const printer1Audits = Array.isArray(unsyncedAudits?.p1) ? unsyncedAudits.p1 : [];
      const printer2Audits = Array.isArray(unsyncedAudits?.p2) ? unsyncedAudits.p2 : [];

      if (printer1Audits.length === 0 && printer2Audits.length === 0) {
        return;
      }

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
        console.log('✅ [PRINTER AUDIT SYNC] Printer audits synced successfully:', JSON.stringify(result, null, 2));

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
        await (electronAPI.localDbMarkPrinterAuditsSynced as (payload: { p1Ids: number[]; p2Ids: number[] }) => Promise<{ success: boolean }>)?.({
          p1Ids: toIdArray(printer1Audits),
          p2Ids: toIdArray(printer2Audits),
        });
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      console.error('Failed to sync printer audits:', error);
    }
  }

  /**
   * Subscribe to sync status changes
   */
  subscribe(listener: (status: SyncStatus) => void) {
    this.listeners.add(listener);
    // Immediately notify with current status
    listener(this.syncStatus);

    // Return unsubscribe function
    return () => {
      this.listeners.delete(listener);
    };
  }

  subscribeSyncProgress(listener: (progress: number | null) => void) {
    this.progressListeners.add(listener);
    return () => {
      this.progressListeners.delete(listener);
    };
  }

  private notifyProgress(progress: number | null) {
    this.progressListeners.forEach(listener => {
      try {
        listener(progress);
      } catch (error) {
        console.warn('Progress listener error:', error);
      }
    });
  }

  /**
   * Notify all listeners of status change
   */
  private notifyListeners() {
    this.listeners.forEach((listener) => {
      listener({ ...this.syncStatus });
    });
  }

  /**
   * Get current sync status
   */
  getStatus(): SyncStatus {
    return { ...this.syncStatus };
  }

  /**
   * Force a connection check (useful when app starts)
   */
  async forceConnectionCheck(): Promise<void> {
    // console.log('🔧 [FORCE CHECK] forceConnectionCheck called'); // Reduced log noise
    await this.checkConnection();
  }

  /**
   * Get detailed connection status for debugging
   */
  getDetailedStatus(): DetailedSyncStatus {
    const userAgent = typeof window !== 'undefined' ? window.navigator.userAgent : 'Server';
    const platform = typeof window !== 'undefined' ? window.navigator.platform : 'Server';
    return {
      ...this.syncStatus,
      lastSyncTime: this.syncStatus.lastSync,
      timestamp: new Date().toISOString(),
      userAgent,
      platform,
    };
  }

  /**
   * Test individual endpoints for debugging
   */
  async testEndpoints(): Promise<EndpointTestResults> {

    const results: EndpointTestResults = {
      internet: [],
      database: { success: false, error: undefined },
    };

    // Test internet endpoints
    const internetEndpoints = [
      'https://www.google.com/generate_204',
      'https://httpbin.org/status/200',
      'https://www.cloudflare.com/cdn-cgi/trace',
    ];

    for (const endpoint of internetEndpoints) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);

        await fetch(endpoint, {
          method: 'GET',
          cache: 'no-store',
          signal: controller.signal,
          mode: 'no-cors'
        });

        clearTimeout(timeoutId);
        results.internet.push({ endpoint, success: true });
      } catch (error) {
        results.internet.push({
          endpoint,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    // Test database endpoint
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      const healthUrl = cleanUrl(getApiUrl('/api/health-check'));
      const response = await fetch(healthUrl, {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
        mode: 'cors'
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        results.database = { success: true };
        // console.log(`✅ [DEBUG] Database health check - SUCCESS`);
      } else {
        results.database = { success: false, error: `HTTP ${response.status}` };
        // console.log(`❌ [DEBUG] Database health check - FAILED: HTTP ${response.status}`);
      }
    } catch (error) {
      results.database = {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
      // console.log(`❌ [DEBUG] Database health check - FAILED: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    console.log('🧪 [DEBUG] Endpoint test results:', results);
    return results;
  }

  /**
   * Cleanup
   */
  destroy() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
  }
}

// Export singleton instance
export const offlineSyncService = new OfflineSyncService();


