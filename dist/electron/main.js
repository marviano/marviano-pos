"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path = __importStar(require("path"));
const isDev = process.env.NODE_ENV === 'development' || !electron_1.app.isPackaged;
function createWindow() {
    // Get screen dimensions
    const { width: screenWidth, height: screenHeight } = electron_1.screen.getPrimaryDisplay().workAreaSize;
    // Calculate window dimensions (50% of screen width)
    const windowWidth = Math.floor(screenWidth * 0.5);
    const windowHeight = Math.floor(480 * 0.9); // Reduce height by 10% (432px)
    // Create the browser window
    const mainWindow = new electron_1.BrowserWindow({
        width: windowWidth,
        height: windowHeight,
        minWidth: 600,
        minHeight: 400,
        title: 'Marviano POS',
        frame: false, // Remove window frame (title bar, menu bar, borders)
        backgroundColor: '#111827', // Dark gray background to match the login page
        movable: true, // Make window draggable
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
        },
        show: false, // Don't show until ready
    });
    // Load the app - start with login page
    console.log('🔍 isDev:', isDev);
    if (isDev) {
        console.log('🔍 Development mode detected');
        // Wait a bit for Next.js to start, then load the login page
        setTimeout(() => {
            console.log('🔍 Loading login page...');
            // Load the login page directly
            mainWindow.loadURL('http://localhost:3000/login').then(() => {
                console.log('✅ Successfully loaded login page');
                // mainWindow.webContents.openDevTools(); // Commented out to hide dev tools
            }).catch((error) => {
                console.error('❌ Failed to load login page:', error);
                // Fallback to main page if login fails
                mainWindow.loadURL('http://localhost:3000').catch((fallbackError) => {
                    console.error('❌ Failed to load fallback page:', fallbackError);
                });
            });
        }, 3000); // Wait for Next.js to be ready
    }
    else {
        // In production, load the built Next.js app
        mainWindow.loadFile(path.join(__dirname, '../out/index.html'));
    }
    // Show window when ready
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        // Focus on the window
        if (isDev) {
            mainWindow.focus();
        }
    });
    // Handle window closed
    mainWindow.on('closed', () => {
        // Dereference the window object
    });
    // Create application menu
    const template = [
        {
            label: 'File',
            submenu: [
                {
                    label: 'New Order',
                    accelerator: 'CmdOrCtrl+N',
                    click: () => {
                        mainWindow.webContents.send('menu-new-order');
                    },
                },
                {
                    label: 'Close',
                    accelerator: 'CmdOrCtrl+W',
                    click: () => {
                        mainWindow.close();
                    },
                },
            ],
        },
        {
            label: 'View',
            submenu: [
                { role: 'reload' },
                { role: 'forceReload' },
                { role: 'toggleDevTools' },
                { type: 'separator' },
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
                { type: 'separator' },
                { role: 'togglefullscreen' },
            ],
        },
        {
            label: 'Window',
            submenu: [
                { role: 'minimize' },
                { role: 'close' },
            ],
        },
    ];
    const menu = electron_1.Menu.buildFromTemplate(template);
    electron_1.Menu.setApplicationMenu(menu);
}
// This method will be called when Electron has finished initialization
electron_1.app.whenReady().then(() => {
    createWindow();
    electron_1.app.on('activate', () => {
        // On macOS, re-create a window when the dock icon is clicked
        if (electron_1.BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});
// Quit when all windows are closed
electron_1.app.on('window-all-closed', () => {
    // On macOS, keep the app running even when all windows are closed
    if (process.platform !== 'darwin') {
        electron_1.app.quit();
    }
});
// IPC handlers for POS-specific functionality
electron_1.ipcMain.handle('print-receipt', async (event, data) => {
    // Handle receipt printing
    console.log('Printing receipt:', data);
    // Implement actual printing logic here
    return { success: true };
});
electron_1.ipcMain.handle('open-cash-drawer', async () => {
    // Handle cash drawer opening
    console.log('Opening cash drawer');
    // Implement actual cash drawer logic here
    return { success: true };
});
electron_1.ipcMain.handle('play-sound', async (event, soundType) => {
    // Handle POS sounds
    console.log('Playing sound:', soundType);
    // Implement actual sound logic here
    return { success: true };
});
// IPC handlers for authentication and window control
electron_1.ipcMain.handle('close-window', async () => {
    const windows = electron_1.BrowserWindow.getAllWindows();
    if (windows.length > 0) {
        windows[0].close();
    }
    return { success: true };
});
electron_1.ipcMain.handle('minimize-window', async () => {
    const windows = electron_1.BrowserWindow.getAllWindows();
    if (windows.length > 0) {
        windows[0].minimize();
    }
    return { success: true };
});
electron_1.ipcMain.handle('maximize-window', async () => {
    const windows = electron_1.BrowserWindow.getAllWindows();
    if (windows.length > 0) {
        if (windows[0].isMaximized()) {
            windows[0].unmaximize();
        }
        else {
            windows[0].maximize();
        }
    }
    return { success: true };
});
electron_1.ipcMain.handle('navigate-to', async (event, path) => {
    const windows = electron_1.BrowserWindow.getAllWindows();
    if (windows.length > 0) {
        const currentURL = windows[0].webContents.getURL();
        const baseURL = currentURL.split('/').slice(0, 3).join('/');
        windows[0].loadURL(`${baseURL}${path}`);
    }
    return { success: true };
});
