'use client';

import { useState, useEffect } from 'react';
import { Printer, Save, TestTube, CheckCircle, XCircle, AlertCircle } from 'lucide-react';

interface SystemPrinter {
  name: string;
  displayName: string;
  status: 'idle' | 'printing' | 'stopped' | 'offline';
  isDefault: boolean;
}

interface PrinterSelection {
  receiptPrinter: string;
  labelPrinter: string;
  receiptizePrinter: string;
}

export default function PrinterSelector() {
  const [systemPrinters, setSystemPrinters] = useState<SystemPrinter[]>([]);
  const [selectedPrinters, setSelectedPrinters] = useState<PrinterSelection>({
    receiptPrinter: '',
    labelPrinter: '',
    receiptizePrinter: ''
  });
  const [isScanning, setIsScanning] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');

  // Add state for Printer 2 mode
  const [printer2Mode, setPrinter2Mode] = useState<'auto' | 'manual'>('auto');
  const [isSavingMode, setIsSavingMode] = useState(false);
  const [modeSaveStatus, setModeSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');

  // Load saved printer selections and auto-scan printers on component mount
  useEffect(() => {
    loadSavedSelections();
    loadPrinter2Mode();
    // Auto-scan printers when component mounts
    scanForPrinters();
  }, []);

  const loadPrinter2Mode = async () => {
    try {
      if (window.electronAPI?.getPrinter2Mode) {
        const result = await window.electronAPI.getPrinter2Mode();
        if (result?.success && result?.mode) {
          setPrinter2Mode(result.mode);
          console.log('✅ Loaded Printer 2 mode:', result.mode);
        }
      }
    } catch (error) {
      console.error('Error loading Printer 2 mode:', error);
    }
  };

  const handleModeChange = async (newMode: 'auto' | 'manual') => {
    setPrinter2Mode(newMode);
    
    // Auto-save
    if (window.electronAPI?.setPrinter2Mode) {
      setIsSavingMode(true);
      setModeSaveStatus('idle');
      
      try {
        const result = await window.electronAPI.setPrinter2Mode(newMode);
        if (result?.success) {
          setModeSaveStatus('success');
          console.log('✅ Saved Printer 2 mode:', newMode);
        } else {
          setModeSaveStatus('error');
        }
      } catch (error) {
        console.error('Error saving Printer 2 mode:', error);
        setModeSaveStatus('error');
      } finally {
        setIsSavingMode(false);
        setTimeout(() => setModeSaveStatus('idle'), 3000);
      }
    }
  };

  const loadSavedSelections = async () => {
    try {
      // First try to load from database
      const configs = await window.electronAPI?.localDbGetPrinterConfigs?.();
      if (configs && configs.length > 0) {
        const selections: PrinterSelection = {
          receiptPrinter: '',
          labelPrinter: '',
          receiptizePrinter: ''
        };
        
        configs.forEach((config: any) => {
          switch (config.printer_type) {
            case 'receiptPrinter':
              selections.receiptPrinter = config.system_printer_name;
              break;
            case 'labelPrinter':
              selections.labelPrinter = config.system_printer_name;
              break;
            case 'receiptizePrinter':
              selections.receiptizePrinter = config.system_printer_name;
              break;
          }
        });
        
        setSelectedPrinters(selections);
        return;
      }
      
      // Fallback to localStorage
      const saved = localStorage.getItem('printer-selections');
      if (saved) {
        const selections = JSON.parse(saved);
        setSelectedPrinters(selections);
      }
    } catch (error) {
      console.error('Error loading saved printer selections:', error);
    }
  };

  const saveSelections = async (selections: PrinterSelection) => {
    setIsSaving(true);
    setSaveStatus('idle');
    
    try {
      // Save to database
      const savePromises = [];
      
      if (selections.receiptPrinter) {
        savePromises.push(
          window.electronAPI?.localDbSavePrinterConfig?.('receiptPrinter', selections.receiptPrinter)
        );
      }
      
      if (selections.labelPrinter) {
        savePromises.push(
          window.electronAPI?.localDbSavePrinterConfig?.('labelPrinter', selections.labelPrinter)
        );
      }
      
      if (selections.receiptizePrinter) {
        savePromises.push(
          window.electronAPI?.localDbSavePrinterConfig?.('receiptizePrinter', selections.receiptizePrinter)
        );
      }
      
      const results = await Promise.all(savePromises);
      const hasError = results.some(result => !result?.success);
      
      if (hasError) {
        setSaveStatus('error');
        alert('Some printer configurations could not be saved. Please try again.');
      } else {
        setSaveStatus('success');
        // Also save to localStorage as backup
        localStorage.setItem('printer-selections', JSON.stringify(selections));
      }
      
      // Reset success status after 3 seconds
      setTimeout(() => setSaveStatus('idle'), 3000);
      
    } catch (error) {
      console.error('Error saving printer selections:', error);
      setSaveStatus('error');
      alert('Error saving printer configurations. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  // Scan for system printers
  const scanForPrinters = async () => {
    setIsScanning(true);
    try {
      // Check if we're running in Electron
      if (!window.electronAPI?.listPrinters) {
        alert('This feature requires the Electron app. Please run the app from the desktop shortcut, not in the browser.');
        return;
      }

      const result = await window.electronAPI.listPrinters();
      if (result && result.success) {
        const mapped: SystemPrinter[] = (result.printers || []).map((p: any) => ({
          name: p.name,
          displayName: p.displayName || p.name,
          status: (p.status as any) || 'idle',
          isDefault: !!p.isDefault,
        }));
        setSystemPrinters(mapped);
        
        if (mapped.length === 0) {
          alert(`No printers detected by Windows. 

Troubleshooting steps:
1. Go to Windows Settings → Devices → Printers & scanners
2. Make sure your printer is listed and shows "Ready"
3. If not listed, click "Add a printer or scanner"
4. Install printer drivers if needed
5. Restart this app and try again`);
        } else {
          console.log(`✅ Found ${mapped.length} printer(s):`, mapped.map(p => p.displayName));
        }
      } else {
        console.error('Failed to list printers:', result?.error);
        alert(`Unable to list printers. Error: ${result?.error || 'Unknown error'}

Please try:
1. Restart the app completely
2. Check if your printer is connected and powered on
3. Go to Windows Settings → Devices → Printers & scanners to verify`);
      }
    } catch (error) {
      console.error('Error scanning for printers:', error);
      alert(`Error scanning for printers: ${error}

Please try:
1. Restart the app completely
2. Make sure you're running the desktop app, not in a browser
3. Check Windows printer settings`);
    } finally {
      setIsScanning(false);
    }
  };

  const handlePrinterSelection = (printerType: keyof PrinterSelection, printerName: string) => {
    setSelectedPrinters(prev => ({
      ...prev,
      [printerType]: printerName
    }));
  };

  const handleSave = () => {
    saveSelections(selectedPrinters);
  };

  const testPrinter = async (printerType: keyof PrinterSelection) => {
    const printerName = selectedPrinters[printerType];
    if (!printerName) {
      alert('Please select a printer first.');
      return;
    }

    setIsTesting(printerType);
    
    try {
      // Use the existing print-receipt IPC handler for testing
      const testData = {
        type: 'test',
        printerType: printerType,
        printerName: printerName,
        content: `TEST PRINT - ${printerType.toUpperCase()}\n\nThis is a test print to verify your printer is working correctly.\n\nPrinter: ${printerName}\nTime: ${new Date().toLocaleString()}\n\nIf you can see this, your printer is configured correctly!`
      };
      
      const result = await window.electronAPI?.printReceipt?.(testData);
      
      if (result?.success) {
        console.log(`✅ Test print sent successfully to ${printerName}`);
      } else {
        alert(`❌ Test print failed to ${printerName}

Error: ${result?.error || 'Unknown error'}

Troubleshooting:
1. Make sure printer is connected and powered on
2. Check Windows printer settings
3. Try printing from another app first
4. Restart the app and try again`);
      }
      
    } catch (error) {
      console.error('Error testing printer:', error);
      alert(`❌ Test print failed: ${error}

Please check:
1. Printer is connected and powered on
2. Printer drivers are installed correctly
3. Try printing from another app first
4. Restart the app and try again`);
    } finally {
      setIsTesting(null);
    }
  };

  const getStatusIcon = (printerName: string) => {
    if (!printerName) {
      return <XCircle className="w-4 h-4 text-gray-400" />;
    }
    
    const printer = systemPrinters.find(p => p.name === printerName);
    if (!printer) {
      return <AlertCircle className="w-4 h-4 text-yellow-500" />;
    }
    
    switch (printer.status) {
      case 'idle':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'offline':
        return <XCircle className="w-4 h-4 text-red-500" />;
      default:
        return <AlertCircle className="w-4 h-4 text-yellow-500" />;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Printer Selector</h2>
          <p className="text-gray-600 mt-1">Select printers for each type and test printing</p>
        </div>
        
        <div className="flex space-x-3">
          <button
            onClick={scanForPrinters}
            disabled={isScanning}
            className="flex items-center space-x-2 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-white px-4 py-2 rounded-lg transition-colors"
          >
            <Printer className={`w-4 h-4 ${isScanning ? 'animate-pulse' : ''}`} />
            <span>{isScanning ? 'Scanning...' : 'Scan Printers'}</span>
          </button>
        </div>
      </div>

      {/* Printer Selection Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Printer 1: Receipt Printer */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-3">
              <Printer className="w-6 h-6 text-blue-600" />
              <div>
                <h3 className="font-semibold text-gray-800">Printer 1: Receipt Printer</h3>
                <p className="text-sm text-gray-500">Standard receipts</p>
              </div>
            </div>
            {getStatusIcon(selectedPrinters.receiptPrinter)}
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select Printer
              </label>
              <select
                value={selectedPrinters.receiptPrinter}
                onChange={(e) => handlePrinterSelection('receiptPrinter', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 bg-white"
              >
                <option value="">Choose a printer...</option>
                {systemPrinters.map((printer) => (
                  <option key={printer.name} value={printer.name}>
                    {printer.displayName}
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={() => testPrinter('receiptPrinter')}
              disabled={!selectedPrinters.receiptPrinter || isTesting === 'receiptPrinter'}
              className="w-full flex items-center justify-center space-x-2 bg-green-500 hover:bg-green-600 disabled:bg-gray-300 text-white px-3 py-2 rounded-lg transition-colors"
            >
              {isTesting === 'receiptPrinter' ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Testing...</span>
                </>
              ) : (
                <>
                  <TestTube className="w-4 h-4" />
                  <span>Test Print</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Printer 2: Receiptize Printer */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-3">
              <Printer className="w-6 h-6 text-purple-600" />
              <div>
                <h3 className="font-semibold text-gray-800">Printer 2: Receiptize Printer</h3>
                <p className="text-sm text-gray-500">Specialized receipts</p>
              </div>
            </div>
            {getStatusIcon(selectedPrinters.receiptizePrinter)}
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select Printer
              </label>
              <select
                value={selectedPrinters.receiptizePrinter}
                onChange={(e) => handlePrinterSelection('receiptizePrinter', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500 text-gray-900 bg-white"
              >
                <option value="">Choose a printer...</option>
                {systemPrinters.map((printer) => (
                  <option key={printer.name} value={printer.name}>
                    {printer.displayName}
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={() => testPrinter('receiptizePrinter')}
              disabled={!selectedPrinters.receiptizePrinter || isTesting === 'receiptizePrinter'}
              className="w-full flex items-center justify-center space-x-2 bg-green-500 hover:bg-green-600 disabled:bg-gray-300 text-white px-3 py-2 rounded-lg transition-colors"
            >
              {isTesting === 'receiptizePrinter' ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Testing...</span>
                </>
              ) : (
                <>
                  <TestTube className="w-4 h-4" />
                  <span>Test Print</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Printer 3: Label Printer */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-3">
              <Printer className="w-6 h-6 text-green-600" />
              <div>
                <h3 className="font-semibold text-gray-800">Printer 3: Label Printer</h3>
                <p className="text-sm text-gray-500">Order labels</p>
              </div>
            </div>
            {getStatusIcon(selectedPrinters.labelPrinter)}
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select Printer
              </label>
              <select
                value={selectedPrinters.labelPrinter}
                onChange={(e) => handlePrinterSelection('labelPrinter', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500 text-gray-900 bg-white"
              >
                <option value="">Choose a printer...</option>
                {systemPrinters.map((printer) => (
                  <option key={printer.name} value={printer.name}>
                    {printer.displayName}
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={() => testPrinter('labelPrinter')}
              disabled={!selectedPrinters.labelPrinter || isTesting === 'labelPrinter'}
              className="w-full flex items-center justify-center space-x-2 bg-green-500 hover:bg-green-600 disabled:bg-gray-300 text-white px-3 py-2 rounded-lg transition-colors"
            >
              {isTesting === 'labelPrinter' ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Testing...</span>
                </>
              ) : (
                <>
                  <TestTube className="w-4 h-4" />
                  <span>Test Print</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Save Button */}
      <div className="flex justify-center">
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="flex items-center space-x-2 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-white px-6 py-3 rounded-lg transition-colors"
        >
          {isSaving ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              <span>Saving...</span>
            </>
          ) : (
            <>
              <Save className="w-4 h-4" />
              <span>Save Printer Selections</span>
            </>
          )}
        </button>
      </div>

      {/* Save Status */}
      {saveStatus === 'success' && (
        <div className="flex items-center justify-center space-x-2 text-green-600">
          <CheckCircle className="w-5 h-5" />
          <span>Printer selections saved successfully!</span>
        </div>
      )}

      {saveStatus === 'error' && (
        <div className="flex items-center justify-center space-x-2 text-red-600">
          <XCircle className="w-5 h-5" />
          <span>Error saving printer selections. Please try again.</span>
        </div>
      )}

      {/* Printer 2 Mode Settings */}
      <div className="bg-purple-50 border border-purple-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-purple-800 mb-3">Mode Printer Receiptize</h3>
        <p className="text-sm text-purple-700 mb-4">
          Konfigurasi cara kerja Printer Receiptize (Printer 2) untuk struk audit.
        </p>
        
        <div className="space-y-3">
          <label className="flex items-center space-x-3 cursor-pointer">
            <input
              type="radio"
              name="printer2Mode"
              value="auto"
              checked={printer2Mode === 'auto'}
              onChange={() => handleModeChange('auto')}
              className="w-4 h-4 text-purple-600"
            />
            <div className="flex-1">
              <span className="font-medium text-purple-900">Mode Otomatis</span>
              <p className="text-sm text-purple-700">
                Otomatis mencetak 3 struk acak dari setiap 10 transaksi (audit sampling)
              </p>
            </div>
          </label>
          
          <label className="flex items-center space-x-3 cursor-pointer">
            <input
              type="radio"
              name="printer2Mode"
              value="manual"
              checked={printer2Mode === 'manual'}
              onChange={() => handleModeChange('manual')}
              className="w-4 h-4 text-purple-600"
            />
            <div className="flex-1">
              <span className="font-medium text-purple-900">Mode Manual</span>
              <p className="text-sm text-purple-700">
                Pilih transaksi secara manual untuk dicetak (segera hadir)
              </p>
            </div>
          </label>
        </div>
        
        {modeSaveStatus === 'success' && (
          <div className="mt-4 flex items-center space-x-2 text-green-600">
            <CheckCircle className="w-4 h-4" />
            <span className="text-sm">Mode saved successfully</span>
          </div>
        )}
        
        {modeSaveStatus === 'error' && (
          <div className="mt-4 flex items-center space-x-2 text-red-600">
            <XCircle className="w-4 h-4" />
            <span className="text-sm">Failed to save mode</span>
          </div>
        )}
      </div>

    </div>
  );
}
