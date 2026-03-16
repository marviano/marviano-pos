-- Replace transactions.table_ids_json with transaction_tables junction table.
-- Run after transactions and restaurant_tables exist.

-- 1. Create junction table
CREATE TABLE IF NOT EXISTS transaction_tables (
  transaction_id INT NOT NULL,
  table_id INT NOT NULL,
  sort_order SMALLINT NOT NULL DEFAULT 0,
  PRIMARY KEY (transaction_id, table_id),
  INDEX idx_transaction_tables_transaction_id (transaction_id),
  INDEX idx_transaction_tables_table_id (table_id),
  CONSTRAINT fk_transaction_tables_transaction FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
  CONSTRAINT fk_transaction_tables_table FOREIGN KEY (table_id) REFERENCES restaurant_tables(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT 'Junction: which tables belong to a transaction (replaces table_ids_json)';

-- 2. Migrate existing table_ids_json into transaction_tables (run in app or manually)
-- INSERT INTO transaction_tables (transaction_id, table_id, sort_order)
-- SELECT t.id, j.tid, j.ord
-- FROM transactions t
-- CROSS JOIN JSON_TABLE(t.table_ids_json, '$[*]' COLUMNS (ord FOR ORDINALITY, tid INT PATH '$')) AS j
-- WHERE t.table_ids_json IS NOT NULL;

-- 3. Drop old column (after data migrated)
-- ALTER TABLE transactions DROP COLUMN table_ids_json;
