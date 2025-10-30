import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // POS functionality
  printReceipt: (data: any) => ipcRenderer.invoke('print-receipt', data),
  openCashDrawer: () => ipcRenderer.invoke('open-cash-drawer'),
  playSound: (soundType: string) => ipcRenderer.invoke('play-sound', soundType),
  // System printers
  listPrinters: () => ipcRenderer.invoke('list-printers'),
  
  // Window controls
  closeWindow: () => ipcRenderer.invoke('close-window'),
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  maximizeWindow: () => ipcRenderer.invoke('maximize-window'),
  navigateTo: (path: string) => ipcRenderer.invoke('navigate-to', path),
  
  // Authentication events
  notifyLoginSuccess: () => ipcRenderer.invoke('login-success'),
  notifyLogout: () => ipcRenderer.invoke('logout'),
  
  // Menu events
  onMenuNewOrder: (callback: () => void) => {
    ipcRenderer.on('menu-new-order', callback);
  },
  
  // Dual-display communication
  updateCustomerDisplay: (data: any) => ipcRenderer.invoke('update-customer-display', data),
  updateCustomerSlideshow: (data: any) => ipcRenderer.invoke('update-customer-slideshow', data),
  getCustomerDisplayStatus: () => ipcRenderer.invoke('get-customer-display-status'),
  createCustomerDisplay: () => ipcRenderer.invoke('create-customer-display'),
  
  // Offline/local DB primitives
  localDbUpsertCategories: (rows: { jenis: string; updated_at?: number }[]) => ipcRenderer.invoke('localdb-upsert-categories', rows),
  localDbGetCategories: () => ipcRenderer.invoke('localdb-get-categories'),
  localDbUpsertProducts: (rows: any[]) => ipcRenderer.invoke('localdb-upsert-products', rows),
  localDbGetProductsByJenis: (jenis: string) => ipcRenderer.invoke('localdb-get-products-by-jenis', jenis),
  localDbGetAllProducts: () => ipcRenderer.invoke('localdb-get-all-products'),
  localDbUpdateSyncStatus: (key: string, status: string) => ipcRenderer.invoke('localdb-update-sync-status', key, status),
  localDbGetSyncStatus: (key: string) => ipcRenderer.invoke('localdb-get-sync-status', key),
  
  // Comprehensive POS table operations
  // Users
  localDbUpsertUsers: (rows: any[]) => ipcRenderer.invoke('localdb-upsert-users', rows),
  localDbGetUsers: () => ipcRenderer.invoke('localdb-get-users'),
  
  // Businesses
  localDbUpsertBusinesses: (rows: any[]) => ipcRenderer.invoke('localdb-upsert-businesses', rows),
  localDbGetBusinesses: () => ipcRenderer.invoke('localdb-get-businesses'),
  
  // Ingredients
  localDbUpsertIngredients: (rows: any[]) => ipcRenderer.invoke('localdb-upsert-ingredients', rows),
  localDbGetIngredients: (businessId?: number) => ipcRenderer.invoke('localdb-get-ingredients', businessId),
  
  // COGS
  localDbUpsertCogs: (rows: any[]) => ipcRenderer.invoke('localdb-upsert-cogs', rows),
  localDbGetCogs: () => ipcRenderer.invoke('localdb-get-cogs'),
  
  // Contacts
  localDbUpsertContacts: (rows: any[]) => ipcRenderer.invoke('localdb-upsert-contacts', rows),
  localDbGetContacts: (teamId?: number) => ipcRenderer.invoke('localdb-get-contacts', teamId),
  
  // Teams
  localDbUpsertTeams: (rows: any[]) => ipcRenderer.invoke('localdb-upsert-teams', rows),
  localDbGetTeams: () => ipcRenderer.invoke('localdb-get-teams'),
  
  // Supporting tables
  localDbUpsertSource: (rows: any[]) => ipcRenderer.invoke('localdb-upsert-source', rows),
  localDbGetSource: () => ipcRenderer.invoke('localdb-get-source'),
  localDbUpsertPekerjaan: (rows: any[]) => ipcRenderer.invoke('localdb-upsert-pekerjaan', rows),
  localDbGetPekerjaan: () => ipcRenderer.invoke('localdb-get-pekerjaan'),
  
  // Printer configurations
  localDbSavePrinterConfig: (printerType: string, systemPrinterName: string) => ipcRenderer.invoke('localdb-save-printer-config', printerType, systemPrinterName),
  localDbGetPrinterConfigs: () => ipcRenderer.invoke('localdb-get-printer-configs'),
  
  // Offline transaction queue
  localDbQueueOfflineTransaction: (transactionData: any) => ipcRenderer.invoke('localdb-queue-offline-transaction', transactionData),
  localDbGetPendingTransactions: () => ipcRenderer.invoke('localdb-get-pending-transactions'),
  localDbMarkTransactionSynced: (offlineTransactionId: number) => ipcRenderer.invoke('localdb-mark-transaction-synced', offlineTransactionId),
  localDbMarkTransactionFailed: (offlineTransactionId: number) => ipcRenderer.invoke('localdb-mark-transaction-failed', offlineTransactionId),
  
  // Add missing method
  localDbGetProductsByCategory2: (category2Name: string) => ipcRenderer.invoke('localdb-get-products-by-category2', category2Name),
  
  // Customization handlers
  localDbUpsertCustomizationTypes: (rows: any[]) => ipcRenderer.invoke('localdb-upsert-customization-types', rows),
  localDbUpsertCustomizationOptions: (rows: any[]) => ipcRenderer.invoke('localdb-upsert-customization-options', rows),
  localDbUpsertProductCustomizations: (rows: any[]) => ipcRenderer.invoke('localdb-upsert-product-customizations', rows),
  localDbGetProductCustomizations: (productId: number) => ipcRenderer.invoke('localdb-get-product-customizations', productId),
  
  // New enhanced offline support tables
  // Transactions
  localDbUpsertTransactions: (rows: any[]) => ipcRenderer.invoke('localdb-upsert-transactions', rows),
  localDbGetTransactions: (businessId?: number, limit?: number) => ipcRenderer.invoke('localdb-get-transactions', businessId, limit),
  localDbArchiveTransactions: (businessId: number) => ipcRenderer.invoke('localdb-archive-transactions', businessId),
  localDbDeleteTransactions: (businessId: number) => ipcRenderer.invoke('localdb-delete-transactions', businessId),
  localDbDeleteTransactionItems: (businessId: number) => ipcRenderer.invoke('localdb-delete-transaction-items', businessId),
  localDbGetUnsyncedTransactions: (businessId?: number) => ipcRenderer.invoke('localdb-get-unsynced-transactions', businessId),
  localDbMarkTransactionsSynced: (transactionIds: string[]) => ipcRenderer.invoke('localdb-mark-transactions-synced', transactionIds),
  localDbResetTransactionSync: (transactionId: string) => ipcRenderer.invoke('localdb-reset-transaction-sync', transactionId),
  
  // Transaction Items
  localDbUpsertTransactionItems: (rows: any[]) => ipcRenderer.invoke('localdb-upsert-transaction-items', rows),
  localDbGetTransactionItems: (transactionId?: number) => ipcRenderer.invoke('localdb-get-transaction-items', transactionId),
  
  // Payment Methods
  localDbUpsertPaymentMethods: (rows: any[]) => ipcRenderer.invoke('localdb-upsert-payment-methods', rows),
  localDbGetPaymentMethods: () => ipcRenderer.invoke('localdb-get-payment-methods'),
  
  // Banks
  localDbUpsertBanks: (rows: any[]) => ipcRenderer.invoke('localdb-upsert-banks', rows),
  localDbGetBanks: () => ipcRenderer.invoke('localdb-get-banks'),
  
  // Organizations
  localDbUpsertOrganizations: (rows: any[]) => ipcRenderer.invoke('localdb-upsert-organizations', rows),
  localDbGetOrganizations: () => ipcRenderer.invoke('localdb-get-organizations'),
  
  // Management Groups
  localDbUpsertManagementGroups: (rows: any[]) => ipcRenderer.invoke('localdb-upsert-management-groups', rows),
  localDbGetManagementGroups: () => ipcRenderer.invoke('localdb-get-management-groups'),
  
  // Category1
  localDbUpsertCategory1: (rows: any[]) => ipcRenderer.invoke('localdb-upsert-category1', rows),
  localDbGetCategory1: () => ipcRenderer.invoke('localdb-get-category1'),
  
  // Category2
  localDbUpsertCategory2: (rows: any[]) => ipcRenderer.invoke('localdb-upsert-category2', rows),
  localDbGetCategory2: (businessId?: number) => ipcRenderer.invoke('localdb-get-category2', businessId),
  
  // CL Accounts
  localDbUpsertClAccounts: (rows: any[]) => ipcRenderer.invoke('localdb-upsert-cl-accounts', rows),
  localDbGetClAccounts: () => ipcRenderer.invoke('localdb-get-cl-accounts'),
  
  // Omset
  localDbUpsertOmset: (rows: any[]) => ipcRenderer.invoke('localdb-upsert-omset', rows),
  localDbGetOmset: (businessId?: number, startDate?: string, endDate?: string) => ipcRenderer.invoke('localdb-get-omset', businessId, startDate, endDate),
  
  // Printer Management (multi-printer system)
  generateNumericUuid: (businessId: number) => ipcRenderer.invoke('generate-numeric-uuid', businessId),
  getPrinterCounter: (printerType: string, businessId: number, increment: boolean) => ipcRenderer.invoke('get-printer-counter', printerType, businessId, increment),
  getPrinter2Mode: () => ipcRenderer.invoke('get-printer2-mode'),
  setPrinter2Mode: (mode: 'auto' | 'manual') => ipcRenderer.invoke('set-printer2-mode', mode),
  getPrinter2AutomationSelections: (businessId: number) => ipcRenderer.invoke('get-printer2-automation-selections', businessId),
  savePrinter2AutomationSelections: (businessId: number, cycleNumber: number, selections: number[]) => ipcRenderer.invoke('save-printer2-automation-selections', businessId, cycleNumber, selections),
  generateRandomSelections: (cycleNumber: number) => ipcRenderer.invoke('generate-random-selections', cycleNumber),
  logPrinter2Print: (transactionId: string, printer2ReceiptNumber: number, mode: 'auto' | 'manual', cycleNumber?: number) => ipcRenderer.invoke('log-printer2-print', transactionId, printer2ReceiptNumber, mode, cycleNumber),
  getPrinter2AuditLog: (fromDate?: string, toDate?: string, limit?: number) => ipcRenderer.invoke('get-printer2-audit-log', fromDate, toDate, limit),
  logPrinter1Print: (transactionId: string, printer1ReceiptNumber: number) => ipcRenderer.invoke('log-printer1-print', transactionId, printer1ReceiptNumber),
  getPrinter1AuditLog: (fromDate?: string, toDate?: string, limit?: number) => ipcRenderer.invoke('get-printer1-audit-log', fromDate, toDate, limit),

  // Printer audit sync helpers
  localDbGetUnsyncedPrinterAudits: () => ipcRenderer.invoke('localdb-get-unsynced-printer-audits'),
  localDbMarkPrinterAuditsSynced: (ids: { p1Ids: number[]; p2Ids: number[] }) => ipcRenderer.invoke('localdb-mark-printer-audits-synced', ids),
  
  // Customer display event listeners
  onOrderUpdate: (callback: (data: any) => void) => {
    ipcRenderer.on('order-update', (event, data) => callback(data));
  },
  onSlideshowUpdate: (callback: (data: any) => void) => {
    ipcRenderer.on('slideshow-update', (event, data) => callback(data));
  },
});

