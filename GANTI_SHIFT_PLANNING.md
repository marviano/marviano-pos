# Ganti Shift (Change Shift) Feature - Planning Document

## Overview
The Ganti Shift page will allow cashiers to manage their work shifts, track starting cash (modal awal), and view shift summaries including transaction counts, totals, and payment method breakdowns.

---

## Database Analysis

### Existing Tables Used
1. **`transactions`** - Main transaction records
   - `id` (int, auto-increment) - Transaction ID
   - `uuid_id` (varchar(36)) - UUID for transactions
   - `business_id` (int) - Reference to business (14 for Momoyo Bakery Kalimantan)
   - `user_id` (int) - Cashier who processed the transaction
   - `payment_method_id` (int) - FK to payment_methods table
   - `total_amount` (decimal) - Total before discount
   - `final_amount` (decimal) - Total after discount
   - `status` (enum: pending, completed, cancelled, refunded)
   - `created_at` (timestamp) - Transaction timestamp
   - `transaction_type` (enum: drinks, bakery) - Type of transaction

2. **`users`** - User information
   - `id` (int) - User ID
   - `email` (varchar) - User email (for login)
   - `name` (varchar) - User name (displayed as cashier name)
   - `role_id` (int) - User role

3. **`payment_methods`** - Payment method reference
   - `id` (int) - Payment method ID
   - `name` (varchar) - Payment method name
   - `code` (varchar) - Payment method code
   - `is_active` (tinyint) - Active status

### New Table Required: `shifts`

We need to create a new table to track shift sessions:

```sql
CREATE TABLE `shifts` (
  `id` int NOT NULL AUTO_INCREMENT,
  `uuid_id` varchar(36) NOT NULL COMMENT 'UUID for shift',
  `business_id` int NOT NULL COMMENT 'Reference to businesses table',
  `user_id` int NOT NULL COMMENT 'Cashier user ID',
  `user_name` varchar(255) NOT NULL COMMENT 'Cashier name at time of shift',
  `shift_start` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'When shift started',
  `shift_end` timestamp NULL DEFAULT NULL COMMENT 'When shift ended (NULL if ongoing)',
  `modal_awal` decimal(15,2) NOT NULL DEFAULT 0.00 COMMENT 'Starting cash amount',
  `status` enum('active','completed','cancelled') DEFAULT 'active' COMMENT 'Shift status',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `synced` tinyint(1) DEFAULT 0 COMMENT 'Whether synced to online DB',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uuid_id` (`uuid_id`),
  KEY `idx_shifts_business` (`business_id`),
  KEY `idx_shifts_user` (`user_id`),
  KEY `idx_shifts_status` (`status`),
  KEY `idx_shifts_start` (`shift_start`),
  KEY `idx_shifts_synced` (`synced`),
  CONSTRAINT `fk_shifts_business` FOREIGN KEY (`business_id`) REFERENCES `businesses` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_shifts_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Cashier shift tracking';
