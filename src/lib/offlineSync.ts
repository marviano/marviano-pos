import { restorePrinterStateFromCloud } from './printerSyncUtils';

/**
 * Offline Sync Service
 * Handles data synchronization between online MySQL and offline SQLite database
 */

// Check if window.electronAPI is available
const isElectron = typeof window !== 'undefined' && (window as any).electronAPI;

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

  constructor() {
    console.log('🚀 [OFFLINE SYNC] Service initializing...');
    if (typeof window !== 'undefined') {
      // Immediately check connection status on initialization
      console.log('🔍 [OFFLINE SYNC] Starting initial connection check...');
      this.checkConnection();
      this.initializeConnectionMonitoring();
    }
  }

  /**
   * Initialize connection monitoring
   */
  private initializeConnectionMonitoring() {
    console.log('🔄 [OFFLINE SYNC] Setting up connection monitoring...');
    // Check online status periodically
    this.checkInterval = setInterval(() => {
      this.checkConnection();
    }, 5000); // Check every 5 seconds

    // Listen to browser online/offline events
    window.addEventListener('online', () => {
      console.log('🌐 [OFFLINE SYNC] Browser detected: ONLINE');
      // Don't immediately trust browser online event - verify with actual API call
      setTimeout(() => {
        this.checkConnection();
      }, 1000); // Wait 1 second then verify
    });

    window.addEventListener('offline', () => {
      console.log('🌐 [OFFLINE SYNC] Browser detected: OFFLINE');
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
        
        const response = await fetch(endpoint, {
          method: 'GET',
          cache: 'no-store',
          signal: controller.signal,
          mode: 'no-cors' // Use no-cors for external endpoints
        });

        clearTimeout(timeoutId);
        
        // For no-cors requests, we can't read response status, but if we don't get an error, we're online
        return { connected: true, endpoint };
        
      } catch (error) {
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
      
      const response = await fetch('/api/health-check', {
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
      return { connected: false, details: `Connection failed: ${error.message}` };
    }
  }

  /**
   * Comprehensive connection check - separates internet vs database connectivity
   */
  private async checkConnection() {
    const startTime = Date.now();
    
    try {
      // Check both internet and database connectivity in parallel
      const [internetResult, databaseResult] = await Promise.all([
        this.checkInternetConnectivity(),
        this.checkDatabaseConnectivity()
      ]);

      const checkTime = Date.now() - startTime;
      
      // Update connection details
      this.syncStatus.connectionDetails = {
        internetCheck: internetResult.connected ? internetResult.endpoint : 'Failed',
        databaseCheck: databaseResult.details,
        lastCheckTime: Date.now(),
      };

      // Determine overall online status
      // We're "online" only if we have internet connectivity (for sync purposes)
      const wasOnline = this.syncStatus.isOnline;
      const wasInternetConnected = this.syncStatus.internetConnected;
      const wasDatabaseConnected = this.syncStatus.databaseConnected;

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
      // console.log('❌ [CONNECTION CHECK] Connection check failed:', error.message);
      
      // Mark everything as failed on error
      this.syncStatus.internetConnected = false;
      this.syncStatus.databaseConnected = false;
      this.syncStatus.isOnline = false;
      this.syncStatus.connectionDetails = {
        internetCheck: 'Error',
        databaseCheck: `Error: ${error.message}`,
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
   * Sync data from online MySQL to local SQLite - COMPREHENSIVE SYNC
   * Downloads ALL POS tables for complete offline functionality
   * Uses smart sync to prevent server overload
   */
  async syncFromOnline() {
    if (!isElectron || this.syncStatus.syncInProgress || !this.syncStatus.isOnline) {
      return;
    }

    console.log('🔄 Starting comprehensive sync from online database...');
    console.log('📥 This will download ALL POS tables for complete offline functionality');
    this.syncStatus.syncInProgress = true;
    this.notifyListeners();

    // Also trigger smart sync for pending transactions
    try {
      await smartSyncService.forceSync();
    } catch (error) {
      console.warn('⚠️ Smart sync failed:', error);
    }

    // Also trigger printer audit sync
    try {
      await this.syncPrinterAudits();
    } catch (error) {
      console.warn('⚠️ Printer audit sync failed:', error);
    }

    try {
      // Use the comprehensive sync endpoint
      const syncResponse = await fetch('/api/sync');
      if (syncResponse.ok) {
        const syncData = await syncResponse.json();
        if (syncData.success && syncData.data) {
          const { data, counts } = syncData;
          const targetBusinessId = Number(syncData.businessId ?? 14);
          
          // Cache all tables to local SQLite
          if (data.users && data.users.length > 0) {
            await (window as any).electronAPI.localDbUpsertUsers(data.users);
            console.log(`✅ ${data.users.length} users synced to local database`);
          }
          
          if (data.businesses && data.businesses.length > 0) {
            await (window as any).electronAPI.localDbUpsertBusinesses(data.businesses);
            console.log(`✅ ${data.businesses.length} businesses synced to local database`);
          }
          
          if (data.categories && data.categories.length > 0) {
            await (window as any).electronAPI.localDbUpsertCategories(
              data.categories.map((cat: any) => ({
                category2_name: cat.jenis || cat.category2_name,
                updated_at: Date.now(),
              }))
            );
            console.log(`✅ ${data.categories.length} categories synced to local database`);
          }
          
          if (data.products && data.products.length > 0) {
            await (window as any).electronAPI.localDbUpsertProducts(data.products);
            console.log(`✅ ${data.products.length} products synced to local database`);
          }
          
          if (data.customizationTypes && data.customizationTypes.length > 0) {
            await (window as any).electronAPI.localDbUpsertCustomizationTypes(data.customizationTypes);
            console.log(`✅ ${data.customizationTypes.length} customization types synced to local database`);
          }
          
          if (data.customizationOptions && data.customizationOptions.length > 0) {
            await (window as any).electronAPI.localDbUpsertCustomizationOptions(data.customizationOptions);
            console.log(`✅ ${data.customizationOptions.length} customization options synced to local database`);
          }
          
          if (data.productCustomizations && data.productCustomizations.length > 0) {
            await (window as any).electronAPI.localDbUpsertProductCustomizations(data.productCustomizations);
            console.log(`✅ ${data.productCustomizations.length} product customizations synced to local database`);
          }
          
          if (data.ingredients && data.ingredients.length > 0) {
            await (window as any).electronAPI.localDbUpsertIngredients(data.ingredients);
            console.log(`✅ ${data.ingredients.length} ingredients synced to local database`);
          }
          
          if (data.cogs && data.cogs.length > 0) {
            await (window as any).electronAPI.localDbUpsertCogs(data.cogs);
            console.log(`✅ ${data.cogs.length} COGS records synced to local database`);
          }
          
          if (data.contacts && data.contacts.length > 0) {
            await (window as any).electronAPI.localDbUpsertContacts(data.contacts);
            console.log(`✅ ${data.contacts.length} contacts synced to local database`);
          }
          
          if (data.teams && data.teams.length > 0) {
            await (window as any).electronAPI.localDbUpsertTeams(data.teams);
            console.log(`✅ ${data.teams.length} teams synced to local database`);
          }
          
          if (Array.isArray(data.roles)) {
            await (window as any).electronAPI.localDbUpsertRoles(data.roles);
            console.log(`✅ ${data.roles.length} roles synced to local database`);
          }
          
          if (Array.isArray(data.permissions)) {
            await (window as any).electronAPI.localDbUpsertPermissions(data.permissions);
            console.log(`✅ ${data.permissions.length} permissions synced to local database`);
          }
          
          if (Array.isArray(data.rolePermissions)) {
            await (window as any).electronAPI.localDbUpsertRolePermissions(data.rolePermissions);
            console.log(`✅ ${data.rolePermissions.length} role-permission mappings synced to local database`);
          }
          
          if (data.source && data.source.length > 0) {
            await (window as any).electronAPI.localDbUpsertSource(data.source);
            console.log(`✅ ${data.source.length} source records synced to local database`);
          }
          
          if (data.pekerjaan && data.pekerjaan.length > 0) {
            await (window as any).electronAPI.localDbUpsertPekerjaan(data.pekerjaan);
            console.log(`✅ ${data.pekerjaan.length} pekerjaan records synced to local database`);
          }
          
          // Sync new tables for enhanced offline support
          if (data.paymentMethods && data.paymentMethods.length > 0) {
            await (window as any).electronAPI.localDbUpsertPaymentMethods(data.paymentMethods);
            console.log(`✅ ${data.paymentMethods.length} payment methods synced to local database`);
          }
          
          if (data.banks && data.banks.length > 0) {
            await (window as any).electronAPI.localDbUpsertBanks(data.banks);
            console.log(`✅ ${data.banks.length} banks synced to local database`);
          }
          
          if (data.organizations && data.organizations.length > 0) {
            await (window as any).electronAPI.localDbUpsertOrganizations(data.organizations);
            console.log(`✅ ${data.organizations.length} organizations synced to local database`);
          }
          
          if (data.managementGroups && data.managementGroups.length > 0) {
            await (window as any).electronAPI.localDbUpsertManagementGroups(data.managementGroups);
            console.log(`✅ ${data.managementGroups.length} management groups synced to local database`);
          }
          
          if (data.category1 && data.category1.length > 0) {
            await (window as any).electronAPI.localDbUpsertCategory1(data.category1);
            console.log(`✅ ${data.category1.length} category1 records synced to local database`);
          }
          
          if (data.category2 && data.category2.length > 0) {
            await (window as any).electronAPI.localDbUpsertCategory2(data.category2);
            console.log(`✅ ${data.category2.length} category2 records synced to local database`);
          }
          
          if (data.clAccounts && data.clAccounts.length > 0) {
            await (window as any).electronAPI.localDbUpsertClAccounts(data.clAccounts);
            console.log(`✅ ${data.clAccounts.length} CL accounts synced to local database`);
          }
          
          await restorePrinterStateFromCloud(data, (window as any).electronAPI, targetBusinessId);
          
          // Update sync status
          this.syncStatus.lastSync = Date.now();
          await (window as any).electronAPI.localDbUpdateSyncStatus(
            'last_full_sync',
            'success'
          );
          
          console.log('✅ Comprehensive sync completed successfully');
          console.log('✅ All POS tables now available offline!');
          console.log(`📊 Summary: ${syncData.summary}`);
        } else {
          throw new Error('Invalid sync response format');
        }
      } else {
        throw new Error(`Sync request failed: ${syncResponse.status}`);
      }
    } catch (error) {
      console.error('❌ Comprehensive sync failed:', error);
      if (isElectron) {
        await (window as any).electronAPI.localDbUpdateSyncStatus(
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
      try {
        const result = await onlineFetch();
        return result;
      } catch (error) {
      console.log('⚠️ fetchWithFallback: Online failed, triggering offline...');
      this.checkConnection();
      return offlineFetch();
    }
  }

  /**
   * Sync printer audit logs to server
   */
  async syncPrinterAudits() {
    if (!isElectron || !this.syncStatus.isOnline) {
      return;
    }

    try {
      console.log('🔄 [PRINTER AUDIT SYNC] Starting printer audit log sync...');
      
      // Get unsynced printer audits from local database
      const unsyncedAudits = await (window as any).electronAPI.localDbGetUnsyncedPrinterAudits();
      
      if (!unsyncedAudits || (unsyncedAudits.p1.length === 0 && unsyncedAudits.p2.length === 0)) {
        console.log('✅ [PRINTER AUDIT SYNC] No printer audits to sync');
        return;
      }

      console.log(`📦 [PRINTER AUDIT SYNC] Found ${unsyncedAudits.p1.length} Printer 1 and ${unsyncedAudits.p2.length} Printer 2 audits to sync`);

      // Send to server
      const response = await fetch('/api/printer-audits', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          printer1Audits: unsyncedAudits.p1,
          printer2Audits: unsyncedAudits.p2
        }),
      });

      if (response.ok) {
        const result = await response.json();
        console.log('✅ [PRINTER AUDIT SYNC] Printer audits synced successfully:', result);

        // Mark as synced locally
        const p1Ids = unsyncedAudits.p1.map((a: any) => a.id);
        const p2Ids = unsyncedAudits.p2.map((a: any) => a.id);
        await (window as any).electronAPI.localDbMarkPrinterAuditsSynced({ p1Ids, p2Ids });
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
    console.log('🔧 [FORCE CHECK] forceConnectionCheck called');
    await this.checkConnection();
  }

  /**
   * Get detailed connection status for debugging
   */
  getDetailedStatus() {
    return {
      ...this.syncStatus,
      timestamp: new Date().toISOString(),
      userAgent: typeof window !== 'undefined' ? window.navigator.userAgent : 'Server',
      platform: typeof window !== 'undefined' ? window.navigator.platform : 'Server',
    };
  }

  /**
   * Test individual endpoints for debugging
   */
  async testEndpoints() {
    console.log('🧪 [DEBUG] Testing all endpoints individually...');
    
    const results = {
      internet: [] as Array<{ endpoint: string; success: boolean; error?: string }>,
      database: { success: false, error: undefined } as { success: boolean; error?: string }
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
      
      const response = await fetch('/api/health-check', {
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


