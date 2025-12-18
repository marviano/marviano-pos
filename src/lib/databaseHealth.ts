/**
 * Database Health Check and Initial Sync
 * Ensures SQLite database has master data before going offline
 * 
 * IMPORTANT: This service only syncs MASTER DATA (products, categories, etc.)
 * Transaction data is NOT synced to prevent data corruption.
 * Use SyncManagement component for full bidirectional sync with transaction upload.
 */

import { getApiUrl } from '@/lib/api';

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
      console.log('✅ [DB HEALTH] Database is healthy, no sync needed');
      return true;
    }

    console.log('🔄 [DB HEALTH] Database needs sync, performing initial sync...');

    try {
      // Trigger comprehensive sync
      const response = await fetch(getApiUrl('/api/sync'));
      if (response.ok) {
        await response.json();
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
      const response = await fetch(getApiUrl('/api/sync'));
      if (response.ok) {
        const jsonData = await response.json();
        const data = jsonData.data || jsonData;

        // Save to local database
        const electronAPI = typeof window !== 'undefined' ? (window as { electronAPI?: UnknownRecord }).electronAPI : undefined;
        if (electronAPI) {
          // 1. CATEGORIES FIRST (dependencies)
          if (data.category1 && data.category1.length > 0) {
            await (electronAPI.localDbUpsertCategory1 as (rows: unknown[]) => Promise<{ success: boolean }>)(data.category1);
            console.log(`✅ ${data.category1.length} category1 synced to local database`);
          }

          if (data.category2 && data.category2.length > 0) {
            // Get junction table data (REQUIRED - junction table only, no business_id column)
            const junctionTableData = (data.category2Businesses as Array<{ category2_id: number; business_id: number }> | undefined) || undefined;
            if (!junctionTableData || junctionTableData.length === 0) {
              console.warn(`⚠️ [DB HEALTH] No junction table data provided for category2 - skipping sync`);
            } else {
              await (electronAPI.localDbUpsertCategory2 as (rows: unknown[], junctionData?: Array<{ category2_id: number; business_id: number }>) => Promise<{ success: boolean }>)(data.category2, junctionTableData);
              console.log(`✅ ${data.category2.length} category2 synced to local database with ${junctionTableData.length} business relationships`);
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
              console.log(`✅ ${formattedCategories.length} categories synced to local database`);
            }
          }

          // 2. CUSTOMIZATION TYPES AND OPTIONS (dependencies)
          if (electronAPI.localDbUpsertCustomizationTypes && data.customizationTypes && data.customizationTypes.length > 0) {
            await (electronAPI.localDbUpsertCustomizationTypes as (rows: unknown[]) => Promise<{ success: boolean }>)(data.customizationTypes);
            console.log(`✅ ${data.customizationTypes.length} customization types synced to local database`);
          }

          if (electronAPI.localDbUpsertCustomizationOptions && data.customizationOptions && data.customizationOptions.length > 0) {
            await (electronAPI.localDbUpsertCustomizationOptions as (rows: unknown[]) => Promise<{ success: boolean }>)(data.customizationOptions);
            console.log(`✅ ${data.customizationOptions.length} customization options synced to local database`);
          }

          // 3. PRODUCTS (depends on categories and customization types)
          if (Array.isArray(data.products) && data.products.length > 0) {
            await (electronAPI.localDbUpsertProducts as (rows: unknown[]) => Promise<{ success: boolean }>)(data.products);
            console.log(`✅ ${data.products.length} products synced to local database`);
          }

          // 4. PRODUCT-RELATED DATA
          if (electronAPI.localDbUpsertProductCustomizations && data.productCustomizations && data.productCustomizations.length > 0) {
            await (electronAPI.localDbUpsertProductCustomizations as (rows: unknown[]) => Promise<{ success: boolean }>)(data.productCustomizations);
            console.log(`✅ ${data.productCustomizations.length} product customizations synced to local database`);
          }

          if (Array.isArray(data.bundleItems) && data.bundleItems.length > 0) {
            await (electronAPI.localDbUpsertBundleItems as (rows: unknown[]) => Promise<{ success: boolean }>)(data.bundleItems);
            console.log(`✅ ${data.bundleItems.length} bundle items synced to local database`);
          }

          // 5. SKIP TRANSACTION DATA (SAFETY)
          // Transaction data is NOT downloaded to prevent overwriting local records
          // Reason: POS device is the source of truth for transaction data
          // Tables skipped: transactions, transaction_items, shifts, refunds, printer logs
          console.log('⚠️ [DB HEALTH] Skipping transaction data download (upload-only for safety)');

          // 6. PAYMENT AND ORGANIZATION DATA
          if (data.paymentMethods && data.paymentMethods.length > 0) {
            await (electronAPI.localDbUpsertPaymentMethods as (rows: unknown[]) => Promise<{ success: boolean }>)(data.paymentMethods);
            console.log(`✅ ${data.paymentMethods.length} payment methods synced to local database`);
          }

          if (data.banks && data.banks.length > 0) {
            await (electronAPI.localDbUpsertBanks as (rows: unknown[]) => Promise<{ success: boolean }>)(data.banks);
            console.log(`✅ ${data.banks.length} banks synced to local database`);
          }

          if (data.organizations && data.organizations.length > 0) {
            await (electronAPI.localDbUpsertOrganizations as (rows: unknown[]) => Promise<{ success: boolean }>)(data.organizations);
            console.log(`✅ ${data.organizations.length} organizations synced to local database`);
          }

          if (data.managementGroups && data.managementGroups.length > 0) {
            await (electronAPI.localDbUpsertManagementGroups as (rows: unknown[]) => Promise<{ success: boolean }>)(data.managementGroups);
            console.log(`✅ ${data.managementGroups.length} management groups synced to local database`);
          }

          if (data.clAccounts && data.clAccounts.length > 0) {
            await (electronAPI.localDbUpsertClAccounts as (rows: unknown[]) => Promise<{ success: boolean }>)(data.clAccounts);
            console.log(`✅ ${data.clAccounts.length} CL accounts synced to local database`);
          }

        }

        console.log('✅ [DB HEALTH] Master data sync completed (transactions protected)');
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
