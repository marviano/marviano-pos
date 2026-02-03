-- Per-item waiter: who added each line item (for multiple waiters per transaction / achievement).
-- Run this on your main MySQL DB (e.g. salespulse) if transaction_items already exists.

-- Add column
ALTER TABLE transaction_items
  ADD COLUMN waiter_id INT DEFAULT NULL
  COMMENT 'Employee who added this line item (for per-waiter achievement)'
  AFTER created_at;

-- Index for reports / "items added by waiter"
ALTER TABLE transaction_items
  ADD INDEX idx_transaction_items_waiter (waiter_id);

-- Optional: FK to employees (uncomment if your DB has employees table)
-- ALTER TABLE transaction_items
--   ADD CONSTRAINT fk_transaction_items_waiter
--   FOREIGN KEY (waiter_id) REFERENCES employees(id) ON DELETE SET NULL;
