# Transaction Tables Documentation

## Overview
This document lists all database tables used in transaction operations at the Kasir page and Kitchen/Barista pages, and what is synced to the server.

---

## Tables Used in Transaction Operations

### 1. **Kasir Page (Cashier/POS)**

#### When Creating a New Order (via "Simpan Order"):
- **`transactions`** - Main transaction record
  - Created via: `localDbUpsertTransactions`
  - Fields: id, business_id, user_id, payment_method, pickup_method, total_amount, final_amount, status='pending', etc.
  
- **`transaction_items`** - Individual items in the transaction
  - Created via: `localDbUpsertTransactionItems`
  - Fields: id, transaction_id, product_id, quantity, unit_price, total_price, custom_note, bundle_selections_json, production_status=NULL
  
- **`transaction_item_customizations`** - Customization types applied to items
  - Created via: `localDbUpsertTransactionItemCustomizations`
  - Fields: id, transaction_item_id, customization_type_id, bundle_product_id
  
- **`transaction_item_customization_options`** - Selected options for each customization
  - Created via: `localDbUpsertTransactionItemCustomizationOptions`
  - Fields: id, transaction_item_customization_id, customization_option_id, option_name, price_adjustment

#### When Adding New Items to Existing Transaction (via "Lihat" mode):
- **`transactions`** - Updated totals (total_amount, final_amount)
  - Updated via: `localDbUpsertTransactions`
  
- **`transaction_items`** - New items added
  - Created via: `localDbUpsertTransactionItems`
  - Same structure as above, with production_status=NULL

#### When Cancelling/Reducing Locked Items:
- **`transaction_items`** - Updated production_status to 'cancelled'
  - Updated via: `localDbUpsertTransactionItems`
  - For reduce: Creates a NEW record with quantity=1 and production_status='cancelled'
  
- **`activity_logs`** - Logs the cancellation action
  - Created via: `logActivity` function
  - Fields: action_type='delete_locked_cart_item' or 'reduce_locked_cart_item', details (JSON)

#### When Processing Payment (via "Bayar"):
- **`transactions`** - Updated with payment info
  - Updated via: `localDbUpsertTransactions`
  - Fields updated: status='completed' (or 'paid'), payment_method, amount_received, change_amount, voucher fields, customer_name, etc.
  
- **`transaction_items`** - Only created if NEW transaction (not in "lihat" mode)
  - Created via: `localDbUpsertTransactionItems` (only for new transactions)
  
- **`printer1_audit_log`** - Logs when receipt is printed to Printer 1
  - Created via: `localDbInsertPrinter1AuditLog`
  - Fields: transaction_id, receipt_number, printed_at, etc.
  
- **`printer2_audit_log`** - Logs when receipt is printed to Printer 2
  - Created via: `localDbInsertPrinter2AuditLog`
  - Fields: transaction_id, receipt_number, printed_at, etc.

---

### 2. **Kitchen/Barista Pages**

#### When Marking Items as "Preparing" or "Finished":
- **`transaction_items`** - Updated production status
  - Updated via: `localDbUpsertTransactionItems`
  - Fields updated:
    - `production_status`: 'preparing' → 'finished'
    - `production_started_at`: Set when starting
    - `production_finished_at`: Set when finishing

**Note:** Kitchen/Barista pages only READ and UPDATE `transaction_items`. They do NOT create new transactions or modify other tables.

---

## Tables Synced to Server

When a transaction is synced to the server (via `smartSync.ts`), the following data is sent:

### Main Transaction Data:
- **`transactions`** table data (all fields)
  - Includes: id, business_id, user_id, payment_method, payment_method_id, pickup_method, total_amount, final_amount, status, customer_name, etc.

### Transaction Items:
- **`transaction_items`** table data (fetched fresh from database)
  - Includes: id (UUID), product_id, quantity, unit_price, total_price, custom_note, bundle_selections_json, production_status, created_at
  - **Important:** Items are fetched from the database at sync time, ensuring latest data including production_status updates

