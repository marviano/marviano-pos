# Split Bill Feature - Analysis & Implementation Plan

## Database Support Analysis ✅

**YES, your database fully supports split bill functionality!**

### Key Database Structure:

1. **`transaction_items` table** (lines 364-388 in `mysqlSchema.ts`):
   - `id` (INT) - Primary key
   - `uuid_id` (VARCHAR) - Unique UUID for item
   - `transaction_id` (INT) - Foreign key to `transactions.id`
   - `uuid_transaction_id` (VARCHAR) - Foreign key to `transactions.uuid_id`
   - ✅ **Both can be updated to move items between transactions**

2. **`transaction_item_customizations` table** (lines 391-407):
   - Linked via `transaction_item_id` (the `id` from transaction_items)
   - ✅ **Will automatically stay with the item when moved** (foreign key relationship)

3. **`transaction_item_customization_options` table** (lines 410-424):
   - Linked via `transaction_item_customization_id`
   - ✅ **Will automatically stay with customizations**

### What We Can Do:

✅ **Move items between transactions** by updating:
- `transaction_id` (INT) → New transaction's `id`
- `uuid_transaction_id` (VARCHAR) → New transaction's `uuid_id`

✅ **Preserve all item data**:
- Customizations (linked via `transaction_item_id`)
- Customization options (linked via `transaction_item_customization_id`)
- Bundle selections (stored in `bundle_selections_json`)
- Custom notes
- Production status

✅ **Recalculate totals** for both transactions after split

---

## Feature Requirements

### User Flow:
1. User is in "Lihat Mode" (viewing a pending transaction)
2. User selects items to split (checkboxes on locked items)
3. User chooses destination:
   - **Option A**: Move to existing transaction (select from Active Orders)
   - **Option B**: Create new transaction (select table)
4. System moves items and updates totals
5. Refresh both transactions

### Business Rules:
- ✅ Can only split from `pending` transactions
- ✅ Can split to `pending` transactions OR create new one
- ✅ Cannot split to `completed` transactions
- ✅ Must preserve production status
- ✅ Must update totals for both transactions
- ✅ Locked items require password to split (same as delete)

---

## Implementation Plan

### 1. Create SplitBillModal Component

**Location**: `src/components/SplitBillModal.tsx`

**Features**:
- Show list of items from current transaction
- Checkboxes to select items to split
- Radio buttons or tabs:
  - "Move to Existing Transaction" → Show Active Orders list
  - "Create New Transaction" → Show table selection
- Password input for locked items
- Preview of totals before/after split

**Props**:
```typescript
interface SplitBillModalProps {
  isOpen: boolean;
  onClose: () => void;
  sourceTransactionId: string;
  cartItems: CartItem[]; // All items (locked + unlocked)
  onSplitComplete: () => void; // Refresh callback
}
```

### 2. Add Split Bill Button

**Location**: `src/components/CenterContent.tsx`

**Where**: In the cart summary area, next to "Simpan Order" and "Bayar" buttons

**Condition**: Only show when `loadedTransactionInfo` exists (lihat mode)

**Code**:
```tsx
{loadedTransactionInfo && (
  <button
    onClick={() => setShowSplitBillModal(true)}
    className="flex-1 bg-purple-500 hover:bg-purple-600 text-white py-1.5 px-3 rounded-lg transition-colors text-sm"
  >
    Split Bill
  </button>
)}
```

### 3. Add Split Bill API Function

**Location**: `electron/main.ts`

**Function**: `splitBillItems`

**Logic**:
1. Validate source transaction (must be pending)
2. Validate destination transaction (if existing, must be pending)
3. For each selected item:
   - Update `transaction_id` and `uuid_transaction_id` in `transaction_items`
   - Customizations stay linked (via `transaction_item_id`)
4. Recalculate totals for both transactions:
   - Source: Subtract moved items
   - Destination: Add moved items (or create new transaction)
5. Update both transactions in database

**Function Signature**:
```typescript
async function splitBillItems(
  sourceTransactionId: string,
  destinationTransactionId: string | null, // null = create new
  itemIds: number[], // transaction_item.id values
  tableId?: number | null, // For new transaction
  customerName?: string | null,
  waiterId?: number | null
): Promise<{ success: boolean; newTransactionId?: string; error?: string }>
```

### 4. Update Electron API

**Location**: `electron/main.ts` (IPC handlers)

**Add handler**:
```typescript
ipcMain.handle('split-bill-items', async (event, params) => {
  return await splitBillItems(
    params.sourceTransactionId,
    params.destinationTransactionId,
    params.itemIds,
    params.tableId,
    params.customerName,
    params.waiterId
  );
});
```

**Location**: `electron/preload.ts`

**Add to electronAPI**:
```typescript
splitBillItems: (params: {
  sourceTransactionId: string;
  destinationTransactionId: string | null;
  itemIds: number[];
  tableId?: number | null;
  customerName?: string | null;
  waiterId?: number | null;
}) => ipcRenderer.invoke('split-bill-items', params)
```

### 5. Database Operations

**Key SQL Operations**:

1. **Move Items**:
```sql
UPDATE transaction_items 
SET 
  transaction_id = ?,
  uuid_transaction_id = ?
WHERE id IN (?)
```

