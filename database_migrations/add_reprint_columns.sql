-- Add reprint tracking columns to printer audit log tables
-- This migration adds is_reprint and reprint_count columns to support reprint functionality

-- Add columns to printer1_audit_log
ALTER TABLE printer1_audit_log
  ADD COLUMN IF NOT EXISTS is_reprint INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reprint_count INT DEFAULT 0;

-- Add columns to printer2_audit_log
ALTER TABLE printer2_audit_log
  ADD COLUMN IF NOT EXISTS is_reprint INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reprint_count INT DEFAULT 0;

-- Note: IF NOT EXISTS syntax may not work in all MySQL versions
-- If you get an error, use this version instead:
-- ALTER TABLE printer1_audit_log ADD COLUMN is_reprint INT DEFAULT 0;
-- ALTER TABLE printer1_audit_log ADD COLUMN reprint_count INT DEFAULT 0;
-- ALTER TABLE printer2_audit_log ADD COLUMN is_reprint INT DEFAULT 0;
-- ALTER TABLE printer2_audit_log ADD COLUMN reprint_count INT DEFAULT 0;
















