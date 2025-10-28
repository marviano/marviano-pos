# Debugging Guide - Printing System

## Quick Debugging Steps

### 1. Check if Printer is Detected

Open the browser console (F12) and run:

```javascript
window.electronAPI.listPrinters().then(result => {
  console.log('Printers:', result);
});
```

**Expected:** Array of printers with names
**If empty:** Windows printer drivers not installed

---

### 2. Check Saved Configuration

Run in browser console:

```javascript
window.electronAPI.localDbGetPrinterConfigs().then(configs => {
  console.log('Saved Configs:', configs);
});
```

**Expected:** Array with printer_type and system_printer_name
**If empty:** No printers configured yet

---

### 3. Check Electron Main Process Logs

Look at the terminal where you started the Electron app. You should see:

```
✅ SQLite database initialized successfully
✅ Found 3 printer(s): [printer names]
✅ Test print sent successfully
```

Or errors:
```
❌ Failed to list printers: [error]
❌ Test print failed: [error]
```

---

### 4. Check Database File

```bash
# Location: dist/pos-offline.db
# Open with SQLite Browser or command line:

sqlite3 dist/pos-offline.db "SELECT * FROM printer_configs;"
```

Should show your saved printer configurations.

---

## Common Issues

### Issue: "Printing receipt but nothing prints"

**Causes:**
1. Printer is offline or not powered on
2. Printer has no paper
3. Wrong printer name selected
4. Windows print queue has errors

**Solutions:**
1. Check Windows Settings → Devices → Printers
2. Open printer queue and look for errors
3. Test print from another app (Notepad → Print)
4. Verify printer name in Printer Selector matches Windows exactly

---

### Issue: "Configuration not saved"

**Causes:**
1. Database file permissions issue
2. Database file not created
3. Electron IPC not working

**Solutions:**
1. Check if `dist/pos-offline.db` exists
2. Check file permissions (should be writable)
3. Look for database errors in Electron console
4. Try saving again and watch Electron logs

---

### Issue: "Test print works but transactions don't print"

**Cause:** Transaction printing is **NOT IMPLEMENTED YET**

**Status:** This is expected behavior. The printing system only supports test prints currently. See `HOW_IT_WORKS/PRINTING_SYSTEM.md` for implementation status.

---

## Enable Verbose Logging

### In Electron Main Process (main.ts)

Add this at the beginning of `print-receipt` handler:

```typescript
ipcMain.handle('print-receipt', async (event, data) => {
  console.log('🔍 [DEBUG] Print request received:', {
    type: data.type,
    printerName: data.printerName,
    hasPrinterName: !!data.printerName
  });
  
  try {
    // ... existing code ...
  } catch (error) {
    console.error('❌ [DEBUG] Detailed error:', error);
    throw error;
  }
});
```

### In Frontend (PrinterSelector.tsx)

Add detailed logging:

```typescript
const testPrinter = async (printerType) => {
  console.log('🔍 [DEBUG] testPrinter called:', {
    printerType,
    selectedPrinter: selectedPrinters[printerType],
    allPrinters: systemPrinters.map(p => p.name)
  });
  
  const testData = {
    type: 'test',
    printerType,
    printerName: selectedPrinters[printerType],
    content: `TEST PRINT - ${printerType.toUpperCase()}...`
  };
  
  console.log('🔍 [DEBUG] Sending print request:', testData);
  
  const result = await window.electronAPI?.printReceipt?.(testData);
  
  console.log('🔍 [DEBUG] Print result:', result);
  
  // ... rest of code ...
};
```

---

## Check Windows Print Queue

### View Print Queue
1. Open Windows Settings
2. Go to Devices → Printers & scanners
3. Click on your printer
4. Click "Open queue"
5. Look for pending/error jobs

### Check Printer Status
- Status should show "Ready" (green)
- If shows "Offline" or "Error" → Troubleshoot in Windows

---

## Manual Database Inspection

### Using SQLite Browser

1. Download SQLite Browser: https://sqlitebrowser.org/
2. Open `dist/pos-offline.db`
3. Navigate to "Browse Data" tab
4. Select table: `printer_configs`
5. Verify your saved configurations

### Using Command Line

