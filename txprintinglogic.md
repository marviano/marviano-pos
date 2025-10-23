# Multi-Printer System Requirements

## Overview

This document outlines the printing requirements for the POS system across three different printers that are triggered when a payment is confirmed.

---

## Trigger Event

- **Action**: User clicks "Confirm" button on the payment modal
- **Result**: Initiate printing to all applicable printers simultaneously

---

## Printer Specifications

### Printer 1: Receipt Printer 1 (Standard Receipt)

**Purpose**: Print receipt for every transaction

**Print Frequency**: Every single transaction

**Content Structure**:
- Today's transaction number
- Date and time of transaction
- Current cashier name
- Itemized list of purchased products
- Subtotal for each item
- Grand total amount
- Store social media links

**Counter Behavior**:
- Resets to 0 when app is exited/reopened
- Increments sequentially (1, 2, 3, 4...)

---

### Printer 2: Receipt Printer 2 (Random Audit Receipt)

**Purpose**: Print random sample receipts for audit/verification purposes

**Print Modes**: Automated Mode (default) and Manual Mode

---

#### Mode 1: Automated Mode (Default)

**Print Frequency**: 3 receipts per every 10 transactions

**Selection Logic**:

When a new 10-transaction cycle begins:
1. System randomly selects 3 transaction numbers from the upcoming batch (1-10, 11-20, 21-30, etc.)
2. These selections are stored in memory
3. As transactions are processed, when a transaction number matches one of the 3 selected numbers, it triggers a print to Printer 2
4. Prints occur in real-time during the transaction flow, NOT at the end of the 10-transaction cycle

---

#### Mode 2: Manual Mode

**Purpose**: Allow users to manually select and print any transaction to Printer 2

**User Interface Requirements**:
- Display a list/table of all today's transactions
- Show transaction details: transaction number, time, cashier, total amount
- Multi-select functionality (checkboxes or similar)
- "Print to Printer 2" button to trigger printing

**Selection Logic**:
1. User accesses the manual print interface (admin/manager access recommended)
2. User views list of all transactions from today
3. User selects one or multiple transactions (no limit on selection count)
4. User clicks "Print to Printer 2" button
5. Selected transactions print to Printer 2 in the order they were selected

**Example Use Case**:
```
Today's transactions: 1, 2, 3, ..., 98, 99, 100
User selects: Transaction #26, #87, #93
Printer 2 output:
  - Transaction #26 → Prints as "Receipt #1"
  - Transaction #87 → Prints as "Receipt #2"
  - Transaction #93 → Prints as "Receipt #3"
```

**Important Notes**:
- Manual prints do NOT interfere with automated mode counter
- If automated mode already printed transaction #26 as "Receipt #5", and user manually reprints it, it gets a NEW Printer 2 number (e.g., "Receipt #12")
- Each print (automated or manual) increments the Printer 2 counter

---

#### Shared Numbering System

**Counter Behavior**:
- Printer 2 maintains ONE global sequential counter across both modes
- Counter increments for EVERY print to Printer 2 (automated or manual)
- Counter resets to 0 when app is exited/reopened
- The printed receipt always shows the Printer 2 counter, not the actual transaction number

**Example of Mixed Mode**:
```
Automated prints: Transaction #2 → Receipt #1
Automated prints: Transaction #8 → Receipt #2
Manual print:     Transaction #26 → Receipt #3
Automated prints: Transaction #10 → Receipt #4
Manual print:     Transaction #87 → Receipt #5
```

**Visual Example**:

```
10-Transaction Cycle (Transactions 1-10):
─────────────────────────────────────────────────────────────
Transaction #:       1   2   3   4   5   6   7   8   9   10
Printer 1 prints:    ✓   ✓   ✓   ✓   ✓   ✓   ✓   ✓   ✓   ✓
Printer 2 prints:    -   ✓   -   -   -   -   -   ✓   -   ✓
Printer 2 shows:         #1                      #2      #3
─────────────────────────────────────────────────────────────

In this example:
• Transaction #2 triggers Printer 2 → Receipt shows "Receipt #1"
• Transaction #8 triggers Printer 2 → Receipt shows "Receipt #2"
• Transaction #10 triggers Printer 2 → Receipt shows "Receipt #3"
```

**Content Structure**:

Same as Printer 1:
- Today's transaction number (actual transaction #, not Printer 2 counter)
- Date and time of transaction
- Current cashier name
- Itemized list of purchased products
- Subtotal for each item
- Grand total amount
- Store social media links

**Counter Behavior**:
- Resets to 0 when app is exited/reopened
- Increments only when Printer 2 prints (e.g., 1, 2, 3, 4...)

---

### Printer 3: Order Label Printer

**Purpose**: To be defined

