# Sync Completeness Analysis

**Purpose**: Verify that all sync features upload COMPLETE data from all related tables and columns

**Critical Question**: Does MySQL VPS have the same complete data as SQLite local database?

---

## 🔍 Analysis Results

### ❌ **ISSUES FOUND**: Not all columns are being uploaded!

---

## 1. Smart Sync - Transactions Upload

### Tables Involved:
- ✅ `transactions` (main table)
- ✅ `transaction_items` (line items)
- ✅ `transaction_item_customizations` (customizations)
- ✅ `transaction_item_customization_options` (customization options)

### ❌ **PROBLEM FOUND**: Transaction Items Missing Columns

**Location**: `src/lib/smartSync.ts` lines 435-443

**What's Being Sent**:
```typescript
transactionData.items = rawItems.map(item => ({
  id: item.id,                    // ✅
  product_id: item.product_id,    // ✅
  quantity: item.quantity,         // ✅
  unit_price: item.unit_price,     // ✅
  total_price: item.total_price,   // ✅
  custom_note: item.custom_note,   // ✅
  bundle_selections_json: item.bundle_selections_json, // ✅
}));
```

**What's Missing**:
- ❌ `created_at` - NOT being sent
- ❌ `production_status` - NOT being sent (from migration)
- ❌ `production_started_at` - NOT being sent (from migration)
- ❌ `production_finished_at` - NOT being sent (from migration)

**SQLite Schema** (`transaction_items`):
```sql
CREATE TABLE transaction_items (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL,
  product_id INTEGER NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL,
  total_price REAL NOT NULL,
  custom_note TEXT,
  bundle_selections_json TEXT,
  created_at TEXT NOT NULL,              -- ❌ MISSING
  production_status TEXT DEFAULT NULL,   -- ❌ MISSING
  production_started_at TEXT DEFAULT NULL, -- ❌ MISSING
  production_finished_at TEXT DEFAULT NULL -- ❌ MISSING
);
```

**MySQL Schema** (`transaction_items`):
```sql
CREATE TABLE `transaction_items`(
  `id` int NOT NULL AUTO_INCREMENT,
  `uuid_id` varchar(36)NOT NULL,
  `transaction_id` int NOT NULL,
  `uuid_transaction_id` varchar(36)NOT NULL,
  `product_id` int NOT NULL,
  `quantity` int NOT NULL DEFAULT '1',
  `unit_price` decimal(15,2)NOT NULL,
  `total_price` decimal(15,2)NOT NULL,
  `custom_note` text,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,  -- ✅ EXISTS
  `bundle_selections_json` json DEFAULT NULL,
  `production_started_at` timestamp NULL DEFAULT NULL,       -- ✅ EXISTS
  `production_status` enum('preparing','finished')DEFAULT NULL, -- ✅ EXISTS
  `production_finished_at` timestamp NULL DEFAULT NULL        -- ✅ EXISTS
);
```

**Impact**: 
- ⚠️ Production status tracking data is NOT being synced to MySQL
- ⚠️ `created_at` timestamps for items are NOT being synced
- ⚠️ Kitchen/Barista display production tracking will be incomplete in MySQL

---

### Transaction Data Source

**How transaction data is retrieved**:
1. Reads from `offline_transactions.transaction_data` (JSON blob)
2. Then fetches items from `transaction_items` table (SELECT *)
3. Then fetches customizations from normalized tables

**Question**: Does `offline_transactions.transaction_data` JSON contain ALL columns from `transactions` table?

**Answer**: Need to check what's stored in the JSON blob. The JSON blob is created when a transaction is saved, so it depends on what was included at that time.

**Potential Issue**: If the JSON blob doesn't contain all columns, then some transaction columns might be missing.

---

## 2. Smart Sync - Shifts Upload

### Tables Involved:
- ✅ `shifts` (main table)

### ✅ **COMPLETE**: All columns being sent

**Location**: `src/lib/smartSync.ts` lines 763-778

