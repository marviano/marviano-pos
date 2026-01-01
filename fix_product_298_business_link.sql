-- Fix for Product 298 "Creamy Milk Bun" not showing on kasir page
-- Issue: Product is not linked to any business in product_businesses junction table

-- STEP 1: Find the business ID for "MOMOYO MADIUN 1"
SELECT 
    id,
    name,
    permission_name,
    status
FROM businesses
WHERE name LIKE '%MOMOYO%' OR name LIKE '%Momoyo%' OR name LIKE '%madiun%' OR name LIKE '%Madiun%'
ORDER BY id;

-- STEP 2: Check if product 298 is already linked to any business
SELECT 
    pb.product_id,
    pb.business_id,
    b.name AS business_name,
    p.nama AS product_name
FROM product_businesses pb
LEFT JOIN businesses b ON pb.business_id = b.id
LEFT JOIN products p ON pb.product_id = p.id
WHERE pb.product_id = 298;

-- STEP 3: Check what business ID is typically used (check other products in same category)
SELECT DISTINCT
    pb.business_id,
    b.name AS business_name,
    COUNT(pb.product_id) AS product_count
FROM product_businesses pb
LEFT JOIN businesses b ON pb.business_id = b.id
WHERE pb.product_id IN (
    SELECT id FROM products 
    WHERE category2_id = 53  -- Sweet Bun category
    AND status = 'active'
)
GROUP BY pb.business_id, b.name
ORDER BY product_count DESC;

-- STEP 4: Add product 298 to product_businesses table
-- Replace <BUSINESS_ID> with the actual business ID from STEP 1 or STEP 3
-- Common business IDs: 14 (default), or find the ID for "MOMOYO MADIUN 1"

-- Option A: If business ID is 14 (most common default)
INSERT INTO product_businesses (product_id, business_id)
VALUES (298, 14)
ON DUPLICATE KEY UPDATE product_id = product_id;  -- Prevents error if already exists

-- Option B: If you found a different business ID from STEP 1 or STEP 3, use this:
-- INSERT INTO product_businesses (product_id, business_id)
-- VALUES (298, <BUSINESS_ID>)
-- ON DUPLICATE KEY UPDATE product_id = product_id;

-- STEP 5: Verify the fix
SELECT 
    pb.product_id,
    pb.business_id,
    b.name AS business_name,
    p.nama AS product_name,
    p.status AS product_status,
    c2.name AS category2_name
FROM product_businesses pb
LEFT JOIN businesses b ON pb.business_id = b.id
LEFT JOIN products p ON pb.product_id = p.id
LEFT JOIN category2 c2 ON p.category2_id = c2.id
WHERE pb.product_id = 298;

-- STEP 6: Test query - This simulates what the kasir page does
-- Replace 'Sweet Bun' with the exact category name and <BUSINESS_ID> with your business ID
SELECT 
    p.id,
    p.nama,
    c2.name AS category2_name,
    c1.name AS category1_name,
    p.status,
    p.harga_gofood,
    p.harga_grabfood,
    p.harga_shopeefood
FROM products p
LEFT JOIN category2 c2 ON p.category2_id = c2.id
LEFT JOIN category1 c1 ON p.category1_id = c1.id
INNER JOIN product_businesses pb ON p.id = pb.product_id
WHERE c2.name = 'Sweet Bun'
  AND p.status = 'active'
  AND pb.business_id = 14  -- Replace with your business ID
ORDER BY p.nama ASC;

