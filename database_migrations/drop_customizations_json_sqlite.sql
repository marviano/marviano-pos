-- =====================================================
-- Drop customizations_json Column from SQLite
-- WARNING: This permanently removes the column!
-- =====================================================

-- SQLite 3.35.0+ (March 2021) supports DROP COLUMN
-- Check your SQLite version first:
SELECT sqlite_version() as sqlite_version;

-- Drop the column
ALTER TABLE transaction_items DROP COLUMN customizations_json;

SELECT 'Column customizations_json removed successfully' as status;


