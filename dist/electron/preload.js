"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
electron_1.contextBridge.exposeInMainWorld('electronAPI', {
    // POS functionality
    printReceipt: (data) => electron_1.ipcRenderer.invoke('print-receipt', data),
    printLabel: (data) => electron_1.ipcRenderer.invoke('print-label', data),
    printLabelsBatch: (data) => electron_1.ipcRenderer.invoke('print-labels-batch', data),
    openCashDrawer: () => electron_1.ipcRenderer.invoke('open-cash-drawer'),
    playSound: (soundType) => electron_1.ipcRenderer.invoke('play-sound', soundType),
    // System printers
    listPrinters: () => electron_1.ipcRenderer.invoke('list-printers'),
    // Window controls
    closeWindow: () => electron_1.ipcRenderer.invoke('close-window'),
    minimizeWindow: () => electron_1.ipcRenderer.invoke('minimize-window'),
    maximizeWindow: () => electron_1.ipcRenderer.invoke('maximize-window'),
    navigateTo: (path) => electron_1.ipcRenderer.invoke('navigate-to', path),
    focusWindow: () => electron_1.ipcRenderer.invoke('focus-window'),
    // Authentication events
    notifyLoginSuccess: () => electron_1.ipcRenderer.invoke('login-success'),
    notifyLogout: () => electron_1.ipcRenderer.invoke('logout'),
    // Menu events
    onMenuNewOrder: (callback) => {
        electron_1.ipcRenderer.on('menu-new-order', callback);
    },
    // Dual-display communication
    updateCustomerDisplay: (data) => electron_1.ipcRenderer.invoke('update-customer-display', data),
    updateCustomerSlideshow: (data) => electron_1.ipcRenderer.invoke('update-customer-slideshow', data),
    getCustomerDisplayStatus: () => electron_1.ipcRenderer.invoke('get-customer-display-status'),
    createCustomerDisplay: () => electron_1.ipcRenderer.invoke('create-customer-display'),
    createBaristaKitchenWindow: () => electron_1.ipcRenderer.invoke('create-barista-kitchen-window'),
    // Offline/local DB primitives
    downloadAndRewriteSyncImages: (payload) => electron_1.ipcRenderer.invoke('download-and-rewrite-sync-images', payload),
    localDbUpsertCategories: (rows) => electron_1.ipcRenderer.invoke('localdb-upsert-categories', rows),
    localDbGetCategories: (businessId) => electron_1.ipcRenderer.invoke('localdb-get-categories', businessId),
    localDbUpsertProducts: (rows) => electron_1.ipcRenderer.invoke('localdb-upsert-products', rows),
    localDbCleanupOrphanedProducts: (businessId, syncedProductIds) => electron_1.ipcRenderer.invoke('localdb-cleanup-orphaned-products', businessId, syncedProductIds),
    localDbUpsertProductBusinesses: (rows) => electron_1.ipcRenderer.invoke('localdb-upsert-product-businesses', rows),
    localDbGetProductsByJenis: (jenis, businessId) => electron_1.ipcRenderer.invoke('localdb-get-products-by-jenis', jenis, businessId),
    localDbGetAllProducts: (businessId) => electron_1.ipcRenderer.invoke('localdb-get-all-products', businessId),
    localDbUpdateSyncStatus: (key, status) => electron_1.ipcRenderer.invoke('localdb-update-sync-status', key, status),
    localDbGetSyncStatus: (key) => electron_1.ipcRenderer.invoke('localdb-get-sync-status', key),
    // Comprehensive POS table operations
    // Users
    localDbUpsertUsers: (rows) => electron_1.ipcRenderer.invoke('localdb-upsert-users', rows),
    localDbGetUsers: () => electron_1.ipcRenderer.invoke('localdb-get-users'),
    // Businesses
    localDbUpsertBusinesses: (rows) => electron_1.ipcRenderer.invoke('localdb-upsert-businesses', rows),
    localDbGetBusinesses: () => electron_1.ipcRenderer.invoke('localdb-get-businesses'),
    // Employees Position
    localDbUpsertEmployeesPosition: (rows) => electron_1.ipcRenderer.invoke('localdb-upsert-employees-position', rows),
    localDbGetEmployeesPosition: () => electron_1.ipcRenderer.invoke('localdb-get-employees-position'),
    // Employees
    localDbUpsertEmployees: (rows, skipValidation) => electron_1.ipcRenderer.invoke('localdb-upsert-employees', rows, skipValidation),
    localDbGetEmployees: () => electron_1.ipcRenderer.invoke('localdb-get-employees'),
    localDbCleanupOrphanedEmployees: (businessId, syncedEmployeeIds) => electron_1.ipcRenderer.invoke('localdb-cleanup-orphaned-employees', businessId, syncedEmployeeIds),
    // Ingredients
    localDbUpsertIngredients: (rows) => electron_1.ipcRenderer.invoke('localdb-upsert-ingredients', rows),
    localDbGetIngredients: (businessId) => electron_1.ipcRenderer.invoke('localdb-get-ingredients', businessId),
    // COGS
    localDbUpsertCogs: (rows) => electron_1.ipcRenderer.invoke('localdb-upsert-cogs', rows),
    localDbGetCogs: () => electron_1.ipcRenderer.invoke('localdb-get-cogs'),
    // Contacts
    localDbUpsertContacts: (rows) => electron_1.ipcRenderer.invoke('localdb-upsert-contacts', rows),
    localDbGetContacts: (teamId) => electron_1.ipcRenderer.invoke('localdb-get-contacts', teamId),
    // Teams
    localDbUpsertTeams: (rows) => electron_1.ipcRenderer.invoke('localdb-upsert-teams', rows),
    localDbGetTeams: () => electron_1.ipcRenderer.invoke('localdb-get-teams'),
    // Roles & Permissions
    localDbUpsertRoles: (rows) => electron_1.ipcRenderer.invoke('localdb-upsert-roles', rows),
    localDbGetRoles: () => electron_1.ipcRenderer.invoke('localdb-get-roles'),
    localDbUpsertPermissions: (rows) => electron_1.ipcRenderer.invoke('localdb-upsert-permissions', rows),
    localDbGetPermissions: () => electron_1.ipcRenderer.invoke('localdb-get-permissions'),
    localDbUpsertRolePermissions: (rows) => electron_1.ipcRenderer.invoke('localdb-upsert-role-permissions', rows),
    localDbGetRolePermissions: (roleId) => electron_1.ipcRenderer.invoke('localdb-get-role-permissions', roleId),
    localDbGetUserAuth: (email) => electron_1.ipcRenderer.invoke('localdb-get-user-auth', email),
    checkOfflineDbExists: () => electron_1.ipcRenderer.invoke('localdb-check-exists'),
    // Supporting tables
    localDbUpsertSource: (rows) => electron_1.ipcRenderer.invoke('localdb-upsert-source', rows),
    localDbGetSource: () => electron_1.ipcRenderer.invoke('localdb-get-source'),
    // Skip pekerjaan - not needed in POS app (CRM-only)
    // Printer configurations
    localDbSavePrinterConfig: (printerType, systemPrinterName, extraSettings) => electron_1.ipcRenderer.invoke('localdb-save-printer-config', printerType, systemPrinterName, extraSettings),
    localDbGetPrinterConfigs: () => electron_1.ipcRenderer.invoke('localdb-get-printer-configs'),
    // Local settings (NOT synced to server)
    localDbGetSetting: (settingKey) => electron_1.ipcRenderer.invoke('localdb-get-setting', settingKey),
    localDbSaveSetting: (settingKey, settingValue) => electron_1.ipcRenderer.invoke('localdb-save-setting', settingKey, settingValue),
    // Transaction sync status (using transactions table directly)
    localDbMarkTransactionFailed: (transactionId) => electron_1.ipcRenderer.invoke('localdb-mark-transaction-failed', transactionId),
    localDbQueueOfflineRefund: (refundData) => electron_1.ipcRenderer.invoke('localdb-queue-offline-refund', refundData),
    localDbGetPendingRefunds: () => electron_1.ipcRenderer.invoke('localdb-get-pending-refunds'),
    localDbMarkRefundSynced: (offlineRefundId) => electron_1.ipcRenderer.invoke('localdb-mark-refund-synced', offlineRefundId),
    localDbDeleteRefund: (offlineRefundId) => electron_1.ipcRenderer.invoke('localdb-delete-refund', offlineRefundId),
    localDbCheckTransactionExists: (transactionUuid) => electron_1.ipcRenderer.invoke('localdb-check-transaction-exists', transactionUuid),
    // Restaurant Table Layout
    getRestaurantRooms: (businessId) => electron_1.ipcRenderer.invoke('get-restaurant-rooms', businessId),
    getRestaurantTables: (roomId) => electron_1.ipcRenderer.invoke('get-restaurant-tables', roomId),
    getRestaurantLayoutElements: (roomId) => electron_1.ipcRenderer.invoke('get-restaurant-layout-elements', roomId),
    localDbUpsertRestaurantRooms: (rows) => electron_1.ipcRenderer.invoke('localdb-upsert-restaurant-rooms', rows),
    localDbUpsertRestaurantTables: (rows) => electron_1.ipcRenderer.invoke('localdb-upsert-restaurant-tables', rows),
    localDbUpsertRestaurantLayoutElements: (rows) => electron_1.ipcRenderer.invoke('localdb-upsert-restaurant-layout-elements', rows),
    localDbMarkRefundFailed: (offlineRefundId) => electron_1.ipcRenderer.invoke('localdb-mark-refund-failed', offlineRefundId),
    // Add missing method
    localDbGetProductsByCategory2: (category2Name, businessId) => electron_1.ipcRenderer.invoke('localdb-get-products-by-category2', category2Name, businessId),
    // Customization handlers
    localDbUpsertCustomizationTypes: (rows) => electron_1.ipcRenderer.invoke('localdb-upsert-customization-types', rows),
    localDbUpsertCustomizationOptions: (rows) => electron_1.ipcRenderer.invoke('localdb-upsert-customization-options', rows),
    localDbUpsertProductCustomizations: (rows) => electron_1.ipcRenderer.invoke('localdb-upsert-product-customizations', rows),
    localDbGetProductCustomizations: (productId) => electron_1.ipcRenderer.invoke('localdb-get-product-customizations', productId),
    // Bundle handlers
    localDbGetBundleItems: (productId) => electron_1.ipcRenderer.invoke('localdb-get-bundle-items', productId),
    localDbUpsertBundleItems: (rows) => electron_1.ipcRenderer.invoke('localdb-upsert-bundle-items', rows),
    localDbDebugBundleItems: () => electron_1.ipcRenderer.invoke('localdb-debug-bundle-items'),
    // New enhanced offline support tables
    // Transactions
    localDbUpsertTransactions: (rows) => electron_1.ipcRenderer.invoke('localdb-upsert-transactions', rows),
    localDbGetTransactions: (businessId, limit) => electron_1.ipcRenderer.invoke('localdb-get-transactions', businessId, limit),
    localDbArchiveTransactions: (payload) => electron_1.ipcRenderer.invoke('localdb-archive-transactions', payload),
    localDbDeleteTransactions: (payload) => electron_1.ipcRenderer.invoke('localdb-delete-transactions', payload),
    localDbDeleteTransactionItems: (payload) => electron_1.ipcRenderer.invoke('localdb-delete-transaction-items', payload),
    localDbGetUnsyncedTransactions: (businessId) => electron_1.ipcRenderer.invoke('localdb-get-unsynced-transactions', businessId),
    localDbGetAllTransactions: (businessId) => electron_1.ipcRenderer.invoke('localdb-get-all-transactions', businessId),
    localDbDeleteUnsyncedTransactions: (businessId) => electron_1.ipcRenderer.invoke('localdb-delete-unsynced-transactions', businessId),
    localDbMarkTransactionsSynced: (transactionIds) => electron_1.ipcRenderer.invoke('localdb-mark-transactions-synced', transactionIds),
    localDbResetTransactionSync: (transactionId) => electron_1.ipcRenderer.invoke('localdb-reset-transaction-sync', transactionId),
    // Transaction Items
    localDbUpsertTransactionItems: (rows) => electron_1.ipcRenderer.invoke('localdb-upsert-transaction-items', rows),
    localDbGetTransactionItems: (transactionId) => electron_1.ipcRenderer.invoke('localdb-get-transaction-items', transactionId),
    localDbGetTransactionItemCustomizationsNormalized: (transactionId) => electron_1.ipcRenderer.invoke('localdb-get-transaction-item-customizations-normalized', transactionId),
    localDbUpsertTransactionItemCustomizations: (rows) => electron_1.ipcRenderer.invoke('localdb-upsert-transaction-item-customizations', rows),
    localDbUpsertTransactionItemCustomizationOptions: (rows) => electron_1.ipcRenderer.invoke('localdb-upsert-transaction-item-customization-options', rows),
    localDbGetTransactionRefunds: (transactionUuid) => electron_1.ipcRenderer.invoke('localdb-get-transaction-refunds', transactionUuid),
    // System POS database handlers
    localDbGetSystemPosTransactions: (businessId, limit) => electron_1.ipcRenderer.invoke('localdb-get-system-pos-transactions', businessId, limit),
    localDbGetSystemPosTransactionItems: (transactionId) => electron_1.ipcRenderer.invoke('localdb-get-system-pos-transaction-items', transactionId),
    localDbGetSystemPosTransactionRefunds: (transactionUuid) => electron_1.ipcRenderer.invoke('localdb-get-system-pos-transaction-refunds', transactionUuid),
    localDbGetSystemPosUsers: () => electron_1.ipcRenderer.invoke('localdb-get-system-pos-users'),
    localDbGetSystemPosBusinesses: () => electron_1.ipcRenderer.invoke('localdb-get-system-pos-businesses'),
    localDbGetSystemPosAllProducts: (businessId) => electron_1.ipcRenderer.invoke('localdb-get-system-pos-all-products', businessId),
    localDbGetSystemPosEmployees: () => electron_1.ipcRenderer.invoke('localdb-get-system-pos-employees'),
    localDbGetShiftRefunds: (userId, shiftStart, shiftEnd, businessId, shiftUuid) => electron_1.ipcRenderer.invoke('localdb-get-shift-refunds', userId, shiftStart, shiftEnd, businessId, shiftUuid),
    localDbUpsertTransactionRefunds: (rows) => electron_1.ipcRenderer.invoke('localdb-upsert-transaction-refunds', rows),
    localDbApplyTransactionRefund: (payload) => electron_1.ipcRenderer.invoke('localdb-apply-transaction-refund', payload),
    localDbSplitBill: (payload) => electron_1.ipcRenderer.invoke('localdb-split-bill', payload),
    // Payment Methods
    localDbUpsertPaymentMethods: (rows) => electron_1.ipcRenderer.invoke('localdb-upsert-payment-methods', rows),
    localDbGetPaymentMethods: () => electron_1.ipcRenderer.invoke('localdb-get-payment-methods'),
    // Banks
    localDbUpsertBanks: (rows) => electron_1.ipcRenderer.invoke('localdb-upsert-banks', rows),
    localDbGetBanks: () => electron_1.ipcRenderer.invoke('localdb-get-banks'),
    // Receipt Settings and Templates
    localDbUpsertReceiptSettings: (rows) => electron_1.ipcRenderer.invoke('localdb-upsert-receipt-settings', rows),
    localDbUpsertReceiptTemplates: (rows) => electron_1.ipcRenderer.invoke('localdb-upsert-receipt-templates', rows),
    // Organizations
    localDbUpsertOrganizations: (rows, skipValidation) => electron_1.ipcRenderer.invoke('localdb-upsert-organizations', rows, skipValidation),
    localDbGetOrganizations: () => electron_1.ipcRenderer.invoke('localdb-get-organizations'),
    // Skip management_groups - not needed in POS app (CRM-only)
    // Category1
    localDbUpsertCategory1: (rows) => electron_1.ipcRenderer.invoke('localdb-upsert-category1', rows),
    localDbGetCategory1: () => electron_1.ipcRenderer.invoke('localdb-get-category1'),
    // Category2
    localDbUpsertCategory2: (rows, junctionData) => electron_1.ipcRenderer.invoke('localdb-upsert-category2', rows, junctionData),
    localDbGetCategory2: (businessId) => electron_1.ipcRenderer.invoke('localdb-get-category2', businessId),
    // CL Accounts
    localDbUpsertClAccounts: (rows) => electron_1.ipcRenderer.invoke('localdb-upsert-cl-accounts', rows),
    localDbGetClAccounts: () => electron_1.ipcRenderer.invoke('localdb-get-cl-accounts'),
    // Printer Management (multi-printer system)
    generateNumericUuid: (businessId) => electron_1.ipcRenderer.invoke('generate-numeric-uuid', businessId),
    getPrinterCounter: (printerType, businessId, increment) => electron_1.ipcRenderer.invoke('get-printer-counter', printerType, businessId, increment),
    getPrinter2Mode: () => electron_1.ipcRenderer.invoke('get-printer2-mode'),
    setPrinter2Mode: (mode) => electron_1.ipcRenderer.invoke('set-printer2-mode', mode),
    getPrinter2AutomationSelections: (businessId) => electron_1.ipcRenderer.invoke('get-printer2-automation-selections', businessId),
    savePrinter2AutomationSelections: (businessId, cycleNumber, selections) => electron_1.ipcRenderer.invoke('save-printer2-automation-selections', businessId, cycleNumber, selections),
    generateRandomSelections: (cycleNumber) => electron_1.ipcRenderer.invoke('generate-random-selections', cycleNumber),
    logPrinter2Print: (transactionId, printer2ReceiptNumber, mode, cycleNumber, globalCounter, isReprint, reprintCount) => electron_1.ipcRenderer.invoke('log-printer2-print', transactionId, printer2ReceiptNumber, mode, cycleNumber, globalCounter, isReprint, reprintCount),
    getPrinter2AuditLog: (fromDate, toDate, limit) => electron_1.ipcRenderer.invoke('get-printer2-audit-log', fromDate, toDate, limit),
    queueTransactionForSystemPos: (transactionId) => electron_1.ipcRenderer.invoke('queue-transaction-for-system-pos', transactionId),
    getSystemPosQueue: () => electron_1.ipcRenderer.invoke('get-system-pos-queue'),
    markSystemPosSynced: (transactionId) => electron_1.ipcRenderer.invoke('mark-system-pos-synced', transactionId),
    markSystemPosFailed: (transactionId, error) => electron_1.ipcRenderer.invoke('mark-system-pos-failed', transactionId, error),
    resetSystemPosRetryCount: (transactionIds) => electron_1.ipcRenderer.invoke('reset-system-pos-retry-count', transactionIds),
    debugSystemPosTransaction: (transactionId) => electron_1.ipcRenderer.invoke('debug-system-pos-transaction', transactionId),
    repopulateSystemPosQueue: (options) => electron_1.ipcRenderer.invoke('repopulate-system-pos-queue', options),
    logPrinter1Print: (transactionId, printer1ReceiptNumber, globalCounter, isReprint, reprintCount) => electron_1.ipcRenderer.invoke('log-printer1-print', transactionId, printer1ReceiptNumber, globalCounter, isReprint, reprintCount),
    getPrinter1AuditLog: (fromDate, toDate, limit) => electron_1.ipcRenderer.invoke('get-printer1-audit-log', fromDate, toDate, limit),
    // Printer audit sync helpers
    localDbUpsertPrinterAudits: (printerType, rows) => electron_1.ipcRenderer.invoke('localdb-upsert-printer-audits', { printerType, rows }),
    localDbUpsertPrinterDailyCounters: (rows) => electron_1.ipcRenderer.invoke('localdb-upsert-printer-daily-counters', rows),
    localDbGetAllPrinterDailyCounters: () => electron_1.ipcRenderer.invoke('localdb-get-all-printer-daily-counters'),
    localDbResetPrinterDailyCounters: (businessId) => electron_1.ipcRenderer.invoke('localdb-reset-printer-daily-counters', businessId),
    localDbGetUnsyncedPrinterAudits: () => electron_1.ipcRenderer.invoke('localdb-get-unsynced-printer-audits'),
    localDbGetPrinterAuditsByTransactionId: (transactionId) => electron_1.ipcRenderer.invoke('localDbGetPrinterAuditsByTransactionId', transactionId),
    localDbMarkPrinterAuditsSynced: (ids) => electron_1.ipcRenderer.invoke('localdb-mark-printer-audits-synced', ids),
    // Shifts
    localDbGetActiveShift: (userId, businessId) => electron_1.ipcRenderer.invoke('localdb-get-active-shift', userId, businessId),
    localDbCreateShift: (shiftData) => electron_1.ipcRenderer.invoke('localdb-create-shift', shiftData),
    localDbEndShift: (shiftId) => electron_1.ipcRenderer.invoke('localdb-end-shift', shiftId),
    localDbGetShiftStatistics: (userId, shiftStart, shiftEnd, businessId, shiftUuid) => electron_1.ipcRenderer.invoke('localdb-get-shift-statistics', userId, shiftStart, shiftEnd, businessId, shiftUuid),
    localDbGetPaymentBreakdown: (userId, shiftStart, shiftEnd, businessId) => electron_1.ipcRenderer.invoke('localdb-get-payment-breakdown', userId, shiftStart, shiftEnd, businessId),
    localDbGetCategory2Breakdown: (userId, shiftStart, shiftEnd, businessId) => electron_1.ipcRenderer.invoke('localdb-get-category2-breakdown', userId, shiftStart, shiftEnd, businessId),
    localDbGetCashSummary: (userId, shiftStart, shiftEnd, businessId, shiftUuid) => electron_1.ipcRenderer.invoke('localdb-get-cash-summary', userId, shiftStart, shiftEnd, businessId, shiftUuid),
    localDbGetShifts: (filters) => electron_1.ipcRenderer.invoke('localdb-get-shifts', filters),
    localDbGetShiftUsers: (businessId) => electron_1.ipcRenderer.invoke('localdb-get-shift-users', businessId),
    localDbGetUnsyncedShifts: (businessId) => electron_1.ipcRenderer.invoke('localdb-get-unsynced-shifts', businessId),
    localDbMarkShiftsSynced: (shiftIds) => electron_1.ipcRenderer.invoke('localdb-mark-shifts-synced', shiftIds),
    localDbUpsertShifts: (rows) => electron_1.ipcRenderer.invoke('localdb-upsert-shifts', rows),
    localDbCheckTodayTransactions: (userId, shiftStart, businessId) => electron_1.ipcRenderer.invoke('localdb-check-today-transactions', userId, shiftStart, businessId),
    localDbUpdateShiftStart: (shiftId, newStartTime) => electron_1.ipcRenderer.invoke('localdb-update-shift-start', shiftId, newStartTime),
    localDbGetProductSales: (userId, shiftStart, shiftEnd, businessId) => electron_1.ipcRenderer.invoke('localdb-get-product-sales', userId, shiftStart, shiftEnd, businessId),
    printShiftBreakdown: (data) => electron_1.ipcRenderer.invoke('print-shift-breakdown', data),
    // Customer display event listeners
    onOrderUpdate: (callback) => {
        electron_1.ipcRenderer.on('order-update', (event, data) => callback(data));
    },
    onSlideshowUpdate: (callback) => {
        electron_1.ipcRenderer.on('slideshow-update', (event, data) => callback(data));
    },
    // Slideshow image management (userData storage)
    getSlideshowImages: () => electron_1.ipcRenderer.invoke('get-slideshow-images'),
    saveSlideshowImage: (imageData) => electron_1.ipcRenderer.invoke('save-slideshow-image', imageData),
    deleteSlideshowImage: (filename) => electron_1.ipcRenderer.invoke('delete-slideshow-image', filename),
    openSlideshowFolder: () => electron_1.ipcRenderer.invoke('open-slideshow-folder'),
    readSlideshowImage: (filename) => electron_1.ipcRenderer.invoke('read-slideshow-image', filename),
    migrateSlideshowImages: () => electron_1.ipcRenderer.invoke('migrate-slideshow-images'),
    // Admin: Delete transactions by user email or NULL
    localDbDeleteTransactionsByRole: () => electron_1.ipcRenderer.invoke('localdb-delete-transactions-by-role'),
    // Database Restore
    restoreFromServer: (options) => electron_1.ipcRenderer.invoke('restore-from-server', options),
    // Configuration Management
    getAppConfig: () => electron_1.ipcRenderer.invoke('get-app-config'),
    saveAppConfig: (config) => electron_1.ipcRenderer.invoke('save-app-config', config),
    resetAppConfig: () => electron_1.ipcRenderer.invoke('reset-app-config'),
    testDbConnection: (config) => electron_1.ipcRenderer.invoke('test-db-connection', config),
    // Receipt Template and Settings Management
    getReceiptTemplate: (templateType, businessId) => electron_1.ipcRenderer.invoke('get-receipt-template', templateType, businessId),
    getReceiptTemplates: (templateType, businessId) => electron_1.ipcRenderer.invoke('get-receipt-templates', templateType, businessId),
    setDefaultReceiptTemplate: (templateType, templateName, businessId) => electron_1.ipcRenderer.invoke('set-default-receipt-template', templateType, templateName, businessId),
    saveReceiptTemplate: (templateType, templateCode, businessId) => electron_1.ipcRenderer.invoke('save-receipt-template', templateType, templateCode, businessId),
    getReceiptSettings: (businessId) => electron_1.ipcRenderer.invoke('get-receipt-settings', businessId),
    saveReceiptSettings: (settings, businessId) => electron_1.ipcRenderer.invoke('save-receipt-settings', settings, businessId),
    // Activity Logs
    localDbUpsertActivityLogs: (rows) => electron_1.ipcRenderer.invoke('localdb-upsert-activity-logs', rows),
    localDbGetActivityLogs: (businessId) => electron_1.ipcRenderer.invoke('localdb-get-activity-logs', businessId),
});
