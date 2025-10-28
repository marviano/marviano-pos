# Troubleshooting - Print Not Working

## Your Current Situation

From your terminal output, I can see:
```
[1] Printing receipt: {
[1]   type: 'test',
[1]   printerType: 'receiptPrinter',
[1]   printerName: 'NOTA - XP-80C',
...
[1] }
[1] ✅ Test print sent successfully
```

**The system says it sent the print successfully, but nothing is printing from your physical printer.**

This is a common issue! Here's what's happening and how to fix it.

---

## Root Cause Analysis

### Why "Test print sent successfully" but nothing prints?

The Electron `webContents.print()` API returns success when it **sends the print job to Windows**, but this doesn't mean the printer actually printed. Windows may queue the job or the printer may reject it.

Common reasons:
1. **Printer name mismatch** - The name stored in database doesn't match Windows exactly
2. **Printer is offline** - Windows shows printer as disconnected
3. **Print job stuck in queue** - Job is waiting but printer isn't responding
4. **Wrong printer driver** - Generic driver may not support printing
5. **Silent mode issue** - With `silent: true`, errors are suppressed

---

## Solution 1: Change to NON-SILENT Mode (RECOMMENDED)

Edit `electron/main.ts` and change:

```typescript
const printOptions = {
  silent: true,  // ❌ Change this to FALSE
  printBackground: false,
  deviceName: data.printerName || undefined
};
```

To:

```typescript
const printOptions = {
  silent: false,  // ✅ Now it will show Windows print dialog
  printBackground: false,
  deviceName: data.printerName || undefined
};
```

**Why:** This will show the Windows print dialog, so you can:
- See which printer is actually selected
- Verify the printer name matches
- See any error messages from Windows
- Manually confirm the print

---

## Solution 2: Verify Printer Name Exact Match

The printer name must match **EXACTLY** as Windows sees it.

### Step 1: Find the exact printer name in Windows

1. Open **Windows Settings**
2. Go to **Devices → Printers & scanners**
3. Find your printer "NOTA - XP-80C"
4. **Right-click** on it
5. Select **"Printer properties"**
6. Look at the **top field** - this is the EXACT name Windows uses
7. It might be slightly different than what you think!

### Step 2: Verify in your database

Run this in browser console:
```javascript
window.electronAPI.localDbGetPrinterConfigs().then(configs => {
  console.log('Saved printer name:', configs);
});
```

### Step 3: Update if needed

If the name doesn't match exactly:
1. Go to Printer Selector in your app
2. Re-select the correct printer
3. Click "Save Printer Selections"

---

## Solution 3: Check Windows Print Queue

### Method 1: GUI
1. Go to **Windows Settings → Devices → Printers & scanners**
2. Click on your printer "NOTA - XP-80C"
3. Click **"Open queue"**
4. Look for any print jobs
5. Check for error messages

### Method 2: Command Line
```powershell
# Check print queue
Get-PrintJob -PrinterName "NOTA - XP-80C"

# If you see jobs but they're failing, try:
# Remove all jobs
Get-PrintJob -PrinterName "NOTA - XP-80C" | Remove-PrintJob
```

---

## Solution 4: Test Printer from Another App

Before blaming the POS system, test if the printer works at all:

1. Open **Notepad**
2. Type some text
3. Press **Ctrl+P** to print
4. Select "NOTA - XP-80C"
5. Click Print

**If this works:** Your printer is fine, issue is with the POS print code
**If this doesn't work:** Issue is with printer setup in Windows

---

## Solution 5: Check Print Spooler Service

Windows Print Spooler must be running:

```powershell
# Check if service is running
Get-Service -Name Spooler

# If not running, start it
Start-Service -Name Spooler

# If failing, restart it
Restart-Service -Name Spooler
```

---

## Solution 6: Enhanced Debugging

Add this enhanced logging to see EXACTLY what's happening:

### In electron/main.ts, add more logging:

```typescript
ipcMain.handle('print-receipt', async (event, data) => {
  try {
    console.log('🔍 [DEBUG] Printing receipt:', data);
    console.log('🔍 [DEBUG] Printer name:', data.printerName);
    
    // Get the sender's webContents to access printing methods
    const sender = event.sender;
    
    if (data.type === 'test') {
      // Create a hidden window for printing to avoid darkening the main window
      if (printWindow) {
        printWindow.close();
      }
      
      printWindow = new BrowserWindow({
        width: 800,
        height: 600,
        show: false, // Hidden window
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
        }
      });
      
      const printOptions = {
        silent: false, // ⚠️ CHANGE TO FALSE FOR DEBUGGING
        printBackground: false,
        deviceName: data.printerName || undefined
      };
      
      console.log('🔍 [DEBUG] Print options:', printOptions);
      
      const htmlContent = `...`; // Your existing HTML
      
      console.log('🔍 [DEBUG] Loading HTML into print window...');
      await printWindow.loadURL(`data:text/html,${encodeURIComponent(htmlContent)}`);
      
      console.log('🔍 [DEBUG] Waiting 1 second for content to load...');
      
      setTimeout(() => {
        console.log('🔍 [DEBUG] Calling webContents.print()...');
        
        printWindow!.webContents.print(printOptions, (success: boolean, errorType: string) => {
          console.log('🔍 [DEBUG] Print callback fired');
          console.log('   Success:', success);
          console.log('   Error type:', errorType);
          console.log('   Full arguments:', arguments);
          
          if (success) {
            console.log('✅ Test print sent successfully');
          } else {
            console.error('❌ Test print failed:', errorType);
            
            // Try to get more details
            printWindow!.webContents.executeJavaScript(`
              console.log('Window context:', window);
              console.log('Print ready:', true);
            `).catch(err => console.error('Context error:', err));
          }
          
          setTimeout(() => {
            if (printWindow) {
              printWindow.close();
              printWindow = null;
            }
          }, 1000);
        });
      }, 1000);
      
      return { success: true };
    } else {
      console.log('Regular receipt printing not implemented yet');
      return { success: false, error: 'Regular receipt printing not implemented yet' };
    }
  } catch (error) {
    console.error('❌ Error in print-receipt handler:', error);
    return { success: false, error: String(error) };
  }
});
```

