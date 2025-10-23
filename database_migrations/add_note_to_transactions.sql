-- Add note column to transactions table
ALTER TABLE `transactions`
ADD COLUMN `note` TEXT DEFAULT NULL COMMENT 'Additional notes or comments for the transaction'
AFTER `customer_name`;

-- Add index for note column (optional, for search functionality)
ALTER TABLE `transactions`
ADD INDEX `idx_transactions_note` (`note`(100));




