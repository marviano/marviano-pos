'use client';

import { useState, useEffect } from 'react';
import { Printer, TestTube, CheckCircle, XCircle, AlertCircle, RefreshCw, Download, Settings } from 'lucide-react';
import PrinterSelector from './PrinterSelector';

interface SystemPrinter {
  name: string;
  displayName: string;
  status: 'idle' | 'printing' | 'stopped' | 'offline';
  isDefault: boolean;
}

interface PrinterConfig {
  id: string;
  name: string;
  type: 'receipt1' | 'receipt2' | 'order_label';
  systemPrinterName?: string;
  status: 'not_configured' | 'configured' | 'error';
  lastTest?: Date;
  testResult?: 'success' | 'failed';
}

const defaultPrinters: PrinterConfig[] = [
  {
    id: 'printer1',
    name: 'Receipt Printer 1 (Standard)',
    type: 'receipt1',
    status: 'not_configured'
  },
  {
    id: 'printer2', 
    name: 'Receipt Printer 2 (Audit)',
    type: 'receipt2',
    status: 'not_configured'
  },
  {
    id: 'printer3',
    name: 'Order Label Printer',
    type: 'order_label',
    status: 'not_configured'
  }
];

export default function PrinterSetup() {
  const [printers, setPrinters] = useState<PrinterConfig[]>(defaultPrinters);
  const [systemPrinters, setSystemPrinters] = useState<SystemPrinter[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [isTesting, setIsTesting] = useState<string | null>(null);
  const [selectedPrinterForConfig, setSelectedPrinterForConfig] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'setup' | 'selector'>('selector');

  // Load saved printer configurations on component mount
  useEffect(() => {
    loadSavedConfigurations();
  }, []);

  const loadSavedConfigurations = () => {
    try {
      const saved = localStorage.getItem('printer-configurations');
      if (saved) {
        const savedConfigs = JSON.parse(saved);
        setPrinters(prev => prev.map(printer => {
          const saved = savedConfigs[printer.id];
          return saved ? { ...printer, ...saved } : printer;
        }));
      }
    } catch (error) {
      console.error('Error loading saved printer configurations:', error);
    }
  };

  const saveConfigurations = (configs: PrinterConfig[]) => {
    try {
      const configMap = configs.reduce((acc, printer) => {
        acc[printer.id] = {
          systemPrinterName: printer.systemPrinterName,
          status: printer.status
        };
        return acc;
      }, {} as Record<string, any>);
      
      localStorage.setItem('printer-configurations', JSON.stringify(configMap));
    } catch (error) {
      console.error('Error saving printer configurations:', error);
    }
  };

  // Scan for system printers
  const scanForPrinters = async () => {
    setIsScanning(true);
    
    try {
      // In a real implementation, this would use Electron's printer API
      // For now, we'll simulate the process and show realistic results
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Simulate finding system printers
      const mockSystemPrinters: SystemPrinter[] = [
        {
          name: 'Microsoft Print to PDF',
          displayName: 'Microsoft Print to PDF',
          status: 'idle',
          isDefault: true
        },
        {
          name: 'OneNote for Windows 10',
          displayName: 'OneNote for Windows 10',
          status: 'idle',
          isDefault: false
        }
      ];
      
      setSystemPrinters(mockSystemPrinters);
      
      // Show warning if no physical printers found
      if (mockSystemPrinters.length === 0) {
        alert('No printers detected. Please install printer drivers and ensure printers are connected.');
      }
      
    } catch (error) {
      console.error('Error scanning for printers:', error);
      alert('Error scanning for printers. Please check your printer connections.');
    } finally {
      setIsScanning(false);
    }
  };

  // Configure a printer with a system printer
  const configurePrinter = (printerId: string, systemPrinterName: string) => {
    setPrinters(prev => {
      const updated = prev.map(printer => 
        printer.id === printerId 
          ? {
              ...printer,
              systemPrinterName,
              status: 'configured' as const
            }
          : printer
      );
      saveConfigurations(updated);
      return updated;
    });
    setSelectedPrinterForConfig(null);
  };

  // Remove printer configuration
  const removePrinterConfiguration = (printerId: string) => {
    setPrinters(prev => {
      const updated = prev.map(printer => 
        printer.id === printerId 
          ? {
              ...printer,
              systemPrinterName: undefined,
              status: 'not_configured' as const,
              lastTest: undefined,
              testResult: undefined
            }
          : printer
      );
      saveConfigurations(updated);
      return updated;
    });
  };

  // Test individual printer
  const testPrinter = async (printerId: string) => {
    const printer = printers.find(p => p.id === printerId);
    if (!printer || !printer.systemPrinterName) {
      alert('Please configure a printer first before testing.');
      return;
    }

    setIsTesting(printerId);
    
    try {
      // In a real implementation, this would send a test print job
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // For now, simulate success if printer is configured
      const success = printer.status === 'configured';
      
      setPrinters(prev => prev.map(p => 
        p.id === printerId 
          ? {
              ...p,
              lastTest: new Date(),
              testResult: success ? 'success' : 'failed'
            }
          : p
      ));
      
      if (!success) {
        alert('Test print failed. Please check your printer connection and drivers.');
      }
      
    } catch (error) {
      console.error('Error testing printer:', error);
      alert('Error testing printer. Please check your printer connection.');
    } finally {
      setIsTesting(null);
    }
  };

  // Test all connected printers
  const testAllPrinters = async () => {
    const connectedPrinters = printers.filter(p => p.status === 'connected');
    
    for (const printer of connectedPrinters) {
      await testPrinter(printer.id);
      // Small delay between tests
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'configured':
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'not_configured':
        return <XCircle className="w-5 h-5 text-gray-400" />;
      case 'error':
        return <AlertCircle className="w-5 h-5 text-red-500" />;
      default:
        return <XCircle className="w-5 h-5 text-gray-400" />;
    }
  };

  const getTestResultIcon = (result?: string) => {
    if (!result) return null;
    
    switch (result) {
      case 'success':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-500" />;
      default:
        return null;
    }
  };

  const getPrinterTypeLabel = (type: string) => {
    switch (type) {
      case 'receipt1':
        return 'Standard Receipt';
      case 'receipt2':
        return 'Audit Receipt';
      case 'order_label':
        return 'Order Labels';
      default:
        return type;
    }
  };

  return (
    <div className="space-y-6">
      {/* Tab Navigation */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab('selector')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'selector'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Printer Selector
          </button>
          <button
            onClick={() => setActiveTab('setup')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'setup'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Advanced Setup
          </button>
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'selector' ? (
        <PrinterSelector />
      ) : (
        <>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-gray-800">Advanced Printer Setup</h2>
              <p className="text-gray-600 mt-1">Configure and test your receipt printers</p>
            </div>
            
            <div className="flex space-x-3">
          <button
            onClick={scanForPrinters}
            disabled={isScanning}
            className="flex items-center space-x-2 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-white px-4 py-2 rounded-lg transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${isScanning ? 'animate-spin' : ''}`} />
            <span>{isScanning ? 'Scanning...' : 'Scan Printers'}</span>
          </button>
          
          <button
            onClick={testAllPrinters}
            disabled={printers.every(p => p.status !== 'connected')}
            className="flex items-center space-x-2 bg-green-500 hover:bg-green-600 disabled:bg-gray-300 text-white px-4 py-2 rounded-lg transition-colors"
          >
            <TestTube className="w-4 h-4" />
            <span>Test All</span>
          </button>
        </div>
      </div>

      {/* System Printers List */}
      {systemPrinters.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">Available System Printers</h3>
          <div className="space-y-2">
            {systemPrinters.map((printer) => (
              <div key={printer.name} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div className="flex items-center space-x-3">
                  <Printer className="w-5 h-5 text-gray-600" />
                  <div>
                    <span className="font-medium text-gray-800">{printer.displayName}</span>
                    {printer.isDefault && (
                      <span className="ml-2 px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full">
                        Default
                      </span>
                    )}
                  </div>
                </div>
                <span className={`text-sm px-2 py-1 rounded-full ${
                  printer.status === 'idle' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                }`}>
                  {printer.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Printer Configuration Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {printers.map((printer) => (
          <div
            key={printer.id}
            className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm hover:shadow-md transition-shadow"
          >
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center space-x-3">
                <Printer className="w-6 h-6 text-gray-600" />
                <div>
                  <h3 className="font-semibold text-gray-800">{printer.name}</h3>
                  <p className="text-sm text-gray-500">{getPrinterTypeLabel(printer.type)}</p>
                </div>
              </div>
              {getStatusIcon(printer.status)}
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Status:</span>
                <span className={`text-sm font-medium capitalize ${
                  printer.status === 'configured' ? 'text-green-600' : 'text-gray-500'
                }`}>
                  {printer.status.replace('_', ' ')}
                </span>
              </div>

              {printer.systemPrinterName && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Printer:</span>
                  <span className="text-sm text-gray-800 font-medium truncate max-w-32" title={printer.systemPrinterName}>
                    {printer.systemPrinterName}
                  </span>
                </div>
              )}

              {printer.lastTest && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Last Test:</span>
                  <div className="flex items-center space-x-2">
                    <span className="text-sm text-gray-500">
                      {printer.lastTest.toLocaleTimeString()}
                    </span>
                    {getTestResultIcon(printer.testResult)}
                  </div>
                </div>
              )}

              {/* Configuration Actions */}
              <div className="space-y-2">
                {printer.status === 'not_configured' ? (
                  <button
                    onClick={() => setSelectedPrinterForConfig(printer.id)}
                    className="w-full flex items-center justify-center space-x-2 bg-blue-500 hover:bg-blue-600 text-white px-3 py-2 rounded-lg transition-colors"
                  >
                    <Settings className="w-4 h-4" />
                    <span>Configure Printer</span>
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => testPrinter(printer.id)}
                      disabled={isTesting === printer.id}
                      className="w-full flex items-center justify-center space-x-2 bg-green-500 hover:bg-green-600 disabled:bg-gray-300 text-white px-3 py-2 rounded-lg transition-colors"
                    >
                      {isTesting === printer.id ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          <span>Testing...</span>
                        </>
                      ) : (
                        <>
                          <TestTube className="w-4 h-4" />
                          <span>Test Print</span>
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => removePrinterConfiguration(printer.id)}
                      className="w-full flex items-center justify-center space-x-2 bg-red-500 hover:bg-red-600 text-white px-3 py-2 rounded-lg transition-colors"
                    >
                      <XCircle className="w-4 h-4" />
                      <span>Remove Configuration</span>
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Printer Selection Modal */}
      {selectedPrinterForConfig && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-800 mb-4">Select System Printer</h3>
            <p className="text-sm text-gray-600 mb-4">
              Choose which system printer to use for {printers.find(p => p.id === selectedPrinterForConfig)?.name}
            </p>
            
            {systemPrinters.length === 0 ? (
              <div className="text-center py-4">
                <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-2" />
                <p className="text-gray-600 mb-4">No system printers detected.</p>
                <p className="text-sm text-gray-500 mb-4">
                  Please install printer drivers and ensure printers are connected, then click "Scan Printers" again.
                </p>
                <button
                  onClick={() => setSelectedPrinterForConfig(null)}
                  className="bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded-lg"
                >
                  Close
                </button>
              </div>
            ) : (
              <div className="space-y-2 mb-4">
                {systemPrinters.map((systemPrinter) => (
                  <button
                    key={systemPrinter.name}
                    onClick={() => configurePrinter(selectedPrinterForConfig, systemPrinter.name)}
                    className="w-full text-left p-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-gray-800">{systemPrinter.displayName}</span>
                      {systemPrinter.isDefault && (
                        <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full">
                          Default
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500 mt-1">Status: {systemPrinter.status}</p>
                  </button>
                ))}
              </div>
            )}
            
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setSelectedPrinterForConfig(null)}
                className="bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded-lg"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Printer Configuration Info */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-blue-800 mb-3">Printer Configuration</h3>
        <div className="space-y-2 text-sm text-blue-700">
          <div className="flex items-center space-x-2">
            <CheckCircle className="w-4 h-4 text-blue-600" />
            <span><strong>Printer 1:</strong> Prints receipt for every transaction</span>
          </div>
          <div className="flex items-center space-x-2">
            <CheckCircle className="w-4 h-4 text-blue-600" />
            <span><strong>Printer 2:</strong> Prints random audit receipts (3 out of every 10 transactions)</span>
          </div>
          <div className="flex items-center space-x-2">
            <CheckCircle className="w-4 h-4 text-blue-600" />
            <span><strong>Printer 3:</strong> Prints order labels (configuration pending)</span>
          </div>
        </div>
      </div>

      {/* Setup Instructions */}
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-yellow-800 mb-3">Setup Instructions</h3>
        <div className="space-y-3 text-sm text-yellow-700">
          <div className="flex items-start space-x-2">
            <span className="font-bold">1.</span>
            <span>Install printer drivers for your receipt printers</span>
          </div>
          <div className="flex items-start space-x-2">
            <span className="font-bold">2.</span>
            <span>Connect your printers to the computer via USB, network, or Bluetooth</span>
          </div>
          <div className="flex items-start space-x-2">
            <span className="font-bold">3.</span>
            <span>Click "Scan Printers" to detect available system printers</span>
          </div>
          <div className="flex items-start space-x-2">
            <span className="font-bold">4.</span>
            <span>Configure each POS printer by selecting a system printer</span>
          </div>
          <div className="flex items-start space-x-2">
            <span className="font-bold">5.</span>
            <span>Test each configured printer to ensure it works properly</span>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-3">Quick Actions</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <button 
            onClick={() => {
              const configuredPrinters = printers.filter(p => p.status === 'configured');
              if (configuredPrinters.length === 0) {
                alert('Please configure at least one printer first.');
                return;
              }
              // In real implementation, this would print a test receipt
              alert('Test receipt would be printed to configured printers.');
            }}
            className="flex items-center justify-center space-x-2 bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 px-4 py-3 rounded-lg transition-colors"
          >
            <Printer className="w-5 h-5" />
            <span>Print Test Receipt</span>
          </button>
          <button 
            onClick={() => {
              const labelPrinter = printers.find(p => p.type === 'order_label' && p.status === 'configured');
              if (!labelPrinter) {
                alert('Please configure the Order Label Printer first.');
                return;
              }
              // In real implementation, this would print a test label
              alert('Test label would be printed to the configured label printer.');
            }}
            className="flex items-center justify-center space-x-2 bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 px-4 py-3 rounded-lg transition-colors"
          >
            <TestTube className="w-5 h-5" />
            <span>Print Test Label</span>
          </button>
          <button 
            onClick={() => {
              // In real implementation, this would show the print queue
              alert('Print queue feature coming soon. This will show failed print jobs and allow retries.');
            }}
            className="flex items-center justify-center space-x-2 bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 px-4 py-3 rounded-lg transition-colors"
          >
            <AlertCircle className="w-5 h-5" />
            <span>View Print Queue</span>
          </button>
        </div>
      </div>
        </>
      )}
    </div>
  );
}
