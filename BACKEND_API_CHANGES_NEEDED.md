# Backend API Changes Required (salespulse.cc)

## Summary
The frontend now sends **dynamic business IDs**. The backend must accept and use these instead of hard-coding `business_id = 14`.

---

## Required Backend API Changes

### 1. **GET /api/transactions** ✅ Already Partially Done
**Current Frontend Call:**
```typescript
GET /api/transactions?business_id=${businessId}&limit=10000
```

**Backend Must:**
- ✅ Accept `business_id` query parameter
- ✅ Use it in WHERE clause: `WHERE business_id = ?`
- ❌ Remove any hard-coded `WHERE business_id = 14`

**Example:**
```sql
-- BAD (hard-coded)
SELECT * FROM transactions WHERE business_id = 14

-- GOOD (dynamic)
SELECT * FROM transactions WHERE business_id = ?
-- Use req.query.business_id
```

---

### 2. **POST /api/transactions** ✅ Already Sends businessId
**Frontend Sends:**
```json
{
  "id": "1234567890123456789",
  "business_id": 15,  // ← Dynamic from user.selectedBusinessId
  "user_id": 42,
  "payment_method": "cash",
  "items": [...],
  ...
}
```

**Backend Must:**
- ✅ Accept `business_id` from request body
- ✅ Use it when inserting: `INSERT INTO transactions (business_id, ...) VALUES (?, ...)`
- ❌ Remove hard-coded `business_id = 14` in INSERT statements

**Example:**
```javascript
// BAD
const businessId = 14; // hard-coded

// GOOD  
const businessId = req.body.business_id || 14; // from request, fallback to 14
```

---

### 3. **POST /api/transactions/archive**
**Frontend Sends:**
```json
{
  "business_id": 15,  // ← Dynamic
  "from": "2025-01-01T00:00:00Z",
  "to": "2025-12-31T23:59:59Z"
}
```

**Backend Must:**
- Accept `business_id` from body
- Use in UPDATE: `UPDATE transactions SET status='archived' WHERE business_id = ?`

---

### 4. **POST /api/transactions/delete**
**Frontend Sends:**
```json
{
  "business_id": 15,  // ← Dynamic
  "from": "2025-01-01T00:00:00Z",
  "to": "2025-12-31T23:59:59Z"
}
```

**Backend Must:**
- Accept `business_id` from body
- Use in DELETE: `DELETE FROM transactions WHERE business_id = ?`

---

### 5. **POST /api/shifts/sync**
**Frontend Sends:**
```json
{
  "shifts": [
    {
      "business_id": 15,  // ← Each shift has dynamic businessId
      "user_id": 42,
      ...
    }
  ]
}
```

**Backend Must:**
- Accept `business_id` from each shift object
- Use it when inserting/updating shifts

---

### 6. **GET /api/sync** (Optional - if backend has this)
**Current:**
- Likely returns all data for business_id = 14

**Should Change To:**
```typescript
GET /api/sync?business_id=15
```

**Backend Must:**
- Accept `business_id` query parameter
- Filter all synced data by that business ID

---

## Quick Checklist for Backend Developer

### Step 1: Find All Hard-Coded business_id = 14
```bash
# In your backend code (salespulse.cc):
grep -r "business_id = 14" .
grep -r "business_id=14" .
grep -r "businessId = 14" .
grep -r "BUSINESS_ID = 14" .
```

### Step 2: Update Each Occurrence

#### Pattern 1: SQL Queries
```sql
-- BEFORE
WHERE business_id = 14

-- AFTER (with parameter)
WHERE business_id = ?
-- Then pass: [req.query.business_id || req.body.business_id || 14]
```

#### Pattern 2: Constants
```javascript
// BEFORE
const BUSINESS_ID = 14;

// AFTER
const businessId = req.body.business_id || req.query.business_id || 14;
```

