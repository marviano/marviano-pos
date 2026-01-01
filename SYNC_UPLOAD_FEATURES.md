# Sync Upload Features - Complete Analysis

**Purpose**: Document all sync features that upload/overwrite data to VPS Salespulse MySQL database

---

## 📋 Summary of Upload Sync Features

### Total Upload Sync Features: **7**

1. **Smart Sync - Transactions** (`smartSync.ts`)
2. **Smart Sync - Shifts** (`smartSync.ts`)
3. **Smart Sync - Refunds** (`smartSync.ts`)
4. **Smart Sync - Products** (`smartSync.ts`)
5. **Smart Sync - Printer Daily Counters** (`smartSync.ts`)
6. **System POS Sync** (`systemPosSync.ts`)
7. **Printer Audits Sync** (`offlineSync.ts`)

---

## 🔍 Detailed Analysis

### 1. Smart Sync - Transactions Upload

**File**: `src/lib/smartSync.ts`  
**Function**: `syncPendingTransactions()`  
**API Endpoint**: `POST /api/transactions`  
**Trigger**: Automatic (every 30 seconds when online) or manual

**Tables Uploaded/Overwritten**:
- ✅ `transactions` - Main transaction records
- ✅ `transaction_items` - Transaction line items
- ✅ `transaction_item_customizations` - Product customizations
- ✅ `transaction_item_customization_options` - Customization options

**Data Flow**:
1. Reads from local MySQL: `transactions` table
2. Validates NOT NULL fields
3. Converts dates to MySQL format
4. Validates ENUM values
5. Uploads to MySQL via `/api/transactions`
6. Marks as synced in local MySQL

**Overwrite Behavior**: 
- Creates new transactions in MySQL
- May update existing transactions if UUID matches

**Validation Applied**:
- ✅ NOT NULL validation (`id`, `business_id`, `user_id`, `payment_method`, `pickup_method`, `total_amount`, `final_amount`, `amount_received`, `payment_method_id`, `created_at`)
- ✅ Date format conversion (all date fields)
- ✅ ENUM validation (`pickup_method`, `voucher_type`, `status`, `refund_status`, `transaction_type`, `production_status`)

---

### 2. Smart Sync - Shifts Upload

**File**: `src/lib/smartSync.ts`  
**Function**: `syncPendingShifts()`  
**API Endpoint**: `POST /api/shifts`  
**Trigger**: Automatic (during transaction sync) or manual

**Tables Uploaded/Overwritten**:
- ✅ `shifts` - Cashier shift records

**Data Flow**:
1. Reads from local MySQL: `shifts` table (unsynced shifts)
2. Validates NOT NULL fields
3. Converts dates to MySQL format
4. Validates ENUM values (`kas_selisih_label`)
5. Uploads to MySQL via `/api/shifts`
6. Marks as synced in local MySQL

**Overwrite Behavior**: 
- Creates new shifts in MySQL
- May update existing shifts if UUID matches

**Validation Applied**:
- ✅ NOT NULL validation (`uuid_id`, `business_id`, `user_id`, `shift_start`)
- ✅ Date format conversion (all date fields)
- ✅ ENUM validation (`kas_selisih_label`: 'balanced', 'plus', 'minus')

---

### 3. Smart Sync - Refunds Upload

**File**: `src/lib/smartSync.ts`  
**Function**: `syncPendingRefunds()`  
**API Endpoint**: `POST /api/transactions/{transactionUuid}/refund`  
**Trigger**: Automatic (during transaction sync) or manual

**Tables Uploaded/Overwritten**:
- ✅ `transaction_refunds` - Refund records
- ✅ `transactions` - Updates transaction refund status

**Data Flow**:
1. Reads from local MySQL: `offline_refunds` table
2. Validates NOT NULL fields
3. Converts dates to MySQL format
4. Validates ENUM values (`refund_type`, `status`)
5. Uploads to MySQL via `/api/transactions/{uuid}/refund`
6. Marks as synced in local MySQL

**Overwrite Behavior**: 
- Creates new refund records in MySQL
- Updates transaction refund status

**Validation Applied**:
- ✅ NOT NULL validation (`transaction_uuid`, `business_id`, `refunded_by`, `refund_amount`, `payment_method_id`, `refunded_at`)
- ✅ Date format conversion (all date fields)
- ✅ ENUM validation (`refund_type`: 'full', 'partial'; `status`: 'pending', 'completed', 'failed')

---

### 4. Smart Sync - Products Upload

**File**: `src/lib/smartSync.ts`  
**Function**: `syncProductsToServer()`  
**API Endpoint**: `POST /api/products` (with `action: 'import'`)  
**Trigger**: Manual (not automatic)

**Tables Uploaded/Overwritten**:
- ✅ `products` - Product master data

**Data Flow**:
1. Reads from local MySQL: `products` table (all products)
2. Formats products for import
3. Uploads to MySQL via `/api/products` with import action
4. Requires `X-POS-API-Key` header

**Overwrite Behavior**: 
- **IMPORTS/OVERWRITES** all products for a business
- Uses `businessId` to determine which business's products to overwrite

