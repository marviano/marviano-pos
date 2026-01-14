-- Migration: Add template_name and is_default to receipt_templates
-- This allows multiple named templates and template selection

-- Add template_name column
ALTER TABLE receipt_templates 
ADD COLUMN template_name VARCHAR(255) DEFAULT NULL COMMENT 'Template name (e.g., "MOMOYO Receipt", "MOMOYO Bill")' AFTER template_type;

-- Add is_default column to mark which template is active for each type
ALTER TABLE receipt_templates 
ADD COLUMN is_default TINYINT(1) DEFAULT 0 COMMENT 'Whether this template is the default/active template for its type' AFTER is_active;

-- Update unique constraint to allow multiple templates per type (with different names)
-- Note: MySQL doesn't support partial unique indexes, so we'll handle this in application logic
-- Remove old unique constraint if it exists (may fail if doesn't exist, that's ok)
SET @sql = 'ALTER TABLE receipt_templates DROP INDEX unique_template_type_business';
SET @sql = IF((SELECT COUNT(*) FROM information_schema.STATISTICS 
  WHERE table_schema = DATABASE() 
  AND table_name = 'receipt_templates' 
  AND index_name = 'unique_template_type_business') > 0, 
  @sql, 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add index for template name lookup
ALTER TABLE receipt_templates 
ADD KEY idx_receipt_templates_name (template_name);

-- Update template_type (keep only receipt and bill)
ALTER TABLE receipt_templates 
MODIFY COLUMN template_type ENUM('receipt', 'bill') NOT NULL COMMENT 'Type of template: receipt (paid transaction) or bill (unpaid order)';
