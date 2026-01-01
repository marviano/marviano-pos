# system_pos Database Usage

## Summary
The `system_pos` database is **only used for queueing transactions that are printed to Printer 2** for syncing to System POS (Receiptize).

## Database Configuration

### Location
- **File**: `electron/mysqlDb.ts` (line 273)
- **Database Name**: Hardcoded as `'system_pos'` (NOT from `.env`)
- **Connection**: Uses same host/user/password/port as main database, but different database name

```typescript
systemPosPool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: 'system_pos', // Always use system_pos database for printer 2 transactions
  port: parseInt(process.env.DB_PORT || '3306'),
  // ...
});
```

## What's Stored in system_pos Database

### 1. `system_pos_queue` Table
- **Purpose**: Queue transactions that need to be synced to System POS (Receiptize)
- **When Used**: When a transaction is printed to Printer 2
- **Fields**:
  - `id` - Auto increment
  - `transaction_id` - UUID of the transaction
  - `queued_at` - Timestamp when queued
  - `synced_at` - Timestamp when synced (NULL if not synced)
  - `retry_count` - Number of sync retry attempts
  - `last_error` - Last error message if sync failed

## What's NOT Stored in system_pos Database

### Printer 2 Audit Logs
- **Table**: `printer2_audit_log`
- **Location**: Main database (`salespulse` / `marviano_pos` - from `DB_NAME` in `.env`)
- **Purpose**: Tracks all Printer 2 print operations
- **Note**: This is stored in the main database, NOT in `system_pos`

## Current Status

### ⚠️ Queueing is Currently DISABLED
- **File**: `src/components/PaymentModal.tsx` (line 1215)
- **Reason**: Comment states "system_pos database has been dropped on VPS, queueing is disabled"
- **Code**: The `queueTransactionForSystemPos()` call is commented out

```typescript
// DISABLED: system_pos database has been dropped on VPS, queueing is disabled
// Queue transaction for System POS sync AFTER audit is saved and committed
// try {
//   const queueResult = await window.electronAPI?.queueTransactionForSystemPos?.(transactionData.id);
//   ...
// }
```

## IPC Handlers for system_pos

All located in `electron/main.ts`:

1. **`queue-transaction-for-system-pos`** - Queue a transaction for System POS sync
2. **`get-system-pos-queue`** - Get all queued transactions
3. **`mark-system-pos-synced`** - Mark transaction as successfully synced
4. **`mark-system-pos-failed`** - Mark transaction sync as failed (increment retry count)
5. **`reset-system-pos-retry-count`** - Reset retry count for failed transactions
6. **`debug-system-pos-transaction`** - Debug transaction sync status
7. **`repopulate-system-pos-queue`** - Force resync by repopulating queue

## Flow

1. **Transaction Created** → Saved to main database (`salespulse`)
2. **Printed to Printer 2** → `printer2_audit_log` entry created in main database
3. **Queue for System POS** → (Currently disabled) Would insert into `system_pos.system_pos_queue`
4. **Sync Service** → (Currently disabled) Would read from `system_pos_queue` and sync to System POS API

## Key Points

✅ **system_pos database is ONLY used for:**
- Queueing transactions printed to Printer 2 for System POS sync
- Tracking sync status (queued, synced, failed, retry count)

❌ **system_pos database is NOT used for:**
- Storing printer 2 audit logs (those go to main database)
- Storing transactions (those go to main database)
- Any other data storage

⚠️ **Current Status:**
- Queueing functionality is disabled (commented out)
- `system_pos` database connection is still initialized
- All IPC handlers are still available but not actively used

## Recommendation

If `system_pos` database is no longer needed:
1. Remove or comment out `initializeSystemPosPool()` call
2. Remove all `system_pos_queue` related IPC handlers
3. Remove `systemPosSync.ts` service (already disabled)
4. Update documentation

If `system_pos` database is still needed:
1. Re-enable queueing in `PaymentModal.tsx`
2. Ensure `system_pos` database exists on the server
3. Verify sync service works correctly

