# Testing Checklist - Phase 2 Part 1

## ✅ What Was Implemented

Phase 2 Part 1 added:
1. **NOT NULL validation** before uploading data to MySQL
2. **Date format conversion** (SQLite INTEGER/TEXT → MySQL datetime)
3. **Data migrations** to fix existing NULL values
4. **Shared sync utilities** for date conversion and validation

---

## 🧪 Testing Checklist

### 1. **Database Initialization** ✅ (Already Working)
- [x] App starts without errors
- [x] Database opens successfully
- [x] Migrations run without crashing

### 2. **Data Migration Testing**

#### Test NOT NULL Migrations:
- [ ] Check console logs on app startup - should see migration messages if data was fixed
- [ ] Verify businesses have `organization_id` (check in database or app)
- [ ] Verify users have `role_id` and `organization_id`
- [ ] Verify transactions have `created_at` timestamps
- [ ] Verify transactions have `refund_status` and `refund_total` defaults

**How to verify:**
- Look for these log messages on startup:
  - `📋 Migrating database: Setting default organization_id for X businesses...`
  - `📋 Migrating database: Setting default role_id and organization_id for X users...`
  - `📋 Migrating database: Setting default created_at for X transactions...`

### 3. **Transaction Upload Testing**

#### Test Transaction Sync:
1. **Create a new transaction** (if possible offline)
2. **Try to sync it** to MySQL
3. **Check console logs** for:
   - `✅ [SMART SYNC] Transaction X synced successfully`
   - OR `⚠️ [SMART SYNC] Transaction X missing required fields: ...` (if validation fails)

#### Test Date Conversion:
- [ ] Check that transaction `created_at` is in MySQL format (YYYY-MM-DD HH:MM:SS)
- [ ] Check that `updated_at` is converted properly (if present)
- [ ] Check that `last_refunded_at` is converted properly (if present)

**How to verify:**
- After sync, check MySQL database:
  ```sql
  SELECT id, created_at, updated_at, last_refunded_at 
  FROM transactions 
  ORDER BY id DESC LIMIT 5;
  ```
- Dates should be in format: `2025-12-20 10:30:45`

### 4. **Shift Upload Testing**

#### Test Shift Sync:
1. **Create/close a shift** (if possible)
2. **Try to sync it** to MySQL
3. **Check console logs** for validation messages

#### Test Date Conversion:
- [ ] Check that `shift_start` is in MySQL datetime format
- [ ] Check that `shift_end` is converted properly (if present)
- [ ] Check that `created_at` is converted properly
- [ ] Check that `closed_at` is converted properly (if present)
- [ ] Check that `updated_at` is kept as bigint (number) for shifts

**How to verify:**
- Check MySQL shifts table:
  ```sql
  SELECT id, shift_start, shift_end, created_at, closed_at, updated_at 
  FROM shifts 
  ORDER BY id DESC LIMIT 5;
  ```

### 5. **Refund Upload Testing**

#### Test Refund Sync:
1. **Create a refund** for a transaction
2. **Try to sync it** to MySQL
3. **Check console logs** for:
   - Validation messages if required fields are missing
   - Success messages if sync works

#### Test Date Conversion:
- [ ] Check that `refunded_at` is in MySQL datetime format
- [ ] Check that `created_at` is converted properly (if present)

**How to verify:**
- Check MySQL transaction_refunds table:
  ```sql
  SELECT id, refunded_at, created_at 
  FROM transaction_refunds 
  ORDER BY id DESC LIMIT 5;
  ```

### 6. **System POS Sync Testing**

#### Test System POS Sync:
1. **Create a transaction** that should sync to Receiptize
2. **Check console logs** for date conversion
3. **Verify** dates are in correct format

**How to verify:**
- Check System POS/Receiptize receives data with proper date formats
- No date format errors in console

### 7. **Error Handling Testing**

#### Test Validation:
- [ ] Create a transaction with missing `business_id` - should be skipped
- [ ] Create a transaction with missing `user_id` - should be skipped
- [ ] Create a transaction with missing `payment_method` - should use default 'cash'
- [ ] Check console for proper error messages

#### Test Invalid Data:
- [ ] Try to sync transaction with NULL `created_at` - should get default value
- [ ] Try to sync shift with missing required fields - should be filtered out
- [ ] Check that invalid data doesn't crash the app

---

## 🔍 What to Look For

### ✅ Success Indicators:
- Console shows: `✅ [SMART SYNC] Transaction X synced successfully`
- No date format errors in console
- Data appears correctly in MySQL with proper date formats
- No crashes or unhandled errors

### ⚠️ Warning Signs:
- Console shows: `⚠️ [SMART SYNC] Transaction X missing required fields`
- Console shows: `⚠️ [DATE CONVERSION] Could not convert...`
- Sync fails with MySQL errors about date formats
- Data not appearing in MySQL after sync

### ❌ Error Indicators:
- App crashes during sync
- Database errors about NOT NULL constraints
- MySQL errors about invalid date formats
- Transactions/shifts/refunds stuck in "pending" state

---

## 📝 Testing Notes

**Date Format Examples:**
- ✅ Correct: `2025-12-20 10:30:45`
- ❌ Wrong: `1734672645000` (timestamp)
- ❌ Wrong: `2025-12-20T10:30:45.000Z` (ISO with T and Z)

**Required Fields for Transactions:**
- `id`, `business_id`, `user_id`, `payment_method`, `pickup_method`
- `total_amount`, `final_amount`, `amount_received`, `payment_method_id`, `created_at`

**Required Fields for Shifts:**
- `uuid_id`, `business_id`, `user_id`, `shift_start`

**Required Fields for Refunds:**
- `transaction_uuid`, `business_id`, `refunded_by`, `refund_amount`, `payment_method_id`, `refunded_at`

---

## 🎯 Quick Test Script

If you want to quickly test, you can:

1. **Check migration logs** on app startup
2. **Create a test transaction** and try to sync
3. **Check MySQL** to verify date formats are correct
4. **Check console** for any validation/error messages

---

## ✅ Ready for Phase 2 Part 2?

Once you've verified:
- ✅ Transactions sync successfully with proper date formats
- ✅ Shifts sync successfully with proper date formats
- ✅ Refunds sync successfully with proper date formats
- ✅ Validation prevents invalid data from being uploaded
- ✅ No crashes or critical errors

Then you're ready to proceed to **Phase 2 Part 2**!

