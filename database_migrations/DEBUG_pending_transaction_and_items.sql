-- Run these in your DB (MySQL) and share the results so we can see why a transaction
-- might show on the table layout but not in Active Orders.
-- Replace 0040001260312155816 with the actual uuid_id if different.

-- 1) The specific transaction (replace UUID if needed)
-- Note: table_ids_json may not exist on older schemas; add it to the SELECT if your DB has it.
SELECT
  t.id,
  t.uuid_id,
  t.business_id,
  t.status,
  t.customer_name,
  t.table_id,
  t.created_at,
  DATE(t.created_at) AS created_date,
  CURDATE() AS server_today,
  (DATE(t.created_at) = CURDATE()) AS is_today_per_server
FROM transactions t
WHERE t.uuid_id = '0040001260312155816';

-- 2) Its items: count and whether they count as "active" (not cancelled)
SELECT
  ti.id,
  ti.uuid_id AS item_uuid,
  ti.uuid_transaction_id,
  ti.product_id,
  ti.quantity,
  ti.unit_price,
  ti.production_status,
  (ti.production_status IS NULL OR ti.production_status != 'cancelled') AS is_active
FROM transaction_items ti
WHERE ti.uuid_transaction_id = '0040001260312155816'
ORDER BY ti.created_at;

-- 3) Summary: pending transactions with active item count (last 7 days)
--    Use this to see if your transaction is "today" and has active items
SELECT
  t.uuid_id,
  t.customer_name,
  t.table_id,
  t.created_at,
  DATE(t.created_at) AS created_date,
  (DATE(t.created_at) = CURDATE()) AS is_today,
  (SELECT COUNT(*)
   FROM transaction_items ti
   WHERE ti.uuid_transaction_id = t.uuid_id
     AND (ti.production_status IS NULL OR ti.production_status != 'cancelled')
  ) AS active_items
FROM transactions t
WHERE t.status = 'pending'
  AND t.created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
ORDER BY t.created_at DESC;
