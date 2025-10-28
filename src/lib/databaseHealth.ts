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
