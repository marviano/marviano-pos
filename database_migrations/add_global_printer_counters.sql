-- Add global counter tracking for printer audit logs
ALTER TABLE printer1_audit_log
  ADD COLUMN global_counter INT NULL;

ALTER TABLE printer2_audit_log
  ADD COLUMN global_counter INT NULL;

