# Server `/api/sync` Endpoint Requirements

## 📋 Overview

The `/api/sync` endpoint must return **ALL transaction-related data** to ensure complete synchronization when clients perform "Restore from Server" or "Sinkronisasi Lengkap" operations.

**Status:** ⚠️ **SERVER UPDATE REQUIRED**

---

## ✅ **Required Response Format**

### **Endpoint:** `GET /api/sync`

### **Response Structure:**

```json
{
  "success": true,
  "businessId": 14,
  "counts": {
    "products": 150,
    "transactions": 1250,
    "transactionItems": 3500,
    "transactionItemCustomizations": 1800,
    "transactionItemCustomizationOptions": 4200,
    "shifts": 85,
    "transactionRefunds": 12,
    "printer1AuditLog": 1240,
    "printer2AuditLog": 890
  },
  "data": {
    // Master Data
    "category1": [...],
    "category2": [...],
    "customizationTypes": [...],
    "customizationOptions": [...],
    "products": [...],
    "productCustomizations": [...],
    "bundleItems": [...],
    "paymentMethods": [...],
    "banks": [...],
    "organizations": [...],
    "managementGroups": [...],
    "clAccounts": [...],
    
    // Transaction Data (ALL 8 TABLES REQUIRED)
    "transactions": [...],                            // ✅ Already implemented
    "transactionItems": [...],                        // ✅ Already implemented
    "transactionItemCustomizations": [...],           // ⚠️ MISSING - REQUIRED
    "transactionItemCustomizationOptions": [...],     // ⚠️ MISSING - REQUIRED
    "shifts": [...],                                  // ⚠️ MISSING - REQUIRED
    "transactionRefunds": [...],                      // ⚠️ MISSING - REQUIRED
    "printer1AuditLog": [...],                        // ⚠️ MISSING - REQUIRED
    "printer2AuditLog": [...]                         // ⚠️ MISSING - REQUIRED
  }
}
```

---

## 📦 **Complete Data Field Specifications**

### 1️⃣ **Transactions** ✅ (Already Implemented)

```typescript
"transactions": [
  {
    "id": "uuid-string",  // UUID primary key
    "business_id": 14,
    "user_id": 1,
    "shift_uuid": "shift-uuid",
    "payment_method": "cash",
    "payment_method_id": 1,
    "pickup_method": "dine-in",
    "total_amount": 25000,
    "voucher_discount": 0,
    "voucher_type": "none",
    "voucher_value": null,
    "voucher_label": null,
    "final_amount": 25000,
    "amount_received": 25000,
    "change_amount": 0,
    "status": "completed",
    "contact_id": null,
    "customer_name": null,
    "customer_unit": null,
    "note": null,
    "bank_name": null,
    "card_number": null,
    "cl_account_id": null,
    "cl_account_name": null,
    "bank_id": null,
    "receipt_number": 42,
    "transaction_type": "sale",
    "refund_status": "none",
    "refund_total": 0,
    "last_refunded_at": null,
    "created_at": "2025-01-01T10:00:00.000Z",
    "updated_at": null,
    "synced_at": 1704096000000
  }
]
```

### 2️⃣ **Transaction Items** ✅ (Already Implemented)

```typescript
"transactionItems": [
  {
    "id": "item-uuid",  // UUID primary key
    "transaction_id": "transaction-uuid",
    "product_id": 101,
    "quantity": 1,
    "unit_price": 20000,
    "total_price": 25000,
    "bundle_selections_json": null,  // JSON string (if product is bundle)
    "custom_note": "Extra hot",
    "created_at": "2025-01-01T10:00:00.000Z"
  }
]
```

### 3️⃣ **Transaction Item Customizations** ⚠️ (MISSING - REQUIRED)

**Database Table:** `transaction_item_customizations`

