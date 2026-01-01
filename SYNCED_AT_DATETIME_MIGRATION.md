# synced_at Column Migration: BIGINT → DATETIME

## Why was synced_at a number (BIGINT)?

The `synced_at` column in the `transactions` table was originally created as `BIGINT` to store Unix timestamps in milliseconds (using `Date.now()`). This was done for simplicity, but it's inconsistent with other datetime columns in the database (like `created_at`, `updated_at`, `last_sync_attempt`) which use `DATETIME` or `TIMESTAMP` types.

## Changes Made

### 1. Database Migration
**File**: `database_migrations/convert_synced_at_to_datetime.sql`

This migration:
- Converts existing `BIGINT` values (milliseconds) to `DATETIME` format
- Changes the column type from `BIGINT` to `DATETIME`
- Handles UTC+7 timezone conversion (WIB - Western Indonesian Time)

**To apply the migration:**
```sql
-- Run the migration file on the salespulse database
USE salespulse;
SOURCE database_migrations/convert_synced_at_to_datetime.sql;
```

### 2. Schema Definition Update
**File**: `electron/mysqlSchema.ts`
- Changed `synced_at BIGINT DEFAULT NULL` to `synced_at DATETIME DEFAULT NULL`

### 3. Code Updates
**File**: `electron/main.ts`

Updated all places where `synced_at` is set:

1. **Mark transactions as synced** (line ~3561):
   - Changed from: `const now = Date.now();`
   - Changed to: `const now = toMySQLDateTime(new Date());`

2. **Sync transactions from VPS** (line ~2434):
   - Changed from: `r.synced_at ?? null`
   - Changed to: `r.synced_at ? toMySQLDateTime(typeof r.synced_at === 'number' ? new Date(r.synced_at) : r.synced_at) : null`
   - This handles both old format (number) and new format (datetime string) from VPS

### 4. Migration File Update
**File**: `database_migrations/add_sync_columns_to_transactions.sql`
- Updated to use `DATETIME` instead of `BIGINT` for new installations

## Migration Steps

1. **Backup your database** before running the migration
2. **Run the migration SQL**:
   ```sql
   USE salespulse;
   SOURCE database_migrations/convert_synced_at_to_datetime.sql;
   ```
3. **Verify the change**:
   ```sql
   SELECT 
     COLUMN_NAME, 
     DATA_TYPE, 
     IS_NULLABLE, 
     COLUMN_DEFAULT
   FROM INFORMATION_SCHEMA.COLUMNS 
   WHERE TABLE_SCHEMA = 'salespulse' 
     AND TABLE_NAME = 'transactions' 
     AND COLUMN_NAME = 'synced_at';
   ```
   Should show: `DATA_TYPE = 'datetime'`

## Notes

- The migration converts existing `BIGINT` values (milliseconds) to `DATETIME` format
- The code now uses `toMySQLDateTime()` which handles UTC+7 timezone conversion
- UI components will continue to work as they handle both number and string formats
- The `system_pos_queue` table still uses `BIGINT` for `synced_at` (this is a different table and was not changed)

## Rollback (if needed)

If you need to rollback, you would need to:
1. Convert DATETIME back to BIGINT (milliseconds)
2. Change column type back to BIGINT
3. Revert code changes

However, this is not recommended as DATETIME is the correct type for timestamp columns.





