/**
 * Electron Restart Helper
 * Provides instructions for restarting Electron after preload changes
 */

type UnknownRecord = Record<string, unknown>;

export function checkElectronAPI() {
  const api = typeof window !== 'undefined' ? (window as { electronAPI?: UnknownRecord }).electronAPI : undefined;
  
  if (!api) {
    console.error('❌ Electron API not available - not running in Electron');
    return false;
  }

  const requiredMethods = [
    'localDbGetAllProducts',
    'localDbGetCategories', 
    'localDbGetUnsyncedTransactions',
    'localDbMarkTransactionsSynced',
    'localDbMarkTransactionFailed',
    'localDbGetProductsByCategory2'
  ];

  const missingMethods = requiredMethods.filter(method => !api[method]);
  
  if (missingMethods.length > 0) {
    console.warn('⚠️ Missing Electron API methods:', missingMethods);
    console.warn('🔄 Please restart the Electron app to load updated preload script');
    return false;
  }

  console.log('✅ All required Electron API methods available');
  return true;
}

export interface RestartInstructions {
  title: string;
  message: string;
  steps: string[];
}

export function getRestartInstructions(): RestartInstructions {
  return {
    title: 'Electron Restart Required',
    message: 'The preload script has been updated. Please restart the Electron app to load the new methods.',
    steps: [
      '1. Close the current Electron app',
      '2. Run the build command again (npm run build or similar)',
      '3. Start the Electron app again',
      '4. The offline functionality should now work properly'
    ]
  } as const;
}
