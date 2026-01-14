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

  /**
   * Force sync master data only (no transaction data)
   * 
   * This method downloads:
   * - Products, categories, bundle items
   * - Customization types and options
   * - Payment methods, banks, organizations
   * - Management groups, CL accounts
   * 
   * Transaction data is NOT downloaded to prevent data corruption:
   * - POS device is the source of truth for transactions
   * - Use "Download Transaction Data" feature for emergency recovery only
   */
  async forceSync(): Promise<boolean> {
    // console.log('🔄 [DB HEALTH] Force syncing master data (transactions skipped for safety)...');

    try {
      const syncUrl = cleanUrl(getApiUrl('/api/sync'));
      const response = await fetch(syncUrl);
      
      // Handle redirects explicitly
      if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
        throw new Error(`Server redirected from ${syncUrl} to ${response.url || 'unknown'}. The API endpoint may not exist on this server.`);
      }
      if (response.ok) {
        // Check if response is actually JSON before parsing
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          const text = await response.text();
          throw new Error(`Server returned non-JSON response (${contentType}). Response: ${text.substring(0, 200)}`);
        }
        const jsonData = await response.json();
        const data = jsonData.data || jsonData;// Save to local database
        const electronAPI = typeof window !== 'undefined' ? (window as { electronAPI?: UnknownRecord }).electronAPI : undefined;
        if (electronAPI) {
          // 1. CATEGORIES FIRST (dependencies)
          if (data.category1 && data.category1.length > 0) {
            await (electronAPI.localDbUpsertCategory1 as (rows: unknown[]) => Promise<{ success: boolean }>)(data.category1);
          }

          if (data.category2 && data.category2.length > 0) {
            // Get junction table data (REQUIRED - junction table only, no business_id column)
            const junctionTableData = (data.category2Businesses as Array<{ category2_id: number; business_id: number }> | undefined) || undefined;
            if (!junctionTableData || junctionTableData.length === 0) {
            } else {
              await (electronAPI.localDbUpsertCategory2 as (rows: unknown[], junctionData?: Array<{ category2_id: number; business_id: number }>) => Promise<{ success: boolean }>)(data.category2, junctionTableData);
            }
          }

          // Legacy categories format support
          if (Array.isArray(data.categories) && data.categories.length > 0) {
            const formattedCategories = data.categories
              .map((cat: UnknownRecord) => ({
                category2_name: (cat.category2_name || cat.jenis) as string,
                updated_at: Date.now()
              }))
              .filter((cat: { category2_name?: string }) => !!cat.category2_name);

            if (formattedCategories.length > 0) {
              await (electronAPI.localDbUpsertCategories as (rows: unknown[]) => Promise<{ success: boolean }>)(formattedCategories);
            }
          }

          // 2. CUSTOMIZATION TYPES AND OPTIONS (dependencies)
          if (electronAPI.localDbUpsertCustomizationTypes && data.customizationTypes && data.customizationTypes.length > 0) {
            await (electronAPI.localDbUpsertCustomizationTypes as (rows: unknown[]) => Promise<{ success: boolean }>)(data.customizationTypes);
          }

          if (electronAPI.localDbUpsertCustomizationOptions && data.customizationOptions && data.customizationOptions.length > 0) {
            await (electronAPI.localDbUpsertCustomizationOptions as (rows: unknown[]) => Promise<{ success: boolean }>)(data.customizationOptions);
          }

          // 3. PRODUCTS (depends on categories and customization types)
          if (Array.isArray(data.products) && data.products.length > 0) {
            await (electronAPI.localDbUpsertProducts as (rows: unknown[]) => Promise<{ success: boolean }>)(data.products);
          }

          // 3.5. PRODUCT-BUSINESSES JUNCTION TABLE (REQUIRED for product filtering)
          if (electronAPI.localDbUpsertProductBusinesses && Array.isArray(data.productBusinesses) && data.productBusinesses.length > 0) {
            await (electronAPI.localDbUpsertProductBusinesses as (rows: Array<{ product_id: number; business_id: number }>) => Promise<{ success: boolean }>)(data.productBusinesses);
          } else if (Array.isArray(data.productBusinesses) && data.productBusinesses.length === 0) {
            // product_businesses data is empty
          } else if (!data.productBusinesses) {
            // product_businesses data is missing from API response
          }

          // 4. PRODUCT-RELATED DATA
          if (electronAPI.localDbUpsertProductCustomizations && data.productCustomizations && data.productCustomizations.length > 0) {
            await (electronAPI.localDbUpsertProductCustomizations as (rows: unknown[]) => Promise<{ success: boolean }>)(data.productCustomizations);
          }

          if (Array.isArray(data.bundleItems) && data.bundleItems.length > 0) {
            await (electronAPI.localDbUpsertBundleItems as (rows: unknown[]) => Promise<{ success: boolean }>)(data.bundleItems);
          }

          // 5. SKIP TRANSACTION DATA (SAFETY)
          // Transaction data is NOT downloaded to prevent overwriting local records
          // Reason: POS device is the source of truth for transaction data
          // Tables skipped: transactions, transaction_items, shifts, refunds, printer logs

          // 6. PAYMENT AND ORGANIZATION DATA
          if (data.paymentMethods && data.paymentMethods.length > 0) {
            await (electronAPI.localDbUpsertPaymentMethods as (rows: unknown[]) => Promise<{ success: boolean }>)(data.paymentMethods);
          }

          if (data.banks && data.banks.length > 0) {
            await (electronAPI.localDbUpsertBanks as (rows: unknown[]) => Promise<{ success: boolean }>)(data.banks);
          }

          if (data.organizations && data.organizations.length > 0) {
            await (electronAPI.localDbUpsertOrganizations as (rows: unknown[]) => Promise<{ success: boolean }>)(data.organizations);
          }

          if (data.managementGroups && data.managementGroups.length > 0) {
            await (electronAPI.localDbUpsertManagementGroups as (rows: unknown[]) => Promise<{ success: boolean }>)(data.managementGroups);
          }

          if (data.clAccounts && data.clAccounts.length > 0) {
            await (electronAPI.localDbUpsertClAccounts as (rows: unknown[]) => Promise<{ success: boolean }>)(data.clAccounts);
          }

          // 7. RESTAURANT TABLE LAYOUT (rooms first, then tables due to foreign key)
          if (electronAPI.localDbUpsertRestaurantRooms) {
            if (data.restaurantRooms && Array.isArray(data.restaurantRooms) && data.restaurantRooms.length > 0) {
              const result = await (electronAPI.localDbUpsertRestaurantRooms as (rows: unknown[]) => Promise<{ success: boolean }>)(data.restaurantRooms);
              // Restaurant rooms synced
            }
          }

          if (electronAPI.localDbUpsertRestaurantTables) {
            if (data.restaurantTables && Array.isArray(data.restaurantTables) && data.restaurantTables.length > 0) {
              const result = await (electronAPI.localDbUpsertRestaurantTables as (rows: unknown[]) => Promise<{ success: boolean }>)(data.restaurantTables);
              // Restaurant tables synced
            }
          }

          if (electronAPI.localDbUpsertRestaurantLayoutElements) {
            if (data.restaurantLayoutElements && Array.isArray(data.restaurantLayoutElements) && data.restaurantLayoutElements.length > 0) {
              await (electronAPI.localDbUpsertRestaurantLayoutElements as (rows: unknown[]) => Promise<{ success: boolean }>)(data.restaurantLayoutElements);
              // Restaurant layout elements synced
            }
          }

        }

        return true;
      } else {
        throw new Error(`Force sync failed: ${response.status}`);
      }
    } catch (error) {
      console.error('Force sync failed:', error);
      return false;
    }
  }
}

// Export singleton instance
export const databaseHealthService = new DatabaseHealthService();
