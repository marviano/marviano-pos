# products.nama length and Barista/Kitchen display cut-off

**Symptom:** Product names like "Es Teh Racikan Nona Laras (Manual)" appear as "Es Teh Racikan Nona Laras (Man" on Barista/Kitchen display.

**Cause (proven by debug logs):** `orderItem.product_name` is exactly 30 characters because it comes from `product.nama` in the DB. The `products.nama` column was effectively limited to 30 characters (e.g. `VARCHAR(30)` or data inserted truncated).

**Fix:**

1. Run `ensure_products_nama_length.sql` on the MySQL database the POS uses (the one in `.env` / getDbConfig).
2. If you sync products from a VPS/SalesPulse API, run the same `ALTER TABLE products MODIFY COLUMN nama VARCHAR(255)...` on that database too, then trigger a fresh sync so full names are stored.
3. For existing rows that were stored with 30 chars, update them from your source of truth (e.g. edit in SalesPulse manage-products and sync again, or run an UPDATE from a backup/export that has full names).

After the schema and data hold full names, the Barista/Kitchen display will show them in full (layout and wrapping are already correct).
