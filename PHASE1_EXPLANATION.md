# Phase 1 Explanation: Adding Missing Columns to SQLite

## 🔍 Understanding Phase 1

### What Does "Add Missing Columns to SQLite" Mean?

**Phase 1 does NOT use sync functions to add columns.** Instead, it uses **database migrations** that run automatically when the Electron app starts.

### Two Different Processes:

#### 1. **Schema Migration** (What Phase 1 Does)
- **When**: Runs automatically when Electron app starts
- **Where**: `electron/main.ts` - in the database initialization code
- **What**: Adds missing columns to SQLite tables using `ALTER TABLE`
- **Purpose**: Ensures SQLite schema matches MySQL schema structure
- **Not related to**: Data synchronization

#### 2. **Data Sync** (Separate Process)
- **When**: Runs when app is online, periodically or manually
- **Where**: `src/lib/offlineSync.ts`, `src/lib/smartSync.ts`, etc.
- **What**: Transfers actual data (rows) between MySQL and SQLite
- **Purpose**: Keeps data synchronized between online and offline databases

---

## 📋 Phase 1 Implementation Details

### How Columns Are Added:

```typescript
// In electron/main.ts - Runs on app startup
// Schema migration: Add businesses.status column if it doesn't exist
try {
  const businessesSchema = localDb.prepare(`PRAGMA table_info(businesses)`).all();
  const hasStatus = businessesSchema.some(col => col.name === 'status');
  if (!hasStatus) {
    console.log('📋 Migrating database: Adding businesses.status column...');
    localDb.prepare(`ALTER TABLE businesses ADD COLUMN status TEXT DEFAULT 'active'`).run();
    localDb.prepare(`UPDATE businesses SET status = 'active' WHERE status IS NULL`).run();
    console.log('✅ Added businesses.status column with default value');
  }
} catch (businessesError) {
  console.log('⚠️ Businesses status migration check failed:', businessesError);
}
```

**This is NOT a sync function** - it's a **schema migration** that:
1. Checks if column exists using `PRAGMA table_info`
2. Adds column if missing using `ALTER TABLE`
3. Sets default values for existing rows
4. Runs automatically on app startup

---

## 🔄 Sync Functions Involved in Phase 1

While Phase 1 doesn't use sync functions to add columns, it **updates sync functions** to handle the new columns:

### 1. **Download Sync** (MySQL → SQLite)

**File**: `src/app/_api/sync/route.ts`

**What Changed**:
- Added `status` to businesses SELECT query
- Added `category2_businesses` junction table sync (was missing)

**Sync Function Used**: 
- `localDbUpsertBusinesses` - Now receives `status` field from MySQL
- `localDbUpsertCategory2` - Now receives junction table data

**Impact**: When downloading from MySQL, the new columns are now included in the data

---

## 📚 Complete List of All Sync Functions in the App

### A. **Download Sync Functions** (MySQL → SQLite)

These functions download data from MySQL and store in SQLite:

#### 1. **offlineSync.ts** - Main Download Sync Service
- **Function**: `syncFromOnline()`
- **Purpose**: Downloads ALL POS tables from MySQL to SQLite
- **Calls These IPC Handlers**:
  - `localDbUpsertUsers`
  - `localDbUpsertBusinesses` ⭐ (Updated in Phase 1)
  - `localDbUpsertCategory1`
  - `localDbUpsertCategory2` ⭐ (Updated in Phase 1 - now handles junction table)
  - `localDbUpsertCustomizationTypes`
  - `localDbUpsertCustomizationOptions`
  - `localDbUpsertCategories`
  - `localDbUpsertProducts`
  - `localDbUpsertProductCustomizations`
  - `localDbUpsertIngredients`
  - `localDbUpsertCogs`
  - `localDbUpsertContacts`
  - `localDbUpsertTeams`
  - `localDbUpsertRoles`
  - `localDbUpsertPermissions`
  - `localDbUpsertRolePermissions`
  - `localDbUpsertSource`
  - `localDbUpsertPekerjaan`
  - `localDbUpsertPaymentMethods`
  - `localDbUpsertBanks`
  - `localDbUpsertOrganizations`
  - `localDbUpsertManagementGroups`
  - `localDbUpsertBundleItems`
  - `localDbUpsertClAccounts`
  - `localDbUpdateSyncStatus`

