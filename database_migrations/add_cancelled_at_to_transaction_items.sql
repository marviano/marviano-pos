-- Add cancelled_at timestamp to transaction_items table
ALTER TABLE transaction_items
  ADD COLUMN cancelled_at TIMESTAMP NULL DEFAULT NULL
  COMMENT 'When this item was cancelled (NULL if not cancelled)'
  AFTER production_finished_at;

-- Add index for cancelled items queries
ALTER TABLE transaction_items
  ADD INDEX idx_transaction_items_cancelled_at (cancelled_at);
