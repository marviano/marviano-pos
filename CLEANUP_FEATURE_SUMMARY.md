# Cleanup Feature: Orphaned Products Removal

## Overview

Added automatic cleanup logic to remove products from the local database that are no longer in the sync data (e.g., inactive products that were previously synced).

## Implementation

### 1. New IPC Handler: `localdb-cleanup-orphaned-products`

**Location**: `electron/main.ts` (after `localdb-upsert-products`)

**Functionality**:
- Takes `businessId` and array of `syncedProductIds` as parameters
- Finds products that belong to the business but are NOT in the synced list
- Deletes orphaned products and all related data in the correct order:
  1. `product_customizations` (foreign key to products)
  2. `bundle_items` (where bundle_product_id references orphaned products)
  3. `product_businesses` (relationships for the specific business)
  4. `products` (the products themselves)

**Safety Features**:
- Only deletes products that belong to the specified business
- Uses transactions to ensure atomicity
- Logs all deletions for debugging
- Returns detailed results (success status, count, deleted IDs)

### 2. Integration into Sync Flow

**Location**: `src/lib/offlineSync.ts` (after products sync)

**Behavior**:
- After products are synced, extracts product IDs from sync data
- Calls cleanup handler with business ID and synced product IDs
- Only runs if products were successfully synced
- Errors are logged but don't stop the sync process

### 3. Type Definitions

**Location**: 
- `electron/preload.ts` - IPC bridge
- `src/types/electron.d.ts` - TypeScript types

## How It Works

1. **During Sync**:
   - Products are synced from server (only active products after the fix)
   - Product IDs are extracted from sync data
   - Cleanup handler is called with business ID and synced product IDs

2. **Cleanup Process**:
   - Queries for products that belong to the business but aren't in synced list
   - Deletes related data first (respecting foreign key constraints)
   - Deletes products last
   - All operations are in a transaction

3. **Result**:
   - Local database only contains products that are currently synced
   - Inactive/deleted products are automatically removed
   - No manual cleanup needed

## Example Scenario

**Before**:
- Product 439 (inactive) exists in local database
- Sync includes only active products (doesn't include 439)
- Product 439 remains in local database indefinitely

**After**:
- Product 439 (inactive) exists in local database
- Sync includes only active products (doesn't include 439)
- Cleanup handler runs and detects 439 is orphaned
- Product 439 and its relationships are deleted
- Local database now matches server state

## Benefits

✅ **Automatic Cleanup**: No manual intervention needed
✅ **Data Consistency**: Local database matches server state
✅ **Foreign Key Safe**: Deletes in correct order
✅ **Business Scoped**: Only cleans up products for the synced business
✅ **Error Resilient**: Cleanup errors don't break sync
✅ **Logged**: All deletions are logged for debugging

## Testing

To verify cleanup works:

1. **Before sync**: Check local database for inactive products
2. **Run sync**: Sync should complete successfully
3. **After sync**: Inactive products should be removed from local database
4. **Check logs**: Should see cleanup messages with deleted product IDs

## Notes

- Cleanup only runs if products were successfully synced
- Only affects products that belong to the synced business
- Does not affect products from other businesses
- Safe to run multiple times (idempotent - already deleted products won't cause errors)