**What's Being Sent**:
```typescript
{
  id: convertedShift.uuid_id || String(convertedShift.id),
  uuid: convertedShift.uuid_id || String(convertedShift.id),
  business_id: convertedShift.business_id,
  user_id: convertedShift.user_id,
  shift_start: convertedShift.shift_start,
  shift_end: convertedShift.shift_end || null,
  starting_cash: convertedShift.modal_awal || convertedShift.starting_cash || 0,
  ending_cash: convertedShift.kas_akhir || convertedShift.ending_cash || null,
  cash_drawer_difference: convertedShift.kas_selisih || convertedShift.cash_drawer_difference || null,
  status: convertedShift.status || 'active',
  closed_by: convertedShift.closed_by || null,
  closed_at: convertedShift.closed_at || null,
  created_at: convertedShift.created_at || convertedShift.shift_start,
  updated_at: convertedShift.updated_at || null,
}
```

**SQLite Schema** (`shifts`):
- All columns are being mapped and sent ✅

**Status**: ✅ **COMPLETE** - All shift columns are being uploaded

---

## 3. Smart Sync - Refunds Upload

### Tables Involved:
- ✅ `transaction_refunds` (main table)
- ✅ `transactions` (updates refund status)

### ⚠️ **NEEDS VERIFICATION**: Check refund data structure

**Location**: `src/lib/smartSync.ts` lines 916-965

**What's Being Sent**:
- Reads from `offline_refunds.refund_data` (JSON blob)
- Uses `cleanRefundForMySQL()` to clean data
- Sends entire payload

**Question**: Does `offline_refunds.refund_data` JSON contain ALL columns from `transaction_refunds` table?

**MySQL Schema** (`transaction_refunds`):
```sql
CREATE TABLE `transaction_refunds`(
  `id` int NOT NULL AUTO_INCREMENT,
  `uuid_id` varchar(255)NOT NULL,
  `transaction_uuid` varchar(255)NOT NULL,
  `business_id` int NOT NULL,
  `shift_uuid` char(36)DEFAULT NULL,
  `refunded_by` int NOT NULL,
  `refund_amount` decimal(15,2)NOT NULL,
  `cash_delta` decimal(15,2)NOT NULL DEFAULT '0.00',
  `payment_method_id` int NOT NULL,
  `reason` varchar(255)DEFAULT NULL,
  `note` text,
  `refund_type` enum('full','partial')DEFAULT 'full',
  `status` enum('pending','completed','failed')DEFAULT 'completed',
  `refunded_at` datetime NOT NULL,
  `synced_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

**Status**: ⚠️ **NEEDS CHECK** - Depends on what's in the JSON blob

---

## 4. Smart Sync - Products Upload

### Tables Involved:
- ✅ `products` (main table)

### ⚠️ **LIMITED MAPPING**: Only specific fields mapped

**Location**: `src/lib/smartSync.ts` lines 843-858

**What's Being Sent**:
```typescript
{
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
}
```

**What's Missing** (from MySQL `products` table):
- ❌ `id` - Not sent (server generates)
- ❌ `category1_id` - Not sent (only `kategori` name)
- ❌ `category2_id` - Not sent (only `jenis` name)
- ❌ `harga_gofood` - Not sent
- ❌ `harga_grabfood` - Not sent
- ❌ `harga_shopeefood` - Not sent
- ❌ `harga_tiktok` - Not sent
- ❌ `harga_qpon` - Not sent
- ❌ `image_url` - Not sent
- ❌ `status` - Not sent
- ❌ `has_customization` - Not sent
- ❌ `is_bundle` - Not sent
- ❌ `created_at` - Not sent
- ❌ `updated_at` - Not sent

**Impact**: 
- ⚠️ This is a **BULK OVERWRITE** operation
- ⚠️ Only basic product fields are synced
- ⚠️ Platform prices (gofood, grabfood, etc.) are NOT synced
- ⚠️ Product images are NOT synced
- ⚠️ Product status is NOT synced

**Note**: This might be intentional if products are managed on the server side.

---

## 5. Smart Sync - Printer Daily Counters Upload

### Tables Involved:
- ✅ `printer_daily_counters` (main table)

### ✅ **COMPLETE**: All columns being sent

**Location**: `src/lib/smartSync.ts` lines 1016-1032

**What's Being Sent**:
```typescript
{
  counters: allCounters  // All columns from table
}
```

**Status**: ✅ **COMPLETE** - All counter columns are being uploaded

---

## 6. System POS Sync (Receiptize)

