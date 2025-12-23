# Alur Pemrosesan Transaksi - Dokumentasi Lengkap

Dokumen ini menjelaskan **seluruh alur pemrosesan transaksi** dari saat pembayaran sampai sinkronisasi ke server, termasuk semua operasi database yang terjadi.

---

## 📋 Ringkasan Eksekutif

Ketika transaksi terjadi, sistem melakukan **6 operasi database utama** dalam urutan berikut:

1. **INSERT/UPDATE `transactions`** - Menyimpan data transaksi utama dengan `sync_status = 'pending'`
2. **INSERT/UPDATE `transaction_items`** - Menyimpan item-item dalam transaksi
3. **INSERT `transaction_item_customizations`** - Menyimpan customizations untuk item utama
4. **INSERT `transaction_item_customization_options`** - Menyimpan opsi-opsi customization
5. **INSERT `system_pos_queue`** - Queue untuk sync ke System POS (Receiptize)

**Catatan**: Tabel `offline_transactions` dan `offline_transaction_items` telah dihapus. Sistem sekarang menggunakan kolom `sync_status` langsung di tabel `transactions`.

---

## 🔄 Alur Lengkap Pemrosesan Transaksi

### **Langkah 1: User Menyelesaikan Pembayaran**

**File**: `src/components/PaymentModal.tsx` (Line ~600-685)

Ketika user klik "Bayar", sistem membuat objek `transactionData` dengan semua informasi transaksi:

```typescript
transactionData = {
  id: generateTransactionId(),           // UUID
  business_id: businessId,
  user_id: currentUserId,
  shift_uuid: activeShiftUuid,           // Auto-linked jika tidak ada
  payment_method: 'cash' | 'debit' | ...,
  pickup_method: 'dine-in' | 'take-away',
  total_amount: orderTotal,
  voucher_discount: voucherDiscount,
  final_amount: finalTotal,
  amount_received: receivedVal,
  change_amount: changeVal,
  status: 'paid',                         // Baru diubah dari 'completed'
  created_at: new Date().toISOString(),
  synced_at: null,                        // NULL karena belum di-sync
  // ... field lainnya
}
```

**Operasi Database**: Belum ada (hanya in-memory)

---

### **Langkah 2: Menyimpan Transaksi ke Tabel `transactions`**

**File**: `src/components/PaymentModal.tsx` (Line 680)  
**Handler**: `electron/main.ts` (Line 2911-3002)

```typescript
await electronAPI.localDbUpsertTransactions?.([sqliteTransactionData]);
```

**Operasi Database**:

```sql
INSERT INTO transactions (
  id, business_id, user_id, shift_uuid, payment_method, pickup_method,
  total_amount, voucher_discount, voucher_type, voucher_value, voucher_label,
  final_amount, amount_received, change_amount, status,
  created_at, updated_at, synced_at,  -- synced_at = NULL
  contact_id, customer_name, customer_unit, note, bank_name,
  card_number, cl_account_id, cl_account_name, bank_id, receipt_number,
  transaction_type, payment_method_id
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  business_id=excluded.business_id,
  -- ... update semua field
```

**Catatan Penting**:
- `synced_at` = **NULL** (belum di-sync)
- `receipt_number` = **NULL** (akan di-generate saat sync ke server)
- Jika `shift_uuid` tidak ada, sistem **auto-link** ke shift aktif user
- Menggunakan `ON CONFLICT DO UPDATE` untuk upsert (insert atau update jika sudah ada)

**Tabel**: `transactions`

---

### **Langkah 3: Menyimpan Item-Item Transaksi**

**File**: `src/components/PaymentModal.tsx` (Line 681)  
**Handler**: `electron/main.ts` (Line 3393-3488)

```typescript
await electronAPI.localDbUpsertTransactionItems?.(transactionItems);
```

**Operasi Database**:

