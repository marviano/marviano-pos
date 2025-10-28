# Printing System Documentation

## 📄 Table of Contents
1. [Overview](#overview)
2. [Architecture](#architecture)
3. [How Printing Works](#how-printing-works)
4. [Database Storage](#database-storage)
5. [Component Flow](#component-flow)
6. [Debugging & Troubleshooting](#debugging--troubleshooting)
7. [Common Issues & Solutions](#common-issues--solutions)
8. [Testing Procedures](#testing-procedures)

---

## Overview

The Marviano POS printing system uses Electron's built-in printing capabilities to send print jobs to system printers. The system supports:

- **Receipt Printer**: Standard transaction receipts (prints for every transaction)
- **Label Printer**: Order labels for kitchen/bar
- **Receiptize Printer**: Specialized receipt formatting

All printer configurations are stored in a local SQLite database (`pos-offline.db`) for offline operation.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND (React)                        │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ PrinterSelector.tsx                                     │   │
│  │ - Loads saved printer configs from DB                   │   │
│  │ - Allows user to select printers                       │   │
│  │ - Saves selections to local SQLite                     │   │
│  │ - Triggers test prints                                  │   │
│  └──────────────────┬──────────────────────────────────────┘   │
│                      │ window.electronAPI                     │
└──────────────────────┼─────────────────────────────────────────┘
                       │ IPC (Inter-Process Communication)
┌──────────────────────┼─────────────────────────────────────────┐
│               PRELOAD LAYER (Bridge)                          │
│  ┌──────────────────┼─────────────────────────────────────┐   │
│  │ electron/preload.ts                                     │   │
│  │ - Exposes safe Electron APIs to renderer                │   │
│  │ - Bridges ipcRenderer.invoke() calls                   │   │
│  └──────────────────┬─────────────────────────────────────┘   │
└──────────────────────┼─────────────────────────────────────────┘
                       │ contextBridge
┌──────────────────────┼─────────────────────────────────────────┐
│           MAIN PROCESS (Electron Backend)                     │
│  ┌──────────────────┼─────────────────────────────────────┐   │
│  │ electron/main.ts                                        │   │
│  │ IPC Handlers:                                            │   │
│  │ - list-printers: Get system printers                    │   │
│  │ - print-receipt: Print receipt to selected printer     │   │
│  │ - localdb-save-printer-config: Save printer config      │   │
│  │ - localdb-get-printer-configs: Load printer configs     │   │
│  │                                                          │   │
│  │ Print Flow:                                              │   │
│  │ 1. Creates hidden BrowserWindow                          │   │
│  │ 2. Loads HTML receipt content                           │   │
│  │ 3. Calls webContents.print() with printer name         │   │
│  │ 4. Returns success/failure status                       │   │
│  └─────────────┬───────────────────────────────────────────┘   │
└───────────────┼─────────────────────────────────────────────────┘
                │
┌───────────────┴─────────────────────────────────────────────────┐
│                SQLite Database                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Table: printer_configs                                  │   │
│  │ - id: printer type (e.g., 'receiptPrinter')            │   │
│  │ - printer_type: Type identifier                        │   │
│  │ - system_printer_name: Windows printer name            │   │
│  │ - created_at: Timestamp                                │   │
│  │ - updated_at: Timestamp                                │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## How Printing Works

### Step-by-Step Process

#### 1. **Printer Selection** (Manual Setup)
```typescript
// In PrinterSelector.tsx
const saveSelections = async (selections: PrinterSelection) => {
  // Save each printer type to database
  await window.electronAPI.localDbSavePrinterConfig?.('receiptPrinter', printerName);
  await window.electronAPI.localDbSavePrinterConfig?.('labelPrinter', printerName);
  await window.electronAPI.localDbSavePrinterConfig?.('receiptizePrinter', printerName);
}
```

**Database Record:**
```sql
INSERT INTO printer_configs (id, printer_type, system_printer_name, created_at, updated_at)
VALUES ('receiptPrinter', 'receiptPrinter', 'Windows Printer Name', 1234567890, 1234567890)
```

#### 2. **Loading Saved Configuration** (On App Start)
```typescript
const loadSavedSelections = async () => {
  const configs = await window.electronAPI?.localDbGetPrinterConfigs?.();
  // Maps database records to printer selections
  configs.forEach((config) => {
    selections[config.printer_type] = config.system_printer_name;
  });
}
```

#### 3. **Triggering a Print Job**

**From PrinterSelector (Test Print):**
```typescript
const testPrinter = async (printerType: keyof PrinterSelection) => {
  const testData = {
    type: 'test',
    printerType: printerType,
    printerName: selectedPrinters[printerType],
    content: `TEST PRINT - ${printerType.toUpperCase()}...`
  };
  const result = await window.electronAPI?.printReceipt?.(testData);
}
```

**From Transaction Flow:**
```typescript
// TODO: Implement actual transaction printing
// This is currently NOT implemented yet
const printTransactionReceipt = async (transactionData) => {
  const result = await window.electronAPI?.printReceipt?.({
    type: 'receipt',
    transactionId: transactionData.id,
    items: transactionData.items,
    total: transactionData.total,
    printerName: 'saved-printer-name'
  });
}
```

#### 4. **Main Process Handles Print**

```typescript
// In electron/main.ts
ipcMain.handle('print-receipt', async (event, data) => {
  // Create hidden window
  printWindow = new BrowserWindow({
    width: 800,
    height: 600,
    show: false, // Hidden!
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    }
  });
  
  // Generate receipt HTML
  const htmlContent = generateReceiptHTML(data);
  
  // Load HTML into hidden window
  await printWindow.loadURL(`data:text/html,${encodeURIComponent(htmlContent)}`);
  
  // Print after content loads
  setTimeout(() => {
    printWindow.webContents.print({
      silent: true,           // Don't show print dialog
      printBackground: false,
      deviceName: data.printerName // Target specific printer
    }, (success, errorType) => {
      // Handle success/failure
    });
  }, 1000);
});
```

---

## Database Storage

### Table: `printer_configs`

```sql
CREATE TABLE IF NOT EXISTS printer_configs (
  id TEXT PRIMARY KEY,
  printer_type TEXT NOT NULL,
  system_printer_name TEXT NOT NULL,
  created_at INTEGER,
  updated_at INTEGER
);
```

### Example Records

```sql
-- Receipt Printer
id: 'receiptPrinter'
printer_type: 'receiptPrinter'
system_printer_name: 'Microsoft Print to PDF'
created_at: 1698765432000
updated_at: 1698765432000

-- Label Printer
id: 'labelPrinter'
printer_type: 'labelPrinter'
system_printer_name: 'Zebra Label Printer'
created_at: 1698765432000
updated_at: 1698765432000

-- Receiptize Printer
id: 'receiptizePrinter'
printer_type: 'receiptizePrinter'
system_printer_name: 'Epson Receipt Printer'
created_at: 1698765432000
updated_at: 1698765432000
```

### Database Location

```
Development: C:\Users\alvus\Desktop\code\marviano-pos\dist\pos-offline.db
Production:  <install-path>\pos-offline.db
```

---

## Component Flow

### 1. Printer Setup Flow
```
User Opens Printer Selector
        ↓
Component Loads (useEffect)
        ↓
Calls loadSavedSelections()
        ↓
Invokes: localDbGetPrinterConfigs()
        ↓
Electron IPC: localdb-get-printer-configs
        ↓
SQLite Query: SELECT * FROM printer_configs
        ↓
Returns configs to frontend
        ↓
Maps to selectedPrinters state
        ↓
User sees previously saved printers
```

### 2. Save Printer Configuration Flow
```
User Selects Printer
        ↓
Clicks "Save Printer Selections"
        ↓
Calls saveSelections()
        ↓
For each selected printer:
  Invokes: localDbSavePrinterConfig(printerType, printerName)
        ↓
Electron IPC: localdb-save-printer-config
        ↓
SQLite INSERT/UPDATE into printer_configs
        ↓
Returns success to frontend
        ↓
Shows success message
        ↓
Also saves to localStorage as backup
```

### 3. Print Test Flow
```
User Clicks "Test Print"
        ↓
Calls testPrinter(printerType)
        ↓
Creates testData object
        ↓
Invokes: printReceipt(testData)
        ↓
Electron IPC: print-receipt
        ↓
Creates hidden BrowserWindow
        ↓
Loads HTML test content
        ↓
Calls webContents.print({deviceName})
        ↓
Returns success/failure
        ↓
Shows result to user
```

---

## Debugging & Troubleshooting

### Debug Mode

Enable debugging in Electron console:

1. **Open DevTools** in main window:
   - Click View → Toggle Developer Tools
   - Or press `Ctrl+Shift+I` / `Cmd+Option+I`

2. **Check Console Logs:**
   - Look for `✅` (success) or `❌` (error) indicators
   - Track the print flow through each step

### Debugging Steps

#### Step 1: Verify Printer Detection
```typescript
// In browser console
window.electronAPI.listPrinters().then(result => {
  console.log('Detected Printers:', result);
});
```

**Expected Output:**
```javascript
{
  success: true,
  printers: [
    {
      name: "Microsoft Print to PDF",
      displayName: "Microsoft Print to PDF",
      status: "idle",
      isDefault: true
    }
  ]
}
```

**If Empty:**
- Check Windows printer settings
- Ensure printer drivers are installed
- Restart the app

#### Step 2: Check Saved Configuration
```typescript
// In browser console
window.electronAPI.localDbGetPrinterConfigs().then(configs => {
  console.log('Saved Printer Configs:', configs);
});
```

**Expected Output:**
```javascript
[
  {
    id: "receiptPrinter",
    printer_type: "receiptPrinter",
    system_printer_name: "Microsoft Print to PDF",
    created_at: 1234567890,
    updated_at: 1234567890
  }
]
```

**If Empty:**
- Navigate to Settings → Printer Selector
- Select printers and click "Save Printer Selections"

#### Step 3: Test Print Debugging

Add this to your component:
```typescript
const testPrinter = async (printerType) => {
  console.log('🔍 Starting test print...');
  console.log('Printer Type:', printerType);
  console.log('Printer Name:', selectedPrinters[printerType]);
  
  const testData = {
    type: 'test',
    printerType: printerType,
    printerName: selectedPrinters[printerType],
    content: 'TEST PRINT...'
  };
  
  console.log('Test Data:', testData);
  
  try {
    const result = await window.electronAPI?.printReceipt?.(testData);
    console.log('Print Result:', result);
    
    if (result?.success) {
      console.log('✅ Print sent successfully');
    } else {
      console.error('❌ Print failed:', result?.error);
    }
  } catch (error) {
    console.error('❌ Exception during print:', error);
  }
};
```

#### Step 4: Check Main Process Logs

In the Electron main process console (Node.js console where app starts), look for:

```
Printing receipt: {type: 'test', printerName: '...'}
✅ Test print sent successfully
```

Or errors:
```
❌ Test print failed: printer-offline
❌ Error in print-receipt handler: [error details]
```

### Common Issues & Solutions

| Issue | Symptoms | Solution |
|-------|----------|----------|
| **Printer not detected** | No printers in dropdown | 1. Check Windows printer settings<br>2. Install printer drivers<br>3. Restart app |
| **Print job sent but nothing prints** | Success message but no output | 1. Check printer is powered on<br>2. Check printer has paper<br>3. Check Windows print queue for errors<br>4. Verify printer name matches exactly |
| **Wrong printer selected** | Prints to different printer | 1. Go to Printer Selector<br>2. Reselect correct printer<br>3. Save configuration |
| **Configuration not saved** | Settings reset after restart | 1. Check database file exists<br>2. Check file permissions<br>3. Look for database errors in console |
| **Test print works but receipts don't** | Test prints fine, actual printing fails | **NOT IMPLEMENTED YET** - Transaction printing logic needs to be implemented |

---

## Testing Procedures

### Manual Testing Checklist

#### 1. Printer Detection Test
- [ ] Open Printer Selector page
- [ ] Click "Scan Printers" button
- [ ] Verify printers appear in dropdown menus
- [ ] Confirm printer names are clear and recognizable

#### 2. Configuration Save Test
- [ ] Select a printer for each type (receipt, label, receiptize)
- [ ] Click "Save Printer Selections" button
- [ ] Verify green success message appears
- [ ] Close app completely
- [ ] Reopen app
- [ ] Go back to Printer Selector
- [ ] Verify selected printers are still there

#### 3. Test Print Functionality
- [ ] Select a printer
- [ ] Click "Test Print" button
- [ ] Verify print job appears in Windows print queue
- [ ] Check that output is correct
- [ ] Verify printer name on test output

#### 4. Database Verification
```bash
# Using sqlite3 command-line tool
sqlite3 dist/pos-offline.db

# List printer configs
SELECT * FROM printer_configs;

# Should show 3 rows (if all 3 printers are configured)
```

#### 5. Offline Storage Test
- [ ] Configure printers while online
- [ ] Save configuration
- [ ] Disconnect from internet
- [ ] Restart app
- [ ] Verify printer settings are still available

---

## Current Implementation Status

### ✅ Implemented
- [x] Printer selection UI (`PrinterSelector.tsx`)
- [x] Database storage (`printer_configs` table)
- [x] Loading saved configurations
- [x] Saving printer configurations
- [x] Test print functionality
- [x] Printer detection from Windows
- [x] Offline storage persistence

### ❌ Not Implemented (TODO)
- [ ] Actual transaction receipt printing
- [ ] HTML receipt template generation
- [ ] Receipt counters (transaction numbering)
- [ ] Audit receipt printing (3 out of 10 transactions)
- [ ] Print queue for failed prints
- [ ] Reprint functionality
- [ ] Multiple printer types (receipt vs label formatting)

**Current Status:** Test printing works, but **transaction printing is NOT implemented yet.**

The `print-receipt` handler in `electron/main.ts` only handles test prints (line 1958: `if (data.type === 'test')`). Regular receipt printing returns an error:

```typescript
} else {
  // For regular receipts, implement your receipt printing logic here
  console.log('Regular receipt printing not implemented yet');
  return { success: false, error: 'Regular receipt printing not implemented yet' };
}
```

---

## File Locations

| File | Purpose |
|------|---------|
| `src/components/PrinterSelector.tsx` | UI for selecting and configuring printers |
| `electron/main.ts` (line 1951-2040) | IPC handler for print-receipt |
| `electron/main.ts` (line 1704-1728) | Database handlers for printer configs |
| `electron/preload.ts` | Exposes Electron APIs to renderer |
| `src/types/electron.d.ts` | TypeScript definitions |
| `dist/pos-offline.db` | SQLite database file |

---

## Next Steps to Complete Implementation

### 1. Implement Transaction Receipt Printing

Modify `electron/main.ts` to handle transaction printing:

```typescript
} else if (data.type === 'transaction') {
  // Generate receipt HTML
  const receiptHTML = generateReceiptHTML(data);
  
  // Load in hidden window
  await printWindow.loadURL(`data:text/html,${encodeURIComponent(receiptHTML)}`);
  
  // Print
  setTimeout(() => {
    printWindow.webContents.print({
      silent: true,
      printBackground: false,
      deviceName: data.printerName
    });
  }, 1000);
}
```

### 2. Create Receipt Template Generator

```typescript
function generateReceiptHTML(transactionData) {
  return `
    <html>
      <head>
        <style>
          /* Receipt styling */
          body { font-family: monospace; font-size: 12px; width: 300px; }
          .header { text-align: center; border-bottom: 1px dashed; padding-bottom: 10px; }
          .items { margin: 10px 0; }
          .item { display: flex; justify-content: space-between; }
          .footer { border-top: 1px dashed; margin-top: 10px; text-align: center; }
        </style>
      </head>
      <body>
        <div class="header">
          <h2>MARVIANO</h2>
          <p>Receipt #${transactionData.receiptNumber}</p>
          <p>${new Date().toLocaleString()}</p>
        </div>
        <div class="items">
          ${transactionData.items.map(item => `
            <div class="item">
              <span>${item.name} x${item.quantity}</span>
              <span>${item.total}</span>
            </div>
          `).join('')}
        </div>
        <div class="footer">
          <p><strong>Total: ${transactionData.total}</strong></p>
          <p>Thank you for your visit!</p>
        </div>
      </body>
    </html>
  `;
}
```

### 3. Integrate with Transaction Flow

Add to transaction confirmation:
```typescript
const handleTransactionConfirm = async () => {
  // Save transaction to database
  await saveTransaction(transactionData);
  
  // Print receipt
  const result = await window.electronAPI?.printReceipt?.({
    type: 'transaction',
    ...transactionData,
    printerName: savedPrinterConfig.receiptPrinter
  });
};
```

---

## Additional Resources

- **Electron Printing Docs**: https://www.electronjs.org/docs/latest/api/web-contents#webcontentsprintoptions-callback
- **SQLite Browser**: https://sqlitebrowser.org/ (to view `pos-offline.db`)
- **Windows Printer Troubleshooting**: Settings → Devices → Printers & scanners

---

## Summary

The printing system is **partially implemented**:
- ✅ Printer selection and configuration works
- ✅ Database storage works
- ✅ Test printing works
- ❌ **Actual transaction receipt printing is NOT implemented**

The main issue you're experiencing is that **transaction printing code has not been implemented yet**. The system can save printer configurations and send test prints, but it cannot print actual transaction receipts because that functionality is still a TODO item.

