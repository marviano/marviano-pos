-- Fix: Product name cut off at 30 chars on Barista/Kitchen display
-- Root cause (from runtime logs): orderItem.product_name is exactly 30 chars
-- because products.nama in the DB was limited (e.g. VARCHAR(30)).
-- This migration ensures products.nama can store full names.

-- Run on the MySQL database the POS uses (getDbConfig / salespulse).
-- If nama is already VARCHAR(255), this is a no-op for length;
-- if it was VARCHAR(30), it will now allow up to 255 characters.

ALTER TABLE products
  MODIFY COLUMN nama VARCHAR(255) CHARACTER SET utf8mb4 NOT NULL;
