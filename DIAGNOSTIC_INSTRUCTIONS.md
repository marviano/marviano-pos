# Diagnostic Instructions

## Understanding the Issue

The sync warnings mean:
- **Source (Salespulse)**: Has `product_businesses` records linking products 439/441 to businesses
- **Target (Local POS)**: Products 439/441 don't exist in the local `products` table
- **Result**: Sync correctly skips these invalid relationships

## Which Database to Check?

You need to run queries on **BOTH** databases:

### 1. **LOCAL POS Database** (the one being synced TO)
- Database name is likely `system_pos` or similar (check your connection)
- This is where products 439/441 are MISSING
- The sync code checks this database before inserting into `product_businesses`

### 2. **SALESPULSE Database** (the source being synced FROM)
- Database name is `salespulse`
- This likely HAS the product_businesses records for 439/441
- Need to verify if products 439/441 exist there

## Diagnostic Queries

Use `diagnostic_products_439_441.sql` to check:

1. **Query 1**: Do products 439/441 exist? (Run on both databases)
2. **Query 2**: What product_businesses records exist? (Run on both databases)
3. **Query 3**: Count orphaned records (Run on LOCAL POS)
4. **Query 4**: Check nearby product IDs (to see if there's a gap)
5. **Query 5**: See the product ID range

## Expected Results

### If Query 1 returns NO RESULTS in LOCAL POS:
- ✅ Confirms products 439/441 don't exist locally
- This is why sync is skipping them

### If Query 1 returns RESULTS in SALESPULSE:
- Products exist in source but not in target
- Need to sync products first, then product_businesses

### If Query 1 returns NO RESULTS in BOTH:
- Products were deleted from both databases
- product_businesses records are orphaned in salespulse
- Need to clean up product_businesses records in salespulse

## Next Steps Based on Results

1. **Products exist in Salespulse but not Local POS:**
   - Ensure products sync runs before product_businesses sync
   - Check sync order/priority

2. **Products don't exist in either database:**
   - Clean up orphaned product_businesses records in Salespulse
   - Remove records where product_id IN (439, 441)

3. **Products exist in Local POS but still getting warnings:**
   - Check if there's a timing issue (products added after sync started)
   - Verify database connection is correct

