# Category Routing Fix: Dessert & Bakery Support

## Changes Made

### 1. Category Mapping Function
**File:** `src/components/PaymentModal.tsx`

**Updated `mapCategoryNameToId` function (2 locations: lines ~698 and ~1517):**
- ✅ Added `'dessert'` → `category1_id: 3`
- ✅ Added `'bakery'` → `category1_id: 5`

**Before:**
```typescript
if (name === 'makanan' || name === 'food') return 1;
if (name === 'minuman' || name === 'drinks' || name === 'drink') return 2;
return null;
```

**After:**
```typescript
if (name === 'makanan' || name === 'food') return 1;
if (name === 'minuman' || name === 'drinks' || name === 'drink') return 2;
if (name === 'dessert') return 3;
if (name === 'bakery') return 5;
return null;
```

### 2. Display Routing Logic
**File:** `src/components/PaymentModal.tsx`

**Updated destination display logic (2 locations: lines ~788 and ~1643):**
- ✅ `category1_id: 1` (Makanan) → 🍳 DAPUR (Kitchen)
- ✅ `category1_id: 2` (Minuman) → ☕ BARISTA (Barista)
- ✅ `category1_id: 3` (Dessert) → ☕ BARISTA (Barista) **NEW**
- ✅ `category1_id: 5` (Bakery) → 🍳 DAPUR (Kitchen) **NEW**

### 3. Valid Items Filter
**File:** `src/components/PaymentModal.tsx`

**Updated valid category1_id filter (2 locations: lines ~846 and ~1698):**
- ✅ Now accepts: `1, 2, 3, 5` (was only `1, 2`)
- ✅ Updated error message to include all valid categories

**Before:**
```typescript
const validItems = orderData.items.filter(item => item.category1_id === 1 || item.category1_id === 2);
```

**After:**
```typescript
const validItems = orderData.items.filter(item => 
  item.category1_id === 1 || 
  item.category1_id === 2 || 
  item.category1_id === 3 || 
  item.category1_id === 5
);
```

### 4. Invalid Category Check
**File:** `src/components/PaymentModal.tsx`

**Updated invalid category detection (2 locations: lines ~782 and ~1631):**
- ✅ Now properly excludes categories other than 1, 2, 3, 5

### 5. WebSocket Server Routing
**File:** `electron/websocketServer.ts`

**Updated routing logic (line ~190):**
- ✅ Kitchen displays: `category1_id === 1` (Makanan) OR `category1_id === 5` (Bakery)
- ✅ Barista displays: `category1_id === 2` (Minuman) OR `category1_id === 3` (Dessert)

**Before:**
```typescript
const kitchenItems = order.items.filter((item) => item.category1_id === 1);
const baristaItems = order.items.filter((item) => item.category1_id === 2);
```

**After:**
```typescript
// Kitchen: category1_id = 1 (Makanan) or 5 (Bakery)
// Barista: category1_id = 2 (Minuman) or 3 (Dessert)
const kitchenItems = order.items.filter((item) => item.category1_id === 1 || item.category1_id === 5);
const baristaItems = order.items.filter((item) => item.category1_id === 2 || item.category1_id === 3);
```

---

## Category Routing Summary

| category1_id | Category Name | Display Destination |
|--------------|---------------|---------------------|
| 1 | Makanan | 🍳 Kitchen |
| 2 | Minuman | ☕ Barista |
| 3 | Dessert | ☕ Barista |
| 5 | Bakery | 🍳 Kitchen |

---

## Impact

### ✅ Fixed Issues:
1. **Dessert products** (like "Aren Sundae") will now:
   - Map `kategori: 'Dessert'` → `category1_id: 3`
   - Route to **Barista displays** ✅
   - No longer show "invalid category" error ✅

2. **Bakery products** will now:
   - Map `kategori: 'Bakery'` → `category1_id: 5`
   - Route to **Kitchen displays** ✅
   - Be recognized as valid category ✅

### Testing:
After these changes, test with:
- Product with `kategori: 'Dessert'` → Should go to Barista display
- Product with `kategori: 'Bakery'` → Should go to Kitchen display
- Product with `category1_id: 3` directly → Should go to Barista display
- Product with `category1_id: 5` directly → Should go to Kitchen display

---

## Files Modified

1. `src/components/PaymentModal.tsx` - Category mapping and display routing (4 locations)
2. `electron/websocketServer.ts` - WebSocket routing logic (1 location)

---

## Notes

- Products in the database should have:
  - `category1_id: 3` for Dessert products
  - `category1_id: 5` for Bakery products
- Or they can use `kategori: 'Dessert'` or `kategori: 'Bakery'` and the mapping function will convert them
- The old categories (1=Makanan, 2=Minuman) continue to work as before

















