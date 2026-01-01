-- Remove duplicate foreign key constraint for table_id
-- Keep: fk_transactions_table
-- Remove: transactions_ibfk_1

-- Step 1: Drop the duplicate constraint
ALTER TABLE transactions 
DROP FOREIGN KEY transactions_ibfk_1;

-- Step 2: Verify only one constraint remains
-- Run this query to verify:
-- SELECT 
--     CONSTRAINT_NAME,
--     COLUMN_NAME,
--     REFERENCED_TABLE_NAME,
--     REFERENCED_COLUMN_NAME
-- FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
-- WHERE TABLE_SCHEMA = DATABASE()
--   AND TABLE_NAME = 'transactions'
--   AND COLUMN_NAME = 'table_id'
--   AND REFERENCED_TABLE_NAME = 'restaurant_tables';
--
-- Expected result: Only 'fk_transactions_table' should appear