### Customizations:
- **`transaction_item_customizations`** table data (normalized)
  - Includes: id, transaction_item_id, customization_type_id, bundle_product_id, created_at
  
- **`transaction_item_customization_options`** table data (normalized)
  - Includes: id, transaction_item_customization_id, customization_option_id, option_name, price_adjustment, created_at

### Sync Payload Structure:
```json
{
  // Transaction fields
  "id": "uuid",
  "business_id": 14,
  "user_id": 1,
  "payment_method": "cash",
  "payment_method_id": 1,
  "pickup_method": "dine-in",
  "total_amount": 50000,
  "final_amount": 50000,
  "status": "completed",
  "customer_name": "John Doe",
  "created_at": "2025-01-14 14:40:00",
  
  // Items array
  "items": [
    {
      "id": "item-uuid",
      "product_id": 123,
      "quantity": 2,
      "unit_price": 25000,
      "total_price": 50000,
      "custom_note": "No ice",
      "bundle_selections_json": null,
      "created_at": "2025-01-14 14:40:00"
    }
  ],
  
  // Customizations array
  "transaction_item_customizations": [
    {
      "id": 1,
      "transaction_item_id": "item-uuid",
      "customization_type_id": 5,
      "bundle_product_id": null,
      "created_at": "2025-01-14 14:40:00"
    }
  ],
  
  // Customization options array
  "transaction_item_customization_options": [
    {
      "id": 1,
      "transaction_item_customization_id": 1,
      "customization_option_id": 10,
      "option_name": "Extra Sugar",
      "price_adjustment": 2000,
      "created_at": "2025-01-14 14:40:00"
    }
  ]
}
```

---

## Tables NOT Synced (Local Only)

These tables are used locally but are NOT synced to the server:

- **`printer1_audit_log`** - Local printer audit logs
- **`printer2_audit_log`** - Local printer audit logs

**Note:** Printer audit logs may be synced separately via a different sync mechanism (check `offlineSync.ts` for printer audit sync).

## Activity Logs Sync

**`activity_logs`** - Now synced as part of transaction sync payload:
- Included in transaction sync payload as `activity_logs` array
- Fetched by matching `transaction_id` in the `details` JSON field
- All columns synced: `id`, `user_id`, `action`, `business_id`, `details`, `created_at`

---

## Sync Process Flow

1. **Transaction Created/Updated** → Saved to local database with `sync_status='pending'`
2. **SmartSync Service** → Detects pending transactions (`sync_status='pending'`)
3. **Fetch Latest Data** → Retrieves fresh data from:
   - `transactions` table
   - `transaction_items` table (with latest production_status)
   - `transaction_item_customizations` table (normalized)
   - `transaction_item_customization_options` table (normalized)
4. **Build Payload** → Combines all data into single JSON payload
5. **Send to Server** → POST to `/api/transactions` endpoint
6. **Mark as Synced** → Updates `sync_status='synced'` in local database

---

## Important Notes

1. **Production Status is Synced**: When Kitchen/Barista updates `production_status`, this change IS included in the sync because items are fetched fresh from the database at sync time.

2. **Cancelled Items are Synced**: Items with `production_status='cancelled'` are included in the sync payload.

3. **Customizations are Normalized**: The sync process fetches customizations in a normalized format, ensuring all relationships are properly maintained.

4. **Transaction Items are Fetched Fresh**: The sync doesn't rely on the JSON blob in the transactions table. It fetches items directly from `transaction_items` table to ensure latest data.

5. **UUIDs are Used**: Both transactions and transaction_items use UUIDs (`uuid_id`) for reliable identification across local and server databases.

---

## Verification Checklist

To ensure complete sync, verify that the server receives:

- ✅ Transaction record with all fields
- ✅ All transaction_items (including cancelled items)
- ✅ All transaction_item_customizations
- ✅ All transaction_item_customization_options
- ✅ Latest production_status for each item
- ✅ All custom notes and bundle selections