```

**Why we need a shifts table:**
- Track when each cashier starts/ends their shift
- Store modal awal (starting cash) per shift
- Link transactions to specific shifts (in future enhancement)
- Enable shift history and reporting
- Support multiple cashiers working on different shifts

---

## Payment Methods

Based on `PaymentModal.tsx`, the payment methods are:

**Offline Payments:**
- `cash` - Cash
- `debit` - Debit Card
- `qr` - QR Code
- `ewallet` - E-Wallet
- `cl` - City Ledger
- `voucher` - Voucher

**Online Payments (for online orders):**
- `gofood` - GoFood
- `grabfood` - GrabFood
- `shopeefood` - ShopeeFood
- `tiktok` - TikTok

---

## Feature Requirements

### 1. Modal Awal (Starting Cash) Input
- **When**: User accesses Ganti Shift menu
- **What**: Input field for entering starting cash amount
- **Validation**: Must be numeric, >= 0
- **Storage**: Saved to `shifts` table in local SQLite DB
- **Sync**: Synced to online database every 5 minutes (existing sync mechanism)

### 2. Shift Summary Display

The page should show:

#### A. Current Shift Info
- Cashier name (from logged-in user)
- Shift start time
- Modal awal amount
- Shift status (Active/Ended)

#### B. Order Statistics
- **Jumlah Pesanan** (Order Count) - Total number of completed transactions during the current shift
  - Query: `COUNT(*) FROM transactions WHERE user_id = [current_user] AND created_at >= [shift_start] AND created_at <= [shift_end or NOW()] AND status = 'completed'`

#### C. Transaction Total
- **Total Transaksi** (Total Transaction Amount) - Sum of all final_amount in Indonesian Rupiah
  - Query: `SUM(final_amount) FROM transactions WHERE user_id = [current_user] AND created_at >= [shift_start] AND created_at <= [shift_end or NOW()] AND status = 'completed'`
  - Format: `Rp 4.075.000` (with dot separators every 3 digits)

#### D. Payment Method Breakdown Table
A table showing count of transactions by payment method:

| Payment Method | Count (User Session) |
|----------------|---------------------|
| Cash           | 45                  |
| Debit          | 12                  |
| QR             | 8                   |
| E-Wallet       | 5                   |
| CL             | 2                   |
| Voucher        | 1                   |
| **Total**      | **73**              |

- Query: Join `transactions` with `payment_methods` table
- Filter by: current user_id, shift timeframe, status = 'completed'

#### E. Cash Payment Statistics
1. **Cash Received (User Session)** - Total cash payments during current shift
   - Query: `SUM(final_amount) FROM transactions WHERE user_id = [current_user] AND created_at >= [shift_start] AND created_at <= [shift_end or NOW()] AND payment_method_id = [cash_payment_method_id] AND status = 'completed'`

2. **Cash Received (Whole Day)** - Total cash payments for calendar day (00:00 - 23:59)
   - Query: `SUM(final_amount) FROM transactions WHERE DATE(created_at) = CURDATE() AND payment_method_id = [cash_payment_method_id] AND status = 'completed' AND business_id = 14`

3. **Total Cash in Cashier** - Modal awal + Cash received during shift
   - Calculation: `modal_awal + cash_received_user_session`

---

## UI Layout Design

### Page Structure

**STATE 1: No Active Shift (Empty State)**
```
┌─────────────────────────────────────────────────────────┐
│  GANTI SHIFT                                            │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────────────────────────────────────────┐  │
│  │  💰 MODAL AWAL (STARTING CASH)                  │  │
│  │                                                 │  │
│  │  Mulai shift dengan memasukkan modal awal      │  │
│  │                                                 │  │
│  │  Rp [___________________]  (auto-focused)      │  │
│  │                                                 │  │
│  │  Shift akan otomatis dimulai setelah input     │  │
│  └─────────────────────────────────────────────────┘  │
│                                                         │
│  ┌─────────────────────────────────────────────────┐  │
│  │  SHIFT SUMMARY                                  │  │
│  │                                                 │  │
│  │  📦 Jumlah Pesanan: 0 transaksi                │  │
│  │  💰 Total Transaksi: Rp 0                      │  │
│  └─────────────────────────────────────────────────┘  │
│                                                         │
│  [End Shift] (disabled - grayed out)                   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**STATE 2: Active Shift (Working State)**
```
┌─────────────────────────────────────────────────────────┐
│  GANTI SHIFT                              [🔄 Refresh]  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌────────────────────────┐  ┌─────────────────────┐  │
│  │  SHIFT INFO            │  │  MODAL AWAL         │  │
│  │                        │  │                     │  │
│  │  Cashier: John Doe     │  │  Rp 500.000         │  │
│  │  Started: 08:00:00     │  │  (saat mulai shift) │  │
│  │  Status: ● Aktif       │  │                     │  │
│  └────────────────────────┘  └─────────────────────┘  │
│                                                         │
│  ┌─────────────────────────────────────────────────┐  │
│  │  SHIFT SUMMARY                                  │  │
│  │                                                 │  │
│  │  📦 Jumlah Pesanan: 73 transaksi               │  │
│  │  💰 Total Transaksi: Rp 4.075.000              │  │
│  └─────────────────────────────────────────────────┘  │
│                                                         │
│  ┌─────────────────────────────────────────────────┐  │
│  │  PAYMENT METHOD BREAKDOWN                        │  │
│  ├─────────────────────────┬───────────────────────┤  │
│  │ Payment Method          │ Count                 │  │
│  ├─────────────────────────┼───────────────────────┤  │
│  │ Cash                    │ 45                    │  │
│  │ Debit                   │ 12                    │  │
│  │ QR                      │ 8                     │  │
│  │ E-Wallet                │ 5                     │  │
│  │ CL                      │ 2                     │  │
│  │ Voucher                 │ 1                     │  │
│  ├─────────────────────────┼───────────────────────┤  │
│  │ TOTAL                   │ 73                    │  │
│  └─────────────────────────┴───────────────────────┘  │
│                                                         │
│  ┌─────────────────────────────────────────────────┐  │
│  │  CASH SUMMARY                                   │  │
│  │                                                 │  │
│  │  💵 Cash (Shift):      Rp 2.450.000            │  │
│  │  💵 Cash (Whole Day):  Rp 5.120.000            │  │
│  │  🏦 Cash in Cashier:   Rp 2.950.000            │  │
│  │     (Modal: Rp 500.000 + Shift: Rp 2.450.000)  │  │
│  └─────────────────────────────────────────────────┘  │
│                                                         │
│  [End Shift] (enabled - red button)                    │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Shift Flow Logic (SIMPLIFIED)

### When User Accesses "Ganti Shift" Page

**SCENARIO 1: No Active Shift**
1. User clicks on "Ganti Shift" menu
2. System checks if there's an active shift for this user
3. System shows:
   - Modal awal input field (prominent, auto-focused)
   - Empty statistics (all zeros)
   - "End Shift" button (disabled)
4. User enters modal awal amount
5. **Shift automatically starts when modal awal is entered/saved**
   - Create new shift record in `shifts` table:
     - uuid_id (generated)
     - business_id: 14
     - user_id: current user
     - user_name: current user name
     - shift_start: NOW()
     - modal_awal: entered amount
     - status: 'active'
   - Save to local SQLite
   - Queue for sync to online DB
6. Statistics begin showing (based on transactions from shift_start onwards)
7. "End Shift" button becomes enabled

**SCENARIO 2: Active Shift Exists**
1. User clicks on "Ganti Shift" menu
2. System detects active shift
3. System shows:
   - Current modal awal (read-only, or editable?)
   - Live statistics for the shift
   - "End Shift" button (enabled)
4. User can view stats anytime
5. When done, user clicks "End Shift"

### Ending a Shift (THE ONLY ACTION BUTTON)
1. User clicks "End Shift" button
2. Show confirmation dialog with final summary
3. If confirmed:
   - Update shift record:
     - shift_end: NOW()
     - status: 'completed'
   - Save to local SQLite
   - Queue for sync to online DB
4. After ending:
   - Show success message
   - Reset to "No Active Shift" state
   - Modal awal input becomes available again for next shift

### Transaction Linking - **NO SHIFT_ID NEEDED**
- Transactions are **NOT** linked to shift_id
- Statistics are calculated using:
  - `user_id` (cashier who made the transaction)
  - `timeframe` (shift_start to shift_end or NOW if shift is active)
- This approach is simpler and works because:
  - Each user can only have 1 active shift at a time
  - Transactions have user_id already
  - Time-based filtering is straightforward
  - No need to modify existing transactions table

---

## Data Queries

### 1. Check Active Shift
```sql
SELECT * FROM shifts 
WHERE user_id = ? 
AND business_id = 14 
AND status = 'active' 
ORDER BY shift_start DESC 
LIMIT 1
```

### 2. Order Count (User Session)
```sql
SELECT COUNT(*) as order_count
FROM transactions
WHERE user_id = ?
AND business_id = 14
AND created_at >= ?  -- shift_start
AND (? IS NULL OR created_at <= ?)  -- shift_end or NOW()
AND status = 'completed'
```

### 3. Total Transaction Amount (User Session)
```sql
SELECT COALESCE(SUM(final_amount), 0) as total_amount
FROM transactions
WHERE user_id = ?
AND business_id = 14
AND created_at >= ?  -- shift_start
AND (? IS NULL OR created_at <= ?)  -- shift_end or NOW()
AND status = 'completed'
```

### 4. Payment Method Breakdown (User Session)
```sql
SELECT 
  pm.name as payment_method_name,
  pm.code as payment_method_code,
  COUNT(t.id) as transaction_count
