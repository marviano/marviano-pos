# Fix Applied: Product Sync Status Filter

## Issue Summary

**Warnings in logs:**
- `⚠️ [PRODUCT BUSINESSES UPSERT] Skipping: product_id 439 does not exist`
- `⚠️ [PRODUCT BUSINESSES UPSERT] Skipping: product_id 441 does not exist`

**Root Cause:**
- Products 439 and 441 exist in VPS Salespulse with `status = 'inactive'`
- These products have `product_businesses` relationships
- The sync API was returning `product_businesses` relationships for ALL products (including inactive)
- But inactive products weren't being synced to local POS database
- Result: Sync tried to create relationships for products that don't exist locally → warnings

## Fix Applied

**File**: `c:\Code\salespulse\src\app\api\sync\route.ts`

### Change 1: Products Query (line 84-91)
**Before:**
```sql
WHERE pb.business_id = ?
```

**After:**
```sql
WHERE pb.business_id = ? AND p.status = 'active'
```

### Change 2: Product_Businesses Query (line 154-159)
**Before:**
```sql
SELECT product_id, business_id
FROM product_businesses
WHERE business_id = ?
```

**After:**
```sql
SELECT pb.product_id, pb.business_id
FROM product_businesses pb
INNER JOIN products p ON pb.product_id = p.id
WHERE pb.business_id = ? AND p.status = 'active'
```

## Benefits

✅ **Consistency**: Only active products and their relationships are synced
✅ **No Warnings**: Inactive products won't cause sync warnings
✅ **Cleaner Data**: Local POS database won't have inactive product data
✅ **Matches Existing Pattern**: Same filtering logic as `product_customizations` query (line 114)

## Testing

After deploying this fix to VPS Salespulse:

1. **Verify warnings stop**: Run a sync and check that warnings for products 439/441 disappear
2. **Verify active products still sync**: Ensure all active products and their relationships sync correctly
3. **Check data consistency**: Verify that local POS database only has active products

## Notes

- This fix ensures consistency between products sync and product_businesses sync
- Inactive products (like test products 439, 441) will no longer cause sync issues
- If you need inactive products synced in the future, remove the status filter or add a parameter to control it

