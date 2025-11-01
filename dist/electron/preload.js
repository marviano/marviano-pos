"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
electron_1.contextBridge.exposeInMainWorld('electronAPI', {
    // POS functionality
    printReceipt: (data) => electron_1.ipcRenderer.invoke('print-receipt', data),
    printLabel: (data) => electron_1.ipcRenderer.invoke('print-label', data),
    openCashDrawer: () => electron_1.ipcRenderer.invoke('open-cash-drawer'),
    playSound: (soundType) => electron_1.ipcRenderer.invoke('play-sound', soundType),
    // System printers
    listPrinters: () => electron_1.ipcRenderer.invoke('list-printers'),
    // Window controls
    closeWindow: () => electron_1.ipcRenderer.invoke('close-window'),
    minimizeWindow: () => electron_1.ipcRenderer.invoke('minimize-window'),
    maximizeWindow: () => electron_1.ipcRenderer.invoke('maximize-window'),
    navigateTo: (path) => electron_1.ipcRenderer.invoke('navigate-to', path),
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
    // Offline/local DB primitives
    localDbUpsertCategories: (rows) => electron_1.ipcRenderer.invoke('localdb-upsert-categories', rows),
    localDbGetCategories: () => electron_1.ipcRenderer.invoke('localdb-get-categories'),
    localDbUpsertProducts: (rows) => electron_1.ipcRenderer.invoke('localdb-upsert-products', rows),
    localDbGetProductsByJenis: (jenis) => electron_1.ipcRenderer.invoke('localdb-get-products-by-jenis', jenis),
    localDbGetAllProducts: () => electron_1.ipcRenderer.invoke('localdb-get-all-products'),
    localDbUpdateSyncStatus: (key, status) => electron_1.ipcRenderer.invoke('localdb-update-sync-status', key, status),
    localDbGetSyncStatus: (key) => electron_1.ipcRenderer.invoke('localdb-get-sync-status', key),
    // Comprehensive POS table operations
    // Users
    localDbUpsertUsers: (rows) => electron_1.ipcRenderer.invoke('localdb-upsert-users', rows),
    localDbGetUsers: () => electron_1.ipcRenderer.invoke('localdb-get-users'),
    // Businesses
    localDbUpsertBusinesses: (rows) => electron_1.ipcRenderer.invoke('localdb-upsert-businesses', rows),
    localDbGetBusinesses: () => electron_1.ipcRenderer.invoke('localdb-get-businesses'),
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
    // Supporting tables
    localDbUpsertSource: (rows) => electron_1.ipcRenderer.invoke('localdb-upsert-source', rows),
    localDbGetSource: () => electron_1.ipcRenderer.invoke('localdb-get-source'),
    localDbUpsertPekerjaan: (rows) => electron_1.ipcRenderer.invoke('localdb-upsert-pekerjaan', rows),
    localDbGetPekerjaan: () => electron_1.ipcRenderer.invoke('localdb-get-pekerjaan'),
    // Printer configurations
    localDbSavePrinterConfig: (printerType, systemPrinterName) => electron_1.ipcRenderer.invoke('localdb-save-printer-config', printerType, systemPrinterName),
    localDbGetPrinterConfigs: () => electron_1.ipcRenderer.invoke('localdb-get-printer-configs'),
    // Offline transaction queue
    localDbQueueOfflineTransaction: (transactionData) => electron_1.ipcRenderer.invoke('localdb-queue-offline-transaction', transactionData),
    localDbGetPendingTransactions: () => electron_1.ipcRenderer.invoke('localdb-get-pending-transactions'),
    localDbMarkTransactionSynced: (offlineTransactionId) => electron_1.ipcRenderer.invoke('localdb-mark-transaction-synced', offlineTransactionId),
    localDbMarkTransactionFailed: (offlineTransactionId) => electron_1.ipcRenderer.invoke('localdb-mark-transaction-failed', offlineTransactionId),
    // Add missing method
    localDbGetProductsByCategory2: (category2Name) => electron_1.ipcRenderer.invoke('localdb-get-products-by-category2', category2Name),
    // Customization handlers
    localDbUpsertCustomizationTypes: (rows) => electron_1.ipcRenderer.invoke('localdb-upsert-customization-types', rows),
    localDbUpsertCustomizationOptions: (rows) => electron_1.ipcRenderer.invoke('localdb-upsert-customization-options', rows),
    localDbUpsertProductCustomizations: (rows) => electron_1.ipcRenderer.invoke('localdb-upsert-product-customizations', rows),
    localDbGetProductCustomizations: (productId) => electron_1.ipcRenderer.invoke('localdb-get-product-customizations', productId),
    // Bundle handlers
    localDbGetBundleItems: (productId) => electron_1.ipcRenderer.invoke('localdb-get-bundle-items', productId),
    localDbUpsertBundleItems: (rows) => electron_1.ipcRenderer.invoke('localdb-upsert-bundle-items', rows),
    // New enhanced offline support tables
    // Transactions
    localDbUpsertTransactions: (rows) => electron_1.ipcRenderer.invoke('localdb-upsert-transactions', rows),
    localDbGetTransactions: (businessId, limit) => electron_1.ipcRenderer.invoke('localdb-get-transactions', businessId, limit),
    localDbArchiveTransactions: (businessId) => electron_1.ipcRenderer.invoke('localdb-archive-transactions', businessId),
    localDbDeleteTransactions: (businessId) => electron_1.ipcRenderer.invoke('localdb-delete-transactions', businessId),
    localDbDeleteTransactionItems: (businessId) => electron_1.ipcRenderer.invoke('localdb-delete-transaction-items', businessId),
    localDbGetUnsyncedTransactions: (businessId) => electron_1.ipcRenderer.invoke('localdb-get-unsynced-transactions', businessId),
    localDbMarkTransactionsSynced: (transactionIds) => electron_1.ipcRenderer.invoke('localdb-mark-transactions-synced', transactionIds),
    localDbResetTransactionSync: (transactionId) => electron_1.ipcRenderer.invoke('localdb-reset-transaction-sync', transactionId),
    // Transaction Items
    localDbUpsertTransactionItems: (rows) => electron_1.ipcRenderer.invoke('localdb-upsert-transaction-items', rows),
    localDbGetTransactionItems: (transactionId) => electron_1.ipcRenderer.invoke('localdb-get-transaction-items', transactionId),
    // Payment Methods
    localDbUpsertPaymentMethods: (rows) => electron_1.ipcRenderer.invoke('localdb-upsert-payment-methods', rows),
    localDbGetPaymentMethods: () => electron_1.ipcRenderer.invoke('localdb-get-payment-methods'),
    // Banks
    localDbUpsertBanks: (rows) => electron_1.ipcRenderer.invoke('localdb-upsert-banks', rows),
    localDbGetBanks: () => electron_1.ipcRenderer.invoke('localdb-get-banks'),
    // Organizations
    localDbUpsertOrganizations: (rows) => electron_1.ipcRenderer.invoke('localdb-upsert-organizations', rows),
    localDbGetOrganizations: () => electron_1.ipcRenderer.invoke('localdb-get-organizations'),
    // Management Groups
    localDbUpsertManagementGroups: (rows) => electron_1.ipcRenderer.invoke('localdb-upsert-management-groups', rows),
    localDbGetManagementGroups: () => electron_1.ipcRenderer.invoke('localdb-get-management-groups'),
    // Category1
    localDbUpsertCategory1: (rows) => electron_1.ipcRenderer.invoke('localdb-upsert-category1', rows),
    localDbGetCategory1: () => electron_1.ipcRenderer.invoke('localdb-get-category1'),
    // Category2
    localDbUpsertCategory2: (rows) => electron_1.ipcRenderer.invoke('localdb-upsert-category2', rows),
    localDbGetCategory2: (businessId) => electron_1.ipcRenderer.invoke('localdb-get-category2', businessId),
    // CL Accounts
    localDbUpsertClAccounts: (rows) => electron_1.ipcRenderer.invoke('localdb-upsert-cl-accounts', rows),
    localDbGetClAccounts: () => electron_1.ipcRenderer.invoke('localdb-get-cl-accounts'),
    // Omset
    localDbUpsertOmset: (rows) => electron_1.ipcRenderer.invoke('localdb-upsert-omset', rows),
    localDbGetOmset: (businessId, startDate, endDate) => electron_1.ipcRenderer.invoke('localdb-get-omset', businessId, startDate, endDate),
    // Printer Management (multi-printer system)
    generateNumericUuid: (businessId) => electron_1.ipcRenderer.invoke('generate-numeric-uuid', businessId),
    getPrinterCounter: (printerType, businessId, increment) => electron_1.ipcRenderer.invoke('get-printer-counter', printerType, businessId, increment),
    getPrinter2Mode: () => electron_1.ipcRenderer.invoke('get-printer2-mode'),
    setPrinter2Mode: (mode) => electron_1.ipcRenderer.invoke('set-printer2-mode', mode),
    getPrinter2AutomationSelections: (businessId) => electron_1.ipcRenderer.invoke('get-printer2-automation-selections', businessId),
    savePrinter2AutomationSelections: (businessId, cycleNumber, selections) => electron_1.ipcRenderer.invoke('save-printer2-automation-selections', businessId, cycleNumber, selections),
    generateRandomSelections: (cycleNumber) => electron_1.ipcRenderer.invoke('generate-random-selections', cycleNumber),
    logPrinter2Print: (transactionId, printer2ReceiptNumber, mode, cycleNumber) => electron_1.ipcRenderer.invoke('log-printer2-print', transactionId, printer2ReceiptNumber, mode, cycleNumber),
    getPrinter2AuditLog: (fromDate, toDate, limit) => electron_1.ipcRenderer.invoke('get-printer2-audit-log', fromDate, toDate, limit),
    logPrinter1Print: (transactionId, printer1ReceiptNumber) => electron_1.ipcRenderer.invoke('log-printer1-print', transactionId, printer1ReceiptNumber),
    getPrinter1AuditLog: (fromDate, toDate, limit) => electron_1.ipcRenderer.invoke('get-printer1-audit-log', fromDate, toDate, limit),
    // Printer audit sync helpers
    localDbGetUnsyncedPrinterAudits: () => electron_1.ipcRenderer.invoke('localdb-get-unsynced-printer-audits'),
    localDbMarkPrinterAuditsSynced: (ids) => electron_1.ipcRenderer.invoke('localdb-mark-printer-audits-synced', ids),
    // Customer display event listeners
    onOrderUpdate: (callback) => {
        electron_1.ipcRenderer.on('order-update', (event, data) => callback(data));
    },
    onSlideshowUpdate: (callback) => {
        electron_1.ipcRenderer.on('slideshow-update', (event, data) => callback(data));
    },
});
