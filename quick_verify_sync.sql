-- ============================================================================
-- QUICK SYNC VERIFICATION - Run this on SALESPULSE database
-- ============================================================================
-- Quick check: Do these 10 transaction UUIDs exist in the database?
-- ============================================================================

-- Simple check: Count how many of the 10 synced transactions exist
SELECT 
    COUNT(*) as found_count,
    10 as expected_count,
    CASE 
        WHEN COUNT(*) = 10 THEN '✅ ALL SYNCED'
        WHEN COUNT(*) > 0 THEN CONCAT('⚠️ PARTIAL: ', COUNT(*), '/10')
        ELSE '❌ NONE FOUND'
    END as status
FROM transactions
WHERE uuid_id IN (
    '0142512261253320001',  -- 8695
    '0142512261231210001',  -- 8694
    '0142512261230300001',  -- 8693
    '0142512252257150001',  -- 8692
    '0142512252012250001',  -- 8691
    '0142512251958310001',  -- 8690
    '0142512251841320001',  -- 8689
    '0142512251840040001',  -- 8688
    '0142512251829080001',  -- 8687
    '0142512251827380001'   -- 8686
)
AND business_id = 14;

-- List all found transactions with key details
SELECT 
    uuid_id,
    receipt_number,
    total_amount,
    final_amount,
    payment_method,
    created_at
FROM transactions
WHERE uuid_id IN (
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
AND business_id = 14
ORDER BY created_at DESC;





