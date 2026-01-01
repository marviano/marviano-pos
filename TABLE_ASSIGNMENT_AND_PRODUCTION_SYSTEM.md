# Table Assignment and Production System - Implementation Plan

## Overview
This document outlines the complete implementation plan for adding table assignment functionality and rebuilding the kitchen/barista production monitoring system.

## 📍 Current Status (Updated)

### Phase 1: ✅ COMPLETED
- Database schema changes have been applied
- `table_id` column added to `transactions` table
- Foreign key constraint created

### Phase 2: ✅ COMPLETED
**Scope: Saving pending orders to tables only (no loading/managing existing orders)**

**What Phase 2 implemented:**
- [x] Create `TableSelectionModal.tsx` component
- [x] Enable "Simpan Order" button (formerly "Pesanan Tertunda") in `CenterContent.tsx`
- [x] Make tables clickable in modal
- [x] Show tables in **RED color** when they have pending orders (overrides default blue colors)
- [x] Save pending transactions with `table_id`, `status='pending'`, `pickup_method='dine-in'`
- [x] Save all transaction items with customizations, notes, bundle selections (for kitchen/barista display)
- [x] Save transaction item customizations to database
- [x] Check table availability (one pending transaction per table rule)
- [x] Clear cart after saving

**What Phase 2 did NOT implement (deferred to later phases):**
- ❌ Loading existing transactions into cart (Phase 4)
- ❌ Payment processing for pending orders (Phase 4)
- ❌ Kitchen/Barista display pages (Phase 5 & 6)

### Phase 3: ✅ COMPLETED
**Active Orders Tab - Viewing pending orders**

**What Phase 3 implemented:**
- [x] Create `ActiveOrdersTab.tsx` component
- [x] Query pending transactions
- [x] Display transaction list in table format (Table/Room, Customer name, Total, Timer, Lihat button)
- [x] Integrate into Kasir page tabs area (right side button with green border and notification badge)
- [x] Auto-refresh transaction list every 5 seconds
- [x] Real-time timer updates
- [x] Load transaction into cart functionality (Lihat button populates cart)

---

## 1. Database Schema Changes

### 1.1 Add `table_id` to `transactions` table

```sql
-- Add table_id column to transactions table
ALTER TABLE transactions 
ADD COLUMN table_id INT NULL,
ADD CONSTRAINT fk_transactions_table 
  FOREIGN KEY (table_id) REFERENCES restaurant_tables(id) 
  ON DELETE SET NULL;
```

### 1.2 Business Logic Constraint (Application-Level)

**Note:** MySQL doesn't support partial unique indexes with WHERE clauses. We'll enforce the "one pending transaction per table" rule in application logic.

**Constraint Rule:**
- One table can only have ONE pending transaction at a time
- **Phase 2 Implementation:** When selecting a table that already has a pending transaction, show warning/error (prevent selection)
- **Phase 3-4 (Future):** When selecting a table with pending transaction, automatically load that transaction into the cart

**Implementation:** Check in application code before creating/updating transactions:
```typescript
// Pseudo-code
async function checkTableAvailability(tableId: number): Promise<Transaction | null> {
  const existingPending = await query(
    `SELECT * FROM transactions 
     WHERE table_id = ? AND status = 'pending' 
     LIMIT 1`,
    [tableId]
  );
  return existingPending[0] || null;
}
```

---

## 2. Transaction Status and Lifecycle

### 2.1 Transaction Status Values

- `'pending'` = Unpaid transaction (items may be cooking, finished, or not started)
- `'completed'` = Paid transaction
- `'cancelled'` = Cancelled transaction
- `'refunded'` = Refunded transaction

### 2.2 Item Production Status (in `transaction_items`)

- `NULL` = Not started
- `'preparing'` = Being cooked/prepared
- `'finished'` = Finished cooking/preparing

**Important:** Transaction status and item production status are independent. A transaction can be `'pending'` with some items `'finished'` and others `NULL`.

### 2.3 Rules

- Items can be added to a transaction as long as `status = 'pending'` (unpaid)
- Payment can happen at any time (while items are cooking, finished, or not started)
- When `status = 'completed'`, transaction disappears from Active Orders

---

## 3. UI/UX Changes

### 3.1 Enable "Pesanan Tertunda" Button

**Location:** `src/components/CenterContent.tsx` (line 770-772)

**Changes:**
- Remove `disabled` attribute
- Remove `line-through` styling
- Add `onClick` handler to open table selection modal
- Change styling to active button (blue/green background)