```typescript
"transactionItemCustomizations": [
  {
    "id": 1,  // Auto-increment ID
    "transaction_item_id": "item-uuid",  // FK to transaction_items.id (UUID)
    "customization_type_id": 5,  // FK to product_customization_types.id
    "bundle_product_id": null,  // NULL = main product, or bundle product ID
    "created_at": "2025-01-01T10:00:00.000Z"
  }
]
```

**SQL Query Example:**
```sql
SELECT 
  id,
  transaction_item_id,
  customization_type_id,
  bundle_product_id,
  created_at
FROM transaction_item_customizations
WHERE transaction_item_id IN (
  SELECT ti.id 
  FROM transaction_items ti
  JOIN transactions t ON ti.transaction_id = t.id
  WHERE t.business_id = ?
);
```

### 4️⃣ **Transaction Item Customization Options** ⚠️ (MISSING - REQUIRED)

**Database Table:** `transaction_item_customization_options`

```typescript
"transactionItemCustomizationOptions": [
  {
    "id": 1,  // Auto-increment ID
    "transaction_item_customization_id": 1,  // FK to transaction_item_customizations.id
    "customization_option_id": 10,  // FK to product_customization_options.id
    "option_name": "Extra Shot",  // Snapshot at time of sale
    "price_adjustment": 5000.00,  // Snapshot at time of sale
    "created_at": "2025-01-01T10:00:00.000Z"
  }
]
```

**SQL Query Example:**
```sql
SELECT 
  tico.id,
  tico.transaction_item_customization_id,
  tico.customization_option_id,
  tico.option_name,
  tico.price_adjustment,
  tico.created_at
FROM transaction_item_customization_options tico
JOIN transaction_item_customizations tic ON tico.transaction_item_customization_id = tic.id
JOIN transaction_items ti ON tic.transaction_item_id = ti.id
JOIN transactions t ON ti.transaction_id = t.id
WHERE t.business_id = ?;
```

### 5️⃣ **Shifts** ⚠️ (MISSING - REQUIRED)

**Database Table:** `shifts`

```typescript
"shifts": [
  {
    "id": 1,  // Auto-increment ID
    "uuid_id": "shift-uuid",  // UUID (unique)
    "business_id": 14,
    "user_id": 1,
    "user_name": "Kasir 1",
    "shift_start": "2025-01-01T09:00:00.000Z",
    "shift_end": "2025-01-01T17:00:00.000Z",
    "modal_awal": 100000,
    "kas_akhir": 500000,
    "kas_expected": 480000,
    "kas_selisih": 20000,
    "kas_selisih_label": "plus",  // "plus", "minus", "balanced"
    "cash_sales_total": 380000,
    "cash_refund_total": 0,
    "status": "completed",  // "active", "completed", "cancelled"
    "created_at": "2025-01-01T09:00:00.000Z",
    "updated_at": null,
    "synced_at": 1704096000000
  }
]
```

**SQL Query Example:**
```sql
SELECT 
  id,
  uuid_id,
  business_id,
  user_id,
  user_name,
  shift_start,
  shift_end,
  modal_awal,
  kas_akhir,
  kas_expected,
  kas_selisih,
  kas_selisih_label,
  cash_sales_total,
  cash_refund_total,
  status,
  created_at,
  updated_at,
  synced_at
FROM shifts
WHERE business_id = ?
ORDER BY shift_start DESC;
```

### 6️⃣ **Transaction Refunds** ⚠️ (MISSING - REQUIRED)

**Database Table:** `transaction_refunds`

