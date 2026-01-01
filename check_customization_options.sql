-- ============================================================================
-- CHECK CUSTOMIZATION OPTIONS IN LOCAL DATABASE
-- ============================================================================
-- This script checks if the local database is storing ALL available options
-- instead of just SELECTED options for transaction items
-- ============================================================================

-- Query 1: Check a specific transaction item's customizations
-- Replace 'YOUR_TRANSACTION_UUID' and 'YOUR_PRODUCT_ID' with actual values
SET @transaction_uuid = '0142512261253320001';  -- Example transaction UUID
SET @product_id = 298;  -- Example product ID (23.9K Jumbo Ice Cream)

-- Get transaction item ID
SELECT 
    ti.id as transaction_item_id,
    ti.uuid_id as transaction_item_uuid,
    p.nama as product_name,
    p.menu_code
FROM transaction_items ti
LEFT JOIN products p ON ti.product_id = p.id
WHERE ti.uuid_transaction_id = @transaction_uuid
  AND ti.product_id = @product_id
LIMIT 1;

-- Query 2: Count options per customization type for this item
-- This will show if ALL options are stored or just SELECTED ones
SELECT 
    tic.id as customization_id,
    tic.transaction_item_id,
    pct.name as customization_type,
    pct.selection_mode,
    COUNT(tico.id) as stored_options_count,
    GROUP_CONCAT(tico.option_name ORDER BY tico.id SEPARATOR ', ') as stored_option_names
FROM transaction_item_customizations tic
LEFT JOIN product_customization_types pct ON tic.customization_type_id = pct.id
LEFT JOIN transaction_item_customization_options tico ON tico.transaction_item_customization_id = tic.id
WHERE tic.transaction_item_id = (
    SELECT id FROM transaction_items 
    WHERE uuid_transaction_id = @transaction_uuid 
    AND product_id = @product_id 
    LIMIT 1
)
GROUP BY tic.id, tic.transaction_item_id, pct.name, pct.selection_mode;

-- Query 3: Compare stored options vs ALL available options for this product
-- This will show if stored options match available options (BAD) or are a subset (GOOD)
SELECT 
    pct.name as customization_type,
    pct.selection_mode,
    COUNT(DISTINCT pco.id) as total_available_options,
    COUNT(DISTINCT tico.customization_option_id) as stored_options_count,
    CASE 
        WHEN COUNT(DISTINCT pco.id) = COUNT(DISTINCT tico.customization_option_id) 
        THEN '⚠️ ALL OPTIONS STORED (BAD - should only store selected)'
        WHEN COUNT(DISTINCT tico.customization_option_id) = 0
        THEN '✅ NO OPTIONS STORED'
        ELSE '✅ SUBSET STORED (GOOD - only selected options)'
    END as status,
    GROUP_CONCAT(DISTINCT pco.name ORDER BY pco.id SEPARATOR ', ') as all_available_options,
    GROUP_CONCAT(DISTINCT tico.option_name ORDER BY tico.id SEPARATOR ', ') as stored_options
FROM transaction_item_customizations tic
LEFT JOIN product_customization_types pct ON tic.customization_type_id = pct.id
LEFT JOIN product_customizations pc ON pc.customization_type_id = pct.id
LEFT JOIN products p ON pc.product_id = p.id
LEFT JOIN product_customization_options pco ON pco.type_id = pct.id
LEFT JOIN transaction_item_customization_options tico ON tico.transaction_item_customization_id = tic.id
WHERE tic.transaction_item_id = (
    SELECT id FROM transaction_items 
    WHERE uuid_transaction_id = @transaction_uuid 
    AND product_id = @product_id 
    LIMIT 1
)
  AND p.id = @product_id
GROUP BY pct.id, pct.name, pct.selection_mode;

-- Query 4: Check ALL transaction items for a product to see the pattern
-- This helps identify if it's a systematic issue
SELECT 
    ti.uuid_transaction_id,
    ti.id as transaction_item_id,
    p.nama as product_name,
    COUNT(DISTINCT tic.id) as customization_types_count,
    COUNT(DISTINCT tico.id) as total_options_stored,
    ROUND(COUNT(DISTINCT tico.id) / NULLIF(COUNT(DISTINCT tic.id), 0), 1) as avg_options_per_customization
FROM transaction_items ti
LEFT JOIN products p ON ti.product_id = p.id
LEFT JOIN transaction_item_customizations tic ON tic.transaction_item_id = ti.id
LEFT JOIN transaction_item_customization_options tico ON tico.transaction_item_customization_id = tic.id
WHERE ti.product_id = @product_id
GROUP BY ti.id, ti.uuid_transaction_id, p.nama
ORDER BY avg_options_per_customization DESC
LIMIT 10;





