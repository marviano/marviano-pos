# 🔧 Fix: "Invalid deviceName provided" Error

## 🎯 Problem Identified

**Error:** "Invalid deviceName provided"

**When it happens:** After syncing data from server, shift report printing fails

**Root Cause:** The printer name stored in the database is either:
- Empty/NULL
- Not matching any Windows printer name
- Corrupted during data sync
- Has extra spaces or special characters

---

## ✅ **Quick Fix (90% of cases)**

### Step 1: Restart the App

**Close the Electron POS app completely** and reopen it. The new debugging will help us see what's wrong.

### Step 2: Reconfigure Printer

1. Go to **Settings → Printer Selector**
2. Click **"Scan Printers"** button
3. Under **"Printer 1: Receipt Printer"**, select your printer from the dropdown
4. Click **"Test Print"** - make sure it prints successfully
5. Click **"Save Printer Selections"** (green button at bottom)

### Step 3: Try Printing Again

1. Go to **Ganti Shift**
2. Open console (F12) → Console tab
3. Click **"Print All"** → select a shift → Click **"Print"**
4. Watch the console output

---

## 🔍 **Detailed Debugging (If Quick Fix Doesn't Work)**

### Check Console Output

After trying to print, you should see detailed logs:

#### ✅ **If It Works:**

```
🖨️ [SHIFT PRINT] Starting shift breakdown print...
🔍 [SHIFT PRINT] Looking up printer config for type: receiptPrinter
📋 [SHIFT PRINT] All printer configs in database:
   - Type: receiptPrinter, Name: "EPSON TM-T82"
   - Type: labelPrinter, Name: "Label Printer"
✅ [SHIFT PRINT] Found printer config: EPSON TM-T82
🖨️ [SHIFT PRINT] Final deviceName to be used: EPSON TM-T82
🖨️ [SHIFT PRINT] Available system printers: ["EPSON TM-T82", "Microsoft Print to PDF"]
✅ [SHIFT PRINT] Printer verified in system
```

#### ❌ **If deviceName is Empty:**

```
📋 [SHIFT PRINT] All printer configs in database:
   - Type: receiptPrinter, Name: ""
❌ [SHIFT PRINT] Printer name is empty after trim
```

**Fix:** Reconfigure printer in Printer Selector (see Quick Fix above)

#### ❌ **If Printer Not Found:**

```
📋 [SHIFT PRINT] All printer configs in database:
   - Type: receiptPrinter, Name: "Old Printer Name"
🖨️ [SHIFT PRINT] Final deviceName to be used: Old Printer Name
🖨️ [SHIFT PRINT] Available system printers: ["EPSON TM-T82", "Microsoft Print to PDF"]
❌ [SHIFT PRINT] Printer not found in system!
   - Looking for: "Old Printer Name"
   - Available: "EPSON TM-T82", "Microsoft Print to PDF"
```

**Fix:** The database has an old/wrong printer name. Reconfigure in Printer Selector.

#### ❌ **If Config Missing:**

```
📋 [SHIFT PRINT] All printer configs in database:
   (empty list)
❌ [SHIFT PRINT] No printer config found or system_printer_name is null
```

**Fix:** No printer configured. Set up printer in Printer Selector.

---

## 🛠️ **Advanced Fixes**

### Fix 1: Clear and Reconfigure Printer

If reconfiguring doesn't work, the database might be corrupted:

1. Close the POS app completely
2. Delete the printer config (or we can add a reset button)
3. Reopen the app
4. Go to Printer Selector
5. Scan and configure printer again
6. Save

### Fix 2: Check Printer Name Format

Some printers have special characters in their names. Check Windows Settings:

1. Open **Windows Settings** → **Devices** → **Printers & scanners**
2. Find your printer
3. **Copy the exact name** (including spaces and special characters)
4. In POS app, make sure you select exactly that printer

### Fix 3: Check After Data Sync

If the issue only happens after syncing:

1. Note what printer name you have configured **before sync**
2. Perform data sync
3. Check printer name **after sync**
4. If it changed, the sync is overwriting the printer_configs table

**Solution:** We need to exclude `printer_configs` table from being synced.

---

## 🔍 **What the New Debugging Shows**

The rebuilt app now shows:

### 1. **All Printer Configs**
Lists every printer configuration in the database:
```
📋 All printer configs in database:
   - Type: receiptPrinter, Name: "Your Printer"
   - Type: labelPrinter, Name: "Your Label Printer"
```

