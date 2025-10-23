# Momoyo Bakery POS - Dual Tab Implementation

## Project Overview
Implement dual tabs for Momoyo Bakery POS system:
- **Drinks Tab**: Current main POS (kategori: "minuman") 
- **Bakery Tab**: New bakery POS (kategori: "bakery")

## Current Database Understanding
- **Database**: salespulse (localhost, root, adad)
- **Business ID**: 14 (Momoyo Bakery Kalimantan)
- **Current Product Categories**: 
  - "minuman" (drinks)
  - "bakery" (bakery - needs to be added)
- **Tables**: products, transactions, transaction_items, etc.

## Requirements Analysis

### i wan✅ What I Understand:
1. **Same Business**: Both tabs use same business_id (14)
2. **Product Separation**: Filter by kategori field
   - Drinks tab: kategori = "minuman" 
   - Bakery tab: kategori = "bakery" (needs to be added)
3. **Receipt Numbering**: 
   - Shared daily counter (interleaved: #1 drinks, #2 bakery, #3 drinks...)
   - No separate numbering per business
4. **Receipt Printing**: Different receipt formats for drinks vs bakery
5. **Same Cashier**: One cashier handles both tabs

### ❓ Questions to Clarify:
1. **Receipt Numbering**: Currently no receipt numbering implemented - need to add
2. **Bakery Products**: Need to add "bakery" kategori products to database
3. **Receipt Format**: Need to design different receipt layouts
4. **Transaction Tracking**: How to distinguish drinks vs bakery transactions?

## Implementation Plan

### Phase 1: Database Setup
- [ ] Add "bakery" kategori products to database
- [ ] Add receipt_number field to transactions table
- [ ] Add transaction_type field to transactions table ("drinks" or "bakery")
- [ ] Implement daily receipt numbering logic

### Phase 2: UI Implementation  
- [ ] Add tabs to Kasir section ("Drinks" and "Bakery")
- [ ] Create bakery product filtering
- [ ] Implement tab switching logic

### Phase 3: Receipt System
- [ ] Design different receipt formats
- [ ] Implement receipt printing
- [ ] Add receipt numbering to transactions

### Phase 4: Testing
- [ ] Test dual tab functionality
- [ ] Test receipt numbering
- [ ] Test receipt printing

## Final Understanding Summary

### ✅ Corrected Requirements:
1. **Tab Names**: "Drinks" and "Bakery" (not "Minuman" and "Bakery")
2. **Transaction Types**: 
   - If accessed from **Drinks tab** → `transaction_type = "drinks"`
   - If accessed from **Bakery tab** → `transaction_type = "bakery"`
3. **Product Categories**: Only "minuman" and "bakery" (no "dessert")
4. **Receipt Numbering**: Daily reset, interleaved sequence (#1 drinks, #2 bakery, #3 drinks...)
5. **Database Fields**: Add `receipt_number` and `transaction_type` to transactions table

## Current Status
- [x] Database structure analyzed
- [x] Requirements understood and corrected
- [ ] Ready for implementation
