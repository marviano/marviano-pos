SET @schema_name := DATABASE();

SET @sql := IF (
  EXISTS (
    SELECT 1
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @schema_name
      AND TABLE_NAME = 'products'
      AND COLUMN_NAME = 'harga_qpon'
  ),
  'SELECT "harga_qpon column already exists" AS info',
  'ALTER TABLE products ADD COLUMN harga_qpon INT DEFAULT NULL COMMENT ''Price for Qpon platform'' AFTER harga_tiktok'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