### 2. **Printer Lookup Process**
Shows step-by-step how it finds the printer:
```
🔍 Looking up printer config for type: receiptPrinter
✅ Found printer config: EPSON TM-T82
```

### 3. **Final deviceName**
Shows exactly what name will be sent to Windows:
```
🖨️ Final deviceName to be used: EPSON TM-T82
   - deviceName type: string
   - deviceName length: 12
   - deviceName value: "EPSON TM-T82"
```

### 4. **System Printer Verification**
Checks if printer exists in Windows:
```
🖨️ Available system printers: ["EPSON TM-T82", "Microsoft Print to PDF"]
✅ Printer verified in system
```

### 5. **Clear Error Messages**
If something is wrong, you'll see exactly what:
```
❌ Printer "Old Printer Name" not found.

Available printers:
  - EPSON TM-T82
  - Microsoft Print to PDF

Please select one of these in Settings → Printer Selector.
```

---

## 📋 **Testing Checklist**

After restarting the app with the new build:

- [ ] Open console (F12)
- [ ] Go to Printer Selector
- [ ] Click "Scan Printers" - see printers listed?
- [ ] Select printer for "Printer 1: Receipt Printer"
- [ ] Click "Test Print" - does it print?
- [ ] Click "Save Printer Selections" - see success message?
- [ ] Go to Ganti Shift
- [ ] Try printing a shift report
- [ ] Check console - see all the debug logs?
- [ ] Does it print successfully?

---

## 🎯 **Expected Console Output (Success)**

When everything works, you should see:

```
🖨️ [SHIFT PRINT] Starting shift breakdown print...
   - Shift: John Doe
   - Products: 50
   - Orders: 45
   - Printer Type: receiptPrinter

🔍 [SHIFT PRINT] Looking up printer config for type: receiptPrinter
📋 [SHIFT PRINT] All printer configs in database:
   - Type: receiptPrinter, Name: "EPSON TM-T82"

📋 [SHIFT PRINT] Printer config query result: {"printer_type":"receiptPrinter","system_printer_name":"EPSON TM-T82",...}
✅ [SHIFT PRINT] Found printer config: EPSON TM-T82
🖨️ [SHIFT PRINT] Final deviceName to be used: EPSON TM-T82
   - deviceName type: string
   - deviceName length: 12
   - deviceName value: "EPSON TM-T82"

🖨️ [SHIFT PRINT] Available system printers: ["EPSON TM-T82", "Microsoft Print to PDF"]
✅ [SHIFT PRINT] Printer verified in system

🔍 [SHIFT PRINT] Validating data...
✅ [SHIFT PRINT] Data validation passed
🎨 [SHIFT PRINT] Generating HTML...
✅ [SHIFT PRINT] HTML generation successful
📄 [SHIFT PRINT] Generated HTML size: 45.67 KB

🪟 [SHIFT PRINT] Creating print window
📝 [SHIFT PRINT] Loading HTML into print window...
✅ [SHIFT PRINT] HTML loaded successfully

🖨️ [SHIFT PRINT] Print options: {
  "silent": true,
  "printBackground": false,
  "deviceName": "EPSON TM-T82"
}

✅ [SHIFT PRINT] Shift breakdown printed successfully
```

---

## 🚨 **If You Still Get "Invalid deviceName provided"**

Share the **complete console output** with this information:

1. **All printer configs shown in log**
   - What names are in the database?
   
2. **Available system printers**
   - What printers does Windows see?
   
3. **deviceName being used**
   - What name is the app trying to use?

4. **When did this start?**
   - Before or after syncing data?
   
5. **Does normal receipt printing work?**
   - From kasir page?

With this detailed logging, we can see exactly what's wrong and fix it! 🔧

---

## 💡 **Quick Reference: Console Logs**

| Log Message | Meaning | Action |
|------------|---------|--------|
| `Name: ""` | Empty printer name | Reconfigure printer |
| `All printer configs: (empty)` | No config in DB | Configure printer |
| `Printer not found in system` | Wrong name or printer offline | Check Windows printers |
| `deviceName: "EPSON..."` then error | Name mismatch | Rescan and select again |
| `Invalid printer name: null` | Database corruption | Clear config and reconfigure |

---

## ✅ **Success Indicators**

You know it's fixed when you see:

✅ Printer name shown in "All printer configs"
✅ "Found printer config: [Your Printer]"
✅ "Printer verified in system"
✅ "HTML loaded successfully"
✅ "Shift breakdown printed successfully"
✅ **Physical receipt prints!**

---

**The detailed logging will pinpoint exactly where the issue is!** 🎯








