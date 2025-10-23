-- Add receipt_number and transaction_type fields to transactions table
-- This migration adds support for dual-tab POS system (Drinks/Bakery)

-- Add receipt_number field (daily reset counter)
ALTER TABLE `transactions`
ADD COLUMN `receipt_number` INT DEFAULT NULL COMMENT 'Daily receipt number, resets each day'
AFTER `bank_id`;

-- Add transaction_type field (drinks or bakery)
ALTER TABLE `transactions`
ADD COLUMN `transaction_type` ENUM('drinks', 'bakery') DEFAULT 'drinks' COMMENT 'Type of transaction: drinks or bakery'
AFTER `receipt_number`;

-- Add indexes for better performance
ALTER TABLE `transactions`
ADD INDEX `idx_transactions_receipt_number` (`receipt_number`);

ALTER TABLE `transactions`
ADD INDEX `idx_transactions_transaction_type` (`transaction_type`);

-- Add composite index for daily receipt numbering queries
ALTER TABLE `transactions`
ADD INDEX `idx_transactions_daily_receipt` (`business_id`, `created_at`, `receipt_number`);



