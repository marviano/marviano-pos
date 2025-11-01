declare global {
  interface Window {
    electronAPI: {
      // POS functionality
      printReceipt: (data: any) => Promise<any>;
      printLabel: (data: any) => Promise<any>;
      openCashDrawer: () => Promise<any>;
      playSound: (soundType: string) => Promise<any>;
      // System printers
      listPrinters: () => Promise<{ success: boolean; printers: Array<{ name: string; displayName?: string; status?: string; isDefault?: boolean }> }>;
      
      // Window controls
      closeWindow: () => Promise<any>;
      minimizeWindow: () => Promise<any>;
      maximizeWindow: () => Promise<any>;
      navigateTo: (path: string) => Promise<any>;
      
      // Authentication events
      notifyLoginSuccess: () => Promise<any>;
      notifyLogout: () => Promise<any>;
      
      // Menu events
      onMenuNewOrder: (callback: () => void) => void;
      
      // Dual-display communication
      updateCustomerDisplay: (data: any) => Promise<any>;
      updateCustomerSlideshow: (data: any) => Promise<any>;
      getCustomerDisplayStatus: () => Promise<any>;
      createCustomerDisplay: () => Promise<any>;
      
      // Customer display event listeners
      onOrderUpdate?: (callback: (data: any) => void) => void;
      onSlideshowUpdate?: (callback: (data: any) => void) => void;
      
      // Offline/local DB operations
      localDbUpsertCategories?: (rows: { category2_name: string; updated_at?: number }[]) => Promise<{ success: boolean }>;
      localDbGetCategories?: () => Promise<{ category2_name: string; updated_at: number }[]>;
      localDbUpsertProducts?: (rows: any[]) => Promise<{ success: boolean }>;
      localDbGetProductsByJenis?: (jenis: string) => Promise<any[]>;
      localDbGetProductsByCategory2?: (category2Name: string) => Promise<any[]>;
      localDbGetAllProducts?: () => Promise<any[]>;
      localDbUpdateSyncStatus?: (key: string, status: string) => Promise<{ success: boolean }>;
      localDbGetSyncStatus?: (key: string) => Promise<{ key: string; last_sync: number; status: string } | null>;
      
      // Offline transaction queue
      localDbQueueOfflineTransaction?: (transactionData: any) => Promise<{ success: boolean; offlineTransactionId?: number; error?: string }>;
      localDbGetPendingTransactions?: () => Promise<any[]>;
      localDbMarkTransactionSynced?: (offlineTransactionId: number) => Promise<{ success: boolean }>;
      localDbMarkTransactionFailed?: (offlineTransactionId: number) => Promise<{ success: boolean }>;
      
      // Transaction operations
      localDbGetTransactions?: (businessId?: number, limit?: number) => Promise<any[]>;
      localDbUpsertTransactions?: (rows: any[]) => Promise<any>;
      localDbGetTransactionItems?: (transactionId?: number) => Promise<any[]>;
      localDbUpsertTransactionItems?: (rows: any[]) => Promise<any>;
      localDbGetUnsyncedTransactions?: (businessId?: number) => Promise<any[]>;
      localDbMarkTransactionsSynced?: (transactionIds: string[]) => Promise<any>;
      localDbArchiveTransactions?: (businessId: number) => Promise<number>;
      localDbDeleteTransactions?: (businessId: number) => Promise<number>;
      localDbDeleteTransactionItems?: (businessId: number) => Promise<any>;
      
      // Comprehensive POS table operations
      // Users
      localDbUpsertUsers?: (rows: any[]) => Promise<{ success: boolean }>;
      localDbGetUsers?: () => Promise<any[]>;
      
      // Businesses
      localDbUpsertBusinesses?: (rows: any[]) => Promise<{ success: boolean }>;
      localDbGetBusinesses?: () => Promise<any[]>;
      
      // Ingredients
      localDbUpsertIngredients?: (rows: any[]) => Promise<{ success: boolean }>;
      localDbGetIngredients?: (businessId?: number) => Promise<any[]>;
      
      // COGS
      localDbUpsertCogs?: (rows: any[]) => Promise<{ success: boolean }>;
      localDbGetCogs?: () => Promise<any[]>;
      
      // Contacts
      localDbUpsertContacts?: (rows: any[]) => Promise<{ success: boolean }>;
      localDbGetContacts?: (teamId?: number) => Promise<any[]>;
      
      // Teams
      localDbUpsertTeams?: (rows: any[]) => Promise<{ success: boolean }>;
      localDbGetTeams?: () => Promise<any[]>;
      
      // Supporting tables
      localDbUpsertSource?: (rows: any[]) => Promise<{ success: boolean }>;
      localDbGetSource?: () => Promise<any[]>;
      localDbUpsertPekerjaan?: (rows: any[]) => Promise<{ success: boolean }>;
      localDbGetPekerjaan?: () => Promise<any[]>;
      
      // Banks
      localDbUpsertBanks?: (rows: any[]) => Promise<any>;
      localDbGetBanks?: () => Promise<any[]>;
      
      // Payment Methods
      localDbUpsertPaymentMethods?: (rows: any[]) => Promise<any>;
      localDbGetPaymentMethods?: () => Promise<any[]>;
      
      // Organizations
      localDbUpsertOrganizations?: (rows: any[]) => Promise<any>;
      localDbGetOrganizations?: () => Promise<any[]>;
      
      // Management Groups
      localDbUpsertManagementGroups?: (rows: any[]) => Promise<any>;
      localDbGetManagementGroups?: () => Promise<any[]>;
      
      // Categories
      localDbUpsertCategory1?: (rows: any[]) => Promise<any>;
      localDbGetCategory1?: () => Promise<any[]>;
      localDbUpsertCategory2?: (rows: any[]) => Promise<any>;
      localDbGetCategory2?: () => Promise<any[]>;
      
      // CL Accounts
      localDbUpsertClAccounts?: (rows: any[]) => Promise<any>;
      localDbGetClAccounts?: () => Promise<any[]>;
      
      // Customization
      localDbUpsertCustomizationTypes?: (rows: any[]) => Promise<any>;
      localDbUpsertCustomizationOptions?: (rows: any[]) => Promise<any>;
      localDbUpsertProductCustomizations?: (rows: any[]) => Promise<any>;
      localDbGetProductCustomizations?: (productId: number) => Promise<any[]>;
      
      // Omset
      localDbUpsertOmset?: (rows: any[]) => Promise<any>;
      localDbGetOmset?: (businessId?: number, startDate?: string, endDate?: string) => Promise<any[]>;
      
      // Printer configurations
      localDbSavePrinterConfig?: (printerType: string, systemPrinterName: string) => Promise<{ success: boolean; error?: string }>;
      localDbGetPrinterConfigs?: () => Promise<any[]>;
      
      // Printer Management (new multi-printer system)
      generateNumericUuid?: (businessId: number) => Promise<{ success: boolean; uuid?: string; error?: string }>;
      getPrinterCounter?: (printerType: string, businessId: number, increment: boolean) => Promise<{ success: boolean; counter: number; error?: string }>;
      getPrinter2Mode?: () => Promise<{ success: boolean; mode: 'auto' | 'manual' }>;
      setPrinter2Mode?: (mode: 'auto' | 'manual') => Promise<{ success: boolean }>;
      getPrinter2AutomationSelections?: (businessId: number) => Promise<{ success: boolean; cycleNumber: number; selections: number[] }>;
      savePrinter2AutomationSelections?: (businessId: number, cycleNumber: number, selections: number[]) => Promise<{ success: boolean }>;
      generateRandomSelections?: (cycleNumber: number) => Promise<{ success: boolean; selections: number[] }>;
      logPrinter2Print?: (transactionId: string, printer2ReceiptNumber: number, mode: 'auto' | 'manual', cycleNumber?: number) => Promise<{ success: boolean }>;
      getPrinter2AuditLog?: (fromDate?: string, toDate?: string, limit?: number) => Promise<{ success: boolean; entries: any[] }>;
      logPrinter1Print?: (transactionId: string, printer1ReceiptNumber: number) => Promise<{ success: boolean }>;
      getPrinter1AuditLog?: (fromDate?: string, toDate?: string, limit?: number) => Promise<{ success: boolean; entries: any[] }>;
    };
  }
}

export {};