---

## Solution 7: List All Printers and Their Status

Add this API endpoint to verify printer detection:

In `electron/main.ts`:

```typescript
ipcMain.handle('list-printers', async (event) => {
  try {
    const sender = event?.sender;
    const printers = await sender.getPrintersAsync();
    
    console.log('🔍 [DEBUG] Detected printers:');
    printers.forEach((printer, index) => {
      console.log(`  ${index + 1}. Name: "${printer.name}"`);
      console.log(`     DisplayName: "${printer.displayName || printer.name}"`);
      console.log(`     Status: ${printer.status}`);
      console.log(`     Is Default: ${printer.isDefault || false}`);
      console.log('');
    });
    
    return { success: true, printers };
  } catch (error: any) {
    console.error('Failed to list printers:', error);
    return { success: false, error: error?.message || String(error), printers: [] };
  }
});
```

Then run this in browser console:
```javascript
window.electronAPI.listPrinters().then(result => {
  console.table(result.printers);
  console.log('\n💡 Check which printer name matches Windows exactly');
});
```

---

## Quick Test Script

Run this in your browser console (F12) to test everything:

```javascript
// Complete print test with all debugging
(async function testPrinting() {
  console.log('🧪 Starting complete print test...\n');
  
  // Step 1: List printers
  console.log('1️⃣ Listing available printers...');
  const printerResult = await window.electronAPI.listPrinters();
  console.log('Printers found:', printerResult.printers.length);
  console.table(printerResult.printers);
  
  // Step 2: Get saved config
  console.log('\n2️⃣ Loading saved printer configuration...');
  const configs = await window.electronAPI.localDbGetPrinterConfigs();
  console.log('Saved configs:', configs);
  
  // Step 3: Find configured printer
  const receiptConfig = configs.find(c => c.printer_type === 'receiptPrinter');
  if (!receiptConfig) {
    console.error('❌ No receipt printer configured!');
    return;
  }
  
  console.log('\n3️⃣ Configured receipt printer:', receiptConfig.system_printer_name);
  
  // Step 4: Verify it exists
  const foundPrinter = printerResult.printers.find(
    p => p.name === receiptConfig.system_printer_name || 
         p.displayName === receiptConfig.system_printer_name
  );
  
  if (!foundPrinter) {
    console.error('❌ Configured printer NOT found in system!');
    console.error('Expected:', receiptConfig.system_printer_name);
    console.error('Available:', printerResult.printers.map(p => p.name));
    return;
  }
  
  console.log('✅ Printer found in system:', foundPrinter);
  
  // Step 5: Check printer status
  if (foundPrinter.status && foundPrinter.status !== 'idle') {
    console.warn('⚠️  Printer status:', foundPrinter.status);
    console.warn('⚠️  This might cause printing issues');
  }
  
  // Step 6: Test print
  console.log('\n4️⃣ Sending test print...');
  const testData = {
    type: 'test',
    printerType: 'receiptPrinter',
    printerName: receiptConfig.system_printer_name,
    content: 'TEST PRINT - This should print!'
  };
  
  try {
    const printResult = await window.electronAPI.printReceipt(testData);
    console.log('Print result:', printResult);
    
    if (printResult.success) {
      console.log('✅ Print command returned success');
      console.log('📋 Check your Windows print queue for the job');
      console.log('📋 If nothing prints, see troubleshooting guide');
    } else {
      console.error('❌ Print command failed:', printResult.error);
    }
  } catch (error) {
    console.error('❌ Exception during print:', error);
  }
})();
```

---

## Immediate Action Plan

**Right now, try this:**

1. **Change `silent: true` to `silent: false`** in electron/main.ts
2. **Restart your app**
3. **Click "Test Print" again**
4. **Look for the Windows print dialog to pop up**
5. **If dialog appears:** Check which printer is selected and if it matches "NOTA - XP-80C"
6. **If no dialog:** Check Electron console for errors

**Most likely issue:** Printer name mismatch or printer offline

---

## Still Not Working?

If after all this it still doesn't work, provide:
1. Output from the test script above
2. Screenshot of Windows print queue
3. Screenshot of Windows Printer Properties (showing exact name)
4. Any error messages from Electron console

