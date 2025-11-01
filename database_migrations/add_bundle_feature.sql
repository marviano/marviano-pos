-- MySQL Migration for Bundle Feature
-- This adds support for bundle products that allow customers to select items from multiple categories

-- Step 1: Add is_bundle flag to products table
ALTER TABLE products ADD COLUMN is_bundle TINYINT(1) DEFAULT 0 COMMENT 'Whether this product is a bundle';

-- Step 2: Create bundle_items table to define bundle structure
CREATE TABLE IF NOT EXISTS bundle_items (
  id INT NOT NULL AUTO_INCREMENT,
  bundle_product_id INT NOT NULL COMMENT 'Reference to products.id that is a bundle',
  category2_id INT NOT NULL COMMENT 'Category from which products can be selected',
  required_quantity INT NOT NULL DEFAULT 1 COMMENT 'How many items must be selected from this category',
  display_order INT DEFAULT 0 COMMENT 'Order in which this section appears in the bundle selection UI',
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bundle_product (bundle_product_id),
  KEY idx_category2 (category2_id),
  CONSTRAINT fk_bundle_items_product FOREIGN KEY (bundle_product_id) REFERENCES products(id) ON DELETE CASCADE,
  CONSTRAINT fk_bundle_items_category2 FOREIGN KEY (category2_id) REFERENCES category2(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Defines the structure of bundle products';

-- Step 3: Add bundle_selections_json column to transaction_items to store selected bundle items
ALTER TABLE transaction_items ADD COLUMN bundle_selections_json JSON DEFAULT NULL COMMENT 'JSON array storing selected products for bundle items';

