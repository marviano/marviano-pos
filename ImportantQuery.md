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
    -- Subtract cancelled items from final_amount
    (t.final_amount - COALESCE(cancelled.total_cancelled, 0)) AS final_amount,
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
  LEFT JOIN (
    SELECT uuid_transaction_id, SUM(total_price) AS total_cancelled
    FROM salespulse.transaction_items
    WHERE production_status = 'cancelled'
    GROUP BY uuid_transaction_id
  ) cancelled ON t.uuid_id = cancelled.uuid_transaction_id
  -- AND (t.created_at BETWEEN @from AND @to)   -- uncomment if using @from/@to
),
system_pos_tx AS (
  SELECT
    sp.uuid_id,
    -- Subtract cancelled items from final_amount
    (sp.final_amount - COALESCE(cancelled.total_cancelled, 0)) AS final_amount,
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
  LEFT JOIN (
    SELECT uuid_transaction_id, SUM(total_price) AS total_cancelled
    FROM system_pos.transaction_items
    WHERE production_status = 'cancelled'
    GROUP BY uuid_transaction_id
  ) cancelled ON sp.uuid_id = cancelled.uuid_transaction_id
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
    -- Subtract cancelled items from final_amount
    (t.final_amount - COALESCE(cancelled.total_cancelled, 0)) AS final_amount,
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
  LEFT JOIN (
    SELECT uuid_transaction_id, SUM(total_price) AS total_cancelled
    FROM salespulse.transaction_items
    WHERE production_status = 'cancelled'
    GROUP BY uuid_transaction_id
  ) cancelled ON t.uuid_id = cancelled.uuid_transaction_id
),
system_pos_tx AS (
  SELECT
    sp.uuid_id,
    -- Subtract cancelled items from final_amount
    (sp.final_amount - COALESCE(cancelled.total_cancelled, 0)) AS final_amount,
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
  LEFT JOIN (
    SELECT uuid_transaction_id, SUM(total_price) AS total_cancelled
    FROM system_pos.transaction_items
    WHERE production_status = 'cancelled'
    GROUP BY uuid_transaction_id
  ) cancelled ON sp.uuid_id = cancelled.uuid_transaction_id
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
Daily count of Salespulse (Printer 2) vs system_pos to spot which dates diverge. Set `@from_date` and `@to_date` to restrict to a range (e.g. 1 Feb 2026–28 Feb 2026); for all dates, comment out the date filters and the `WHERE` line below.

```sql
SET @from_date = '2026-02-01';
SET @to_date   = '2026-02-28';

SELECT
  d.date,
  COALESCE(p.printer2_count, 0) AS salespulse_txs,
  COALESCE(s.system_pos_count, 0) AS system_pos_txs,
  COALESCE(p.printer2_count, 0) - COALESCE(s.system_pos_count, 0) AS diff
FROM (
  SELECT DATE(p2.printed_at) AS date
  FROM salespulse.printer2_audit_log p2
  INNER JOIN salespulse.transactions t ON t.uuid_id = p2.transaction_id AND t.business_id = 4
  AND DATE(p2.printed_at) BETWEEN @from_date AND @to_date
  UNION
  SELECT DATE(created_at) FROM system_pos.transactions
  WHERE status != 'archived' AND business_id = 4
  AND DATE(created_at) BETWEEN @from_date AND @to_date
) d
LEFT JOIN (
  SELECT DATE(p2.printed_at) AS dt, COUNT(DISTINCT p2.transaction_id) AS printer2_count
  FROM salespulse.printer2_audit_log p2
  INNER JOIN salespulse.transactions t ON t.uuid_id = p2.transaction_id AND t.business_id = 4
  AND DATE(p2.printed_at) BETWEEN @from_date AND @to_date
  GROUP BY DATE(p2.printed_at)
) p ON d.date = p.dt
LEFT JOIN (
  SELECT DATE(created_at) AS dt, COUNT(*) AS system_pos_count
  FROM system_pos.transactions
  WHERE status != 'archived' AND business_id = 4
  AND DATE(created_at) BETWEEN @from_date AND @to_date
  GROUP BY DATE(created_at)
) s ON d.date = s.dt
WHERE d.date BETWEEN @from_date AND @to_date
ORDER BY d.date DESC;
```

---

## Check Transaction Detail by UUID (Salespulse)
Provides full details of a specific transaction including all line items. Replace `'YOUR_UUID_HERE'` with the transaction UUID.
```sql
SELECT 
    t.uuid_id AS transaction_uuid,
    t.receipt_number,
    t.created_at,
    t.paid_at,
    t.status AS tx_status,
    u.name AS cashier_name,
    t.customer_name,
    t.customer_unit,
    t.payment_method,
    t.pickup_method,
    t.total_amount AS tx_subtotal,
    t.voucher_discount,
    t.final_amount AS tx_final_amount,
    t.refund_total,
    ti.quantity,
    p.nama AS item_name,
    ti.unit_price,
    ti.total_price AS item_total,
    ti.production_status AS item_status,
    ti.production_started_at,
    ti.production_finished_at,
    ti.custom_note,
    e.nama_karyawan AS item_waiter
FROM salespulse.transactions t
LEFT JOIN salespulse.users u ON t.user_id = u.id
LEFT JOIN salespulse.transaction_items ti ON t.uuid_id = ti.uuid_transaction_id
LEFT JOIN salespulse.products p ON ti.product_id = p.id
LEFT JOIN salespulse.employees e ON ti.waiter_id = e.id
WHERE t.uuid_id = 'YOUR_UUID_HERE';
```

# Cek apakah kalkulasi view yang dilaporkan ke pajak sudah = yang ditampilkan daftar transaksi p2 only?

## Query Anda (filter paid_at, raw kolom)
SET @from_date = '2026-02-01';
SET @to_date   = '2026-02-28';
SELECT
  COALESCE(SUM(t.total_amount), 0)                              AS gross,
  COALESCE(SUM(t.refund_total), 0)                              AS refund,
  COALESCE(SUM(t.final_amount), 0) - COALESCE(SUM(t.refund_total), 0) AS nett
FROM system_pos.transactions t
WHERE t.status <> 'archived'
  AND t.business_id = 4
  AND CAST(t.paid_at AS DATE) BETWEEN @from_date AND @to_date;

---

## Kenapa hasil SQL ≠ Grand Total di Daftar Transaksi (System POS)?

1. **Tanggal**
   - SQL Anda: filter **paid_at** (tanggal bayar).
   - Daftar Transaksi: filter **created_at** (tanggal buat transaksi), dalam local date.
   - Transaksi yang “dibuat” di luar range tapi “dibayar” di range (atau sebaliknya) akan masuk di satu sisi saja → gross/refund/nett beda.

2. **Refund**
   - SQL Anda: pakai kolom **system_pos.transactions.refund_total** (bisa belum sync).
   - Daftar Transaksi (System POS): refund dihitung dari **salespulse.transaction_refunds** (main DB), lalu di-enrich ke tiap transaksi. Jadi total Refund di UI bisa lebih besar (371k vs 116k) karena sumber datanya beda.

3. **Amount (total_amount / final_amount)**
   - SQL Anda: pakai **t.total_amount** dan **t.final_amount** mentah dari tabel.
   - Daftar Transaksi (System POS): pakai amount dari **item aktif saja** (active_total; item cancelled tidak masuk). Jadi gross/final bisa beda jika ada item dibatalkan.

---

## Apakah query Anda dipakai untuk menghitung isi view?

**Tidak.**  
- View **v_transactions** menampilkan **per baris**: jam, tanggal, no_bill, discount, tax, service_charge, subtotal, total (final_amount). Tidak ada agregasi gross/refund/nett, dan **tidak ada filter tanggal** di definisi view (semua transaksi, business_id = 4).  
- Query Anda: agregat (SUM) **untuk range tanggal** (paid_at). Jadi query itu **bukan** “kalkulasi dari view”; view hanya list transaksi, bukan sumber angka Grand Total di app.

---

## Apakah isi view = data yang tampil di Daftar Transaksi System POS?

**Tidak persis sama.**

| Aspek        | View v_transactions                    | Daftar Transaksi (System POS)                         |
|-------------|----------------------------------------|--------------------------------------------------------|
| Filter tanggal | Tidak ada (semua waktu)                | Ada: range tanggal by **created_at**                   |
| Kolom       | jam, tanggal, no_bill, discount, total | Gross, Discount, Refund, Net (dari list + agregasi)   |
| Refund      | Tidak ada kolom refund                 | Ada; dari main DB transaction_refunds (enriched)      |
| Amount      | Kolom tabel (final_amount, voucher_discount) | Dari query “active items” + enrich refund dari main DB |

Jadi: **data yang dilihat petugas pajak lewat view** (kalau hanya baca view) **tidak sama** dengan yang tampil di Daftar Transaksi System POS, karena (1) view tidak filter tanggal, (2) view tidak punya refund, (3) view pakai kolom mentah tabel, sedangkan Daftar Transaksi pakai logic active items + refund dari main DB.

---

## Query yang selaras dengan Daftar Transaksi (created_at, completed only, active items)
```sql
-- Sama dengan Grand Total Daftar Transaksi System POS: created_at, completed only, active items
SET @from_date = '2026-02-01';
SET @to_date   = '2026-02-28';

SELECT
  COALESCE(SUM(gross_per_tx), 0)     AS gross,
  COALESCE(SUM(gross_per_tx), 0) - COALESCE(SUM(final_per_tx), 0) AS discount,
  COALESCE(SUM(refund_per_tx), 0)    AS refund,
  COALESCE(SUM(final_per_tx), 0) - COALESCE(SUM(refund_per_tx), 0) AS nett
FROM (
  SELECT
    t.id,
    COALESCE(active.active_total, t.total_amount)     AS gross_per_tx,
    GREATEST(0, COALESCE(active.active_total, t.total_amount) - COALESCE(t.voucher_discount, 0)) AS final_per_tx,
    COALESCE(NULLIF(t.refund_total, 0), COALESCE(refund_summary.total_refund, 0)) AS refund_per_tx
  FROM system_pos.transactions t
  LEFT JOIN (
    SELECT
      uuid_transaction_id,
      transaction_id,
      SUM(total_price) AS active_total
    FROM system_pos.transaction_items
    WHERE (production_status IS NULL OR production_status != 'cancelled')
    GROUP BY uuid_transaction_id, transaction_id
  ) active ON (t.uuid_id = active.uuid_transaction_id OR t.id = active.transaction_id)
  LEFT JOIN (
    SELECT
      transaction_uuid,
      SUM(refund_amount) AS total_refund
    FROM system_pos.transaction_refunds
    WHERE status IN ('pending', 'completed')
    GROUP BY transaction_uuid
  ) refund_summary ON t.uuid_id = refund_summary.transaction_uuid
  WHERE t.status != 'archived'
    AND LOWER(TRIM(COALESCE(t.status, ''))) NOT IN ('cancelled', 'pending')
    AND t.business_id = 4
    AND CAST(t.created_at AS DATE) BETWEEN @from_date AND @to_date
) sub;
```
```sql
WHERE T.status != 'active'
  AND LOWER(TRIM(COALESCENCEt.status))) NOT IN ('cancelled', 'pending')