```sql
INSERT INTO transaction_items (
  id, transaction_id, product_id, quantity, unit_price, total_price,
  bundle_selections_json, custom_note, created_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  transaction_id=excluded.transaction_id,
  product_id=excluded.product_id,
  quantity=excluded.quantity,
  unit_price=excluded.unit_price,
  total_price=excluded.total_price,
  bundle_selections_json=excluded.bundle_selections_json,
  custom_note=excluded.custom_note,
  created_at=excluded.created_at
```

**Tabel**: `transaction_items`

**Setelah INSERT item, sistem juga menyimpan customizations** (Langkah 4-5)

---

### **Langkah 4: Menyimpan Customizations Item Utama**

**File**: `electron/main.ts` (Line 3435-3450)

Setelah INSERT `transaction_items`, sistem mengecek apakah item memiliki customizations:

```typescript
if (r.customizations && Array.isArray(r.customizations)) {
  saveCustomizationsToNormalizedTables(
    localDb,
    transactionItemId,      // ID dari transaction_items
    customizations,          // Array of customization objects
    createdAt,
    null                     // bundle_product_id = null untuk item utama
  );
}
```

**Operasi Database**:

**4a. INSERT `transaction_item_customizations`**:
```sql
INSERT INTO transaction_item_customizations (
  transaction_item_id, customization_type_id, bundle_product_id, created_at
) VALUES (?, ?, NULL, ?)
```

**4b. INSERT `transaction_item_customization_options`**:
```sql
INSERT INTO transaction_item_customization_options (
  transaction_item_customization_id, customization_option_id, option_name,
  price_adjustment, created_at
) VALUES (?, ?, ?, ?, ?)
```

**Tabel**: 
- `transaction_item_customizations`
- `transaction_item_customization_options`

**Catatan**: Customizations disimpan dalam **normalized tables** (bukan JSON), untuk memudahkan query dan integritas data.

---

### **Langkah 5: Menyimpan Customizations Bundle Products**

**File**: `electron/main.ts` (Line 3452-3482)

Jika item memiliki `bundle_selections_json`, sistem juga menyimpan customizations untuk setiap bundle product:

```typescript
if (bundleSelectionsData && bundleSelectionsData.length > 0) {
  for (const bundleSelection of bundleSelectionsData) {
    for (const selectedProduct of bundleSelection.selectedProducts) {
      if (selectedProduct.customizations && Array.isArray(selectedProduct.customizations)) {
        saveCustomizationsToNormalizedTables(
          localDb,
          transactionItemId,              // ID dari transaction_items (parent)
          bundleProductCustomizations,   // Customizations untuk bundle product
          createdAt,
          bundleProductId                // ID produk bundle (bukan NULL)
        );
      }
    }
  }
}
```

**Operasi Database**: Sama seperti Langkah 4, tapi dengan `bundle_product_id` yang diisi.

**Tabel**: 
- `transaction_item_customizations` (dengan `bundle_product_id` terisi)
- `transaction_item_customization_options`

---

**Catatan Penting**:
- Transaksi dibuat dengan `sync_status = 'pending'` (default di database)
- Auto sync (`smartSyncService`) akan mengambil langsung dari `transactions` dengan `sync_status = 'pending'`
- Setelah upload berhasil, `sync_status` di-update menjadi `'synced'` dan `synced_at` di-set

---

### **Langkah 5: Queue untuk System POS (Receiptize)**

**File**: `src/components/PaymentModal.tsx` (Line ~1234)  
**Handler**: `electron/main.ts` (Line ~5363-5377)

**Catatan**: Queue terpisah untuk sync ke System POS (Printer 2 / Receiptize), berbeda dari sync ke server utama.

```typescript
await window.electronAPI?.queueTransactionForSystemPos?.(transactionData.id);
```

**Operasi Database**:

```sql
-- Cek apakah sudah ada
SELECT id, synced_at FROM system_pos_queue WHERE transaction_id = ?

-- Jika belum ada, INSERT
INSERT INTO system_pos_queue (
  transaction_id,    -- UUID transaksi
  queued_at          -- Timestamp
) VALUES (?, ?)
```

