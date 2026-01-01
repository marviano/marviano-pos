-- Quick check for product ID 298 "Creamy Milk Bun"
-- Run this first to see the basic information

SELECT 
    p.id,
    p.nama AS product_name,
    p.status,
    c1.name AS category1_name,
    c2.name AS category2_name,
    p.harga_jual AS regular_price,
    p.harga_gofood,
    p.harga_grabfood,
    p.harga_shopeefood,
    -- Check if product meets all conditions to show on kasir page
    CASE 
        WHEN p.status = 'active' AND 
             c1.name = 'Bakery' AND 
             (c2.name LIKE '%Bun%' OR c2.name LIKE '%bun%') AND
             ((p.harga_gofood IS NOT NULL AND p.harga_gofood >= 0) OR
              (p.harga_grabfood IS NOT NULL AND p.harga_grabfood >= 0) OR
              (p.harga_shopeefood IS NOT NULL AND p.harga_shopeefood >= 0))
        THEN '✓ SHOULD APPEAR'
        ELSE '✗ WILL NOT APPEAR'
    END AS visibility_status,
    -- Detailed checks
    CASE WHEN p.status = 'active' THEN '✓' ELSE '✗' END AS is_active,
    CASE WHEN c1.name = 'Bakery' THEN '✓' ELSE '✗' END AS is_bakery,
    CASE WHEN c2.name LIKE '%Bun%' OR c2.name LIKE '%bun%' THEN CONCAT('✓ (', c2.name, ')') ELSE CONCAT('✗ (', IFNULL(c2.name, 'NULL'), ')') END AS category2_match,
    CASE WHEN p.harga_gofood IS NOT NULL AND p.harga_gofood >= 0 THEN '✓' ELSE '✗' END AS has_gofood,
    CASE WHEN p.harga_grabfood IS NOT NULL AND p.harga_grabfood >= 0 THEN '✓' ELSE '✗' END AS has_grabfood,
    CASE WHEN p.harga_shopeefood IS NOT NULL AND p.harga_shopeefood >= 0 THEN '✓' ELSE '✗' END AS has_shopeefood
FROM products p
LEFT JOIN category1 c1 ON p.category1_id = c1.id
LEFT JOIN category2 c2 ON p.category2_id = c2.id
WHERE p.id = 298;

