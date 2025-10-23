"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
electron_1.contextBridge.exposeInMainWorld('electronAPI', {
    // POS functionality
    printReceipt: (data) => electron_1.ipcRenderer.invoke('print-receipt', data),
    openCashDrawer: () => electron_1.ipcRenderer.invoke('open-cash-drawer'),
    playSound: (soundType) => electron_1.ipcRenderer.invoke('play-sound', soundType),
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
    // Customer display event listeners
    onOrderUpdate: (callback) => {
        electron_1.ipcRenderer.on('order-update', (event, data) => callback(data));
    },
    onSlideshowUpdate: (callback) => {
        electron_1.ipcRenderer.on('slideshow-update', (event, data) => callback(data));
    },
});
