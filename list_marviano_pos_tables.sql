-- SQL script to list all tables that should be copied from salespulse to marviano-pos
-- Run this on your salespulse database to see which tables to copy

-- Core Tables (Defined in Schema)
SELECT 'users' as table_name, 'User accounts' as description
UNION ALL SELECT 'roles', 'User roles'
UNION ALL SELECT 'permissions', 'System permissions'
UNION ALL SELECT 'role_permissions', 'Junction table for roles and permissions'
UNION ALL SELECT 'permission_categories', 'Categories for organizing permissions'
UNION ALL SELECT 'businesses', 'Business/outlet information'
UNION ALL SELECT 'organizations', 'Organization/company information'
UNION ALL SELECT 'management_groups', 'Management group information'
UNION ALL SELECT 'products', 'Product catalog'
UNION ALL SELECT 'category1', 'Main product categories'
UNION ALL SELECT 'category2', 'Product subcategories'
UNION ALL SELECT 'category2_businesses', 'Junction table linking category2 to businesses'
UNION ALL SELECT 'product_businesses', 'Junction table linking products to businesses'
UNION ALL SELECT 'bundle_items', 'Bundle product structure definitions'
UNION ALL SELECT 'product_customization_types', 'Customization type definitions'
UNION ALL SELECT 'product_customization_options', 'Available options for each customization type'
UNION ALL SELECT 'product_customizations', 'Links products to customization types'
UNION ALL SELECT 'transactions', 'Main transaction records'
UNION ALL SELECT 'transaction_items', 'Individual items in transactions'
UNION ALL SELECT 'transaction_item_customizations', 'Customizations applied to transaction items'
UNION ALL SELECT 'transaction_item_customization_options', 'Selected options for customizations'
UNION ALL SELECT 'transaction_refunds', 'Refund records'
UNION ALL SELECT 'shifts', 'Shift/work session records'
UNION ALL SELECT 'payment_methods', 'Payment method definitions'
UNION ALL SELECT 'banks', 'Bank information'
UNION ALL SELECT 'cl_accounts', 'Credit limit accounts'
UNION ALL SELECT 'printer1_audit_log', 'Receipt printer audit logs'
UNION ALL SELECT 'printer2_audit_log', 'Label printer audit logs'
UNION ALL SELECT 'printer_daily_counters', 'Daily counter tracking for printers'
UNION ALL SELECT 'printer_mode_settings', 'Printer mode configuration'
UNION ALL SELECT 'printer2_automation', 'Printer2 automation settings'
UNION ALL SELECT 'printer_configs', 'Local printer configuration'
UNION ALL SELECT 'restaurant_rooms', 'Restaurant room/area definitions'
UNION ALL SELECT 'restaurant_tables', 'Table definitions with positions'
UNION ALL SELECT 'restaurant_layout_elements', 'Custom layout elements'
UNION ALL SELECT 'sync_status', 'Sync status tracking'
UNION ALL SELECT 'uuid_sequence_tracker', 'UUID sequence tracking'
UNION ALL SELECT 'offline_refunds', 'Offline refund queue'
UNION ALL SELECT 'ingredients', 'Ingredient/raw material catalog'
UNION ALL SELECT 'cogs', 'Cost of Goods Sold'
UNION ALL SELECT 'contacts', 'Customer contact information'
UNION ALL SELECT 'source', 'Contact source types'
UNION ALL SELECT 'pekerjaan', 'Job/profession types'
UNION ALL SELECT 'teams', 'Sales teams'
UNION ALL SELECT 'transaction_item_removals', 'Removed items from transactions (if exists)'
ORDER BY table_name;

-- Check which of these tables exist in your database
SELECT 
    t.table_name,
    CASE 
        WHEN t.table_name IN (
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = DATABASE()
        ) THEN 'EXISTS'
        ELSE 'MISSING'
    END as status,
    (SELECT COUNT(*) 
     FROM information_schema.tables 
     WHERE table_schema = DATABASE() 
     AND table_name = t.table_name) as exists_count
FROM (
    SELECT 'users' as table_name
    UNION ALL SELECT 'roles'
    UNION ALL SELECT 'permissions'
    UNION ALL SELECT 'role_permissions'
    UNION ALL SELECT 'permission_categories'
    UNION ALL SELECT 'businesses'
    UNION ALL SELECT 'organizations'
    UNION ALL SELECT 'management_groups'
    UNION ALL SELECT 'products'
    UNION ALL SELECT 'category1'
    UNION ALL SELECT 'category2'
    UNION ALL SELECT 'category2_businesses'
    UNION ALL SELECT 'product_businesses'
    UNION ALL SELECT 'bundle_items'
    UNION ALL SELECT 'product_customization_types'
    UNION ALL SELECT 'product_customization_options'
    UNION ALL SELECT 'product_customizations'
    UNION ALL SELECT 'transactions'
    UNION ALL SELECT 'transaction_items'
    UNION ALL SELECT 'transaction_item_customizations'
    UNION ALL SELECT 'transaction_item_customization_options'
    UNION ALL SELECT 'transaction_refunds'
    UNION ALL SELECT 'shifts'
    UNION ALL SELECT 'payment_methods'
    UNION ALL SELECT 'banks'
    UNION ALL SELECT 'cl_accounts'
    UNION ALL SELECT 'printer1_audit_log'
    UNION ALL SELECT 'printer2_audit_log'
    UNION ALL SELECT 'printer_daily_counters'
    UNION ALL SELECT 'printer_mode_settings'
    UNION ALL SELECT 'printer2_automation'
    UNION ALL SELECT 'printer_configs'
    UNION ALL SELECT 'restaurant_rooms'
    UNION ALL SELECT 'restaurant_tables'
    UNION ALL SELECT 'restaurant_layout_elements'
    UNION ALL SELECT 'sync_status'
    UNION ALL SELECT 'uuid_sequence_tracker'
    UNION ALL SELECT 'offline_refunds'
    UNION ALL SELECT 'ingredients'
    UNION ALL SELECT 'cogs'
    UNION ALL SELECT 'contacts'
    UNION ALL SELECT 'source'
    UNION ALL SELECT 'pekerjaan'
    UNION ALL SELECT 'teams'
    UNION ALL SELECT 'transaction_item_removals'
) t
ORDER BY t.table_name;




