-- Migration: Create transaction_item_removals table
-- Date: 2024
-- Description: Creates audit log table for tracking removal of items from pending transactions
--              Used for security/accountability when cashiers remove items from active orders

-- Create transaction_item_removals table
CREATE TABLE IF NOT EXISTS transaction_item_removals (
  id INT NOT NULL AUTO_INCREMENT,
  transaction_id INT NULL,
  uuid_transaction_id VARCHAR(255) NULL,
  transaction_item_id INT NULL,
  uuid_transaction_item_id VARCHAR(255) NULL,
  user_id INT NOT NULL,
  user_name VARCHAR(255) NOT NULL,
  removed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  table_id INT NULL,
  table_number VARCHAR(255) NULL,
  room_name VARCHAR(255) NULL,
  product_id INT NOT NULL,
  product_name VARCHAR(255) NOT NULL,
  quantity_removed INT NOT NULL,
  unit_price DECIMAL(15,2) NOT NULL,
  total_price DECIMAL(15,2) NOT NULL,
  customizations_json TEXT NULL,
  custom_note TEXT NULL,
  bundle_selections_json TEXT NULL,
  PRIMARY KEY (id),
  KEY idx_transaction (uuid_transaction_id),
  KEY idx_transaction_item (transaction_item_id),
  KEY idx_user (user_id),
  KEY idx_removed_at (removed_at),
  KEY idx_table (table_id),
  CONSTRAINT fk_tir_transaction FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE SET NULL,
  CONSTRAINT fk_tir_transaction_item FOREIGN KEY (transaction_item_id) REFERENCES transaction_items(id) ON DELETE SET NULL,
  CONSTRAINT fk_tir_table FOREIGN KEY (table_id) REFERENCES restaurant_tables(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;




