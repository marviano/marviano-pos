-- =====================================================
-- Check and Drop customizations_json Column from SQLite
-- This script checks if the column exists and removes it
-- =====================================================

-- Check if column exists
SELECT 
  CASE 
    WHEN COUNT(*) > 0 THEN 'Column customizations_json EXISTS - will be removed'
    ELSE 'Column customizations_json does NOT exist - nothing to do'
  END as status
FROM pragma_table_info('transaction_items')
WHERE name = 'customizations_json';

-- Note: SQLite doesn't support DROP COLUMN directly in older versions
-- For SQLite 3.35.0+ (March 2021), you can use:
-- ALTER TABLE transaction_items DROP COLUMN customizations_json;

-- For older SQLite versions, you need to:
-- 1. Create new table without the column
-- 2. Copy data
-- 3. Drop old table
-- 4. Rename new table

-- This script will work for SQLite 3.35.0+
-- If you get an error, your SQLite version may be too old

-- Uncomment the line below to actually drop the column:
-- ALTER TABLE transaction_items DROP COLUMN customizations_json;


