'use client';

import { useState, useEffect } from 'react';
import { Printer, Tag, Power, Globe, ChevronRight, TestTube, CheckCircle, XCircle, AlertCircle } from 'lucide-react';

interface SystemPrinter {
  name: string;
  displayName: string;
  status: 'idle' | 'printing' | 'stopped' | 'offline';
  isDefault: boolean;
}

type PrinterConfigRow = {
  printer_type?: string;
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

interface PrinterModalProps {
  isOpen: boolean;
  onClose: () => void;
  printers: SystemPrinter[];
  selectedPrinter: string;
  onSelect: (printerName: string) => void;
  title: string;
}

function PrinterModal({ isOpen, onClose, printers, selectedPrinter, onSelect, title }: PrinterModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="p-6">
          <h2 className="text-xl font-semibold text-gray-800 mb-4">{title}</h2>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {printers.length === 0 ? (
              <p className="text-gray-500 text-center py-4">No printers available</p>
            ) : (
              printers.map((printer) => {
                const isSelected = printer.name === selectedPrinter;
                const statusColor = printer.status === 'idle' ? 'text-green-500' :
                  printer.status === 'offline' ? 'text-red-500' : 'text-yellow-500';

                return (
                  <button
                    key={printer.name}
                    onClick={() => {
                      onSelect(printer.name);
                      onClose();
                    }}
                    className={`w-full text-left p-3 rounded-lg border-2 transition-colors ${isSelected
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                      }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="font-medium text-gray-800">{printer.displayName}</div>
                        {printer.isDefault && (
                          <div className="text-xs text-gray-500 mt-1">Default Printer</div>
                        )}
                      </div>
                      <div className="flex items-center space-x-2">
                        {printer.status === 'idle' ? (
                          <CheckCircle className={`w-5 h-5 ${statusColor}`} />
                        ) : printer.status === 'offline' ? (
                          <XCircle className={`w-5 h-5 ${statusColor}`} />
                        ) : (
                          <AlertCircle className={`w-5 h-5 ${statusColor}`} />
                        )}
                        {isSelected && (
                          <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
          <div className="mt-6 flex justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function GlobalSettings() {
  const [systemPrinters, setSystemPrinters] = useState<SystemPrinter[]>([]);
  const [selectedReceiptizePrinter, setSelectedReceiptizePrinter] = useState<string>('');
  const [selectedLabelPrinter, setSelectedLabelPrinter] = useState<string>('');
  const [receiptizeOffset, setReceiptizeOffset] = useState<number>(0);
  const [labelOffset, setLabelOffset] = useState<number>(0);
  const [taxToggle, setTaxToggle] = useState<boolean>(false);
  // const [isScanning, setIsScanning] = useState(false);
  const [isTesting, setIsTesting] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState<{ type: 'receiptize' | 'label' | null }>({ type: null });

  // Load saved printer selections on component mount
  useEffect(() => {
    loadSavedSelections();
    scanForPrinters();
  }, []);

  const loadSavedSelections = async () => {
    try {
      // Load from database (same as original PrinterSelector)
      const configsRaw = await window.electronAPI?.localDbGetPrinterConfigs?.();
      const configs = Array.isArray(configsRaw)
        ? configsRaw.filter(isPrinterConfigRow)
        : [];

      if (configs.length > 0) {
        let receiptizePrinter = '';
        let labelPrinter = '';
        let receiptizeMargin = 0;
        let labelMargin = 0;

        configs.forEach((config: PrinterConfigRow) => {
          if (!config || typeof config.system_printer_name !== 'string') {
            return;
          }

          let marginAdjustMm = 0;
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
            } catch (parseError) {
              console.error('Failed to parse extra_settings for printer config:', parseError);
            }
          }

          switch (config.printer_type) {
            case 'receiptizePrinter':
              receiptizePrinter = config.system_printer_name;
              receiptizeMargin = marginAdjustMm;
              break;
            case 'labelPrinter':
              labelPrinter = config.system_printer_name;
              labelMargin = marginAdjustMm;
              break;
          }
        });

        setSelectedReceiptizePrinter(receiptizePrinter);
        setSelectedLabelPrinter(labelPrinter);
        setReceiptizeOffset(receiptizeMargin);
        setLabelOffset(labelMargin);
        return;
      }

      // Fallback to localStorage
      const saved = localStorage.getItem('printer-selections');
      if (saved) {
        const selections = JSON.parse(saved);
        setSelectedReceiptizePrinter(selections.receiptizePrinter || '');
        setSelectedLabelPrinter(selections.labelPrinter || '');
      }

      const savedMargins = localStorage.getItem('printer-margin-offsets');
      if (savedMargins) {
        try {
          const margins = JSON.parse(savedMargins);
          setReceiptizeOffset(typeof margins.receiptizePrinter === 'number' ? margins.receiptizePrinter : 0);
          setLabelOffset(typeof margins.labelPrinter === 'number' ? margins.labelPrinter : 0);
        } catch (marginError) {
          console.error('Failed to parse printer-margin-offsets from localStorage:', marginError);
        }
      }
    } catch (error) {
      console.error('Error loading saved printer selections:', error);
    }
  };

  const saveSelections = async () => {
    try {
      const savePromises = [];

      const buildExtraSettings = (printerType: 'receiptizePrinter' | 'labelPrinter') => {
        const marginAdjust = printerType === 'receiptizePrinter' ? receiptizeOffset : labelOffset;
        return {
          marginAdjustMm: typeof marginAdjust === 'number' && !Number.isNaN(marginAdjust) ? marginAdjust : 0,
        };
      };

      if (selectedReceiptizePrinter) {
        savePromises.push(
          window.electronAPI?.localDbSavePrinterConfig?.('receiptizePrinter', selectedReceiptizePrinter, buildExtraSettings('receiptizePrinter'))
        );
      }

      if (selectedLabelPrinter) {
        savePromises.push(
          window.electronAPI?.localDbSavePrinterConfig?.('labelPrinter', selectedLabelPrinter, buildExtraSettings('labelPrinter'))
        );
      }

      await Promise.all(savePromises);

      // Also save to localStorage as backup
      localStorage.setItem('printer-selections', JSON.stringify({
        receiptizePrinter: selectedReceiptizePrinter,
        labelPrinter: selectedLabelPrinter,
      }));
      localStorage.setItem('printer-margin-offsets', JSON.stringify({
        receiptizePrinter: receiptizeOffset,
        labelPrinter: labelOffset,
      }));
    } catch (error) {
      console.error('Error saving printer selections:', error);
      alert('Error saving printer configurations. Please try again.');
    }
  };

  const scanForPrinters = async () => {
    // setIsScanning(true);
    try {
      if (!window.electronAPI?.listPrinters) {
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
      }
    } catch (error) {
      console.error('Error scanning for printers:', error);
    } finally {
      // setIsScanning(false);
    }
  };


  const getPrinterStatus = (printerName: string): { status: string; color: string } => {
    if (!printerName) {
      return { status: 'Not Selected', color: 'text-gray-400' };
    }

    const printer = systemPrinters.find(p => p.name === printerName);
    if (!printer) {
      return { status: 'Unknown', color: 'text-yellow-500' };
    }

    if (printer.status === 'idle') {
      return { status: 'Online', color: 'text-teal-500' };
    } else if (printer.status === 'offline') {
      return { status: 'Offline', color: 'text-red-500' };
    } else {
      return { status: 'Busy', color: 'text-yellow-500' };
    }
  };

  const getPrinterDisplayName = (printerName: string): string => {
    if (!printerName) return 'Not Selected';
    const printer = systemPrinters.find(p => p.name === printerName);
    return printer?.displayName || printerName;
  };

  const testPrinter = async (printerType: 'receiptizePrinter' | 'labelPrinter') => {
    const printerName = printerType === 'receiptizePrinter' ? selectedReceiptizePrinter : selectedLabelPrinter;
    const offset = printerType === 'receiptizePrinter' ? receiptizeOffset : labelOffset;

    if (!printerName) {
      alert('Please select a printer first.');
      return;
    }

    setIsTesting(printerType);

    try {
      const testData = {
        type: 'test',
        printerType: printerType,
        printerName: printerName,
        marginAdjustMm: offset,
        content: `TEST PRINT - ${printerType.toUpperCase()}\n\nThis is a test print to verify your printer is working correctly.\n\nPrinter: ${printerName}\nTime: ${new Date().toLocaleString()}\n\nIf you can see this, your printer is configured correctly!`
      };

      const rawResult = await window.electronAPI?.printReceipt?.(testData);

      if (rawResult && typeof rawResult === 'object' && 'success' in rawResult && rawResult.success) {
        console.log(`✅ Test print sent successfully to ${printerName}`);
      } else {
        const errorMsg = (rawResult && typeof rawResult === 'object' && 'error' in rawResult)
          ? String(rawResult.error)
          : 'Unknown error';
        alert(`❌ Test print failed to ${printerName}\n\nError: ${errorMsg}`);
      }
    } catch (error) {
      console.error('Error testing printer:', error);
      alert(`❌ Test print failed: ${error}`);
    } finally {
      setIsTesting(null);
    }
  };

  const handleOffsetChange = (type: 'receiptize' | 'label', value: number) => {
    if (type === 'receiptize') {
      setReceiptizeOffset(value);
    } else {
      setLabelOffset(value);
    }
    // Auto-save on change
    setTimeout(() => {
      saveSelections();
    }, 500);
  };

  const handlePrinterSelect = (type: 'receiptize' | 'label', printerName: string) => {
    if (type === 'receiptize') {
      setSelectedReceiptizePrinter(printerName);
    } else {
      setSelectedLabelPrinter(printerName);
    }
    // Auto-save on selection
    setTimeout(() => {
      saveSelections();
    }, 100);
  };

  const receiptizeStatus = getPrinterStatus(selectedReceiptizePrinter);
  const labelStatus = getPrinterStatus(selectedLabelPrinter);

  return (
    <div className="p-6 space-y-6">
      {/* Printer Struk Card */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <Printer className="w-5 h-5 text-blue-800" />
            <h3 className="text-sm font-semibold text-gray-800">Printer Struk</h3>
          </div>
          <button
            onClick={() => setIsModalOpen({ type: 'receiptize' })}
            className="flex items-center space-x-2 text-black hover:text-gray-700 transition-colors"
          >
            <span className="font-medium text-black">{getPrinterDisplayName(selectedReceiptizePrinter)}</span>
            {receiptizeStatus.status === 'Online' && (
              <span className={`${receiptizeStatus.color} bg-green-50 px-2 py-1 rounded`}>
                {receiptizeStatus.status}
              </span>
            )}
            {receiptizeStatus.status !== 'Online' && (
              <span className={receiptizeStatus.color}>{receiptizeStatus.status}</span>
            )}
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
        <div className="flex justify-center mb-4">
          <div className="w-[90%] border-t border-gray-200"></div>
        </div>
        <div className="flex justify-end">
          <div className="flex items-center space-x-2 w-1/4">
            <label className="text-sm font-medium text-gray-700 whitespace-nowrap">
              Offset (mm)
            </label>
            <input
              type="number"
              min={-5}
              max={5}
              step={0.5}
              value={receiptizeOffset}
              onChange={(e) => handleOffsetChange('receiptize', Number(e.target.value))}
              className="border border-gray-300 rounded-lg px-3 py-2 text-black focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={() => testPrinter('receiptizePrinter')}
              disabled={!selectedReceiptizePrinter || isTesting === 'receiptizePrinter'}
              className="flex items-center justify-center space-x-2 bg-teal-500 hover:bg-teal-600 disabled:bg-gray-300 text-white px-4 py-2 rounded-lg transition-colors whitespace-nowrap"
            >
              {isTesting === 'receiptizePrinter' ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Testing...</span>
                </>
              ) : (
                <>
                  <TestTube className="w-4 h-4" />
                  <span>Uji Cetak</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Printer Label Card */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <Tag className="w-5 h-5 text-blue-800" />
            <h3 className="text-sm font-semibold text-gray-800">Printer Label</h3>
          </div>
          <button
            onClick={() => setIsModalOpen({ type: 'label' })}
            className="flex items-center space-x-2 text-black hover:text-gray-700 transition-colors"
          >
            <span className="font-medium text-black">{getPrinterDisplayName(selectedLabelPrinter)}</span>
            {labelStatus.status === 'Online' && (
              <span className={`${labelStatus.color} bg-green-50 px-2 py-1 rounded`}>
                {labelStatus.status}
              </span>
            )}
            {labelStatus.status !== 'Online' && (
              <span className={labelStatus.color}>{labelStatus.status}</span>
            )}
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
        <div className="flex justify-center mb-4">
          <div className="w-[90%] border-t border-gray-200"></div>
        </div>
        <div className="flex justify-end">
          <div className="flex items-center space-x-2 w-1/4">
            <label className="text-sm font-medium text-gray-700 whitespace-nowrap">
              Offset (mm)
            </label>
            <input
              type="number"
              min={-5}
              max={5}
              step={0.5}
              value={labelOffset}
              onChange={(e) => handleOffsetChange('label', Number(e.target.value))}
              className="border border-gray-300 rounded-lg px-3 py-2 text-black focus:outline-none focus:ring-2 focus:ring-green-500"
            />
            <button
              onClick={() => testPrinter('labelPrinter')}
              disabled={!selectedLabelPrinter || isTesting === 'labelPrinter'}
              className="flex items-center justify-center space-x-2 bg-teal-500 hover:bg-teal-600 disabled:bg-gray-300 text-white px-4 py-2 rounded-lg transition-colors whitespace-nowrap"
            >
              {isTesting === 'labelPrinter' ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Testing...</span>
                </>
              ) : (
                <>
                  <TestTube className="w-4 h-4" />
                  <span>Uji Cetak</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Saklar Pajak Toko Card */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <Power className="w-5 h-5 text-blue-800" />
            <h3 className="text-sm font-semibold text-gray-800">Saklar Pajak Toko</h3>
          </div>
        </div>
        <div className="flex items-start justify-between">
          <p className="text-sm font-bold text-gray-400 flex-1 mr-4">
            Saat diaktifkan, pesanan toko akan dikenakan pajak seperti biasa, dan informasi pajak akan dicetak pada struk belanja. Saat dinonaktifkan, pesanan toko tidak akan dikenakan pajak.
          </p>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={taxToggle}
              onChange={(e) => setTaxToggle(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-gray-400"></div>
          </label>
        </div>
      </div>

      {/* Bahasa Card */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Globe className="w-5 h-5 text-blue-800" />
            <h3 className="text-sm font-semibold text-gray-800">Bahasa</h3>
          </div>
          <div className="flex items-center space-x-2">
            <span className="text-gray-700">Indonesia</span>
            <ChevronRight className="w-5 h-5 text-gray-400" />
          </div>
        </div>
      </div>


      {/* Printer Selection Modals */}
      <PrinterModal
        isOpen={isModalOpen.type === 'receiptize'}
        onClose={() => setIsModalOpen({ type: null })}
        printers={systemPrinters}
        selectedPrinter={selectedReceiptizePrinter}
        onSelect={(printerName) => handlePrinterSelect('receiptize', printerName)}
        title="Pilih Printer Struk"
      />
      <PrinterModal
        isOpen={isModalOpen.type === 'label'}
        onClose={() => setIsModalOpen({ type: null })}
        printers={systemPrinters}
        selectedPrinter={selectedLabelPrinter}
        onSelect={(printerName) => handlePrinterSelect('label', printerName)}
        title="Pilih Printer Label"
      />
    </div>
  );
}

