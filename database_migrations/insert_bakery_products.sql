-- Insert Bakery Products for Momoyo Bakery Kalimantan (business_id = 14)
-- This script adds bakery products with their variants (customizations)

-- 1. Donut Crumb with 3 variants: strawberry, mango, chocolate
INSERT INTO products (
  business_id, menu_code, nama, satuan, kategori, jenis, 
  keterangan, harga_jual, status, has_customization, created_at, updated_at
) VALUES (
  14, 'DC001', 'Donut Crumb', 'pcs', 'bakery', 'Donut',
  'Delicious crumb donut with various flavors', 15000, 'active', 1, NOW(), NOW()
);

-- Get the product ID for Donut Crumb (we'll need this for customizations)
SET @donut_crumb_id = LAST_INSERT_ID();

-- Create customization type for Donut Crumb variants
INSERT INTO product_customization_types (name, selection_mode, display_order) 
VALUES ('Flavor', 'single', 1);

SET @flavor_type_id = LAST_INSERT_ID();

-- Link Donut Crumb to Flavor customization
INSERT INTO product_customizations (product_id, customization_type_id) 
VALUES (@donut_crumb_id, @flavor_type_id);

-- Add flavor options for Donut Crumb
INSERT INTO product_customization_options (type_id, name, price_adjustment, display_order, status) VALUES
(@flavor_type_id, 'Strawberry', 0, 1, 'active'),
(@flavor_type_id, 'Mango', 0, 2, 'active'),
(@flavor_type_id, 'Chocolate', 0, 3, 'active');

-- 2. Momo Cheese Toast
INSERT INTO products (
  business_id, menu_code, nama, satuan, kategori, jenis, 
  keterangan, harga_jual, status, has_customization, created_at, updated_at
) VALUES (
  14, 'MCT001', 'Momo Cheese Toast', 'pcs', 'bakery', 'Toast',
  'Crispy toast with melted cheese', 12000, 'active', 0, NOW(), NOW()
);

-- 3. Creamy Milk Bun
INSERT INTO products (
  business_id, menu_code, nama, satuan, kategori, jenis, 
  keterangan, harga_jual, status, has_customization, created_at, updated_at
) VALUES (
  14, 'CMB001', 'Creamy Milk Bun', 'pcs', 'bakery', 'Bun',
  'Soft bun filled with creamy milk', 10000, 'active', 0, NOW(), NOW()
);

-- Verify the inserted products
SELECT 
  id, menu_code, nama, kategori, jenis, harga_jual, has_customization
FROM products 
WHERE business_id = 14 AND kategori = 'bakery'
ORDER BY id DESC;



