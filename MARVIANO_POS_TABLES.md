# Tables Used in Marviano-POS

This document lists all database tables that are actively used in the marviano-pos application. These are the tables you should copy from salespulse to marviano-pos.

## Core Tables (Defined in Schema)

### User & Authentication
- `users` - User accounts
- `roles` - User roles
- `permissions` - System permissions
- `role_permissions` - Junction table for roles and permissions
- `permission_categories` - Categories for organizing permissions

### Business & Organization
- `businesses` - Business/outlet information
- `organizations` - Organization/company information
- `management_groups` - Management group information

### Products & Categories
- `products` - Product catalog
- `category1` - Main product categories (makanan, minuman, dessert, etc.)
- `category2` - Product subcategories (previously jenis field)
- `category2_businesses` - Junction table linking category2 to businesses
- `product_businesses` - Junction table linking products to businesses
- `bundle_items` - Bundle product structure definitions

### Product Customizations
- `product_customization_types` - Customization type definitions (e.g., "Size", "Toppings")
- `product_customization_options` - Available options for each customization type
- `product_customizations` - Links products to customization types

### Transactions
- `transactions` - Main transaction records
- `transaction_items` - Individual items in transactions
- `transaction_item_customizations` - Customizations applied to transaction items
- `transaction_item_customization_options` - Selected options for customizations
- `transaction_refunds` - Refund records
- `transaction_item_removals` - Removed items from transactions (if table exists)

### Shifts
- `shifts` - Shift/work session records

### Payment & Banking
- `payment_methods` - Payment method definitions
- `banks` - Bank information
- `cl_accounts` - Credit limit accounts

### Printer Management
- `printer1_audit_log` - Receipt printer audit logs
- `printer2_audit_log` - Label printer audit logs
- `printer_daily_counters` - Daily counter tracking for printers
- `printer_mode_settings` - Printer mode configuration
- `printer2_automation` - Printer2 automation settings
- `printer_configs` - Local printer configuration

### Restaurant Layout (Table Management)
- `restaurant_rooms` - Restaurant room/area definitions
- `restaurant_tables` - Table definitions with positions
- `restaurant_layout_elements` - Custom layout elements (doors, bathrooms, etc.)

### Sync & System
- `sync_status` - Sync status tracking
- `uuid_sequence_tracker` - UUID sequence tracking
- `offline_refunds` - Offline refund queue

## Additional Tables (Used in Sync/API but not in Schema)

These tables are referenced in the code but may not be created by the schema initialization:

### Ingredients & COGS
- `ingredients` - Ingredient/raw material catalog
- `cogs` - Cost of Goods Sold (links products to ingredients)

### CRM/Contacts
- `contacts` - Customer contact information
- `source` - Contact source types
- `pekerjaan` - Job/profession types
- `teams` - Sales teams

## Tables NOT Used in Marviano-POS

Based on the codebase analysis, these tables from salespulse are NOT used in marviano-pos and should NOT be copied:

- `accounts` - NextAuth accounts (web app only)
- `activity_logs` - Activity logging (web app only)
- `app_settings` - Application settings (web app only)
- `batch_sales_data` - Batch sales data (web app only)
- `business_tags` - Business tags (web app only)
- `business_targets` - Business targets (web app only)
- `category1_businesses` - Category1-business junction (not used in POS)
- `chat_conversations` - Chat conversations (web app only)
- `chat_messages` - Chat messages (web app only)
- `chat_metadata` - Chat metadata (web app only)
- `custom_targets` - Custom targets (web app only)
- `customer_followups` - Customer followups (web app only)
- `deal_products` - Deal products (web app only)
- `deals` - Deals/transactions (web app only)
- `event_contacts` - Event contacts (web app only)
- `event_types` - Event types (web app only)
- `events` - Events (web app only)
- And many other web-app specific tables...

## Summary

**Total Tables to Copy: ~40 tables**

The marviano-pos application is a Point of Sale system that focuses on:
1. Product catalog management
2. Transaction processing
3. Printer management
4. Shift management
5. Restaurant table layout
6. Basic sync functionality

It does NOT use web-app features like:
- CRM/deals management
- Activity logging
- Chat functionality
- Business analytics/targets
- Event management
- And other salespulse web-app specific features




