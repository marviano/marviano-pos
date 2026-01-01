-- Verification script for table_id migration
-- Run this to verify the migration was applied correctly

-- 1. Check if table_id column exists
SELECT 
    COLUMN_NAME,
    DATA_TYPE,
    IS_NULLABLE,
    COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'transactions'
  AND COLUMN_NAME = 'table_id';

-- 2. Check foreign key constraints
SELECT 
    CONSTRAINT_NAME,
    COLUMN_NAME,
    REFERENCED_TABLE_NAME,
    REFERENCED_COLUMN_NAME,
    DELETE_RULE
FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'transactions'
  AND COLUMN_NAME = 'table_id'
  AND REFERENCED_TABLE_NAME IS NOT NULL;

-- 3. Check indexes
SHOW INDEXES FROM transactions WHERE Column_name = 'table_id';

-- 4. Check for duplicate foreign key constraints (should only be 1)
SELECT 
    CONSTRAINT_NAME,
    COUNT(*) as constraint_count
FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'transactions'
  AND COLUMN_NAME = 'table_id'
  AND REFERENCED_TABLE_NAME = 'restaurant_tables'
GROUP BY CONSTRAINT_NAME;

-- Expected results:
-- 1. Column should exist: table_id, int, YES (nullable), NULL
-- 2. Foreign key should exist: fk_transactions_table (or transactions_ibfk_1)
-- 3. Index should exist: idx_transactions_table_status
-- 4. Should only have 1 foreign key constraint (if you see 2, there's a duplicate)