FROM transactions t
LEFT JOIN payment_methods pm ON t.payment_method_id = pm.id
WHERE t.user_id = ?
AND t.business_id = 14
AND t.created_at >= ?  -- shift_start
AND (? IS NULL OR t.created_at <= ?)  -- shift_end or NOW()
AND t.status = 'completed'
GROUP BY pm.id, pm.name, pm.code
ORDER BY transaction_count DESC
```

### 5. Cash Received (User Session)
```sql
SELECT COALESCE(SUM(final_amount), 0) as cash_total
FROM transactions t
LEFT JOIN payment_methods pm ON t.payment_method_id = pm.id
WHERE t.user_id = ?
AND t.business_id = 14
AND t.created_at >= ?  -- shift_start
AND (? IS NULL OR t.created_at <= ?)  -- shift_end or NOW()
AND t.status = 'completed'
AND pm.code = 'cash'
```

### 6. Cash Received (Whole Day)
```sql
SELECT COALESCE(SUM(final_amount), 0) as cash_total
FROM transactions t
LEFT JOIN payment_methods pm ON t.payment_method_id = pm.id
WHERE DATE(t.created_at) = CURDATE()
AND t.business_id = 14
AND t.status = 'completed'
AND pm.code = 'cash'
```

---

## Technical Implementation

### Files to Create/Modify

1. **New Component**: `src/components/GantiShift.tsx`
   - Main component for Ganti Shift page
   - Contains all UI elements and logic

2. **New SQLite Functions** (in Electron main process):
   - `localDbGetActiveShift(userId, businessId)`
   - `localDbCreateShift(shiftData)`
   - `localDbEndShift(shiftId, endTime)`
   - `localDbGetShiftSummary(userId, shiftId, businessId)`
   - `localDbGetPaymentMethodBreakdown(userId, shiftStart, shiftEnd, businessId)`
   - `localDbGetCashSummary(userId, shiftStart, shiftEnd, businessId)`

3. **Update**: `src/components/POSLayout.tsx`
   - Add case for 'Ganti Shift' in `renderMainContent()`
   - Import and render GantiShift component

4. **New Migration File**: 
   - Create database migration for `shifts` table
   - Add to both SQLite (local) and MySQL (online) schemas

5. **Update Sync Logic**: `src/lib/offlineSync.ts` or similar
   - Add shifts table to sync queue
   - Sync shifts data every 5 minutes

### Data Flow

```
User Login
    ↓
