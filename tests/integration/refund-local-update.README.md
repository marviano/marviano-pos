# Integration check: Refund application updates local transaction (refund_total / refund_status)

This check verifies that applying a refund updates the local `transactions.refund_total` and `transactions.refund_status` correctly, and that this remains correct before and after smart sync.

## Manual verification steps

1. **Before refund**
   - Open a completed transaction (UUID `T`) and note `refund_total` and `refund_status` (e.g. `0`, `none`).

2. **Create refund**
   - Create a partial or full refund for transaction `T` via Refund modal.
   - Confirm the modal passes `transaction_uuid: T` (not numeric `id`) to `localDbApplyTransactionRefund`.

3. **Verify local update (before sync)**
   - Re-open the same transaction or query local DB:
     - `SELECT uuid_id, refund_total, refund_status, last_refunded_at FROM transactions WHERE uuid_id = 'T'`
   - Expect: `refund_total` = sum of refunds, `refund_status` = `'partial'` or `'full'`, `last_refunded_at` set.

4. **After smart sync**
   - Trigger sync (or wait for auto sync) so the transaction and refund are sent to the server.
   - Query local DB again for transaction `T`.
   - Expect: same `refund_total` and `refund_status` (local is source of truth; no overwrite from server).

5. **Affected-row guard**
   - If the handler ever updates by numeric `id` while the caller passes a UUID, the UPDATE would match 0 rows and the handler returns an error so sync is retried instead of silently continuing.

## Automated note

The main process handler `localdb-apply-transaction-refund` uses `transaction_uuid` (or UUID-like `id`) to update by `uuid_id`; only when the identifier is explicitly numeric does it use `WHERE id = ?`. An affected-row check ensures that when a transaction update is expected, 0 rows updated results in a returned error.
