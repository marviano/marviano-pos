-- =====================================================
-- Check if transactions are upserted to VPS Salespulse
-- =====================================================

-- Option 1: Check specific transaction by UUID (recommended)
-- Replace '0142512261253320001' with the actual uuid_id you want to check
SELECT 
    id,
    uuid_id,
    business_id,
    user_id,
    total_amount,
    final_amount,
    status,
    payment_method,
    pickup_method,
    created_at,
    updated_at,
    refund_status,
    refund_total
FROM transactions
WHERE uuid_id = '0142512261253320001';

-- Option 2: Check multiple transactions by UUID
SELECT 
    id,
    uuid_id,
    business_id,
    user_id,
    total_amount,
    final_amount,
    status,
    payment_method,
    created_at,
    refund_status
FROM transactions
WHERE uuid_id IN (
    '0142512261253320001',
    '0142512261231210001',
    '0142512261230300001'
)
ORDER BY created_at DESC;

-- Option 3: Check transactions from a specific business within a date range
-- Replace business_id and date range as needed
SELECT 
    id,
    uuid_id,
    business_id,
    user_id,
    total_amount,
    final_amount,
    status,
    payment_method,
    created_at,
    updated_at
FROM transactions
WHERE business_id = 14
    AND DATE(created_at) >= '2025-12-26'
    AND DATE(created_at) <= '2025-12-26'
ORDER BY created_at DESC;

-- Option 4: Count transactions by date to verify sync completeness
SELECT 
    DATE(created_at) as transaction_date,
    COUNT(*) as total_transactions,
    COUNT(DISTINCT uuid_id) as unique_uuids,
    SUM(total_amount) as total_revenue,
    MIN(created_at) as first_transaction,
    MAX(created_at) as last_transaction
FROM transactions
WHERE business_id = 14
    AND DATE(created_at) >= '2025-12-26'
GROUP BY DATE(created_at)
ORDER BY transaction_date DESC;

-- Option 5: Check if transaction has items (verify complete sync)
SELECT 
    t.id,
    t.uuid_id,
    t.business_id,
    t.total_amount,
    t.created_at,
    COUNT(ti.id) as items_count,
    GROUP_CONCAT(ti.product_id ORDER BY ti.id) as product_ids
FROM transactions t
LEFT JOIN transaction_items ti ON ti.transaction_uuid = t.uuid_id
WHERE t.uuid_id = '0142512261253320001'
GROUP BY t.id, t.uuid_id, t.business_id, t.total_amount, t.created_at;

-- Option 6: Compare specific transaction details (if you have local data)
-- This shows what's on the VPS for verification
SELECT 
    uuid_id as UUID,
    id as VPS_ID,
    business_id,
    user_id,
    shift_uuid,
    payment_method,
    pickup_method,
    total_amount,
    voucher_discount,
    final_amount,
    amount_received,
    change_amount,
    status,
    refund_status,
    refund_total,
    created_at,
    updated_at,
    -- Check if has items
    (SELECT COUNT(*) FROM transaction_items WHERE transaction_uuid = t.uuid_id) as items_count,
    -- Check if has customizations
    (SELECT COUNT(*) FROM transaction_customizations WHERE transaction_uuid = t.uuid_id) as customizations_count
FROM transactions t
WHERE uuid_id = '0142512261253320001';

-- Option 7: List recent transactions to verify sync is working
SELECT 
    uuid_id,
    id,
    business_id,
    total_amount,
    payment_method,
    status,
    created_at,
    (SELECT COUNT(*) FROM transaction_items WHERE transaction_uuid = t.uuid_id) as items_count
FROM transactions t
WHERE business_id = 14
ORDER BY created_at DESC
LIMIT 20;

-- Option 8: Find transactions that might be missing items (sync incomplete check)
SELECT 
    t.uuid_id,
    t.id,
    t.business_id,
    t.total_amount,
    t.created_at,
    COUNT(ti.id) as items_count
FROM transactions t
LEFT JOIN transaction_items ti ON ti.transaction_uuid = t.uuid_id
WHERE t.business_id = 14
    AND DATE(t.created_at) >= '2025-12-26'
GROUP BY t.uuid_id, t.id, t.business_id, t.total_amount, t.created_at
HAVING items_count = 0  -- Transactions with no items (might indicate incomplete sync)
ORDER BY t.created_at DESC;

