-- Migration: Add Online Payment Methods and Update Transactions Table
-- This migration adds the new online payment methods and updates the transactions table structure

-- Step 1: Insert the new online payment methods into payment_methods table
INSERT INTO payment_methods (name, code, description, is_active, requires_additional_info) VALUES
('GoFood', 'gofood', 'GoFood online delivery platform', 1, 0),
('GrabFood', 'grabfood', 'GrabFood online delivery platform', 1, 0),
('ShopeeFood', 'shopeefood', 'ShopeeFood online delivery platform', 1, 0),
('TikTok', 'tiktok', 'TikTok online delivery platform', 1, 0);

-- Step 2: Add a temporary column to store payment method IDs
ALTER TABLE transactions ADD COLUMN payment_method_id INT DEFAULT NULL COMMENT 'Reference to payment_methods table';

-- Step 3: Update existing transactions to use the new payment_method_id
-- Map existing ENUM values to payment method IDs
UPDATE transactions SET payment_method_id = (SELECT id FROM payment_methods WHERE code = 'cash') WHERE payment_method = 'cash';
UPDATE transactions SET payment_method_id = (SELECT id FROM payment_methods WHERE code = 'debit') WHERE payment_method = 'debit';
UPDATE transactions SET payment_method_id = (SELECT id FROM payment_methods WHERE code = 'qr') WHERE payment_method = 'qr';
UPDATE transactions SET payment_method_id = (SELECT id FROM payment_methods WHERE code = 'ewallet') WHERE payment_method = 'ewallet';
UPDATE transactions SET payment_method_id = (SELECT id FROM payment_methods WHERE code = 'cl') WHERE payment_method = 'cl';
UPDATE transactions SET payment_method_id = (SELECT id FROM payment_methods WHERE code = 'voucher') WHERE payment_method = 'voucher';

-- Step 4: Make payment_method_id NOT NULL and add foreign key constraint
ALTER TABLE transactions MODIFY COLUMN payment_method_id INT NOT NULL;
ALTER TABLE transactions ADD CONSTRAINT fk_transactions_payment_method FOREIGN KEY (payment_method_id) REFERENCES payment_methods(id);

-- Step 5: Drop the old ENUM column (commented out for safety - uncomment when ready)
-- ALTER TABLE transactions DROP COLUMN payment_method;

-- Step 6: Add index for better performance
ALTER TABLE transactions ADD INDEX idx_transactions_payment_method (payment_method_id);

-- Verification queries (run these to check the migration)
-- SELECT * FROM payment_methods WHERE code IN ('gofood', 'grabfood', 'shopeefood', 'tiktok');
-- SELECT payment_method_id, COUNT(*) as count FROM transactions GROUP BY payment_method_id;
