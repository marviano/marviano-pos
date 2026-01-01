-- ============================================================================
-- VERIFY SYNCED TRANSACTIONS IN SALESPULSE DATABASE
-- ============================================================================
-- This script verifies that the 10 transactions synced on 2025-12-26 15:14:30
-- actually exist in the salespulse (remote) database
--
-- Run this on the SALESPULSE MySQL database (not the local POS database)
-- ============================================================================

-- List of transaction UUIDs that were synced (from console logs)
-- Business ID: 14
SET @business_id = 14;

-- ============================================================================
-- QUERY 1: Check if all synced transactions exist by UUID
-- ============================================================================
SELECT 
    '✅ FOUND' as status,
    t.id,
    t.uuid_id,
    t.receipt_number,
    t.business_id,
    t.user_id,
    t.total_amount,
    t.final_amount,
    t.payment_method,
    t.payment_method_id,
    t.pickup_method,
    t.created_at,
    t.updated_at,
    t.status,
    (SELECT COUNT(*) FROM transaction_items ti WHERE ti.uuid_transaction_id = t.uuid_id) as items_count
FROM transactions t
WHERE t.uuid_id IN (
    '0142512261253320001',  -- Transaction 8695
    '0142512261231210001',  -- Transaction 8694
    '0142512261230300001',  -- Transaction 8693
    '0142512252257150001',  -- Transaction 8692
    '0142512252012250001',  -- Transaction 8691
    '0142512251958310001',  -- Transaction 8690
    '0142512251841320001',  -- Transaction 8689
    '0142512251840040001',  -- Transaction 8688
    '0142512251829080001',  -- Transaction 8687
    '0142512251827380001'   -- Transaction 8686
)
AND t.business_id = @business_id
ORDER BY t.created_at DESC;

-- ============================================================================
-- QUERY 2: Check which transactions are MISSING
-- ============================================================================
SELECT 
    '❌ MISSING' as status,
    expected.uuid_id,
    expected.transaction_id,
    expected.business_id,
    expected.created_at_local
FROM (
    SELECT '0142512261253320001' as uuid_id, 8695 as transaction_id, 14 as business_id, '2025-12-26 05:53:32' as created_at_local
    UNION ALL SELECT '0142512261231210001', 8694, 14, '2025-12-26 05:31:21'
    UNION ALL SELECT '0142512261230300001', 8693, 14, '2025-12-26 05:30:30'
    UNION ALL SELECT '0142512252257150001', 8692, 14, '2025-12-25 15:57:15'
    UNION ALL SELECT '0142512252012250001', 8691, 14, '2025-12-25 13:12:25'
    UNION ALL SELECT '0142512251958310001', 8690, 14, '2025-12-25 12:58:31'
    UNION ALL SELECT '0142512251841320001', 8689, 14, '2025-12-25 11:41:33'
    UNION ALL SELECT '0142512251840040001', 8688, 14, '2025-12-25 11:40:04'
    UNION ALL SELECT '0142512251829080001', 8687, 14, '2025-12-25 11:29:08'
    UNION ALL SELECT '0142512251827380001', 8686, 14, '2025-12-25 11:27:38'
) expected
LEFT JOIN transactions t ON t.uuid_id = expected.uuid_id AND t.business_id = expected.business_id
WHERE t.uuid_id IS NULL
ORDER BY expected.created_at_local DESC;

-- ============================================================================
-- QUERY 3: Summary - Count found vs expected
-- ============================================================================
SELECT 
    COUNT(*) as found_count,
    10 as expected_count,
    (10 - COUNT(*)) as missing_count,
    CASE 
        WHEN COUNT(*) = 10 THEN '✅ ALL TRANSACTIONS SYNCED'
        WHEN COUNT(*) > 0 THEN CONCAT('⚠️ PARTIAL SYNC: ', COUNT(*), '/10 found')
        ELSE '❌ NO TRANSACTIONS FOUND'
    END as sync_status
FROM transactions t
WHERE t.uuid_id IN (
    '0142512261253320001',
    '0142512261231210001',
    '0142512261230300001',
    '0142512252257150001',
    '0142512252012250001',
    '0142512251958310001',
    '0142512251841320001',
    '0142512251840040001',
    '0142512251829080001',
    '0142512251827380001'
)
AND t.business_id = @business_id;

