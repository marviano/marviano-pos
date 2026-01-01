-- ============================================================
-- SPECIFIC DIAGNOSTIC FOR PRODUCTS 439 AND 441
-- ============================================================
-- The sync warnings indicate products 439 and 441 don't exist in LOCAL POS database
-- but product_businesses records are trying to link them
--
-- IMPORTANT: You need to run these queries in BOTH databases:
-- 1. LOCAL POS DATABASE (where the sync is writing to)
-- 2. SALESPULSE DATABASE (where the sync is reading from)
-- ============================================================

-- ============================================================
-- QUERY 1: Check if products 439 and 441 exist
-- ============================================================
-- Run this on BOTH databases and compare results
SELECT 
    'PRODUCT EXISTENCE CHECK' AS check_type,
    p.id,
    p.nama AS product_name,
    p.status,
    p.category1_id,
    p.category2_id,
    p.created_at,
    p.updated_at
FROM products p
WHERE p.id IN (439, 441)
ORDER BY p.id;

-- ============================================================
-- QUERY 2: Check product_businesses records for products 439 and 441
-- ============================================================
-- This shows what business relationships exist (or don't exist) for these products
SELECT 
    'PRODUCT_BUSINESSES RECORDS' AS check_type,
    pb.product_id,
    pb.business_id,
    b.name AS business_name,
    b.status AS business_status,
    CASE 
        WHEN p.id IS NULL THEN '⚠️ PRODUCT MISSING' 
        ELSE '✅ PRODUCT EXISTS' 
    END AS product_status
FROM product_businesses pb
LEFT JOIN products p ON pb.product_id = p.id
LEFT JOIN businesses b ON pb.business_id = b.id
WHERE pb.product_id IN (439, 441)
ORDER BY pb.product_id, pb.business_id;

-- ============================================================
-- QUERY 3: Count how many businesses are trying to link to missing products
-- ============================================================
-- Run this on LOCAL POS database to see what's being blocked
SELECT 
    'ORPHANED IN LOCAL DB' AS check_type,
    pb.product_id,
    COUNT(pb.business_id) AS businesses_count,
    GROUP_CONCAT(DISTINCT pb.business_id ORDER BY pb.business_id) AS business_ids,
    GROUP_CONCAT(DISTINCT b.name ORDER BY b.name) AS business_names,
    CASE 
        WHEN p.id IS NULL THEN '❌ Product missing - sync will skip these' 
        ELSE '✅ Product exists' 
    END AS status
FROM product_businesses pb
LEFT JOIN products p ON pb.product_id = p.id
LEFT JOIN businesses b ON pb.business_id = b.id
WHERE pb.product_id IN (439, 441)
GROUP BY pb.product_id, p.id
ORDER BY pb.product_id;

-- ============================================================
-- QUERY 4: Check what products exist around IDs 439 and 441
-- ============================================================
-- This helps identify if there's a gap or if products were deleted
SELECT 
    'PRODUCTS NEARBY' AS check_type,
    p.id,
    p.nama AS product_name,
    p.status,
    p.created_at
FROM products p
WHERE p.id BETWEEN 430 AND 450
ORDER BY p.id;

-- ============================================================
-- QUERY 5: Find the highest and lowest product IDs to see range
-- ============================================================
SELECT 
    'PRODUCT ID RANGE' AS check_type,
    MIN(id) AS min_product_id,
    MAX(id) AS max_product_id,
    COUNT(*) AS total_products,
    COUNT(CASE WHEN id IN (439, 441) THEN 1 END) AS target_products_exist
FROM products;