**Validation Applied**:
- ⚠️ Limited validation (basic field mapping)
- ⚠️ No NOT NULL validation (relies on server-side validation)
- ⚠️ No ENUM validation (products don't have ENUMs)

**Note**: This is a **BULK OVERWRITE** operation - all products for a business are replaced!

---

### 5. Smart Sync - Printer Daily Counters Upload

**File**: `src/lib/smartSync.ts`  
**Function**: `syncPrinterDailyCounters()`  
**API Endpoint**: `POST /api/printer-daily-counters`  
**Trigger**: Automatic (during transaction sync)

**Tables Uploaded/Overwritten**:
- ✅ `printer_daily_counters` - Daily printer counter records

**Data Flow**:
1. Reads from local MySQL: `printer_daily_counters` table (all counters)
2. Uploads to MySQL via `/api/printer-daily-counters`
3. Server handles upsert logic

**Overwrite Behavior**: 
- Upserts counters (updates if exists, inserts if not)

**Validation Applied**:
- ⚠️ Limited validation (basic structure check)

---

### 6. System POS Sync (Receiptize)

**File**: `src/lib/systemPosSync.ts`  
**Function**: `sync()` → `syncTransaction()`  
**API Endpoints**: 
- `POST /api/system-pos/transactions`
- `POST /api/system-pos/shifts`
- `POST /api/system-pos/printer-audits`

**Trigger**: Automatic (every 30 seconds when online)

**Tables Uploaded/Overwritten**:
- ✅ `transactions` - Transaction records (in System POS/Receiptize database)
- ✅ `transaction_items` - Transaction line items
- ✅ `transaction_item_customizations` - Product customizations
- ✅ `transaction_item_customization_options` - Customization options
- ✅ `shifts` - Shift records
- ✅ `printer2_audit_log` - Printer 2 audit logs

**Data Flow**:
1. Reads from local MySQL: `system_pos_queue` table
2. **FILTER**: Only syncs if `printer2_audit_log` exists for transaction
3. Fetches complete transaction data (including shift and audits)
4. Converts dates to MySQL format
5. Validates ENUM values
6. Uploads to System POS (Receiptize) via multiple endpoints
7. Marks as synced in local MySQL

**Overwrite Behavior**: 
- Creates new records in System POS database
- Separate database from main Salespulse MySQL

**Validation Applied**:
- ✅ Date format conversion (all date fields)
- ✅ ENUM validation (all ENUM fields via `convertTransactionDatesForMySQL` and `convertShiftDatesForMySQL`)

**Special Notes**:
- Only syncs transactions that have Printer 2 audit logs
- Syncs to a **different database** (System POS/Receiptize), not main Salespulse MySQL
- This is a **separate system** from the main Salespulse sync

---

### 7. Printer Audits Sync

**File**: `src/lib/offlineSync.ts`  
**Function**: `syncPrinterAudits()`  
**API Endpoint**: `POST /api/printer-audits`  
**Trigger**: Automatic (during smart sync transaction sync)

**Tables Uploaded/Overwritten**:
- ✅ `printer1_audit_log` - Printer 1 audit logs (if exists in MySQL)
- ✅ `printer2_audit_log` - Printer 2 audit logs (if exists in MySQL)
- ✅ `printer_audits` - General printer audit records (if exists in MySQL)

**Data Flow**:
1. Reads from local MySQL: `printer1_audit_log` and `printer2_audit_log` tables (unsynced)
2. Uploads to MySQL via `/api/printer-audits`
3. Marks as synced in local MySQL

**Overwrite Behavior**: 
- Creates new audit log records
- Does not overwrite existing records

**Validation Applied**:
- ⚠️ Limited validation (basic structure check)

---

## 📊 Summary Table

| Sync Feature | File | API Endpoint | Tables Affected | Overwrite Type | Validation |
|-------------|------|--------------|-----------------|----------------|------------|
| **Transactions** | `smartSync.ts` | `POST /api/transactions` | `transactions`, `transaction_items`, `transaction_item_customizations`, `transaction_item_customization_options` | Create/Update | ✅ Full |
| **Shifts** | `smartSync.ts` | `POST /api/shifts` | `shifts` | Create/Update | ✅ Full |
| **Refunds** | `smartSync.ts` | `POST /api/transactions/{uuid}/refund` | `transaction_refunds`, `transactions` | Create/Update | ✅ Full |
| **Products** | `smartSync.ts` | `POST /api/products` | `products` | **BULK OVERWRITE** | ⚠️ Limited |
| **Printer Counters** | `smartSync.ts` | `POST /api/printer-daily-counters` | `printer_daily_counters` | Upsert | ⚠️ Limited |
| **System POS** | `systemPosSync.ts` | `POST /api/system-pos/*` | `transactions`, `shifts`, `printer2_audit_log` (in System POS DB) | Create | ✅ Full |
| **Printer Audits** | `offlineSync.ts` | `POST /api/printer-audits` | `printer1_audit_log`, `printer2_audit_log`, `printer_audits` | Create | ⚠️ Limited |

---

## ⚠️ Critical Notes

### Products Sync - BULK OVERWRITE
- **WARNING**: Products sync **OVERWRITES ALL PRODUCTS** for a business
- This is a **destructive operation** - use with caution
- Not triggered automatically (manual only)
- Requires `X-POS-API-Key` header

### System POS Sync - Separate Database
- Syncs to **System POS/Receiptize database**, not main Salespulse MySQL
- Only syncs transactions with Printer 2 audit logs
- Separate from main Salespulse sync operations

### Validation Coverage
- **Full Validation**: Transactions, Shifts, Refunds, System POS
  - ✅ NOT NULL validation
  - ✅ Date format conversion
  - ✅ ENUM validation
  
- **Limited Validation**: Products, Printer Counters, Printer Audits
  - ⚠️ Basic structure check only
  - ⚠️ Relies on server-side validation

---

## 🔍 Next Steps

After reviewing this document, I will:
1. Check each sync feature for schema compatibility
2. Verify validation is working correctly
3. Check for any missing validations
4. Verify overwrite behavior is correct
5. Check for potential data loss scenarios

---

**Ready for review!** Please confirm if you want me to proceed with checking all these sync features.