2. **Recalculate Source Transaction Total**:
```sql
UPDATE transactions 
SET 
  total_amount = (
    SELECT COALESCE(SUM(total_price), 0)
    FROM transaction_items
    WHERE uuid_transaction_id = ?
  ),
  final_amount = total_amount - voucher_discount,
  updated_at = NOW()
WHERE uuid_id = ?
```

3. **Recalculate Destination Transaction Total**:
```sql
UPDATE transactions 
SET 
  total_amount = (
    SELECT COALESCE(SUM(total_price), 0)
    FROM transaction_items
    WHERE uuid_transaction_id = ?
  ),
  final_amount = total_amount - voucher_discount,
  updated_at = NOW()
WHERE uuid_id = ?
```

4. **Create New Transaction** (if destination is null):
- Use same logic as `savePendingTransaction` in `TableSelectionModal.tsx`
- Generate new transaction UUID
- Set status to 'pending'
- Link moved items to new transaction

---

## Implementation Steps

### Step 1: Create SplitBillModal Component
- [ ] Create `src/components/SplitBillModal.tsx`
- [ ] Add item selection UI (checkboxes)
- [ ] Add destination selection (existing/new)
- [ ] Add password verification for locked items
- [ ] Add preview of totals

### Step 2: Add Split Bill Button
- [ ] Add button in `CenterContent.tsx` (lihat mode only)
- [ ] Add state for modal visibility
- [ ] Pass required props to modal

### Step 3: Implement Backend Logic
- [ ] Add `splitBillItems` function in `electron/main.ts`
- [ ] Add IPC handler
- [ ] Add to preload.ts
- [ ] Test database operations

### Step 4: Handle Edge Cases
- [ ] What if all items are moved? (Update source transaction status)
- [ ] What if destination transaction becomes empty?
- [ ] Handle production status preservation
- [ ] Handle bundle selections
- [ ] Handle customizations

### Step 5: UI/UX Polish
- [ ] Add loading states
- [ ] Add success/error messages
- [ ] Refresh transactions after split
- [ ] Update Active Orders count
- [ ] Handle navigation (stay in lihat mode or switch?)

---

## Edge Cases to Handle

1. **All Items Moved**:
   - Option A: Cancel source transaction (set status to 'cancelled')
   - Option B: Keep transaction with 0 total (might cause issues)
   - **Recommendation**: Cancel source transaction if all items moved

2. **Locked Items**:
   - Require password "KONFIRMASI" (same as delete)
   - Show warning about production status

3. **Production Status**:
   - Preserve `production_status` when moving
   - If item is 'preparing' or 'finished', show warning

4. **Transaction Totals**:
   - Must recalculate both transactions
   - Handle voucher discounts correctly
   - Update `final_amount` = `total_amount` - `voucher_discount`

5. **Customizations**:
   - Automatically stay with items (via foreign key)
   - No additional action needed

6. **Bundle Selections**:
   - Stored in `bundle_selections_json`
   - Will move with item automatically

---

## Database Schema Support Summary

| Feature | Supported | Notes |
|---------|-----------|-------|
| Move items between transactions | ✅ YES | Update `transaction_id` and `uuid_transaction_id` |
| Preserve customizations | ✅ YES | Linked via `transaction_item_id` (auto-preserved) |
| Preserve bundle selections | ✅ YES | Stored in JSON field (moves with item) |
| Preserve production status | ✅ YES | Field moves with item |
| Recalculate totals | ✅ YES | Can update `total_amount` and `final_amount` |
| Create new transaction | ✅ YES | Same as "Simpan Order" flow |
| Move to existing transaction | ✅ YES | Just update foreign keys |

---

## Next Steps

1. **Review this plan** with team
2. **Create SplitBillModal component** (start with UI)
3. **Implement backend function** (`splitBillItems`)
4. **Add IPC handlers** and preload
5. **Test thoroughly** with various scenarios
6. **Add to Active Orders page** (optional: split button there too)

---

## Example Usage Flow

```
1. User clicks "Lihat" on Transaction A (Table 5, Rp 100,000)
2. Cart shows 3 items (all locked)
3. User clicks "Split Bill"
4. Modal opens:
   - Item 1: Coffee [✓] (selected)
   - Item 2: Cake [ ]
   - Item 3: Tea [✓] (selected)
5. User selects "Create New Transaction"
6. User selects Table 7
7. System:
   - Creates Transaction B (Table 7, Rp 50,000)
   - Moves Item 1 & 3 to Transaction B
   - Updates Transaction A (Table 5, Rp 50,000 - only Item 2)
   - Both transactions remain 'pending'
8. User sees updated cart (only Item 2 remains)
9. Active Orders shows both transactions
```

---

## Questions to Consider

1. **Should split be allowed for completed transactions?**
   - Recommendation: NO (only pending)

2. **What happens to production status when splitting?**
   - Recommendation: Preserve it (if 'preparing', stays 'preparing')

3. **Should we allow partial quantity splits?**
   - Example: Split 2 of 3 coffees
   - Recommendation: Start with full item splits, add partial later if needed

4. **Should split button appear in Active Orders page?**
   - Recommendation: YES (add "Split" button next to "Lihat")

5. **What if destination transaction has different table?**
   - Recommendation: Allow (items can move to different table)

---

## Conclusion

✅ **Your database fully supports split bill functionality!**

The implementation is straightforward:
- Update foreign keys in `transaction_items`
- Recalculate totals
- Preserve all item data automatically

The main work is in the UI/UX and business logic validation.
