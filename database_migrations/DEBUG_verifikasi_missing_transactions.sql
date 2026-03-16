-- =============================================================================
-- DEBUG: Why are these 7 transactions "Missing on salespulse.cc (only in Pictos)"?
-- Run these on your PICTOS (local) MySQL database — same DB used by Verifikasi.
-- Date: 12 March 2026
-- UUIDs: 0040001260312153034, 0040001260312153209, 0040001260312162233,
--        0040001260312162011, 0040001260312162256, 0040001260312162128, 0040001260312195534
-- =============================================================================

-- 1) Status, sync state, and timestamps for the 7 missing transactions
--    This shows: pending/synced/failed, paid/unpaid, and last sync error (if any)
SELECT
  t.uuid_id,
  t.status              AS tx_status,
  t.sync_status         AS sync_status,
  t.sync_attempts       AS sync_attempts,
  t.last_sync_attempt   AS last_sync_attempt,
  t.last_sync_error     AS last_sync_error,
  t.synced_at           AS synced_at,
  t.created_at          AS created_at,
  t.paid_at             AS paid_at,
  t.total_amount,
  t.final_amount
FROM transactions t
WHERE t.uuid_id IN (
  '0040001260312153034',
  '0040001260312153209',
  '0040001260312162233',
  '0040001260312162011',
  '0040001260312162256',
  '0040001260312162128',
  '0040001260312195534'
)
ORDER BY t.created_at;

-- 2) Count by sync_status for these 7 (quick summary)
SELECT
  sync_status,
  COUNT(*) AS cnt
FROM transactions
WHERE uuid_id IN (
  '0040001260312153034', '0040001260312153209', '0040001260312162233',
  '0040001260312162011', '0040001260312162256', '0040001260312162128', '0040001260312195534'
)
GROUP BY sync_status;

-- =============================================================================
-- 3) REFUND & PEMBATALAN (refund / item dibatalkan) for the 7 transactions
--    Run on PICTOS (local) MySQL.
-- =============================================================================

-- 3a) Refund summary from transactions table (refund_total, refund_status)
SELECT
  t.uuid_id,
  t.refund_status,
  t.refund_total,
  t.last_refunded_at,
  t.total_amount,
  t.final_amount
FROM transactions t
WHERE t.uuid_id IN (
  '0040001260312153034', '0040001260312153209', '0040001260312162233',
  '0040001260312162011', '0040001260312162256', '0040001260312162128', '0040001260312195534'
)
ORDER BY t.created_at;

-- 3b) Refund rows (transaction_refunds) for the 7 transactions
SELECT
  r.transaction_uuid,
  r.uuid_id AS refund_uuid,
  r.refund_amount,
  r.refund_type,
  r.status AS refund_status,
  r.refunded_at,
  r.synced_at AS refund_synced_at
FROM transaction_refunds r
WHERE r.transaction_uuid IN (
  '0040001260312153034', '0040001260312153209', '0040001260312162233',
  '0040001260312162011', '0040001260312162256', '0040001260312162128', '0040001260312195534'
)
ORDER BY r.transaction_uuid, r.refunded_at;

-- 3c) Pembatalan: item yang dibatalkan (production_status = 'cancelled') for the 7
SELECT
  i.uuid_transaction_id,
  i.id AS item_id,
  i.uuid_id AS item_uuid,
  i.product_id,
  i.quantity,
  i.unit_price,
  i.total_price,
  i.production_status,
  i.cancelled_at,
  i.cancelled_by_user_id,
  i.cancelled_by_waiter_id
FROM transaction_items i
WHERE i.uuid_transaction_id IN (
  '0040001260312153034', '0040001260312153209', '0040001260312162233',
  '0040001260312162011', '0040001260312162256', '0040001260312162128', '0040001260312195534'
)
  AND (i.production_status = 'cancelled' OR i.cancelled_at IS NOT NULL)
ORDER BY i.uuid_transaction_id, i.id;

-- 3d) Summary: per-transaction count of refunds and cancelled items
SELECT
  t.uuid_id,
  (SELECT COUNT(*) FROM transaction_refunds r WHERE r.transaction_uuid = t.uuid_id) AS refund_count,
  (SELECT COALESCE(SUM(r2.refund_amount), 0) FROM transaction_refunds r2 WHERE r2.transaction_uuid = t.uuid_id) AS refund_sum_amount,
  (SELECT COUNT(*) FROM transaction_items i WHERE i.uuid_transaction_id = t.uuid_id AND (i.production_status = 'cancelled' OR i.cancelled_at IS NOT NULL)) AS cancelled_items_count
FROM transactions t
WHERE t.uuid_id IN (
  '0040001260312153034', '0040001260312153209', '0040001260312162233',
  '0040001260312162011', '0040001260312162256', '0040001260312162128', '0040001260312195534'
);

-- =============================================================================
-- INTERPRETATION (Pictos side)
-- =============================================================================
-- - sync_status = 'pending' or 'failed' → never successfully uploaded to salespulse.cc
-- - last_sync_error not null → reason upload failed (e.g. network, validation, 4xx/5xx)
-- - sync_status = 'synced' but still "missing on salespulse" → see below (SERVER SIDE).
-- =============================================================================

-- =============================================================================
-- WHEN ALL 7 ARE "synced" BUT STILL "Missing on salespulse.cc"
-- =============================================================================
-- Pictos marked them synced (upload or "duplicate" response), but the match-check
-- API does not return them. So the cause is on the SALESPULSE.CC side:
--
-- 1. Date/timezone: match-check may filter by from_iso/to_iso (UTC). If the server
--    stores created_at in a different timezone or the filter is wrong, these rows
--    can be excluded.
-- 2. Different DB: upload might write to one DB (e.g. VPS) and match-check might
--    read from another (e.g. replica, or localhost).
-- 3. API bug: wrong WHERE, limit, or status filter (e.g. only returning some statuses).
--
-- Run the following on your SALESPULSE.CC database (the one the match-check API
-- reads from, e.g. VPS) to confirm whether the 7 exist and their created_at:
-- =============================================================================

-- 4) RUN ON SALESPULSE.CC DB: Do these 7 UUIDs exist? What is their created_at?
--    (Use the same DB the /api/transactions/match-check endpoint uses.)
/*
SELECT
  uuid_id,
  business_id,
  status,
  created_at,
  updated_at
FROM transactions
WHERE uuid_id IN (
  '0040001260312153034',
  '0040001260312153209',
  '0040001260312162233',
  '0040001260312162011',
  '0040001260312162256',
  '0040001260312162128',
  '0040001260312195534'
)
ORDER BY created_at;
*/

-- If the query above returns 0 rows → data never reached this DB (upload went
-- elsewhere or failed despite 200). If it returns 7 rows → check created_at:
-- if they fall outside the Verifikasi date range (in the timezone the API uses),
-- the match-check filter is excluding them; fix the API date filter or re-run
-- Verifikasi with a wider date range.

-- =============================================================================
-- FIX (regardless of cause)
-- =============================================================================
-- 1. In Sinkronisasi, use "Upsert salespulse.cc" for 12 March 2026 (same range
--    as Verifikasi) to re-push these 7. Then run Verifikasi again.
-- 2. If they still appear "missing", fix the match-check API (date range,
--    timezone, or which DB it reads from).
-- =============================================================================