**Tabel**: `system_pos_queue`

**Catatan**: Queue terpisah untuk sync ke System POS (Printer 2 / Receiptize), berbeda dari sync ke server utama.

---

## 📊 Ringkasan Tabel Database yang Terlibat

| Tabel | Operasi | Kapan | Keterangan |
|-------|---------|-------|------------|
| `transactions` | INSERT/UPDATE | Langkah 1 | Data transaksi utama, `sync_status = 'pending'`, `synced_at = NULL` |
| `transaction_items` | INSERT/UPDATE | Langkah 2 | Item-item dalam transaksi |
| `transaction_item_customizations` | INSERT | Langkah 3-4 | Customizations (normalized) |
| `transaction_item_customization_options` | INSERT | Langkah 3-4 | Opsi customization (normalized) |
| `system_pos_queue` | INSERT | Langkah 5 | Queue untuk sync ke System POS |

---

## 🔍 Status Sync dan Update

### **Setelah Auto Sync Berhasil**

Ketika auto sync (`smartSyncService`) berhasil meng-upload transaksi:

**Update `transactions`**:
```sql
UPDATE transactions 
SET synced_at = ?,
    sync_status = 'synced',
    sync_attempts = 0
WHERE id = ?
```

### **Setelah Auto Sync Gagal**

Ketika auto sync gagal:

**Update `transactions`**:
```sql
UPDATE transactions 
SET sync_status = 'failed',
    sync_attempts = sync_attempts + 1,
    last_sync_attempt = ?
WHERE id = ?
```

### **Mengapa `sync_status` Bisa Tetap 'pending'?**

Jika transaksi dibuat **sebelum migrasi ke sistem `sync_status`**, atau jika database diganti dari komputer kasir lain:

- Transaksi ada di `transactions` dengan `sync_status = 'pending'` dan `synced_at = NULL`
- Auto sync akan memprosesnya (karena filter berdasarkan `sync_status = 'pending'`)
- Perlu **manual sync** atau **"Update Status"** jika sudah ada di server

### **✅ Refactoring: Tabel `offline_transactions` Telah Dihapus**

**Perubahan yang Dilakukan**:
- ✅ Tabel `offline_transactions` dan `offline_transaction_items` telah dihapus
- ✅ Menggunakan kolom `sync_status` langsung di tabel `transactions`
- ✅ Menghilangkan data inconsistency (single source of truth)
- ✅ Arsitektur lebih sederhana dan performa lebih baik

**Manfaat**:
- Tidak ada duplikasi data
- Query lebih cepat (langsung ke `transactions`, tidak perlu parsing JSON)
- Debugging lebih mudah (semua status di satu tempat)
- Database lebih kecil (tidak ada tabel queue yang membesar)

---

## 🛠️ Cara Memeriksa Data Transaksi

### **1. Cek Transaksi di Tabel `transactions`**

```sql
SELECT id, business_id, total_amount, final_amount, status, synced_at, created_at
FROM transactions
WHERE id = 'TRANSACTION_UUID'
ORDER BY created_at DESC
LIMIT 10;
```

### **2. Cek Items Transaksi**

```sql
SELECT ti.*, p.nama as product_name
FROM transaction_items ti
LEFT JOIN products p ON ti.product_id = p.id
WHERE ti.transaction_id = 'TRANSACTION_UUID'
ORDER BY ti.created_at ASC;
```

### **3. Cek Customizations**

```sql
-- Customizations item utama
SELECT tic.*, ct.name as customization_type_name
FROM transaction_item_customizations tic
LEFT JOIN customization_types ct ON tic.customization_type_id = ct.id
WHERE tic.transaction_item_id = 'ITEM_UUID'
  AND tic.bundle_product_id IS NULL;

-- Opsi customization
SELECT tico.*, co.name as option_name
FROM transaction_item_customization_options tico
LEFT JOIN customization_options co ON tico.customization_option_id = co.id
WHERE tico.transaction_item_customization_id IN (
  SELECT id FROM transaction_item_customizations 
  WHERE transaction_item_id = 'ITEM_UUID'
);
```

