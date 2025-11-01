/**
 * Database Health Check and Initial Sync
 * Ensures SQLite database has data before going offline
 */

const isElectron = typeof window !== 'undefined' && (window as any).electronAPI;

interface DatabaseHealth {
  hasProducts: boolean;
  hasCategories: boolean;
  productCount: number;
  categoryCount: number;
  lastSync: number | null;
  needsSync: boolean;
}

class DatabaseHealthService {
  /**
   * Check if local database has sufficient data for offline operation
   */
  async checkDatabaseHealth(): Promise<DatabaseHealth> {
    if (!isElectron) {
      return {
        hasProducts: false,
        hasCategories: false,
        productCount: 0,
        categoryCount: 0,
        lastSync: null,
        needsSync: true,
      };
    }

    try {
      // Check if methods are available
      if (!(window as any).electronAPI?.localDbGetAllProducts || 
          !(window as any).electronAPI?.localDbGetCategories) {
        console.warn('⚠️ [DB HEALTH] Required Electron API methods not available - Electron may need restart');
        return {
          hasProducts: false,
          hasCategories: false,
          productCount: 0,
          categoryCount: 0,
          lastSync: null,
          needsSync: true,
        };
      }

      // Check products
      const products = await (window as any).electronAPI.localDbGetAllProducts();
      const productCount = products ? products.length : 0;
      
      // Check categories
      const categories = await (window as any).electronAPI.localDbGetCategories();
      const categoryCount = categories ? categories.length : 0;
      
      // Check last sync status
      const syncStatus = (window as any).electronAPI?.localDbGetSyncStatus ? 
        await (window as any).electronAPI.localDbGetSyncStatus('last_sync') : null;
      const lastSync = syncStatus ? syncStatus.last_sync : null;
      
      // Determine if sync is needed
      const needsSync = productCount === 0 || categoryCount === 0 || 
                       (lastSync && Date.now() - lastSync > 3600000); // 1 hour
      
      return {
        hasProducts: productCount > 0,
        hasCategories: categoryCount > 0,
        productCount,
        categoryCount,
        lastSync,
        needsSync,
      };
    } catch (error) {
      console.error('❌ [DB HEALTH] Error checking database health:', error);
      return {
        hasProducts: false,
        hasCategories: false,
        productCount: 0,
        categoryCount: 0,
        lastSync: null,
        needsSync: true,
      };
    }
  }

  /**
   * Perform initial sync if database is empty
   */
  async ensureDatabasePopulated(): Promise<boolean> {
    const health = await this.checkDatabaseHealth();
    
    if (!health.needsSync) {
      console.log('✅ [DB HEALTH] Database is healthy, no sync needed');
      return true;
    }

    console.log('🔄 [DB HEALTH] Database needs sync, performing initial sync...');
    
    try {
      // Trigger comprehensive sync
      const response = await fetch('/api/sync');
      if (response.ok) {
        const data = await response.json();
        console.log('✅ [DB HEALTH] Initial sync completed');
        
        // Verify sync was successful
        const newHealth = await this.checkDatabaseHealth();
        return newHealth.hasProducts && newHealth.hasCategories;
      } else {
        throw new Error(`Sync failed: ${response.status}`);
      }
    } catch (error) {
      console.error('❌ [DB HEALTH] Initial sync failed:', error);
      return false;
    }
  }

  /**
   * Get database status for UI display
   */
  async getStatusMessage(): Promise<string> {
    const health = await this.checkDatabaseHealth();
    
    if (health.hasProducts && health.hasCategories) {
      return `Database ready (${health.productCount} products, ${health.categoryCount} categories)`;
    } else if (health.needsSync) {
      return 'Database empty - sync required for offline operation';
    } else {
      return 'Database status unknown';
    }
  }

  /**
   * Force sync all data
   */
  async forceSync(): Promise<boolean> {
    console.log('🔄 [DB HEALTH] Force syncing all data...');
    
    try {
      const response = await fetch('/api/sync');
      if (response.ok) {
        const jsonData = await response.json();
        const data = jsonData.data || jsonData;
        
        // Save to local database
        const isElectron = typeof window !== 'undefined' && (window as any).electronAPI;
        if (isElectron) {
          const electronAPI = (window as any).electronAPI;
          
          if (data.products && data.products.length > 0) {
            await electronAPI.localDbUpsertProducts(data.products);
            console.log(`✅ ${data.products.length} products synced to local database`);
          }
          
          if (data.bundleItems && data.bundleItems.length > 0) {
            await electronAPI.localDbUpsertBundleItems(data.bundleItems);
            console.log(`✅ ${data.bundleItems.length} bundle items synced to local database`);
          }
          
          if (data.transactions && data.transactions.length > 0) {
            const transactionsWithSyncStatus = data.transactions.map((tx: any) => ({
              ...tx,
              synced_at: Date.now()
            }));
            await electronAPI.localDbUpsertTransactions(transactionsWithSyncStatus);
            console.log(`✅ ${data.transactions.length} transactions synced to local database`);
          }
          
          if (data.paymentMethods && data.paymentMethods.length > 0) {
            await electronAPI.localDbUpsertPaymentMethods(data.paymentMethods);
          }
          
          if (data.banks && data.banks.length > 0) {
            await electronAPI.localDbUpsertBanks(data.banks);
          }
          
          if (data.organizations && data.organizations.length > 0) {
            await electronAPI.localDbUpsertOrganizations(data.organizations);
          }
          
          if (data.managementGroups && data.managementGroups.length > 0) {
            await electronAPI.localDbUpsertManagementGroups(data.managementGroups);
          }
          
          if (data.category1 && data.category1.length > 0) {
            await electronAPI.localDbUpsertCategory1(data.category1);
          }
          
          if (data.category2 && data.category2.length > 0) {
            await electronAPI.localDbUpsertCategory2(data.category2);
          }
          
          if (data.clAccounts && data.clAccounts.length > 0) {
            await electronAPI.localDbUpsertClAccounts(data.clAccounts);
          }
          
          if (data.omset && data.omset.length > 0) {
            await electronAPI.localDbUpsertOmset(data.omset);
          }
        }
        
        console.log('✅ [DB HEALTH] Force sync completed');
        return true;
      } else {
        throw new Error(`Force sync failed: ${response.status}`);
      }
    } catch (error) {
      console.error('❌ [DB HEALTH] Force sync failed:', error);
      return false;
    }
  }
}

// Export singleton instance
export const databaseHealthService = new DatabaseHealthService();
