import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // POS functionality
  printReceipt: (data: any) => ipcRenderer.invoke('print-receipt', data),
  openCashDrawer: () => ipcRenderer.invoke('open-cash-drawer'),
  playSound: (soundType: string) => ipcRenderer.invoke('play-sound', soundType),
  
  // Window controls
  closeWindow: () => ipcRenderer.invoke('close-window'),
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  maximizeWindow: () => ipcRenderer.invoke('maximize-window'),
  navigateTo: (path: string) => ipcRenderer.invoke('navigate-to', path),
  
  // Menu events
  onMenuNewOrder: (callback: () => void) => {
    ipcRenderer.on('menu-new-order', callback);
  },
});

