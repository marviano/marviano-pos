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
    // Menu events
    onMenuNewOrder: (callback) => {
        electron_1.ipcRenderer.on('menu-new-order', callback);
    },
});
