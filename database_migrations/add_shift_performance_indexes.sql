-- Performance indexes for Ganti Shift feature
-- Run this migration to optimize shift-related queries

-- 1. Composite index for get-active-shift query
-- Optimizes: WHERE business_id = ? AND status = 'active' ORDER BY shift_start ASC
ALTER TABLE shifts 
ADD INDEX idx_shifts_business_status_start (business_id, status, shift_start);

-- 2. Composite index for get-shifts with date filtering
-- Optimizes: WHERE business_id = ? AND shift_start >= ? AND shift_start <= ? ORDER BY shift_start DESC
ALTER TABLE shifts 
ADD INDEX idx_shifts_business_start (business_id, shift_start);

-- 3. Composite index for transaction queries (most common pattern)
-- Optimizes: WHERE user_id = ? AND business_id = ? AND created_at >= ? AND status = 'completed'
ALTER TABLE transactions 
ADD INDEX idx_transactions_user_business_date_status (user_id, business_id, created_at, status);

-- 4. Composite index for transaction queries with payment_method_id
-- Optimizes: WHERE user_id = ? AND business_id = ? AND created_at >= ? AND payment_method_id = ? AND status = 'completed'
ALTER TABLE transactions 
ADD INDEX idx_transactions_user_business_date_payment_status (user_id, business_id, created_at, payment_method_id, status);

-- 5. Composite index for transaction_items JOIN optimization
-- Optimizes: JOIN transactions ON transaction_items.transaction_id = transactions.id
-- Note: transaction_id already has foreign key, but composite index helps with date range queries
ALTER TABLE transaction_items 
ADD INDEX idx_transaction_items_transaction_created (transaction_id, id);

-- 6. Index for category2 breakdown query
-- Optimizes: JOIN products ON transaction_items.product_id = products.id WHERE products.category2_id IS NOT NULL
ALTER TABLE products 
ADD INDEX idx_products_category2_business (category2_id, id);

-- 7. Index for transaction_refunds queries
-- Optimizes: WHERE refunded_by = ? AND business_id = ? AND refunded_at >= ?
ALTER TABLE transaction_refunds 
ADD INDEX idx_refunds_user_business_date (refunded_by, business_id, refunded_at, status);


