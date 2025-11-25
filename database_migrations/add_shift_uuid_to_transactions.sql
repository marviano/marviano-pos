-- Migration to add shift_uuid to transactions table
ALTER TABLE transactions
ADD COLUMN shift_uuid CHAR(36) NULL AFTER user_id;

-- Add index for performance
CREATE INDEX idx_transactions_shift_uuid ON transactions(shift_uuid);


