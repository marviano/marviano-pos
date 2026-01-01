-- Check if category1_id 8 exists in category1 table
SELECT 
    id,
    name,
    description,
    display_order,
    is_active,
    created_at,
    updated_at
FROM category1
WHERE id = 8;

-- If the above returns no rows, category1_id 8 does not exist
-- You can also check all category1 records to see what IDs exist:
SELECT 
    id,
    name,
    description,
    is_active,
    created_at
FROM category1
ORDER BY id;

-- Check which products are trying to use category1_id 8:
SELECT 
    p.id,
    p.menu_code,
    p.nama,
    p.category1_id,
    p.category2_id,
    p.status
FROM products p
WHERE p.category1_id = 8;

-- Count how many products are affected:
SELECT 
    COUNT(*) as affected_products_count
FROM products
WHERE category1_id = 8;






