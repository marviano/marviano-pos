-- LOCAL POS ONLY (localhost). Do NOT run on VPS.
-- Creates kitchen display audit trail table on the register's MySQL.

CREATE TABLE IF NOT EXISTS kds_item_audit_log (
  id BIGINT NOT NULL AUTO_INCREMENT,
  uuid_id CHAR(36) NOT NULL,
  business_id INT NOT NULL,
  uuid_transaction_id VARCHAR(36) NOT NULL,
  uuid_transaction_item_id VARCHAR(36) NOT NULL,
  display_type ENUM('kitchen', 'barista') NOT NULL DEFAULT 'kitchen',
  event_type VARCHAR(50) NOT NULL COMMENT 'active_shown|finished_shown|marked_finished|excluded_cancelled|excluded_category|excluded_no_product',
  product_id INT DEFAULT NULL,
  product_name VARCHAR(255) DEFAULT NULL,
  customer_name VARCHAR(255) DEFAULT NULL,
  table_number VARCHAR(64) DEFAULT NULL,
  detail_json TEXT DEFAULT NULL,
  event_at DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_kds_audit_uuid (uuid_id),
  UNIQUE KEY uk_kds_audit_item_event (uuid_transaction_item_id, display_type, event_type),
  KEY idx_kds_audit_tx (uuid_transaction_id, event_at),
  KEY idx_kds_audit_business_date (business_id, event_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Audit: kitchen/barista display visibility per transaction line (local POS only)';

-- If you created the table with an older script (unicode_ci), fix JOINs with transactions:
-- ALTER TABLE kds_item_audit_log CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
