# Daily comparison: SalesPulse Printer 2 vs system_pos

```sql
SELECT
  d.date,
  COALESCE(p.printer2_count, 0) AS salespulse_printer2_transaction_count,
  COALESCE(s.system_pos_count, 0) AS system_pos_transaction_count
FROM (
  SELECT DATE(p2.printed_at) AS date
  FROM salespulse.printer2_audit_log p2
  INNER JOIN salespulse.transactions t ON t.uuid_id = p2.transaction_id AND t.business_id = 4
  UNION
  SELECT DATE(created_at)
  FROM system_pos.transactions
  WHERE status != 'archived' AND business_id = 4
) d
LEFT JOIN (
  SELECT
    DATE(p2.printed_at) AS dt,
    COUNT(DISTINCT p2.transaction_id) AS printer2_count
  FROM salespulse.printer2_audit_log p2
  INNER JOIN salespulse.transactions t ON t.uuid_id = p2.transaction_id AND t.business_id = 4
  GROUP BY DATE(p2.printed_at)
) p ON d.date = p.dt
LEFT JOIN (
  SELECT
    DATE(created_at) AS dt,
    COUNT(*) AS system_pos_count
  FROM system_pos.transactions
  WHERE status != 'archived' AND business_id = 4
  GROUP BY DATE(created_at)
) s ON d.date = s.dt
ORDER BY d.date DESC;
```

---

## Transactions in Printer 2 audit but NOT in system_pos

```sql
SELECT
  t.uuid_id           AS transaction_id,
  t.receipt_number,
  t.created_at        AS salespulse_created_at,
  p2.printed_at       AS printer2_printed_at,
  t.final_amount,
  t.status            AS salespulse_status
FROM salespulse.printer2_audit_log p2
INNER JOIN salespulse.transactions t ON t.uuid_id = p2.transaction_id AND t.business_id = 4
LEFT JOIN system_pos.transactions sp ON sp.uuid_id = p2.transaction_id
WHERE sp.uuid_id IS NULL
ORDER BY p2.printed_at DESC;
```