### 3.2 Table Selection Modal

**New Component:** `src/components/TableSelectionModal.tsx`

**Features (Phase 2 - Current Implementation):**
- Shows table layout (similar to `TableLayout` component)
- Tables are clickable/selectable
- Shows table status:
  - **Available** (blue/green) - can be selected
  - **Has pending order** (**RED** color - must override default table colors) - cannot be selected (shows warning)
- When available table is selected: Save transaction as pending with `table_id` and `pickup_method = 'dine-in'`
- When table with pending order is clicked: Show warning/error (enforce "one pending per table" rule)

**Future (Phase 3-4):**
- Load existing order into cart (not in Phase 2 scope)
- Payment processing for pending orders (not in Phase 2 scope)

### 3.3 Active Orders Tab

**Location:** Right sidebar in Kasir page (same area as Offline/Online tabs)

**New Component:** `src/components/ActiveOrdersTab.tsx`

**Display:**
- List of all transactions where `status = 'pending'`
- Each row shows:
  - Table number (or "Take-away" if `table_id IS NULL`)
  - Item count
  - Total amount
  - Time created (e.g., "2 min ago")
  - Visual indicator if items are being cooked
- Sorted by: most recent first (or by table number)

**Interaction:**
- Click "Lihat" button → Load transaction into cart
- Cart repopulates with all items from that transaction
- User can then:
  - Add more items → Save → Updates same transaction
  - Process payment → Click "Menerima Pesanan" → Payment modal → Transaction marked as `'completed'`

**Integration:**
- Add as third tab in the right sidebar (alongside Offline/Online tabs)
- Or integrate into existing cart summary area

---

## 4. Kitchen/Barista Display Pages

### 4.1 Rebuild from Scratch

**Existing Pages to Replace:**
- `src/app/kitchen/page.tsx` (if exists)
- `src/app/barista/page.tsx` (if exists)

**New Implementation:**

#### 4.1.1 Data Query

```sql
SELECT 
  ti.id,
  ti.uuid_id,
  ti.transaction_id,
  ti.uuid_transaction_id,
  ti.product_id,
  ti.quantity,
  ti.unit_price,
  ti.total_price,
  ti.custom_note,
  ti.production_status,
  ti.production_started_at,
  ti.production_finished_at,
  t.table_id,
  rt.table_number,
  p.nama as product_name,
  p.menu_code,
  c1.id as category1_id,
  c1.name as category1_name,
  -- Customization data (aggregated)
  GROUP_CONCAT(
    DISTINCT CONCAT(
      tico.option_name,
      IF(tico.price_adjustment != 0, 
        CONCAT(' (+', tico.price_adjustment, ')'), 
        '')
    ) 
    ORDER BY tico.option_name 
    SEPARATOR ', '
  ) as customization_options,
  GROUP_CONCAT(DISTINCT tic.customization_type_id) as customization_type_ids
FROM transaction_items ti
JOIN transactions t ON ti.uuid_transaction_id = t.uuid_id
LEFT JOIN restaurant_tables rt ON t.table_id = rt.id
JOIN products p ON ti.product_id = p.id
JOIN category1 c1 ON p.category1_id = c1.id
LEFT JOIN transaction_item_customizations tic ON ti.id = tic.transaction_item_id
LEFT JOIN transaction_item_customization_options tico ON tic.id = tico.transaction_item_customization_id
WHERE t.status = 'pending'
  AND (ti.production_status IS NULL OR ti.production_status = 'preparing')
  AND c1.name = ? -- 'makanan' for kitchen, 'minuman' for barista
GROUP BY 
  ti.id,
  ti.product_id,
  -- Group by customization signature
  COALESCE(
    CONCAT(
      GROUP_CONCAT(DISTINCT tic.customization_type_id ORDER BY tic.customization_type_id),
      '_',
      COALESCE(ti.custom_note, '')
    ),
    'no_customization'
  )
ORDER BY t.created_at ASC, ti.id ASC
```

#### 4.1.2 Grouping Logic

**Grouping Key:** `product_id` + `customization_signature`

**Customization Signature Algorithm:**
```typescript
function createCustomizationSignature(
  productId: number,
  customizationOptions: Array<{optionId: number, optionName: string}>,
  customNote: string | null
): string {
  // Sort option IDs to ensure consistent grouping
  const sortedOptionIds = customizationOptions
    .map(opt => opt.optionId)
    .sort((a, b) => a - b)
    .join(',');
  
  // Combine into signature
  const signature = `${productId}_${sortedOptionIds}_${customNote || ''}`;
  
  return signature;
}
```

