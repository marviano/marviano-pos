# Marviano-POS sync scenarios and possible errors

This doc describes how marviano-pos (Pictos) handles activities that affect transactions and how they sync to Salespulse. Use it to interpret **Verifikasi data** mismatches and fix sync gaps.

---

## 1. Refund

**Flow**

1. User does a refund in the app → refund is stored **locally** (e.g. `offline_queued_refunds` and transaction’s `refund_total` / `refund_status` updated via `localDbApplyTransactionRefund`).
2. On **sync (upload to cloud)**:
   - Pending refunds are read with `localDbGetPendingRefunds`.
   - Each is sent as `POST /api/transactions/:transactionUuid/refund` to Salespulse.
   - If response is OK: `localDbApplyTransactionRefund` (local only), then `localDbResetTransactionSync(transactionUuid)` so the **transaction** is re-queued for upsert.
   - Refund row is marked synced with `localDbMarkRefundSynced`.
3. Later in the same sync (or next run), the **transaction** is upserted to Salespulse with updated `refund_total` / `refund_status` (and Salespulse also has the row in `transaction_refunds` from step 2).

**Why “Refund missing on salespulse (only on Pictos)”**

- Refund was **never uploaded**: no sync after refund, or sync failed before the refund step.
- **Upload failed**: network error, or API returned 4xx/5xx (refund stays pending; next sync will retry).
- **Transaction re-upsert never ran or failed**: refund API succeeded (so `transaction_refunds` might exist on server), but `localDbResetTransactionSync` didn’t run or the subsequent transaction upsert failed — then Salespulse can still show `refund_total = 0` for that transaction if it reads from `transactions.refund_total` and the row wasn’t updated.

**What to do**

- Run sync again so pending refunds are uploaded and transactions re-queued.
- In Sync Management log, check for “Failed to upload refund” or transaction sync errors for those UUIDs.
- On Salespulse, confirm whether `transaction_refunds` has a row for that transaction (refund uploaded but tx not updated) or not (refund never uploaded).

---

## 2. Pembatalan (cancelled items)

**Flow**

- Cancelling an item sets `production_status = 'cancelled'` on that **transaction_item** in the local DB.
- The **transaction** (and its items) is synced when it’s in the pending queue and sync runs. So the same transaction is upserted again with the updated items (including cancelled).
- Salespulse stores items and `production_status`; summary “Item Dibatalkan” is computed from items with `production_status = 'cancelled'`.

**Why cancelled count/total differs (Pictos vs Salespulse)**

- Transaction was **not re-synced** after the cancel: e.g. no sync after cancel, or transaction wasn’t re-queued.
- **Sync order / failure**: transaction sync failed for that UUID, so server still has old items.

**What to do**

- Re-sync: from Sync Management, trigger sync so pending transactions (including ones with cancelled items) are uploaded again.
- Optionally use “Re-queue for sync” (or equivalent) for that transaction so it’s pushed to Salespulse again.

---

## 3. Changing shift (shift_uuid)

**Flow**

- When a transaction is assigned to another shift (e.g. “ubah shift”), the app calls `localDbUpdateTransactionShift(transactionUuid, newShiftUuid)` so the local row’s `shift_uuid` is updated.
- For Salespulse to get the new `shift_uuid`, that transaction must be **re-synced** (upsert). So either:
  - The app re-queues the transaction for sync after changing shift (e.g. `localDbResetTransactionSync`), or
  - It’s included in the next normal transaction sync.
- If the transaction is not re-queued or sync fails, Salespulse keeps the old `shift_uuid`.

**Verifikasi data: shift_uuid**

- `shift_uuid` is **excluded** from the comparison. SQLite vs MySQL often differ by type/casing so the same UUID can show as “different”; re-upsert does not change the server value. So Verifikasi no longer reports shift_uuid diffs.
- If you need to fix a real shift change on the server, re-queue that transaction and run **Upload ke cloud** so the transaction (with updated shift_uuid) is sent.

---

## 4. Other transaction field changes (payment_method, pickup_method, etc.)

**Flow**

- Any change to a transaction in the app updates the local DB. The transaction is sent to Salespulse only when it’s in the **pending sync queue** and an upload runs (smartSync / Sync Management).
- If the transaction was already synced and not re-queued after the change, Salespulse keeps the old values.

**What can cause errors**

- Transaction not re-queued after edit (e.g. no `localDbResetTransactionSync` or equivalent after “ubah shift” / change payment / etc.).
- Sync failed for that transaction (network, validation, or server error).
- Offline for a long time: many changes only in local DB; when back online, sync runs but some steps fail (e.g. refund upload or transaction upsert).

---

## 5. Summary: what to do when Verifikasi data shows differences

| Mismatch type | Likely cause | Action |
|---------------|--------------|--------|
| **refund_total** (Pictos has refund, Salespulse 0) | Refund not uploaded or transaction not re-upserted after refund | Use **Upsert salespulse.cc** (same date range as Verifikasi) to re-upload those transactions; or run **Upload ke cloud** (refund step + transaction sync). |
| **Item/cancelled count** | Transaction not re-synced after cancel | Use **Upsert salespulse.cc** (same date range) to re-upload. |
| **shift_uuid** | Excluded from comparison; no longer shown. | — |
| **payment_method / pickup_method / etc.** | Edit only in Pictos, server not updated | Use **Upsert salespulse.cc** (same date range) to re-upload. |

**Important:** **Upsert salespulse.cc** (tombol hijau di samping Verifikasi data) mengunggah ulang semua transaksi dalam rentang Dari/Sampai ke Salespulse. Gunakan rentang yang sama seperti saat Verifikasi, lalu jalankan Verifikasi lagi untuk konfirmasi.
