'use client';

import { useState, useEffect } from 'react';
import { Printer, Save, TestTube, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { appAlert } from '@/components/AppDialog';

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
  const [copies, setCopies] = useState<Record<'receiptPrinter' | 'labelPrinter' | 'receiptizePrinter', number>>({
    receiptPrinter: 1,
    labelPrinter: 1,
    receiptizePrinter: 1
  });
  const [nonCashCopies, setNonCashCopies] = useState<Record<'receiptPrinter' | 'receiptizePrinter', number>>({
    receiptPrinter: 1,
    receiptizePrinter: 1
  });
  // Printer 3 (labelPrinter) only: copies for offline vs non-offline (GoFood, Grab, Shopee, Qpon, TikTok)
  const [labelPrinterNonOfflineCopies, setLabelPrinterNonOfflineCopies] = useState<number>(1);
  const [singlePrinterMode, setSinglePrinterMode] = useState<boolean>(false);
  const [printer2AuditLogChance, setPrinter2AuditLogChance] = useState<number | null>(null);
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
        const copiesSettings: Record<'receiptPrinter' | 'labelPrinter' | 'receiptizePrinter', number> = {
          receiptPrinter: 1,
          labelPrinter: 1,
          receiptizePrinter: 1
        };
        const nonCashCopiesSettings: Record<'receiptPrinter' | 'receiptizePrinter', number> = {
          receiptPrinter: 1,
          receiptizePrinter: 1
        };
        let labelPrinterNonOfflineValue = 1;
        let singlePrinterModeValue = false;
        let printer2AuditLogChanceValue: number | null = null;

        configs.forEach((config: PrinterConfigRow) => {
          if (!config) {
            return;
          }

          // Handle singlePrinterMode config (doesn't require system_printer_name)
          if (config.printer_type === 'singlePrinterMode') {
            if (config.extra_settings) {
              try {
                const extra =
                  typeof config.extra_settings === 'string'
                    ? JSON.parse(config.extra_settings)
                    : config.extra_settings;
                if (
                  extra &&
                  typeof extra === 'object' &&
                  'enabled' in extra &&
                  typeof (extra as { enabled?: boolean }).enabled === 'boolean'
                ) {
                  singlePrinterModeValue = (extra as { enabled: boolean }).enabled;
                }
                // Load printer2AuditLogChance if present
                if (
                  extra &&
                  typeof extra === 'object' &&
                  'printer2AuditLogChance' in extra &&
                  typeof (extra as { printer2AuditLogChance?: number | null }).printer2AuditLogChance === 'number'
                ) {
                  const chance = (extra as { printer2AuditLogChance: number }).printer2AuditLogChance;
                  if (chance >= 0 && chance <= 100) {
                    printer2AuditLogChanceValue = chance;
                  }
                }
              } catch (parseError) {
                console.error('Failed to parse extra_settings for singlePrinterMode:', parseError);
              }
            }
            return;
          }

          if (typeof config.system_printer_name !== 'string') {
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
              let nonCashCopiesValue = copiesValue;
              if (
                (config.printer_type === 'receiptPrinter' || config.printer_type === 'receiptizePrinter') &&
                extra &&
                typeof extra === 'object' &&
                'nonCashCopies' in extra &&
                typeof (extra as { nonCashCopies?: number }).nonCashCopies === 'number' &&
                !Number.isNaN((extra as { nonCashCopies?: number }).nonCashCopies) &&
                (extra as { nonCashCopies?: number }).nonCashCopies! > 0
              ) {
                nonCashCopiesValue = (extra as { nonCashCopies: number }).nonCashCopies!;
              }
              if (config.printer_type === 'receiptPrinter') {
                nonCashCopiesSettings.receiptPrinter = nonCashCopiesValue;
              } else if (config.printer_type === 'receiptizePrinter') {
                nonCashCopiesSettings.receiptizePrinter = nonCashCopiesValue;
              }
              // Printer 3 (labelPrinter): nonOfflineCopies for GoFood, Grab, Shopee, Qpon, TikTok
              if (config.printer_type === 'labelPrinter' && extra && typeof extra === 'object' && 'nonOfflineCopies' in extra &&
                typeof (extra as { nonOfflineCopies?: number }).nonOfflineCopies === 'number' &&
                !Number.isNaN((extra as { nonOfflineCopies?: number }).nonOfflineCopies) &&
                (extra as { nonOfflineCopies?: number }).nonOfflineCopies! > 0) {
                labelPrinterNonOfflineValue = (extra as { nonOfflineCopies: number }).nonOfflineCopies;
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
              margins.labelPrinter = 0; // offset removed for Printer 3 (checker uses fixed padding)
              copiesSettings.labelPrinter = copiesValue;
              break;
            case 'receiptizePrinter':
              selections.receiptizePrinter = config.system_printer_name;
              margins.receiptizePrinter = marginAdjustMm;
              copiesSettings.receiptizePrinter = copiesValue;
              break;
          }
        });

        setSinglePrinterMode(singlePrinterModeValue);
        setPrinter2AuditLogChance(printer2AuditLogChanceValue);

        setSelectedPrinters(selections);
        setMarginOffsets(margins);
        setCopies(copiesSettings);
        setNonCashCopies(nonCashCopiesSettings);
        setLabelPrinterNonOfflineCopies(labelPrinterNonOfflineValue);
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

      // Load singlePrinterMode from localStorage as fallback
      const savedSinglePrinterMode = localStorage.getItem('single-printer-mode');
      if (savedSinglePrinterMode !== null) {
        try {
          setSinglePrinterMode(savedSinglePrinterMode === 'true');
        } catch (error) {
          console.error('Failed to parse single-printer-mode from localStorage:', error);
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
        const copiesValue = (printerType === 'receiptPrinter' || printerType === 'labelPrinter' || printerType === 'receiptizePrinter')
          ? (copies[printerType] || 1)
          : undefined;
        // Printer 3 (labelPrinter): no marginAdjustMm (offset removed; checker uses fixed padding)
        if (printerType === 'labelPrinter') {
          const settings: { copies?: number; nonOfflineCopies?: number } = {};
          if (copiesValue !== undefined) {
            settings.copies = typeof copiesValue === 'number' && !Number.isNaN(copiesValue) && copiesValue > 0 ? copiesValue : 1;
          }
          const nonOffVal = typeof labelPrinterNonOfflineCopies === 'number' && !Number.isNaN(labelPrinterNonOfflineCopies) && labelPrinterNonOfflineCopies > 0
            ? labelPrinterNonOfflineCopies
            : 1;
          settings.nonOfflineCopies = nonOffVal;
          return settings;
        }
        const marginAdjust = marginOffsets[printerType];
        const settings: { marginAdjustMm: number; copies?: number; nonCashCopies?: number; nonOfflineCopies?: number } = {
          marginAdjustMm: typeof marginAdjust === 'number' && !Number.isNaN(marginAdjust) ? marginAdjust : 0,
        };
        if (copiesValue !== undefined) {
          settings.copies = typeof copiesValue === 'number' && !Number.isNaN(copiesValue) && copiesValue > 0 ? copiesValue : 1;
        }
        // Printer 1 & 2 (receiptPrinter, receiptizePrinter): nonCashCopies
        if (printerType === 'receiptPrinter' || printerType === 'receiptizePrinter') {
          const nonCashValue = nonCashCopies[printerType] ?? 1;
          settings.nonCashCopies = typeof nonCashValue === 'number' && !Number.isNaN(nonCashValue) && nonCashValue > 0 ? nonCashValue : 1;
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

      // Save singlePrinterMode setting with printer2AuditLogChance
      const singlePrinterModeSettings: { enabled: boolean; printer2AuditLogChance?: number | null } = {
        enabled: singlePrinterMode
      };
      if (printer2AuditLogChance !== null && printer2AuditLogChance >= 0 && printer2AuditLogChance <= 100) {
        singlePrinterModeSettings.printer2AuditLogChance = printer2AuditLogChance;
      }
      savePromises.push(
        window.electronAPI?.localDbSavePrinterConfig?.('singlePrinterMode', 'enabled', singlePrinterModeSettings)
      );

      const results = await Promise.all(savePromises);
      const hasError = results.some(result => !result?.success);

      if (hasError) {
        setSaveStatus('error');
        appAlert('Some printer configurations could not be saved. Please try again.');
      } else {
        setSaveStatus('success');
        // Also save to localStorage as backup
        localStorage.setItem('printer-selections', JSON.stringify(selections));
        localStorage.setItem('printer-margin-offsets', JSON.stringify(marginOffsets));
        localStorage.setItem('single-printer-mode', String(singlePrinterMode));
      }

      // Reset success status after 3 seconds
      setTimeout(() => setSaveStatus('idle'), 3000);

    } catch (error) {
      console.error('Error saving printer selections:', error);
      setSaveStatus('error');
      appAlert('Error saving printer configurations. Please try again.');
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
        appAlert('This feature requires the Electron app. Please run the app from the desktop shortcut, not in the browser.');
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
          appAlert(`No printers detected by Windows. 

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
        appAlert(`Unable to list printers. Error: ${result instanceof Error ? result.message : 'Unknown error'}

Please try:
1. Restart the app completely
2. Check if your printer is connected and powered on
3. Go to Windows Settings → Devices → Printers & scanners to verify`);
      }
    } catch (error) {
      console.error('Error scanning for printers:', error);
      appAlert(`Error scanning for printers: ${error}

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

  const handleCopiesChange = (printerType: 'receiptPrinter' | 'receiptizePrinter' | 'labelPrinter', value: number) => {
    const numValue = Math.max(1, Math.floor(value));
    setCopies(prev => ({
      ...prev,
      [printerType]: numValue
    }));
  };

  const handleNonCashCopiesChange = (printerType: 'receiptPrinter' | 'receiptizePrinter', value: number) => {
    const numValue = Math.max(1, Math.floor(value));
    setNonCashCopies(prev => ({
      ...prev,
      [printerType]: numValue
    }));
  };

  const handleLabelPrinterNonOfflineCopiesChange = (value: number) => {
    setLabelPrinterNonOfflineCopies(Math.max(1, Math.floor(value)));
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
      appAlert('Please select a printer first.');
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
        // Label: use simple test print (no receipt template). No offset for Printer 3.
        testData = {
          type: 'test',
          printerType: 'labelPrinter',
          printerName,
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
          appAlert(`❌ Test print failed to ${printerName}${copiesCount > 1 ? ` (copy ${copy}/${copiesCount})` : ''}\n\nError: ${result?.error || 'Unknown error'}\n\nTroubleshooting:\n1. Make sure printer is connected and powered on\n2. Check Windows printer settings\n3. Try printing from another app first\n4. Restart the app and try again`);
          break;
        }
      }
      if (!hasError && copiesCount > 1) {
        console.log(`✅ All ${copiesCount} test print copies sent successfully`);
      }
    } catch (error) {
      console.error('Error testing printer:', error);
      appAlert(`❌ Test print failed: ${error}\n\nPlease check:\n1. Printer is connected and powered on\n2. Printer drivers are installed correctly\n3. Try printing from another app first\n4. Restart the app and try again`);
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
                    Copies (cash)
                  </label>
                </div>
                <div className="w-20">
                  <label className="block text-sm font-medium text-gray-700">
                    Non-cash copies
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
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={nonCashCopies.receiptPrinter}
                  onChange={(e) => handleNonCashCopiesChange('receiptPrinter', Number(e.target.value))}
                  className="w-20 border border-gray-300 rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 bg-white text-center"
                  title="Copies when payment is not cash (e.g. card, QR, e-wallet)"
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
                    Copies (cash)
                  </label>
                </div>
                <div className="w-20">
                  <label className="block text-sm font-medium text-gray-700">
                    Non-cash copies
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
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={nonCashCopies.receiptizePrinter}
                  onChange={(e) => handleNonCashCopiesChange('receiptizePrinter', Number(e.target.value))}
                  className="w-20 border border-gray-300 rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500 text-gray-900 bg-white text-center"
                  title="Copies when payment is not cash (e.g. card, QR, e-wallet)"
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

        {/* Printer 3: Label/Checker Printer */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-3">
              <Printer className="w-6 h-6 text-green-600" />
              <div>
                <h3 className="font-semibold text-gray-800">Printer 3: Label/Checker Printer</h3>
                <p className="text-sm text-gray-500">Order labels / checker</p>
              </div>
            </div>
            {getStatusIcon(selectedPrinters.labelPrinter)}
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
                    Copies (offline)
                  </label>
                </div>
                <div className="w-20">
                  <label className="block text-sm font-medium text-gray-700">
                    Copies (non-offline)
                  </label>
                </div>
              </div>
              <div className="flex items-center gap-2 -mt-1">
                <select
                  value={selectedPrinters.labelPrinter}
                  onChange={(e) => handlePrinterSelection('labelPrinter', e.target.value)}
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500 text-gray-900 bg-white"
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
                  value={copies.labelPrinter}
                  onChange={(e) => handleCopiesChange('labelPrinter', Number(e.target.value))}
                  className="w-16 border border-gray-300 rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-green-500 text-gray-900 bg-white text-center"
                  title="Copies for offline orders"
                />
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={labelPrinterNonOfflineCopies}
                  onChange={(e) => handleLabelPrinterNonOfflineCopiesChange(Number(e.target.value))}
                  className="w-20 border border-gray-300 rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-green-500 text-gray-900 bg-white text-center"
                  title="Copies for GoFood, Grab, Shopee, Qpon, TikTok"
                />
              </div>
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

      {/* Single Printer Mode Toggle */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-gray-800 mb-2">Single Printer Mode</h3>
            <p className="text-sm text-gray-600">
              When enabled, all transactions will be printed on Printer 1 only, regardless of which side of the confirmation button is clicked.
              The receipt will show Printer 1's daily counter, but the database will still track the original printer assignment.
            </p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer ml-4">
            <input
              type="checkbox"
              checked={singlePrinterMode}
              onChange={(e) => {
                setSinglePrinterMode(e.target.checked);
                // Auto-save on change
                setTimeout(() => {
                  handleSave();
                }, 100);
              }}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
          </label>
        </div>

        {/* Randomize Printer 1 and Printer 2 Audit Log Database Saving */}
        {singlePrinterMode && (
          <div className="mt-4 pt-4 border-t border-gray-200">
            <div className="flex items-center justify-between mb-2">
              <div className="flex-1">
                <h4 className="text-sm font-semibold text-gray-800 mb-1">Randomize Printer 1 and Printer 2 Audit Log Database Saving</h4>
                <p className="text-xs text-gray-600">
                  When enabled, transactions will randomly be saved to Printer 1 or Printer 2 audit log based on the percentage below.
                  Leave empty or set to 0 to disable randomization (default behavior).
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 mt-3">
              <label className="text-sm font-medium text-gray-700 whitespace-nowrap">
                Printer 2 Audit Log Chance (%):
              </label>
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                value={printer2AuditLogChance === null ? '' : printer2AuditLogChance}
                onChange={(e) => {
                  const value = e.target.value === '' ? null : Number(e.target.value);
                  if (value === null || (value >= 0 && value <= 100)) {
                    setPrinter2AuditLogChance(value);
                    // Auto-save on change
                    setTimeout(() => {
                      handleSave();
                    }, 500);
                  }
                }}
                placeholder="0-100"
                className="w-24 border border-gray-300 rounded-lg px-3 py-2 text-black focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        )}
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