### **4. Cek Status Sync**

```sql
-- Pending transactions (sync_status = 'pending')
SELECT id, business_id, total_amount, final_amount, status, created_at, sync_attempts, last_sync_attempt
FROM transactions
WHERE sync_status = 'pending'
ORDER BY created_at ASC
LIMIT 50;

-- Synced transactions (sync_status = 'synced')
SELECT id, business_id, total_amount, final_amount, status, created_at, synced_at
FROM transactions
WHERE sync_status = 'synced'
ORDER BY synced_at DESC
LIMIT 10;

-- Failed transactions (sync_status = 'failed')
SELECT id, business_id, total_amount, final_amount, status, created_at, sync_attempts, last_sync_attempt
FROM transactions
WHERE sync_status = 'failed'
ORDER BY last_sync_attempt DESC
LIMIT 10;
```

### **5. Cek Queue System POS**

```sql
-- Pending
SELECT transaction_id, queued_at, retry_count, last_error
FROM system_pos_queue
WHERE synced_at IS NULL
ORDER BY queued_at ASC;

-- Synced
SELECT transaction_id, queued_at, synced_at
FROM system_pos_queue
WHERE synced_at IS NOT NULL
ORDER BY synced_at DESC
LIMIT 10;
```

### **6. Cek Transaksi yang Belum Di-Sync**

```sql
-- Transaksi dengan sync_status = 'pending' (belum di-sync)
SELECT id, business_id, total_amount, final_amount, status, created_at, sync_attempts
FROM transactions
WHERE sync_status = 'pending'
ORDER BY created_at DESC;
```

---

## ⚠️ Catatan Penting

1. **`sync_status = 'pending'` berarti belum ter-upload**
   - Auto sync akan memproses transaksi dengan `sync_status = 'pending'`
   - Setelah berhasil, `sync_status` di-update menjadi `'synced'`
   - Jika gagal, `sync_status` di-update menjadi `'failed'` dan `sync_attempts` di-increment

2. **Dua sistem queue terpisah**:
   - `transactions.sync_status` → Sync ke server utama (SalesPulse)
   - `system_pos_queue` → Sync ke System POS (Receiptize)

3. **Customizations disimpan normalized** (bukan JSON):
   - Lebih mudah di-query
   - Integritas data lebih baik
   - Tapi lebih kompleks untuk reconstruct

4. **Auto-link ke shift aktif**:
   - Jika `shift_uuid` tidak ada, sistem otomatis link ke shift aktif user
   - Berdasarkan `user_id` dan `business_id`

---

## 📝 File-File Penting

- **Pembuatan Transaksi**: `src/components/PaymentModal.tsx` (Line ~600-685)
- **Database Operations**: `electron/main.ts`
  - `localdb-upsert-transactions` (Line 2911) - Menyimpan transaksi dengan `sync_status = 'pending'`
  - `localdb-upsert-transaction-items` (Line 3393)
  - `localdb-get-unsynced-transactions` (Line 3247) - Mengambil transaksi dengan `sync_status = 'pending'`
  - `localdb-mark-transactions-synced` (Line 3897) - Update `sync_status = 'synced'`
  - `localdb-mark-transaction-failed` (Line 5895) - Update `sync_status = 'failed'`
- **Auto Sync**: `src/lib/smartSync.ts` - Menggunakan `localDbGetUnsyncedTransactions` langsung dari `transactions` table
- **Customizations Helper**: `electron/main.ts` (Function `saveCustomizationsToNormalizedTables`)

---

**Dokumen ini dibuat untuk membantu debugging dan memahami alur pemrosesan transaksi secara lengkap.**