```bash
# Windows PowerShell
cd dist
sqlite3 pos-offline.db "SELECT * FROM printer_configs;"

# Should show:
# id                printer_type      system_printer_name
# receiptPrinter    receiptPrinter    Microsoft Print to PDF
```

---

## Network vs Offline Mode

### Test Offline Mode
1. Configure printers while online
2. Save configuration
3. Disconnect from internet
4. Restart app
5. Verify printer settings are still there

**Expected:** Settings should persist (they're in local SQLite, not network)

---

## Reset Printer Configuration

If you need to reset printer settings:

### Option 1: Clear from UI
1. Go to Settings → Printer Selector
2. Change selections to empty
3. Click "Save"

### Option 2: Clear Database
```bash
# WARNING: This will delete ALL local data
rm dist/pos-offline.db
# Restart app - database will be recreated
```

### Option 3: SQL Command
```bash
sqlite3 dist/pos-offline.db "DELETE FROM printer_configs;"
```

---

## Test Print Output Verification

When you click "Test Print", you should see:

### In Browser Console:
```
✅ Test print sent successfully to [printer name]!
Check your printer - it should print a test page now.
```

### In Electron Console:
```
Printing receipt: {type: 'test', ...}
✅ Test print sent successfully
```

### In Windows Print Queue:
- Print job appears
- Status changes to "Printing..." then "Printed"
- No error messages

### On Physical Printer:
- Paper feeds
- Test content prints
- Printer returns to ready state

---

## Debug Electron IPC Communication

### Check if IPC is working

In browser console:
```javascript
// Test 1: Check if electronAPI exists
console.log('electronAPI:', window.electronAPI);

// Test 2: Check if methods exist
console.log('listPrinters exists:', typeof window.electronAPI?.listPrinters);
console.log('printReceipt exists:', typeof window.electronAPI?.printReceipt);

// Test 3: Try calling
window.electronAPI.listPrinters().then(r => console.log('Result:', r));
```

**Expected Output:**
```javascript
electronAPI: {listPrinters: ƒ, printReceipt: ƒ, ...}
listPrinters exists: "function"
printReceipt exists: "function"
Result: {success: true, printers: [...]}
```

**If any is undefined:**
- Preload script not loaded
- Check Electron console for errors
- Restart the app

---

## Enable Developer Mode

Add to `electron/main.ts`:

```typescript
function createWindows(): void {
  // ... existing code ...
  
  mainWindow = new BrowserWindow({
    // ... existing options ...
    webPreferences: {
      // ... existing options ...
      devTools: true,  // Ensure this is true
    }
  });
  
  // Auto-open DevTools in development
  if (isDev) {
    mainWindow.webContents.openDevTools();
  }
}
```

---

## Check File Permissions

### Database File Permissions

```bash
# Windows
icacls dist\pos-offline.db

# Should show current user has Full Control
```

If permissions are wrong:
```bash
# Fix permissions
icacls dist\pos-offline.db /grant "${env:USERNAME}:F"
```

---

## Performance Debugging

### Check Print Queue Length

If prints are slow, check queue:
```bash
# In Electron console
console.log('Print queue length:', printWindow ? 1 : 0);
```

### Monitor Database Operations

Enable SQL logging in `electron/main.ts`:

```typescript
// Before any SQL operation
console.time('DB Operation');

localDb.prepare('SELECT * FROM printer_configs').all();

console.timeEnd('DB Operation');
```

---

## Contact & Support

### Key Files to Check
- `electron/main.ts` (lines 1951-2040) - Print handler
- `electron/main.ts` (lines 1704-1728) - Database handlers
- `src/components/PrinterSelector.tsx` - UI and logic
- `src/types/electron.d.ts` - Type definitions

### Log Locations
- Browser Console: Press F12 in app window
- Electron Console: Terminal where you started the app
- Windows Event Viewer: Look for printer driver errors

---

## Summary

**Most Common Issues:**
1. ❌ "Nothing prints" → Check Windows print queue for errors
2. ❌ "Can't select printer" → Printer not detected, check Windows settings
3. ❌ "Config not saved" → Database permissions issue
4. ❌ "Transactions don't print" → **Feature not implemented yet**

**Quick Fixes:**
1. Restart the app
2. Reselect and save printers
3. Check Windows printer settings
4. Look at console logs for specific errors

