-- Diagnostic queries to find transaction and items by receipt number
-- Receipt number: 0142512252257150001

-- 1. Find the transaction by receipt number or UUID
SELECT 
    id,
    uuid_id,
    receipt_number,
    business_id,
    total_amount,
    final_amount,
    created_at,
    status
FROM transactions
WHERE receipt_number = '0142512252257150001'
   OR uuid_id = '0142512252257150001'
   OR id = '0142512252257150001'
LIMIT 5;

-- 2. If transaction found, get its numeric ID and UUID
-- (Run this after finding the transaction above)
-- Replace TRANSACTION_ID_HERE with the id from query 1
-- Replace TRANSACTION_UUID_HERE with the uuid_id from query 1

-- 3. Find transaction items by transaction numeric ID
SELECT 
    ti.id,
    ti.transaction_id,
    ti.uuid_transaction_id,
    ti.product_id,
    ti.quantity,
    ti.unit_price,
    ti.total_price,
    ti.custom_note,
    p.nama as product_name
FROM transaction_items ti
LEFT JOIN products p ON ti.product_id = p.id
WHERE ti.transaction_id = TRANSACTION_ID_HERE  -- Replace with actual numeric ID
ORDER BY ti.id ASC;

-- 4. Find transaction items by UUID transaction ID
SELECT 
    ti.id,
    ti.transaction_id,
    ti.uuid_transaction_id,
    ti.product_id,
    ti.quantity,
    ti.unit_price,
    ti.total_price,
    ti.custom_note,
    p.nama as product_name
FROM transaction_items ti
LEFT JOIN products p ON ti.product_id = p.id
WHERE ti.uuid_transaction_id = 'TRANSACTION_UUID_HERE'  -- Replace with actual UUID
ORDER BY ti.id ASC;

-- 5. Find transaction items by joining with transactions table (most reliable)
SELECT 
    ti.id,
    ti.transaction_id,
    ti.uuid_transaction_id,
    ti.product_id,
    ti.quantity,
    ti.unit_price,
    ti.total_price,
    ti.custom_note,
    p.nama as product_name,
    t.uuid_id as transaction_uuid,
    t.id as transaction_numeric_id
FROM transaction_items ti
LEFT JOIN products p ON ti.product_id = p.id
INNER JOIN transactions t ON ti.transaction_id = t.id
WHERE t.receipt_number = '0142512252257150001'
   OR t.uuid_id = '0142512252257150001'
ORDER BY ti.id ASC;

-- 6. Check all transactions with similar receipt numbers (to see the pattern)
SELECT 
    id,
    uuid_id,
    receipt_number,
    created_at,
    total_amount
FROM transactions
WHERE receipt_number LIKE '014251225%'
ORDER BY created_at DESC
LIMIT 10;

-- 7. Check what fields transaction_items actually has
SELECT 
    COLUMN_NAME,
    DATA_TYPE,
    IS_NULLABLE,
    COLUMN_DEFAULT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'transaction_items'
ORDER BY ORDINAL_POSITION;

-- 8. Sample transaction_items to see the data structure
SELECT 
    id,
    transaction_id,
    uuid_transaction_id,
    product_id,
    quantity,
    unit_price,
    total_price
FROM transaction_items
LIMIT 5;