**Grouping Rules:**
- Same `product_id` + same `customization_signature` → Aggregate quantities
- Same `product_id` + different `customization_signature` → Separate rows

**Example:**
```
Input:
- 3x mie goreng (no customization)
- 1x mie goreng + keju, note: tidak pedas
- 1x mie goreng + keju + abon, note: pedas sekali

Output (3 rows):
- 3x mie goreng table T5
- 1x mie goreng +keju note: tidak pedas table T5
- 1x mie goreng +keju, +abon note: pedas sekali table T5
```

#### 4.1.3 Display Format

**Format:** `{quantity}x {product_name} {customizations} {note} table {table_number}`

**Examples:**
- `3x mie goreng table T5`
- `1x mie goreng +keju, +abon note: pedas sekali table T5`
- `2x es teh table T3`
- `1x steak ayam +keju mozarella note: tidak pedas table T7`

**Customization Display:**
- Options: `+option1, +option2` (comma-separated)
- Custom note: `note: {note_text}`
- If price adjustment exists: `+option1 (+5000), +option2`

#### 4.1.4 Marking as Finished

**Interaction:**
- Double-click item → Mark as finished
- Update database:
  ```sql
  UPDATE transaction_items
  SET 
    production_status = 'finished',
    production_finished_at = NOW()
  WHERE id = ?
  ```
- Item disappears from active list (or moves to "completed" section if showing history)

**UI States:**
- Not started: Gray background
- Preparing: Yellow/Orange background
- Finished: Green background (if showing completed section) or removed from list

#### 4.1.5 Auto-Refresh

- Poll database every 3-5 seconds for new items
- Or implement WebSocket for real-time updates (future enhancement)

---

## 5. Complete User Flows

### 5.1 Initial Order Flow

1. **Cashier adds items to cart**
   - Selects products from product grid
   - Adds customizations if needed
   - Adds custom notes if needed

2. **Clicks "Pesanan Tertunda" button**
   - Modal opens with table layout
   - Shows all available tables
   - Highlights tables with active orders

3. **Selects table**
   - If table has pending order:
     - Show confirmation: "Table T5 already has an active order. Load existing order?"
     - User chooses: Load or Cancel
   - If table is available:
     - Proceed to save

4. **Transaction saved**
   - `table_id` = selected table ID
   - `pickup_method` = 'dine-in'
   - `status` = 'pending'
   - All items saved with `production_status = NULL`

5. **Cart clears**
   - Ready for next order

6. **Items appear on kitchen/barista displays**
   - Automatically shown based on `category1` (makanan → kitchen, minuman → barista)

### 5.2 Adding Items to Existing Order

1. **Cashier clicks "Active Orders" tab**
   - Right sidebar shows list of pending transactions

2. **Clicks "Lihat" button on transaction row**
   - Cart repopulates with all items from that transaction
   - Cart shows current items, quantities, customizations

3. **Adds more items**
   - Selects new products
   - Adds to cart

4. **Clicks "Menerima Pesanan" (or "Pesanan Tertunda" if changing table)**
   - Updates same transaction
   - New items added to `transaction_items` table
   - New items appear on kitchen/barista displays

### 5.3 Processing Payment

1. **Cashier goes to "Active Orders" tab**
   - Sees list of pending transactions

2. **Clicks "Lihat" button on transaction row**
   - Cart repopulates with all items

3. **Clicks "Menerima Pesanan"**
   - Payment modal opens
   - User selects payment method
   - Processes payment

4. **Transaction marked as completed**
   - `status` = 'completed'
   - Transaction disappears from Active Orders tab

### 5.4 Kitchen/Barista Workflow

1. **Opens kitchen/barista page**
   - Sees all items that need preparation
   - Items grouped by product + customization

2. **Sees items with table numbers**
   - Example: "3x mie goreng table T5"
   - Example: "1x mie goreng +keju, +abon note: pedas sekali table T5"

3. **Double-clicks item when finished**
   - Item marked as `production_status = 'finished'`
   - `production_finished_at` = current timestamp
   - Item disappears from active list

4. **Page auto-refreshes**
   - New items appear automatically
   - Finished items removed from display

---

## 6. Implementation Checklist

### Phase 1: Database Changes
- [x] Add `table_id` column to `transactions` table
- [x] Add foreign key constraint
- [x] Test with dummy data

### Phase 2: Table Selection Modal (✅ COMPLETED)
**Scope: Only saving pending orders to tables. No loading/managing existing orders yet.**

