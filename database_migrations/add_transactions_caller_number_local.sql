-- LOCAL POS ONLY. Run if you see: Unknown column 't.caller_number' in 'field list'

ALTER TABLE transactions
  ADD COLUMN caller_number INT DEFAULT NULL
  COMMENT 'Wireless caller/pager number (1-50)'
  AFTER customer_unit;
