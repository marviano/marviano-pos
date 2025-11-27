# 🔍 Debug Guide: Printing Fails After Data Sync

## Problem Description

**Symptom:** After downloading/syncing data from the server to the POS offline database, shift report printing stops working.

**Working:** Normal transaction receipts from kasir page still print fine.

**Hypothesis:** The synced data may contain:
- Invalid/corrupted records
- NULL values where numbers are expected
- Missing required fields
- NaN (Not a Number) values
- Extremely large datasets causing memory issues
- Special characters breaking HTML generation

---

## 🛠️ Comprehensive Debugging Added

I've added **extensive debugging** throughout the print process to help us identify exactly where and why it fails.

### New Debug Features

#### 1. **Data Validation Before HTML Generation**

The system now checks for:
- Invalid product records (missing names, NaN quantities)
- Invalid customization records
- NaN values in cash summary
- Data structure integrity

#### 2. **HTML Generation Error Handling**

- Try-catch blocks around product row generation
- Try-catch blocks around customization row generation
- Safe fallbacks for invalid numeric values
- Detailed error logging for each failed record

#### 3. **Step-by-Step Process Logging**

Every stage of the print process now logs:
```
🖨️ Starting shift breakdown print
🔍 Validating data
✅ Data validation passed
🎨 Generating HTML
✅ HTML generation successful
📄 Generated HTML size: X.XX KB
🪟 Creating print window
📝 Loading HTML into print window
✅ HTML loaded successfully
🖨️ Print options: {...}
```

#### 4. **Error Capture at Every Level**

- Data validation errors
- HTML generation errors
- Window creation errors
- HTML loading errors
- Print execution errors

---

## 🧪 How to Debug

### Step 1: Rebuild and Restart

The debugging code has been added. Rebuild the Electron app:

```bash
cd C:\Code\marviano-pos
npm run build:electron
```

Then **completely restart** the Electron POS app.

### Step 2: Open Developer Console

Press **F12** to open Developer Tools and go to the **Console** tab.

**IMPORTANT:** Keep console open while testing!

### Step 3: Try Printing After Sync

1. Make sure you've synced data from the server
2. Go to **Ganti Shift**
3. Click **"Print All"**
4. Select any shift (e.g., "Shift 1" or "Whole Day")
5. Click **"Print"**
6. **Watch the console carefully**

### Step 4: Analyze Console Output

#### ✅ **If Printing Works, You'll See:**

```
🖨️ [SHIFT PRINT] Starting shift breakdown print...
   - Shift: John Doe
   - Products: 50
   - Customizations: 20
   - Payments: 45
   - Orders: 45
📋 [SHIFT PRINT] Using configured printer: Your Printer Name
🔍 [SHIFT PRINT] Validating data...
   - productSales count: 50
   - customizationSales count: 20
   - paymentBreakdown count: 3
   - cashSummary: {"cash_shift":500000,...}
✅ [SHIFT PRINT] Data validation passed
🎨 [SHIFT PRINT] Generating HTML...
✅ [SHIFT PRINT] HTML generation successful
📄 [SHIFT PRINT] Generated HTML size: 45.67 KB (46798 chars)
🪟 [SHIFT PRINT] Creating print window
📝 [SHIFT PRINT] Loading HTML into print window...
✅ [SHIFT PRINT] HTML loaded successfully
🖨️ [SHIFT PRINT] Print options: {silent: true, ...}
✅ [SHIFT PRINT] Shift breakdown printed successfully
```

#### ❌ **If There's a Data Problem, You'll See:**

**Example 1: Invalid Product Data**
```
🔍 [SHIFT PRINT] Validating data...
❌ [SHIFT PRINT] Found invalid products: [
  {
    product_name: null,  // <-- MISSING NAME!
    total_quantity: NaN, // <-- NaN VALUE!
    ...
  }
]
```

**Example 2: NaN in Cash Summary**
```
🔍 [SHIFT PRINT] Validating data...
❌ [SHIFT PRINT] NaN detected in cashSummary.cash_shift
❌ [SHIFT PRINT] NaN detected in cashSummary.kas_expected
```

**Example 3: HTML Generation Failure**
```
🎨 [SHIFT PRINT] Generating HTML...
❌ [HTML GEN] Invalid numbers in product: Kopi Susu
   quantity: NaN
   baseSubtotal: NaN
   unitPrice: Infinity
❌ [SHIFT PRINT] HTML generation failed: Cannot read property 'toLocaleString' of undefined
   Error stack: ...
```

**Example 4: Print Window Failure**
```
🪟 [SHIFT PRINT] Creating print window
❌ [SHIFT PRINT] Failed to create print window: [error details]
```

**Example 5: Large Print Job Warning**
```
📄 [SHIFT PRINT] Generated HTML size: 567.89 KB (581523 chars)
⚠️ [SHIFT PRINT] Large print job detected! This may cause printing issues.
```

---

## 🎯 What to Look For

### Common Issues from Synced Data

#### 1. **NULL Product Names**
```
❌ Found invalid products: [{product_name: null, ...}]
```
**Cause:** Database has products without names
**Fix:** Need to update sync to handle missing product names

