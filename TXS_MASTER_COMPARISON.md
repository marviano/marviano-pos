# Transaction List Comparison: marviano-pos vs salespulse txs-master

## Missing Fields in salespulse `/api/transactions/master` Query

The API endpoint is missing these fields that are available in marviano-pos TransactionList:

### Critical Missing Fields:
1. ❌ `voucher_type` - Used for filtering and display
2. ❌ `voucher_value` - Used for filtering and display
3. ❌ `voucher_label` - Used in search (line 954 in TransactionList.tsx)
4. ❌ `receipt_number` - Displayed in table (line 1503 in TransactionList.tsx)
5. ❌ `transaction_type` - Displayed in table (line 1583 in TransactionList.tsx)
6. ❌ `bank_name` - May be displayed for debit payments
7. ❌ `amount_received` - Payment details
8. ❌ `change_amount` - Payment details

## Missing Columns in txs-master UI

The txs-master page doesn't display:
1. ❌ `receipt_number` column - Shown in marviano-pos as "#" column
2. ❌ `transaction_type` column - Shown in marviano-pos as "Type" column  
3. ❌ `voucher_label` - Not shown in table (but used in search)
4. ❌ `bank_name` - Not shown in table

## Current API Query (salespulse)

```sql
SELECT 
  t.uuid_id,
  t.created_at,
  t.payment_method,
  t.pickup_method,
  t.total_amount,
  t.voucher_discount,
  t.final_amount,
  t.refund_status,
  t.refund_total,
  t.customer_unit,
  t.customer_name,
  t.note,
  t.shift_uuid,
  u.name as kasir_name,
  u.email as kasir_email
FROM transactions t
```

## Required API Query (should include)

```sql
SELECT 
  t.uuid_id,
  t.created_at,
  t.payment_method,
  t.pickup_method,
  t.total_amount,
  t.voucher_discount,
  t.voucher_type,        -- MISSING
  t.voucher_value,       -- MISSING
  t.voucher_label,       -- MISSING
  t.final_amount,
  t.amount_received,     -- MISSING
  t.change_amount,       -- MISSING
  t.refund_status,
  t.refund_total,
  t.customer_unit,
  t.customer_name,
  t.note,
  t.shift_uuid,
  t.receipt_number,      -- MISSING
  t.transaction_type,    -- MISSING
  t.bank_name,           -- MISSING
  u.name as kasir_name,
  u.email as kasir_email
FROM transactions t
```

## Impact

- **Search functionality**: Cannot search by `voucher_label` in txs-master
- **Display completeness**: Missing receipt numbers and transaction types
- **Data visibility**: Payment details (amount_received, change_amount) not shown
- **Bank information**: Debit payment bank names not displayed
