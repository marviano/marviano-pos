-- Add customer_unit column to transactions table if it does not exist
SET @schema_name := DATABASE();

SET @sql := IF (
  EXISTS (
    SELECT 1
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @schema_name
      AND TABLE_NAME = 'transactions'
      AND COLUMN_NAME = 'customer_unit'
  ),
  'SELECT "customer_unit column already exists" AS info',
  'ALTER TABLE transactions ADD COLUMN customer_unit INT DEFAULT NULL COMMENT ''Number of customers in the party'' AFTER customer_name'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;







