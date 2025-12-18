# Sync System Analysis - Transaction Sync Flow

## Problem Statement
Some transactions were not inserted to VPS system-pos database last night, despite being in the local SQLite database.

## Database Architecture

1. **SQLite Local** (marviano-pos)
   - Source of truth for all transactions
   - Contains: transactions, transaction_items, printer1_audit_log, printer2_audit_log

2. **MySQL Localhost system-pos**
   - Target for printer2 transactions only
   - Connected via: `DB_HOST=localhost` in salespulse API
   - Contains: transactions, transaction_items, shifts, printer1_audit_log, printer2_audit_log

3. **MySQL VPS system-pos**
   - Should contain same data as localhost system-pos
   - **ISSUE: No sync mechanism found from localhost -> VPS**

4. **SalesPulse MySQL**
   - Target for ALL transactions (both printer1 and printer2)
   - Connected via: `NEXT_PUBLIC_API_URL=https://salespulse.cc`
   - Contains: transactions, transaction_items, shifts, printer1_audit_log, printer2_audit_log

## Current Sync Flow

### 1. System POS Sync (systemPosSync.ts)
- **Trigger**: Every 30 seconds + on transaction create/reprint (Printer 2 only)
- **Filter**: ONLY transactions with printer2_audit_log
- **Target**: `https://salespulse.cc/api/system-pos/transactions`
- **What it syncs**:
  - Transactions (with items, customizations, refunds)
  - Shifts (non-blocking)
  - Printer Audits (printer1 + printer2, non-blocking)
- **Queue**: Uses `system_pos_queue` table to track sync status
- **Database Written To**: localhost MySQL system_pos (via salespulse API endpoint)

### 2. Smart Sync (smartSync.ts)
- **Trigger**: Every 30 seconds when online
- **Filter**: ALL transactions (both printer1 and printer2)
- **Target**: `https://salespulse.cc/api/transactions`
- **What it syncs**:
  - All transactions
  - Shifts
  - Refunds
  - Printer Audit Logs (both printer1 and printer2)
  - Printer Daily Counters
- **Database Written To**: SalesPulse MySQL (main database)

### 3. Offline Sync (offlineSync.ts)
- **Trigger**: When connection restored
- **Direction**: Download only (master data)
- **Target**: `https://salespulse.cc/api/sync`
- **What it syncs**: Products, categories, users, etc. (master data only)

## Critical Issues Found

### Issue 1: Missing VPS Sync Mechanism
**Problem**: There is NO code that syncs data from localhost system-pos to VPS system-pos.

**Evidence**:
- `salespulse/src/app/api/system-pos/transactions/route.ts` only connects to `DB_HOST=localhost`
- No VPS connection pool or sync logic found
- No scheduled job or cron task found for VPS replication

**Impact**: Transactions synced to localhost system-pos are NOT automatically replicated to VPS system-pos.

### Issue 2: pos-specs Documentation Incomplete
**Problem**: The pos-specs page says "Syncs ONLY receiptize/printer 2 transactions to system-pos database" but doesn't clarify:
- It only syncs to **localhost** system-pos, not VPS
- There's no automatic VPS replication

**Location**: `salespulse/src/app/pos-specs/page.tsx`

### Issue 3: Transaction Filtering Mismatch
**Problem**: System POS Sync only syncs printer2 transactions, but:
- SalesPulse should receive ALL transactions (both printer1 and printer2) ✅ (handled by smartSync)
- System-pos should receive ONLY printer2 transactions ✅ (handled by systemPosSync)
- But VPS system-pos is missing entirely ❌

## Expected vs Actual Behavior

### Expected:
1. Transaction created in SQLite → Queued in system_pos_queue (if printer2)
2. System POS Sync → Syncs to localhost system-pos ✅
3. **VPS Replication** → Syncs from localhost to VPS system-pos ❌ **MISSING**
4. Smart Sync → Syncs ALL transactions to SalesPulse ✅

### Actual:
1. Transaction created in SQLite → Queued in system_pos_queue (if printer2) ✅
2. System POS Sync → Syncs to localhost system-pos ✅
3. **VPS Replication** → **DOES NOT EXIST** ❌
4. Smart Sync → Syncs ALL transactions to SalesPulse ✅

## Recommendations

1. **Implement VPS Sync Mechanism**
   - Option A: Add VPS connection pool to salespulse API endpoints (write to both localhost and VPS)
   - Option B: Create scheduled job/cron to replicate from localhost to VPS
   - Option C: Use MySQL replication (master-slave) from localhost to VPS

2. **Update Documentation**
   - Clarify in pos-specs that system-pos sync only targets localhost
   - Document VPS sync mechanism (once implemented)

3. **Add Monitoring**
   - Track sync status to both localhost and VPS
   - Alert when VPS sync fails

## Files to Check

- `marviano-pos/src/lib/systemPosSync.ts` - Client-side sync logic
- `salespulse/src/app/api/system-pos/transactions/route.ts` - Server-side API (localhost only)
- `salespulse/src/app/pos-specs/page.tsx` - Documentation page
- `salespulse/database_migrations/sync_vps_database.sql` - VPS migration script (but no sync code)
