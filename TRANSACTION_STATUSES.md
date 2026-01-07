# Transaction and Transaction Item Statuses

## Transaction Statuses

### 1. `pending`
- **Meaning**: Transaction is saved but not yet paid
- **When set**: When user clicks "Simpan Order" (saves transaction to database)
- **Operation**: 
  - Transaction appears in "Active Orders" tab
  - Items are sent to kitchen/barista displays (if `production_status` is `null`)
  - Transaction can be loaded back into cart for editing/payment
  - Transaction is NOT included in completed transactions report

### 2. `completed`
- **Meaning**: Transaction has been fully paid and completed
- **When set**: When user completes payment in PaymentModal
- **Operation**:
  - Transaction is removed from "Active Orders" tab
  - Transaction appears in "Daftar Transaksi" (Transaction List)
  - Transaction is included in reports
  - Receipt is printed (if selected)
  - Transaction is ready for sync to server

### 3. `paid`
- **Meaning**: Similar to `completed`, transaction has been paid
- **When set**: Alternative status for paid transactions
- **Operation**: Same as `completed` - transaction is finished and ready for sync

### 4. `cancelled`
- **Meaning**: Transaction has been cancelled
- **When set**: When transaction is cancelled (rarely used)
- **Operation**: Transaction is excluded from normal operations

---

## Transaction Item `production_status`

### 1. `null` (NULL)
- **Meaning**: Item has been sent to kitchen/barista but production hasn't started yet
- **When set**: When transaction is saved with "Simpan Order" or when new items are added
- **Operation**:
  - Item is **visible** on kitchen/barista displays
  - Item is **locked** in cart (cannot be edited without password)
  - Item is waiting to be started by kitchen/barista staff
  - Item will be sent to kitchen/barista when transaction is saved

### 2. `preparing`
- **Meaning**: Kitchen/barista has started preparing the item
- **When set**: When kitchen/barista clicks "Start" on the item in their display
- **Operation**:
  - Item is **visible** on kitchen/barista displays
  - Item is **locked** in cart
  - Item shows as "in progress" on displays
  - Timer starts counting preparation time

### 3. `finished`
- **Meaning**: Kitchen/barista has finished preparing the item
- **When set**: When kitchen/barista clicks "Finish" on the item in their display
- **Operation**:
  - Item is **removed** from kitchen/barista displays (no longer visible)
  - Item is **locked** in cart
  - Item is considered complete
  - Item will not be sent to kitchen/barista again

### 4. `cancelled`
- **Meaning**: Item has been cancelled (removed from order after being sent)
- **When set**: When user removes a locked item from cart (requires password "KONFIRMASI")
- **Operation**:
  - Item is **removed** from kitchen/barista displays
  - Item is **excluded** from transaction totals
  - Item is **excluded** from reports (except cancelled items report)
  - Item will not be sent to kitchen/barista again

---

## Status Flow Examples

### Normal Flow (New Transaction → Pay Directly)
1. User adds items to cart
2. User clicks "Bayar" (Pay)
3. Transaction created with `status: 'completed'`
4. Items created with `production_status: null`
5. Items sent to kitchen/barista displays
6. Kitchen/barista starts: `production_status: 'preparing'`
7. Kitchen/barista finishes: `production_status: 'finished'`

### Flow with "Simpan Order" (Save First → Pay Later)
1. User adds items to cart
2. User clicks "Simpan Order"
3. Transaction created with `status: 'pending'`
4. Items created with `production_status: null`
5. Items sent to kitchen/barista displays ✅
6. User goes to "Active Orders" → clicks "Lihat"
7. Transaction loaded into cart (items are locked)
8. User clicks "Bayar"
9. Transaction updated to `status: 'completed'`
10. **PROBLEM**: Items are sent to kitchen/barista AGAIN ❌ (duplicate)
11. **FIX**: Check if items already have `production_status` set before sending

---

## Key Rules

1. **Items with `production_status: null`** are sent to kitchen/barista displays
2. **Items with `production_status: 'preparing'`** are visible and in progress
3. **Items with `production_status: 'finished'`** are done and removed from displays
4. **Items with `production_status: 'cancelled'`** are excluded from operations
5. **When paying a transaction that was previously saved**, check if items were already sent (have `production_status` set) before sending again

