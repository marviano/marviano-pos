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
  
  // Customer display event listeners
  onOrderUpdate: (callback: (data: any) => void) => {
    ipcRenderer.on('order-update', (event, data) => callback(data));
  },
  onSlideshowUpdate: (callback: (data: any) => void) => {
    ipcRenderer.on('slideshow-update', (event, data) => callback(data));
  },
});

