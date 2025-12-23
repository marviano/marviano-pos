Localhost
root
password: z8$>9k!FJ

-- ============================================
-- QUERY 1: SIMPLE COMPARISON - Check if transactions exist in BOTH databases
-- Shows latest 5 transactions side-by-side from both databases
-- Easy to see if data is complete and saved to both salespulse and system_pos
-- ============================================
SELECT 
    'salespulse' AS 'DB',
    DATE_FORMAT(CONVERT_TZ(t.created_at, '+00:00', '+07:00'), '%Y-%m-%d %H:%i:%s') AS 'Created',
    t.uuid_id AS 'TX ID',
    t.customer_name AS 'Customer',
    COALESCE(u.name, 'NULL') AS 'User',
    t.payment_method AS 'Payment',
    FORMAT(t.final_amount, 0) AS 'Final',
    t.voucher_label AS 'Voucher',
    COUNT(DISTINCT ti.id) AS 'Items',
    COUNT(DISTINCT tic.id) AS 'Cust',
    COUNT(DISTINCT co.id) AS 'CustOpt',
    CASE WHEN EXISTS (SELECT 1 FROM salespulse.printer1_audit_log p1 WHERE p1.transaction_id = t.uuid_id) THEN 'Yes' ELSE 'No' END AS 'P1',
    CASE WHEN EXISTS (SELECT 1 FROM salespulse.printer2_audit_log p2 WHERE p2.transaction_id = t.uuid_id) THEN 'Yes' ELSE 'No' END AS 'P2',
    COALESCE(t.note, 'NULL') AS 'Note'
FROM salespulse.transactions t
LEFT JOIN salespulse.users u ON u.id = t.user_id
LEFT JOIN salespulse.transaction_items ti ON ti.uuid_transaction_id = t.uuid_id
LEFT JOIN salespulse.transaction_item_customizations tic ON tic.uuid_transaction_item_id = ti.uuid_id
LEFT JOIN salespulse.transaction_item_customization_options co ON co.transaction_item_customization_id = tic.id
WHERE t.uuid_id IN (SELECT uuid_id FROM (SELECT uuid_id FROM salespulse.transactions ORDER BY created_at DESC LIMIT 5) AS latest)
GROUP BY t.id, t.uuid_id, t.created_at, t.customer_name, t.user_id, u.name, t.payment_method, t.final_amount, t.voucher_label, t.note

UNION ALL

SELECT 
    'system_pos' AS 'DB',
    DATE_FORMAT(CONVERT_TZ(t.created_at, '+00:00', '+07:00'), '%Y-%m-%d %H:%i:%s') AS 'Created',
    t.uuid_id AS 'TX ID',
    t.customer_name AS 'Customer',
    CASE WHEN t.user_id IS NOT NULL THEN CONCAT('User ID: ', t.user_id) ELSE 'NULL' END AS 'User',
    t.payment_method AS 'Payment',
    FORMAT(t.final_amount, 0) AS 'Final',
    t.voucher_label AS 'Voucher',
    COUNT(DISTINCT ti.id) AS 'Items',
    COUNT(DISTINCT tic.id) AS 'Cust',
    COUNT(DISTINCT co.id) AS 'CustOpt',
    CASE WHEN EXISTS (SELECT 1 FROM salespulse.printer1_audit_log p1 WHERE p1.transaction_id = t.uuid_id) THEN 'Yes' ELSE 'No' END AS 'P1',
    CASE WHEN EXISTS (SELECT 1 FROM salespulse.printer2_audit_log p2 WHERE p2.transaction_id = t.uuid_id) THEN 'Yes' ELSE 'No' END AS 'P2',
    COALESCE(t.note, 'NULL') AS 'Note'
FROM system_pos.transactions t
LEFT JOIN system_pos.transaction_items ti ON ti.uuid_transaction_id = t.uuid_id
LEFT JOIN system_pos.transaction_item_customizations tic ON tic.uuid_transaction_item_id = ti.uuid_id
LEFT JOIN system_pos.transaction_item_customization_options co ON co.transaction_item_customization_id = tic.id
WHERE t.uuid_id IN (SELECT uuid_id FROM (SELECT uuid_id FROM system_pos.transactions ORDER BY created_at DESC LIMIT 5) AS latest)
GROUP BY t.id, t.uuid_id, t.created_at, t.customer_name, t.user_id, t.payment_method, t.final_amount, t.voucher_label, t.note

ORDER BY `Created` DESC, `DB`;

-- ============================================
-- QUERY 2: CHECK SPECIFIC TRANSACTION - See if it exists in both databases
-- Replace '0142512211731440001' with your transaction ID
-- ============================================
SELECT 
    'salespulse' AS 'DB',
    t.uuid_id AS 'TX ID',
    t.customer_name AS 'Customer',
    COALESCE(u.name, 'NULL') AS 'User',
    FORMAT(t.final_amount, 0) AS 'Final',
    t.voucher_label AS 'Voucher',
    COUNT(DISTINCT ti.id) AS 'Items',
    COUNT(DISTINCT tic.id) AS 'Cust',
    COUNT(DISTINCT co.id) AS 'CustOpt',
    COALESCE(t.note, 'NULL') AS 'Note'
FROM salespulse.transactions t
LEFT JOIN salespulse.users u ON u.id = t.user_id
LEFT JOIN salespulse.transaction_items ti ON ti.uuid_transaction_id = t.uuid_id
LEFT JOIN salespulse.transaction_item_customizations tic ON tic.uuid_transaction_item_id = ti.uuid_id
LEFT JOIN salespulse.transaction_item_customization_options co ON co.transaction_item_customization_id = tic.id
WHERE t.uuid_id = '0142512211754500001'
GROUP BY t.id, t.uuid_id, t.customer_name, t.user_id, u.name, t.final_amount, t.voucher_label, t.note

UNION ALL

SELECT 
    'system_pos' AS 'DB',
    t.uuid_id AS 'TX ID',
    t.customer_name AS 'Customer',
    CASE WHEN t.user_id IS NOT NULL THEN CONCAT('User ID: ', t.user_id) ELSE 'NULL' END AS 'User',
    FORMAT(t.final_amount, 0) AS 'Final',
    t.voucher_label AS 'Voucher',
    COUNT(DISTINCT ti.id) AS 'Items',
    COUNT(DISTINCT tic.id) AS 'Cust',
    COUNT(DISTINCT co.id) AS 'CustOpt',
    COALESCE(t.note, 'NULL') AS 'Note'
FROM system_pos.transactions t
LEFT JOIN system_pos.transaction_items ti ON ti.uuid_transaction_id = t.uuid_id
LEFT JOIN system_pos.transaction_item_customizations tic ON tic.uuid_transaction_item_id = ti.uuid_id
LEFT JOIN system_pos.transaction_item_customization_options co ON co.transaction_item_customization_id = tic.id
WHERE t.uuid_id = '0142512211754500001'
GROUP BY t.id, t.uuid_id, t.customer_name, t.user_id, t.final_amount, t.voucher_label, t.note;
