-- =====================================================
-- Normalize Customizations Migration for SQLite
-- Converts customizations_json to normalized relational tables
-- This enables proper analytics and querying
-- =====================================================

-- =====================================================
-- 1. CREATE NORMALIZED TABLES
-- =====================================================

-- Table: transaction_item_customizations
-- Links transaction items to customization types
CREATE TABLE IF NOT EXISTS transaction_item_customizations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_item_id TEXT NOT NULL,  -- UUID reference to transaction_items.id
  customization_type_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (customization_type_id) REFERENCES product_customization_types(id) ON DELETE CASCADE
);

-- Table: transaction_item_customization_options
-- Stores selected customization options with price adjustments
CREATE TABLE IF NOT EXISTS transaction_item_customization_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_item_customization_id INTEGER NOT NULL,
  customization_option_id INTEGER NOT NULL,
  option_name TEXT NOT NULL,  -- Snapshot of option name at time of sale
  price_adjustment REAL NOT NULL DEFAULT 0.0,  -- Snapshot of price adjustment at time of sale
  created_at TEXT NOT NULL,
  FOREIGN KEY (transaction_item_customization_id) REFERENCES transaction_item_customizations(id) ON DELETE CASCADE,
  FOREIGN KEY (customization_option_id) REFERENCES product_customization_options(id) ON DELETE CASCADE
);

-- =====================================================
-- 2. CREATE INDEXES FOR PERFORMANCE
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_tic_transaction_item ON transaction_item_customizations(transaction_item_id);
CREATE INDEX IF NOT EXISTS idx_tic_customization_type ON transaction_item_customizations(customization_type_id);
CREATE INDEX IF NOT EXISTS idx_tic_item_type ON transaction_item_customizations(transaction_item_id, customization_type_id);

CREATE INDEX IF NOT EXISTS idx_tico_transaction_item_customization ON transaction_item_customization_options(transaction_item_customization_id);
CREATE INDEX IF NOT EXISTS idx_tico_customization_option ON transaction_item_customization_options(customization_option_id);
CREATE INDEX IF NOT EXISTS idx_tico_customization_option_composite ON transaction_item_customization_options(transaction_item_customization_id, customization_option_id);

-- Note: Data migration from JSON will be handled by the application code
-- to ensure proper JSON parsing and error handling


