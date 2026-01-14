-- Migration: Remove branch_name column from receipt_settings
-- Use store_name instead of branch_name everywhere

ALTER TABLE receipt_settings 
DROP COLUMN branch_name;
