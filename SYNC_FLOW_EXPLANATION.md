# Sync Flow Explanation

## Answer to Your Question

**Yes, the sync on boot is from salespulse VPS MySQL to salespulse LOCAL MySQL.**

## How Sync Works

### 1. Sync Trigger (Login/Boot)
- **Location**: `src/app/login/page.tsx`
- **Function**: `handleFullSync()` calls `offlineSyncService.syncFromOnline()`
- **When**: 
  - On initial app load (if offline DB doesn't exist)
  - Manually triggered by user
  - When internet connection is restored

### 2. Sync Process
- **Location**: `src/lib/offlineSync.ts` → `syncFromOnline()`
- **API Call**: `fetch(getApiUrl('/api/sync'))`
- **What it does**:
  1. Calls the local Next.js API route `/api/sync`
  2. This route queries the **VPS MySQL database** (using `DB_NAME=salespulse` from `.env`)
  3. Downloads all data (users, businesses, products, etc.)
  4. Saves to **local MySQL database** (using DB_NAME from .env - same database name as VPS)

### 3. Database Flow

```
VPS MySQL (salespulse) 
    ↓
    [API Route: /api/sync]
    ↓
    [Uses: src/lib/db.ts → DB_NAME from .env]
    ↓
    [Queries: SELECT * FROM businesses ...]
    ↓
    [Returns: JSON data]
    ↓
    [Client: offlineSyncService.syncFromOnline()]
    ↓
    [Saves to: Local MySQL database (salespulse)]
```

### 4. The Error You're Seeing

**Error**: `Business ID 14 tidak ditemukan di database lokal`

**Location**: `electron/main.ts` (line 2727)

**What happens**:
1. User tries to open a shift
2. Code checks if business ID 14 exists in **local MySQL database** (using DB_NAME from .env)
3. Business ID 14 is not found
4. Error is shown

**Why it happens**:
- Business ID 14 doesn't exist in the VPS `salespulse` database, OR
- The sync didn't complete successfully, OR
- Business ID 14 was deleted/not synced

## Sync Endpoint Details

### API Route: `/api/sync`
- **File**: `src/app/_api/sync/route.ts`
- **Database**: Uses `query` from `@/lib/db.ts`
- **DB_NAME**: Reads from `.env` (currently `salespulse`)
- **Query**: `SELECT id, name, ... FROM businesses ORDER BY name ASC`
- **Note**: Gets **ALL businesses**, not filtered by business_id

### What Gets Synced

The sync endpoint downloads:
- ✅ Users
- ✅ **Businesses** (ALL businesses from VPS)
- ✅ Products (filtered by business_id parameter, default: 14)
- ✅ Categories
- ✅ Ingredients
- ✅ Contacts
- ✅ Roles & Permissions
- ✅ Payment Methods
- ✅ Banks
- ✅ And more...

## Troubleshooting Business ID 14 Not Found

### Check 1: Does Business ID 14 exist in VPS?
```sql
SELECT id, name FROM businesses WHERE id = 14;
```

### Check 2: Check sync logs
- Look for sync errors in console
- Check if businesses array is empty in sync response

### Check 3: Verify local database
- Check if any businesses were synced to local MySQL
- The sync should have synced ALL businesses, not just ID 14
- Verify you're checking the correct database (should be same DB_NAME as VPS)

### Check 4: Manual sync
- Try manually triggering sync from login page
- Check if businesses are being synced

## Key Points

1. **Sync Direction**: VPS MySQL (`salespulse`) → Local MySQL (`salespulse` - same DB_NAME from .env)
2. **Database Used**: The sync endpoint uses `DB_NAME` from `.env` (currently `salespulse`)
3. **Business Filtering**: The sync gets ALL businesses, but products are filtered by `business_id` parameter (default: 14)
4. **Error Location**: The error occurs when checking local MySQL database (using DB_NAME from .env), not VPS database

## Solution

If Business ID 14 doesn't exist in VPS:
1. Create business ID 14 in VPS `salespulse` database, OR
2. Use a different business ID that exists, OR
3. Check if the business was deleted/renamed

If Business ID 14 exists in VPS but not in local:
1. Re-run sync manually
2. Check sync logs for errors
3. Verify the sync endpoint is querying the correct database

