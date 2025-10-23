'use client';

import { useState } from 'react';
import { offlineSyncService } from '@/lib/offlineSync';
import { Wifi, WifiOff, Database, RefreshCw, Bug } from 'lucide-react';

export default function ConnectionDebugPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [debugInfo, setDebugInfo] = useState<any>(null);
  const [testing, setTesting] = useState(false);

  const runDebugTest = async () => {
    setTesting(true);
    try {
      console.log('🧪 [DEBUG PANEL] Starting comprehensive debug test...');
      
      // Get current status
      const currentStatus = offlineSyncService.getDetailedStatus();
      
      // Test all endpoints
      const endpointResults = await offlineSyncService.testEndpoints();
      
      // Force a connection check
      await offlineSyncService.forceConnectionCheck();
      
      // Get updated status
      const updatedStatus = offlineSyncService.getDetailedStatus();
      
      setDebugInfo({
        currentStatus,
        endpointResults,
        updatedStatus,
        timestamp: new Date().toISOString(),
      });
      
      console.log('🧪 [DEBUG PANEL] Debug test completed:', {
        currentStatus,
        endpointResults,
        updatedStatus,
      });
      
    } catch (error) {
      console.error('🧪 [DEBUG PANEL] Debug test failed:', error);
      setDebugInfo({
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      });
    } finally {
      setTesting(false);
    }
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 right-4 bg-purple-500 hover:bg-purple-600 text-white p-2 rounded-full shadow-lg z-50"
        title="Open Connection Debug Panel"
      >
        <Bug className="w-4 h-4" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 p-4 w-96 max-h-96 overflow-y-auto z-50">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <Bug className="w-4 h-4" />
          Connection Debug
        </h3>
        <button
          onClick={() => setIsOpen(false)}
          className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
        >
          ✕
        </button>
      </div>

      <div className="space-y-3">
        <button
          onClick={runDebugTest}
          disabled={testing}
          className={`w-full px-3 py-2 text-xs rounded-lg transition-colors ${
            testing
              ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
              : 'bg-blue-500 text-white hover:bg-blue-600'
          }`}
        >
          {testing ? (
            <span className="flex items-center justify-center gap-2">
              <RefreshCw className="w-3 h-3 animate-spin" />
              Testing...
            </span>
          ) : (
            'Run Debug Test'
          )}
        </button>

        {debugInfo && (
          <div className="space-y-2">
            <div className="text-xs font-medium text-gray-700 dark:text-gray-300">
              Last Test: {new Date(debugInfo.timestamp).toLocaleTimeString()}
            </div>

            {debugInfo.error ? (
              <div className="text-xs text-red-600 bg-red-50 p-2 rounded border border-red-200">
                Error: {debugInfo.error}
              </div>
            ) : (
              <>
                {/* Current Status */}
                <div className="bg-gray-50 dark:bg-gray-700 p-2 rounded text-xs">
                  <div className="font-medium mb-1">Current Status:</div>
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1">
                      {debugInfo.currentStatus.internetConnected ? (
                        <Wifi className="w-3 h-3 text-green-500" />
                      ) : (
                        <WifiOff className="w-3 h-3 text-red-500" />
                      )}
                      <span>Internet</span>
                    </div>
                    <div className="flex items-center gap-1">
                      {debugInfo.currentStatus.databaseConnected ? (
                        <Database className="w-3 h-3 text-green-500" />
                      ) : (
                        <Database className="w-3 h-3 text-red-500" />
                      )}
                      <span>Database</span>
                    </div>
                  </div>
                </div>

                {/* Internet Endpoints */}
                <div className="bg-gray-50 dark:bg-gray-700 p-2 rounded text-xs">
                  <div className="font-medium mb-1">Internet Endpoints:</div>
                  {debugInfo.endpointResults.internet.map((result: any, index: number) => (
                    <div key={index} className="flex items-center gap-2">
                      {result.success ? (
                        <Wifi className="w-3 h-3 text-green-500" />
                      ) : (
                        <WifiOff className="w-3 h-3 text-red-500" />
                      )}
                      <span className="truncate">{result.endpoint}</span>
                      {result.error && (
                        <span className="text-red-500 text-xs">({result.error})</span>
                      )}
                    </div>
                  ))}
                </div>

                {/* Database Status */}
                <div className="bg-gray-50 dark:bg-gray-700 p-2 rounded text-xs">
                  <div className="font-medium mb-1">Database:</div>
                  <div className="flex items-center gap-2">
                    {debugInfo.endpointResults.database.success ? (
                      <Database className="w-3 h-3 text-green-500" />
                    ) : (
                      <Database className="w-3 h-3 text-red-500" />
                    )}
                    <span>
                      {debugInfo.endpointResults.database.success 
                        ? 'Connected' 
                        : debugInfo.endpointResults.database.error || 'Failed'
                      }
                    </span>
                  </div>
                </div>

                {/* Connection Details */}
                {debugInfo.currentStatus.connectionDetails && (
                  <div className="bg-gray-50 dark:bg-gray-700 p-2 rounded text-xs">
                    <div className="font-medium mb-1">Details:</div>
                    <div className="space-y-1">
                      <div>Internet: {debugInfo.currentStatus.connectionDetails.internetCheck}</div>
                      <div>Database: {debugInfo.currentStatus.connectionDetails.databaseCheck}</div>
                      {debugInfo.currentStatus.connectionDetails.lastCheckTime && (
                        <div>
                          Last Check: {new Date(debugInfo.currentStatus.connectionDetails.lastCheckTime).toLocaleTimeString()}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

