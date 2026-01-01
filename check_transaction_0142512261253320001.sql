-- Check Transaction: 0142512261253320001
-- This value is the uuid_id field displayed in the "UUID" column of Daftar Transaksi
-- Note: This is NOT a standard UUID format (standard UUIDs: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
-- But it IS the uuid_id value used by the system as the unique identifier

-- ============================================================================
-- QUERY 1: Check in LOCAL MySQL Database (configured via .env DB_HOST and DB_NAME)
-- ============================================================================

-- PRIMARY QUERY: Search by uuid_id (this is what the UUID column displays)
SELECT 
    id,
    uuid_id,
    receipt_number,
    business_id,
    user_id,
    total_amount,
    final_amount,
    created_at,
    sync_status,
    synced_at,
    sync_attempts,
    status,
    CASE 
        WHEN sync_status = 'synced' THEN '✅ SYNCED'
        WHEN sync_status = 'pending' THEN '⚠️ PENDING SYNC'
        WHEN sync_status = 'failed' THEN '❌ SYNC FAILED'
        ELSE '❓ UNKNOWN'
    END as sync_status_display
FROM transactions
WHERE uuid_id = '0142512261253320001'
LIMIT 1;

-- Option C: Search by receipt_number pattern (to find similar transactions)
SELECT 
    id,
    uuid_id,
    receipt_number,
    business_id,
    user_id,
    total_amount,
    final_amount,
    created_at,
    sync_status,
    synced_at,
    status
FROM transactions
WHERE receipt_number LIKE '%0142512261253320001%'
   OR uuid_id LIKE '%0142512261253320001%'
ORDER BY created_at DESC
LIMIT 20;

-- Check transaction items for this transaction
-- First, get the transaction's actual UUID or numeric ID
SELECT 
    ti.id,
    ti.uuid_id,
    ti.transaction_id,
    ti.uuid_transaction_id,
    ti.product_id,
    ti.quantity,
    ti.unit_price,
    ti.total_price,
    p.nama as product_name
FROM transaction_items ti
LEFT JOIN products p ON ti.product_id = p.id
WHERE ti.uuid_transaction_id = '0142512261253320001'
   OR ti.transaction_id IN (
       SELECT id FROM transactions 
       WHERE receipt_number = '0142512261253320001' 
          OR uuid_id = '0142512261253320001'
   )
ORDER BY ti.id ASC;

-- ============================================================================
-- QUERY 2: Check in REMOTE MySQL Database (salespulse VPS)
-- ============================================================================
-- Run this on the salespulse MySQL database to verify if transaction is uploaded

-- PRIMARY QUERY: Search by uuid_id to check if transaction exists on server
SELECT 
    id,
    uuid_id,
    receipt_number,
    business_id,
    user_id,
    total_amount,
    final_amount,
    created_at,
    updated_at,
    status,
    refund_status,
    refund_total,
    CASE 
        WHEN uuid_id IS NOT NULL THEN '✅ EXISTS ON SERVER'
        ELSE '❌ NOT FOUND'
    END as upload_status
FROM transactions
WHERE uuid_id = '0142512261253320001'
LIMIT 1;

-- Option C: Check if transaction exists with similar receipt_number pattern
SELECT 
    id,
    uuid_id,
    receipt_number,
    business_id,
    user_id,
    created_at,
    status
FROM transactions
WHERE receipt_number LIKE '%0142512261253320001%'
   OR uuid_id LIKE '%0142512261253320001%'
ORDER BY created_at DESC
LIMIT 20;

-- Check transaction items on server
SELECT 
    ti.id,
    ti.uuid_id,
    ti.transaction_id,
    ti.uuid_transaction_id,
    ti.product_id,
    ti.quantity,
    ti.unit_price,
    ti.total_price,
    p.nama as product_name
FROM transaction_items ti
LEFT JOIN products p ON ti.product_id = p.id
WHERE ti.uuid_transaction_id = '0142512261253320001'
   OR ti.uuid_transaction_id IN (
       SELECT uuid_id FROM transactions 
       WHERE receipt_number = '0142512261253320001' 
          OR uuid_id = '0142512261253320001'
   )
ORDER BY ti.id ASC;

-- ============================================================================
-- QUERY 3: Compare Local vs Remote
-- ============================================================================

-- Get transaction details from LOCAL database
SELECT 
    'LOCAL' as source,
    id,
    uuid_id,
    receipt_number,
    business_id,
    user_id,
    total_amount,
    final_amount,
    created_at,
    sync_status,
    synced_at
FROM transactions
WHERE receipt_number = '0142512261253320001'
   OR uuid_id = '0142512261253320001'
LIMIT 1;

-- Then run this on REMOTE MySQL to compare
SELECT 
    'REMOTE' as source,
    id,
    uuid_id,
    receipt_number,
    business_id,
    user_id,
    total_amount,
    final_amount,
    created_at,
    NULL as sync_status,
    NULL as synced_at
FROM transactions
WHERE receipt_number = '0142512261253320001'
   OR uuid_id = '0142512261253320001'
LIMIT 1;

-- ============================================================================
-- QUERY 4: Check All Transactions with Similar Receipt Number Pattern
-- ============================================================================
-- This will help identify the pattern used for this receipt number

-- On LOCAL MySQL
SELECT 
    id,
    uuid_id,
    receipt_number,
    created_at,
    sync_status,
    synced_at
FROM transactions
WHERE receipt_number LIKE '014251226%'
ORDER BY created_at DESC
LIMIT 10;

-- On REMOTE MySQL
SELECT 
    id,
    uuid_id,
    receipt_number,
    created_at,
    updated_at
FROM transactions
WHERE receipt_number LIKE '014251226%'
ORDER BY created_at DESC
LIMIT 10;

-- ============================================================================
-- SUMMARY & INSTRUCTIONS:
-- ============================================================================
-- 1. The value '0142512261253320001' is the uuid_id field shown in the UUID column
--    (NOT a standard UUID format, but the system's unique identifier)
--
-- 2. To verify if transaction is uploaded:
--    a) Run QUERY 1 on LOCAL MySQL database to check sync_status
--    b) Run QUERY 2 on REMOTE MySQL database to check if it exists
--
-- 3. If LOCAL shows sync_status = 'synced' but REMOTE query returns no rows:
--    → Transaction sync failed (should re-sync)
--
-- 4. If LOCAL shows sync_status = 'pending':
--    → Transaction is waiting to be synced
--
-- 5. If REMOTE query returns a row:
--    → Transaction is successfully uploaded ✅

