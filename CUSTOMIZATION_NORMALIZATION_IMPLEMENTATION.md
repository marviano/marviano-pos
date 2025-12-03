# Customization Normalization Implementation

## 📋 Overview

This document describes the implementation of normalized customization data upload to match the server's database schema.

## 🎯 Problem Statement

**Before:** The client was sending customization data as JSON blobs embedded in transaction items:
```typescript
{
  product_id: 1,
  quantity: 1,
  customizations: [...] // ❌ JSON blob
}
```

**Issue:** The server database uses **normalized tables** and doesn't have a `customizations` JSON column:
- `transaction_item_customizations` - Links transaction items to customization types
- `transaction_item_customization_options` - Stores selected options with price snapshots

## ✅ Solution Implemented

The client now sends **normalized customization data** in separate arrays, matching the server's schema:

```typescript
{
  id: "uuid",
  items: [...], // Basic item data
  transaction_item_customizations: [
    {
      id: 1,
      transaction_item_id: "item-uuid",
      customization_type_id: 5,
      bundle_product_id: null,
      created_at: "2025-01-01T00:00:00.000Z"
    }
  ],
  transaction_item_customization_options: [
    {
      id: 1,
      transaction_item_customization_id: 1,
      customization_option_id: 10,
      option_name: "Extra Shot",
      price_adjustment: 5000.00,
      created_at: "2025-01-01T00:00:00.000Z"
    }
  ]
}
```

## 🔧 Changes Made

### 1. **New IPC Handler** (`electron/main.ts`)

Added `localdb-get-transaction-item-customizations-normalized` handler:

```typescript
ipcMain.handle('localdb-get-transaction-item-customizations-normalized', async (event, transactionId: string) => {
  // Queries transaction_item_customizations and transaction_item_customization_options tables
  // Returns normalized data ready for server upload
  return {
    customizations: [...],
    options: [...]
  };
});
```

**What it does:**
- Gets all transaction items for a transaction
- For each item, queries `transaction_item_customizations`
- For each customization, queries `transaction_item_customization_options`
- Returns flat arrays ready for server upload

### 2. **Preload Exposure** (`electron/preload.ts`)

Added the new method to the Electron API:

```typescript
localDbGetTransactionItemCustomizationsNormalized: (transactionId: string) => 
  ipcRenderer.invoke('localdb-get-transaction-item-customizations-normalized', transactionId),
```

### 3. **TypeScript Types** (`src/types/electron.d.ts`)

Added type definitions:

```typescript
localDbGetTransactionItemCustomizationsNormalized?: (transactionId: string) => Promise<{
  customizations: Array<{
    id: number;
    transaction_item_id: string;
    customization_type_id: number;
    bundle_product_id: number | null;
    created_at: string;
  }>;
  options: Array<{
    id: number;
    transaction_item_customization_id: number;
    customization_option_id: number;
    option_name: string;
    price_adjustment: number;
    created_at: string;
  }>;
}>;
```

### 4. **Sync Upload Logic** (`src/components/SyncManagement.tsx`)

Modified `syncToCloud` function:

**Before:**
```typescript
const items = normalizeTransactionItems(rawItems).map(item => ({
  product_id: item.product_id,
  quantity: item.quantity,
  unit_price: item.unit_price,
  total_price: item.total_price,
  customizations: item.customizations || undefined, // ❌ JSON
  customNote: item.custom_note ?? undefined,
}));
```

**After:**
```typescript
const items = normalizeTransactionItems(rawItems).map(item => ({
  id: (item as UnknownRecord).id as string,  // ✅ Include UUID
  product_id: item.product_id,
  quantity: item.quantity,
  unit_price: item.unit_price,
  total_price: item.total_price,
  custom_note: item.custom_note ?? undefined,
  bundle_selections_json: (item as UnknownRecord).bundle_selections_json ?? undefined,
}));

// ✅ Get normalized customizations
const normalizedCustomizations = electronAPI.localDbGetTransactionItemCustomizationsNormalized 
  ? await electronAPI.localDbGetTransactionItemCustomizationsNormalized(transaction.id)
  : { customizations: [], options: [] };

const uploadData = {
  // ... transaction fields ...
  items,
  transaction_item_customizations: normalizedCustomizations.customizations, // ✅ NEW
  transaction_item_customization_options: normalizedCustomizations.options, // ✅ NEW
};
```