```typescript
"transactionRefunds": [
  {
    "id": 1,  // Auto-increment ID
    "uuid_id": "refund-uuid",  // UUID (unique)
    "transaction_uuid": "transaction-uuid",  // FK to transactions.id
    "business_id": 14,
    "shift_uuid": "shift-uuid",  // FK to shifts.uuid_id
    "refunded_by": 1,  // User ID who processed refund
    "refund_amount": 25000,
    "cash_delta": -25000,  // Cash adjustment for shift
    "payment_method_id": 1,
    "reason": "Customer complaint",
    "note": "Product not as expected",
    "refund_type": "full",  // "full" or "partial"
    "status": "completed",  // "pending", "completed", "cancelled"
    "refunded_at": "2025-01-01T11:00:00.000Z",
    "created_at": "2025-01-01T11:00:00.000Z",
    "updated_at": null,
    "synced_at": 1704099600000
  }
]
```

**SQL Query Example:**
```sql
SELECT 
  id,
  uuid_id,
  transaction_uuid,
  business_id,
  shift_uuid,
  refunded_by,
  refund_amount,
  cash_delta,
  payment_method_id,
  reason,
  note,
  refund_type,
  status,
  refunded_at,
  created_at,
  updated_at,
  synced_at
FROM transaction_refunds
WHERE business_id = ?
ORDER BY refunded_at DESC;
```

### 7️⃣ **Printer 1 Audit Log** ⚠️ (MISSING - REQUIRED)

**Database Table:** `printer1_audit_log`

```typescript
"printer1AuditLog": [
  {
    "id": 1,  // Auto-increment ID
    "transaction_id": "transaction-uuid",  // FK to transactions.id
    "printer1_receipt_number": 42,  // Incremental receipt number
    "global_counter": 1234,  // Global printer counter
    "printed_at": "2025-01-01T10:00:00.000Z",
    "printed_at_epoch": 1704096000000,
    "is_reprint": 0,  // 0 = original, 1 = reprint
    "reprint_count": 0,
    "synced_at": 1704096000000
  }
]
```

**SQL Query Example:**
```sql
SELECT 
  p1.id,
  p1.transaction_id,
  p1.printer1_receipt_number,
  p1.global_counter,
  p1.printed_at,
  p1.printed_at_epoch,
  p1.is_reprint,
  p1.reprint_count,
  p1.synced_at
FROM printer1_audit_log p1
JOIN transactions t ON p1.transaction_id = t.id
WHERE t.business_id = ?
ORDER BY p1.printed_at_epoch DESC;
```

### 8️⃣ **Printer 2 Audit Log** ⚠️ (MISSING - REQUIRED)

**Database Table:** `printer2_audit_log`

```typescript
"printer2AuditLog": [
  {
    "id": 1,  // Auto-increment ID
    "transaction_id": "transaction-uuid",  // FK to transactions.id
    "printer2_receipt_number": 15,  // Incremental receiptize number
    "print_mode": "auto",  // "auto" or "manual"
    "cycle_number": 3,  // For auto print cycle
    "global_counter": 5678,  // Global printer counter
    "printed_at": "2025-01-01T10:00:00.000Z",
    "printed_at_epoch": 1704096000000,
    "is_reprint": 0,  // 0 = original, 1 = reprint
    "reprint_count": 0,
    "synced_at": 1704096000000
  }
]
```

**SQL Query Example:**
```sql
SELECT 
  p2.id,
  p2.transaction_id,
  p2.printer2_receipt_number,
  p2.print_mode,
  p2.cycle_number,
  p2.global_counter,
  p2.printed_at,
  p2.printed_at_epoch,
  p2.is_reprint,
  p2.reprint_count,
  p2.synced_at
FROM printer2_audit_log p2
JOIN transactions t ON p2.transaction_id = t.id
WHERE t.business_id = ?
ORDER BY p2.printed_at_epoch DESC;
```

---

## 🎯 **Implementation Checklist**

### **Server-Side Changes Required:**

- [ ] Add `transactionItemCustomizations` query and response
- [ ] Add `transactionItemCustomizationOptions` query and response
- [ ] Add `shifts` query and response
- [ ] Add `transactionRefunds` query and response
- [ ] Add `printer1AuditLog` query and response
- [ ] Add `printer2AuditLog` query and response
- [ ] Update `/api/sync` endpoint to include all 8 tables
- [ ] Add counts for all 8 tables in response `counts` object
- [ ] Test with large dataset to ensure performance

