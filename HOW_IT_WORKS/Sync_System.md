# Sync System - Complete Guide

## Overview

The POS app implements a sophisticated **offline-first sync system** that allows seamless operation without internet connectivity while ensuring data consistency when online. The system uses **SQLite for local storage** and **MySQL on the backend (salespulse.cc)** with intelligent bidirectional synchronization.

**Key Principle**: The POS device is the **source of truth for transaction data**. Master data (products, prices, categories) is downloaded from the server, while transaction data flows from POS to server (upload-only).

---

## System Architecture

### Three-Layer Sync Architecture

1. **Database Health Service** (`src/lib/databaseHealth.ts`)
   - Automatic startup sync for master data
   - Ensures database has products/categories before going offline
   - Status monitoring and health checks

2. **Smart Sync Service** (`src/lib/smartSync.ts`)
   - Background automatic transaction upload
   - Server load monitoring and retry logic
   - Handles offline queue management

3. **Sync Management** (`src/components/SyncManagement.tsx`)
   - Manual full bidirectional sync
   - Detailed logging and progress tracking
   - Emergency recovery features

---

## Three Sync Features in the App

### 1. Sync Now (Quick Sync)

**Location**: Main POS page, top toolbar

**File**: `src/app/page.tsx` (Lines 184-209)

**When Triggered**: User clicks "Sync Now" button

**What It Does**:
```typescript
onClick={async () => {
  // Step 1: Upload pending transactions to cloud
  await smartSyncService.forceSync();
  
  // Step 2: Download master data from cloud
  await databaseHealthService.forceSync();
  
  // Step 3: Update status display
  const newStatus = await databaseHealthService.getStatusMessage();
  setDatabaseStatus(newStatus);
}}
```

**Uploads to Server**:
- Pending offline transactions
- Shifts
- Printer audit logs

**Downloads from Server**:
- Products, categories, bundle items
- Customization types, options, product customizations
- Payment methods, banks, organizations
- Management groups, CL accounts

**Does NOT Download**:
- Transactions (protected for safety)
- Transaction items, customizations
- Shifts, refunds, printer logs

**Safety**: Safe for daily use - no risk of overwriting local transactions

---

### 2. Sync Products & Prices (Full Sync)

**Location**: Settings → Sinkronisasi page

**File**: `src/components/SyncManagement.tsx` (Lines 1015-1046)

**When Triggered**: User clicks "Sync Products & Prices" button

**What It Does**:
```typescript
const fullSync = useCallback(async () => {
  // Step 1: Upload offline data to cloud
  await syncToCloud();
  
  // Step 2: Download master data from cloud
  await syncFromCloud();
  
  // Step 3: Update status and refresh
  await updateSyncStatus(true);
  await fetchTransactionCounts();
}, [syncToCloud, syncFromCloud, ...]);
```

**Upload Process** (`syncToCloud` - Lines 689-998):
1. Upload shifts first (with uuid mapping)
2. Upload transactions with all items
3. Upload transaction customizations (normalized)
4. Upload printer audit logs
5. Upload refunds
6. Mark synced records locally

**Download Process** (`syncFromCloud` - Lines 554-686):
1. Fetch data from `/api/sync` endpoint
2. Sync categories (category1, category2)
3. Sync customization types and options
4. Sync products (with full details)
5. Sync product customizations and bundle items
6. **SKIP transaction data** (Lines 625-640)
7. Restore printer state from cloud
8. Sync payment methods, banks, organizations
9. Update sync status timestamp

**Key Safety Feature**:
```typescript
// Lines 625-640
// SKIP TRANSACTION DATA DOWNLOAD
// Transaction data is NOT downloaded from server (UPLOAD ONLY)
// Reason: POS device is the source of truth for transaction data
// Downloading could overwrite local records with old/corrupted server data
// Transaction tables that are SKIPPED:
//   - transactions, transaction_items
//   - transaction_item_customizations, transaction_item_customization_options
//   - shifts, transaction_refunds
//   - printer1_audit_log, printer2_audit_log

addLog('info', 'Skipping transaction data download (upload-only for safety)');
```

**Detailed Logging**: Shows real-time progress with success/warning/error logs in the UI

**Safety**: Safe for daily use - comprehensive sync with transaction protection

---

### 3. Download Transaction Data (Emergency Restore)