## 📊 Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    LOCAL DATABASE (SQLite)                   │
├─────────────────────────────────────────────────────────────┤
│ transaction_item_customizations                             │
│ ├─ id                                                        │
│ ├─ transaction_item_id (UUID)                              │
│ ├─ customization_type_id                                   │
│ └─ bundle_product_id                                        │
├─────────────────────────────────────────────────────────────┤
│ transaction_item_customization_options                      │
│ ├─ id                                                        │
│ ├─ transaction_item_customization_id                       │
│ ├─ customization_option_id                                 │
│ ├─ option_name (snapshot)                                  │
│ └─ price_adjustment (snapshot)                             │
└─────────────────────────────────────────────────────────────┘
                            ↓
        [NEW IPC HANDLER: get-transaction-item-customizations-normalized]
                            ↓
                    ┌─────────────┐
                    │  Flat Arrays │
                    └─────────────┘
                            ↓
                [SyncManagement.tsx: syncToCloud()]
                            ↓
        POST /api/transactions
        {
          items: [...],
          transaction_item_customizations: [...],
          transaction_item_customization_options: [...]
        }
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                   SERVER DATABASE (MySQL)                    │
├─────────────────────────────────────────────────────────────┤
│ transaction_item_customizations                             │
│ ├─ id (AUTO_INCREMENT)                                      │
│ ├─ transaction_item_id (int)                               │
│ ├─ uuid_transaction_item_id (varchar)                      │
│ ├─ customization_type_id                                   │
│ └─ bundle_product_id                                        │
├─────────────────────────────────────────────────────────────┤
│ transaction_item_customization_options                      │
│ ├─ id (AUTO_INCREMENT)                                      │
│ ├─ transaction_item_customization_id                       │
│ ├─ customization_option_id                                 │
│ ├─ option_name (snapshot)                                  │
│ └─ price_adjustment (snapshot)                             │
└─────────────────────────────────────────────────────────────┘
```

## 🎯 Benefits

1. **✅ Data Integrity** - Server can properly store normalized customization data
2. **✅ Better Analytics** - Easy to query "How many Extra Shots were sold?"
3. **✅ Performance** - No JSON parsing needed for queries
4. **✅ Referential Integrity** - Foreign keys enforce data consistency
5. **✅ Revenue Tracking** - Precise revenue attribution per option

## 📝 Upload Payload Structure

### Complete Transaction Upload Payload

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "business_id": 14,
  "user_id": 1,
  "shift_uuid": "550e8400-e29b-41d4-a716-446655440001",
  "payment_method": "cash",
  "pickup_method": "dine-in",
  "total_amount": 25000,
  "final_amount": 25000,
  "created_at": "2025-01-01T10:00:00.000Z",
  
  "items": [
    {
      "id": "item-uuid-1",
      "product_id": 101,
      "quantity": 1,
      "unit_price": 20000,
      "total_price": 25000,
      "custom_note": "Extra hot"
    }
  ],
  
  "transaction_item_customizations": [
    {
      "id": 1,
      "transaction_item_id": "item-uuid-1",
      "customization_type_id": 5,
      "bundle_product_id": null,
      "created_at": "2025-01-01T10:00:00.000Z"
    }
  ],
  
  "transaction_item_customization_options": [
    {
      "id": 1,
      "transaction_item_customization_id": 1,
      "customization_option_id": 10,
      "option_name": "Extra Shot",
      "price_adjustment": 5000.00,
      "created_at": "2025-01-01T10:00:00.000Z"
    }
  ]
}
```

## 🔄 What Still Needs to Be Done

