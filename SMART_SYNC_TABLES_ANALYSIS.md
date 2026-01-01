# Smart Sync - Tables Used Analysis

## ✅ Smart Sync Status: **WORKING**

The smart sync code is properly implemented and should work correctly. It:
- Reads from local MySQL database tables
- Uploads data to remote MySQL database via API endpoints
- Includes comprehensive error handling and logging
- Processes data in batches to prevent server overload

---

## 📊 Tables Used During Smart Sync

### **Local MySQL Database (Read From)**

Smart sync **READS** data from these local MySQL tables:

#### 1. **Transactions**
- **Table**: `transactions`
- **Query**: `SELECT * FROM transactions WHERE sync_status = 'pending'`
- **Used By**: `localdb-get-unsynced-transactions`
- **Fields Used**: All transaction fields (id, uuid_id, business_id, user_id, payment_method, etc.)
- **Note**: Also fetches related `transaction_items` via JOIN

#### 2. **Transaction Items**
- **Table**: `transaction_items`
- **Query**: `SELECT * FROM transaction_items WHERE transaction_id = ?`
- **Used By**: `localdb-get-transaction-items`
- **Fields Used**: All item fields including:
  - `id` (UUID)
  - `uuid_id`
  - `transaction_id`
  - `uuid_transaction_id`
  - `product_id`
  - `quantity`
  - `unit_price`
  - `total_price`
  - `custom_note`
  - `bundle_selections_json`
  - `created_at`
  - `production_status`
  - `production_started_at`
  - `production_finished_at`

#### 3. **Transaction Item Customizations**
- **Table**: `transaction_item_customizations`
- **Query**: `SELECT id, transaction_item_id, customization_type_id, bundle_product_id, created_at FROM transaction_item_customizations WHERE transaction_item_id = ?`
- **Used By**: `localdb-get-transaction-item-customizations-normalized`
- **Fields Used**: All customization fields

#### 4. **Transaction Item Customization Options**
- **Table**: `transaction_item_customization_options`
- **Query**: `SELECT id, transaction_item_customization_id, customization_option_id, option_name, price_adjustment, created_at FROM transaction_item_customization_options WHERE transaction_item_customization_id = ?`
- **Used By**: `localdb-get-transaction-item-customizations-normalized`
- **Fields Used**: All option fields

#### 5. **Shifts**
- **Table**: `shifts`
- **Query**: `SELECT * FROM shifts WHERE synced_at IS NULL`
- **Used By**: `localdb-get-unsynced-shifts`
- **Fields Used**: All shift fields (uuid_id, business_id, user_id, shift_start, shift_end, modal_awal, kas_akhir, etc.)

#### 6. **Refunds**
- **Table**: `offline_refunds`
- **Query**: `SELECT id, refund_data, created_at, sync_attempts, last_sync_attempt FROM offline_refunds WHERE sync_status = 'pending'`
- **Used By**: `localdb-get-pending-refunds`
- **Fields Used**: Refund data stored as JSON in `refund_data` field
- **Note**: This is a special queue table, not the actual `transaction_refunds` table

#### 7. **Printer 1 Audit Log**
- **Table**: `printer1_audit_log`
- **Query**: `SELECT * FROM printer1_audit_log WHERE synced_at IS NULL`
- **Used By**: `localdb-get-unsynced-printer-audits`
- **Fields Used**: All audit fields including:
  - `id`
  - `transaction_id`
  - `printer1_receipt_number`
  - `global_counter`
  - `printed_at`
  - `printed_at_epoch`
  - `reprint_count`
  - `is_reprint`

#### 8. **Printer 2 Audit Log**
- **Table**: `printer2_audit_log`
- **Query**: `SELECT * FROM printer2_audit_log WHERE synced_at IS NULL`
- **Used By**: `localdb-get-unsynced-printer-audits`
- **Fields Used**: All audit fields including:
  - `id`
  - `transaction_id`
  - `printer2_receipt_number`
  - `print_mode`
  - `cycle_number`
  - `printed_by_user_id`
  - `business_id`
  - `printed_at`
  - `printed_at_epoch`
  - `global_counter`
  - `reprint_count`
  - `is_reprint`

#### 9. **Printer Daily Counters**
- **Table**: `printer_daily_counters`
- **Query**: `SELECT printer_type, business_id, date, counter FROM printer_daily_counters`
- **Used By**: `localdb-get-all-printer-daily-counters`
- **Fields Used**: All counter fields

---

### **Remote MySQL Database (Write To)**

Smart sync **WRITES/UPSERTS** data to these remote MySQL tables via API endpoints:

#### 1. **Transactions**
- **Table**: `transactions`
- **API Endpoint**: `POST /api/transactions`
- **Operation**: `INSERT ... ON DUPLICATE KEY UPDATE` (upsert by `uuid_id`)
- **Fields Written**: All transaction fields
- **Note**: Uses UUID as primary key for upsert

#### 2. **Transaction Items**
- **Table**: `transaction_items`
- **API Endpoint**: `POST /api/transactions` (included in transaction payload)
- **Operation**: DELETE existing items, then INSERT new ones (complete replacement)
- **Fields Written**: All item fields

