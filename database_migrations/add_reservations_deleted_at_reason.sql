-- Add archive columns to reservations (soft delete: set deleted_at and reason instead of DELETE).
-- Run this in MySQL Workbench on your database before using the archive feature.

ALTER TABLE reservations
  ADD COLUMN deleted_at DATETIME NULL DEFAULT NULL AFTER updated_at,
  ADD COLUMN deleted_reason TEXT NULL DEFAULT NULL AFTER deleted_at;

-- Optional: index for filtering non-archived (deleted_at IS NULL) in list queries
-- CREATE INDEX idx_reservations_deleted_at ON reservations (deleted_at);
