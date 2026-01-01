-- Comprehensive query to check if product ID 298 "Creamy Milk Bun" exists and is configured correctly
-- This checks all conditions needed for it to appear on the kasir page

-- 1. Basic product information
SELECT 
    p.id,
    p.menu_code,
    p.nama,
    p.status,
    p.category1_id,
    c1.name AS category1_name,
    p.category2_id,
    c2.name AS category2_name,
    p.harga_jual AS regular_price,
    p.harga_gofood,
    p.harga_grabfood,
    p.harga_shopeefood,
    p.harga_qpon,
    p.harga_tiktok,
    p.harga_online,
    p.created_at,
    p.updated_at
FROM products p
LEFT JOIN category1 c1 ON p.category1_id = c1.id
LEFT JOIN category2 c2 ON p.category2_id = c2.id
WHERE p.id = 298;

-- 2. Check business associations (product_businesses junction table)
SELECT 
    pb.product_id,
    pb.business_id,
    b.name AS business_name,
    b.status AS business_status
FROM product_businesses pb
LEFT JOIN businesses b ON pb.business_id = b.id
WHERE pb.product_id = 298;

-- 3. Check if product would appear when filtering by "Sweet Bun" category2
-- (Note: User mentioned "soft bun" - check if category2 name matches exactly)
SELECT 
    p.id,
    p.nama,
    c2.name AS category2_name,
    c1.name AS category1_name,
    p.status,
    p.harga_gofood,
    p.harga_grabfood,
    p.harga_shopeefood,
    CASE 
        WHEN p.status = 'active' THEN '✓ Active'
        ELSE '✗ Inactive'
    END AS status_check,
    CASE 
        WHEN c1.name = 'Bakery' THEN '✓ Correct Category I'
        ELSE '✗ Wrong Category I'
    END AS category1_check,
    CASE 
        WHEN c2.name LIKE '%Bun%' OR c2.name LIKE '%bun%' THEN '✓ Category II contains "Bun"'
        ELSE '✗ Category II does not contain "Bun"'
    END AS category2_check,
    CASE 
        WHEN p.harga_gofood IS NOT NULL AND p.harga_gofood >= 0 THEN '✓ Has GoFood price'
        ELSE '✗ Missing GoFood price'
    END AS gofood_check,
    CASE 
        WHEN p.harga_grabfood IS NOT NULL AND p.harga_grabfood >= 0 THEN '✓ Has GrabFood price'
        ELSE '✗ Missing GrabFood price'
    END AS grabfood_check,
    CASE 
        WHEN p.harga_shopeefood IS NOT NULL AND p.harga_shopeefood >= 0 THEN '✓ Has ShopeeFood price'
        ELSE '✗ Missing ShopeeFood price'
    END AS shopeefood_check
FROM products p
LEFT JOIN category2 c2 ON p.category2_id = c2.id
LEFT JOIN category1 c1 ON p.category1_id = c1.id
WHERE p.id = 298;

-- 4. Find all category2 names that contain "bun" (case-insensitive)
-- This helps identify if the category name is "Sweet Bun", "soft bun", or something else
SELECT 
    c2.id,
    c2.name AS category2_name,
    c2.is_active,
    COUNT(p.id) AS product_count
FROM category2 c2
LEFT JOIN products p ON c2.id = p.category2_id AND p.status = 'active'
WHERE c2.name LIKE '%bun%' OR c2.name LIKE '%Bun%'
GROUP BY c2.id, c2.name, c2.is_active
ORDER BY c2.name;

-- 5. Check all products in the same category2 as product 298
-- This helps verify if other products in the same category are showing up
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
WHERE p.category2_id = (SELECT category2_id FROM products WHERE id = 298)
ORDER BY p.nama;

-- 6. Simulate the exact query used by the kasir page for "Sweet Bun" category
-- Replace 'Sweet Bun' with the actual category2 name you're using on the kasir page
SELECT 
    p.id,
    p.menu_code,
    p.nama,
    p.satuan,
    c2.name AS category2_name,
    c1.name AS category1_name,
    p.keterangan,
    p.harga_beli,
    p.ppn,
    p.harga_jual,
    p.harga_khusus,
    p.harga_online,
    p.harga_qpon,
    p.harga_gofood,
    p.harga_grabfood,
    p.harga_shopeefood,
    p.harga_tiktok,
    p.fee_kerja,
    p.image_url,
    p.status,
    p.has_customization,
    p.is_bundle
FROM products p
LEFT JOIN category2 c2 ON p.category2_id = c2.id
LEFT JOIN category1 c1 ON p.category1_id = c1.id
WHERE c2.name = 'Sweet Bun'  -- Change this to match the exact category name you're using
  AND p.status = 'active'
  AND c1.name = 'Bakery'  -- Filter for bakery products only
ORDER BY p.nama ASC;

-- 7. Check if product 298 would appear with online platform filters
-- This simulates the filtering logic in offlineDataFetcher.ts lines 136-145
SELECT 
    p.id,
    p.nama,
    c2.name AS category2_name,
    c1.name AS category1_name,
    p.harga_gofood,
    p.harga_grabfood,
    p.harga_shopeefood,
    CASE 
        WHEN p.harga_gofood IS NOT NULL AND p.harga_gofood >= 0 THEN 'YES' 
        ELSE 'NO' 
    END AS would_show_gofood,
    CASE 
        WHEN p.harga_grabfood IS NOT NULL AND p.harga_grabfood >= 0 THEN 'YES' 
        ELSE 'NO' 
    END AS would_show_grabfood,
    CASE 
        WHEN p.harga_shopeefood IS NOT NULL AND p.harga_shopeefood >= 0 THEN 'YES' 
        ELSE 'NO' 
    END AS would_show_shopeefood
FROM products p
LEFT JOIN category2 c2 ON p.category2_id = c2.id
LEFT JOIN category1 c1 ON p.category1_id = c1.id
WHERE p.id = 298
  AND p.status = 'active'
  AND c1.name = 'Bakery';