### Tables Involved:
- ✅ `transactions` (complete transaction)
- ✅ `transaction_items` (complete items)
- ✅ `transaction_item_customizations` (complete customizations)
- ✅ `transaction_item_customization_options` (complete options)
- ✅ `shifts` (complete shift)
- ✅ `printer2_audit_log` (complete audits)

### ❌ **SAME ISSUE**: Transaction Items Missing Columns

**Location**: `src/lib/systemPosSync.ts` lines 440-456

**What's Being Sent**:
- Fetches complete transaction data via `fetchTransactionData()`
- Items are fetched with `localDbGetTransactionItems` (SELECT *)
- But items are sent as-is from the fetch

**Question**: Are items sent with ALL columns, or are they filtered?

**Status**: ⚠️ **NEEDS CHECK** - Depends on how items are sent in the payload

---

## 7. Printer Audits Sync

### Tables Involved:
- ✅ `printer1_audit_log` (main table)
- ✅ `printer2_audit_log` (main table)
- ✅ `printer_audits` (if exists)

### ⚠️ **NEEDS VERIFICATION**: Check what columns are sent

**Location**: `src/lib/offlineSync.ts` lines 543-590

**What's Being Sent**:
- Fetches unsynced audits via `localDbGetUnsyncedPrinterAudits`
- Sends `printer1Audits` and `printer2Audits` arrays

**Question**: Are ALL columns from audit log tables being sent?

**Status**: ⚠️ **NEEDS CHECK** - Depends on what `localDbGetUnsyncedPrinterAudits` returns

---

## 📊 Summary of Issues

### Critical Issues (Data Loss):

1. ❌ **Transaction Items Missing Columns**:
   - `created_at` - NOT synced
   - `production_status` - NOT synced
   - `production_started_at` - NOT synced
   - `production_finished_at` - NOT synced

2. ⚠️ **Transaction Data Source**:
   - Uses JSON blob from `offline_transactions.transaction_data`
   - Need to verify if JSON blob contains ALL transaction columns

3. ⚠️ **Products Sync Limited**:
   - Only basic fields synced
   - Platform prices, images, status NOT synced
   - This might be intentional (server is source of truth)

### Needs Verification:

1. ⚠️ **Refunds**: Check if JSON blob contains all columns
2. ⚠️ **System POS Items**: Check if all item columns are sent
3. ⚠️ **Printer Audits**: Check if all audit columns are sent

---

## 🔧 Recommended Fixes

### Priority 1: Fix Transaction Items Upload

**File**: `src/lib/smartSync.ts`  
**Lines**: 435-443

**Current Code**:
```typescript
transactionData.items = rawItems.map(item => ({
  id: item.id as string,
  product_id: item.product_id as number,
  quantity: item.quantity as number,
  unit_price: item.unit_price as number,
  total_price: item.total_price as number,
  custom_note: item.custom_note as string | undefined,
  bundle_selections_json: item.bundle_selections_json as unknown | undefined,
}));
```

**Fixed Code**:
```typescript
transactionData.items = rawItems.map(item => ({
  id: item.id as string,
  product_id: item.product_id as number,
  quantity: item.quantity as number,
  unit_price: item.unit_price as number,
  total_price: item.total_price as number,
  custom_note: item.custom_note as string | undefined,
  bundle_selections_json: item.bundle_selections_json as unknown | undefined,
  created_at: item.created_at as string | undefined,  // ✅ ADD
  production_status: item.production_status as string | undefined,  // ✅ ADD
  production_started_at: item.production_started_at as string | undefined,  // ✅ ADD
  production_finished_at: item.production_finished_at as string | undefined,  // ✅ ADD
}));
```

---

## 📋 Action Items

1. ✅ **Fix transaction items upload** - Add missing columns
2. ⚠️ **Verify transaction data JSON blob** - Check if all columns are included
3. ⚠️ **Verify refund data JSON blob** - Check if all columns are included
4. ⚠️ **Verify System POS items** - Check if all columns are sent
5. ⚠️ **Verify printer audits** - Check if all columns are sent
6. ⚠️ **Document products sync limitations** - Clarify if intentional

---

**Status**: ❌ **INCOMPLETE** - Missing columns found in transaction items upload

**Next Step**: Fix the missing columns in transaction items upload, then verify other sync features.
