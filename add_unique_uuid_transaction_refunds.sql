-- =====================================================
-- Add UNIQUE constraint to transaction_refunds.uuid_id
-- =====================================================
-- This script:
-- 1. Identifies duplicate UUIDs
-- 2. Cleans up duplicates (keeps the most recent record)
-- 3. Adds UNIQUE constraint on uuid_id
--
-- IMPORTANT: Backup your database before running this!
-- =====================================================

-- Step 1: Check for duplicates (should return empty if no duplicates)
-- =====================================================
SELECT 
    uuid_id,
    COUNT(*) as duplicate_count,
    GROUP_CONCAT(id ORDER BY id) as record_ids,
    GROUP_CONCAT(created_at ORDER BY id) as created_dates
FROM transaction_refunds
GROUP BY uuid_id
HAVING COUNT(*) > 1;

-- If the above query returns results, proceed with cleanup
-- If empty, you can skip to Step 3

-- =====================================================
-- Step 2: Clean up duplicates (keep the most recent record)
-- =====================================================
-- This keeps the record with the highest id (most recent)
-- You can modify the logic if you prefer different criteria

-- First, let's see what we're about to delete (dry run)
SELECT 
    tr1.id,
    tr1.uuid_id,
    tr1.refund_amount,
    tr1.created_at,
    tr1.updated_at,
    tr1.synced_at,
    'Will be DELETED' as action
FROM transaction_refunds tr1
INNER JOIN (
    SELECT uuid_id, MAX(id) as max_id
    FROM transaction_refunds
    GROUP BY uuid_id
    HAVING COUNT(*) > 1
) duplicates ON tr1.uuid_id = duplicates.uuid_id
WHERE tr1.id < duplicates.max_id
ORDER BY tr1.uuid_id, tr1.id;

-- If the above looks correct, uncomment the DELETE statement below:
/*
DELETE tr1 FROM transaction_refunds tr1
INNER JOIN (
    SELECT uuid_id, MAX(id) as max_id
    FROM transaction_refunds
    GROUP BY uuid_id
    HAVING COUNT(*) > 1
) duplicates ON tr1.uuid_id = duplicates.uuid_id
WHERE tr1.id < duplicates.max_id;
*/

-- Verify no duplicates remain
SELECT 
    uuid_id,
    COUNT(*) as count
FROM transaction_refunds
GROUP BY uuid_id
HAVING COUNT(*) > 1;
-- This should return empty now

-- =====================================================
-- Step 3: Add UNIQUE constraint on uuid_id
-- =====================================================
-- This will create a unique index on uuid_id
-- If any duplicates still exist, this will fail

ALTER TABLE transaction_refunds
ADD UNIQUE KEY `uk_transaction_refunds_uuid` (`uuid_id`);

-- =====================================================
-- Step 4: Verify the constraint was added
-- =====================================================
SHOW INDEX FROM transaction_refunds WHERE Key_name = 'uk_transaction_refunds_uuid';

-- =====================================================
-- Done!
-- =====================================================
-- The UNIQUE constraint is now active.
-- All future inserts with duplicate UUIDs will trigger
-- the ON DUPLICATE KEY UPDATE clause (if present).
-- =====================================================