**Location**: Settings → Sinkronisasi page (red button)

**File**: `src/components/SyncManagement.tsx` (Lines 430-552)

**When Triggered**: User clicks "Download Transaction Data" button

**What It Does**:
```typescript
const handleRestoreFromServer = useCallback(async () => {
  // Show THREE confirmation dialogs
  const firstConfirm = window.confirm('WARNING: This will OVERWRITE...');
  if (!firstConfirm) return;
  
  const typedConfirmation = window.prompt('Type exactly: DOWNLOAD TRANSACTIONS');
  if (typedConfirmation !== 'DOWNLOAD TRANSACTIONS') return;
  
  // Call Electron IPC to restore from server
  const result = await electronAPI.restoreFromServer({
    businessId: businessId,
    apiUrl: getApiUrl(''),
    includeTransactions: true
  });
}, [businessId, addLog, ...]);
```

**Downloads Everything**:
- All master data (products, categories, customizations)
- ALL 8 transaction tables:
  - transactions
  - transaction_items
  - transaction_item_customizations
  - transaction_item_customization_options
  - shifts
  - transaction_refunds
  - printer1_audit_log
  - printer2_audit_log

**Backend Implementation**: `electron/main.ts` (Lines 7458-7850)
- Fetches complete data from `/api/sync`
- Restores all tables in correct order (foreign key dependencies)
- Uses `INSERT OR REPLACE` to overwrite existing records

**Warning Messages**:
```
DOWNLOAD TRANSACTION DATA FROM SERVER

WARNING: This will download and OVERWRITE transaction data from server!

What will be downloaded:
• Master data (products, categories, prices)
• Transaction data:
  - ALL TRANSACTIONS from server
  - ALL SHIFTS from server
  - ALL REFUNDS from server
  - ALL CUSTOMIZATIONS from server
  - ALL PRINTER AUDIT LOGS from server

Why this is dangerous:
• Your local transactions will be REPLACED with server data
• If server has old/incomplete data, you will LOSE recent local transactions
• This is intended for NEW DEVICE SETUP or EMERGENCY RECOVERY only

WARNING: Do NOT use for normal sync! Use "Sync Products & Prices" instead.
```

**Requires Exact Confirmation**: User must type exactly `DOWNLOAD TRANSACTIONS`

**Safety**: DANGEROUS - Overwrites local data. Use only for:
- New device setup
- Device crashed and needs restore
- Migrating to new device
- Emergency recovery when local database is corrupted

---

## Automatic Background Sync

### Smart Sync Service

**File**: `src/lib/smartSync.ts`

**What It Does**:
- Monitors for pending transactions every 30 seconds
- Automatically uploads when internet is available
- Monitors server load and backs off if server is busy
- Implements exponential backoff on failures
- Tracks consecutive failures and adjusts behavior

**Key Features**:
```typescript
class SmartSyncService {
  private syncInterval = 30000; // 30 seconds
  private maxConsecutiveFailures = 5;
  private serverLoadThreshold = 1000; // ms
  
  // Background monitoring
  private startBackgroundSync() {
    setInterval(async () => {
      if (this.canSync()) {
        await this.syncPendingTransactions();
      }
    }, this.syncInterval);
  }
  
  // Server load monitoring
  async measureServerLoad(): Promise<number> {
    const start = Date.now();
    await fetch('/api/health');
    return Date.now() - start;
  }
}
```

**Triggered When**:
- App starts (automatic)
- Every 30 seconds if pending transactions exist
- After completing a transaction (if online)
- When internet connection is restored

**What It Uploads**:
- Unsynced transactions with all items
- Transaction customizations
- Associated shifts

**Does NOT Download**: Only uploads, never downloads data

---

## Database Health Service

### Startup Sync

**File**: `src/lib/databaseHealth.ts`

**When Triggered**:
1. **App Startup** - `src/components/POSLayout.tsx` (Lines 277-297)
2. **"Sync Now" Button** - `src/app/page.tsx` (Lines 184-209)

**Automatic Sync Conditions**:
```typescript
// Sync if:
const needsSync = 
  productCount === 0 ||        // No products
  categoryCount === 0 ||       // No categories
  (Date.now() - lastSync > 3600000); // Last sync > 1 hour ago
```