#### Pattern 3: API Routes
```javascript
// Example Express.js route

// GET /api/transactions
app.get('/api/transactions', async (req, res) => {
  const businessId = parseInt(req.query.business_id) || 14;
  const transactions = await db.query(
    'SELECT * FROM transactions WHERE business_id = ? LIMIT ?',
    [businessId, req.query.limit || 1000]
  );
  res.json(transactions);
});

// POST /api/transactions
app.post('/api/transactions', async (req, res) => {
  const businessId = req.body.business_id || 14;
  // Use businessId from request body when inserting
  await db.query(
    'INSERT INTO transactions (id, business_id, ...) VALUES (?, ?, ...)',
    [req.body.id, businessId, ...]
  );
  res.json({ success: true });
});

// POST /api/transactions/archive
app.post('/api/transactions/archive', async (req, res) => {
  const { business_id, from, to } = req.body;
  const businessId = business_id || 14;
  
  await db.query(
    'UPDATE transactions SET status = "archived" WHERE business_id = ? AND created_at BETWEEN ? AND ?',
    [businessId, from, to]
  );
  res.json({ success: true });
});
```

---

## Testing the Backend

### Test 1: GET with business_id parameter
```bash
curl "https://salespulse.cc/api/transactions?business_id=15&limit=10"
# Should return transactions for business 15, not 14
```

### Test 2: POST transaction with different business_id
```bash
curl -X POST https://salespulse.cc/api/transactions \
  -H "Content-Type: application/json" \
  -d '{
    "id": "1234567890123456789",
    "business_id": 16,
    "user_id": 1,
    "payment_method": "cash",
    "items": []
  }'

# Then verify:
curl "https://salespulse.cc/api/transactions?business_id=16"
# Should show the transaction
```

### Test 3: Verify business isolation
```bash
# Create transaction for business 15
curl -X POST .../api/transactions -d '{"business_id": 15, ...}'

# Query business 14 
curl ".../api/transactions?business_id=14"
# Should NOT show business 15 transactions

# Query business 15
curl ".../api/transactions?business_id=15"  
# Should ONLY show business 15 transactions
```

---

## Affected Backend Tables

Make sure these tables filter by `business_id`:

1. **transactions** - Main transaction table
2. **transaction_items** - Join with transactions.business_id
3. **shifts** - Has business_id column
4. **products** - Via product_businesses junction table
5. **ingredients** - Has business_id column
6. **category2** - Has business_id column
7. **printer1_audit_log** - Join with transactions.business_id
8. **printer2_audit_log** - Join with transactions.business_id

---

## SQL Migration Examples

### Example 1: Update Transaction Query
```sql
-- BEFORE
SELECT * FROM transactions 
WHERE business_id = 14 
  AND created_at > '2025-01-01'
ORDER BY created_at DESC;

-- AFTER (use parameter)
SELECT * FROM transactions 
WHERE business_id = ? 
  AND created_at > ?
ORDER BY created_at DESC;
```

### Example 2: Update Join Query
```sql
-- BEFORE
SELECT t.*, ti.* 
FROM transactions t
INNER JOIN transaction_items ti ON t.uuid_id = ti.uuid_transaction_id
WHERE t.business_id = 14;

-- AFTER
SELECT t.*, ti.* 
FROM transactions t
INNER JOIN transaction_items ti ON t.uuid_id = ti.uuid_transaction_id
WHERE t.business_id = ?;
```

---

## Rollback Plan

If issues occur:
1. All backend endpoints should **default to 14** if `business_id` not provided
2. This ensures backward compatibility with old frontend versions
3. Pattern: `const businessId = req.body.business_id || req.query.business_id || 14;`

---

## Files to Check on Backend

Look for hard-coded business_id in:
- `/routes/transactions.js` (or .ts)
- `/routes/sync.js`
- `/routes/shifts.js`
- `/controllers/transactionController.js`
- `/services/transactionService.js`
- `/models/Transaction.js`
- Any SQL query files
- Configuration files

---

## Priority Order

1. **CRITICAL**: `/api/transactions` POST & GET
2. **HIGH**: `/api/shifts/sync`
3. **MEDIUM**: `/api/transactions/archive`, `/api/transactions/delete`
4. **LOW**: `/api/sync` (if it exists)

---

## Contact Frontend Developer

✅ Frontend is READY and sending dynamic business IDs
✅ All frontend calls include proper business_id
✅ Fallback to 14 for backward compatibility

Backend team needs to:
1. Accept the dynamic business_id parameters
2. Remove hard-coded business_id = 14
3. Test with multiple business IDs

---

**Created:** 2025-11-27  
**Frontend Status:** ✅ Complete  
**Backend Status:** ⏳ Pending Updates