### **Server-Side Implementation** (Not in this repo)

The server API endpoint `/api/transactions` needs to be updated to:

1. **Accept** the new normalized arrays:
   - `transaction_item_customizations`
   - `transaction_item_customization_options`

2. **Insert** data into the correct tables:
```javascript
// For each customization in the array
INSERT INTO transaction_item_customizations (
  transaction_item_id,
  uuid_transaction_item_id,
  customization_type_id,
  bundle_product_id,
  created_at
) VALUES (?, ?, ?, ?, ?)

// For each option in the array
INSERT INTO transaction_item_customization_options (
  transaction_item_customization_id,
  customization_option_id,
  option_name,
  price_adjustment,
  created_at
) VALUES (?, ?, ?, ?, ?)
```

3. **Handle** UUID to ID mapping:
   - Local DB uses UUIDs for transaction_item_id
   - Server DB uses auto-increment IDs
   - Server needs to map: `uuid_transaction_item_id` → `transaction_item_id`

## ✅ Testing Checklist

- [x] No linter errors
- [x] TypeScript types properly defined
- [ ] Test transaction upload with customizations
- [ ] Verify server receives normalized arrays
- [ ] Check server database has correct data
- [ ] Test bundle products with customizations
- [ ] Test main product + bundle product customizations

## 📚 Related Files

- `electron/main.ts` - New IPC handler
- `electron/preload.ts` - API exposure
- `src/types/electron.d.ts` - TypeScript types
- `src/components/SyncManagement.tsx` - Upload logic
- Server: `/api/transactions` endpoint (needs update)

## 🎉 Summary

This implementation ensures that **all transaction customization data** is properly uploaded to the server in **normalized format**, matching the server's MySQL database schema. The local SQLite database already stores data in normalized tables, so we're now correctly exposing and uploading that normalized structure instead of converting it to JSON.

---

## 🔄 Update: SmartSync Integration (Nov 28, 2025)

### SmartSync Now Uses Complete Normalized Data

**Updated:** `src/lib/smartSync.ts` - `processBatch()` method

SmartSync has been updated to fetch and send the **same complete normalized customization data** as Sinkronisasi Lengkap:

**Changes Made:**
1. ✅ **Fetches items from `transaction_items` table** (source of truth)
   - Ensures items have UUIDs
   - Gets latest data structure
   
2. ✅ **Fetches normalized customizations** via `localDbGetTransactionItemCustomizationsNormalized`
   - Gets `transaction_item_customizations` array
   - Gets `transaction_item_customization_options` array
   
3. ✅ **Adds arrays to upload payload**
   - `transaction_item_customizations`
   - `transaction_item_customization_options`

**Code Location:**
```typescript
// src/lib/smartSync.ts - Line ~354
// Before sending to /api/transactions:

// Fetch transaction items from transaction_items table (source of truth)
const rawItems = await electronAPI.localDbGetTransactionItems(transactionId);
transactionData.items = rawItems.map(item => ({
  id: item.id, // UUID
  product_id: item.product_id,
  quantity: item.quantity,
  unit_price: item.unit_price,
  total_price: item.total_price,
  custom_note: item.custom_note,
  bundle_selections_json: item.bundle_selections_json,
}));

// Fetch normalized customizations
const normalizedCustomizations = await electronAPI.localDbGetTransactionItemCustomizationsNormalized(transactionId);
transactionData.transaction_item_customizations = normalizedCustomizations.customizations;
transactionData.transaction_item_customization_options = normalizedCustomizations.options;
```

**Result:**
- ✅ **SmartSync** (automatic, every 30s) → Full normalized data
- ✅ **Sinkronisasi Lengkap** (manual button) → Full normalized data
- ✅ **Both use the EXACT SAME format**

---

**Implementation Date:** November 28, 2025
**Status:** ✅ **FULLY COMPLETE** - Both sync methods now use normalized customization data
**Server-side:** ⏳ Pending - Server needs to handle the normalized arrays

