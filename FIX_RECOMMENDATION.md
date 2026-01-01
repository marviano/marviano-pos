# Fix Recommendation: Product_Businesses Sync Filter

## Issue Found

Looking at `salespulse/src/app/api/sync/route.ts`:

### Products Query (lines 84-91)
```sql
SELECT p.*, c1.name as category1_name, c2.name as category2_name 
FROM products p 
INNER JOIN product_businesses pb ON p.id = pb.product_id 
LEFT JOIN category1 c1 ON p.category1_id = c1.id 
LEFT JOIN category2 c2 ON p.category2_id = c2.id 
WHERE pb.business_id = ?
```
**Problem**: This query does NOT filter by `p.status = 'active'`, so it SHOULD include inactive products. However, if products 439/441 don't have `product_businesses` relationships for business_id = 14, they won't be synced.

### Product_Businesses Query (lines 154-159)
```sql
SELECT product_id, business_id
FROM product_businesses
WHERE business_id = ?
ORDER BY product_id ASC, business_id ASC
```
**Problem**: This query does NOT filter by product status, so it includes relationships for inactive/deleted products.

## Root Cause

The inconsistency is:
- If products 439/441 have `product_businesses` relationships for business 14, they SHOULD be synced (because products query doesn't filter by status)
- But they might not have relationships for business 14, OR
- There's a logic issue where inactive products are filtered out somewhere else

**Most likely scenario**: Products 439/441 have `product_businesses` relationships for business 14, but they're inactive test products that shouldn't be used. The `product_businesses` query returns these relationships, but when sync tries to insert them locally, the products don't exist (maybe they were filtered out, or the products sync ran before these were added to product_businesses).

## Recommended Fix

**Add status filter to product_businesses query** to only include relationships for active products:

```sql
SELECT pb.product_id, pb.business_id
FROM product_businesses pb
INNER JOIN products p ON pb.product_id = p.id
WHERE pb.business_id = ? AND p.status = 'active'
ORDER BY pb.product_id ASC, pb.business_id ASC
```

This ensures:
- ✅ Only relationships for active products are synced
- ✅ Consistency with POS usage (only active products should be available)
- ✅ No warnings for inactive/deleted products
- ✅ Matches the filtering logic used elsewhere in the codebase

## Alternative: Also Filter Products Query

If you want to ONLY sync active products, also update the products query:

```sql
SELECT p.*, c1.name as category1_name, c2.name as category2_name 
FROM products p 
INNER JOIN product_businesses pb ON p.id = pb.product_id 
LEFT JOIN category1 c1 ON p.category1_id = c1.id 
LEFT JOIN category2 c2 ON p.category2_id = c2.id 
WHERE pb.business_id = ? AND p.status = 'active'
```

This would ensure inactive products are never synced.

## Verification Query

Run this on VPS Salespulse to see how many product_businesses records reference inactive products:

```sql
SELECT 
    COUNT(*) AS total_inactive_product_relationships,
    COUNT(DISTINCT pb.product_id) AS unique_inactive_products,
    GROUP_CONCAT(DISTINCT pb.product_id ORDER BY pb.product_id) AS inactive_product_ids
FROM product_businesses pb
INNER JOIN products p ON pb.product_id = p.id
WHERE p.status = 'inactive';
```