Check Active Shift (SQLite)
    ↓
  ┌─────────────────┐
  │ No Active Shift │──→ Show Modal Awal Input
  └─────────────────┘        ↓
                      Enter Amount & Start Shift
                             ↓
                      Create Shift Record (SQLite)
                             ↓
                      Queue for Sync (Online DB)
                             ↓
  ┌─────────────────┐
  │ Active Shift    │──→ Fetch Statistics (SQLite)
  └─────────────────┘        ↓
                      Display Dashboard
                             ↓
                      User Processes Transactions
                             ↓
                      Refresh Statistics
                             ↓
                      End Shift Button
                             ↓
                      Update Shift Record (SQLite)
                             ↓
                      Queue for Sync (Online DB)
```

---

## User Stories

### Story 1: Starting a Shift (Simplified - No Button)
**As a** cashier  
**I want to** input my modal awal and automatically start my shift  
**So that** I can quickly begin tracking my transactions

**Acceptance Criteria:**
- [ ] When accessing Ganti Shift with no active shift, modal awal input is auto-focused
- [ ] Shift automatically starts when user enters and saves modal awal
- [ ] Modal awal is validated (numeric, >= 0)
- [ ] Shift record is created in local database with timestamp
- [ ] Shift record is queued for sync to online database
- [ ] UI immediately shows active shift state
- [ ] Statistics begin calculating from shift start time
- [ ] "End Shift" button becomes enabled

### Story 2: Viewing Shift Summary
**As a** cashier  
**I want to** view my current shift statistics in real-time  
**So that** I can monitor my sales performance throughout my shift

**Acceptance Criteria:**
- [ ] Display cashier name and shift start time
- [ ] Display modal awal amount (read-only once shift started)
- [ ] Display total order count for current shift
- [ ] Display total transaction amount in Rupiah
- [ ] Display payment method breakdown table with counts
- [ ] Display cash received during current shift
- [ ] Display cash received for whole day (calendar day)
- [ ] Display total cash in cashier (modal + shift cash)
- [ ] All numbers formatted with dot separators (e.g., 4.075.000)
- [ ] Include manual "Refresh" button to update stats

### Story 3: Ending a Shift (The Only Button)
**As a** cashier  
**I want to** end my shift with one button click  
**So that** I can quickly finalize my shift and close out

**Acceptance Criteria:**
- [ ] "End Shift" button is prominent and easily accessible
- [ ] Button is only enabled when shift is active
- [ ] Clicking button shows confirmation dialog with final summary
- [ ] Confirmation shows: total orders, total amount, cash breakdown
- [ ] After confirmation, shift end time is recorded (NOW())
- [ ] Shift status updated to 'completed' in local database
- [ ] Changes queued for sync to online database
- [ ] Success message shown to user
- [ ] Page returns to "No Active Shift" state
- [ ] User can immediately start a new shift by entering new modal awal

### Story 4: Offline Support
**As a** cashier  
**I want to** manage shifts even when offline  
**So that** I can continue working without internet

**Acceptance Criteria:**
- [ ] All shift operations work offline using SQLite
- [ ] Modal awal input works offline
- [ ] Statistics calculation works offline
- [ ] End shift works offline
- [ ] Shifts are automatically synced when connection is restored
- [ ] No data loss during offline period
- [ ] Clear indication of sync status
- [ ] Pending sync items queued properly

---

## Transaction Linking Strategy - YOUR QUESTION ANSWERED ✅

### Your Question:
> "the transaction already have the user's id right? with it we can calculate the shift right? please correct me if i wrong"

### Answer: **YOU ARE CORRECT!** 👍

We do **NOT** need to add `shift_id` to the transactions table. Here's why:

#### How It Works:
1. **Transactions already have `user_id`** - identifies which cashier made the transaction
2. **Shifts have `shift_start` and `shift_end` timestamps** - defines the timeframe
3. **We calculate shift stats by matching**: `user_id` + timeframe

#### Example Query:
```sql
-- Get transaction count for active shift
SELECT COUNT(*) 
FROM transactions 
WHERE user_id = 5                     -- current cashier
  AND business_id = 14                -- Momoyo Bakery
  AND created_at >= '2025-10-27 08:00:00'  -- shift_start
  AND created_at <= NOW()             -- shift is still active (or shift_end if completed)
  AND status = 'completed'