**What It Downloads** (`forceSync` method - Lines 155-264):
```typescript
async forceSync(): Promise<boolean> {
  // 1. Categories First (dependencies)
  await electronAPI.localDbUpsertCategory1(data.category1);
  await electronAPI.localDbUpsertCategory2(data.category2);
  
  // 2. Customization Types and Options (dependencies)
  await electronAPI.localDbUpsertCustomizationTypes(data.customizationTypes);
  await electronAPI.localDbUpsertCustomizationOptions(data.customizationOptions);
  
  // 3. Products (depends on categories)
  await electronAPI.localDbUpsertProducts(data.products);
  
  // 4. Product-Related Data
  await electronAPI.localDbUpsertProductCustomizations(data.productCustomizations);
  await electronAPI.localDbUpsertBundleItems(data.bundleItems);
  
  // 5. SKIP TRANSACTION DATA (SAFETY)
  console.log('Skipping transaction data download (upload-only for safety)');
  
  // 6. Payment and Organization Data
  await electronAPI.localDbUpsertPaymentMethods(data.paymentMethods);
  await electronAPI.localDbUpsertBanks(data.banks);
  // ... etc
}
```

**Health Check**:
```typescript
async checkDatabaseHealth(): Promise<DatabaseHealth> {
  const products = await electronAPI.localDbGetAllProducts();
  const categories = await electronAPI.localDbGetCategories();
  
  return {
    hasProducts: productCount > 0,
    hasCategories: categoryCount > 0,
    productCount,
    categoryCount,
    lastSync,
    needsSync
  };
}
```

**Status Display**: Shows in top toolbar:
- `"Database ready (156 products, 12 categories)"`
- `"Database empty - sync required for offline operation"`

---

## Backend API (salespulse.cc)

### Sync Endpoint

**File**: `salespulse/src/app/api/sync/route.ts`

**Endpoint**: `GET /api/sync?business_id={id}`

**What It Returns**:
```typescript
{
  success: true,
  businessId: 14,
  counts: {
    products: 156,
    transactions: 1234,
    shifts: 45,
    // ... etc
  },
  data: {
    // Master Data
    users: [...],
    businesses: [...],
    categories: [...],
    products: [...],
    customizationTypes: [...],
    customizationOptions: [...],
    productCustomizations: [...],
    bundleItems: [...],
    paymentMethods: [...],
    banks: [...],
    organizations: [...],
    managementGroups: [...],
    category1: [...],
    category2: [...],
    clAccounts: [...],
    
    // Transaction Data (all 8 tables)
    transactions: [...],
    transactionItems: [...],
    transactionItemCustomizations: [...],
    transactionItemCustomizationOptions: [...],
    shifts: [...],
    transactionRefunds: [...],
    printer1AuditLog: [...],
    printer2AuditLog: [...]
  }
}
```

**Important**: Backend returns ALL data including transactions. It's up to the **client to decide what to download**:
- `databaseHealthService`: Takes master data only
- `syncFromCloud`: Takes master data only
- `restoreFromServer`: Takes everything including transactions

### Transaction Upload Endpoint

**File**: `salespulse/src/app/api/transactions/route.ts`

**Endpoint**: `POST /api/transactions`

**Expected Body**:
```typescript
{
  // Transaction main data
  business_id: 14,
  user_id: 1,
  shift_uuid: 'xxx-xxx-xxx',
  payment_method: 'cash',
  total_amount: 50000,
  final_amount: 50000,
  // ... other fields
  
  // Items array
  items: [
    {
      product_id: 123,
      quantity: 2,
      unit_price: 25000,
      total_price: 50000,
      customizations: [...],
      custom_note: '...'
    }
  ],
  
  // Normalized customization data
  transaction_item_customizations: [...],
  transaction_item_customization_options: [...]
}
```

**What It Does**:
1. Validates transaction data
2. Inserts transaction record
3. Inserts transaction items
4. Inserts customizations (both JSON and normalized tables)
5. Returns transaction ID and success status

### Shift Sync Endpoint

**File**: `salespulse/src/app/api/shifts/sync/route.ts` (if exists)

**Endpoint**: `POST /api/shifts/sync`

**Expected Body**:
```typescript
{
  uuid_id: 'xxx-xxx-xxx',
  business_id: 14,
  user_id: 1,
  user_name: 'John Doe',
  shift_start: '2024-01-15T08:00:00',
  shift_end: '2024-01-15T16:00:00',
  modal_awal: 1000000,
  status: 'closed'
}
```

