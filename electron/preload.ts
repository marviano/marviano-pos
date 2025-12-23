import { contextBridge, ipcRenderer } from 'electron';

type UnknownRecord = Record<string, unknown>;

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // POS functionality
  printReceipt: (data: UnknownRecord) => ipcRenderer.invoke('print-receipt', data),
  printLabel: (data: UnknownRecord) => ipcRenderer.invoke('print-label', data),
  printLabelsBatch: (data: { labels: UnknownRecord[]; printerName?: string; printerType?: string }) => ipcRenderer.invoke('print-labels-batch', data),
  openCashDrawer: () => ipcRenderer.invoke('open-cash-drawer'),
  playSound: (soundType: string) => ipcRenderer.invoke('play-sound', soundType),
  // System printers
  listPrinters: () => ipcRenderer.invoke('list-printers'),

  // Window controls
  closeWindow: () => ipcRenderer.invoke('close-window'),
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  maximizeWindow: () => ipcRenderer.invoke('maximize-window'),
  navigateTo: (path: string) => ipcRenderer.invoke('navigate-to', path),
  focusWindow: () => ipcRenderer.invoke('focus-window'),
  openProductionDisplay: (displayType: 'kitchen' | 'barista') => ipcRenderer.invoke('open-production-display', displayType),

  // Authentication events
  notifyLoginSuccess: () => ipcRenderer.invoke('login-success'),
  notifyLogout: () => ipcRenderer.invoke('logout'),

  // Menu events
  onMenuNewOrder: (callback: () => void) => {
    ipcRenderer.on('menu-new-order', callback);
  },

  // Dual-display communication
  updateCustomerDisplay: (data: UnknownRecord) => ipcRenderer.invoke('update-customer-display', data),
  updateCustomerSlideshow: (data: UnknownRecord) => ipcRenderer.invoke('update-customer-slideshow', data),
  getCustomerDisplayStatus: () => ipcRenderer.invoke('get-customer-display-status'),
  createCustomerDisplay: () => ipcRenderer.invoke('create-customer-display'),

  // Offline/local DB primitives
  localDbUpsertCategories: (rows: { jenis: string; updated_at?: number }[]) => ipcRenderer.invoke('localdb-upsert-categories', rows),
  localDbGetCategories: () => ipcRenderer.invoke('localdb-get-categories'),
  localDbUpsertProducts: (rows: UnknownRecord[]) => ipcRenderer.invoke('localdb-upsert-products', rows),
  localDbGetProductsByJenis: (jenis: string) => ipcRenderer.invoke('localdb-get-products-by-jenis', jenis),
  localDbGetAllProducts: () => ipcRenderer.invoke('localdb-get-all-products'),
  localDbUpdateSyncStatus: (key: string, status: string) => ipcRenderer.invoke('localdb-update-sync-status', key, status),
  localDbGetSyncStatus: (key: string) => ipcRenderer.invoke('localdb-get-sync-status', key),

  // Comprehensive POS table operations
  // Users
  localDbUpsertUsers: (rows: UnknownRecord[]) => ipcRenderer.invoke('localdb-upsert-users', rows),
  localDbGetUsers: () => ipcRenderer.invoke('localdb-get-users'),

  // Businesses
  localDbUpsertBusinesses: (rows: UnknownRecord[]) => ipcRenderer.invoke('localdb-upsert-businesses', rows),
  localDbGetBusinesses: () => ipcRenderer.invoke('localdb-get-businesses'),

  // Ingredients
  localDbUpsertIngredients: (rows: UnknownRecord[]) => ipcRenderer.invoke('localdb-upsert-ingredients', rows),
  localDbGetIngredients: (businessId?: number) => ipcRenderer.invoke('localdb-get-ingredients', businessId),

  // COGS
  localDbUpsertCogs: (rows: UnknownRecord[]) => ipcRenderer.invoke('localdb-upsert-cogs', rows),
  localDbGetCogs: () => ipcRenderer.invoke('localdb-get-cogs'),

  // Contacts
  localDbUpsertContacts: (rows: UnknownRecord[]) => ipcRenderer.invoke('localdb-upsert-contacts', rows),
  localDbGetContacts: (teamId?: number) => ipcRenderer.invoke('localdb-get-contacts', teamId),

  // Teams
  localDbUpsertTeams: (rows: UnknownRecord[]) => ipcRenderer.invoke('localdb-upsert-teams', rows),
  localDbGetTeams: () => ipcRenderer.invoke('localdb-get-teams'),

  // Roles & Permissions
  localDbUpsertRoles: (rows: UnknownRecord[]) => ipcRenderer.invoke('localdb-upsert-roles', rows),
  localDbGetRoles: () => ipcRenderer.invoke('localdb-get-roles'),
  localDbUpsertPermissions: (rows: UnknownRecord[]) => ipcRenderer.invoke('localdb-upsert-permissions', rows),
  localDbGetPermissions: () => ipcRenderer.invoke('localdb-get-permissions'),
  localDbUpsertRolePermissions: (rows: UnknownRecord[]) => ipcRenderer.invoke('localdb-upsert-role-permissions', rows),
  localDbGetRolePermissions: (roleId: number) => ipcRenderer.invoke('localdb-get-role-permissions', roleId),
  localDbGetUserAuth: (email: string) => ipcRenderer.invoke('localdb-get-user-auth', email),
  checkOfflineDbExists: () => ipcRenderer.invoke('localdb-check-exists'),

  // Supporting tables
  localDbUpsertSource: (rows: UnknownRecord[]) => ipcRenderer.invoke('localdb-upsert-source', rows),
  localDbGetSource: () => ipcRenderer.invoke('localdb-get-source'),
  localDbUpsertPekerjaan: (rows: UnknownRecord[]) => ipcRenderer.invoke('localdb-upsert-pekerjaan', rows),
  localDbGetPekerjaan: () => ipcRenderer.invoke('localdb-get-pekerjaan'),

  // Printer configurations
  localDbSavePrinterConfig: (printerType: string, systemPrinterName: string, extraSettings?: UnknownRecord) =>
    ipcRenderer.invoke('localdb-save-printer-config', printerType, systemPrinterName, extraSettings),
  localDbGetPrinterConfigs: () => ipcRenderer.invoke('localdb-get-printer-configs'),

  // Transaction sync status (using transactions table directly)
  localDbMarkTransactionFailed: (transactionId: string) => ipcRenderer.invoke('localdb-mark-transaction-failed', transactionId),
  localDbQueueOfflineRefund: (refundData: UnknownRecord) => ipcRenderer.invoke('localdb-queue-offline-refund', refundData),
  localDbGetPendingRefunds: () => ipcRenderer.invoke('localdb-get-pending-refunds'),
  localDbMarkRefundSynced: (offlineRefundId: number) => ipcRenderer.invoke('localdb-mark-refund-synced', offlineRefundId),
  localDbMarkRefundFailed: (offlineRefundId: number) => ipcRenderer.invoke('localdb-mark-refund-failed', offlineRefundId),

  // Add missing method
  localDbGetProductsByCategory2: (category2Name: string) => ipcRenderer.invoke('localdb-get-products-by-category2', category2Name),

  // Customization handlers
  localDbUpsertCustomizationTypes: (rows: UnknownRecord[]) => ipcRenderer.invoke('localdb-upsert-customization-types', rows),
  localDbUpsertCustomizationOptions: (rows: UnknownRecord[]) => ipcRenderer.invoke('localdb-upsert-customization-options', rows),
  localDbUpsertProductCustomizations: (rows: UnknownRecord[]) => ipcRenderer.invoke('localdb-upsert-product-customizations', rows),
  localDbGetProductCustomizations: (productId: number) => ipcRenderer.invoke('localdb-get-product-customizations', productId),

  // Bundle handlers
  localDbGetBundleItems: (productId: number) => ipcRenderer.invoke('localdb-get-bundle-items', productId),
  localDbUpsertBundleItems: (rows: UnknownRecord[]) => ipcRenderer.invoke('localdb-upsert-bundle-items', rows),
  localDbDebugBundleItems: () => ipcRenderer.invoke('localdb-debug-bundle-items'),

  // New enhanced offline support tables
  // Transactions
  localDbUpsertTransactions: (rows: UnknownRecord[]) => ipcRenderer.invoke('localdb-upsert-transactions', rows),
  localDbGetTransactions: (businessId?: number, limit?: number) => ipcRenderer.invoke('localdb-get-transactions', businessId, limit),
  localDbArchiveTransactions: (payload: { businessId: number; from?: string | null; to?: string | null }) =>
    ipcRenderer.invoke('localdb-archive-transactions', payload),
  localDbDeleteTransactions: (payload: { businessId: number; from?: string | null; to?: string | null }) =>
    ipcRenderer.invoke('localdb-delete-transactions', payload),
  localDbDeleteTransactionItems: (payload: { businessId: number; from?: string | null; to?: string | null }) =>
    ipcRenderer.invoke('localdb-delete-transaction-items', payload),
  localDbGetUnsyncedTransactions: (businessId?: number) => ipcRenderer.invoke('localdb-get-unsynced-transactions', businessId),
  localDbDeleteUnsyncedTransactions: (businessId?: number) => ipcRenderer.invoke('localdb-delete-unsynced-transactions', businessId),
  localDbMarkTransactionsSynced: (transactionIds: string[]) => ipcRenderer.invoke('localdb-mark-transactions-synced', transactionIds),
  localDbResetTransactionSync: (transactionId: string) => ipcRenderer.invoke('localdb-reset-transaction-sync', transactionId),

  // Transaction Items
  localDbUpsertTransactionItems: (rows: UnknownRecord[]) => ipcRenderer.invoke('localdb-upsert-transaction-items', rows),
  localDbGetTransactionItems: (transactionId?: number | string) => ipcRenderer.invoke('localdb-get-transaction-items', transactionId),
  localDbGetTransactionItemCustomizationsNormalized: (transactionId: string) => ipcRenderer.invoke('localdb-get-transaction-item-customizations-normalized', transactionId),
  localDbUpsertTransactionItemCustomizations: (rows: UnknownRecord[]) => ipcRenderer.invoke('localdb-upsert-transaction-item-customizations', rows),
  localDbUpsertTransactionItemCustomizationOptions: (rows: UnknownRecord[]) => ipcRenderer.invoke('localdb-upsert-transaction-item-customization-options', rows),
  localDbGetTransactionRefunds: (transactionUuid: string) => ipcRenderer.invoke('localdb-get-transaction-refunds', transactionUuid),
  localDbUpsertTransactionRefunds: (rows: UnknownRecord[]) => ipcRenderer.invoke('localdb-upsert-transaction-refunds', rows),
  localDbApplyTransactionRefund: (payload: UnknownRecord) => ipcRenderer.invoke('localdb-apply-transaction-refund', payload),

  // Payment Methods
  localDbUpsertPaymentMethods: (rows: UnknownRecord[]) => ipcRenderer.invoke('localdb-upsert-payment-methods', rows),
  localDbGetPaymentMethods: () => ipcRenderer.invoke('localdb-get-payment-methods'),

  // Banks
  localDbUpsertBanks: (rows: UnknownRecord[]) => ipcRenderer.invoke('localdb-upsert-banks', rows),
  localDbGetBanks: () => ipcRenderer.invoke('localdb-get-banks'),

  // Organizations
  localDbUpsertOrganizations: (rows: UnknownRecord[]) => ipcRenderer.invoke('localdb-upsert-organizations', rows),
  localDbGetOrganizations: () => ipcRenderer.invoke('localdb-get-organizations'),

  // Management Groups
  localDbUpsertManagementGroups: (rows: UnknownRecord[]) => ipcRenderer.invoke('localdb-upsert-management-groups', rows),
  localDbGetManagementGroups: () => ipcRenderer.invoke('localdb-get-management-groups'),

  // Category1
  localDbUpsertCategory1: (rows: UnknownRecord[]) => ipcRenderer.invoke('localdb-upsert-category1', rows),
  localDbGetCategory1: () => ipcRenderer.invoke('localdb-get-category1'),

  // Category2
  localDbUpsertCategory2: (rows: UnknownRecord[], junctionData?: Array<{ category2_id: number; business_id: number }>) => ipcRenderer.invoke('localdb-upsert-category2', rows, junctionData),
  localDbGetCategory2: (businessId?: number) => ipcRenderer.invoke('localdb-get-category2', businessId),

  // CL Accounts
  localDbUpsertClAccounts: (rows: UnknownRecord[]) => ipcRenderer.invoke('localdb-upsert-cl-accounts', rows),
  localDbGetClAccounts: () => ipcRenderer.invoke('localdb-get-cl-accounts'),


  // Printer Management (multi-printer system)
  generateNumericUuid: (businessId: number) => ipcRenderer.invoke('generate-numeric-uuid', businessId),
  getPrinterCounter: (printerType: string, businessId: number, increment: boolean) => ipcRenderer.invoke('get-printer-counter', printerType, businessId, increment),
  getPrinter2Mode: () => ipcRenderer.invoke('get-printer2-mode'),
  setPrinter2Mode: (mode: 'auto' | 'manual') => ipcRenderer.invoke('set-printer2-mode', mode),
  getPrinter2AutomationSelections: (businessId: number) => ipcRenderer.invoke('get-printer2-automation-selections', businessId),
  savePrinter2AutomationSelections: (businessId: number, cycleNumber: number, selections: number[]) => ipcRenderer.invoke('save-printer2-automation-selections', businessId, cycleNumber, selections),
  generateRandomSelections: (cycleNumber: number) => ipcRenderer.invoke('generate-random-selections', cycleNumber),
  logPrinter2Print: (transactionId: string, printer2ReceiptNumber: number, mode: 'auto' | 'manual', cycleNumber?: number, globalCounter?: number, isReprint?: boolean, reprintCount?: number) =>
    ipcRenderer.invoke('log-printer2-print', transactionId, printer2ReceiptNumber, mode, cycleNumber, globalCounter, isReprint, reprintCount),
  getPrinter2AuditLog: (fromDate?: string, toDate?: string, limit?: number) => ipcRenderer.invoke('get-printer2-audit-log', fromDate, toDate, limit),
  queueTransactionForSystemPos: (transactionId: string) => ipcRenderer.invoke('queue-transaction-for-system-pos', transactionId),
  getSystemPosQueue: () => ipcRenderer.invoke('get-system-pos-queue'),
  markSystemPosSynced: (transactionId: string) => ipcRenderer.invoke('mark-system-pos-synced', transactionId),
  markSystemPosFailed: (transactionId: string, error: string) => ipcRenderer.invoke('mark-system-pos-failed', transactionId, error),
  resetSystemPosRetryCount: (transactionIds?: string[]) => ipcRenderer.invoke('reset-system-pos-retry-count', transactionIds),
  debugSystemPosTransaction: (transactionId: string) => ipcRenderer.invoke('debug-system-pos-transaction', transactionId),
  repopulateSystemPosQueue: (options?: { days?: number }) => ipcRenderer.invoke('repopulate-system-pos-queue', options),
  logPrinter1Print: (transactionId: string, printer1ReceiptNumber: number, globalCounter?: number, isReprint?: boolean, reprintCount?: number) =>
    ipcRenderer.invoke('log-printer1-print', transactionId, printer1ReceiptNumber, globalCounter, isReprint, reprintCount),
  getPrinter1AuditLog: (fromDate?: string, toDate?: string, limit?: number) => ipcRenderer.invoke('get-printer1-audit-log', fromDate, toDate, limit),

  // Printer audit sync helpers
  localDbUpsertPrinterAudits: (printerType: 'receipt' | 'receiptize', rows: UnknownRecord[]) => ipcRenderer.invoke('localdb-upsert-printer-audits', { printerType, rows }),
  localDbUpsertPrinterDailyCounters: (rows: Array<{ printer_type: string; business_id: number; date: string; counter: number }>) =>
    ipcRenderer.invoke('localdb-upsert-printer-daily-counters', rows),
  localDbGetAllPrinterDailyCounters: () => ipcRenderer.invoke('localdb-get-all-printer-daily-counters'),
  localDbResetPrinterDailyCounters: (businessId: number) => ipcRenderer.invoke('localdb-reset-printer-daily-counters', businessId),
  localDbGetUnsyncedPrinterAudits: () => ipcRenderer.invoke('localdb-get-unsynced-printer-audits'),
  localDbGetPrinterAuditsByTransactionId: (transactionId: string) => ipcRenderer.invoke('localDbGetPrinterAuditsByTransactionId', transactionId),
  localDbMarkPrinterAuditsSynced: (ids: { p1Ids: number[]; p2Ids: number[] }) => ipcRenderer.invoke('localdb-mark-printer-audits-synced', ids),

  // Shifts
  localDbGetActiveShift: (userId: number, businessId?: number) => ipcRenderer.invoke('localdb-get-active-shift', userId, businessId),
  localDbCreateShift: (shiftData: {
    uuid_id: string;
    business_id: number;
    user_id: number;
    user_name: string;
    modal_awal: number;
  }) => ipcRenderer.invoke('localdb-create-shift', shiftData),
  localDbEndShift: (shiftId: number) => ipcRenderer.invoke('localdb-end-shift', shiftId),
  localDbGetShiftStatistics: (userId: number, shiftStart: string, shiftEnd: string | null, businessId?: number) => ipcRenderer.invoke('localdb-get-shift-statistics', userId, shiftStart, shiftEnd, businessId),
  localDbGetPaymentBreakdown: (userId: number, shiftStart: string, shiftEnd: string | null, businessId?: number) => ipcRenderer.invoke('localdb-get-payment-breakdown', userId, shiftStart, shiftEnd, businessId),
  localDbGetCategory2Breakdown: (userId: number, shiftStart: string, shiftEnd: string | null, businessId?: number) => ipcRenderer.invoke('localdb-get-category2-breakdown', userId, shiftStart, shiftEnd, businessId),
  localDbGetCashSummary: (userId: number, shiftStart: string, shiftEnd: string | null, businessId?: number) => ipcRenderer.invoke('localdb-get-cash-summary', userId, shiftStart, shiftEnd, businessId),
  localDbGetShifts: (filters: { businessId?: number; startDate?: string; endDate?: string; userId?: number; limit?: number; offset?: number } | undefined) => ipcRenderer.invoke('localdb-get-shifts', filters),
  localDbGetShiftUsers: (businessId?: number) => ipcRenderer.invoke('localdb-get-shift-users', businessId),
  localDbGetUnsyncedShifts: (businessId?: number) => ipcRenderer.invoke('localdb-get-unsynced-shifts', businessId),
  localDbMarkShiftsSynced: (shiftIds: number[]) => ipcRenderer.invoke('localdb-mark-shifts-synced', shiftIds),
  localDbUpsertShifts: (rows: UnknownRecord[]) => ipcRenderer.invoke('localdb-upsert-shifts', rows),
  localDbCheckTodayTransactions: (userId: number, shiftStart: string, businessId?: number) => ipcRenderer.invoke('localdb-check-today-transactions', userId, shiftStart, businessId),
  localDbUpdateShiftStart: (shiftId: number, newStartTime: string) => ipcRenderer.invoke('localdb-update-shift-start', shiftId, newStartTime),
  localDbGetProductSales: (userId: number, shiftStart: string, shiftEnd: string | null, businessId?: number) => ipcRenderer.invoke('localdb-get-product-sales', userId, shiftStart, shiftEnd, businessId),
  printShiftBreakdown: (data: {
    user_name: string;
    shift_start: string;
    shift_end: string | null;
    modal_awal: number;
    statistics: { order_count: number; total_amount: number; total_discount: number; voucher_count: number };
    productSales: Array<{ product_name: string; total_quantity: number; total_subtotal: number; customization_subtotal: number; base_subtotal: number; base_unit_price: number; platform: string; transaction_type: string }>;
    customizationSales: Array<{ option_id: number; option_name: string; customization_id: number; customization_name: string; total_quantity: number; total_revenue: number }>;
    paymentBreakdown: Array<{ payment_method_name: string; transaction_count: number; total_amount: number }>;
    category2Breakdown: Array<{ category2_name: string; category2_id: number; total_quantity: number; total_amount: number }>;
    cashSummary: {
      cash_shift: number;
      cash_shift_sales?: number;
      cash_shift_refunds?: number;
      cash_whole_day: number;
      cash_whole_day_sales?: number;
      cash_whole_day_refunds?: number;
      total_cash_in_cashier: number;
      kas_mulai?: number;
      kas_expected?: number;
      kas_akhir?: number | null;
      kas_selisih?: number | null;
      kas_selisih_label?: 'balanced' | 'plus' | 'minus' | null;
    };
    business_id?: number;
    printerType?: string;
  }) => ipcRenderer.invoke('print-shift-breakdown', data),

  // Customer display event listeners
  onOrderUpdate: (callback: (data: UnknownRecord) => void) => {
    ipcRenderer.on('order-update', (event, data) => callback(data));
  },
  onSlideshowUpdate: (callback: (data: UnknownRecord) => void) => {
    ipcRenderer.on('slideshow-update', (event, data) => callback(data));
  },

  // Slideshow image management (userData storage)
  getSlideshowImages: () => ipcRenderer.invoke('get-slideshow-images'),
  saveSlideshowImage: (imageData: { filename: string; buffer: Buffer }) => ipcRenderer.invoke('save-slideshow-image', imageData),
  deleteSlideshowImage: (filename: string) => ipcRenderer.invoke('delete-slideshow-image', filename),
  openSlideshowFolder: () => ipcRenderer.invoke('open-slideshow-folder'),
  readSlideshowImage: (filename: string) => ipcRenderer.invoke('read-slideshow-image', filename),
  migrateSlideshowImages: () => ipcRenderer.invoke('migrate-slideshow-images'),

  // Admin: Delete transactions by user email or NULL
  localDbDeleteTransactionsByRole: () => ipcRenderer.invoke('localdb-delete-transactions-by-role'),

  // Database Restore
  restoreFromServer: (options: {
    businessId: number;
    apiUrl: string;
    includeTransactions?: boolean;
  }) => ipcRenderer.invoke('restore-from-server', options),

  // WebSocket Server Management
  websocketServerStart: (port?: number) => ipcRenderer.invoke('websocket-server-start', port),
  websocketServerStop: () => ipcRenderer.invoke('websocket-server-stop'),
  websocketServerStatus: () => ipcRenderer.invoke('websocket-server-status'),
  websocketBroadcastOrder: (order: UnknownRecord) => ipcRenderer.invoke('websocket-broadcast-order', order),
  websocketBroadcastStatus: (update: UnknownRecord) => ipcRenderer.invoke('websocket-broadcast-status', update),
});

