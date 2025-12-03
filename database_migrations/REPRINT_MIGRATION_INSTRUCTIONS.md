# Reprint Feature Database Migration Instructions

## Overview
This migration adds support for reprint tracking by adding two new columns to the printer audit log tables:
- `is_reprint`: Flag indicating if this is a reprint (0 = original, 1 = reprint)
- `reprint_count`: The reprint number for this transaction (1, 2, 3, etc.)

## Step 1: Run SQL Migration on VPS Database

Connect to your MySQL database on the VPS and run the following SQL commands:

```sql
-- Add columns to printer1_audit_log
ALTER TABLE printer1_audit_log
  ADD COLUMN is_reprint INT DEFAULT 0,
  ADD COLUMN reprint_count INT DEFAULT 0;

-- Add columns to printer2_audit_log
ALTER TABLE printer2_audit_log
  ADD COLUMN is_reprint INT DEFAULT 0,
  ADD COLUMN reprint_count INT DEFAULT 0;
```

**Note:** If your MySQL version doesn't support adding multiple columns in one statement, run them separately:

```sql
ALTER TABLE printer1_audit_log ADD COLUMN is_reprint INT DEFAULT 0;
ALTER TABLE printer1_audit_log ADD COLUMN reprint_count INT DEFAULT 0;
ALTER TABLE printer2_audit_log ADD COLUMN is_reprint INT DEFAULT 0;
ALTER TABLE printer2_audit_log ADD COLUMN reprint_count INT DEFAULT 0;
```

## Step 2: Redeploy API Endpoint

After running the SQL migration, you **MUST** redeploy your salespulse.cc API endpoint because:

1. **Updated `/api/printer-audits` route**: Now accepts and stores `is_reprint` and `reprint_count` columns
2. **Updated `/api/sync` route**: Now includes `is_reprint` and `reprint_count` when syncing data from cloud to local

The API code has been updated in:
- `src/app/_api/printer-audits/route.ts`
- `src/app/_api/sync/route.ts`

## Verification

After migration and redeployment, verify the changes:

1. **Check database columns exist:**
   ```sql
   SHOW COLUMNS FROM printer1_audit_log LIKE 'is_reprint';
   SHOW COLUMNS FROM printer1_audit_log LIKE 'reprint_count';
   SHOW COLUMNS FROM printer2_audit_log LIKE 'is_reprint';
   SHOW COLUMNS FROM printer2_audit_log LIKE 'reprint_count';
   ```

2. **Test reprint functionality:**
   - Create a transaction and print it
   - Reprint the transaction from "Daftar Transaksi"
   - Verify the receipt shows "REPRINT KE-1"
   - Check that the audit log has `is_reprint=1` and `reprint_count=1`

## Important Notes

- **Backward Compatibility**: The new columns have default values (0), so existing records will work fine
- **Sync Compatibility**: The sync system checks for column existence before including them, so it's safe even if some databases don't have the columns yet
- **No Data Loss**: This migration only adds columns, it doesn't modify or delete any existing data
























