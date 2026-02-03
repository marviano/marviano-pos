-- Add show_notes to receipt_templates (default 0 = do not show note/customization on receipt/bill)
-- Run once; ignore error if column already exists.
ALTER TABLE receipt_templates
ADD COLUMN show_notes TINYINT(1) DEFAULT 0 COMMENT '1 = show item note/customization on print, 0 = hide';
