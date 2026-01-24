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
  createBaristaKitchenWindow: () => ipcRenderer.invoke('create-barista-kitchen-window'),

  // Offline/local DB primitives
  downloadAndRewriteSyncImages: (payload: { baseUrl: string; products: UnknownRecord[]; businesses: UnknownRecord[] }) =>
    ipcRenderer.invoke('download-and-rewrite-sync-images', payload),
  localDbUpsertCategories: (rows: { jenis: string; updated_at?: number }[]) => ipcRenderer.invoke('localdb-upsert-categories', rows),
  localDbGetCategories: (businessId?: number) => ipcRenderer.invoke('localdb-get-categories', businessId),
  localDbUpsertProducts: (rows: UnknownRecord[]) => ipcRenderer.invoke('localdb-upsert-products', rows),
  localDbCleanupOrphanedProducts: (businessId: number, syncedProductIds: number[]) => ipcRenderer.invoke('localdb-cleanup-orphaned-products', businessId, syncedProductIds),
  localDbUpsertProductBusinesses: (rows: Array<{ product_id: number; business_id: number }>) => ipcRenderer.invoke('localdb-upsert-product-businesses', rows),
  localDbGetProductsByJenis: (jenis: string, businessId?: number) => ipcRenderer.invoke('localdb-get-products-by-jenis', jenis, businessId),
  localDbGetAllProducts: (businessId?: number) => ipcRenderer.invoke('localdb-get-all-products', businessId),
  localDbUpdateSyncStatus: (key: string, status: string) => ipcRenderer.invoke('localdb-update-sync-status', key, status),
  localDbGetSyncStatus: (key: string) => ipcRenderer.invoke('localdb-get-sync-status', key),

  // Comprehensive POS table operations
  // Users
  localDbUpsertUsers: (rows: UnknownRecord[]) => ipcRenderer.invoke('localdb-upsert-users', rows),
  localDbGetUsers: () => ipcRenderer.invoke('localdb-get-users'),

  // Businesses
  localDbUpsertBusinesses: (rows: UnknownRecord[]) => ipcRenderer.invoke('localdb-upsert-businesses', rows),
  localDbGetBusinesses: () => ipcRenderer.invoke('localdb-get-businesses'),

  // Employees Position
  localDbUpsertEmployeesPosition: (rows: UnknownRecord[]) => ipcRenderer.invoke('localdb-upsert-employees-position', rows),
  localDbGetEmployeesPosition: () => ipcRenderer.invoke('localdb-get-employees-position'),

  // Employees
  localDbUpsertEmployees: (rows: UnknownRecord[], skipValidation?: boolean) => ipcRenderer.invoke('localdb-upsert-employees', rows, skipValidation),
  localDbGetEmployees: () => ipcRenderer.invoke('localdb-get-employees'),
  localDbCleanupOrphanedEmployees: (businessId: number, syncedEmployeeIds: number[]) => ipcRenderer.invoke('localdb-cleanup-orphaned-employees', businessId, syncedEmployeeIds),

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
  // Skip pekerjaan - not needed in POS app (CRM-only)

  // Printer configurations
  localDbSavePrinterConfig: (printerType: string, systemPrinterName: string, extraSettings?: UnknownRecord) =>
    ipcRenderer.invoke('localdb-save-printer-config', printerType, systemPrinterName, extraSettings),
  localDbGetPrinterConfigs: () => ipcRenderer.invoke('localdb-get-printer-configs'),

  // Local settings (NOT synced to server)
  localDbGetSetting: (settingKey: string) => ipcRenderer.invoke('localdb-get-setting', settingKey),
  localDbSaveSetting: (settingKey: string, settingValue: string) => ipcRenderer.invoke('localdb-save-setting', settingKey, settingValue),

  // Transaction sync status (using transactions table directly)
  localDbMarkTransactionFailed: (transactionId: string) => ipcRenderer.invoke('localdb-mark-transaction-failed', transactionId),
  localDbQueueOfflineRefund: (refundData: UnknownRecord) => ipcRenderer.invoke('localdb-queue-offline-refund', refundData),
  localDbGetPendingRefunds: () => ipcRenderer.invoke('localdb-get-pending-refunds'),
  localDbMarkRefundSynced: (offlineRefundId: number) => ipcRenderer.invoke('localdb-mark-refund-synced', offlineRefundId),
  localDbDeleteRefund: (offlineRefundId: number) => ipcRenderer.invoke('localdb-delete-refund', offlineRefundId),
  localDbCheckTransactionExists: (transactionUuid: string) => ipcRenderer.invoke('localdb-check-transaction-exists', transactionUuid),

  // Restaurant Table Layout
  getRestaurantRooms: (businessId: number) => ipcRenderer.invoke('get-restaurant-rooms', businessId),
    getRestaurantTables: (roomId: number) => ipcRenderer.invoke('get-restaurant-tables', roomId),
    getRestaurantLayoutElements: (roomId: number) => ipcRenderer.invoke('get-restaurant-layout-elements', roomId),
  localDbUpsertRestaurantRooms: (rows: UnknownRecord[]) => ipcRenderer.invoke('localdb-upsert-restaurant-rooms', rows),
  localDbUpsertRestaurantTables: (rows: UnknownRecord[]) => ipcRenderer.invoke('localdb-upsert-restaurant-tables', rows),
  localDbUpsertRestaurantLayoutElements: (rows: UnknownRecord[]) => ipcRenderer.invoke('localdb-upsert-restaurant-layout-elements', rows),
  localDbMarkRefundFailed: (offlineRefundId: number) => ipcRenderer.invoke('localdb-mark-refund-failed', offlineRefundId),

  // Add missing method
  localDbGetProductsByCategory2: (category2Name: string, businessId?: number) => ipcRenderer.invoke('localdb-get-products-by-category2', category2Name, businessId),

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
  localDbGetAllTransactions: (businessId?: number) => ipcRenderer.invoke('localdb-get-all-transactions', businessId),
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
  // System POS database handlers
  localDbGetSystemPosTransactions: (businessId?: number, limit?: number) => ipcRenderer.invoke('localdb-get-system-pos-transactions', businessId, limit),
  localDbGetSystemPosTransactionItems: (transactionId?: number | string) => ipcRenderer.invoke('localdb-get-system-pos-transaction-items', transactionId),
  localDbGetSystemPosTransactionRefunds: (transactionUuid: string) => ipcRenderer.invoke('localdb-get-system-pos-transaction-refunds', transactionUuid),
  localDbGetSystemPosUsers: () => ipcRenderer.invoke('localdb-get-system-pos-users'),
  localDbGetSystemPosBusinesses: () => ipcRenderer.invoke('localdb-get-system-pos-businesses'),
  localDbGetSystemPosAllProducts: (businessId?: number) => ipcRenderer.invoke('localdb-get-system-pos-all-products', businessId),
  localDbGetSystemPosEmployees: () => ipcRenderer.invoke('localdb-get-system-pos-employees'),
  localDbGetShiftRefunds: (userId: number | null, shiftStart: string, shiftEnd: string | null, businessId?: number, shiftUuid?: string | null) => ipcRenderer.invoke('localdb-get-shift-refunds', userId, shiftStart, shiftEnd, businessId, shiftUuid),
  localDbUpsertTransactionRefunds: (rows: UnknownRecord[]) => ipcRenderer.invoke('localdb-upsert-transaction-refunds', rows),
  localDbApplyTransactionRefund: (payload: UnknownRecord) => ipcRenderer.invoke('localdb-apply-transaction-refund', payload),
  localDbSplitBill: (payload: { sourceTransactionUuid: string; destinationTransactionUuid: string; itemIds: number[] }) => ipcRenderer.invoke('localdb-split-bill', payload),

  // Payment Methods
  localDbUpsertPaymentMethods: (rows: UnknownRecord[]) => ipcRenderer.invoke('localdb-upsert-payment-methods', rows),
  localDbGetPaymentMethods: () => ipcRenderer.invoke('localdb-get-payment-methods'),

  // Banks
  localDbUpsertBanks: (rows: UnknownRecord[]) => ipcRenderer.invoke('localdb-upsert-banks', rows),
  localDbGetBanks: () => ipcRenderer.invoke('localdb-get-banks'),

  // Receipt Settings and Templates
  localDbUpsertReceiptSettings: (rows: UnknownRecord[]) => ipcRenderer.invoke('localdb-upsert-receipt-settings', rows),
  localDbUpsertReceiptTemplates: (rows: UnknownRecord[]) => ipcRenderer.invoke('localdb-upsert-receipt-templates', rows),

  // Organizations
  localDbUpsertOrganizations: (rows: UnknownRecord[], skipValidation?: boolean) => ipcRenderer.invoke('localdb-upsert-organizations', rows, skipValidation),
  localDbGetOrganizations: () => ipcRenderer.invoke('localdb-get-organizations'),

  // Skip management_groups - not needed in POS app (CRM-only)

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
  localDbGetShiftStatistics: (userId: number | null, shiftStart: string, shiftEnd: string | null, businessId?: number, shiftUuid?: string | null) => ipcRenderer.invoke('localdb-get-shift-statistics', userId, shiftStart, shiftEnd, businessId, shiftUuid),
  localDbGetPaymentBreakdown: (userId: number | null, shiftStart: string, shiftEnd: string | null, businessId?: number) => ipcRenderer.invoke('localdb-get-payment-breakdown', userId, shiftStart, shiftEnd, businessId),
  localDbGetCategory2Breakdown: (userId: number | null, shiftStart: string, shiftEnd: string | null, businessId?: number) => ipcRenderer.invoke('localdb-get-category2-breakdown', userId, shiftStart, shiftEnd, businessId),
  localDbGetCashSummary: (userId: number | null, shiftStart: string, shiftEnd: string | null, businessId?: number, shiftUuid?: string | null) => ipcRenderer.invoke('localdb-get-cash-summary', userId, shiftStart, shiftEnd, businessId, shiftUuid),
  localDbGetShifts: (filters: { businessId?: number; startDate?: string; endDate?: string; userId?: number; limit?: number; offset?: number } | undefined) => ipcRenderer.invoke('localdb-get-shifts', filters),
  localDbGetShiftUsers: (businessId?: number) => ipcRenderer.invoke('localdb-get-shift-users', businessId),
  localDbGetUnsyncedShifts: (businessId?: number) => ipcRenderer.invoke('localdb-get-unsynced-shifts', businessId),
  localDbMarkShiftsSynced: (shiftIds: number[]) => ipcRenderer.invoke('localdb-mark-shifts-synced', shiftIds),
  localDbUpsertShifts: (rows: UnknownRecord[]) => ipcRenderer.invoke('localdb-upsert-shifts', rows),
  localDbCheckTodayTransactions: (userId: number, shiftStart: string, businessId?: number) => ipcRenderer.invoke('localdb-check-today-transactions', userId, shiftStart, businessId),
  localDbUpdateShiftStart: (shiftId: number, newStartTime: string) => ipcRenderer.invoke('localdb-update-shift-start', shiftId, newStartTime),
  localDbGetProductSales: (userId: number | null, shiftStart: string, shiftEnd: string | null, businessId?: number) => ipcRenderer.invoke('localdb-get-product-sales', userId, shiftStart, shiftEnd, businessId),
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


  // Configuration Management
  getAppConfig: () => ipcRenderer.invoke('get-app-config'),
  saveAppConfig: (config: { serverHost?: string; apiUrl?: string; dbUser?: string; dbPassword?: string; dbName?: string; dbPort?: number }) => ipcRenderer.invoke('save-app-config', config),
  resetAppConfig: () => ipcRenderer.invoke('reset-app-config'),
  testDbConnection: (config: { serverHost?: string; dbUser?: string; dbPassword?: string; dbName?: string; dbPort?: number }) => ipcRenderer.invoke('test-db-connection', config),

  // Receipt Template and Settings Management
  getReceiptTemplate: (templateType: 'receipt' | 'bill', businessId?: number) => ipcRenderer.invoke('get-receipt-template', templateType, businessId),
  getReceiptTemplates: (templateType: 'receipt' | 'bill', businessId?: number) => ipcRenderer.invoke('get-receipt-templates', templateType, businessId),
  setDefaultReceiptTemplate: (templateType: 'receipt' | 'bill', templateName: string, businessId?: number) => ipcRenderer.invoke('set-default-receipt-template', templateType, templateName, businessId),
  saveReceiptTemplate: (templateType: 'receipt' | 'bill', templateCode: string, businessId?: number) => ipcRenderer.invoke('save-receipt-template', templateType, templateCode, businessId),
  getReceiptSettings: (businessId?: number) => ipcRenderer.invoke('get-receipt-settings', businessId),
  saveReceiptSettings: (settings: {
    store_name?: string | null;
    address?: string | null;
    phone_number?: string | null;
    contact_phone?: string | null;
    logo_base64?: string | null;
    footer_text?: string | null;
    partnership_contact?: string | null;
  }, businessId?: number) => ipcRenderer.invoke('save-receipt-settings', settings, businessId),

  // Activity Logs
  localDbUpsertActivityLogs: (rows: UnknownRecord[]) => ipcRenderer.invoke('localdb-upsert-activity-logs', rows),
  localDbGetActivityLogs: (businessId?: number) => ipcRenderer.invoke('localdb-get-activity-logs', businessId),
});

