-- LOCAL POS ONLY. Run once if JOIN with transactions fails:
-- Error 1267: Illegal mix of collations (utf8mb4_0900_ai_ci) and (utf8mb4_unicode_ci)

ALTER TABLE kds_item_audit_log
  CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
