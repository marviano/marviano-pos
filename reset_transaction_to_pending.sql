-- Reset transaction 0142512261253320001 to 'pending' status so it can be synced again
-- Run this on LOCAL MySQL database (configured via .env DB_HOST and DB_NAME)

-- Reset sync status to 'pending' so smart sync will pick it up
UPDATE transactions 
SET 
    sync_status = 'pending',
    synced_at = NULL,
    sync_attempts = 0,
    last_sync_attempt = NULL
WHERE uuid_id = '0142512261253320001';

-- Verify the change
SELECT 
    uuid_id,
    receipt_number,
    sync_status,
    synced_at,
    sync_attempts,
    '✅ Reset to pending - will be synced on next sync' as status
FROM transactions
WHERE uuid_id = '0142512261253320001';

