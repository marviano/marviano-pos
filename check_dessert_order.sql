-- Check why dessert order is not showing in Barista display
-- Transaction ID: 0142601012201470001

-- 1. Check transaction status
SELECT 
    t.id,
    t.uuid_id,
    t.status,
    t.table_id,
    t.created_at,
    t.customer_name
FROM transactions t
WHERE t.uuid_id = '0142601012201470001' OR t.id = '0142601012201470001';

-- 2. Check transaction items with product and category info
SELECT 
    ti.id,
    ti.uuid_id,
    ti.uuid_transaction_id,
    ti.product_id,
    ti.quantity,
    ti.production_status,
    ti.production_started_at,
    ti.production_finished_at,
    ti.created_at,
    p.nama as product_name,
    p.category1_id,
    c1.id as category1_table_id,
    c1.name as category1_name,
    CASE 
        WHEN c1.name = 'minuman' THEN 'Barista ✓'
        WHEN c1.name = 'dessert' THEN 'Barista ✓'
        WHEN c1.name = 'makanan' THEN 'Kitchen ✓'
        WHEN c1.name = 'bakery' THEN 'Kitchen ✓'
        ELSE 'Unknown category'
    END as should_show_in
FROM transaction_items ti
JOIN products p ON ti.product_id = p.id
LEFT JOIN category1 c1 ON p.category1_id = c1.id
WHERE ti.uuid_transaction_id = '0142601012201470001' 
   OR ti.transaction_id = (SELECT id FROM transactions WHERE uuid_id = '0142601012201470001' LIMIT 1);

-- 3. Check all category1 values in database (to see what categories exist)
SELECT 
    id,
    name,
    CASE 
        WHEN name = 'minuman' THEN 'Barista'
        WHEN name = 'dessert' THEN 'Barista'
        WHEN name = 'makanan' THEN 'Kitchen'
        WHEN name = 'bakery' THEN 'Kitchen'
        ELSE 'Unknown'
    END as display_location
FROM category1
ORDER BY id;

-- 4. Check if product category1_id matches category1 table
SELECT 
    p.id as product_id,
    p.nama as product_name,
    p.category1_id,
    c1.id as category1_table_id,
    c1.name as category1_name,
    CASE 
        WHEN p.category1_id IS NULL THEN '❌ No category1_id'
        WHEN c1.id IS NULL THEN '❌ category1_id does not exist in category1 table'
        WHEN c1.name NOT IN ('makanan', 'minuman', 'dessert', 'bakery') THEN CONCAT('⚠️ Unknown category: ', c1.name)
        ELSE '✓ OK'
    END as status
FROM products p
LEFT JOIN category1 c1 ON p.category1_id = c1.id
WHERE p.id IN (
    SELECT DISTINCT product_id 
    FROM transaction_items 
    WHERE uuid_transaction_id = '0142601012201470001'
);