### **Client-Side Changes:** ✅ COMPLETE

- [x] Add IPC handlers for all missing tables
- [x] Add TypeScript types for new handlers
- [x] Update `syncFromCloud()` to download all 8 tables
- [x] Add logging for each table download
- [x] Test with mock server response

---

## 🔄 **Data Relationships**

```
businesses (id: 14)
    │
    ├─→ shifts (uuid_id)
    │       │
    │       └─→ transactions (shift_uuid)
    │               │
    │               ├─→ transaction_items (transaction_id, id=UUID)
    │               │       │
    │               │       └─→ transaction_item_customizations (transaction_item_id)
    │               │               │
    │               │               └─→ transaction_item_customization_options (transaction_item_customization_id)
    │               │
    │               ├─→ transaction_refunds (transaction_uuid)
    │               ├─→ printer1_audit_log (transaction_id)
    │               └─→ printer2_audit_log (transaction_id)
    │
    └─→ products, categories, payment_methods, etc. (master data)
```

---

## ⚡ **Performance Considerations**

### **Query Optimization:**

1. **Use JOINs efficiently** - Join with `transactions` table filtered by `business_id`
2. **Add indexes:**
   ```sql
   CREATE INDEX idx_tic_transaction_item_id ON transaction_item_customizations(transaction_item_id);
   CREATE INDEX idx_tico_customization_id ON transaction_item_customization_options(transaction_item_customization_id);
   CREATE INDEX idx_shifts_business ON shifts(business_id, shift_start);
   CREATE INDEX idx_refunds_business ON transaction_refunds(business_id, refunded_at);
   CREATE INDEX idx_p1_audit_transaction ON printer1_audit_log(transaction_id);
   CREATE INDEX idx_p2_audit_transaction ON printer2_audit_log(transaction_id);
   ```

3. **Pagination considerations:**
   - For large datasets (>10,000 transactions), consider:
     - Date-based filtering (last 3 months?)
     - Incremental sync with `synced_at` timestamps
     - Separate endpoint for historical data

### **Response Size Estimation:**

For a business with **1,000 transactions**:
- Transactions: ~500 KB
- Transaction Items: ~800 KB
- Customizations: ~400 KB
- Customization Options: ~600 KB
- Shifts: ~50 KB
- Refunds: ~20 KB
- Printer Audits: ~300 KB

**Total:** ~2.7 MB (acceptable for sync operation)

---

## 🧪 **Testing Requirements**

### **Server Tests:**

1. **Endpoint returns all 8 tables**
   ```bash
   GET /api/sync
   
   # Verify response includes:
   - data.transactions ✓
   - data.transactionItems ✓
   - data.transactionItemCustomizations ✓
   - data.transactionItemCustomizationOptions ✓
   - data.shifts ✓
   - data.transactionRefunds ✓
   - data.printer1AuditLog ✓
   - data.printer2AuditLog ✓
   ```

2. **Data integrity**
   - All customizations have corresponding transaction items
   - All customization options have corresponding customizations
   - All transaction items belong to transactions
   - All refunds reference valid transactions
   - All printer audits reference valid transactions

3. **Performance**
   - Query completes in <5 seconds for 1,000 transactions
   - Response size is reasonable (<10 MB)

### **Client Tests:**

1. **Download all 8 tables successfully**
2. **UPSERT operations work correctly** (no duplicates)
3. **Relationships maintained** (FKs intact)
4. **Transaction with customizations displays correctly**
5. **Shifts show correct transaction counts**
6. **Refunds appear in transaction history**
7. **Printer audit logs show correct receipt numbers**

---

## 📝 **Example Server Implementation (Node.js/Express)**