#### 3. **Transaction Item Customizations**
- **Table**: `transaction_item_customizations`
- **API Endpoint**: `POST /api/transactions` (included in transaction payload)
- **Operation**: DELETE existing customizations, then INSERT new ones (complete replacement)
- **Fields Written**: All customization fields

#### 4. **Transaction Item Customization Options**
- **Table**: `transaction_item_customization_options`
- **API Endpoint**: `POST /api/transactions` (included in transaction payload)
- **Operation**: DELETE existing options, then INSERT new ones (complete replacement)
- **Fields Written**: All option fields

#### 5. **Shifts**
- **Table**: `shifts`
- **API Endpoint**: `POST /api/shifts`
- **Operation**: Upsert (insert or update by UUID)
- **Fields Written**: All shift fields

#### 6. **Transaction Refunds**
- **Table**: `transaction_refunds`
- **API Endpoint**: `POST /api/transactions/{transactionUuid}/refund`
- **Operation**: INSERT new refund record
- **Fields Written**: All refund fields
- **Note**: Also updates parent `transactions` table (refund_total, refund_status, etc.)

#### 7. **Printer 1 Audit Log**
- **Table**: `printer1_audit_log` (if exists on server)
- **API Endpoint**: `POST /api/printer-audits`
- **Operation**: INSERT new audit records
- **Fields Written**: All audit fields

#### 8. **Printer 2 Audit Log**
- **Table**: `printer2_audit_log` (if exists on server)
- **API Endpoint**: `POST /api/printer-audits`
- **Operation**: INSERT new audit records
- **Fields Written**: All audit fields

#### 9. **Printer Audits (General)**
- **Table**: `printer_audits` (if exists on server)
- **API Endpoint**: `POST /api/printer-audits`
- **Operation**: INSERT new audit records
- **Fields Written**: General audit fields

#### 10. **Printer Daily Counters**
- **Table**: `printer_daily_counters`
- **API Endpoint**: `POST /api/printer-daily-counters`
- **Operation**: Upsert (insert or update by unique key: printer_type, business_id, date)
- **Fields Written**: All counter fields

---

## 🔄 Sync Flow Summary

### Transaction Sync Flow:
1. **Read**: `transactions` (WHERE sync_status = 'pending')
2. **Read**: `transaction_items` (for each transaction)
3. **Read**: `transaction_item_customizations` (for each item)
4. **Read**: `transaction_item_customization_options` (for each customization)
5. **Write**: `POST /api/transactions` → Upserts to MySQL `transactions`, `transaction_items`, `transaction_item_customizations`, `transaction_item_customization_options`

### Shift Sync Flow:
1. **Read**: `shifts` (WHERE synced_at IS NULL)
2. **Write**: `POST /api/shifts` → Upserts to MySQL `shifts`

### Refund Sync Flow:
1. **Read**: `offline_refunds` (WHERE sync_status = 'pending')
2. **Write**: `POST /api/transactions/{uuid}/refund` → Inserts to MySQL `transaction_refunds` + Updates MySQL `transactions`

### Printer Audit Sync Flow:
1. **Read**: `printer1_audit_log` (WHERE synced_at IS NULL)
2. **Read**: `printer2_audit_log` (WHERE synced_at IS NULL)
3. **Write**: `POST /api/printer-audits` → Inserts to MySQL `printer1_audit_log`, `printer2_audit_log`, `printer_audits`

### Printer Daily Counters Sync Flow:
1. **Read**: `printer_daily_counters` (all records)
2. **Write**: `POST /api/printer-daily-counters` → Upserts to MySQL `printer_daily_counters`

---

## ⚠️ Important Notes

1. **Local Database is Source of Truth**: Smart sync **UPLOADS** data from local MySQL to remote MySQL. It does NOT download transaction/refund/shift data from server.

2. **Complete Replacement**: For transactions, the server API deletes and re-inserts all related items, customizations, and options to ensure complete data replacement (not merge).

3. **UUID-Based Identification**: All sync operations use UUID (`uuid_id`) as the primary identifier, not numeric IDs.

4. **Queue Table for Refunds**: Refunds are stored in `offline_refunds` table as JSON, then parsed and sent to server. The server creates actual `transaction_refunds` records.

5. **Sync Status Tracking**: Local tables use fields like `sync_status`, `synced_at`, `sync_attempts` to track sync state.

---

## ✅ Verification Checklist

Before testing, verify these tables exist in your local MySQL database:
- [x] `transactions` (with `sync_status` column)
- [x] `transaction_items`
- [x] `transaction_item_customizations`
- [x] `transaction_item_customization_options`
- [x] `shifts` (with `synced_at` column)
- [x] `offline_refunds` (with `sync_status` column)
- [x] `printer1_audit_log` (with `synced_at` column)
- [x] `printer2_audit_log` (with `synced_at` column)
- [x] `printer_daily_counters`

All these tables should match the schema provided in your database design document.

