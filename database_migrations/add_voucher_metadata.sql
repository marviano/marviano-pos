-- Add voucher_type column if it does not exist
SET @schema_name := DATABASE();

SET @sql := IF (
  EXISTS (
    SELECT 1
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @schema_name
      AND TABLE_NAME = 'transactions'
      AND COLUMN_NAME = 'voucher_type'
  ),
  'SELECT "voucher_type column already exists" AS info',
  'ALTER TABLE transactions ADD COLUMN voucher_type ENUM(''none'',''percent'',''nominal'',''free'') DEFAULT ''none'' AFTER voucher_discount'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add voucher_value column if it does not exist
SET @sql := IF (
  EXISTS (
    SELECT 1
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @schema_name
      AND TABLE_NAME = 'transactions'
      AND COLUMN_NAME = 'voucher_value'
  ),
  'SELECT "voucher_value column already exists" AS info',
  'ALTER TABLE transactions ADD COLUMN voucher_value DECIMAL(15,2) DEFAULT NULL AFTER voucher_type'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add voucher_label column if it does not exist
SET @sql := IF (
  EXISTS (
    SELECT 1
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @schema_name
      AND TABLE_NAME = 'transactions'
      AND COLUMN_NAME = 'voucher_label'
  ),
  'SELECT "voucher_label column already exists" AS info',
  'ALTER TABLE transactions ADD COLUMN voucher_label VARCHAR(255) DEFAULT NULL AFTER voucher_value'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