#### 2. **offlineDataFetcher.ts** - Product/Category Fetching
- **Function**: `fetchProducts()` - Downloads products with offline fallback
- **Function**: `fetchCategories()` - Downloads categories with offline fallback
- **Calls**: `localDbUpsertProducts`, `localDbUpsertCategories`

---

### B. **Upload Sync Functions** (SQLite → MySQL)

These functions upload data from SQLite to MySQL:

#### 3. **smartSync.ts** - Smart Transaction Sync Service
- **Function**: `syncPendingTransactions()` - Uploads pending transactions
- **Function**: `syncPendingShifts()` - Uploads pending shifts
- **Function**: `syncPendingRefunds()` - Uploads pending refunds
- **Function**: `syncPrinterDailyCounters()` - Uploads printer counters
- **Calls These IPC Handlers**:
  - `localDbGetPendingTransactions` - Gets transactions to upload
  - `localDbGetTransactionItems` - Gets transaction items
  - `localDbGetTransactionItemCustomizationsNormalized` - Gets customizations
  - `localDbGetTransactionRefunds` - Gets refunds
  - `localDbMarkTransactionSynced` - Marks as synced after upload
  - `localDbMarkTransactionsSynced` - Marks main transaction as synced
  - `localDbMarkTransactionFailed` - Marks failed syncs
  - `localDbGetUnsyncedShifts` - Gets shifts to upload
  - `localDbMarkShiftsSynced` - Marks shifts as synced
  - `localDbGetPendingRefunds` - Gets refunds to upload
  - `localDbMarkRefundSynced` - Marks refunds as synced
  - `localDbMarkRefundFailed` - Marks failed refunds
  - `localDbApplyTransactionRefund` - Applies refund to local transaction
  - `localDbGetAllPrinterDailyCounters` - Gets printer counters

**API Endpoints Used**:
- `POST /api/transactions` - Upload transactions
- `POST /api/shifts` - Upload shifts
- `POST /api/transactions/:uuid/refund` - Upload refunds
- `POST /api/printer-daily-counters` - Upload printer counters

#### 4. **systemPosSync.ts** - System POS Sync Service
- **Function**: `sync()` - Syncs transactions to System POS (Receiptize)
- **Function**: `syncTransaction()` - Syncs single transaction
- **Calls These IPC Handlers**:
  - `getSystemPosQueue` - Gets queued transactions
  - `localDbGetTransactions` - Gets transaction data
  - `localDbGetTransactionItems` - Gets transaction items
  - `localDbGetTransactionItemCustomizationsNormalized` - Gets customizations
  - `localDbGetTransactionRefunds` - Gets refunds
  - `localDbGetShiftByUuid` - Gets shift data
  - `localDbGetPrinterAuditsByTransactionId` - Gets printer audits
  - `markSystemPosSynced` - Marks as synced
  - `markSystemPosFailed` - Marks as failed

**API Endpoints Used**:
- `POST /api/system-pos/transactions` - Upload to System POS
- `POST /api/system-pos/shifts` - Upload shifts
- `POST /api/system-pos/printer-audits` - Upload printer audits

#### 5. **offlineSync.ts** - Printer Audit Sync
- **Function**: `syncPrinterAudits()` - Uploads printer audit logs
- **Calls These IPC Handlers**:
  - `localDbGetUnsyncedPrinterAudits` - Gets unsynced audits
  - `localDbMarkPrinterAuditsSynced` - Marks as synced

**API Endpoint Used**:
- `POST /api/printer-audits` - Upload printer audits

---

### C. **IPC Handlers (Electron Main Process)**

All sync functions communicate with Electron via IPC handlers. Here are the key ones:

#### **Upsert Functions** (Download from MySQL → SQLite):
- `localdb-upsert-users`
- `localdb-upsert-businesses` ⭐ (Phase 1: Now handles `status` field)
- `localdb-upsert-category1`
- `localdb-upsert-category2` ⭐ (Phase 1: Now handles junction table)
- `localdb-upsert-products`
- `localdb-upsert-ingredients`
- `localdb-upsert-cogs`
- `localdb-upsert-contacts`
- `localdb-upsert-teams`
- `localdb-upsert-roles`
- `localdb-upsert-permissions`
- `localdb-upsert-role-permissions`
- `localdb-upsert-source`
- `localdb-upsert-pekerjaan`
- `localdb-upsert-payment-methods`
- `localdb-upsert-banks`
- `localdb-upsert-organizations`
- `localdb-upsert-management-groups`
- `localdb-upsert-bundle-items`
- `localdb-upsert-cl-accounts`
- `localdb-upsert-customization-types`
- `localdb-upsert-customization-options`
- `localdb-upsert-product-customizations`
- `localdb-upsert-transactions`
- `localdb-upsert-transaction-items`
- `localdb-upsert-transaction-item-customizations`
- `localdb-upsert-transaction-item-customization-options`
- `localdb-upsert-transaction-refunds`
- `localdb-upsert-shifts`
- `localdb-upsert-categories`

#### **Get Functions** (Read from SQLite for Upload):
- `localdb-get-transactions`
- `localdb-get-transaction-items`
- `localdb-get-transaction-item-customizations-normalized`
- `localdb-get-transaction-refunds`
- `localdb-get-unsynced-transactions`
- `localdb-get-unsynced-shifts`
- `localdb-get-pending-transactions`
- `localdb-get-pending-refunds`
- `localdb-get-shift-by-uuid`
- `localdb-get-printer-audits-by-transaction-id`
- `localdb-get-all-printer-daily-counters`
- `localdb-get-unsynced-printer-audits`

#### **Mark Functions** (Update Sync Status):
- `localdb-mark-transactions-synced`
- `localdb-mark-transaction-synced`
- `localdb-mark-transaction-failed`
- `localdb-mark-shifts-synced`
- `localdb-mark-refund-synced`
- `localdb-mark-refund-failed`
- `localdb-mark-printer-audits-synced`
- `localdb-reset-transaction-sync`
- `localdb-update-sync-status`

#### **Queue Functions** (Offline Transaction Management):
- `localdb-queue-offline-transaction`
- `localdb-queue-offline-refund`
- `localdb-get-system-pos-queue`
- `localdb-mark-system-pos-synced`
- `localdb-mark-system-pos-failed`

---

## 🎯 Phase 1 Summary

### What Phase 1 Actually Does:

1. **Schema Migration** (NOT sync):
   - Adds `businesses.status` column to SQLite (if missing)
   - Adds `category2_businesses.created_at` column to SQLite (if missing)
   - Runs automatically on app startup
   - Uses `ALTER TABLE` SQL commands

2. **Sync Route Update** (Data sync):
   - Updated `/api/sync` route to include `status` in businesses query
   - Added `category2_businesses` junction table sync (was missing)
   - Now sync functions receive the new columns when downloading

3. **Sync Functions Updated**:
   - `offlineSync.ts` → `syncFromOnline()` → Uses updated sync route
   - `localdb-upsert-businesses` IPC handler → Now includes `status` in INSERT/UPDATE ⭐
   - `localdb-upsert-category2` IPC handler → Junction table now includes `created_at` ⭐

---

## 🔑 Key Takeaway

**Phase 1 = Schema Migration (structure) + Sync Route Update (data) + Upsert Function Updates**

- **Schema Migration**: Adds columns to SQLite tables (runs on startup)
- **Sync Route Update**: Ensures new columns are included when downloading from MySQL
- **Upsert Function Updates**: IPC handlers updated to handle new columns when inserting/updating

**Complete Flow**:
1. App starts → Schema migration adds missing columns
2. Sync downloads from MySQL → Includes new columns (`status`, `created_at`)
3. Upsert functions → Store new columns in SQLite
4. Data is now synchronized with MySQL schema!
