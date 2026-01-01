-- Check why transaction 0142512261253320001 is not syncing
-- Run this on LOCAL MySQL database (configured via .env DB_HOST and DB_NAME)

-- 1. Check transaction sync status and all related fields
SELECT 
    id,
    uuid_id,
    receipt_number,
    business_id,
    created_at,
    sync_status,
    synced_at,
    sync_attempts,
    last_sync_attempt,
    status,
    CASE 
        WHEN sync_status = 'synced' AND synced_at IS NOT NULL THEN '✅ Marked as synced locally'
        WHEN sync_status = 'pending' THEN '⚠️ Pending sync'
        WHEN sync_status = 'failed' THEN '❌ Sync failed'
        WHEN sync_status IS NULL THEN '❓ No sync status'
        ELSE '❓ Unknown status: ' || sync_status
    END as sync_status_analysis
FROM transactions
WHERE uuid_id = '0142512261253320001';

-- 2. Check if transaction has sync_status = 'pending' (should be picked up by smart sync)
SELECT 
    COUNT(*) as pending_count,
    GROUP_CONCAT(uuid_id) as pending_uuid_ids
FROM transactions
WHERE sync_status = 'pending'
LIMIT 20;

-- 3. Check all transactions with same business_id to see sync pattern
SELECT 
    uuid_id,
    receipt_number,
    created_at,
    sync_status,
    synced_at,
    sync_attempts
FROM transactions
WHERE business_id = (
    SELECT business_id FROM transactions WHERE uuid_id = '0142512261253320001' LIMIT 1
)
ORDER BY created_at DESC
LIMIT 10;

-- 4. Check if there are any transactions marked as 'synced' but actually missing on server
-- (This helps identify sync failures)
SELECT 
    uuid_id,
    receipt_number,
    created_at,
    sync_status,
    synced_at,
    sync_attempts,
    last_sync_attempt
FROM transactions
WHERE sync_status = 'synced'
ORDER BY created_at DESC
LIMIT 10;