- [x] Create `TableSelectionModal.tsx` component
  - [x] Reuse table layout display logic from `TableLayout.tsx`
  - [x] Make tables clickable
  - [x] **CRITICAL:** Show tables in **RED color** when they have pending orders
    - Uses inline styles with `backgroundColor: '#ef4444'` (red-500)
    - Overrides default table colors (blue-400) completely
  - [x] Fetch pending transactions to determine table status (filter `status='pending'` and `table_id IS NOT NULL`)
- [x] Create function to save pending transactions
  - [x] Save transaction with `status='pending'`, `table_id`, `pickup_method='dine-in'`
  - [x] Save all transaction items with customizations, notes, bundle selections
  - [x] Save transaction item customizations (for kitchen/barista display)
  - [x] Set `production_status=NULL` for all items
- [x] Check table availability (one pending transaction per table rule)
- [x] Update "Simpan Order" button (formerly "Pesanan Tertunda") in `CenterContent.tsx`
  - [x] Button is enabled (no `disabled` attribute)
  - [x] No `line-through` styling
  - [x] Has `onClick` handler to open modal
  - [x] Active button styling (blue background)
- [x] Clear cart after saving pending order

### Phase 3: Active Orders Tab (✅ COMPLETED)
- [x] Create `ActiveOrdersTab.tsx` component
- [x] Query pending transactions
- [x] Display transaction list (with Table/Room, Customer name, Total, Timer, and Lihat button)
- [x] Implement load transaction into cart (Lihat button populates cart)
- [x] Integrate into tabs area (Kasir page) - Added as "Active Orders" button on right side with green border and notification badge

### Phase 4: Transaction Loading (🚧 IN PROGRESS)
- [x] Implement cart repopulation from transaction (completed in Phase 3)
- [ ] Handle adding items to existing transaction
- [ ] Update transaction save logic to handle updates

### Phase 5: Kitchen Display
- [ ] Rebuild kitchen page from scratch
- [ ] Implement data query with grouping
- [ ] Implement customization signature algorithm
- [ ] Display grouped items
- [ ] Implement double-click to mark as finished
- [ ] Add auto-refresh functionality

### Phase 6: Barista Display
- [ ] Rebuild barista page from scratch
- [ ] Implement data query with grouping (filter by minuman)
- [ ] Implement customization signature algorithm
- [ ] Display grouped items
- [ ] Implement double-click to mark as finished
- [ ] Add auto-refresh functionality

### Phase 7: Testing
- [ ] Test table selection with available table
- [ ] Test table selection with existing pending order
- [ ] Test adding items to existing order
- [ ] Test payment processing
- [ ] Test kitchen display grouping
- [ ] Test barista display grouping
- [ ] Test marking items as finished
- [ ] Test multiple customizations grouping

---

## 7. Technical Details

### 7.1 Customization Signature Implementation

```typescript
interface TransactionItemWithCustomizations {
  id: number;
  product_id: number;
  quantity: number;
  custom_note: string | null;
  customizations: Array<{
    type_id: number;
    options: Array<{
      option_id: number;
      option_name: string;
      price_adjustment: number;
    }>;
  }>;
}

function createCustomizationSignature(item: TransactionItemWithCustomizations): string {
  // Get all option IDs, sorted
  const allOptionIds: number[] = [];
  item.customizations.forEach(customization => {
    customization.options.forEach(option => {
      allOptionIds.push(option.option_id);
    });
  });
  
  const sortedOptionIds = allOptionIds.sort((a, b) => a - b).join(',');
  const customNote = item.custom_note || '';
  
  return `${item.product_id}_${sortedOptionIds}_${customNote}`;
}

function groupTransactionItems(items: TransactionItemWithCustomizations[]): Map<string, TransactionItemWithCustomizations> {
  const grouped = new Map<string, TransactionItemWithCustomizations>();
  
  items.forEach(item => {
    const signature = createCustomizationSignature(item);
    
    if (grouped.has(signature)) {
      // Aggregate quantities
      const existing = grouped.get(signature)!;
      existing.quantity += item.quantity;
    } else {
      // New group
      grouped.set(signature, { ...item });
    }
  });
  
  return grouped;
}
```

### 7.2 Table Availability Check