---

## Data Flow Diagrams

### Normal Operation (With Internet)

```
POS Device                    Backend Server
────────────                  ──────────────

User makes sale
    ↓
Save to SQLite
    ↓
Add to sync queue
    ↓
Smart Sync (background)
    ├─ Upload transaction ──→ POST /api/transactions
    ├─ Upload shift ────────→ POST /api/shifts/sync
    └─ Upload printer logs ─→ POST /api/printer-audits
                               ↓
                           Save to MySQL
                               ↓
                           Return success
    ↓
Mark as synced locally
```

### Offline Operation

```
POS Device                    Backend Server
────────────                  ──────────────

Internet disconnected ✗       (Not reachable)

User makes sale
    ↓
Save to SQLite
    ↓
Add to sync queue
    ↓
Queue grows...
    ↓
Continue selling
    ↓
All data safe locally
```

### When Internet Returns

```
POS Device                    Backend Server
────────────                  ──────────────

Internet restored ✓

Smart Sync detects online
    ↓
Check pending count (e.g. 45)
    ↓
Upload batch by batch
    ├─ Transaction 1 ───────→ POST /api/transactions
    ├─ Transaction 2 ───────→ POST /api/transactions
    ├─ ...
    └─ Transaction 45 ──────→ POST /api/transactions
                               ↓
                           All saved to MySQL
                               ↓
                           Return success
    ↓
Mark all as synced
    ↓
Queue cleared ✓
```

### Sync Products & Prices (Bidirectional)

```
POS Device                    Backend Server
────────────                  ──────────────

User clicks "Sync Products & Prices"

STEP 1: UPLOAD
├─ Get pending transactions
├─ Upload each ─────────────→ POST /api/transactions
├─ Upload shifts ───────────→ POST /api/shifts/sync
├─ Upload printer logs ─────→ POST /api/printer-audits
└─ Mark as synced locally

STEP 2: DOWNLOAD
├─ Fetch all data ──────────→ GET /api/sync
│                             ↓
│                         Returns everything
│                             ↓
├─ Receive response ←──────── (master + transaction data)
├─ Extract master data only
├─ Skip transaction data ✗
├─ Save categories
├─ Save customizations
├─ Save products
├─ Save payment methods
└─ Save organizations

Complete ✓
```

---

## Conflict Resolution Strategy

### The POS is Source of Truth

**Principle**: Since POS devices generate transactions, they are always the authoritative source for transaction data.

**Rules**:
1. **Transactions**: Upload-only, never download (except emergency restore)
2. **Master Data**: Download from server, server is source of truth
3. **No Conflict**: Since transactions only flow one way, conflicts cannot occur

**Why This Works**:
- Each POS device has unique transactions (created locally)
- Multiple POS devices can have same products (from server)
- Transactions are immutable once created (no updates, only inserts)
- Master data changes are rare and managed centrally

**Edge Case - Emergency Restore**:
- If POS database is corrupted, can restore from server
- User must explicitly confirm with typed text: `DOWNLOAD TRANSACTIONS`
- This is the ONLY time transactions flow server → POS

---

## Sync Status Tracking

### Local Database Tables

**sync_status table** (SQLite):
```sql
CREATE TABLE IF NOT EXISTS sync_status (
  key TEXT PRIMARY KEY,
  last_sync INTEGER,
  status TEXT,
  updated_at INTEGER
);
```

**Usage**:
```typescript
// Update last sync time
await electronAPI.localDbSetSyncStatus('last_sync', Date.now());

// Check last sync
const status = await electronAPI.localDbGetSyncStatus('last_sync');
// Returns: { key: 'last_sync', last_sync: 1705305600000, status: 'success' }
```

### Transaction Sync Tracking

**Transactions table has `synced_at` column**:
```sql
-- When transaction is created
INSERT INTO transactions (..., synced_at) VALUES (..., NULL);

-- After successful upload
UPDATE transactions SET synced_at = ? WHERE id = ?;
```

**Query unsynced**:
```typescript
const pending = await electronAPI.localDbGetUnsyncedTransactions(businessId);
// Returns transactions where synced_at IS NULL
```

---

## Error Handling

### Network Failures

**Smart Sync Service** handles network errors gracefully:

