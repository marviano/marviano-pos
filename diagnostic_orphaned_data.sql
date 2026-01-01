-- ============================================================
-- DIAGNOSTIC QUERIES FOR DATA INTEGRITY ISSUES
-- Run these on both VPS salespulse and localhost salespulse
-- ============================================================

-- ============================================================
-- PART 1: MISSING PRODUCTS IN product_businesses
-- ============================================================
-- This checks for product_businesses records that reference products that don't exist

SELECT 
    'MISSING PRODUCTS' AS issue_type,
    pb.product_id,
    pb.business_id,
    b.name AS business_name,
    'Product does not exist in products table' AS issue_description
FROM product_businesses pb
LEFT JOIN products p ON pb.product_id = p.id
LEFT JOIN businesses b ON pb.business_id = b.id
WHERE p.id IS NULL
ORDER BY pb.product_id, pb.business_id;

-- Count of orphaned product_businesses records
SELECT 
    COUNT(*) AS orphaned_product_businesses_count,
    COUNT(DISTINCT pb.product_id) AS unique_missing_products,
    GROUP_CONCAT(DISTINCT pb.product_id ORDER BY pb.product_id) AS missing_product_ids
FROM product_businesses pb
LEFT JOIN products p ON pb.product_id = p.id
WHERE p.id IS NULL;

-- ============================================================
-- PART 2: MISSING CATEGORIES IN permissions
-- ============================================================
-- This checks for permissions records that reference permission_categories that don't exist

SELECT 
    'MISSING PERMISSION CATEGORIES' AS issue_type,
    perm.id AS permission_id,
    perm.name AS permission_name,
    perm.category_id,
    'Category does not exist in permission_categories table' AS issue_description
FROM permissions perm
LEFT JOIN permission_categories pc ON perm.category_id = pc.id
WHERE perm.category_id IS NOT NULL 
  AND pc.id IS NULL
ORDER BY perm.category_id, perm.id;

-- Count of orphaned permissions by category_id
SELECT 
    category_id,
    COUNT(*) AS permissions_count,
    GROUP_CONCAT(DISTINCT id ORDER BY id) AS permission_ids,
    GROUP_CONCAT(DISTINCT name) AS permission_names
FROM permissions
WHERE category_id IS NOT NULL
  AND category_id NOT IN (SELECT id FROM permission_categories)
GROUP BY category_id
ORDER BY category_id;

-- Summary of all missing category_ids
SELECT 
    COUNT(*) AS orphaned_permissions_count,
    COUNT(DISTINCT category_id) AS unique_missing_categories,
    GROUP_CONCAT(DISTINCT category_id ORDER BY category_id) AS missing_category_ids
FROM permissions
WHERE category_id IS NOT NULL
  AND category_id NOT IN (SELECT id FROM permission_categories);

-- ============================================================
-- PART 3: VERIFY SPECIFIC PRODUCTS MENTIONED IN LOGS
-- ============================================================
-- Check if products 439 and 441 exist

SELECT 
    'SPECIFIC PRODUCT CHECK' AS check_type,
    p.id,
    p.nama,
    p.status,
    COUNT(pb.business_id) AS business_associations
FROM products p
LEFT JOIN product_businesses pb ON p.id = pb.product_id
WHERE p.id IN (439, 441)
GROUP BY p.id, p.nama, p.status;

-- Check what businesses are trying to link to missing products
SELECT 
    pb.product_id,
    pb.business_id,
    b.name AS business_name,
    b.status AS business_status
FROM product_businesses pb
LEFT JOIN businesses b ON pb.business_id = b.id
WHERE pb.product_id IN (439, 441)
ORDER BY pb.product_id, pb.business_id;

-- ============================================================
-- PART 4: VERIFY SPECIFIC CATEGORY_IDS MENTIONED IN LOGS
-- ============================================================
-- Check if category_ids 1, 2, 3, 6, 12, 14, 15 exist in permission_categories

SELECT 
    'SPECIFIC CATEGORY CHECK' AS check_type,
    pc.id,
    pc.name,
    pc.organization_id,
    o.name AS organization_name
FROM permission_categories pc
LEFT JOIN organizations o ON pc.organization_id = o.id
WHERE pc.id IN (1, 2, 3, 6, 12, 14, 15)
ORDER BY pc.id;

-- Check what permissions reference these missing categories
SELECT 
    perm.id AS permission_id,
    perm.name AS permission_name,
    perm.category_id,
    perm.organization_id,
    perm.status
FROM permissions perm
WHERE perm.category_id IN (1, 2, 3, 6, 12, 14, 15)
ORDER BY perm.category_id, perm.id;

-- ============================================================
-- PART 5: COMPREHENSIVE DATA INTEGRITY CHECK
-- ============================================================

-- All products that should exist based on product_businesses
SELECT DISTINCT
    pb.product_id AS expected_product_id,
    CASE WHEN p.id IS NULL THEN 'MISSING' ELSE 'EXISTS' END AS status,
    p.nama AS product_name,
    COUNT(pb.business_id) AS referenced_by_businesses
FROM product_businesses pb
LEFT JOIN products p ON pb.product_id = p.id
GROUP BY pb.product_id, p.id, p.nama
ORDER BY pb.product_id;

-- All categories that should exist based on permissions
SELECT DISTINCT
    perm.category_id AS expected_category_id,
    CASE WHEN pc.id IS NULL THEN 'MISSING' ELSE 'EXISTS' END AS status,
    pc.name AS category_name,
    COUNT(perm.id) AS referenced_by_permissions
FROM permissions perm
LEFT JOIN permission_categories pc ON perm.category_id = pc.id
WHERE perm.category_id IS NOT NULL
GROUP BY perm.category_id, pc.id, pc.name
ORDER BY perm.category_id;

