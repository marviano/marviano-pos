-- =====================================================
-- Check if customizations_json column exists in SQLite
-- =====================================================

-- Check SQLite version (need 3.35.0+ for DROP COLUMN)
SELECT sqlite_version() as sqlite_version;

-- Check if column exists
SELECT 
  name as column_name,
  type as column_type,
  CASE 
    WHEN name = 'customizations_json' THEN 'EXISTS - needs to be removed'
    ELSE 'Column does not exist'
  END as status
FROM pragma_table_info('transaction_items')
WHERE name = 'customizations_json';

-- Count how many records have customizations_json data
SELECT 
  COUNT(*) as total_items,
  COUNT(CASE WHEN customizations_json IS NOT NULL AND customizations_json != '' AND customizations_json != '[]' AND customizations_json != 'null' THEN 1 END) as items_with_json_data
FROM transaction_items;


