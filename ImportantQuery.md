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

---

## Transactions in system_pos but NOT in Salespulse (Printer 2)

```sql
SELECT
  sp.uuid_id           AS transaction_id,
  sp.receipt_number,
  sp.created_at        AS system_pos_created_at,
  sp.final_amount,
  sp.status            AS system_pos_status
FROM system_pos.transactions sp
WHERE sp.status != 'archived' AND sp.business_id = 4
AND sp.uuid_id NOT IN (
  SELECT p2.transaction_id
  FROM salespulse.printer2_audit_log p2
  INNER JOIN salespulse.transactions t ON t.uuid_id = p2.transaction_id AND t.business_id = 4
)
ORDER BY sp.created_at DESC;
```

---

## Side‑by‑side summary: Salespulse (Printer 2) vs system_pos

Use the same date range for both sides (adjust `@from` / `@to` or remove the date filter for all time). Explains differences in **Txs/CU**, **Gross**, **Refund**, **Net** like in Daftar Transaksi. If `salespulse.transaction_refunds` does not exist, use only `t.refund_total` and drop the refund subquery for salespulse.

```sql
-- Optional: restrict to a date range (uncomment and set to compare same period)
-- SET @from = '2025-02-01 00:00:00';
-- SET @to   = '2025-02-13 23:59:59';

-- Salespulse (transactions that have a printer2_audit_log entry)
WITH salespulse_tx AS (
  SELECT
    t.uuid_id,
    t.final_amount,
    t.payment_method,
    t.pickup_method,
    COALESCE(r.total_refund, t.refund_total, 0) AS refund_total,
    COALESCE(t.customer_unit, 0) AS customer_unit
  FROM salespulse.printer2_audit_log p2
  INNER JOIN salespulse.transactions t ON t.uuid_id = p2.transaction_id AND t.business_id = 4
  LEFT JOIN (
    SELECT transaction_uuid, SUM(refund_amount) AS total_refund
    FROM salespulse.transaction_refunds
    WHERE status IN ('pending', 'completed')
    GROUP BY transaction_uuid
  ) r ON t.uuid_id = r.transaction_uuid
  -- AND (t.created_at BETWEEN @from AND @to)   -- uncomment if using @from/@to
),
system_pos_tx AS (
  SELECT
    sp.uuid_id,
    sp.final_amount,
    sp.payment_method,
    sp.pickup_method,
    COALESCE(r.total_refund, sp.refund_total, 0) AS refund_total,
    COALESCE(sp.customer_unit, 0) AS customer_unit
  FROM system_pos.transactions sp
  LEFT JOIN (
    SELECT transaction_uuid, SUM(refund_amount) AS total_refund
    FROM system_pos.transaction_refunds
    WHERE status IN ('pending', 'completed')
    GROUP BY transaction_uuid
  ) r ON sp.uuid_id = r.transaction_uuid
  WHERE sp.status != 'archived' AND sp.business_id = 4
  -- AND (sp.created_at BETWEEN @from AND @to)   -- uncomment if using @from/@to
)
SELECT
  'Salespulse (Printer 2)' AS source,
  COUNT(*) AS txs,
  COALESCE(SUM(customer_unit), 0) AS cu,
  COALESCE(SUM(final_amount), 0) AS gross,
  COALESCE(SUM(refund_total), 0) AS refund,
  COALESCE(SUM(final_amount), 0) - COALESCE(SUM(refund_total), 0) AS net
FROM salespulse_tx
UNION ALL
SELECT
  'system_pos' AS source,
  COUNT(*) AS txs,
  COALESCE(SUM(customer_unit), 0) AS cu,
  COALESCE(SUM(final_amount), 0) AS gross,
  COALESCE(SUM(refund_total), 0) AS refund,
  COALESCE(SUM(final_amount), 0) - COALESCE(SUM(refund_total), 0) AS net
FROM system_pos_tx;
```

---

## Payment method & pickup breakdown (Salespulse vs system_pos)

Same date logic as above; compare Metode Pembayaran and Metode Pengambilan.

```sql
WITH salespulse_tx AS (
  SELECT
    t.uuid_id,
    t.final_amount,
    LOWER(TRIM(t.payment_method)) AS payment_method,
    LOWER(TRIM(t.pickup_method)) AS pickup_method,
    COALESCE(r.total_refund, t.refund_total, 0) AS refund_total
  FROM salespulse.printer2_audit_log p2
  INNER JOIN salespulse.transactions t ON t.uuid_id = p2.transaction_id AND t.business_id = 4
  LEFT JOIN (
    SELECT transaction_uuid, SUM(refund_amount) AS total_refund
    FROM salespulse.transaction_refunds
    WHERE status IN ('pending', 'completed')
    GROUP BY transaction_uuid
  ) r ON t.uuid_id = r.transaction_uuid
),
system_pos_tx AS (
  SELECT
    sp.uuid_id,
    sp.final_amount,
    LOWER(TRIM(sp.payment_method)) AS payment_method,
    LOWER(TRIM(sp.pickup_method)) AS pickup_method,
    COALESCE(r.total_refund, sp.refund_total, 0) AS refund_total
  FROM system_pos.transactions sp
  LEFT JOIN (
    SELECT transaction_uuid, SUM(refund_amount) AS total_refund
    FROM system_pos.transaction_refunds
    WHERE status IN ('pending', 'completed')
    GROUP BY transaction_uuid
  ) r ON sp.uuid_id = r.transaction_uuid
  WHERE sp.status != 'archived' AND sp.business_id = 4
),
agg AS (
  SELECT 'Salespulse' AS source, payment_method, pickup_method,
         COUNT(*) AS cnt, SUM(final_amount) AS amount, SUM(refund_total) AS refund
  FROM salespulse_tx
  GROUP BY source, payment_method, pickup_method
  UNION ALL
  SELECT 'system_pos', payment_method, pickup_method,
         COUNT(*), SUM(final_amount), SUM(refund_total)
  FROM system_pos_tx
  GROUP BY source, payment_method, pickup_method
)
SELECT source, payment_method, pickup_method, cnt, amount, refund
FROM agg
ORDER BY source, payment_method, pickup_method;
```

---

## Quick count difference (by date)

Daily count of Salespulse (Printer 2) vs system_pos to spot which dates diverge.

```sql
SELECT
  d.date,
  COALESCE(p.printer2_count, 0) AS salespulse_txs,
  COALESCE(s.system_pos_count, 0) AS system_pos_txs,
  COALESCE(p.printer2_count, 0) - COALESCE(s.system_pos_count, 0) AS diff
FROM (
  SELECT DATE(p2.printed_at) AS date
  FROM salespulse.printer2_audit_log p2
  INNER JOIN salespulse.transactions t ON t.uuid_id = p2.transaction_id AND t.business_id = 4
  UNION
  SELECT DATE(created_at) FROM system_pos.transactions
  WHERE status != 'archived' AND business_id = 4
) d
LEFT JOIN (
  SELECT DATE(p2.printed_at) AS dt, COUNT(DISTINCT p2.transaction_id) AS printer2_count
  FROM salespulse.printer2_audit_log p2
  INNER JOIN salespulse.transactions t ON t.uuid_id = p2.transaction_id AND t.business_id = 4
  GROUP BY DATE(p2.printed_at)
) p ON d.date = p.dt
LEFT JOIN (
  SELECT DATE(created_at) AS dt, COUNT(*) AS system_pos_count
  FROM system_pos.transactions
  WHERE status != 'archived' AND business_id = 4
  GROUP BY DATE(created_at)
) s ON d.date = s.dt
ORDER BY d.date DESC;
```