```typescript
try {
  await fetch('/api/transactions', { method: 'POST', body: ... });
  successCount++;
} catch (error) {
  errorCount++;
  consecutiveFailures++;
  
  if (consecutiveFailures >= maxConsecutiveFailures) {
    // Back off - stop trying for a while
    this.syncInterval *= 2; // Exponential backoff
  }
}
```

**Results**:
- Network down: Transactions queue locally, retry later
- Partial failure: Successful transactions marked synced, failures retry
- Server overload: Exponential backoff reduces retry frequency

### Server-Side Validation Errors

**Backend validates all data**:

```typescript
// salespulse/src/app/api/transactions/route.ts
export async function POST(req: NextRequest) {
  const body = await req.json();
  
  // Validate required fields
  if (!body.business_id || !body.user_id) {
    return NextResponse.json(
      { error: 'Missing required fields' },
      { status: 400 }
    );
  }
  
  // ... process transaction
}
```

**POS Handling**:
```typescript
const response = await fetch('/api/transactions', { method: 'POST', body });

if (response.ok) {
  addLog('success', 'Transaction uploaded');
} else {
  const errorText = await response.text();
  addLog('warning', `Upload failed: ${response.status} - ${errorText}`);
  // Transaction remains in queue, will retry later
}
```

### Database Corruption Recovery

**If SQLite database is corrupted**:

1. **Detection**: App fails to read products/transactions
2. **User Action**: Go to Settings → Sinkronisasi
3. **Click**: "Download Transaction Data" (red button)
4. **Confirm**: Three-step confirmation process
5. **Restore**: Complete database restore from server

**Note**: This is destructive - overwrites all local data with server data.

---

## Testing the Sync System

### Test Scenario 1: Offline Sales

1. Disconnect internet
2. Make several sales transactions
3. Check sync status: "Pending: 5 transactions"
4. Reconnect internet
5. Watch Smart Sync upload automatically
6. Verify sync status: "Pending: 0 transactions"
7. Check server: All transactions present

### Test Scenario 2: Manual Sync

1. Create offline transactions
2. Click "Sync Products & Prices"
3. Watch logs: Transactions uploading
4. Watch logs: Master data downloading
5. Watch logs: "Skipping transaction data download (upload-only for safety)"
6. Verify local transactions remain intact

### Test Scenario 3: New Product Added

1. Server admin adds new product
2. POS clicks "Sync Now" or "Sync Products & Prices"
3. New product appears in POS
4. Can sell new product immediately

### Test Scenario 4: Emergency Restore

1. Simulate database corruption (delete local DB)
2. Restart app: "Database empty"
3. Go to Settings → Sinkronisasi
4. Click "Download Transaction Data" (red button)
5. Complete 3-step confirmation
6. Wait for full restore
7. Verify all data restored from server

---

## Performance Considerations

### Batch Upload Strategy

**Smart Sync uploads one-by-one** (not batch):
```typescript
for (const transaction of transactions) {
  await fetch('/api/transactions', {
    method: 'POST',
    body: JSON.stringify(transaction)
  });
}
```

**Why not batch?**
- Individual transaction validation
- Partial success tracking (mark each as synced)
- Better error handling per transaction
- Server processes one at a time anyway

### Sync Progress Display

**SyncManagement shows progress**:
```typescript
setSyncProgress((successCount / totalCount) * 100);
```

**User sees**:
- Progress bar: 0-50% for upload, 50-100% for download
- Live logs: "✓ Transaction 1 uploaded successfully"
- Final summary: "Upload completed! Success: 45, Errors: 0"

### Large Dataset Handling

**If 1000+ transactions pending**:
- Smart Sync uploads gradually (not all at once)
- User can continue working while sync happens
- Each successful upload reduces queue
- Progress tracked: "Pending: 987 transactions"

---

## Security Considerations

### No Authentication in Sync

**Current Implementation**:
- API endpoints are public (no auth tokens required)
- Business ID is hardcoded: `14`
- No user-level access control on sync endpoints

**Why This Works**:
- Backend is internal network only (salespulse.cc)
- POS devices are trusted (business-owned)
- All transactions include user_id for accountability

**Future Enhancement** (if needed):
- Add API key authentication
- Add user session tokens
- Add IP whitelist for POS devices

### Data Validation

