/**
 * Database Health Check and Initial Sync
 * Ensures local database has master data before going offline
 * 
 * IMPORTANT: This service only syncs MASTER DATA (products, categories, etc.)
 * Transaction data is NOT synced to prevent data corruption.
 * Use SyncManagement component for full bidirectional sync with transaction upload.
 */

import { getApiUrl, cleanUrl } from '@/lib/api';

type UnknownRecord = Record<string, unknown>;

const isElectron = typeof window !== 'undefined' && (window as { electronAPI?: UnknownRecord }).electronAPI;

export interface DatabaseHealth {
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
      const electronAPI = typeof window !== 'undefined' ? (window as { electronAPI?: UnknownRecord }).electronAPI : undefined;
      if (!electronAPI?.localDbGetAllProducts ||
        !electronAPI?.localDbGetCategories) {
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
      const products = await (electronAPI.localDbGetAllProducts as () => Promise<unknown[]>)();
      const productCount = Array.isArray(products) ? products.length : 0;

      // Check categories
      const categories = await (electronAPI.localDbGetCategories as () => Promise<unknown[]>)();
      const categoryCount = Array.isArray(categories) ? categories.length : 0;

      // Check last sync status
      const syncStatus = electronAPI.localDbGetSyncStatus ?
        await (electronAPI.localDbGetSyncStatus as (key: string) => Promise<{ key: string; last_sync: number; status: string } | null>)('last_sync') : null;
      const lastSync = syncStatus ? syncStatus.last_sync : null;

      // Determine if sync is needed
      const needsSync: boolean = productCount === 0 || categoryCount === 0 ||
        (lastSync !== null && Date.now() - lastSync > 3600000); // 1 hour

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
      return true;
    }


    try {
      // Trigger comprehensive sync
      const syncUrl = cleanUrl(getApiUrl('/api/sync'));
      const response = await fetch(syncUrl);
      if (response.ok) {
        // Check if response is actually JSON before parsing
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          const text = await response.text();
          throw new Error(`Server returned non-JSON response (${contentType}). Response: ${text.substring(0, 200)}`);
        }
        await response.json();

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

}

// Export singleton instance
export const databaseHealthService = new DatabaseHealthService();
