-- =============================================================================
-- Run this once in MySQL Workbench. Safe to re-run (idempotent).
-- Last updated: 2025-03-13
-- =============================================================================
-- Requires: MySQL 8.0.3+ for ADD COLUMN IF NOT EXISTS; MySQL 8.0.29+ for DROP COLUMN IF EXISTS.
-- If you use MySQL 5.7, see comments in Section 2 and Section 5 for alternatives.
-- =============================================================================

-- ===== SECTION 1: reservations table =====
-- Full definition matching electron/mysqlSchema.ts including reservation feature columns.

CREATE TABLE IF NOT EXISTS reservations (
  id INT NOT NULL AUTO_INCREMENT,
  uuid_id VARCHAR(36) NOT NULL,
  business_id INT NOT NULL,
  nama VARCHAR(255) NOT NULL,
  phone VARCHAR(30) NOT NULL,
  tanggal DATE NOT NULL,
  jam TIME NOT NULL,
  pax INT NOT NULL DEFAULT 1,
  dp DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  total_price DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  table_ids_json JSON DEFAULT NULL,
  penanggung_jawab_id INT DEFAULT NULL,
  created_by_email VARCHAR(255) DEFAULT NULL,
  note TEXT DEFAULT NULL,
  status ENUM('upcoming','attended','cancelled') NOT NULL DEFAULT 'upcoming',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL DEFAULT NULL,
  deleted_reason TEXT NULL DEFAULT NULL,
  items_json JSON DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uuid_id (uuid_id),
  INDEX idx_reservations_business (business_id),
  INDEX idx_reservations_tanggal (tanggal),
  INDEX idx_reservations_status (status),
  CONSTRAINT fk_reservations_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  CONSTRAINT fk_reservations_pj FOREIGN KEY (penanggung_jawab_id) REFERENCES employees(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ===== SECTION 2: reservations column additions (for existing DBs) =====
-- Add columns if missing. ADD COLUMN IF NOT EXISTS requires MySQL 8.0.3+.
-- On MySQL 5.7: run each ALTER separately and ignore "Duplicate column" errors.

ALTER TABLE reservations ADD COLUMN IF NOT EXISTS deleted_at DATETIME NULL DEFAULT NULL AFTER updated_at;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS deleted_reason TEXT NULL DEFAULT NULL AFTER deleted_at;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS created_by_email VARCHAR(255) DEFAULT NULL AFTER penanggung_jawab_id;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS items_json JSON DEFAULT NULL AFTER deleted_reason;

-- ENUM fix: map legacy 'done' to 'attended' and ensure status ENUM is correct.
UPDATE reservations SET status = 'attended' WHERE status = 'done';
ALTER TABLE reservations MODIFY COLUMN status ENUM('upcoming','attended','cancelled') NOT NULL DEFAULT 'upcoming';

-- ===== SECTION 3: transaction_tables junction table (create if not exists) =====

CREATE TABLE IF NOT EXISTS transaction_tables (
  transaction_id INT NOT NULL,
  table_id INT NOT NULL,
  sort_order SMALLINT NOT NULL DEFAULT 0,
  PRIMARY KEY (transaction_id, table_id),
  INDEX idx_transaction_tables_transaction_id (transaction_id),
  INDEX idx_transaction_tables_table_id (table_id),
  CONSTRAINT fk_transaction_tables_transaction
    FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
  CONSTRAINT fk_transaction_tables_table
    FOREIGN KEY (table_id) REFERENCES restaurant_tables(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ===== SECTION 4: Backfill transaction_tables from transactions.table_id =====
-- For existing transactions that have table_id set but no row in transaction_tables yet.

INSERT IGNORE INTO transaction_tables (transaction_id, table_id, sort_order)
SELECT id, table_id, 0
FROM transactions
WHERE table_id IS NOT NULL;

-- ===== SECTION 5: Drop transactions.table_ids_json (if it exists) =====
-- MySQL 8.0.29+: DROP COLUMN IF EXISTS. On MySQL 5.7, use: ALTER TABLE transactions DROP COLUMN table_ids_json;
-- (On 5.7, that will error if the column does not exist — safe to ignore that error.)

ALTER TABLE transactions DROP COLUMN IF EXISTS table_ids_json;
