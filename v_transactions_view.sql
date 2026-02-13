DELIMITER $$

ALTER ALGORITHM=UNDEFINED DEFINER=`root`@`%` SQL SECURITY DEFINER VIEW `system_pos`.`v_transactions` AS
SELECT
  t.business_id       AS business_id,
  t.user_id           AS user_id,
  t.waiter_id         AS waiter_id,
  t.shift_uuid        AS shift_uuid,
  t.payment_method    AS payment_method,
  t.payment_method_id AS payment_method_id,
  t.pickup_method     AS pickup_method,
  t.total_amount      AS total_amount,
  t.voucher_discount  AS voucher_discount,
  t.voucher_type      AS voucher_type,
  t.voucher_value     AS voucher_value,
  t.voucher_label     AS voucher_label,
  t.final_amount      AS final_amount,
  t.amount_received   AS amount_received,
  t.change_amount     AS change_amount,
  t.contact_id        AS contact_id,
  t.customer_name     AS customer_name,
  t.customer_unit     AS customer_unit,
  t.note              AS note,
  t.transaction_type  AS transaction_type,
  t.status            AS status,
  t.created_at        AS created_at,
  t.updated_at        AS updated_at,
  t.paid_at           AS paid_at,
  DATE(t.paid_at)     AS tanggal,
  TIME(t.paid_at)     AS jam,
  t.synced_at         AS synced_at,
  COALESCE(t.uuid_id, t.id) AS id,
  COALESCE(t.uuid_id, t.id) AS no_bill,
  t.receipt_number    AS receipt_number,
  COALESCE(NULLIF(t.refund_total, 0), COALESCE(refund_summary.total_refund, 0)) AS refund_total,
  (CASE WHEN (COALESCE(refund_summary.total_refund, t.refund_total, 0) > 0) THEN (CASE WHEN (COALESCE(refund_summary.total_refund, t.refund_total, 0) >= (t.final_amount - 0.01)) THEN 'full' ELSE 'partial' END) ELSE 'none' END) AS refund_status
FROM (system_pos.transactions t
   LEFT JOIN (SELECT
                system_pos.transaction_refunds.transaction_uuid AS transaction_uuid,
                SUM(system_pos.transaction_refunds.refund_amount) AS total_refund
              FROM system_pos.transaction_refunds
              WHERE (system_pos.transaction_refunds.status IN ('pending','completed'))
              GROUP BY system_pos.transaction_refunds.transaction_uuid) refund_summary
     ON (t.uuid_id = refund_summary.transaction_uuid))
WHERE ((t.status <> 'archived')
       AND (t.business_id = 4))
ORDER BY t.created_at DESC$$

DELIMITER ;
