# Understanding: Simpan Order, Active Orders, Lihat Mode, and Cart System

## 1. Simpan Order (Save Order to Table)

**Location**: `CenterContent.tsx` → `TableSelectionModal.tsx`

**How it works**:
- User clicks "Simpan Order" button in the cart area
- Opens `TableSelectionModal` which shows a visual table layout
- User selects a table from the room layout
- System saves the transaction with:
  - Status: `'pending'` (not yet paid)
  - Table ID: Selected table
  - Customer name: From input field
  - Waiter ID: Selected waiter (if any)
  - All cart items are saved as `transaction_items`
  - Customizations and bundle selections are saved
- After saving, cart is cleared (for new orders)
- Transaction appears in Active Orders page

**Key Code**: `TableSelectionModal.tsx` lines 396-696 (`savePendingTransaction` function)

---

## 2. Active Orders Page

**Location**: `ActiveOrdersTab.tsx`

**Features**:
- Shows all transactions with `status = 'pending'` (unpaid orders)
- Displays:
  - Table/Room name
  - Waiter name
  - Customer name
  - Total amount
  - Timer (elapsed time since order created)
  - Transaction ID (UUID)
- Two view modes:
  - **List View**: Table format with all pending orders
  - **Layout View**: Visual table layout (uses `TableLayout` component)
- Actions:
  - **"Lihat" (View)**: Loads transaction into cart (enters "lihat mode")
  - **"Print Bill"**: Prints a bill receipt for the unpaid order

**Key Code**: `ActiveOrdersTab.tsx` lines 38-173 (`fetchPendingTransactions`)

---

## 3. Lihat Mode (View Mode)

**Location**: `CenterContent.tsx`, `POSLayout.tsx`, `TableSelectionModal.tsx`

**What is Lihat Mode?**
- Activated when loading a pending transaction from Active Orders
- Indicated by yellow header bar showing transaction info
- Allows viewing and modifying existing orders before payment

**Key Behaviors**:

1. **Locked Items**:
   - All items loaded from transaction are `isLocked: true`
   - Locked items cannot be modified without password
   - Password: `"KONFIRMASI"` (to reduce/delete locked items)
   - Locked items have gray background and are non-editable

2. **New Items**:
   - Can add new items to cart (they start as `isLocked: false`)
   - New items are tracked separately from locked items
   - Yellow header shows transaction details (table, customer, waiter)

3. **Unsaved Changes**:
   - System tracks if there are unlocked items (new items)
   - "Bayar" button is disabled if `hasUnsavedChanges = true`
   - Must click "Simpan Order" first to save new items

4. **Saving New Items**:
   - When clicking "Simpan Order" in lihat mode:
     - Only saves unlocked items (new items)
     - Adds them to existing transaction
     - Updates transaction totals
     - Marks new items as locked after saving
     - Shows confirmation modal before saving

5. **Payment**:
   - Can only pay when all items are saved (no unsaved changes)
   - Uses existing transaction ID (doesn't create new transaction)

**Key Code**:
- `CenterContent.tsx` lines 225-237 (unsaved changes tracking)
- `CenterContent.tsx` lines 524-540 (addToCart in lihat mode)
- `TableSelectionModal.tsx` lines 698-974 (saveNewItemsToExistingTransaction)

---

## 4. Cart System

**Location**: `POSLayout.tsx`, `CenterContent.tsx`

**Cart Structure**:
- **6 Separate Carts**:
  1. `offlineCart` - For offline/dine-in orders
  2. `gofoodCart` - GoFood platform orders
  3. `grabfoodCart` - GrabFood platform orders
  4. `shopeefoodCart` - ShopeeFood platform orders
  5. `tiktokCart` - TikTok platform orders
  6. `qponCart` - Qpon platform orders

- Each cart can contain both **drinks** and **bakery** items
- Cart selection is based on:
  - `isOnlineTab` state (offline vs online)
  - `selectedOnlinePlatform` state (which platform if online)

**Cart Item Structure**:
```typescript
interface CartItem {
  id: number;                    // Unique cart item ID
  product: Product;              // Product details
  quantity: number;              // Quantity
  customizations?: [...];        // Product customizations
  customNote?: string;           // Custom note
  bundleSelections?: [...];       // Bundle product selections
  isLocked?: boolean;            // Locked if from pending transaction
  transactionItemId?: number;    // Database transaction_item ID
  transactionId?: string;        // Transaction UUID
  tableId?: number | null;       // Table ID
}
```

**Cart Operations**:

1. **Adding Items**:
   - Normal mode: Merges items if same product + same customizations
   - Lihat mode: Always creates separate entries (prevents merging with locked items)
   - Handles bundles, customizations, custom notes

2. **Removing Items**:
   - Unlocked items: Can remove directly
   - Locked items: Requires password "KONFIRMASI"
   - Locked item removal:
     - Sets `production_status = 'cancelled'` in database
     - Creates cancelled record (for reduce operation)
     - Updates transaction status if all items cancelled

3. **Editing Items**:
   - Click item to open edit modal
   - Can change quantity, customizations, notes
   - Only works for unlocked items

4. **Cart State Management**:
   - `getCurrentCart()`: Returns active cart based on tab/platform
   - `setCurrentCart()`: Updates active cart
   - `clearAllCarts()`: Clears all 6 carts

**Key Code**:
- `POSLayout.tsx` lines 100-212 (cart state and helpers)
- `CenterContent.tsx` lines 524-595 (addToCart logic)
- `CenterContent.tsx` lines 689-967 (password verification for locked items)

---

## Flow Diagram

### New Order Flow:
```
1. Add items to cart → Cart (unlocked items)
2. Click "Simpan Order" → Select table → Save as pending transaction
3. Cart cleared → Transaction appears in Active Orders
```

### Lihat Mode Flow:
```
1. Active Orders → Click "Lihat" → Load transaction into cart
2. Cart shows: Locked items (gray) + Can add new items (white)
3. Add new items → They appear as unlocked
4. Click "Simpan Order" → Saves only new items → Marks them as locked
5. Click "Bayar" → Complete payment → Transaction status = 'completed'
```

---

## Important Notes

1. **Locked Items**: Items from pending transactions are locked to prevent accidental changes. They've already been sent to kitchen/barista displays.

2. **Unsaved Changes**: System tracks if there are unlocked items in lihat mode. Payment is blocked until all items are saved.

3. **Transaction Status**:
   - `'pending'`: Unpaid order (appears in Active Orders)
   - `'completed'`: Paid order (removed from Active Orders)

4. **Password Protection**: Locked items require password "KONFIRMASI" to modify/delete, ensuring production integrity.

5. **Cart Persistence**: Each platform has its own cart, so switching between offline/online platforms maintains separate cart states.
