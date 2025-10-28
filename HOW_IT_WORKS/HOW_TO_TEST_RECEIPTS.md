# How to Test Receipt Printing

## Quick Test (Test Print)

1. **Restart your dev server:**
   ```bash
   npm run electron dev
   ```

2. **Go to Settings → Printer Selector page**

3. **Click "Test Print" button**

4. **Expected Output:**
   - Should print a test receipt with your printer information
   - Check if it matches the photo layout

---

## Full Transaction Test (Production Receipt)

To test the complete receipt with actual transaction data:

### Option 1: Add Print Button to Transaction Confirmation

You can modify `src/components/TransactionConfirmationDialog.tsx` to add a print button after transaction is completed.

### Option 2: Test from Browser Console

After completing a transaction, run this in browser console (F12):

```javascript
// Test receipt with sample data
const testReceiptData = {
  type: 'receipt',
  printerName: 'YOUR_PRINTER_NAME',
  receiptNumber: '12345',
  date: new Date(),
  cashier: 'Test User',
  items: [
    { name: 'Coffee Latte', quantity: 2, price: 25000, total: 50000 },
    { name: 'Croissant', quantity: 1, price: 25000, total: 25000 }
  ],
  subtotal: 75000,
  total: 75000,
  paymentMethod: 'Cash',
  amountReceived: 100000,
  change: 25000,
  tableNumber: '01'
};

window.electronAPI.printReceipt(testReceiptData);
```

---

## Test Print Layout

The test print should show:

```
silahkan hubungi: 0813-9888-8568

     MARVIANO
  MARVIANO MADIUN 1
Jl. Kalimantan no. 21, Kartoharjo
Kec. Kartoharjo, Kota Madiun

     DINE IN 01
──────────────────
Nomor Pesanan:  12345
Waktu Pesanan:  28/10/2025, 11:15:30
Waktu Print:    28/10/2025, 11:15:35
Operator Kasir: Test User
Saluran:        Toko Offline
──────────────────
[Nama Produk]  [Harga]  [Jumlah]  [Subtotal]
──────────────────
Total Pesanan:     2
Total Harga:   75,000
Nominal Pendapatan: 75,000
──────────────────
Metode Pembayaran:  Cash
Bayar Jumlah:      100,000
Kembali Uang Kecil: 25,000
Pembayaran Sebenarnya: 75,000
──────────────────
Pendapat Anda sangat penting
bagi kami.
Untuk kritik dan saran silahkan
hubungi : 0812-1822-2666

Untuk layanan kemitraan dan
partnership
```

---

## What to Check

✅ **Contact number** appears at top  
✅ **Store name and address** centered  
✅ **Transaction type** (DINE IN XX)  
✅ **Order info** (number, time, cashier, channel)  
✅ **Items table** with proper columns  
✅ **Summary section** (total items, total price)  
✅ **Payment details** (method, paid, change)  
✅ **Footer** with contact info  
✅ **No text cut off**  
✅ **Proper margins** on left and right  

---

## Troubleshooting

**If receipt doesn't print:**
- Check printer is selected in Printer Selector
- Verify printer is "Ready" in Windows
- Look for errors in Electron console

**If text is cut off:**
- Current width is 45ch - you can adjust this in `electron/main.ts`
- Lines 2015-2016 and 2115-2116 control the width

**If margins look wrong:**
- Current padding is 5mm top/bottom, 7mm left/right
- Adjust in lines 2019 and 2119 in `electron/main.ts`

---

## Next Steps

After testing works:

1. **Integrate with transaction flow:**
   - Add print button after payment confirmation
   - Pass transaction data to print handler

2. **Customize store info:**
   - Update contact number
   - Update store name and address
   - Update footer messages

3. **Add receipt counter:**
   - Implement receipt numbering system
   - Track daily receipt counts
   - Auto-increment receipt numbers