```typescript
app.get('/api/sync', async (req, res) => {
  const businessId = req.query.businessId || 14;
  
  try {
    // Fetch all data
    const [
      category1,
      category2,
      products,
      // ... other master data ...
      
      // Transaction data
      transactions,
      transactionItems,
      transactionItemCustomizations,
      transactionItemCustomizationOptions,
      shifts,
      transactionRefunds,
      printer1AuditLog,
      printer2AuditLog
    ] = await Promise.all([
      db.query('SELECT * FROM category1 WHERE business_id = ?', [businessId]),
      db.query('SELECT * FROM category2 WHERE business_id = ?', [businessId]),
      db.query('SELECT * FROM products WHERE business_id = ?', [businessId]),
      // ... other master data queries ...
      
      // Transaction queries
      db.query('SELECT * FROM transactions WHERE business_id = ? ORDER BY created_at DESC', [businessId]),
      db.query(`
        SELECT ti.* 
        FROM transaction_items ti
        JOIN transactions t ON ti.transaction_id = t.id
        WHERE t.business_id = ?
      `, [businessId]),
      db.query(`
        SELECT tic.* 
        FROM transaction_item_customizations tic
        JOIN transaction_items ti ON tic.transaction_item_id = ti.id
        JOIN transactions t ON ti.transaction_id = t.id
        WHERE t.business_id = ?
      `, [businessId]),
      db.query(`
        SELECT tico.* 
        FROM transaction_item_customization_options tico
        JOIN transaction_item_customizations tic ON tico.transaction_item_customization_id = tic.id
        JOIN transaction_items ti ON tic.transaction_item_id = ti.id
        JOIN transactions t ON ti.transaction_id = t.id
        WHERE t.business_id = ?
      `, [businessId]),
      db.query('SELECT * FROM shifts WHERE business_id = ? ORDER BY shift_start DESC', [businessId]),
      db.query('SELECT * FROM transaction_refunds WHERE business_id = ? ORDER BY refunded_at DESC', [businessId]),
      db.query(`
        SELECT p1.* 
        FROM printer1_audit_log p1
        JOIN transactions t ON p1.transaction_id = t.id
        WHERE t.business_id = ?
      `, [businessId]),
      db.query(`
        SELECT p2.* 
        FROM printer2_audit_log p2
        JOIN transactions t ON p2.transaction_id = t.id
        WHERE t.business_id = ?
      `, [businessId])
    ]);
    
    res.json({
      success: true,
      businessId,
      counts: {
        products: products.length,
        transactions: transactions.length,
        transactionItems: transactionItems.length,
        transactionItemCustomizations: transactionItemCustomizations.length,
        transactionItemCustomizationOptions: transactionItemCustomizationOptions.length,
        shifts: shifts.length,
        transactionRefunds: transactionRefunds.length,
        printer1AuditLog: printer1AuditLog.length,
        printer2AuditLog: printer2AuditLog.length
      },
      data: {
        category1,
        category2,
        products,
        // ... other master data ...
        transactions,
        transactionItems,
        transactionItemCustomizations,
        transactionItemCustomizationOptions,
        shifts,
        transactionRefunds,
        printer1AuditLog,
        printer2AuditLog
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});
```

---

## ✅ **Final Status**

### **Client-Side: 100% COMPLETE ✅**
- All IPC handlers implemented
- All TypeScript types defined
- `syncFromCloud()` updated to download all 8 tables
- No duplicates (UPSERT with `ON CONFLICT` prevents duplicates)

### **Server-Side: PENDING IMPLEMENTATION ⚠️**
- `/api/sync` must return all 8 transaction-related tables
- 6 tables currently missing from response
- Implementation required before "Restore from Server" will work properly

---

**Implementation Date:** November 28, 2025  
**Client Status:** ✅ Complete  
**Server Status:** ⚠️ Awaiting Implementation  
**Priority:** 🔴 HIGH - Required for complete data backup/restore