**Server validates all uploaded data**:
- Required fields present
- Data types correct
- Business ID matches
- Foreign keys valid (product_id exists, etc.)
- Amount calculations correct

**POS validates before upload**:
- Transaction has items
- Prices match products
- Payment amount sufficient
- Shift is active

---

## Configuration

### Environment-Specific API URLs

**File**: `src/lib/api.ts`

```typescript
export function getApiUrl(path: string): string {
  const isDevelopment = process.env.NODE_ENV === 'development';
  const baseUrl = isDevelopment 
    ? 'http://localhost:3000'  // Local development
    : 'https://salespulse.cc';  // Production server
  
  return `${baseUrl}${path}`;
}
```

### Business ID Configuration

**Hardcoded in backend**:
```typescript
// salespulse/src/app/api/sync/route.ts
const businessId = 14; // Momoyo Bakery Kalimantan
```

**Passed from frontend**:
```typescript
// Frontend passes business_id in all requests
const response = await fetch(`/api/sync?business_id=${businessId}`);
```

### Sync Intervals

**Smart Sync**:
```typescript
private syncInterval = 30000; // 30 seconds
```

**Database Health**:
```typescript
const needsSync = (Date.now() - lastSync > 3600000); // 1 hour
```

**Status Check**:
```typescript
setInterval(updateStatus, 5000); // 5 seconds
```

---

## Troubleshooting

### Problem: Transactions Not Uploading

**Check**:
1. Internet connection: Status indicator online?
2. Pending count: Settings → Sinkronisasi shows pending?
3. Console logs: Any error messages?
4. Server reachable: Can access salespulse.cc?

**Solution**:
- Click "Sync Products & Prices" to force upload
- Check server logs for validation errors
- Verify transaction data is valid (has items, prices, etc.)

### Problem: Products Not Updating

**Check**:
1. Last sync time: More than 1 hour ago?
2. Clicked sync button recently?
3. Server has new products?

**Solution**:
- Click "Sync Now" or "Sync Products & Prices"
- Check console: "X products synced to local database"
- Refresh product list (reload app if needed)

### Problem: Database Empty After Update

**Check**:
1. App updated/reinstalled?
2. Database file location changed?
3. userData directory permissions?

**Solution**:
- Click "Sync Products & Prices" to re-download master data
- Or "Download Transaction Data" for full restore (if transactions missing)

### Problem: Duplicate Transactions on Server

**Check**:
1. Sync status tracking working?
2. Transaction marked as synced locally?

**Possible Cause**:
- Transaction uploaded but sync status update failed
- Will retry and create duplicate

**Prevention**:
- Backend should implement idempotency (check UUID before insert)
- Or transaction table has UNIQUE constraint on UUID

---

## Future Enhancements

### Potential Improvements

1. **Delta Sync**
   - Only download changed products (not all products)
   - Use `updated_at` timestamp for filtering
   - Reduces bandwidth and sync time

2. **Batch Upload API**
   - Upload multiple transactions in one request
   - Faster for large queues
   - Implement on backend: `POST /api/transactions/batch`

3. **Conflict Detection**
   - Track product price changes
   - Alert if local transaction uses old price
   - Allow manual resolution

4. **Sync Scheduling**
   - Configure sync times (e.g. every night at 2 AM)
   - Avoid peak hours
   - User-configurable intervals

5. **Compression**
   - Compress large payloads (products, transactions)
   - Reduce bandwidth usage
   - Faster sync on slow connections

6. **Partial Sync**
   - Allow syncing specific tables only
   - e.g. "Sync products only" without categories
   - Faster targeted updates

---

## Summary

The sync system implements a robust offline-first architecture with three main components:

1. **Database Health Service**: Automatic master data sync at startup
2. **Smart Sync Service**: Background transaction upload with retry logic
3. **Sync Management UI**: Manual full sync with detailed logging

**Key Design Decisions**:
- POS is source of truth for transactions (upload-only)
- Server is source of truth for master data (download-only)
- No conflicts possible due to unidirectional data flow
- Emergency restore available for disaster recovery

**Safety Features**:
- Transaction data never downloaded (except explicit restore)
- Three-step confirmation for destructive actions
- Detailed logging for troubleshooting
- Local queue prevents data loss during offline periods

This architecture ensures data consistency, prevents data loss, and provides a smooth user experience regardless of internet connectivity.

