'use client';

import { useState, useEffect } from 'react';
import { Printer, Save, TestTube, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

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

type PrinterConfigRow = {
  printer_type?: keyof PrinterSelection | string;
  system_printer_name?: string;
  extra_settings?: unknown;
};

type ElectronPrinter = {
  name: string;
  displayName?: string;
  status?: string;
  isDefault?: boolean;
};

const normalizePrinterStatus = (status?: string): SystemPrinter['status'] => {
  if (status === 'printing' || status === 'stopped' || status === 'offline' || status === 'idle') {
    return status;
  }
  return 'idle';
};

const isPrinterConfigRow = (value: unknown): value is PrinterConfigRow => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (record.system_printer_name && typeof record.system_printer_name !== 'string') {
    return false;
  }
  return true;
};

export default function PrinterSelector() {
  const { user } = useAuth();
  const businessId = user?.selectedBusinessId != null ? user.selectedBusinessId : undefined;
  const [systemPrinters, setSystemPrinters] = useState<SystemPrinter[]>([]);
  const [selectedPrinters, setSelectedPrinters] = useState<PrinterSelection>({
    receiptPrinter: '',
    labelPrinter: '',
    receiptizePrinter: ''
  });
  const [marginOffsets, setMarginOffsets] = useState<Record<keyof PrinterSelection, number>>({
    receiptPrinter: 0,
    labelPrinter: 0,
    receiptizePrinter: 0
  });
  const [copies, setCopies] = useState<Record<'receiptPrinter' | 'receiptizePrinter', number>>({
    receiptPrinter: 1,
    receiptizePrinter: 1
  });
  const [isScanning, setIsScanning] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');

  // Load saved printer selections and auto-scan printers on component mount
  useEffect(() => {
    loadSavedSelections();
    // Auto-scan printers when component mounts
    scanForPrinters();
  }, []);

  const loadSavedSelections = async () => {
    try {
      // First try to load from database
      const configsRaw = await window.electronAPI?.localDbGetPrinterConfigs?.();
      const configs = Array.isArray(configsRaw)
        ? configsRaw.filter(isPrinterConfigRow)
        : [];
      if (configs.length > 0) {
        const selections: PrinterSelection = {
          receiptPrinter: '',
          labelPrinter: '',
          receiptizePrinter: ''
        };
        const margins: Record<keyof PrinterSelection, number> = {
          receiptPrinter: 0,
          labelPrinter: 0,
          receiptizePrinter: 0
        };
        const copiesSettings: Record<'receiptPrinter' | 'receiptizePrinter', number> = {
          receiptPrinter: 1,
          receiptizePrinter: 1
        };
        
        configs.forEach((config: PrinterConfigRow) => {
          if (!config || typeof config.system_printer_name !== 'string') {
            return;
          }
          let marginAdjustMm = 0;
          let copiesValue = 1;
          if (config.extra_settings) {
            try {
              const extra =
                typeof config.extra_settings === 'string'
                  ? JSON.parse(config.extra_settings)
                  : config.extra_settings;
              if (
                extra &&
                typeof extra === 'object' &&
                'marginAdjustMm' in extra &&
                typeof (extra as { marginAdjustMm?: number }).marginAdjustMm === 'number' &&
                !Number.isNaN((extra as { marginAdjustMm?: number }).marginAdjustMm)
              ) {
                marginAdjustMm = (extra as { marginAdjustMm: number }).marginAdjustMm;
              }
              if (
                extra &&
                typeof extra === 'object' &&
                'copies' in extra &&
                typeof (extra as { copies?: number }).copies === 'number' &&
                !Number.isNaN((extra as { copies?: number }).copies) &&
                (extra as { copies?: number }).copies! > 0
              ) {
                copiesValue = (extra as { copies: number }).copies!;
              }
            } catch (parseError) {
              console.error('Failed to parse extra_settings for printer config:', parseError);
            }
          }
          
          switch (config.printer_type) {
            case 'receiptPrinter':
              selections.receiptPrinter = config.system_printer_name;
              margins.receiptPrinter = marginAdjustMm;
              copiesSettings.receiptPrinter = copiesValue;
              break;
            case 'labelPrinter':
              selections.labelPrinter = config.system_printer_name;
              margins.labelPrinter = marginAdjustMm;
              break;
            case 'receiptizePrinter':
              selections.receiptizePrinter = config.system_printer_name;
              margins.receiptizePrinter = marginAdjustMm;
              copiesSettings.receiptizePrinter = copiesValue;
              break;
          }
        });
        
        setSelectedPrinters(selections);
        setMarginOffsets(margins);
        setCopies(copiesSettings);
        return;
      }
      
      // Fallback to localStorage
      const saved = localStorage.getItem('printer-selections');
      if (saved) {
        const selections = JSON.parse(saved);
        setSelectedPrinters(selections);
      }
      const savedMargins = localStorage.getItem('printer-margin-offsets');
      if (savedMargins) {
        try {
          const margins = JSON.parse(savedMargins);
          setMarginOffsets((prev) => ({
            receiptPrinter: typeof margins.receiptPrinter === 'number' ? margins.receiptPrinter : prev.receiptPrinter,
            labelPrinter: typeof margins.labelPrinter === 'number' ? margins.labelPrinter : prev.labelPrinter,
            receiptizePrinter: typeof margins.receiptizePrinter === 'number' ? margins.receiptizePrinter : prev.receiptizePrinter,
          }));
        } catch (marginError) {
          console.error('Failed to parse printer-margin-offsets from localStorage:', marginError);
        }
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
      const buildExtraSettings = (printerType: keyof PrinterSelection) => {
        const marginAdjust = marginOffsets[printerType];
        const copiesValue = (printerType === 'receiptPrinter' || printerType === 'receiptizePrinter')
          ? (copies[printerType] || 1)
          : undefined;
        const settings: { marginAdjustMm: number; copies?: number } = {
          marginAdjustMm: typeof marginAdjust === 'number' && !Number.isNaN(marginAdjust) ? marginAdjust : 0,
        };
        if (copiesValue !== undefined) {
          settings.copies = typeof copiesValue === 'number' && !Number.isNaN(copiesValue) && copiesValue > 0 ? copiesValue : 1;
        }
        return settings;
      };
      
      if (selections.receiptPrinter) {
        savePromises.push(
          window.electronAPI?.localDbSavePrinterConfig?.('receiptPrinter', selections.receiptPrinter, buildExtraSettings('receiptPrinter'))
        );
      }
      
      if (selections.labelPrinter) {
        savePromises.push(
          window.electronAPI?.localDbSavePrinterConfig?.('labelPrinter', selections.labelPrinter, buildExtraSettings('labelPrinter'))
        );
      }
      
      if (selections.receiptizePrinter) {
        savePromises.push(
          window.electronAPI?.localDbSavePrinterConfig?.('receiptizePrinter', selections.receiptizePrinter, buildExtraSettings('receiptizePrinter'))
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
        localStorage.setItem('printer-margin-offsets', JSON.stringify(marginOffsets));
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
        const mapped: SystemPrinter[] = (result.printers || [])
          .map((printer: ElectronPrinter) => {
            if (!printer || typeof printer.name !== 'string') {
              return null;
            }
            const safeName = printer.name;
            return {
              name: safeName,
              displayName: printer.displayName || safeName,
              status: normalizePrinterStatus(printer.status),
              isDefault: Boolean(printer.isDefault),
            };
          })
          .filter((printer): printer is SystemPrinter => Boolean(printer));
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
      console.error('Failed to list printers:', result);
      alert(`Unable to list printers. Error: ${result instanceof Error ? result.message : 'Unknown error'}

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

  const handleMarginChange = (printerType: keyof PrinterSelection, value: number) => {
    setMarginOffsets(prev => ({
      ...prev,
      [printerType]: value
    }));
  };

  const resetMargin = (printerType: keyof PrinterSelection) => {
    setMarginOffsets(prev => ({
      ...prev,
      [printerType]: 0
    }));
  };

  const handleCopiesChange = (printerType: 'receiptPrinter' | 'receiptizePrinter', value: number) => {
    const numValue = Math.max(1, Math.floor(value));
    setCopies(prev => ({
      ...prev,
      [printerType]: numValue
    }));
  };

  const handleSave = () => {
    saveSelections(selectedPrinters);
  };

interface PrintReceiptResult {
  success?: boolean;
  error?: string;
}

const isPrintReceiptResult = (value: unknown): value is PrintReceiptResult => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  if ('success' in record && typeof record.success !== 'boolean') {
    return false;
  }
  if ('error' in record && typeof record.error !== 'string') {
    return false;
  }
  return true;
};

const testPrinter = async (printerType: keyof PrinterSelection) => {
    const printerName = selectedPrinters[printerType];
    if (!printerName) {
      alert('Please select a printer first.');
      return;
    }

    setIsTesting(printerType);

    const runPrint = async (payload: Record<string, unknown>): Promise<PrintReceiptResult | undefined> => {
      const raw = await window.electronAPI?.printReceipt?.(payload);
      return isPrintReceiptResult(raw) ? raw : undefined;
    };

    try {
      let copiesCount = 1;
      let testData: Record<string, unknown>;

      if (printerType === 'labelPrinter') {
        // Label: use simple test print (no receipt template)
        testData = {
          type: 'test',
          printerType: 'labelPrinter',
          printerName,
          marginAdjustMm: marginOffsets.labelPrinter,
          content: `TEST PRINT - LABEL PRINTER\n\nThis is a test print to verify your printer is working correctly.\n\nPrinter: ${printerName}\nTime: ${new Date().toLocaleString()}\n\nIf you can see this, your printer is configured correctly!`,
        };
      } else {
        // Printer 1 and Printer 2: use receipt template with sample data
        copiesCount = copies[printerType as 'receiptPrinter' | 'receiptizePrinter'] || 1;
        testData = {
          printerType,
          printerName,
          marginAdjustMm: marginOffsets[printerType],
          business_id: businessId,
          items: [
            { name: 'Test Item 1', quantity: 2, price: 15000, total_price: 30000 },
            { name: 'Test Item 2', quantity: 1, price: 25000, total_price: 25000 },
          ],
          total: 55000,
          final_amount: 55000,
          paymentMethod: 'Cash',
          amountReceived: 60000,
          change: 5000,
          date: new Date().toISOString(),
          receiptNumber: 'TEST001',
          cashier: 'Test Print',
          pickupMethod: 'dine-in',
          printer1Counter: 1,
          printer2Counter: 1,
          globalCounter: 1,
          isBill: false,
          id: 'test-print-' + Date.now(),
        };
      }

      let hasError = false;
      for (let copy = 1; copy <= copiesCount; copy++) {
        if (copy > 1) await new Promise(r => setTimeout(r, 300));
        const result = await runPrint(testData);
        if (result?.success) {
          if (copy === 1) {
            console.log(`✅ Test print sent successfully to ${printerName}${copiesCount > 1 ? ` (${copiesCount} copy/copies)` : ''}`);
          }
        } else {
          hasError = true;
          alert(`❌ Test print failed to ${printerName}${copiesCount > 1 ? ` (copy ${copy}/${copiesCount})` : ''}\n\nError: ${result?.error || 'Unknown error'}\n\nTroubleshooting:\n1. Make sure printer is connected and powered on\n2. Check Windows printer settings\n3. Try printing from another app first\n4. Restart the app and try again`);
          break;
        }
      }
      if (!hasError && copiesCount > 1) {
        console.log(`✅ All ${copiesCount} test print copies sent successfully`);
      }
    } catch (error) {
      console.error('Error testing printer:', error);
      alert(`❌ Test print failed: ${error}\n\nPlease check:\n1. Printer is connected and powered on\n2. Printer drivers are installed correctly\n3. Try printing from another app first\n4. Restart the app and try again`);
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
    <div className="space-y-6 px-6 pt-6">
      <div className="flex items-center gap-3">
        <button
          onClick={scanForPrinters}
          disabled={isScanning}
          className="flex-1 flex items-center justify-center space-x-2 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-white px-4 py-2 rounded-lg transition-colors"
        >
          <Printer className={`w-4 h-4 ${isScanning ? 'animate-pulse' : ''}`} />
          <span>{isScanning ? 'Scanning...' : 'Scan Printers'}</span>
        </button>
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
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700">
                    Select Printer
                  </label>
                </div>
                <div className="w-16">
                  <label className="block text-sm font-medium text-gray-700">
                    Copies
                  </label>
                </div>
              </div>
              <div className="flex items-center gap-2 -mt-1">
                <select
                  value={selectedPrinters.receiptPrinter}
                  onChange={(e) => handlePrinterSelection('receiptPrinter', e.target.value)}
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 bg-white"
                >
                  <option value="">Choose a printer...</option>
                  {systemPrinters.map((printer) => (
                    <option key={printer.name} value={printer.name}>
                      {printer.displayName}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={copies.receiptPrinter}
                  onChange={(e) => handleCopiesChange('receiptPrinter', Number(e.target.value))}
                  className="w-16 border border-gray-300 rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 bg-white text-center"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Left Offset (mm)
              </label>
              <input
                type="range"
                min={-5}
                max={5}
                step={0.5}
                value={marginOffsets.receiptPrinter}
                onChange={(e) => handleMarginChange('receiptPrinter', Number(e.target.value))}
                className="w-full"
              />
              <div className="mt-1 flex items-center justify-between text-xs text-gray-500">
                <span>{marginOffsets.receiptPrinter.toFixed(1)} mm</span>
                <button
                  type="button"
                  onClick={() => resetMargin('receiptPrinter')}
                  className="text-blue-600 hover:text-blue-700"
                >
                  Reset
                </button>
              </div>
              <p className="mt-2 text-xs text-gray-500">
                Positive values shift content left; negative values shift it right. Save after adjusting.
              </p>
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
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700">
                    Select Printer
                  </label>
                </div>
                <div className="w-16">
                  <label className="block text-sm font-medium text-gray-700">
                    Copies
                  </label>
                </div>
              </div>
              <div className="flex items-center gap-2 -mt-1">
                <select
                  value={selectedPrinters.receiptizePrinter}
                  onChange={(e) => handlePrinterSelection('receiptizePrinter', e.target.value)}
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500 text-gray-900 bg-white"
                >
                  <option value="">Choose a printer...</option>
                  {systemPrinters.map((printer) => (
                    <option key={printer.name} value={printer.name}>
                      {printer.displayName}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={copies.receiptizePrinter}
                  onChange={(e) => handleCopiesChange('receiptizePrinter', Number(e.target.value))}
                  className="w-16 border border-gray-300 rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500 text-gray-900 bg-white text-center"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Left Offset (mm)
              </label>
              <input
                type="range"
                min={-5}
                max={5}
                step={0.5}
                value={marginOffsets.receiptizePrinter}
                onChange={(e) => handleMarginChange('receiptizePrinter', Number(e.target.value))}
                className="w-full"
              />
              <div className="mt-1 flex items-center justify-between text-xs text-gray-500">
                <span>{marginOffsets.receiptizePrinter.toFixed(1)} mm</span>
                <button
                  type="button"
                  onClick={() => resetMargin('receiptizePrinter')}
                  className="text-purple-600 hover:text-purple-700"
                >
                  Reset
                </button>
              </div>
              <p className="mt-2 text-xs text-gray-500">
                Positive values shift content left; negative values shift it right. Save after adjusting.
              </p>
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

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Left Offset (mm)
              </label>
              <input
                type="range"
                min={-5}
                max={5}
                step={0.5}
                value={marginOffsets.labelPrinter}
                onChange={(e) => handleMarginChange('labelPrinter', Number(e.target.value))}
                className="w-full"
              />
              <div className="mt-1 flex items-center justify-between text-xs text-gray-500">
                <span>{marginOffsets.labelPrinter.toFixed(1)} mm</span>
                <button
                  type="button"
                  onClick={() => resetMargin('labelPrinter')}
                  className="text-green-600 hover:text-green-700"
                >
                  Reset
                </button>
              </div>
              <p className="mt-2 text-xs text-gray-500">
                Offset is applied to label layouts when supported. Save after adjusting.
              </p>
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
          className="flex items-center space-x-2 bg-green-500 hover:bg-green-600 disabled:bg-green-300 text-white px-6 py-3 rounded-lg transition-colors"
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

      {/* Printer 2 Mode Settings - DISABLED: Feature not implemented/used */}
      {/* 
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
      */}

    </div>
  );
}