**Print Frequency**: To be defined

**Content Structure**: To be defined

---

## Implementation Guide

### Receipt Printer 2 Algorithm

```pseudocode
FUNCTION onNewTenTransactionCycle():
    selected_transactions = randomlySelect(3, from [1-10])
    STORE selected_transactions in memory
    
FUNCTION onTransactionConfirm(transaction_number):
    // Always print to Printer 1
    printToPrinter1(transaction_data)
    
    // Check if this transaction should print to Printer 2
    IF transaction_number is in selected_transactions:
        printer2_counter = printer2_counter + 1
        printToPrinter2(transaction_data, printer2_counter)
    
    // Check if cycle is complete
    IF transaction_number % 10 == 0:
        onNewTenTransactionCycle()
```

### State Management

**On App Start/Restart**:
- All counters reset to 0
- Transaction cycle starts fresh from 1
- New random selection is generated for first 10 transactions
- Previous selections are NOT persisted

**During Operation**:
- Printer 1 counter increments every transaction
- Printer 2 counter increments only when printing
- Selected transaction numbers are held in memory for current cycle

---

## Database Schema Requirements

### Table: printer2_audit_log

Tracks which transactions were selected and printed to Printer 2

**Columns**:
- `id` (Primary key)
- `transaction_id` (Actual transaction number)
- `printer2_receipt_number` (The receipt number shown on Printer 2)
- `print_mode` (enum: 'automated', 'manual')
- `selected_by_user_id` (NULL for automated, user ID for manual mode)
- `cycle_number` (Which 10-transaction cycle: 1-10, 11-20, etc. - NULL for manual prints)
- `selected_at` (Timestamp when selected for printing)
- `printed_at` (Timestamp when actually printed)
- `status` (enum: 'pending', 'printed', 'failed')

**Purpose**: Audit trail for Printer 2 selections and verification across both automated and manual modes

---

### Table: print_queue

Handles failed prints and retry logic

**Columns**:
- `id` (Primary key)
- `transaction_id` (Reference to transaction)
- `printer_name` (Which printer: 'printer1', 'printer2', 'order_label')
- `print_data` (JSON blob of receipt content)
- `status` (enum: 'queued', 'printing', 'completed', 'failed')
- `attempts` (Number of retry attempts)
- `created_at` (When added to queue)
- `last_attempt_at` (Last retry timestamp)
- `completed_at` (When successfully printed)

**Purpose**: Queue system for offline/failed printer scenarios

---

### Table: transaction_reprints

Logs reprinted transactions

**Columns**:
- `id` (Primary key)
- `original_transaction_id` (Reference to failed transaction)
- `reason` (Why reprint is needed)
- `reprinted_at` (Timestamp of reprint)
- `reprinted_by` (Cashier who triggered reprint)

**Purpose**: Track all transaction reprints for audit purposes

---

## Print Failure Handling

### Failed Transaction Reprint

If a transaction fails after printing has occurred:
1. Transaction is marked for reprint
2. Store reprint record in `transaction_reprints` table
3. Manual or automatic trigger to reprint to Printer 1
4. Failed transactions do NOT affect Printer 2 (they don't count toward the 3/10 quota)

---

### Printer Offline/Failure Handling

**Standard Industry Practice**: Most POS systems use a queue with retry mechanism

**Process Flow**:
1. **Immediate failure detection** - System detects printer is offline/unresponsive
2. **Add to queue** - Print job moves to `print_queue` table with status 'queued'
3. **Background retry** - System attempts to print every 30-60 seconds
4. **Max attempts** - After 5-10 failed attempts, mark as 'failed' and alert staff
5. **Manual intervention** - Staff can manually retry or clear failed jobs
6. **Priority order** - Queue processes in FIFO (First In, First Out) order

**Recommendation**:
- Implement queue system for all printers
- Show queue status in admin dashboard
- Alert cashier if print fails (visual/audio notification)
- Allow manual "Reprint" button for failed jobs

**Configuration Settings**:
```
PRINTER_RETRY_INTERVAL = 30 seconds
PRINTER_MAX_RETRIES = 10 attempts
PRINTER_TIMEOUT = 5 seconds per print job
```

---

## Edge Cases & Scenarios

| Scenario | Behavior |
|----------|----------|
| App restart mid-cycle (e.g., at transaction #7) | Reset all counters to 0, start new cycle from transaction #1 with new random selections |
| Less than 10 transactions before app closes | Incomplete cycle is lost, starts fresh on reopen |
| Transaction fails after confirm | Reprint via `transaction_reprints` table, does not affect Printer 2 quota |
| Network/printer offline | Queue print job in `print_queue` table with retry mechanism |

---

## Questions for Clarification

1. **Order Label Printer**: Details to be defined later

---