```

#### Why This Approach Works:
✅ **Simpler**: No need to modify existing transactions table  
✅ **Flexible**: Can calculate stats for any time period  
✅ **Backward Compatible**: Works with existing transactions  
✅ **Less Coupling**: Transactions don't need to know about shifts  
✅ **Accurate**: User can only have 1 active shift at a time, so no ambiguity

#### When Would We Need shift_id in Transactions?
Only if:
- Multiple cashiers share the same user account (not your case)
- A cashier can have multiple overlapping shifts (prevented by our logic)
- You need to reassign transactions to different shifts (not needed)

**Conclusion**: Your intuition is correct - using `user_id` + timeframe is the right approach!

---

## Edge Cases & Considerations

### 1. Multiple Active Shifts
- **Issue**: User has an active shift but tries to start another
- **Solution**: Prevent multiple active shifts per user. Show warning and require ending current shift first.

### 2. Shift Spanning Multiple Days
- **Issue**: Shift starts on Day 1 and ends on Day 2
- **Solution**: "Whole day" cash calculation uses shift_start date as reference day.

### 3. User Logs Out with Active Shift
- **Issue**: User logs out without ending shift
- **Solution**: Keep shift active. When user logs back in, resume shift. Add warning message.

### 4. Modal Awal = 0
- **Issue**: User enters 0 as modal awal
- **Solution**: Allow it. Some businesses start with 0 cash.

### 5. No Payment Methods Data
- **Issue**: Payment methods table is empty
- **Solution**: Show "No payment methods configured" message. Sync payment methods data first.

### 6. Sync Failure
- **Issue**: Shift data fails to sync to online database
- **Solution**: Keep in local queue. Retry on next sync cycle. Show sync status indicator.

### 7. Negative Cash Calculation
- **Issue**: Cash calculation results in negative (due to refunds, voids, etc.)
- **Solution**: Display as-is. Highlight in red if negative.

### 8. Real-time Updates
- **Issue**: Statistics don't update as new transactions are added
- **Solution**: Add manual "Refresh" button. Or implement auto-refresh every 30 seconds.

---

## Number Formatting

All numeric values should follow Indonesian Rupiah format:
- Thousands separator: `.` (dot)
- Example: `4.075.000` not `4,075,000`
- Use existing format function or create:
  ```typescript
  const formatRupiah = (amount: number): string => {
    return `Rp ${amount.toLocaleString('id-ID')}`;
  };
  ```

---

## Icons & Styling

Following user preferences:
- Use React icons (lucide-react) instead of emojis
- Icon suggestions:
  - Shift Start: `<Clock />` or `<PlayCircle />`
  - Modal Awal: `<DollarSign />` or `<Wallet />`
  - Order Count: `<ShoppingBag />` or `<Package />`
  - Total Transaction: `<TrendingUp />` or `<DollarSign />`
  - Cash: `<Banknote />` or `<Wallet />`
  - Payment Methods: `<CreditCard />`, `<Smartphone />`, `<QrCode />`
  - End Shift: `<StopCircle />` or `<XCircle />`
  - Refresh: `<RefreshCw />`

---

## Testing Checklist

- [ ] Start shift with modal awal
- [ ] View shift summary with 0 transactions
- [ ] Process transactions and verify stats update
- [ ] Verify payment method breakdown accuracy
- [ ] Verify cash calculations (shift + whole day)
- [ ] End shift successfully
- [ ] Start new shift after ending previous
- [ ] Test with multiple payment methods
- [ ] Test offline functionality
- [ ] Test sync to online database
- [ ] Test number formatting (dots every 3 digits)
- [ ] Test with different user accounts
- [ ] Test edge cases (0 modal, negative cash, etc.)

---

## Future Enhancements

1. **Shift History**
   - View past shifts
   - Compare shift performance
   - Export shift reports

2. **Shift Handover**
   - Transfer cash to next shift
   - Add notes during handover
   - Require supervisor approval

3. **Cash Discrepancy Tracking**
   - Expected cash vs actual cash
   - Record reasons for discrepancies
   - Alert on significant differences

4. **Multi-cashier Support**
   - View all active shifts
   - Manager dashboard
   - Shift overlap handling

5. **Shift Targets**
   - Set sales targets per shift
   - Track progress toward target
   - Show completion percentage

---

## Questions Resolved

✅ Need shifts table? **YES** - Required for tracking modal awal and shift times  
✅ Session definition? **Login-based with shift start/end times**  
✅ Modal awal storage? **SQLite shifts table, synced every 5 mins**  
✅ Payment methods? **Found in PaymentModal.tsx - cash, debit, qr, ewallet, cl, voucher + online methods**  
✅ Shift flow? **SIMPLIFIED: Input modal awal (auto-starts shift) → View stats → End shift button**  
✅ Whole day definition? **Calendar day 00:00-23:59**  
✅ Transaction linking? **NO shift_id needed - use user_id + timeframe matching**  
✅ UI layout? **Designed by AI - 2 states: Empty (modal input) and Active (with stats)**  

---

## Document Changes (v1.0 → v2.0)

### SIMPLIFIED Based on User Feedback:

1. **Removed "Start Shift" Button**
   - Shift now auto-starts when modal awal is entered
   - One less click for user
   - Simpler mental model

2. **Clarified Transaction Linking**
   - Confirmed NO shift_id needed in transactions table
   - Use user_id + timeframe matching instead
   - Keeps existing schema unchanged

3. **Updated UI Layout**
   - Added two distinct states: Empty and Active
   - Empty state: prominent modal awal input
   - Active state: full statistics dashboard
   - Only ONE action button: "End Shift"

4. **Simplified User Stories**
   - Story 1: Auto-start shift with modal awal input
   - Story 3: Only one button - "End Shift"
   - Removed complexity around multiple buttons

5. **Added Transaction Linking Explanation**
   - New section addressing user's question directly
   - Explains why user_id + timeframe works
   - Provides example query

---

## Next Steps

1. **✅ Document updated based on feedback**
2. **⏳ Awaiting user approval** to proceed with implementation
3. Create database migration for `shifts` table (SQLite + MySQL)
4. Implement SQLite functions in Electron main process:
   - `localDbGetActiveShift()`
   - `localDbCreateShift()`
   - `localDbEndShift()`
   - `localDbGetShiftStatistics()`
5. Build `GantiShift.tsx` component with two states
6. Integrate with `POSLayout.tsx`
7. Test offline and online functionality
8. Add shifts table to sync queue (5-minute interval)
9. Test edge cases and user flows

---

**Document Version**: 2.0 (Updated based on user feedback)  
**Created**: 2025-10-27  
**Updated**: 2025-10-27  
**Author**: AI Assistant  
**Project**: Marviano POS - Ganti Shift Feature