#### 2. **NaN Quantities or Prices**
```
❌ Invalid numbers in product: [product name]
   quantity: NaN
   baseSubtotal: NaN
```
**Cause:** Database has NULL or invalid numeric values
**Fix:** Need to add COALESCE(column, 0) in SQL queries

#### 3. **Infinity Values**
```
❌ Invalid numbers in product: [product name]
   unitPrice: Infinity
```
**Cause:** Division by zero (quantity = 0 but trying to calculate unit price)
**Fix:** Already handled in new code with safe fallbacks

#### 4. **Missing Cash Summary Fields**
```
❌ NaN detected in cashSummary.cash_shift
```
**Cause:** Cash summary calculation returns NULL
**Fix:** Need to ensure cash summary queries return 0 instead of NULL

#### 5. **Extremely Large HTML**
```
⚠️ Large print job detected!
📄 Generated HTML size: 2567.89 KB
```
**Cause:** Too many transactions in shift (thousands of products)
**Fix:** May need pagination or summary-only mode

---

## 📋 Troubleshooting Steps

### If You See Data Validation Errors:

1. **Copy the full error** from console
2. Check which field has issues (product_name, total_quantity, etc.)
3. Query your local database to find the bad records:

```sql
-- Example: Find products with NULL names
SELECT * FROM products WHERE name IS NULL;

-- Example: Find transactions with invalid quantities
SELECT * FROM transaction_items 
WHERE quantity IS NULL OR quantity < 0;
```

4. Share the error details so we can fix the sync queries

### If HTML Generation Fails:

1. **Copy the full error stack** from console
2. Note which record caused the failure (will be logged)
3. The system now has **safe fallbacks** - invalid records will show as "0" instead of crashing
4. But we still need to fix the root cause in the database

### If Print Window Fails:

1. Check available memory (Task Manager)
2. Try closing other applications
3. Check if HTML size is extremely large (> 1 MB)
4. May need to reduce data size per print job

---

## 🔧 Quick Fixes Already Implemented

The new code includes automatic fixes for common issues:

✅ **Safe Numeric Defaults**
- NULL quantities → 0
- NULL prices → 0
- NULL revenues → 0

✅ **NaN Protection**
- Checks `isNaN()` before displaying
- Shows "0" instead of crashing

✅ **Missing String Defaults**
- NULL product names → "Unknown"
- NULL customization names → "N/A"
- NULL payment methods → "N/A"

✅ **Error Containment**
- Individual product errors don't crash entire report
- Shows error row instead: "Error processing product: [name]"

---

## 📊 Next Steps

### 1. Test and Capture Logs

Run the print job and **copy the entire console output** (right-click in console → "Save as...")

### 2. Identify the Root Cause

The logs will show exactly:
- Which records have bad data
- What fields are NULL/NaN
- Where the process fails

### 3. Fix the Database Queries

Once we know which fields are problematic, we can update:
- The sync queries to handle NULL values
- The local database queries to use COALESCE
- Data validation during sync

### 4. Re-test

After fixing the queries:
- Sync data again
- Try printing
- Should see clean logs with no errors

---

## 💡 Example: How to Read the Logs

**Scenario:** Printing fails after sync

**Console Output:**
```
🖨️ [SHIFT PRINT] Starting shift breakdown print...
   - Products: 150
   - Customizations: 45
   - Orders: 100
🔍 [SHIFT PRINT] Validating data...
   - productSales count: 150
❌ [SHIFT PRINT] Found invalid products: [
  {
    product_id: 123,
    product_name: null,
    total_quantity: NaN,
    platform: "offline"
  },
  {
    product_id: 456,
    product_name: "Kopi Susu",
    total_quantity: 5,
    total_subtotal: NaN
  }
]
❌ [HTML GEN] Invalid numbers in product: null
   quantity: NaN, baseSubtotal: NaN, unitPrice: NaN
```

**Analysis:**
1. ❌ Product ID 123 has NULL name and NaN quantity
2. ❌ Product ID 456 has NaN subtotal
3. 🎯 **Root Cause:** The sync or database queries return NULL instead of 0
4. 🔧 **Fix Needed:** Update SQL queries to use `COALESCE(quantity, 0)` and `COALESCE(subtotal, 0)`

---

## 🆘 What to Share for Support

If you need help, please provide:

1. **Full console output** (from start of print attempt to error)
2. **Database query results** (if you can run SQL):
   ```sql
   -- Check for NULL/invalid data
   SELECT COUNT(*) FROM products WHERE name IS NULL;
   SELECT COUNT(*) FROM transaction_items WHERE quantity IS NULL;
   SELECT COUNT(*) FROM transaction_items WHERE subtotal IS NULL;
   ```
3. **When the issue started** (after which sync?)
4. **Size of synced data** (how many transactions, products, etc.)

---

## ✅ Success Criteria

You'll know the issue is fixed when:

✅ Console shows clean logs with no errors
✅ All data validation passes
✅ HTML generation successful
✅ Print completes without warnings
✅ Receipt prints correctly

---

## 🚀 Rebuild Command

Don't forget to rebuild after the debugging code was added:

```bash
cd C:\Code\marviano-pos
npm run build:electron
```

Then **completely restart** the Electron POS app (not just refresh - fully close and reopen).

---

**The extensive logging will tell us exactly what's wrong!** 🔍


