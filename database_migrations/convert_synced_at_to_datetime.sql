-- Migration: Convert synced_at from BIGINT to DATETIME in transactions table
-- Date: 2025-01-XX
-- Description: Converts synced_at column from BIGINT (Unix timestamp in milliseconds) to DATETIME
--
-- IMPORTANT: Run this on the 'salespulse' database
-- This migration:
-- 1. Converts existing BIGINT values (milliseconds) to DATETIME format
-- 2. Changes the column type from BIGINT to DATETIME
--
-- NOTE: This assumes synced_at values are Unix timestamps in milliseconds
-- If synced_at is NULL, it remains NULL

USE salespulse;

-- Step 1: Convert existing BIGINT values to DATETIME
-- Convert milliseconds to DATETIME: FROM_UNIXTIME converts seconds, so divide by 1000
-- Then add 7 hours for UTC+7 (WIB - Western Indonesian Time)
UPDATE transactions 
SET synced_at = DATE_ADD(FROM_UNIXTIME(synced_at / 1000), INTERVAL 7 HOUR)
WHERE synced_at IS NOT NULL;

-- Step 2: Change column type from BIGINT to DATETIME
ALTER TABLE transactions 
MODIFY COLUMN synced_at DATETIME DEFAULT NULL;

-- Verify the change
SELECT 
  COLUMN_NAME, 
  DATA_TYPE, 
  IS_NULLABLE, 
  COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_SCHEMA = 'salespulse' 
  AND TABLE_NAME = 'transactions' 
  AND COLUMN_NAME = 'synced_at';