-- ============================================================================
-- QUERY 4: Verify transaction items for each transaction
-- ============================================================================
SELECT 
    t.uuid_id as transaction_uuid,
    t.receipt_number,
    COUNT(ti.id) as items_found,
    SUM(ti.quantity) as total_quantity,
    SUM(ti.total_price) as total_items_price,
    t.final_amount as transaction_final_amount,
    CASE 
        WHEN ABS(SUM(ti.total_price) - CAST(t.final_amount AS DECIMAL(10,2))) < 0.01 THEN '✅ MATCH'
        ELSE '⚠️ MISMATCH'
    END as amount_verification
FROM transactions t
LEFT JOIN transaction_items ti ON ti.uuid_transaction_id = t.uuid_id
WHERE t.uuid_id IN (
    '0142512261253320001',
    '0142512261231210001',
    '0142512261230300001',
    '0142512252257150001',
    '0142512252012250001',
    '0142512251958310001',
    '0142512251841320001',
    '0142512251840040001',
    '0142512251829080001',
    '0142512251827380001'
)
AND t.business_id = @business_id
GROUP BY t.uuid_id, t.receipt_number, t.final_amount
ORDER BY t.created_at DESC;

-- ============================================================================
-- QUERY 5: Check transaction customizations (for transactions that had them)
-- ============================================================================
-- Transaction 8694 had 5 customizations and 18 options
-- Transaction 8691 had 5 customizations and 5 options
-- Transaction 8690 had 1 customization and 6 options
SELECT 
    t.uuid_id as transaction_uuid,
    t.receipt_number,
    COUNT(DISTINCT tic.id) as customizations_count,
    COUNT(DISTINCT tico.id) as options_count
FROM transactions t
LEFT JOIN transaction_item_customizations tic ON tic.transaction_item_id IN (
    SELECT ti.uuid_id FROM transaction_items ti WHERE ti.uuid_transaction_id = t.uuid_id
)
LEFT JOIN transaction_item_customization_options tico ON tico.transaction_item_customization_id = tic.id
WHERE t.uuid_id IN (
    '0142512261231210001',  -- 8694: should have 5 customizations, 18 options
    '0142512252012250001',  -- 8691: should have 5 customizations, 5 options
    '0142512251958310001'   -- 8690: should have 1 customization, 6 options
)
AND t.business_id = @business_id
GROUP BY t.uuid_id, t.receipt_number;

-- ============================================================================
-- QUERY 6: Detailed item breakdown for a specific transaction (example)
-- ============================================================================
-- Check transaction 8695 (0142512261253320001) - should have 1 item
SELECT 
    t.uuid_id as transaction_uuid,
    t.receipt_number,
    t.total_amount,
    t.final_amount,
    ti.uuid_id as item_uuid,
    ti.product_id,
    p.nama as product_name,
    ti.quantity,
    ti.unit_price,
    ti.total_price,
    ti.custom_note
FROM transactions t
INNER JOIN transaction_items ti ON ti.uuid_transaction_id = t.uuid_id
LEFT JOIN products p ON p.id = ti.product_id
WHERE t.uuid_id = '0142512261253320001'
AND t.business_id = @business_id
ORDER BY ti.id;

-- ============================================================================
-- QUERY 7: Check recent transactions for business_id 14 (to see sync pattern)
-- ============================================================================
SELECT 
    t.id,
    t.uuid_id,
    t.receipt_number,
    t.business_id,
    t.total_amount,
    t.final_amount,
    t.payment_method,
    t.created_at,
    (SELECT COUNT(*) FROM transaction_items ti WHERE ti.uuid_transaction_id = t.uuid_id) as items_count
FROM transactions t
WHERE t.business_id = @business_id
AND t.created_at >= '2025-12-25 11:00:00'
ORDER BY t.created_at DESC
LIMIT 20;

-- ============================================================================
-- INSTRUCTIONS:
-- ============================================================================
-- 1. Run this script on the SALESPULSE MySQL database (remote/VPS)
-- 2. QUERY 1 shows all found transactions - should return 10 rows
-- 3. QUERY 2 shows missing transactions - should return 0 rows if all synced
-- 4. QUERY 3 gives a summary - should show "✅ ALL TRANSACTIONS SYNCED"
-- 5. QUERY 4 verifies items match transaction amounts
-- 6. QUERY 5 checks customizations for transactions that had them
-- 7. QUERY 6 shows detailed breakdown of a specific transaction
-- 8. QUERY 7 shows recent transactions to verify sync pattern
--
-- If any transactions are missing, check:
-- - Server logs for errors during sync
-- - Network connectivity during sync
-- - Database constraints or foreign key issues
-- ============================================================================