```typescript
async function checkTableAvailability(
  tableId: number,
  excludeTransactionId?: string
): Promise<{ available: boolean; existingTransaction?: Transaction }> {
  let query = `
    SELECT * FROM transactions 
    WHERE table_id = ? AND status = 'pending'
  `;
  const params: (number | string)[] = [tableId];
  
  if (excludeTransactionId) {
    query += ` AND uuid_id != ?`;
    params.push(excludeTransactionId);
  }
  
  query += ` LIMIT 1`;
  
  const results = await query<Transaction[]>(query, params);
  
  if (results.length > 0) {
    return {
      available: false,
      existingTransaction: results[0]
    };
  }
  
  return { available: true };
}
```

### 7.3 Load Transaction into Cart

```typescript
async function loadTransactionIntoCart(transactionUuid: string): Promise<CartItem[]> {
  // Get transaction
  const transaction = await query<Transaction[]>(
    `SELECT * FROM transactions WHERE uuid_id = ?`,
    [transactionUuid]
  );
  
  if (transaction.length === 0) {
    throw new Error('Transaction not found');
  }
  
  // Get transaction items with customizations
  const items = await query<TransactionItem[]>(
    `SELECT 
      ti.*,
      p.*,
      GROUP_CONCAT(DISTINCT tico.option_name) as customization_options
     FROM transaction_items ti
     JOIN products p ON ti.product_id = p.id
     LEFT JOIN transaction_item_customizations tic ON ti.id = tic.transaction_item_id
     LEFT JOIN transaction_item_customization_options tico ON tic.id = tico.transaction_item_customization_id
     WHERE ti.uuid_transaction_id = ?
     GROUP BY ti.id`,
    [transactionUuid]
  );
  
  // Convert to cart items format
  const cartItems: CartItem[] = items.map(item => ({
    id: item.id,
    product: {
      id: item.product_id,
      nama: item.nama,
      // ... other product fields
    },
    quantity: item.quantity,
    customizations: parseCustomizations(item), // Parse from database format
    customNote: item.custom_note || undefined,
  }));
  
  return cartItems;
}
```

---

## 8. Edge Cases

### 8.1 Table Already Has Pending Order
**Solution:** Auto-load existing transaction into cart when user selects that table.

### 8.2 Adding Items While Some Are Finished
**Solution:** New items appear on display, finished items don't reappear (filtered by `production_status`).

### 8.3 Payment While Items Are Cooking
**Solution:** Transaction marked as `'completed'`, items still show on kitchen/barista until marked finished.

### 8.4 Multiple Customizations with Same Options but Different Order
**Solution:** Sort option IDs before creating signature (normalized).

### 8.5 Take-Away Orders
**Solution:** `table_id = NULL`, `pickup_method = 'take-away'`, show as "Take-away" in Active Orders tab.

### 8.6 Empty Cart When Loading Transaction
**Solution:** Clear cart first, then repopulate with transaction items.

---

## 9. Future Enhancements

1. **WebSocket for Real-Time Updates**
   - Kitchen/barista displays update instantly when new orders come in
   - No need for polling

2. **Order History in Kitchen/Barista**
   - Show completed items (grayed out) for reference
   - Toggle to show/hide completed items

3. **Estimated Prep Time**
   - Show estimated time remaining for each item
   - Based on product type or historical data

4. **Table Status Dashboard**
   - Overview of all tables and their order status
   - Visual indicators for tables with active orders

5. **Order Modifications**
   - Allow kitchen/barista to mark items as "needs modification"
   - Notify cashier of issues

---

## 10. Notes

- All data in database is dummy/test data, so safe to modify/delete
- MySQL doesn't support partial unique indexes, so constraint is enforced in application logic
- Customization grouping is critical for correct display
- Transaction status and production status are independent
- One table = one pending transaction (enforced in application logic)

---

## 11. SQL Migration Script

```sql
-- Add table_id to transactions table
ALTER TABLE transactions 
ADD COLUMN table_id INT NULL;

-- Add foreign key constraint
ALTER TABLE transactions
ADD CONSTRAINT fk_transactions_table 
  FOREIGN KEY (table_id) REFERENCES restaurant_tables(id) 
  ON DELETE SET NULL;

-- Create index for performance
CREATE INDEX idx_transactions_table_status 
ON transactions(table_id, status) 
WHERE table_id IS NOT NULL;

-- Note: The unique constraint for "one pending transaction per table"
-- is enforced in application logic, not database level
```

**Note:** The `WHERE` clause in the index won't work in MySQL. Use this instead:

```sql
-- Create index for performance (MySQL compatible)
CREATE INDEX idx_transactions_table_status 
ON transactions(table_id, status);
```

---

## End of Document

This plan covers all aspects of the table assignment and production monitoring system. Follow the checklist in order, and test each phase before moving to the next.

