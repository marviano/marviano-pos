import { smartSyncService } from './smartSync';
import { getApiUrl } from '@/lib/api';

type UnknownRecord = Record<string, unknown>;

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

      const response = await fetch(getApiUrl('/api/health-check'), {
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

    // Also trigger smart sync for pending transactions (this will also upload printer audits)
    try {
      await smartSyncService.forceSync();
    } catch (error) {
      console.warn('⚠️ Smart sync failed:', error);
    }

    // NOTE: Printer audits are uploaded by Smart Sync, not here (to avoid redundancy)

    try {
      // Use the comprehensive sync endpoint
      const syncResponse = await fetch(getApiUrl('/api/sync'));
      if (syncResponse.ok) {
        const syncData = await syncResponse.json();
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'offlineSync.ts:282',message:'Sync API response received',data:{success:syncData.success,hasData:!!syncData.data,dataKeys:syncData.data?Object.keys(syncData.data):[],hasProductBusinesses:!!syncData.data?.productBusinesses,productBusinessesCount:Array.isArray(syncData.data?.productBusinesses)?syncData.data.productBusinesses.length:0,hasProduct298:Array.isArray(syncData.data?.productBusinesses)?syncData.data.productBusinesses.some((pb:any)=>pb.product_id===298):false},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
        // #endregion
        if (syncData.success && syncData.data) {
          const { data } = syncData;
          // const targetBusinessId = Number(syncData.businessId ?? 14);

          const totalSteps = 28;
          let completedSteps = 0;
          const advanceProgress = () => {
            completedSteps = Math.min(totalSteps, completedSteps + 1);
            const percent = Math.round((completedSteps / totalSteps) * 100);
            this.notifyProgress(percent);
          };

          // CRITICAL: Sync order matters due to foreign key constraints
          // Handle circular dependency: Organizations <-> Users <-> Roles
          // Strategy: Sync in multiple passes, allowing partial data
          
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'offlineSync.ts:297',message:'Starting multi-pass sync',data:{hasUsers:Array.isArray(data.users)&&data.users.length>0,hasOrgs:Array.isArray(data.organizations)&&data.organizations.length>0,hasRoles:Array.isArray(data.roles)&&data.roles.length>0,userCount:Array.isArray(data.users)?data.users.length:0,orgCount:Array.isArray(data.organizations)?data.organizations.length:0,roleCount:Array.isArray(data.roles)?data.roles.length:0},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'Q'})}).catch(()=>{});
          // #endregion
          // Pass 1: Try to sync organizations (may skip if owner_user_id doesn't exist)
          if (Array.isArray(data.organizations) && data.organizations.length > 0) {
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'offlineSync.ts:300',message:'Pass 1: Syncing organizations',data:{orgCount:data.organizations.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'R'})}).catch(()=>{});
            // #endregion
            await (electronAPI.localDbUpsertOrganizations as (rows: unknown[]) => Promise<{ success: boolean }>)?.(data.organizations);
          }
          advanceProgress();

          // Pass 2: Permission Categories (needed by permissions)
          if (Array.isArray(data.permissionCategories) && data.permissionCategories.length > 0) {
            await (electronAPI.localDbUpsertPermissionCategories as (rows: unknown[]) => Promise<{ success: boolean }>)?.(data.permissionCategories);
          }
          advanceProgress();

          // Pass 3: Roles (needs organizations - may skip if org doesn't exist)
          if (Array.isArray(data.roles)) {
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'offlineSync.ts:312',message:'Pass 3: Syncing roles',data:{roleCount:data.roles.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'S'})}).catch(()=>{});
            // #endregion
            await (electronAPI.localDbUpsertRoles as (rows: unknown[]) => Promise<{ success: boolean }>)?.(data.roles);
          }
          advanceProgress();

          // Pass 4: Users (FIRST PASS - skip role validation to break circular dependency)
          if (Array.isArray(data.users) && data.users.length > 0) {
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'offlineSync.ts:319',message:'Pass 4: Syncing users (first pass - skip validation)',data:{userCount:data.users.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'T'})}).catch(()=>{});
            // #endregion
            await (electronAPI.localDbUpsertUsers as (rows: unknown[], skipValidation?: boolean) => Promise<{ success: boolean }>)?.(data.users, true);
          }
          advanceProgress();

          // Pass 5: Retry organizations now that users might exist (WITH validation)
          if (Array.isArray(data.organizations) && data.organizations.length > 0) {
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'offlineSync.ts:326',message:'Pass 5: Retrying organizations (with validation)',data:{orgCount:data.organizations.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'U'})}).catch(()=>{});
            // #endregion
            await (electronAPI.localDbUpsertOrganizations as (rows: unknown[], skipValidation?: boolean) => Promise<{ success: boolean }>)?.(data.organizations, false);
          }
          advanceProgress();

          // Pass 6: Retry roles now that organizations might exist
          if (Array.isArray(data.roles)) {
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'offlineSync.ts:332',message:'Pass 6: Retrying roles',data:{roleCount:data.roles.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'V'})}).catch(()=>{});
            // #endregion
            await (electronAPI.localDbUpsertRoles as (rows: unknown[]) => Promise<{ success: boolean }>)?.(data.roles);
          }
          advanceProgress();

          // Pass 7: Retry users now that roles might exist (WITH validation)
          if (Array.isArray(data.users) && data.users.length > 0) {
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'offlineSync.ts:338',message:'Pass 7: Retrying users (with validation)',data:{userCount:data.users.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'W'})}).catch(()=>{});
            // #endregion
            await (electronAPI.localDbUpsertUsers as (rows: unknown[], skipValidation?: boolean) => Promise<{ success: boolean }>)?.(data.users, false);
          }
          advanceProgress();

          // 6. Businesses (needs organizations)
          if (Array.isArray(data.businesses) && data.businesses.length > 0) {
            await (electronAPI.localDbUpsertBusinesses as (rows: unknown[]) => Promise<{ success: boolean }>)?.(data.businesses);
            // console.log(`✅ ${data.businesses.length} businesses synced to local database`);
          }
          advanceProgress();

          // PRIORITIZE DEPENDENCIES: Category1, Category2, Types, Options
          if (Array.isArray(data.category1) && data.category1.length > 0) {
            await (electronAPI.localDbUpsertCategory1 as (rows: unknown[]) => Promise<{ success: boolean }>)?.(data.category1);
            // console.log(`✅ ${data.category1.length} category1 records synced to local database`);
          }
          advanceProgress();

          if (Array.isArray(data.category2) && data.category2.length > 0) {
            // Get junction table data (REQUIRED - junction table only, no business_id column)
            const junctionTableData = (data.category2Businesses as Array<{ category2_id: number; business_id: number }> | undefined) || undefined;
            if (!junctionTableData || junctionTableData.length === 0) {
              console.warn(`⚠️ [OFFLINE SYNC] No junction table data provided for category2 - skipping sync`);
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
            console.log(`📦 [SYNC] Received ${data.products.length} products from API`);
            if (data.products.length > 0) {
              await (electronAPI.localDbUpsertProducts as (rows: unknown[]) => Promise<{ success: boolean }>)?.(data.products);
              // console.log(`✅ ${data.products.length} products synced to local database`);
              
              // Cleanup orphaned products (products that exist locally but not in sync data)
              const businessId = syncData.businessId || 14; // Default to 14 if not provided
              const syncedProductIds = data.products.map((p: any) => p.id).filter((id: any): id is number => typeof id === 'number');
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
            console.warn('⚠️ [SYNC] Products data is missing or not an array');
          }
          
          // Sync product_businesses junction table (REQUIRED for product filtering)
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'offlineSync.ts:416',message:'Checking productBusinesses data',data:{hasProductBusinesses:!!data.productBusinesses,isArray:Array.isArray(data.productBusinesses),length:Array.isArray(data.productBusinesses)?data.productBusinesses.length:0,hasProduct298:Array.isArray(data.productBusinesses)?data.productBusinesses.some((pb:any)=>pb.product_id===298):false,allKeys:Object.keys(data)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
          // #endregion
          if (Array.isArray(data.productBusinesses) && data.productBusinesses.length > 0) {
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'offlineSync.ts:418',message:'Calling localDbUpsertProductBusinesses',data:{count:data.productBusinesses.length,hasProduct298:data.productBusinesses.some((pb:any)=>pb.product_id===298),sampleData:data.productBusinesses.slice(0,3)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
            // #endregion
            await (electronAPI.localDbUpsertProductBusinesses as (rows: Array<{ product_id: number; business_id: number }>) => Promise<{ success: boolean }>)?.(data.productBusinesses);
            console.log(`✅ [SYNC] ${data.productBusinesses.length} product-business relationships synced to local database`);
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'offlineSync.ts:420',message:'localDbUpsertProductBusinesses completed',data:{count:data.productBusinesses.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
            // #endregion
          } else {
            console.warn('⚠️ [SYNC] product_businesses data is missing or empty - products may not appear correctly');
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'offlineSync.ts:421',message:'product_businesses data missing',data:{hasProductBusinesses:!!data.productBusinesses,isArray:Array.isArray(data.productBusinesses),type:typeof data.productBusinesses,allKeys:Object.keys(data)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
            // #endregion
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

          if (Array.isArray(data.source) && data.source.length > 0) {
            await (electronAPI.localDbUpsertSource as (rows: unknown[]) => Promise<{ success: boolean }>)?.(data.source);
            // console.log(`✅ ${data.source.length} source records synced to local database`);
          }
          advanceProgress();

          if (Array.isArray(data.pekerjaan) && data.pekerjaan.length > 0) {
            await (electronAPI.localDbUpsertPekerjaan as (rows: unknown[]) => Promise<{ success: boolean }>)?.(data.pekerjaan);
            // console.log(`✅ ${data.pekerjaan.length} pekerjaan records synced to local database`);
          }
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
            console.log(`📦 [SYNC] Received ${data.bundleItems.length} bundle items from API`);
            if (data.bundleItems.length > 0) {
              console.log(`📦 [SYNC] First bundle item sample:`, data.bundleItems[0]);
              await (electronAPI.localDbUpsertBundleItems as (rows: unknown[]) => Promise<{ success: boolean }>)?.(data.bundleItems);
              // console.log(`✅ ${data.bundleItems.length} bundle items synced to local database`);
            } else {
              console.warn('⚠️ [SYNC] No bundle items received from API');
            }
          } else {
            console.warn('⚠️ [SYNC] bundleItems is not an array:', typeof data.bundleItems);
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

          // console.log('✅ Comprehensive sync completed successfully');
          // console.log('✅ All POS tables now available offline!');
          // console.log(`📊 Summary: ${syncData.summary}`);
        } else {
          throw new Error('Invalid sync response format');
        }
      } else {
        throw new Error(`Sync request failed: ${syncResponse.status}`);
      }
    } catch (error) {
      console.error('❌ Comprehensive sync failed:', error);
      this.notifyProgress(null);
      if (electronAPI) {
        await (electronAPI.localDbUpdateSyncStatus as (key: string, status: string) => Promise<{ success: boolean }>)?.(
          'last_full_sync',
          'failed'
        );
      }
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
      console.log('📱 [FETCH FALLBACK] Offline detected, using offline fetch directly');
      return offlineFetch();
    }

    try {
      const result = await onlineFetch();
      return result;
    } catch (error) {
      console.log('⚠️ [FETCH FALLBACK] Online failed, triggering offline...', error);
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
      console.log('🔄 [PRINTER AUDIT SYNC] Starting printer audit log sync...');

      const unsyncedAudits = await (electronAPI.localDbGetUnsyncedPrinterAudits as () => Promise<{ p1?: unknown[]; p2?: unknown[] } | null>)?.();
      const printer1Audits = Array.isArray(unsyncedAudits?.p1) ? unsyncedAudits.p1 : [];
      const printer2Audits = Array.isArray(unsyncedAudits?.p2) ? unsyncedAudits.p2 : [];

      if (printer1Audits.length === 0 && printer2Audits.length === 0) {
        console.log('✅ [PRINTER AUDIT SYNC] No printer audits to sync');
        return;
      }

      console.log(`📦 [PRINTER AUDIT SYNC] Found ${printer1Audits.length} Printer 1 and ${printer2Audits.length} Printer 2 audits to sync`);

      const response = await fetch(getApiUrl('/api/printer-audits'), {
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
        console.log('✅ [PRINTER AUDIT SYNC] Marked printer audits as synced locally');
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      console.error('❌ [PRINTER AUDIT SYNC] Failed to sync printer audits:', error);
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
    console.log('🧪 [DEBUG] Testing all endpoints individually...');

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
        console.log(`✅ [DEBUG] ${endpoint} - SUCCESS`);
      } catch (error) {
        results.internet.push({
          endpoint,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        console.log(`❌ [DEBUG] ${endpoint} - FAILED: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    // Test database endpoint
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      const response = await fetch(getApiUrl('/api/health-check'), {
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


