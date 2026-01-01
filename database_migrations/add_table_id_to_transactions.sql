-- Migration: Add table_id to transactions table
-- Date: 2024
-- Description: Adds table_id column to link transactions to restaurant tables
--              Enables table assignment for dine-in orders

-- Step 1: Add table_id column
ALTER TABLE transactions 
ADD COLUMN table_id INT NULL;

-- Step 2: Add foreign key constraint
ALTER TABLE transactions
ADD CONSTRAINT fk_transactions_table 
  FOREIGN KEY (table_id) REFERENCES restaurant_tables(id) 
  ON DELETE SET NULL;

-- Step 3: Create index for performance (MySQL compatible - no WHERE clause)
CREATE INDEX idx_transactions_table_status 
ON transactions(table_id, status);

-- Note: The business rule "one pending transaction per table" 
-- is enforced in application logic, not at database level.
-- MySQL doesn't support partial unique indexes with WHERE clauses.

-- Verification query (run after migration):
-- SELECT 
--   table_id,
--   COUNT(*) as pending_count
-- FROM transactions
-- WHERE status = 'pending' AND table_id IS NOT NULL
-- GROUP BY table_id
-- HAVING COUNT(*) > 1;
-- This should return 0 rows if data is clean.

