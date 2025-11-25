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

interface PrinterConfigRow {
  printer_type: keyof PrinterSelection;
  system_printer_name: string;
  extra_settings?: string | { marginAdjustMm?: number };
}

interface ElectronPrinter {
  name: string;
  displayName?: string;
  status?: unknown;
  isDefault?: boolean;
}

const getElectronAPI = () => (typeof window !== 'undefined' ? window.electronAPI : undefined);

export default function PrinterSelector() {
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
  const [isScanning, setIsScanning] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');

  // Add state for Printer 2 mode
  const [printer2Mode, setPrinter2Mode] = useState<'auto' | 'manual'>('auto');
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
      const electronAPI = getElectronAPI();
      if (!electronAPI?.getPrinter2Mode) return;

      const result = await electronAPI.getPrinter2Mode();
      if (result?.success && result?.mode) {
        setPrinter2Mode(result.mode);
        console.log('✅ Loaded Printer 2 mode:', result.mode);
      }
    } catch (error) {
      console.error('Error loading Printer 2 mode:', error);
    }
  };

  const handleModeChange = async (newMode: 'auto' | 'manual') => {
    setPrinter2Mode(newMode);
    
    // Auto-save
    const electronAPI = getElectronAPI();
    if (!electronAPI?.setPrinter2Mode) return;

    setModeSaveStatus('idle');
    
    try {
      const result = await electronAPI.setPrinter2Mode(newMode);
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
      setTimeout(() => setModeSaveStatus('idle'), 3000);
    }
  };

  const loadSavedSelections = async () => {
    try {
      // First try to load from database
      const electronAPI = getElectronAPI();
      const configs = await electronAPI?.localDbGetPrinterConfigs?.();
      if (Array.isArray(configs) && configs.length > 0) {
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
        
        const validTypes: Array<keyof PrinterSelection> = ['receiptPrinter', 'labelPrinter', 'receiptizePrinter'];

        (configs as PrinterConfigRow[]).forEach((config) => {
          if (!validTypes.includes(config.printer_type)) {
            return;
          }
          let marginAdjustMm = 0;
          const extraSettings = config.extra_settings;
          try {
            const parsed =
              typeof extraSettings === 'string'
                ? JSON.parse(extraSettings)
                : extraSettings;
            if (parsed && typeof parsed.marginAdjustMm === 'number' && !Number.isNaN(parsed.marginAdjustMm)) {
              marginAdjustMm = parsed.marginAdjustMm;
            }
          } catch (parseError) {
            console.error('Failed to parse extra_settings for printer config:', parseError);
          }
          
          selections[config.printer_type] = config.system_printer_name;
          margins[config.printer_type] = marginAdjustMm;
        });
        
        setSelectedPrinters(selections);
        setMarginOffsets(margins);
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
      const electronAPI = getElectronAPI();
      const savePromises: Array<Promise<{ success?: boolean } | undefined>> = [];
      const buildExtraSettings = (printerType: keyof PrinterSelection) => {
        const marginAdjust = marginOffsets[printerType];
        return {
          marginAdjustMm: typeof marginAdjust === 'number' && !Number.isNaN(marginAdjust) ? marginAdjust : 0,
        };
      };
      
      if (selections.receiptPrinter && electronAPI?.localDbSavePrinterConfig) {
        savePromises.push(
          electronAPI.localDbSavePrinterConfig('receiptPrinter', selections.receiptPrinter, buildExtraSettings('receiptPrinter'))
        );
      }
      
      if (selections.labelPrinter && electronAPI?.localDbSavePrinterConfig) {
        savePromises.push(
          electronAPI.localDbSavePrinterConfig('labelPrinter', selections.labelPrinter, buildExtraSettings('labelPrinter'))
        );
      }
      
      if (selections.receiptizePrinter && electronAPI?.localDbSavePrinterConfig) {
        savePromises.push(
          electronAPI.localDbSavePrinterConfig('receiptizePrinter', selections.receiptizePrinter, buildExtraSettings('receiptizePrinter'))
        );
      }
      
      const results = await Promise.all(savePromises);
      const hasError = savePromises.length > 0 && results.some(result => !result?.success);
      
      if (savePromises.length === 0) {
        localStorage.setItem('printer-selections', JSON.stringify(selections));
        localStorage.setItem('printer-margin-offsets', JSON.stringify(marginOffsets));
        setSaveStatus('success');
        setTimeout(() => setSaveStatus('idle'), 3000);
        return;
      }

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
      const electronAPI = getElectronAPI();
      if (!electronAPI?.listPrinters) {
        alert('This feature requires the Electron app. Please run the app from the desktop shortcut, not in the browser.');
        return;
      }

      const result = await electronAPI.listPrinters();
      if (result && result.success) {
        const allowedStatuses: SystemPrinter['status'][] = ['idle', 'printing', 'stopped', 'offline'];
        const mapped: SystemPrinter[] = (result.printers || []).map((p: ElectronPrinter) => {
          const status =
            typeof p.status === 'string' && allowedStatuses.includes(p.status as SystemPrinter['status'])
              ? (p.status as SystemPrinter['status'])
              : 'idle';
          return {
            name: p.name,
            displayName: p.displayName || p.name,
            status,
            isDefault: Boolean(p.isDefault),
          };
        });
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
        alert(`Unable to list printers. Error: Unknown error

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

  const handleSave = () => {
    saveSelections(selectedPrinters);
  };

  const testPrinter = async (printerType: keyof PrinterSelection) => {
    const printerName = selectedPrinters[printerType];
    if (!printerName) {
      alert('Please select a printer first.');
      return;
    }

    const electronAPI = getElectronAPI();
    if (!electronAPI?.printReceipt) {
      alert('Printer testing requires the desktop app.');
      return;
    }

    setIsTesting(printerType);
    
    try {
      // Use the existing print-receipt IPC handler for testing
      const testData = {
        type: 'test',
        printerType: printerType,
        printerName: printerName,
        marginAdjustMm: marginOffsets[printerType],
        content: `TEST PRINT - ${printerType.toUpperCase()}\n\nThis is a test print to verify your printer is working correctly.\n\nPrinter: ${printerName}\nTime: ${new Date().toLocaleString()}\n\nIf you can see this, your printer is configured correctly!`
      };
      
      const result = await electronAPI.printReceipt(testData) as { success?: boolean; error?: string };
      
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
