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
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const printerManagement_1 = require("./printerManagement");
const mysqlDb_1 = require("./mysqlDb");
const mysqlSchema_1 = require("./mysqlSchema");
const configManager_1 = require("./configManager");
// Store original console functions early (before they might be suppressed)
// These are used to bypass console suppression for critical error messages
const originalConsoleLog = console.log.bind(console);
const originalConsoleError = console.error.bind(console);
const originalConsoleInfo = console.info.bind(console);
const originalConsoleDebug = console.debug.bind(console);
// Helper function to safely write to debug.log (ensures directory exists)
function writeDebugLog(data) {
    try {
        const debugLogPath = path.join(__dirname, '..', '.cursor', 'debug.log');
        const debugLogDir = path.dirname(debugLogPath);
        // Ensure directory exists
        if (!fs.existsSync(debugLogDir)) {
            fs.mkdirSync(debugLogDir, { recursive: true });
        }
        // Append to log file
        fs.appendFileSync(debugLogPath, data + '\n');
    }
    catch (error) {
        // Silently fail - debug logging should not break the application
        // Only log to console if it's a critical error
        if (error instanceof Error && !error.message.includes('ENOENT')) {
            console.warn('Failed to write to debug.log:', error.message);
        }
    }
}
// MySQL pool will be initialized in createWindow
// MySQL database will be initialized in createWindow function
// Register custom protocol before app is ready
electron_1.protocol.registerSchemesAsPrivileged([
    {
        scheme: 'slideshow-file',
        privileges: {
            secure: true,
            supportFetchAPI: true,
            bypassCSP: true,
            corsEnabled: true,
            standard: true
        }
    }
]);
const parseJsonArray = (value, context) => {
    if (!value) {
        return [];
    }
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [];
        }
        catch (error) {
            console.warn(`⚠️ Failed to parse JSON array${context ? ` for ${context}` : ''}:`, error);
            return [];
        }
    }
    if (Array.isArray(value)) {
        return value;
    }
    return [];
};
/**
 * Reads customizations from normalized tables (NO JSON)
 * bundleProductId: NULL/undefined = main product, number = specific bundle product
 */
const readCustomizationsFromNormalizedTables = async (transactionItemUuid, bundleProductId) => {
    try {
        // Look up the INT id from transaction_items using UUID
        const itemRow = await (0, mysqlDb_1.executeQueryOne)('SELECT id FROM transaction_items WHERE uuid_id = ? LIMIT 1', [transactionItemUuid]);
        if (!itemRow || typeof itemRow.id !== 'number') {
            return null;
        }
        const transactionItemId = itemRow.id;
        // Read from normalized tables - filter by bundle_product_id
        const customizations = await (0, mysqlDb_1.executeQuery)(`
      SELECT 
        tic.customization_type_id as customization_id,
        pct.name as customization_name,
        tico.customization_option_id as option_id,
        tico.option_name,
        tico.price_adjustment,
        tic.bundle_product_id
      FROM transaction_item_customizations tic
      JOIN product_customization_types pct ON tic.customization_type_id = pct.id
      LEFT JOIN transaction_item_customization_options tico ON tic.id = tico.transaction_item_customization_id
      WHERE tic.transaction_item_id = ?
        AND (tic.bundle_product_id IS NULL AND ? IS NULL OR tic.bundle_product_id = ?)
      ORDER BY tic.id, tico.id
    `, [transactionItemId, bundleProductId || null, bundleProductId || null]);
        if (customizations.length === 0) {
            return null;
        }
        // Group by customization type
        const grouped = new Map();
        for (const row of customizations) {
            if (!grouped.has(row.customization_id)) {
                grouped.set(row.customization_id, {
                    customization_id: row.customization_id,
                    customization_name: row.customization_name,
                    selected_options: []
                });
            }
            const customization = grouped.get(row.customization_id);
            if (row.option_id && row.option_name !== null) {
                customization.selected_options = customization.selected_options || [];
                customization.selected_options.push({
                    option_id: row.option_id,
                    option_name: row.option_name,
                    price_adjustment: row.price_adjustment || 0
                });
            }
        }
        return Array.from(grouped.values());
    }
    catch (error) {
        console.warn('⚠️ Error reading from normalized tables:', error);
        return null;
    }
};
/**
 * Saves customizations to normalized tables for analytics
 * NO JSON - only normalized tables
 */
const saveCustomizationsToNormalizedTables = async (transactionItemUuid, customizations, createdAt, bundleProductId // NULL or undefined = main product, number = bundle product ID
) => {
    if (!customizations || !Array.isArray(customizations) || customizations.length === 0) {
        return;
    }
    try {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/7b565785-72b5-49f7-b2c0-57606ea0d0b5', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'main.ts:296', message: 'saveCustomizationsToNormalizedTables entry', data: { transactionItemUuid, customizationsCount: customizations.length, bundleProductId }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'H' }) }).catch(() => { });
        // #endregion
        // Look up the INT id from transaction_items using UUID
        const itemRow = await (0, mysqlDb_1.executeQueryOne)('SELECT id FROM transaction_items WHERE uuid_id = ? LIMIT 1', [transactionItemUuid]);
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/7b565785-72b5-49f7-b2c0-57606ea0d0b5', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'main.ts:301', message: 'Item lookup result', data: { transactionItemUuid, itemFound: !!itemRow, itemId: itemRow?.id }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'H' }) }).catch(() => { });
        // #endregion
        if (!itemRow || typeof itemRow.id !== 'number') {
            console.warn(`⚠️ Transaction item UUID ${transactionItemUuid} not found, skipping customizations save`);
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/7b565785-72b5-49f7-b2c0-57606ea0d0b5', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'main.ts:305', message: 'Item not found - skipping', data: { transactionItemUuid }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'H' }) }).catch(() => { });
            // #endregion
            return;
        }
        const transactionItemId = itemRow.id;
        // Convert createdAt to MySQL format (YYYY-MM-DD HH:MM:SS)
        // Handle ISO strings, Date objects, or already-formatted strings
        let mysqlCreatedAt;
        if (typeof createdAt === 'string') {
            // If it's an ISO string (contains 'T' or 'Z'), convert it
            if (createdAt.includes('T') || createdAt.includes('Z')) {
                const converted = (0, mysqlDb_1.toMySQLTimestamp)(createdAt);
                mysqlCreatedAt = converted || (0, mysqlDb_1.toMySQLTimestamp)(new Date()) || '';
            }
            else {
                // Already in MySQL format
                mysqlCreatedAt = createdAt;
            }
        }
        else {
            // Fallback: convert to MySQL format
            const converted = (0, mysqlDb_1.toMySQLTimestamp)(createdAt || new Date());
            mysqlCreatedAt = converted || (0, mysqlDb_1.toMySQLTimestamp)(new Date()) || '';
        }
        if (!mysqlCreatedAt) {
            console.warn('⚠️ Failed to convert createdAt to MySQL format, using current timestamp');
            mysqlCreatedAt = (0, mysqlDb_1.toMySQLTimestamp)(new Date()) || new Date().toISOString().replace('T', ' ').slice(0, 19);
        }
        const connection = await (0, mysqlDb_1.getConnection)();
        try {
            await connection.beginTransaction();
            // Delete existing normalized data for this transaction item and bundle product (in case of update)
            await connection.query(`
        DELETE FROM transaction_item_customization_options 
        WHERE transaction_item_customization_id IN (
          SELECT id FROM transaction_item_customizations 
          WHERE transaction_item_id = ? 
            AND (bundle_product_id IS NULL AND ? IS NULL OR bundle_product_id = ?)
        )
      `, [transactionItemId, bundleProductId || null, bundleProductId || null]);
            await connection.query(`
        DELETE FROM transaction_item_customizations 
        WHERE transaction_item_id = ? 
          AND (bundle_product_id IS NULL AND ? IS NULL OR bundle_product_id = ?)
      `, [transactionItemId, bundleProductId || null, bundleProductId || null]);
            // Insert into normalized tables
            for (const customization of customizations) {
                const customizationId = Number(customization.customization_id);
                if (!customizationId || Number.isNaN(customizationId)) {
                    console.warn('⚠️ Invalid customization_id:', customization.customization_id);
                    continue;
                }
                // Insert customization type link (use INT id and UUID)
                const [ticResult] = await connection.query(`
          INSERT INTO transaction_item_customizations (transaction_item_id, uuid_transaction_item_id, customization_type_id, bundle_product_id, created_at)
          VALUES (?, ?, ?, ?, ?)
        `, [transactionItemId, transactionItemUuid, customizationId, bundleProductId || null, mysqlCreatedAt]);
                const ticId = ticResult.insertId;
                // Insert selected options
                if (Array.isArray(customization.selected_options)) {
                    for (const option of customization.selected_options) {
                        const optionId = Number(option.option_id);
                        if (!optionId || Number.isNaN(optionId)) {
                            console.warn('⚠️ Invalid option_id:', option.option_id);
                            continue;
                        }
                        const optionName = option.option_name || 'Unknown Option';
                        const priceAdjustment = Number(option.price_adjustment) || 0;
                        await connection.query(`
              INSERT INTO transaction_item_customization_options (
                transaction_item_customization_id, customization_option_id, option_name, price_adjustment, created_at
              ) VALUES (?, ?, ?, ?, ?)
            `, [ticId, optionId, optionName, priceAdjustment, mysqlCreatedAt]);
                    }
                }
            }
            await connection.commit();
        }
        catch (error) {
            await connection.rollback();
            throw error;
        }
        finally {
            connection.release();
        }
    }
    catch (error) {
        console.error('❌ Error saving customizations to normalized tables:', error);
        // Don't throw - we want to continue even if normalized save fails
        // The JSON format is still saved, so data is not lost
    }
};
const isDev = process.env.NODE_ENV === 'development' || !electron_1.app.isPackaged;
const shouldLog = process.env.POS_DEBUG_LOGS === 'true';
if (!shouldLog) {
    console.log = () => { };
    console.info = () => { };
    console.debug = () => { };
}
// Global references to windows and services
let mainWindow = null;
let customerWindow = null;
let printWindow = null;
// MySQL pool is managed by mysqlDb module
let printerService = null;
let printQueue = [];
let isProcessingQueue = false;
async function processPrintQueue() {
    if (isProcessingQueue || printQueue.length === 0) {
        return;
    }
    isProcessingQueue = true;
    console.log(`📋 [PRINT QUEUE] Processing queue, ${printQueue.length} job(s) pending`);
    while (printQueue.length > 0) {
        const job = printQueue.shift();
        if (!job)
            break;
        try {
            console.log(`🖨️ [PRINT QUEUE] Processing ${job.type} job`);
            let result;
            if (job.type === 'label') {
                result = await executeLabelPrint(job.data);
            }
            else {
                result = await executeLabelsBatchPrint(job.data);
            }
            job.resolve(result);
            console.log(`✅ [PRINT QUEUE] ${job.type} job completed`);
        }
        catch (error) {
            console.error(`❌ [PRINT QUEUE] ${job.type} job failed:`, error);
            job.reject(error instanceof Error ? error : new Error(String(error)));
        }
        // Small delay between jobs to ensure printer is ready
        if (printQueue.length > 0) {
            await new Promise(resolve => setTimeout(resolve, 300));
        }
    }
    isProcessingQueue = false;
    console.log(`✅ [PRINT QUEUE] Queue processing complete`);
}
let windowsInitialized = false;
let ipcHandlersRegistered = false;
function createWindows() {
    // Guard against double initialization
    if (windowsInitialized) {
        originalConsoleLog('⚠️ createWindows() already called, skipping re-initialization');
        return;
    }
    windowsInitialized = true;
    // Initialize MySQL database (local LAN database)
    try {
        originalConsoleLog('🔍 Initializing MySQL database connection...');
        // Initialize MySQL connection pool
        const mysqlPool = (0, mysqlDb_1.initializeMySQLPool)();
        // Initialize MySQL schema
        (0, mysqlSchema_1.initializeMySQLSchema)().catch(err => {
            console.error('❌ Failed to initialize MySQL schema:', err);
        });
        // MySQL pool is already initialized above
        console.log('✅ MySQL database connection initialized (salespulse)');
        // Initialize System POS MySQL connection pool (for printer 2 transactions)
        (0, mysqlDb_1.initializeSystemPosPool)();
        console.log('✅ System POS MySQL database connection initialized (system_pos)');
        // Initialize printer management service with MySQL pool only
        try {
            printerService = new printerManagement_1.PrinterManagementService(mysqlPool);
            console.log('✅ Printer Management Service initialized with MySQL');
        }
        catch (printerServiceError) {
            console.error('❌ Failed to initialize Printer Management Service:', printerServiceError);
        }
        // Migrate slideshow images from /public/ to userData on first run
        try {
            const slideshowPath = getSlideshowPath();
            const publicSlideshowPath = path.join(process.cwd(), 'public', 'images', 'slideshow');
            if (fs.existsSync(publicSlideshowPath)) {
                const existingFiles = fs.readdirSync(slideshowPath);
                const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
                const existingImages = existingFiles.filter((file) => {
                    const ext = path.extname(file).toLowerCase();
                    return imageExtensions.includes(ext);
                });
                if (existingImages.length === 0) {
                    const publicFiles = fs.readdirSync(publicSlideshowPath);
                    const imagesToMigrate = publicFiles.filter((file) => {
                        const ext = path.extname(file).toLowerCase();
                        return imageExtensions.includes(ext);
                    });
                    if (imagesToMigrate.length > 0) {
                        console.log(`📸 Migrating ${imagesToMigrate.length} slideshow images from /public/ to userData...`);
                        let migratedCount = 0;
                        for (const file of imagesToMigrate) {
                            try {
                                const sourcePath = path.join(publicSlideshowPath, file);
                                const destPath = path.join(slideshowPath, file);
                                fs.copyFileSync(sourcePath, destPath);
                                migratedCount++;
                            }
                            catch (error) {
                                console.error('❌ Failed to migrate:', file, error);
                            }
                        }
                        if (migratedCount > 0) {
                            console.log(`✅ Migrated ${migratedCount} slideshow images to userData`);
                        }
                    }
                }
            }
        }
        catch (error) {
            console.error('❌ Error during slideshow migration:', error);
        }
        console.log('✅ MySQL database initialization completed');
    }
    catch (error) {
        originalConsoleError('❌ Failed to initialize MySQL:', error);
    }
    // Get all displays
    const displays = electron_1.screen.getAllDisplays();
    const primaryDisplay = electron_1.screen.getPrimaryDisplay();
    const secondaryDisplay = displays.find(display => display.id !== primaryDisplay.id);
    console.log('🔍 Detected displays:', displays.length);
    console.log('🔍 All displays:', displays.map(d => ({ id: d.id, bounds: d.bounds, workArea: d.workArea })));
    console.log('🔍 Primary display:', primaryDisplay.bounds);
    if (secondaryDisplay) {
        console.log('🔍 Secondary display found:', secondaryDisplay.bounds);
    }
    else {
        console.log('❌ No secondary display detected');
    }
    // Create main POS window (cashier display)
    // Start with login size (800x432), will be resized after successful login
    mainWindow = new electron_1.BrowserWindow({
        width: 800,
        height: 432,
        center: true,
        minWidth: 800,
        minHeight: 432,
        title: 'Marviano POS - Login',
        frame: false,
        backgroundColor: '#111827',
        movable: true,
        resizable: false, // Don't allow resizing on login
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            devTools: true, // Enable dev tools for debugging
        },
        show: false,
    });
    // Create customer display window if secondary monitor is available
    if (secondaryDisplay) {
        console.log('🔍 Creating customer display window...');
        const { bounds } = secondaryDisplay;
        const customerWindowWidth = bounds.width;
        const customerWindowHeight = bounds.height;
        const customerWindowX = bounds.x;
        const customerWindowY = bounds.y;
        console.log('🔍 Customer window dimensions:', { width: customerWindowWidth, height: customerWindowHeight });
        console.log('🔍 Customer window position:', { x: customerWindowX, y: customerWindowY });
        customerWindow = new electron_1.BrowserWindow({
            width: customerWindowWidth,
            height: customerWindowHeight,
            x: customerWindowX,
            y: customerWindowY,
            title: 'Marviano POS - Customer Display',
            frame: false,
            backgroundColor: '#000000',
            alwaysOnTop: true,
            kiosk: false, // Temporarily disable kiosk mode for debugging
            fullscreenable: true,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: path.join(__dirname, 'preload.js'),
            },
            show: false,
        });
        console.log('✅ Customer window created successfully');
        // Load customer display page
        if (isDev) {
            setTimeout(async () => {
                console.log('🔍 Loading customer display page...');
                const tryLoadCustomerURL = async (port) => {
                    try {
                        await customerWindow.loadURL(`http://localhost:${port}/customer-display`);
                        console.log(`✅ Customer display page loaded successfully on port ${port}`);
                        return true;
                    }
                    catch (error) {
                        console.log(`❌ Failed to load customer display on port ${port}:`, error);
                        return false;
                    }
                };
                const preferredPort = Number(process.env.PORT ?? '');
                const fallbackPorts = [3000, 3001, 3002];
                const ports = [
                    ...(Number.isFinite(preferredPort) ? [preferredPort] : []),
                    ...fallbackPorts
                ].filter((port, index, arr) => arr.indexOf(port) === index);
                let loaded = false;
                for (const port of ports) {
                    if (await tryLoadCustomerURL(port)) {
                        loaded = true;
                        break;
                    }
                }
                if (!loaded) {
                    console.error('❌ Failed to load customer display on any port');
                }
            }, 6000); // Load after main window
        }
        else {
            customerWindow.loadFile(path.join(__dirname, '../../out/customer-display.html'));
        }
    }
    else {
        console.log('❌ Cannot create customer display - no secondary monitor detected');
    }
    // Listen for navigation events
    mainWindow.webContents.on('did-navigate', (event, url) => {
        const currentURL = new URL(url);
        console.log('🔍 Navigation detected:', currentURL.pathname);
        const isLogin = currentURL.pathname === '/login' || currentURL.pathname.endsWith('login.html');
        if (isLogin) {
            // Keep login page at 800x432
            console.log('🔍 Login page detected - setting login window size');
            mainWindow.setFullScreen(false);
            mainWindow.setResizable(false);
            mainWindow.setSize(800, 432);
            mainWindow.center();
        }
        else {
            // Main POS page - set to fullscreen
            console.log('🔍 Main POS page detected - setting fullscreen');
            mainWindow.setResizable(true);
            mainWindow.setFullScreen(true);
        }
    });
    // Also listen for hash changes (for client-side routing)
    mainWindow.webContents.on('did-navigate-in-page', (event, url) => {
        const currentURL = new URL(url);
        console.log('🔍 In-page navigation detected:', currentURL.pathname);
        const isLogin = currentURL.pathname === '/login' || currentURL.pathname.endsWith('login.html');
        if (isLogin) {
            // Keep login page at 800x432
            console.log('🔍 Login page detected - setting login window size');
            mainWindow.setFullScreen(false);
            mainWindow.setResizable(false);
            mainWindow.setSize(800, 432);
            mainWindow.center();
        }
        else {
            // Main POS page - set to fullscreen
            console.log('🔍 Main POS page detected - setting fullscreen');
            mainWindow.setResizable(true);
            mainWindow.setFullScreen(true);
        }
    });
    // Add IPC handler for focusing window (fix for Windows 11 frameless window focus issue)
    electron_1.ipcMain.handle('focus-window', async () => {
        try {
            if (mainWindow && !mainWindow.isDestroyed()) {
                if (mainWindow.isMinimized()) {
                    mainWindow.restore();
                }
                mainWindow.focus();
                return { success: true };
            }
            return { success: false, error: 'Window not available' };
        }
        catch (error) {
            console.error('Error focusing window:', error);
            return { success: false, error: String(error) };
        }
    });
    // Listen for successful login via IPC - THIS is when we go fullscreen
    electron_1.ipcMain.handle('login-success', async () => {
        console.log('🔍 [ELECTRON] Login success IPC received!');
        console.log('🔍 [ELECTRON] Main window exists:', !!mainWindow);
        console.log('🔍 [ELECTRON] Main window isDestroyed:', mainWindow?.isDestroyed());
        console.log('🔍 [ELECTRON] Main window isVisible:', mainWindow?.isVisible());
        console.log('🔍 [ELECTRON] Main window isFullScreen:', mainWindow?.isFullScreen());
        if (mainWindow && !mainWindow.isDestroyed()) {
            console.log('🔍 [ELECTRON] Setting fullscreen in 300ms...');
            setTimeout(() => {
                console.log('🔍 [ELECTRON] Now setting fullscreen...');
                try {
                    mainWindow.setResizable(true);
                    console.log('🔍 [ELECTRON] Resizable set to true');
                    mainWindow.setFullScreen(true);
                    console.log('🔍 [ELECTRON] Fullscreen set to true');
                    console.log('🔍 [ELECTRON] Final isFullScreen:', mainWindow.isFullScreen());
                }
                catch (error) {
                    console.error('🔍 [ELECTRON] Error setting fullscreen:', error);
                }
            }, 300);
        }
        else {
            console.log('🔍 [ELECTRON] Cannot set fullscreen - window not available');
        }
        return { success: true };
    });
    // Configuration management IPC handlers
    electron_1.ipcMain.handle('get-app-config', async () => {
        try {
            const config = (0, configManager_1.readConfig)();
            return { success: true, config: config || null };
        }
        catch (error) {
            console.error('❌ Failed to read app config:', error);
            return { success: false, error: String(error) };
        }
    });
    electron_1.ipcMain.handle('save-app-config', async (event, config) => {
        try {
            const success = (0, configManager_1.writeConfig)(config);
            if (success) {
                console.log('✅ App config saved successfully');
                return { success: true };
            }
            else {
                return { success: false, error: 'Failed to write config file' };
            }
        }
        catch (error) {
            console.error('❌ Failed to save app config:', error);
            return { success: false, error: String(error) };
        }
    });
    electron_1.ipcMain.handle('reset-app-config', async () => {
        try {
            const success = (0, configManager_1.resetConfig)();
            if (success) {
                console.log('✅ App config reset successfully');
                return { success: true };
            }
            else {
                return { success: false, error: 'Failed to reset config file' };
            }
        }
        catch (error) {
            console.error('❌ Failed to reset app config:', error);
            return { success: false, error: String(error) };
        }
    });
    electron_1.ipcMain.handle('test-db-connection', async (event, config) => {
        try {
            const result = await (0, mysqlDb_1.testDatabaseConnection)(config);
            return result;
        }
        catch (error) {
            console.error('❌ Failed to test database connection:', error);
            return { success: false, error: String(error) };
        }
    });
    // Listen for logout via IPC
    electron_1.ipcMain.handle('logout', async () => {
        console.log('🔍 Logout - resizing back to login size');
        if (mainWindow) {
            mainWindow.setFullScreen(false);
            mainWindow.setResizable(false);
            mainWindow.setSize(800, 432);
            mainWindow.center();
        }
        return { success: true };
    });
    // Offline/local DB IPC
    electron_1.ipcMain.handle('localdb-upsert-categories', async (event, rows) => {
        try {
            // Legacy table - may not exist in MySQL schema, skip gracefully
            // Category2 table is the source of truth
            console.log('⚠️ [CATEGORIES] Skipping legacy categories table - category2 is source of truth');
            return { success: true };
        }
        catch (error) {
            console.error('Error upserting categories:', error);
            return { success: false };
        }
    });
    electron_1.ipcMain.handle('localdb-get-categories', async (event, businessId) => {
        try {
            // Get categories from products filtered by business (if businessId provided)
            // This ensures categories match the products available for the business
            let query = `SELECT DISTINCT c2.name AS category2_name, c2.updated_at, c2.display_order
        FROM category2 c2
        INNER JOIN products p ON p.category2_id = c2.id`;
            const params = [];
            // Add business filter if businessId is provided
            if (businessId) {
                query += ` INNER JOIN product_businesses pb ON p.id = pb.product_id`;
            }
            query += ` WHERE p.status = 'active' AND c2.is_active = 1`;
            if (businessId) {
                query += ` AND pb.business_id = ?`;
                params.push(businessId);
            }
            query += ` ORDER BY c2.display_order ASC, c2.name ASC`;
            return await (0, mysqlDb_1.executeQuery)(query, params);
        }
        catch (error) {
            console.error('Error getting categories:', error);
            return [];
        }
    });
    electron_1.ipcMain.handle('localdb-upsert-product-businesses', async (event, rows) => {
        try {
            const queries = [];
            // Verify business_id and product_id exist before inserting (foreign key constraints)
            const validJunctionData = [];
            for (const rel of rows) {
                try {
                    const [businessExists, productExists] = await Promise.all([
                        (0, mysqlDb_1.executeQueryOne)('SELECT id FROM businesses WHERE id = ? LIMIT 1', [rel.business_id]),
                        (0, mysqlDb_1.executeQueryOne)('SELECT id FROM products WHERE id = ? LIMIT 1', [rel.product_id])
                    ]);
                    if (!businessExists) {
                        console.warn(`⚠️ [PRODUCT BUSINESSES UPSERT] Skipping: business_id ${rel.business_id} does not exist`);
                        continue;
                    }
                    if (!productExists) {
                        console.warn(`⚠️ [PRODUCT BUSINESSES UPSERT] Skipping: product_id ${rel.product_id} does not exist`);
                        continue;
                    }
                    validJunctionData.push(rel);
                }
                catch (checkError) {
                    console.warn(`⚠️ [PRODUCT BUSINESSES UPSERT] Error checking product_id ${rel.product_id}, business_id ${rel.business_id}:`, checkError);
                    continue;
                }
            }
            if (validJunctionData.length > 0) {
                const junctionQueries = validJunctionData.map(rel => ({
                    sql: `
            INSERT INTO product_businesses (product_id, business_id)
            VALUES (?, ?)
            ON DUPLICATE KEY UPDATE product_id=product_id
          `,
                    params: [rel.product_id, rel.business_id]
                }));
                queries.push(...junctionQueries);
                console.log(`✅ [PRODUCT BUSINESSES UPSERT] Stored ${validJunctionData.length} product-business relationships (${rows.length - validJunctionData.length} skipped)`);
            }
            else {
                console.warn(`⚠️ [PRODUCT BUSINESSES UPSERT] No valid junction table data (all ${rows.length} skipped)`);
            }
            if (queries.length > 0) {
                await (0, mysqlDb_1.executeTransaction)(queries);
            }
            return { success: true };
        }
        catch (error) {
            console.error('Error upserting product_businesses:', error);
            return { success: false };
        }
    });
    electron_1.ipcMain.handle('localdb-upsert-products', async (event, rows) => {
        console.log(`🔄 [PRODUCTS UPSERT] Received ${rows.length} products to upsert`);
        let successCount = 0;
        let errorCount = 0;
        const queries = [];
        for (const r of rows) {
            try {
                // Type-safe property accessors
                const getId = () => (typeof r.id === 'number' || typeof r.id === 'string') ? Number(r.id) : null;
                const getString = (key) => (typeof r[key] === 'string' ? r[key] : '');
                const getNumber = (key) => {
                    const val = r[key];
                    if (typeof val === 'number')
                        return val;
                    if (typeof val === 'string') {
                        const num = Number(val);
                        return isNaN(num) ? null : num;
                    }
                    return null;
                };
                const getDate = (key) => {
                    const val = r[key];
                    if (val instanceof Date)
                        return val;
                    if (typeof val === 'string' || typeof val === 'number')
                        return val;
                    return null;
                };
                // Check if product has any platform prices (for online tabs)
                const hasPlatformPrice = (r.harga_shopeefood != null && r.harga_shopeefood !== undefined) ||
                    (r.harga_gofood != null && r.harga_gofood !== undefined) ||
                    (r.harga_grabfood != null && r.harga_grabfood !== undefined) ||
                    (r.harga_tiktok != null && r.harga_tiktok !== undefined) ||
                    (r.harga_qpon != null && r.harga_qpon !== undefined) ||
                    (r.harga_online != null && r.harga_online !== undefined);
                // Skip products with NULL harga_jual ONLY if they also have no platform prices
                // If they have platform prices, we'll use harga_jual = 0 as fallback so they show in online tabs
                const hargaJualRaw = getNumber('harga_jual');
                if ((hargaJualRaw == null) && !hasPlatformPrice) {
                    const productId = getId();
                    const productName = getString('nama');
                    console.log(`⏭️ [PRODUCTS UPSERT] Skipping product ${productId} (${productName}) - harga_jual is NULL and no platform prices`);
                    continue;
                }
                // Use 0 as fallback for harga_jual if NULL but product has platform prices
                const hargaJual = hargaJualRaw ?? 0;
                // Map MySQL columns
                const kategori = (typeof r.kategori === 'string' ? r.kategori : '') || (typeof r.category1_name === 'string' ? r.category1_name : '') || '';
                let category1Id = getNumber('category1_id');
                let category2Id = getNumber('category2_id');
                const category2Name = (typeof r.category2_name === 'string' ? r.category2_name : '') || (typeof r.jenis === 'string' ? r.jenis : '') || '';
                // If category1_id is missing but category1_name/kategori exists, try to map it
                if (!category1Id && (typeof r.category1_name === 'string' || typeof r.kategori === 'string')) {
                    const categoryName = String(r.category1_name || r.kategori || '').toLowerCase().trim();
                    if (categoryName === 'makanan' || categoryName === 'food') {
                        category1Id = 1;
                    }
                    else if (categoryName === 'minuman' || categoryName === 'drinks' || categoryName === 'drink') {
                        category1Id = 2;
                    }
                    if (category1Id) {
                        console.log(`✅ [PRODUCTS UPSERT] Mapped category1_name "${r.category1_name || r.kategori}" to category1_id: ${category1Id}`);
                    }
                }
                // If category2_id is missing but category2_name exists, try to look it up from category2 table
                if (!category2Id && category2Name) {
                    try {
                        const category2Lookup = await (0, mysqlDb_1.executeQueryOne)('SELECT id FROM category2 WHERE name = ? LIMIT 1', [category2Name]);
                        if (category2Lookup) {
                            category2Id = category2Lookup.id;
                            console.log(`✅ [PRODUCTS UPSERT] Looked up category2_id ${category2Id} for category2_name "${category2Name}"`);
                        }
                    }
                    catch (lookupError) {
                        console.warn(`⚠️ [PRODUCTS UPSERT] Failed to lookup category2_id for "${category2Name}":`, lookupError);
                    }
                }
                // Verify category1_id exists before inserting (foreign key constraint)
                if (category1Id) {
                    try {
                        const category1Exists = await (0, mysqlDb_1.executeQueryOne)('SELECT id FROM category1 WHERE id = ? LIMIT 1', [category1Id]);
                        if (!category1Exists) {
                            console.warn(`⚠️ [PRODUCTS UPSERT] category1_id ${category1Id} does not exist, setting to NULL`);
                            category1Id = null;
                        }
                    }
                    catch (checkError) {
                        console.warn(`⚠️ [PRODUCTS UPSERT] Failed to verify category1_id ${category1Id}:`, checkError);
                        category1Id = null;
                    }
                }
                // Verify category2_id exists before inserting (foreign key constraint)
                if (category2Id) {
                    try {
                        const category2Exists = await (0, mysqlDb_1.executeQueryOne)('SELECT id FROM category2 WHERE id = ? LIMIT 1', [category2Id]);
                        if (!category2Exists) {
                            console.warn(`⚠️ [PRODUCTS UPSERT] category2_id ${category2Id} does not exist, setting to NULL`);
                            category2Id = null;
                        }
                    }
                    catch (checkError) {
                        console.warn(`⚠️ [PRODUCTS UPSERT] Failed to verify category2_id ${category2Id}:`, checkError);
                        category2Id = null;
                    }
                }
                const isBundle = (r.is_bundle === 1 || r.is_bundle === true) ? 1 : 0;
                const hasCustomization = (r.has_customization === 1 || r.has_customization === true) ? 1 : 0;
                const productId = getId();
                const menuCode = typeof r.menu_code === 'string' ? r.menu_code : (typeof r.menu_code === 'number' ? String(r.menu_code) : null);
                const nama = getString('nama');
                const satuan = getString('satuan') || '';
                const keterangan = typeof r.keterangan === 'string' ? r.keterangan : null;
                const hargaBeli = getNumber('harga_beli');
                const ppn = getNumber('ppn');
                const hargaKhusus = getNumber('harga_khusus');
                const hargaOnline = getNumber('harga_online');
                const hargaQpon = getNumber('harga_qpon');
                const hargaGofood = getNumber('harga_gofood');
                const hargaGrabfood = getNumber('harga_grabfood');
                const hargaShopeefood = getNumber('harga_shopeefood');
                const hargaTiktok = getNumber('harga_tiktok');
                const feeKerja = getNumber('fee_kerja');
                const imageUrl = typeof r.image_url === 'string' ? r.image_url : null;
                const status = typeof r.status === 'string' ? r.status : (typeof r.status === 'number' ? String(r.status) : null);
                const createdAt = getDate('created_at');
                const createdTimestamp = createdAt ? (0, mysqlDb_1.toMySQLTimestamp)(createdAt) : (0, mysqlDb_1.toMySQLTimestamp)(new Date());
                queries.push({
                    sql: `INSERT INTO products (
            id, menu_code, nama, satuan, category1_id, category2_id, keterangan,
            harga_beli, ppn, harga_jual, harga_khusus, harga_online, harga_qpon, harga_gofood, harga_grabfood, harga_shopeefood, harga_tiktok, fee_kerja, image_url, status, has_customization, is_bundle, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            menu_code=VALUES(menu_code),
            nama=VALUES(nama),
            satuan=VALUES(satuan),
            category1_id=VALUES(category1_id),
            category2_id=VALUES(category2_id),
            keterangan=VALUES(keterangan),
            harga_beli=VALUES(harga_beli),
            ppn=VALUES(ppn),
            harga_jual=VALUES(harga_jual),
            harga_khusus=VALUES(harga_khusus),
            harga_online=VALUES(harga_online),
            harga_qpon=VALUES(harga_qpon),
            harga_gofood=VALUES(harga_gofood),
            harga_grabfood=VALUES(harga_grabfood),
            harga_shopeefood=VALUES(harga_shopeefood),
            harga_tiktok=VALUES(harga_tiktok),
            fee_kerja=VALUES(fee_kerja),
            image_url=VALUES(image_url),
            status=VALUES(status),
            has_customization=VALUES(has_customization),
            is_bundle=VALUES(is_bundle),
            updated_at=VALUES(updated_at)`,
                    params: [
                        productId, menuCode, nama, satuan, category1Id, category2Id, keterangan,
                        hargaBeli, ppn, hargaJual, hargaKhusus, hargaOnline, hargaQpon, hargaGofood, hargaGrabfood, hargaShopeefood, hargaTiktok,
                        feeKerja, imageUrl, status, hasCustomization, isBundle,
                        createdTimestamp, (0, mysqlDb_1.toMySQLTimestamp)(Date.now())
                    ]
                });
                successCount++;
            }
            catch (error) {
                errorCount++;
                const productId = (typeof r.id === 'number' || typeof r.id === 'string') ? Number(r.id) : 'unknown';
                const productName = typeof r.nama === 'string' ? r.nama : 'unknown';
                console.warn(`⚠️ [PRODUCTS UPSERT] Skipping product ${productId} (${productName}) due to error:`, error);
            }
        }
        try {
            if (queries.length > 0) {
                console.log(`🔄 [PRODUCTS UPSERT] Executing transaction with ${queries.length} queries...`);
                await (0, mysqlDb_1.executeTransaction)(queries);
                console.log(`✅ [PRODUCTS UPSERT] Transaction committed successfully`);
            }
            else {
                console.warn('⚠️ [PRODUCTS UPSERT] No queries to execute (all products were skipped)');
            }
            console.log(`✅ [PRODUCTS UPSERT] Completed: ${successCount} success, ${errorCount} errors`);
            return { success: true, inserted: successCount, errors: errorCount };
        }
        catch (error) {
            console.error('❌ [PRODUCTS UPSERT] Transaction failed:', error);
            console.error('❌ [PRODUCTS UPSERT] Error details:', {
                message: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                queryCount: queries.length
            });
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
    });
    electron_1.ipcMain.handle('localdb-cleanup-orphaned-products', async (event, businessId, syncedProductIds) => {
        try {
            if (!Array.isArray(syncedProductIds) || syncedProductIds.length === 0) {
                console.log('ℹ️ [PRODUCTS CLEANUP] No synced product IDs provided, skipping cleanup');
                return { success: true, deletedCount: 0 };
            }
            // Find products that belong to this business but are NOT in the synced list
            const placeholders = syncedProductIds.map(() => '?').join(',');
            const orphanedProductsQuery = `
        SELECT DISTINCT p.id, p.nama
        FROM products p
        INNER JOIN product_businesses pb ON p.id = pb.product_id
        WHERE pb.business_id = ? AND p.id NOT IN (${placeholders})
      `;
            const orphanedProducts = await (0, mysqlDb_1.executeQuery)(orphanedProductsQuery, [businessId, ...syncedProductIds]);
            if (orphanedProducts.length === 0) {
                console.log('✅ [PRODUCTS CLEANUP] No orphaned products found');
                return { success: true, deletedCount: 0 };
            }
            const orphanedProductIds = orphanedProducts.map(p => p.id);
            console.log(`🧹 [PRODUCTS CLEANUP] Found ${orphanedProductIds.length} orphaned products to clean up: ${orphanedProductIds.join(', ')}`);
            const deletePlaceholders = orphanedProductIds.map(() => '?').join(',');
            // Delete in correct order to respect foreign key constraints
            const queries = [];
            // 1. Delete product_customizations (references products)
            queries.push({
                sql: `DELETE FROM product_customizations WHERE product_id IN (${deletePlaceholders})`,
                params: [...orphanedProductIds]
            });
            // 2. Delete bundle_items where bundle_product_id is in orphaned products
            queries.push({
                sql: `DELETE FROM bundle_items WHERE bundle_product_id IN (${deletePlaceholders})`,
                params: [...orphanedProductIds]
            });
            // 3. Delete product_businesses relationships for orphaned products
            queries.push({
                sql: `DELETE FROM product_businesses WHERE product_id IN (${deletePlaceholders}) AND business_id = ?`,
                params: [...orphanedProductIds, businessId]
            });
            // 4. Finally, delete the products themselves
            queries.push({
                sql: `DELETE FROM products WHERE id IN (${deletePlaceholders})`,
                params: [...orphanedProductIds]
            });
            await (0, mysqlDb_1.executeTransaction)(queries);
            console.log(`✅ [PRODUCTS CLEANUP] Successfully deleted ${orphanedProductIds.length} orphaned products and their related data`);
            return { success: true, deletedCount: orphanedProductIds.length, deletedProductIds: orphanedProductIds };
        }
        catch (error) {
            console.error('❌ [PRODUCTS CLEANUP] Failed to cleanup orphaned products:', error);
            return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
    });
    electron_1.ipcMain.handle('localdb-get-products-by-jenis', async (event, jenis, businessId) => {
        try {
            let query = `SELECT 
        p.id, p.menu_code, p.nama, p.satuan, 
        c2.name AS category2_name, c1.name AS category1_name,
        p.keterangan, p.harga_beli, p.ppn, p.harga_jual, p.harga_khusus, 
        p.harga_online, p.harga_qpon, p.harga_gofood, p.harga_grabfood, 
        p.harga_shopeefood, p.harga_tiktok, p.fee_kerja, p.image_url, p.status, p.has_customization, p.is_bundle
        FROM products p
        LEFT JOIN category2 c2 ON p.category2_id = c2.id
        LEFT JOIN category1 c1 ON p.category1_id = c1.id`;
            const params = [];
            // Add business filter if businessId is provided
            if (businessId) {
                query += ` INNER JOIN product_businesses pb ON p.id = pb.product_id`;
            }
            query += ` WHERE c2.name = ? AND p.status = 'active'`;
            params.push(jenis);
            if (businessId) {
                query += ` AND pb.business_id = ?`;
                params.push(businessId);
            }
            query += ` ORDER BY p.nama ASC`;
            return await (0, mysqlDb_1.executeQuery)(query, params);
        }
        catch (error) {
            console.error('Error getting products by jenis:', error);
            return [];
        }
    });
    // Add the missing method for category2 filtering
    electron_1.ipcMain.handle('localdb-get-products-by-category2', async (event, category2Name, businessId) => {
        try {
            let query = `SELECT 
        p.id, p.menu_code, p.nama, p.satuan, 
        c2.name AS category2_name, c1.name AS category1_name,
        p.keterangan, p.harga_beli, p.ppn, p.harga_jual, p.harga_khusus, 
        p.harga_online, p.harga_qpon, p.harga_gofood, p.harga_grabfood, 
        p.harga_shopeefood, p.harga_tiktok, p.fee_kerja, p.image_url, p.status, p.has_customization, p.is_bundle
        FROM products p
        LEFT JOIN category2 c2 ON p.category2_id = c2.id
        LEFT JOIN category1 c1 ON p.category1_id = c1.id`;
            const params = [];
            // Filter by businessId using junction table (product_businesses)
            // Note: Only using junction table because p.business_id column doesn't exist in this MySQL schema
            let useBusinessFilter = false;
            if (businessId) {
                // Check if product_businesses table has entries for this businessId
                try {
                    const pbCheck = await (0, mysqlDb_1.executeQuery)('SELECT COUNT(*) as count FROM product_businesses WHERE business_id = ?', [businessId]);
                    const pbCount = Array.isArray(pbCheck) && pbCheck.length > 0 ? pbCheck[0].count : 0;
                    useBusinessFilter = pbCount > 0;
                }
                catch (e) {
                    // If check fails, don't use business filter (fallback to all products)
                    useBusinessFilter = false;
                }
            }
            if (businessId && useBusinessFilter) {
                query += ` INNER JOIN product_businesses pb ON p.id = pb.product_id`;
            }
            query += ` WHERE c2.name = ? AND p.status = 'active' AND p.harga_jual IS NOT NULL`;
            params.push(category2Name);
            if (businessId && useBusinessFilter) {
                // Use junction table only (p.business_id column doesn't exist in this schema)
                query += ` AND pb.business_id = ?`;
                params.push(businessId);
            }
            query += ` ORDER BY p.nama ASC`;
            const result = await (0, mysqlDb_1.executeQuery)(query, params);
            return result;
        }
        catch (error) {
            console.error('Error getting products by category2:', error);
            return [];
        }
    });
    electron_1.ipcMain.handle('localdb-get-all-products', async (event, businessId) => {
        try {
            let query = `SELECT 
        p.id, p.menu_code, p.nama, p.satuan, 
        c2.name AS category2_name, c1.name AS category1_name,
        p.keterangan, p.harga_beli, p.ppn, p.harga_jual, p.harga_khusus, 
        p.harga_online, p.harga_qpon, p.harga_gofood, p.harga_grabfood, 
        p.harga_shopeefood, p.harga_tiktok, p.fee_kerja, p.image_url, p.status, p.has_customization, p.is_bundle
        FROM products p
        LEFT JOIN category2 c2 ON p.category2_id = c2.id
        LEFT JOIN category1 c1 ON p.category1_id = c1.id`;
            const params = [];
            // Filter by businessId using junction table (product_businesses)
            // Note: Only using junction table because p.business_id column doesn't exist in this MySQL schema
            let useBusinessFilter = false;
            if (businessId) {
                // Check if product_businesses table has entries for this businessId
                try {
                    const pbCheck = await (0, mysqlDb_1.executeQuery)('SELECT COUNT(*) as count FROM product_businesses WHERE business_id = ?', [businessId]);
                    const pbCount = Array.isArray(pbCheck) && pbCheck.length > 0 ? pbCheck[0].count : 0;
                    const totalProducts = await (0, mysqlDb_1.executeQuery)('SELECT COUNT(*) as count FROM products WHERE status = ?', ['active']);
                    useBusinessFilter = pbCount > 0;
                }
                catch (e) {
                    // If check fails, don't use business filter (fallback to all products)
                    useBusinessFilter = false;
                }
            }
            if (businessId && useBusinessFilter) {
                query += ` INNER JOIN product_businesses pb ON p.id = pb.product_id`;
            }
            query += ` WHERE p.status = 'active' AND p.harga_jual IS NOT NULL`;
            if (businessId && useBusinessFilter) {
                // Use junction table only (p.business_id column doesn't exist in this schema)
                query += ` AND pb.business_id = ?`;
                params.push(businessId);
            }
            query += ` ORDER BY p.nama ASC`;
            const result = await (0, mysqlDb_1.executeQuery)(query, params);
            return result;
        }
        catch (error) {
            console.error('Error getting all products:', error);
            return [];
        }
    });
    // Customization handlers
    electron_1.ipcMain.handle('localdb-upsert-customization-types', async (event, rows) => {
        try {
            const queries = rows.map(r => {
                const getId = () => {
                    const val = r.id;
                    if (typeof val === 'number')
                        return val;
                    if (typeof val === 'string') {
                        const num = Number(val);
                        return isNaN(num) ? null : num;
                    }
                    return null;
                };
                const getString = (key) => (typeof r[key] === 'string' ? r[key] : null);
                const getNumber = (key) => {
                    const val = r[key];
                    if (typeof val === 'number')
                        return val;
                    if (typeof val === 'string') {
                        const num = Number(val);
                        return isNaN(num) ? null : num;
                    }
                    return null;
                };
                return {
                    sql: `INSERT INTO product_customization_types (
            id, name, selection_mode, display_order
          ) VALUES (?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            name=VALUES(name), selection_mode=VALUES(selection_mode),
            display_order=VALUES(display_order)`,
                    params: [
                        getId(),
                        getString('name'),
                        getString('selection_mode'),
                        getNumber('display_order') ?? 0
                    ]
                };
            });
            await (0, mysqlDb_1.executeTransaction)(queries);
            return { success: true };
        }
        catch (error) {
            console.error('Error upserting customization types:', error);
            return { success: false };
        }
    });
    electron_1.ipcMain.handle('localdb-upsert-customization-options', async (event, rows) => {
        try {
            const queries = rows.map(r => {
                const getId = () => {
                    const val = r.id;
                    if (typeof val === 'number')
                        return val;
                    if (typeof val === 'string') {
                        const num = Number(val);
                        return isNaN(num) ? null : num;
                    }
                    return null;
                };
                const getString = (key) => (typeof r[key] === 'string' ? r[key] : null);
                const getNumber = (key) => {
                    const val = r[key];
                    if (typeof val === 'number')
                        return val;
                    if (typeof val === 'string') {
                        const num = Number(val);
                        return isNaN(num) ? null : num;
                    }
                    return null;
                };
                return {
                    sql: `INSERT INTO product_customization_options (
            id, type_id, name, price_adjustment, display_order, status
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            type_id=VALUES(type_id), name=VALUES(name), price_adjustment=VALUES(price_adjustment),
            display_order=VALUES(display_order), status=VALUES(status)`,
                    params: [
                        getId(),
                        getNumber('type_id'),
                        getString('name'),
                        getNumber('price_adjustment') ?? 0.0,
                        getNumber('display_order') ?? 0,
                        getString('status') || 'active'
                    ]
                };
            });
            await (0, mysqlDb_1.executeTransaction)(queries);
            return { success: true };
        }
        catch (error) {
            console.error('Error upserting customization options:', error);
            return { success: false };
        }
    });
    electron_1.ipcMain.handle('localdb-upsert-product-customizations', async (event, rows) => {
        try {
            const queries = [];
            for (const r of rows) {
                try {
                    const getId = () => {
                        const val = r.id;
                        if (typeof val === 'number')
                            return val;
                        if (typeof val === 'string') {
                            const num = Number(val);
                            return isNaN(num) ? null : num;
                        }
                        return null;
                    };
                    const getNumber = (key) => {
                        const val = r[key];
                        if (typeof val === 'number')
                            return val;
                        if (typeof val === 'string') {
                            const num = Number(val);
                            return isNaN(num) ? null : num;
                        }
                        return null;
                    };
                    queries.push({
                        sql: `INSERT INTO product_customizations (
              id, product_id, customization_type_id
            ) VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE
              product_id=VALUES(product_id), customization_type_id=VALUES(customization_type_id)`,
                        params: [
                            getId(),
                            getNumber('product_id'),
                            getNumber('customization_type_id')
                        ]
                    });
                }
                catch (error) {
                    const rowId = typeof r.id === 'number' ? r.id : (typeof r.id === 'string' ? r.id : 'unknown');
                    console.warn(`⚠️ [PRODUCT CUSTOMIZATION UPSERT] Skipping row ${rowId} due to error:`, error);
                }
            }
            if (queries.length > 0) {
                await (0, mysqlDb_1.executeTransaction)(queries);
            }
            return { success: true };
        }
        catch (error) {
            console.error('Error upserting product customizations:', error);
            return { success: false };
        }
    });
    // Bundle items handlers
    electron_1.ipcMain.handle('localdb-get-bundle-items', async (event, productId) => {
        try {
            // Ensure productId is a number
            const productIdNum = typeof productId === 'string' ? parseInt(productId, 10) : productId;
            if (isNaN(productIdNum)) {
                console.error(`❌ [BUNDLE ITEMS] Invalid product ID: ${productId}`);
                return [];
            }
            console.log(`🔍 [BUNDLE ITEMS] Fetching bundle items for product ID: ${productIdNum} (type: ${typeof productId}, converted from: ${productId})`);
            // First, check if any bundle items exist at all
            const allBundleItems = await (0, mysqlDb_1.executeQuery)('SELECT bundle_product_id, COUNT(*) as count FROM bundle_items GROUP BY bundle_product_id');
            console.log(`📊 [BUNDLE ITEMS] Bundle items by product:`, allBundleItems);
            const bundleItems = await (0, mysqlDb_1.executeQuery)(`
        SELECT 
          bi.id,
          bi.bundle_product_id,
          bi.category2_id,
          bi.required_quantity,
          bi.display_order,
          c2.name AS category2_name
        FROM bundle_items bi
        LEFT JOIN category2 c2 ON bi.category2_id = c2.id
        WHERE bi.bundle_product_id = ?
        ORDER BY bi.display_order ASC
      `, [productIdNum]);
            console.log(`✅ [BUNDLE ITEMS] Found ${bundleItems.length} bundle items for product ${productIdNum}`);
            if (bundleItems.length > 0) {
                console.log(`📦 [BUNDLE ITEMS] First item:`, JSON.stringify(bundleItems[0], null, 2));
            }
            else {
                console.warn(`⚠️ [BUNDLE ITEMS] No bundle items found for product ${productIdNum}. Checking if product exists in products table...`);
                const productCheck = await (0, mysqlDb_1.executeQueryOne)('SELECT id, nama, is_bundle FROM products WHERE id = ?', [productIdNum]);
                console.log(`🔍 [BUNDLE ITEMS] Product check result:`, productCheck);
            }
            return bundleItems.map(item => ({
                id: item.id,
                bundle_product_id: item.bundle_product_id,
                category2_id: item.category2_id,
                category2_name: item.category2_name,
                required_quantity: item.required_quantity,
                display_order: item.display_order
            }));
        }
        catch (error) {
            const errorMessage = (error && typeof error === 'object' && 'message' in error)
                ? String(error.message)
                : String(error);
            console.error(`❌ [BUNDLE ITEMS] Error fetching bundle items for product ${productId}:`, errorMessage);
            return [];
        }
    });
    electron_1.ipcMain.handle('localdb-upsert-bundle-items', async (event, rows) => {
        try {
            if (!Array.isArray(rows)) {
                console.error(`❌ [BUNDLE ITEMS UPSERT] Invalid data: rows is not an array, got ${typeof rows}`);
                return { success: false };
            }
            console.log(`🔄 [BUNDLE ITEMS UPSERT] Upserting ${rows.length} bundle items`);
            if (rows.length > 0) {
                console.log(`📦 [BUNDLE ITEMS UPSERT] First item sample:`, JSON.stringify(rows[0], null, 2));
            }
            const queries = [];
            let successCount = 0;
            let errorCount = 0;
            for (const r of rows) {
                try {
                    const getId = () => {
                        const val = r.id;
                        if (typeof val === 'number')
                            return val;
                        if (typeof val === 'string') {
                            const num = Number(val);
                            return isNaN(num) ? null : num;
                        }
                        return null;
                    };
                    const getNumber = (key) => {
                        const val = r[key];
                        if (typeof val === 'number')
                            return val;
                        if (typeof val === 'string') {
                            const num = Number(val);
                            return isNaN(num) ? null : num;
                        }
                        return null;
                    };
                    const getDate = (key) => {
                        const val = r[key];
                        if (val instanceof Date)
                            return val;
                        if (typeof val === 'string' || typeof val === 'number')
                            return val;
                        return null;
                    };
                    const bundleProductId = getNumber('bundle_product_id');
                    const rowId = getId();
                    // Skip if bundle_product_id is null or invalid
                    if (!bundleProductId) {
                        errorCount++;
                        console.warn(`⚠️ [BUNDLE ITEMS UPSERT] Skipping row ${rowId}: bundle_product_id is null`);
                        continue;
                    }
                    // Verify product exists before inserting bundle item
                    try {
                        const productExists = await (0, mysqlDb_1.executeQueryOne)('SELECT id FROM products WHERE id = ? LIMIT 1', [bundleProductId]);
                        if (!productExists) {
                            console.warn(`⚠️ [BUNDLE ITEMS UPSERT] Skipping row ${rowId}: bundle_product_id ${bundleProductId} does not exist`);
                            errorCount++;
                            continue;
                        }
                    }
                    catch (checkError) {
                        console.warn(`⚠️ [BUNDLE ITEMS UPSERT] Error checking product ${bundleProductId} for bundle item ${rowId}:`, checkError);
                        errorCount++;
                        continue;
                    }
                    // Verify category2_id exists before inserting (foreign key constraint)
                    // category2_id is NOT NULL in schema, so skip if it doesn't exist
                    let category2Id = getNumber('category2_id');
                    if (category2Id) {
                        try {
                            const category2Exists = await (0, mysqlDb_1.executeQueryOne)('SELECT id FROM category2 WHERE id = ? LIMIT 1', [category2Id]);
                            if (!category2Exists) {
                                console.warn(`⚠️ [BUNDLE ITEMS UPSERT] Skipping row ${rowId}: category2_id ${category2Id} does not exist (required, cannot be NULL)`);
                                errorCount++;
                                continue;
                            }
                        }
                        catch (checkError) {
                            const category2IdRaw = getNumber('category2_id');
                            console.warn(`⚠️ [BUNDLE ITEMS UPSERT] Error checking category2_id ${category2IdRaw} for bundle item ${rowId}:`, checkError);
                            errorCount++;
                            continue;
                        }
                    }
                    else {
                        console.warn(`⚠️ [BUNDLE ITEMS UPSERT] Skipping row ${rowId}: category2_id is null (required)`);
                        errorCount++;
                        continue;
                    }
                    const createdAtRaw = getDate('created_at');
                    const updatedAtRaw = getDate('updated_at');
                    const createdAt = createdAtRaw ? (0, mysqlDb_1.toMySQLTimestamp)(createdAtRaw) : (0, mysqlDb_1.toMySQLTimestamp)(new Date());
                    const updatedAt = updatedAtRaw ? (0, mysqlDb_1.toMySQLTimestamp)(updatedAtRaw) : (0, mysqlDb_1.toMySQLTimestamp)(Date.now());
                    queries.push({
                        sql: `
              INSERT INTO bundle_items (
                id, bundle_product_id, category2_id, required_quantity, display_order, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?)
              ON DUPLICATE KEY UPDATE
                bundle_product_id = VALUES(bundle_product_id),
                category2_id = VALUES(category2_id),
                required_quantity = VALUES(required_quantity),
                display_order = VALUES(display_order),
                updated_at = VALUES(updated_at)
            `,
                        params: [
                            rowId,
                            bundleProductId,
                            category2Id,
                            getNumber('required_quantity'),
                            getNumber('display_order'),
                            createdAt,
                            updatedAt
                        ]
                    });
                    successCount++;
                }
                catch (rowError) {
                    errorCount++;
                    const rowId = typeof r.id === 'number' ? r.id : (typeof r.id === 'string' ? r.id : 'unknown');
                    const rowErrorMessage = (rowError && typeof rowError === 'object' && 'message' in rowError)
                        ? String(rowError.message)
                        : String(rowError);
                    console.warn(`⚠️ [BUNDLE ITEMS UPSERT] Skipping row ${rowId}: ${rowErrorMessage}`);
                }
            }
            if (queries.length > 0) {
                await (0, mysqlDb_1.executeTransaction)(queries);
            }
            console.log(`📊 [BUNDLE ITEMS UPSERT] Upserted ${successCount} items, ${errorCount} errors`);
            console.log(`✅ [BUNDLE ITEMS UPSERT] Successfully upserted bundle items`);
            // Verify the data was saved
            const verifyCount = await (0, mysqlDb_1.executeQueryOne)('SELECT COUNT(*) as count FROM bundle_items');
            console.log(`✅ [BUNDLE ITEMS UPSERT] Total bundle items in database: ${verifyCount?.count || 0}`);
            return { success: true };
        }
        catch (error) {
            const errorMessage = (error && typeof error === 'object' && 'message' in error)
                ? String(error.message)
                : String(error);
            console.error(`❌ [BUNDLE ITEMS UPSERT] Error:`, errorMessage);
            return { success: false };
        }
    });
    // Debug handler to list all bundle items
    electron_1.ipcMain.handle('localdb-debug-bundle-items', async () => {
        try {
            const allItems = await (0, mysqlDb_1.executeQuery)(`
        SELECT 
          bi.id,
          bi.bundle_product_id,
          bi.category2_id,
          bi.required_quantity,
          bi.display_order,
          c2.name AS category2_name
        FROM bundle_items bi
        LEFT JOIN category2 c2 ON bi.category2_id = c2.id
        ORDER BY bi.bundle_product_id, bi.display_order ASC
      `);
            console.log(`🔍 [DEBUG] Total bundle items in database: ${allItems.length}`);
            if (allItems.length > 0) {
                console.log(`📦 [DEBUG] All bundle items:`, JSON.stringify(allItems, null, 2));
            }
            return { success: true, items: allItems };
        }
        catch (error) {
            const errorMessage = (error && typeof error === 'object' && 'message' in error)
                ? String(error.message)
                : String(error);
            console.error(`❌ [DEBUG] Error listing bundle items:`, errorMessage);
            return { success: false, items: [], error: errorMessage };
        }
    });
    electron_1.ipcMain.handle('localdb-get-product-customizations', async (event, productId) => {
        try {
            console.log(`🔍 [OFFLINE] Fetching customizations for product ${productId}`);
            // Get customization types for this product
            const types = await (0, mysqlDb_1.executeQuery)(`
        SELECT DISTINCT ct.id, ct.name, ct.selection_mode, ct.display_order
        FROM product_customization_types ct
        INNER JOIN product_customizations pc ON ct.id = pc.customization_type_id
        WHERE pc.product_id = ?
        ORDER BY ct.display_order ASC, ct.name ASC
      `, [productId]);
            console.log(`📋 [OFFLINE] Found ${types.length} customization types for product ${productId}`, types);
            // For each type, get all available options (not just for this product)
            const customizations = await Promise.all(types.map(async (type) => {
                const options = await (0, mysqlDb_1.executeQuery)(`
          SELECT co.id, co.type_id, co.name, co.price_adjustment, co.display_order
          FROM product_customization_options co
          WHERE co.type_id = ? AND co.status = 'active'
          ORDER BY co.display_order ASC, co.name ASC
        `, [type.id]);
                console.log(`📋 [OFFLINE] Type "${type.name}": found ${options.length} options`, options);
                return {
                    id: type.id,
                    name: type.name,
                    selection_mode: type.selection_mode,
                    options: options.map((option) => ({
                        id: option.id,
                        type_id: option.type_id,
                        name: option.name,
                        price_adjustment: Number(option.price_adjustment || 0),
                        display_order: option.display_order
                    }))
                };
            }));
            console.log(`✅ [OFFLINE] Returning ${customizations.length} customizations:`, customizations);
            return customizations;
        }
        catch (error) {
            console.error('❌ Error getting product customizations:', error);
            return [];
        }
    });
    electron_1.ipcMain.handle('localdb-update-sync-status', async (event, key, status) => {
        try {
            // 'key' is a reserved word in MySQL, need to escape it with backticks
            // Table may not exist - handle gracefully
            await (0, mysqlDb_1.executeUpdate)('INSERT INTO sync_status (`key`, last_sync, status) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE last_sync=VALUES(last_sync), status=VALUES(status)', [key, Date.now(), status]);
            return { success: true };
        }
        catch (error) {
            const err = error;
            // If table doesn't exist, just log and continue (not critical)
            if (err.code === 'ER_NO_SUCH_TABLE' || err.errno === 1146) {
                console.warn('⚠️ [SYNC STATUS] sync_status table does not exist - skipping status update');
                return { success: true }; // Return success to not break sync flow
            }
            console.error('Error updating sync status:', error);
            return { success: false };
        }
    });
    electron_1.ipcMain.handle('localdb-get-sync-status', async (event, key) => {
        try {
            // 'key' is a reserved word in MySQL, need to escape it with backticks
            return await (0, mysqlDb_1.executeQueryOne)('SELECT * FROM sync_status WHERE `key` = ?', [key]);
        }
        catch (error) {
            const err = error;
            // If table doesn't exist, just return null (not critical)
            if (err.code === 'ER_NO_SUCH_TABLE' || err.errno === 1146) {
                console.warn('⚠️ [SYNC STATUS] sync_status table does not exist');
                return null;
            }
            console.error('Error getting sync status:', error);
            return null;
        }
    });
    // Comprehensive IPC handlers for all POS tables
    // Users
    electron_1.ipcMain.handle('localdb-upsert-users', async (event, rows, skipRoleValidation = false) => {
        try {
            const queries = [];
            let skippedCount = 0;
            for (const r of rows) {
                const getId = () => {
                    const val = r.id;
                    if (typeof val === 'number')
                        return val;
                    if (typeof val === 'string') {
                        const num = Number(val);
                        return isNaN(num) ? null : num;
                    }
                    return null;
                };
                const getNumber = (key) => {
                    const val = r[key];
                    if (typeof val === 'number')
                        return val;
                    if (typeof val === 'string') {
                        const num = Number(val);
                        return isNaN(num) ? null : num;
                    }
                    return null;
                };
                const getString = (key) => (typeof r[key] === 'string' ? r[key] : null);
                const getDate = (key) => {
                    const val = r[key];
                    if (val instanceof Date)
                        return val;
                    if (typeof val === 'string' || typeof val === 'number')
                        return val;
                    return null;
                };
                const userId = getId();
                let roleId = getNumber('role_id');
                let orgId = getNumber('organization_id');
                // Verify role_id exists before inserting (foreign key constraint) - SKIP on first pass to break circular dependency
                if (roleId && !skipRoleValidation) {
                    try {
                        const roleExists = await (0, mysqlDb_1.executeQueryOne)('SELECT id FROM roles WHERE id = ? LIMIT 1', [roleId]);
                        if (!roleExists) {
                            console.warn(`⚠️ [USERS] Skipping user ${userId}: role_id ${roleId} does not exist`);
                            skippedCount++;
                            continue;
                        }
                    }
                    catch (checkError) {
                        console.warn(`⚠️ [USERS] Failed to verify role_id ${roleId}:`, checkError);
                        skippedCount++;
                        continue;
                    }
                }
                else if (roleId && skipRoleValidation) {
                    console.log(`ℹ️ [USERS] Skipping role validation for user ${userId} (first pass - breaking circular dependency)`);
                }
                // Verify organization_id exists before inserting (foreign key constraint) - SKIP on first pass
                if (orgId && !skipRoleValidation) {
                    try {
                        const orgExists = await (0, mysqlDb_1.executeQueryOne)('SELECT id FROM organizations WHERE id = ? LIMIT 1', [orgId]);
                        if (!orgExists) {
                            console.warn(`⚠️ [USERS] Skipping user ${userId}: organization_id ${orgId} does not exist`);
                            skippedCount++;
                            continue;
                        }
                    }
                    catch (checkError) {
                        console.warn(`⚠️ [USERS] Failed to verify organization_id ${orgId}:`, checkError);
                        skippedCount++;
                        continue;
                    }
                }
                else if (orgId && skipRoleValidation) {
                    console.log(`ℹ️ [USERS] Skipping organization validation for user ${userId} (first pass - breaking circular dependency)`);
                }
                const createdAtRaw = getDate('createdAt');
                const createdAt = createdAtRaw ? (0, mysqlDb_1.toMySQLTimestamp)(createdAtRaw) : (0, mysqlDb_1.toMySQLTimestamp)(new Date());
                queries.push({
                    sql: `INSERT INTO users (
            id, email, password, name, googleId, createdAt, role_id, organization_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            email=VALUES(email), password=VALUES(password), name=VALUES(name),
            googleId=VALUES(googleId), createdAt=VALUES(createdAt), role_id=VALUES(role_id),
            organization_id=VALUES(organization_id)`,
                    params: [
                        userId,
                        getString('email'),
                        getString('password'),
                        getString('name'),
                        getString('googleId'),
                        createdAt,
                        roleId,
                        orgId
                    ]
                });
            }
            if (queries.length > 0) {
                if (skipRoleValidation) {
                    // On first pass: Insert users one by one to handle foreign key errors individually
                    let successCount = 0;
                    let failCount = 0;
                    for (const query of queries) {
                        try {
                            await (0, mysqlDb_1.executeUpdate)(query.sql, query.params || []);
                            successCount++;
                        }
                        catch (insertError) {
                            const err = insertError;
                            if (err.code === 'ER_NO_REFERENCED_ROW_2' || err.errno === 1452) {
                                // Foreign key constraint - expected on first pass, will retry later
                                failCount++;
                                console.log(`ℹ️ [USERS] User ${query.params?.[0]} insert failed (foreign key - will retry later): ${err.message}`);
                            }
                            else {
                                // Unexpected error - log and continue
                                failCount++;
                                console.warn(`⚠️ [USERS] User ${query.params?.[0]} insert failed: ${err.message}`);
                            }
                        }
                    }
                    console.log(`ℹ️ [USERS] First pass: ${successCount} inserted, ${failCount} failed (will retry later)`);
                }
                else {
                    // On retry pass: Use transaction for better performance
                    try {
                        await (0, mysqlDb_1.executeTransaction)(queries);
                        if (skippedCount > 0) {
                            console.log(`⚠️ [USERS] Skipped ${skippedCount} users due to missing roles/organizations`);
                        }
                    }
                    catch (transactionError) {
                        const err = transactionError;
                        console.error(`❌ [USERS] Transaction error:`, transactionError);
                        throw transactionError;
                    }
                }
            }
            else {
                console.warn(`⚠️ [USERS] No valid users to insert (all ${rows.length} skipped)`);
            }
            return { success: true };
        }
        catch (error) {
            console.error('Error upserting users:', error);
            return { success: false };
        }
    });
    electron_1.ipcMain.handle('localdb-get-users', async () => {
        try {
            return await (0, mysqlDb_1.executeQuery)('SELECT * FROM users ORDER BY name ASC');
        }
        catch (error) {
            console.error('Error getting users:', error);
            return [];
        }
    });
    // Businesses
    electron_1.ipcMain.handle('localdb-upsert-businesses', async (event, rows) => {
        try {
            const queries = [];
            let skippedCount = 0;
            for (const r of rows) {
                const getId = () => {
                    const val = r.id;
                    if (typeof val === 'number')
                        return val;
                    if (typeof val === 'string') {
                        const num = Number(val);
                        return isNaN(num) ? null : num;
                    }
                    return null;
                };
                const getNumber = (key) => {
                    const val = r[key];
                    if (typeof val === 'number')
                        return val;
                    if (typeof val === 'string') {
                        const num = Number(val);
                        return isNaN(num) ? null : num;
                    }
                    return null;
                };
                const getString = (key) => (typeof r[key] === 'string' ? r[key] : null);
                const getDate = (key) => {
                    const val = r[key];
                    if (val instanceof Date)
                        return val;
                    if (typeof val === 'string' || typeof val === 'number')
                        return val;
                    return null;
                };
                const businessId = getId();
                let orgId = getNumber('organization_id');
                let mgmtGroupId = getNumber('management_group_id');
                // Verify organization_id exists before inserting (foreign key constraint)
                if (orgId) {
                    try {
                        const orgExists = await (0, mysqlDb_1.executeQueryOne)('SELECT id FROM organizations WHERE id = ? LIMIT 1', [orgId]);
                        if (!orgExists) {
                            console.warn(`⚠️ [BUSINESSES] Skipping business ${businessId}: organization_id ${orgId} does not exist`);
                            skippedCount++;
                            continue;
                        }
                    }
                    catch (checkError) {
                        console.warn(`⚠️ [BUSINESSES] Failed to verify organization_id ${orgId}:`, checkError);
                        skippedCount++;
                        continue;
                    }
                }
                // Verify management_group_id exists if provided
                if (mgmtGroupId) {
                    try {
                        const mgmtExists = await (0, mysqlDb_1.executeQueryOne)('SELECT id FROM management_groups WHERE id = ? LIMIT 1', [mgmtGroupId]);
                        if (!mgmtExists) {
                            console.warn(`⚠️ [BUSINESSES] management_group_id ${mgmtGroupId} does not exist, setting to NULL`);
                            mgmtGroupId = null;
                        }
                    }
                    catch (checkError) {
                        console.warn(`⚠️ [BUSINESSES] Failed to verify management_group_id ${mgmtGroupId}:`, checkError);
                        mgmtGroupId = null;
                    }
                }
                const status = getString('status') || 'active';
                const createdAtRaw = getDate('created_at');
                const createdAt = createdAtRaw ? (0, mysqlDb_1.toMySQLTimestamp)(createdAtRaw) : (0, mysqlDb_1.toMySQLTimestamp)(new Date());
                queries.push({
                    sql: `INSERT INTO businesses (
            id, name, permission_name, organization_id, status, management_group_id, image_url, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            name=VALUES(name), permission_name=VALUES(permission_name), organization_id=VALUES(organization_id),
            status=VALUES(status), management_group_id=VALUES(management_group_id), image_url=VALUES(image_url),
            created_at=VALUES(created_at)`,
                    params: [
                        businessId,
                        getString('name'),
                        getString('permission_name'),
                        orgId,
                        status,
                        mgmtGroupId,
                        getString('image_url'),
                        createdAt
                    ]
                });
            }
            if (queries.length > 0) {
                await (0, mysqlDb_1.executeTransaction)(queries);
                if (skippedCount > 0) {
                    console.log(`⚠️ [BUSINESSES] Skipped ${skippedCount} businesses due to missing organizations`);
                }
            }
            else {
                console.warn(`⚠️ [BUSINESSES] No valid businesses to insert (all ${rows.length} skipped)`);
            }
            return { success: true };
        }
        catch (error) {
            console.error('Error upserting businesses:', error);
            return { success: false };
        }
    });
    electron_1.ipcMain.handle('localdb-get-businesses', async () => {
        try {
            return await (0, mysqlDb_1.executeQuery)('SELECT * FROM businesses ORDER BY name ASC');
        }
        catch (error) {
            console.error('Error getting businesses:', error);
            return [];
        }
    });
    // Employees Position
    electron_1.ipcMain.handle('localdb-upsert-employees-position', async (event, rows) => {
        // #region agent log
        const logData = { location: 'main.ts:2067', message: 'localdb-upsert-employees-position called', data: { rowCount: Array.isArray(rows) ? rows.length : 0, firstRow: Array.isArray(rows) && rows.length > 0 ? rows[0] : null }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'C' };
        writeDebugLog(JSON.stringify(logData));
        // #endregion
        try {
            const queries = [];
            for (const r of rows) {
                const getId = () => {
                    const val = r.id;
                    if (typeof val === 'number')
                        return val;
                    if (typeof val === 'string') {
                        const num = Number(val);
                        return isNaN(num) ? null : num;
                    }
                    return null;
                };
                const getString = (key) => (typeof r[key] === 'string' ? r[key] : null);
                const getDate = (key) => {
                    const val = r[key];
                    if (val instanceof Date)
                        return val;
                    if (typeof val === 'string' || typeof val === 'number')
                        return val;
                    return null;
                };
                const positionId = getId();
                const namaJabatan = getString('nama_jabatan');
                const createdAtRaw = getDate('created_at');
                const updatedAtRaw = getDate('updated_at');
                const createdAt = createdAtRaw ? (0, mysqlDb_1.toMySQLTimestamp)(createdAtRaw) : (0, mysqlDb_1.toMySQLTimestamp)(new Date());
                const updatedAt = updatedAtRaw ? (0, mysqlDb_1.toMySQLTimestamp)(updatedAtRaw) : (0, mysqlDb_1.toMySQLTimestamp)(new Date());
                queries.push({
                    sql: `INSERT INTO employees_position (
            id, nama_jabatan, created_at, updated_at
          ) VALUES (?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            nama_jabatan=VALUES(nama_jabatan), created_at=VALUES(created_at), updated_at=VALUES(updated_at)`,
                    params: [positionId, namaJabatan, createdAt, updatedAt]
                });
            }
            // #region agent log
            const logBeforeExec = { location: 'main.ts:2107', message: 'Before executing employees_position queries', data: { queryCount: queries.length, firstQuery: queries.length > 0 ? { sql: queries[0].sql, paramCount: queries[0].params?.length || 0 } : null }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'E' };
            writeDebugLog(JSON.stringify(logBeforeExec));
            // #endregion
            if (queries.length > 0) {
                await (0, mysqlDb_1.executeTransaction)(queries);
                // #region agent log
                const logAfterExec = { location: 'main.ts:2110', message: 'After executing employees_position queries', data: { success: true }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'E' };
                writeDebugLog(JSON.stringify(logAfterExec));
                // #endregion
            }
            return { success: true };
        }
        catch (error) {
            // #region agent log
            const logError = { location: 'main.ts:2113', message: 'employees_position upsert error', data: { error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'D' };
            writeDebugLog(JSON.stringify(logError));
            // #endregion
            console.error('Error upserting employees_position:', error);
            return { success: false };
        }
    });
    electron_1.ipcMain.handle('localdb-get-employees-position', async () => {
        try {
            return await (0, mysqlDb_1.executeQuery)('SELECT * FROM employees_position ORDER BY nama_jabatan ASC');
        }
        catch (error) {
            console.error('Error getting employees_position:', error);
            return [];
        }
    });
    // Employees
    electron_1.ipcMain.handle('localdb-upsert-employees', async (event, rows, skipValidation = false) => {
        // #region agent log
        const logEntry = { location: 'main.ts:2127', message: 'localdb-upsert-employees called', data: { rowCount: Array.isArray(rows) ? rows.length : 0, skipValidation: skipValidation, firstRow: Array.isArray(rows) && rows.length > 0 ? rows[0] : null }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'C' };
        writeDebugLog(JSON.stringify(logEntry));
        // #endregion
        try {
            const queries = [];
            let skippedCount = 0;
            for (const r of rows) {
                const getId = () => {
                    const val = r.id;
                    if (typeof val === 'number')
                        return val;
                    if (typeof val === 'string') {
                        const num = Number(val);
                        return isNaN(num) ? null : num;
                    }
                    return null;
                };
                const getNumber = (key) => {
                    const val = r[key];
                    if (typeof val === 'number')
                        return val;
                    if (typeof val === 'string') {
                        const num = Number(val);
                        return isNaN(num) ? null : num;
                    }
                    return null;
                };
                const getString = (key) => (typeof r[key] === 'string' ? r[key] : null);
                const getDate = (key) => {
                    const val = r[key];
                    if (val instanceof Date)
                        return val;
                    if (typeof val === 'string' || typeof val === 'number')
                        return val;
                    return null;
                };
                const employeeId = getId();
                const userId = getNumber('user_id');
                const businessId = getNumber('business_id');
                const jabatanId = getNumber('jabatan_id');
                const noKtp = getString('no_ktp');
                const phone = getString('phone');
                const namaKaryawan = getString('nama_karyawan');
                const jenisKelamin = getString('jenis_kelamin');
                const alamat = getString('alamat');
                const tanggalLahirRaw = getDate('tanggal_lahir');
                const tanggalBekerjaRaw = getDate('tanggal_bekerja');
                const createdAtRaw = getDate('created_at');
                const updatedAtRaw = getDate('updated_at');
                const pin = getString('pin');
                const color = getString('color');
                // Convert dates to MySQL DATE format (YYYY-MM-DD)
                // Robust date conversion that handles various input formats
                const convertToMySQLDate = (date) => {
                    if (!date)
                        return null;
                    // If already in YYYY-MM-DD format, return as-is
                    if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
                        return date;
                    }
                    // Try to parse as date
                    let dateObj;
                    if (typeof date === 'number') {
                        dateObj = new Date(date);
                    }
                    else if (typeof date === 'string') {
                        // Handle ISO strings, MySQL datetime strings, etc.
                        dateObj = new Date(date);
                    }
                    else {
                        dateObj = date;
                    }
                    // Check if date is valid
                    if (isNaN(dateObj.getTime())) {
                        console.warn(`⚠️ [EMPLOYEES] Invalid date value: ${date}`);
                        return null;
                    }
                    // Convert to UTC+7 (WIB) and extract date part
                    const utc7Timestamp = dateObj.getTime() + (7 * 60 * 60 * 1000);
                    const utc7Date = new Date(utc7Timestamp);
                    const year = utc7Date.getUTCFullYear();
                    const month = String(utc7Date.getUTCMonth() + 1).padStart(2, '0');
                    const day = String(utc7Date.getUTCDate()).padStart(2, '0');
                    return `${year}-${month}-${day}`;
                };
                const tanggalLahir = convertToMySQLDate(tanggalLahirRaw);
                const tanggalBekerja = convertToMySQLDate(tanggalBekerjaRaw);
                // Validate required fields
                if (!namaKaryawan) {
                    // #region agent log
                    writeDebugLog(JSON.stringify({ location: 'main.ts:2214', message: 'Skipping employee - missing nama_karyawan', data: { employeeId: employeeId }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'F' }));
                    // #endregion
                    console.warn(`⚠️ [EMPLOYEES] Skipping employee ${employeeId}: nama_karyawan is required`);
                    skippedCount++;
                    continue;
                }
                if (!jenisKelamin || !['pria', 'wanita'].includes(jenisKelamin)) {
                    // #region agent log
                    writeDebugLog(JSON.stringify({ location: 'main.ts:2220', message: 'Skipping employee - invalid jenis_kelamin', data: { employeeId: employeeId, jenisKelamin: jenisKelamin }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'F' }));
                    // #endregion
                    console.warn(`⚠️ [EMPLOYEES] Skipping employee ${employeeId}: invalid jenis_kelamin`);
                    skippedCount++;
                    continue;
                }
                if (!tanggalBekerja) {
                    // #region agent log
                    writeDebugLog(JSON.stringify({ location: 'main.ts:2226', message: 'Skipping employee - missing tanggal_bekerja', data: { employeeId: employeeId, tanggalBekerjaRaw: tanggalBekerjaRaw }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'F' }));
                    // #endregion
                    console.warn(`⚠️ [EMPLOYEES] Skipping employee ${employeeId}: tanggal_bekerja is required`);
                    skippedCount++;
                    continue;
                }
                const createdAt = createdAtRaw ? (0, mysqlDb_1.toMySQLTimestamp)(createdAtRaw) : (0, mysqlDb_1.toMySQLTimestamp)(new Date());
                const updatedAt = updatedAtRaw ? (0, mysqlDb_1.toMySQLTimestamp)(updatedAtRaw) : (0, mysqlDb_1.toMySQLTimestamp)(new Date());
                // Validate foreign keys if not skipping validation
                if (!skipValidation) {
                    // Validate user_id exists if provided
                    if (userId) {
                        try {
                            const userExists = await (0, mysqlDb_1.executeQueryOne)('SELECT id FROM users WHERE id = ? LIMIT 1', [userId]);
                            if (!userExists) {
                                console.warn(`⚠️ [EMPLOYEES] Skipping employee ${employeeId}: user_id ${userId} does not exist`);
                                skippedCount++;
                                continue;
                            }
                        }
                        catch (checkError) {
                            console.warn(`⚠️ [EMPLOYEES] Failed to verify user_id ${userId}:`, checkError);
                            skippedCount++;
                            continue;
                        }
                    }
                    // Validate business_id exists if provided
                    if (businessId) {
                        try {
                            const businessExists = await (0, mysqlDb_1.executeQueryOne)('SELECT id FROM businesses WHERE id = ? LIMIT 1', [businessId]);
                            if (!businessExists) {
                                console.warn(`⚠️ [EMPLOYEES] Skipping employee ${employeeId}: business_id ${businessId} does not exist`);
                                skippedCount++;
                                continue;
                            }
                        }
                        catch (checkError) {
                            console.warn(`⚠️ [EMPLOYEES] Failed to verify business_id ${businessId}:`, checkError);
                            skippedCount++;
                            continue;
                        }
                    }
                    // Validate jabatan_id exists if provided
                    if (jabatanId) {
                        try {
                            const jabatanExists = await (0, mysqlDb_1.executeQueryOne)('SELECT id FROM employees_position WHERE id = ? LIMIT 1', [jabatanId]);
                            if (!jabatanExists) {
                                console.warn(`⚠️ [EMPLOYEES] Skipping employee ${employeeId}: jabatan_id ${jabatanId} does not exist`);
                                skippedCount++;
                                continue;
                            }
                        }
                        catch (checkError) {
                            console.warn(`⚠️ [EMPLOYEES] Failed to verify jabatan_id ${jabatanId}:`, checkError);
                            skippedCount++;
                            continue;
                        }
                    }
                }
                try {
                    // #region agent log
                    const logBuild = { location: 'main.ts:2314', message: 'Building employee query', data: { employeeId: employeeId, namaKaryawan: namaKaryawan, tanggalLahir: tanggalLahir, tanggalBekerja: tanggalBekerja, jenisKelamin: jenisKelamin }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'G' };
                    writeDebugLog(JSON.stringify(logBuild));
                    // #endregion
                    queries.push({
                        sql: `INSERT INTO employees (
              id, user_id, business_id, jabatan_id, no_ktp, phone, nama_karyawan,
              jenis_kelamin, alamat, tanggal_lahir, tanggal_bekerja, pin, color, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              user_id=VALUES(user_id), business_id=VALUES(business_id), jabatan_id=VALUES(jabatan_id),
              no_ktp=VALUES(no_ktp), phone=VALUES(phone), nama_karyawan=VALUES(nama_karyawan),
              jenis_kelamin=VALUES(jenis_kelamin), alamat=VALUES(alamat), tanggal_lahir=VALUES(tanggal_lahir),
              tanggal_bekerja=VALUES(tanggal_bekerja), pin=VALUES(pin), color=VALUES(color), created_at=VALUES(created_at), updated_at=VALUES(updated_at)`,
                        params: [
                            employeeId, userId, businessId, jabatanId, noKtp || null, phone || null, namaKaryawan,
                            jenisKelamin, alamat || null, tanggalLahir, tanggalBekerja, pin || null, color || null, createdAt, updatedAt
                        ]
                    });
                }
                catch (queryError) {
                    // #region agent log
                    const logError = { location: 'main.ts:2332', message: 'Error building employee query', data: { employeeId: employeeId, error: queryError instanceof Error ? queryError.message : String(queryError) }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'G' };
                    writeDebugLog(JSON.stringify(logError));
                    // #endregion
                    console.error(`❌ [EMPLOYEES] Error building query for employee ${employeeId}:`, queryError);
                    skippedCount++;
                    continue;
                }
            }
            // #region agent log
            writeDebugLog(JSON.stringify({ location: 'main.ts:2343', message: 'Before executing employee queries', data: { queryCount: queries.length, skipValidation: skipValidation, skippedCount: skippedCount }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'E' }));
            // #endregion
            if (queries.length > 0) {
                if (skipValidation) {
                    // On first pass: Insert employees one by one to handle foreign key errors individually
                    let successCount = 0;
                    let failCount = 0;
                    for (const query of queries) {
                        try {
                            await (0, mysqlDb_1.executeUpdate)(query.sql, query.params || []);
                            successCount++;
                            // #region agent log
                            writeDebugLog(JSON.stringify({ location: 'main.ts:2351', message: 'Employee insert success', data: { employeeId: query.params?.[0] }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'E' }));
                            // #endregion
                        }
                        catch (insertError) {
                            const err = insertError;
                            // #region agent log
                            writeDebugLog(JSON.stringify({ location: 'main.ts:2353', message: 'Employee insert failed', data: { employeeId: query.params?.[0], error: err.message, code: err.code, errno: err.errno, isForeignKey: err.code === 'ER_NO_REFERENCED_ROW_2' || err.errno === 1452 }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'E' }));
                            // #endregion
                            if (err.code === 'ER_NO_REFERENCED_ROW_2' || err.errno === 1452) {
                                // Foreign key constraint - expected on first pass, will retry later
                                failCount++;
                                console.log(`ℹ️ [EMPLOYEES] Employee ${query.params?.[0]} insert failed (foreign key - will retry later): ${err.message}`);
                            }
                            else {
                                // Unexpected error - log and continue
                                failCount++;
                                console.error(`❌ [EMPLOYEES] Employee ${query.params?.[0]} insert failed: ${err.message}`);
                                console.error(`❌ [EMPLOYEES] Error code: ${err.code}, errno: ${err.errno}`);
                            }
                        }
                    }
                    // #region agent log
                    writeDebugLog(JSON.stringify({ location: 'main.ts:2366', message: 'First pass summary', data: { successCount: successCount, failCount: failCount, skippedCount: skippedCount }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'E' }));
                    // #endregion
                    console.log(`ℹ️ [EMPLOYEES] First pass: ${successCount} inserted, ${failCount} failed (will retry later)`);
                    if (skippedCount > 0) {
                        console.log(`⚠️ [EMPLOYEES] Skipped ${skippedCount} employees due to validation errors`);
                    }
                }
                else {
                    // On retry pass: Use transaction for better performance
                    try {
                        await (0, mysqlDb_1.executeTransaction)(queries);
                        // #region agent log
                        writeDebugLog(JSON.stringify({ location: 'main.ts:2374', message: 'Employee transaction success', data: { queryCount: queries.length }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'E' }));
                        // #endregion
                        if (skippedCount > 0) {
                            console.log(`⚠️ [EMPLOYEES] Skipped ${skippedCount} employees due to missing foreign keys`);
                        }
                    }
                    catch (transactionError) {
                        const err = transactionError;
                        // #region agent log
                        writeDebugLog(JSON.stringify({ location: 'main.ts:2378', message: 'Employee transaction error', data: { error: err.message, code: err.code, errno: err.errno }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'E' }));
                        // #endregion
                        console.error(`❌ [EMPLOYEES] Transaction error:`, transactionError);
                        throw transactionError;
                    }
                }
            }
            else {
                // #region agent log
                writeDebugLog(JSON.stringify({ location: 'main.ts:2383', message: 'No employee queries to execute', data: { rowCount: rows.length, skippedCount: skippedCount }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'F' }));
                // #endregion
                console.warn(`⚠️ [EMPLOYEES] No valid employees to insert (all ${rows.length} skipped)`);
            }
            if (skippedCount > 0 && !skipValidation) {
                console.warn(`⚠️ [EMPLOYEES] Total skipped: ${skippedCount} employees`);
            }
            return { success: true, skipped: skippedCount };
        }
        catch (error) {
            console.error('❌ [EMPLOYEES] Error upserting employees:', error);
            if (error instanceof Error) {
                console.error('❌ [EMPLOYEES] Error message:', error.message);
                console.error('❌ [EMPLOYEES] Error stack:', error.stack);
            }
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
    });
    electron_1.ipcMain.handle('localdb-get-employees', async () => {
        try {
            // #region agent log
            const logBefore = { location: 'main.ts:2425', message: 'localdb-get-employees called', data: {}, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'B' };
            writeDebugLog(JSON.stringify(logBefore));
            // #endregion
            const result = await (0, mysqlDb_1.executeQuery)('SELECT * FROM employees ORDER BY nama_karyawan ASC');
            // #region agent log
            const logAfter = { location: 'main.ts:2427', message: 'localdb-get-employees result', data: { resultCount: Array.isArray(result) ? result.length : 0, result: Array.isArray(result) ? result.map((e) => ({ id: e.id, business_id: e.business_id, jabatan_id: e.jabatan_id, nama: e.nama_karyawan })) : null }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'B' };
            writeDebugLog(JSON.stringify(logAfter));
            // #endregion
            return result;
        }
        catch (error) {
            // #region agent log
            const logError = { location: 'main.ts:2430', message: 'localdb-get-employees error', data: { error: error instanceof Error ? error.message : String(error) }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'B' };
            writeDebugLog(JSON.stringify(logError));
            // #endregion
            console.error('Error getting employees:', error);
            return [];
        }
    });
    // Ingredients
    electron_1.ipcMain.handle('localdb-upsert-ingredients', async (event, rows) => {
        try {
            const queries = rows.map(r => {
                const getId = () => {
                    const val = r.id;
                    if (typeof val === 'number')
                        return val;
                    if (typeof val === 'string') {
                        const num = Number(val);
                        return isNaN(num) ? null : num;
                    }
                    return null;
                };
                const getString = (key) => (typeof r[key] === 'string' ? r[key] : null);
                const getNumber = (key) => {
                    const val = r[key];
                    if (typeof val === 'number')
                        return val;
                    if (typeof val === 'string') {
                        const num = Number(val);
                        return isNaN(num) ? null : num;
                    }
                    return null;
                };
                const getDate = (key) => {
                    const val = r[key];
                    if (val instanceof Date)
                        return val;
                    if (typeof val === 'string' || typeof val === 'number')
                        return val;
                    return null;
                };
                const createdAtRaw = getDate('created_at');
                const createdAt = createdAtRaw ? (0, mysqlDb_1.toMySQLTimestamp)(createdAtRaw) : (0, mysqlDb_1.toMySQLTimestamp)(new Date());
                return {
                    sql: `INSERT INTO ingredients (
            id, ingredient_code, nama, kategori, satuan_beli, isi_satuan_beli, satuan_keluar,
            harga_beli, stok_min, status, business_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            ingredient_code=VALUES(ingredient_code), nama=VALUES(nama), kategori=VALUES(kategori),
            satuan_beli=VALUES(satuan_beli), isi_satuan_beli=VALUES(isi_satuan_beli), satuan_keluar=VALUES(satuan_keluar),
            harga_beli=VALUES(harga_beli), stok_min=VALUES(stok_min), status=VALUES(status),
            business_id=VALUES(business_id), created_at=VALUES(created_at), updated_at=VALUES(updated_at)`,
                    params: [
                        getId(), getString('ingredient_code'), getString('nama'), getString('kategori'),
                        getString('satuan_beli'), getNumber('isi_satuan_beli'), getString('satuan_keluar'),
                        getNumber('harga_beli'), getNumber('stok_min'), getString('status'), getNumber('business_id'),
                        createdAt, (0, mysqlDb_1.toMySQLTimestamp)(Date.now())
                    ]
                };
            });
            await (0, mysqlDb_1.executeTransaction)(queries);
            return { success: true };
        }
        catch (error) {
            console.error('Error upserting ingredients:', error);
            return { success: false };
        }
    });
    electron_1.ipcMain.handle('localdb-get-ingredients', async (event, businessId) => {
        try {
            if (businessId) {
                return await (0, mysqlDb_1.executeQuery)('SELECT * FROM ingredients WHERE business_id = ? AND status = \'active\' ORDER BY nama ASC', [businessId]);
            }
            else {
                return await (0, mysqlDb_1.executeQuery)('SELECT * FROM ingredients WHERE status = \'active\' ORDER BY nama ASC');
            }
        }
        catch (error) {
            console.error('Error getting ingredients:', error);
            return [];
        }
    });
    // COGS
    electron_1.ipcMain.handle('localdb-upsert-cogs', async (event, rows) => {
        try {
            const queries = rows.map(r => {
                const getId = () => {
                    const val = r.id;
                    if (typeof val === 'number')
                        return val;
                    if (typeof val === 'string') {
                        const num = Number(val);
                        return isNaN(num) ? null : num;
                    }
                    return null;
                };
                const getString = (key) => (typeof r[key] === 'string' ? r[key] : null);
                const getNumber = (key) => {
                    const val = r[key];
                    if (typeof val === 'number')
                        return val;
                    if (typeof val === 'string') {
                        const num = Number(val);
                        return isNaN(num) ? null : num;
                    }
                    return null;
                };
                const getDate = (key) => {
                    const val = r[key];
                    if (val instanceof Date)
                        return val;
                    if (typeof val === 'string' || typeof val === 'number')
                        return val;
                    return null;
                };
                const createdAtRaw = getDate('created_at');
                const createdAt = createdAtRaw ? (0, mysqlDb_1.toMySQLTimestamp)(createdAtRaw) : (0, mysqlDb_1.toMySQLTimestamp)(new Date());
                return {
                    sql: `INSERT INTO cogs (
            id, menu_code, ingredient_code, amount, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            menu_code=VALUES(menu_code), ingredient_code=VALUES(ingredient_code),
            amount=VALUES(amount), created_at=VALUES(created_at), updated_at=VALUES(updated_at)`,
                    params: [
                        getId(),
                        getString('menu_code'),
                        getString('ingredient_code'),
                        getNumber('amount'),
                        createdAt,
                        (0, mysqlDb_1.toMySQLTimestamp)(Date.now())
                    ]
                };
            });
            await (0, mysqlDb_1.executeTransaction)(queries);
            return { success: true };
        }
        catch (error) {
            console.error('Error upserting COGS:', error);
            return { success: false };
        }
    });
    electron_1.ipcMain.handle('localdb-get-cogs', async () => {
        try {
            return await (0, mysqlDb_1.executeQuery)('SELECT * FROM cogs ORDER BY menu_code ASC');
        }
        catch (error) {
            console.error('Error getting COGS:', error);
            return [];
        }
    });
    // Contacts
    electron_1.ipcMain.handle('localdb-upsert-contacts', async (event, rows) => {
        try {
            const queries = [];
            for (const r of rows) {
                const getId = () => {
                    const val = r.id;
                    if (typeof val === 'number')
                        return val;
                    if (typeof val === 'string') {
                        const num = Number(val);
                        return isNaN(num) ? null : num;
                    }
                    return null;
                };
                const getString = (key) => (typeof r[key] === 'string' ? r[key] : null);
                const getNumber = (key) => {
                    const val = r[key];
                    if (typeof val === 'number')
                        return val;
                    if (typeof val === 'string') {
                        const num = Number(val);
                        return isNaN(num) ? null : num;
                    }
                    return null;
                };
                const getBoolean = (key) => {
                    const val = r[key];
                    if (typeof val === 'boolean')
                        return val;
                    if (typeof val === 'number')
                        return val === 1;
                    if (typeof val === 'string')
                        return val === 'true' || val === '1';
                    return null;
                };
                const getDate = (key) => {
                    const val = r[key];
                    if (val instanceof Date)
                        return val;
                    if (typeof val === 'string' || typeof val === 'number')
                        return val;
                    return null;
                };
                let sourceId = getNumber('source_id');
                // Verify source_id exists before inserting (foreign key constraint)
                if (sourceId) {
                    try {
                        const sourceExists = await (0, mysqlDb_1.executeQueryOne)('SELECT id FROM source WHERE id = ? LIMIT 1', [sourceId]);
                        if (!sourceExists) {
                            console.warn(`⚠️ [CONTACTS] source_id ${sourceId} does not exist, setting to NULL`);
                            sourceId = null;
                        }
                    }
                    catch (checkError) {
                        console.warn(`⚠️ [CONTACTS] Failed to verify source_id ${sourceId}:`, checkError);
                        sourceId = null;
                    }
                }
                const createdAtRaw = getDate('created_at');
                const createdAt = createdAtRaw ? (0, mysqlDb_1.toMySQLTimestamp)(createdAtRaw) : (0, mysqlDb_1.toMySQLTimestamp)(new Date());
                queries.push({
                    sql: `INSERT INTO contacts (
            id, no_ktp, nama, phone_number, tgl_lahir, no_kk, created_at, updated_at,
            is_active, jenis_kelamin, kota, kecamatan, source_id, pekerjaan_id,
            source_lainnya, alamat, team_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            no_ktp=VALUES(no_ktp), nama=VALUES(nama), phone_number=VALUES(phone_number),
            tgl_lahir=VALUES(tgl_lahir), no_kk=VALUES(no_kk), created_at=VALUES(created_at),
            updated_at=VALUES(updated_at), is_active=VALUES(is_active), jenis_kelamin=VALUES(jenis_kelamin),
            kota=VALUES(kota), kecamatan=VALUES(kecamatan), source_id=VALUES(source_id),
            pekerjaan_id=VALUES(pekerjaan_id), source_lainnya=VALUES(source_lainnya),
            alamat=VALUES(alamat), team_id=VALUES(team_id)`,
                    params: [
                        getId(), getString('no_ktp'), getString('nama'), getString('phone_number'),
                        getString('tgl_lahir'), getString('no_kk'), createdAt, (0, mysqlDb_1.toMySQLTimestamp)(Date.now()),
                        getBoolean('is_active'), getString('jenis_kelamin'), getString('kota'), getString('kecamatan'),
                        sourceId, getNumber('pekerjaan_id'),
                        getString('source_lainnya'), getString('alamat'), getNumber('team_id')
                    ]
                });
            }
            if (queries.length > 0) {
                await (0, mysqlDb_1.executeTransaction)(queries);
            }
            return { success: true };
        }
        catch (error) {
            console.error('Error upserting contacts:', error);
            return { success: false };
        }
    });
    electron_1.ipcMain.handle('localdb-get-contacts', async (event, teamId) => {
        try {
            if (teamId) {
                return await (0, mysqlDb_1.executeQuery)('SELECT * FROM contacts WHERE team_id = ? AND is_active = 1 ORDER BY nama ASC', [teamId]);
            }
            else {
                return await (0, mysqlDb_1.executeQuery)('SELECT * FROM contacts WHERE is_active = 1 ORDER BY nama ASC');
            }
        }
        catch (error) {
            console.error('Error getting contacts:', error);
            return [];
        }
    });
    // Teams (duplicate handler - already migrated above, removing this duplicate)
    // This handler was already migrated earlier in the file
    // Roles
    electron_1.ipcMain.handle('localdb-upsert-roles', async (event, rows) => {
        try {
            const queries = [];
            let skippedCount = 0;
            for (const r of rows) {
                const getId = () => {
                    const val = r.id;
                    if (typeof val === 'number')
                        return val;
                    if (typeof val === 'string') {
                        const num = Number(val);
                        return isNaN(num) ? null : num;
                    }
                    return null;
                };
                const getString = (key) => (typeof r[key] === 'string' ? r[key] : null);
                const getNumber = (key) => {
                    const val = r[key];
                    if (typeof val === 'number')
                        return val;
                    if (typeof val === 'string') {
                        const num = Number(val);
                        return isNaN(num) ? null : num;
                    }
                    return null;
                };
                const getDate = (key) => {
                    const val = r[key];
                    if (val instanceof Date)
                        return val;
                    if (typeof val === 'string' || typeof val === 'number')
                        return val;
                    return null;
                };
                const roleId = getId();
                let orgId = getNumber('organization_id');
                // Verify organization_id exists before inserting (foreign key constraint)
                if (orgId) {
                    try {
                        const orgExists = await (0, mysqlDb_1.executeQueryOne)('SELECT id FROM organizations WHERE id = ? LIMIT 1', [orgId]);
                        if (!orgExists) {
                            console.warn(`⚠️ [ROLES] Skipping role ${roleId}: organization_id ${orgId} does not exist`);
                            skippedCount++;
                            continue;
                        }
                    }
                    catch (checkError) {
                        console.warn(`⚠️ [ROLES] Failed to verify organization_id ${orgId}:`, checkError);
                        skippedCount++;
                        continue;
                    }
                }
                const createdAtRaw = getDate('created_at');
                const createdAt = createdAtRaw ? (0, mysqlDb_1.toMySQLTimestamp)(createdAtRaw) : (0, mysqlDb_1.toMySQLTimestamp)(new Date());
                queries.push({
                    sql: `INSERT INTO roles (
            id, name, description, organization_id, created_at
          ) VALUES (?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            name=VALUES(name),
            description=VALUES(description),
            organization_id=VALUES(organization_id),
            created_at=VALUES(created_at)`,
                    params: [
                        roleId,
                        getString('name'),
                        getString('description'),
                        orgId,
                        createdAt
                    ]
                });
            }
            if (queries.length > 0) {
                await (0, mysqlDb_1.executeTransaction)(queries);
                if (skippedCount > 0) {
                    console.log(`⚠️ [ROLES] Skipped ${skippedCount} roles due to missing organizations`);
                }
            }
            else {
                console.warn(`⚠️ [ROLES] No valid roles to insert (all ${rows.length} skipped)`);
            }
            return { success: true };
        }
        catch (error) {
            console.error('Error upserting roles:', error);
            return { success: false };
        }
    });
    electron_1.ipcMain.handle('localdb-get-roles', async () => {
        try {
            return await (0, mysqlDb_1.executeQuery)('SELECT * FROM roles ORDER BY name ASC');
        }
        catch (error) {
            console.error('Error getting roles:', error);
            return [];
        }
    });
    // Permission Categories
    electron_1.ipcMain.handle('localdb-upsert-permission-categories', async (event, rows) => {
        try {
            const queries = [];
            let skippedCount = 0;
            for (const r of rows) {
                const getId = () => {
                    const val = r.id;
                    if (typeof val === 'number')
                        return val;
                    if (typeof val === 'string') {
                        const num = Number(val);
                        return isNaN(num) ? null : num;
                    }
                    return null;
                };
                const getString = (key) => (typeof r[key] === 'string' ? r[key] : null);
                const getNumber = (key) => {
                    const val = r[key];
                    if (typeof val === 'number')
                        return val;
                    if (typeof val === 'string') {
                        const num = Number(val);
                        return isNaN(num) ? null : num;
                    }
                    return null;
                };
                const getDate = (key) => {
                    const val = r[key];
                    if (val instanceof Date)
                        return val;
                    if (typeof val === 'string' || typeof val === 'number')
                        return val;
                    return null;
                };
                let orgId = getNumber('organization_id');
                // Verify organization_id exists if provided
                if (orgId) {
                    try {
                        const orgExists = await (0, mysqlDb_1.executeQueryOne)('SELECT id FROM organizations WHERE id = ? LIMIT 1', [orgId]);
                        if (!orgExists) {
                            console.warn(`⚠️ [PERMISSION CATEGORIES] organization_id ${orgId} does not exist, setting to NULL`);
                            orgId = null;
                        }
                    }
                    catch (checkError) {
                        console.warn(`⚠️ [PERMISSION CATEGORIES] Failed to verify organization_id ${orgId}:`, checkError);
                        orgId = null;
                    }
                }
                const createdAtRaw = getDate('created_at');
                const createdAt = createdAtRaw ? (0, mysqlDb_1.toMySQLTimestamp)(createdAtRaw) : (0, mysqlDb_1.toMySQLTimestamp)(new Date());
                queries.push({
                    sql: `INSERT INTO permission_categories (
            id, name, description, organization_id, created_at
          ) VALUES (?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            name=VALUES(name),
            description=VALUES(description),
            organization_id=VALUES(organization_id),
            created_at=VALUES(created_at)`,
                    params: [
                        getId(),
                        getString('name'),
                        getString('description'),
                        orgId,
                        createdAt
                    ]
                });
            }
            if (queries.length > 0) {
                await (0, mysqlDb_1.executeTransaction)(queries);
                if (skippedCount > 0) {
                    console.log(`⚠️ [PERMISSION CATEGORIES] Skipped ${skippedCount} categories`);
                }
            }
            return { success: true };
        }
        catch (error) {
            console.error('Error upserting permission categories:', error);
            return { success: false };
        }
    });
    // Permissions
    electron_1.ipcMain.handle('localdb-upsert-permissions', async (event, rows) => {
        try {
            const queries = [];
            let skippedCount = 0;
            for (const r of rows) {
                let categoryId = typeof r.category_id === 'number' ? r.category_id : null;
                let orgId = typeof r.organization_id === 'number' ? r.organization_id : null;
                let businessId = typeof r.business_id === 'number' ? r.business_id : null;
                // Verify category_id exists if provided (foreign key constraint)
                if (categoryId) {
                    try {
                        const catExists = await (0, mysqlDb_1.executeQueryOne)('SELECT id FROM permission_categories WHERE id = ? LIMIT 1', [categoryId]);
                        if (!catExists) {
                            console.warn(`⚠️ [PERMISSIONS] category_id ${categoryId} does not exist, setting to NULL`);
                            categoryId = null;
                        }
                    }
                    catch (checkError) {
                        console.warn(`⚠️ [PERMISSIONS] Failed to verify category_id ${r.category_id}:`, checkError);
                        categoryId = null;
                    }
                }
                // Verify organization_id exists if provided
                if (orgId) {
                    try {
                        const orgExists = await (0, mysqlDb_1.executeQueryOne)('SELECT id FROM organizations WHERE id = ? LIMIT 1', [orgId]);
                        if (!orgExists) {
                            console.warn(`⚠️ [PERMISSIONS] organization_id ${orgId} does not exist, setting to NULL`);
                            orgId = null;
                        }
                    }
                    catch (checkError) {
                        console.warn(`⚠️ [PERMISSIONS] Failed to verify organization_id ${orgId}:`, checkError);
                        orgId = null;
                    }
                }
                // Verify business_id exists if provided
                if (businessId) {
                    try {
                        const businessExists = await (0, mysqlDb_1.executeQueryOne)('SELECT id FROM businesses WHERE id = ? LIMIT 1', [businessId]);
                        if (!businessExists) {
                            console.warn(`⚠️ [PERMISSIONS] business_id ${businessId} does not exist, setting to NULL`);
                            businessId = null;
                        }
                    }
                    catch (checkError) {
                        console.warn(`⚠️ [PERMISSIONS] Failed to verify business_id ${businessId}:`, checkError);
                        businessId = null;
                    }
                }
                const id = typeof r.id === 'number' ? r.id : (typeof r.id === 'string' ? parseInt(String(r.id), 10) : 0);
                const name = typeof r.name === 'string' ? r.name : String(r.name ?? '');
                const description = typeof r.description === 'string' ? r.description : String(r.description ?? '');
                const status = typeof r.status === 'string' ? r.status : 'active';
                const createdAt = r.created_at ? (typeof r.created_at === 'number' || typeof r.created_at === 'string' ? r.created_at : new Date()) : new Date();
                queries.push({
                    sql: `INSERT INTO permissions (
            id, name, description, category_id, organization_id, business_id, status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            name=VALUES(name),
            description=VALUES(description),
            category_id=VALUES(category_id),
            organization_id=VALUES(organization_id),
            business_id=VALUES(business_id),
            status=VALUES(status),
            created_at=VALUES(created_at)`,
                    params: [
                        id,
                        name,
                        description,
                        categoryId ?? null,
                        orgId ?? null,
                        businessId ?? null,
                        status,
                        (0, mysqlDb_1.toMySQLTimestamp)(createdAt)
                    ]
                });
            }
            if (queries.length > 0) {
                await (0, mysqlDb_1.executeTransaction)(queries);
                if (skippedCount > 0) {
                    console.log(`⚠️ [PERMISSIONS] Skipped ${skippedCount} permissions`);
                }
            }
            return { success: true };
        }
        catch (error) {
            console.error('Error upserting permissions:', error);
            return { success: false };
        }
    });
    // Permissions (duplicate handler - already migrated above, removing this duplicate)
    // This handler was already migrated earlier in the file
    // Role permissions
    electron_1.ipcMain.handle('localdb-upsert-role-permissions', async (event, rows) => {
        try {
            const queries = [];
            let skippedCount = 0;
            // Delete all existing role permissions first
            queries.push({
                sql: 'DELETE FROM role_permissions',
                params: []
            });
            // Then insert new ones (only if both role_id and permission_id exist)
            for (const r of rows ?? []) {
                const roleId = typeof r.role_id === 'number' ? r.role_id : (typeof r.role_id === 'string' ? parseInt(String(r.role_id), 10) : null);
                const permissionId = typeof r.permission_id === 'number' ? r.permission_id : (typeof r.permission_id === 'string' ? parseInt(String(r.permission_id), 10) : null);
                // Verify both role_id and permission_id exist
                if (roleId && permissionId) {
                    try {
                        const roleExists = await (0, mysqlDb_1.executeQueryOne)('SELECT id FROM roles WHERE id = ? LIMIT 1', [roleId]);
                        const permissionExists = await (0, mysqlDb_1.executeQueryOne)('SELECT id FROM permissions WHERE id = ? LIMIT 1', [permissionId]);
                        if (!roleExists) {
                            console.warn(`⚠️ [ROLE PERMISSIONS] Skipping: role_id ${roleId} does not exist`);
                            skippedCount++;
                            continue;
                        }
                        if (!permissionExists) {
                            console.warn(`⚠️ [ROLE PERMISSIONS] Skipping: permission_id ${permissionId} does not exist`);
                            skippedCount++;
                            continue;
                        }
                        queries.push({
                            sql: `INSERT INTO role_permissions (
                role_id, permission_id
              ) VALUES (?, ?)
              ON DUPLICATE KEY UPDATE role_id=VALUES(role_id), permission_id=VALUES(permission_id)`,
                            params: [roleId, permissionId]
                        });
                    }
                    catch (checkError) {
                        console.warn(`⚠️ [ROLE PERMISSIONS] Error checking role_id ${roleId} or permission_id ${permissionId}:`, checkError);
                        skippedCount++;
                        continue;
                    }
                }
                else {
                    console.warn(`⚠️ [ROLE PERMISSIONS] Skipping: missing role_id or permission_id`);
                    skippedCount++;
                }
            }
            if (queries.length > 1) { // More than just DELETE
                await (0, mysqlDb_1.executeTransaction)(queries);
                if (skippedCount > 0) {
                    console.log(`⚠️ [ROLE PERMISSIONS] Skipped ${skippedCount} role-permission mappings due to missing roles/permissions`);
                }
            }
            else {
                console.warn(`⚠️ [ROLE PERMISSIONS] No valid role-permission mappings to insert (all ${rows.length} skipped)`);
            }
            return { success: true };
        }
        catch (error) {
            console.error('Error upserting role permissions:', error);
            return { success: false };
        }
    });
    electron_1.ipcMain.handle('localdb-get-role-permissions', async (event, roleId) => {
        try {
            return await (0, mysqlDb_1.executeQuery)(`
        SELECT p.id, p.name, p.status
        FROM role_permissions rp
        INNER JOIN permissions p ON p.id = rp.permission_id
        WHERE rp.role_id = ?
        ORDER BY p.name ASC
      `, [roleId]);
        }
        catch (error) {
            console.error('Error getting role permissions:', error);
            return [];
        }
    });
    electron_1.ipcMain.handle('localdb-get-user-auth', async (event, email) => {
        try {
            const user = await (0, mysqlDb_1.executeQueryOne)(`
        SELECT id, email, password, name, role_id, organization_id
        FROM users
        WHERE LOWER(email) = LOWER(?)
        LIMIT 1
      `, [email]);
            if (!user) {
                return null;
            }
            let roleName = null;
            if (user.role_id !== null && user.role_id !== undefined) {
                const role = await (0, mysqlDb_1.executeQueryOne)('SELECT name FROM roles WHERE id = ? LIMIT 1', [user.role_id]);
                roleName = role?.name ?? null;
            }
            const permissionRows = (user.role_id !== null && user.role_id !== undefined)
                ? await (0, mysqlDb_1.executeQuery)(`
            SELECT p.name
            FROM role_permissions rp
            INNER JOIN permissions p ON p.id = rp.permission_id
            WHERE rp.role_id = ?
            ORDER BY p.name ASC
          `, [user.role_id])
                : [];
            return {
                ...user,
                role_name: roleName,
                permissions: Array.isArray(permissionRows) ? permissionRows.map((row) => row.name) : [],
            };
        }
        catch (error) {
            console.error('Error getting user auth:', error);
            return null;
        }
    });
    // Supporting tables
    electron_1.ipcMain.handle('localdb-upsert-source', async (event, rows) => {
        try {
            const queries = rows.map(r => {
                const id = typeof r.id === 'number' ? r.id : (typeof r.id === 'string' ? parseInt(String(r.id), 10) : 0);
                const sourceName = typeof r.source_name === 'string' ? r.source_name : String(r.source_name ?? '');
                const createdAt = r.created_at ? (typeof r.created_at === 'number' || typeof r.created_at === 'string' ? r.created_at : new Date()) : new Date();
                return {
                    sql: `INSERT INTO source (id, source_name, created_at) 
            VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE
            source_name=VALUES(source_name), created_at=VALUES(created_at)`,
                    params: [id, sourceName, (0, mysqlDb_1.toMySQLTimestamp)(createdAt)]
                };
            });
            await (0, mysqlDb_1.executeTransaction)(queries);
            return { success: true };
        }
        catch (error) {
            console.error('Error upserting source:', error);
            return { success: false };
        }
    });
    electron_1.ipcMain.handle('localdb-get-source', async () => {
        try {
            return await (0, mysqlDb_1.executeQuery)('SELECT * FROM source ORDER BY source_name ASC');
        }
        catch (error) {
            console.error('Error getting source:', error);
            return [];
        }
    });
    electron_1.ipcMain.handle('localdb-upsert-pekerjaan', async (event, rows) => {
        try {
            const queries = rows.map(r => {
                const id = typeof r.id === 'number' ? r.id : (typeof r.id === 'string' ? parseInt(String(r.id), 10) : 0);
                const namaPekerjaan = typeof r.nama_pekerjaan === 'string' ? r.nama_pekerjaan : String(r.nama_pekerjaan ?? '');
                const createdAt = r.created_at ? (typeof r.created_at === 'number' || typeof r.created_at === 'string' ? r.created_at : new Date()) : new Date();
                return {
                    sql: `INSERT INTO pekerjaan (id, nama_pekerjaan, created_at) 
            VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE
            nama_pekerjaan=VALUES(nama_pekerjaan), created_at=VALUES(created_at)`,
                    params: [id, namaPekerjaan, (0, mysqlDb_1.toMySQLTimestamp)(createdAt)]
                };
            });
            await (0, mysqlDb_1.executeTransaction)(queries);
            return { success: true };
        }
        catch (error) {
            console.error('Error upserting pekerjaan:', error);
            return { success: false };
        }
    });
    electron_1.ipcMain.handle('localdb-get-pekerjaan', async () => {
        try {
            return await (0, mysqlDb_1.executeQuery)('SELECT * FROM pekerjaan ORDER BY nama_pekerjaan ASC');
        }
        catch (error) {
            console.error('Error getting pekerjaan:', error);
            return [];
        }
    });
    // New table handlers for enhanced offline support
    // Transactions
    electron_1.ipcMain.handle('localdb-upsert-transactions', async (event, rows) => {
        try {
            const queries = [];
            for (const r of rows) {
                // Auto-link to active shift if shift_uuid is missing
                let finalShiftUuid = r.shift_uuid;
                if (!finalShiftUuid && r.user_id) {
                    try {
                        const activeShift = await (0, mysqlDb_1.executeQueryOne)(`
              SELECT uuid_id 
              FROM shifts 
              WHERE user_id = ? AND status = 'active' AND business_id = ?
              ORDER BY shift_start DESC 
              LIMIT 1
            `, [
                            typeof r.user_id === 'number' ? r.user_id : (typeof r.user_id === 'string' ? parseInt(String(r.user_id), 10) : 0),
                            typeof r.business_id === 'number' ? r.business_id : (r.business_id ? parseInt(String(r.business_id), 10) : 14)
                        ]);
                        if (activeShift) {
                            finalShiftUuid = activeShift.uuid_id;
                            console.log(`🔗 [UPSERT] Linked transaction ${r.id} to active shift ${finalShiftUuid}`);
                        }
                    }
                    catch (e) {
                        console.warn('Failed to link transaction to active shift during upsert:', e);
                    }
                }
                console.log('🔍 [MYSQL] Inserting transaction data:', {
                    id: r.id,
                    business_id: r.business_id,
                    user_id: r.user_id,
                    shift_uuid: finalShiftUuid,
                    payment_method: r.payment_method,
                    pickup_method: r.pickup_method,
                    total_amount: r.total_amount,
                    voucher_discount: r.voucher_discount,
                    voucher_type: r.voucher_type,
                    voucher_value: r.voucher_value,
                    voucher_label: r.voucher_label,
                    final_amount: r.final_amount,
                    amount_received: r.amount_received,
                    change_amount: r.change_amount,
                    status: r.status,
                    created_at: r.created_at,
                    contact_id: r.contact_id,
                    customer_name: r.customer_name,
                    customer_unit: r.customer_unit,
                    note: r.note,
                    bank_name: r.bank_name,
                    card_number: r.card_number,
                    cl_account_id: r.cl_account_id,
                    cl_account_name: r.cl_account_name,
                    bank_id: r.bank_id,
                    receipt_number: r.receipt_number,
                    transaction_type: r.transaction_type,
                    payment_method_id: r.payment_method_id,
                    table_id: r.table_id
                });
                const getString = (key) => (typeof r[key] === 'string' ? r[key] : null);
                const getNumber = (key) => {
                    const val = r[key];
                    if (typeof val === 'number')
                        return val;
                    if (typeof val === 'string') {
                        const num = Number(val);
                        return isNaN(num) ? null : num;
                    }
                    return null;
                };
                const getDate = (key) => {
                    const val = r[key];
                    if (val instanceof Date)
                        return val;
                    if (typeof val === 'string' || typeof val === 'number')
                        return val;
                    return null;
                };
                const getStatus = () => {
                    const status = typeof r.status === 'string' ? r.status : null;
                    // Preserve 'pending' status, convert 'paid' to 'completed', default to 'completed'
                    return status === 'pending' ? 'pending' : ((status === 'paid' || status === 'completed') ? 'completed' : (status ?? 'completed'));
                };
                const createdDate = getDate('created_at');
                const createdAt = createdDate ? (0, mysqlDb_1.toMySQLDateTime)(createdDate) : (0, mysqlDb_1.toMySQLDateTime)(new Date());
                const syncedDate = getDate('synced_at');
                const lastSyncDate = getDate('last_sync_attempt');
                const params = [
                    typeof r.id === 'string' ? r.id : (typeof r.id === 'number' ? String(r.id) : null), // uuid_id - the 19-digit UUID string
                    getNumber('business_id'),
                    getNumber('user_id'),
                    typeof finalShiftUuid === 'string' ? finalShiftUuid : null,
                    getString('payment_method'),
                    getString('pickup_method'),
                    getNumber('total_amount') ?? 0,
                    getNumber('voucher_discount') ?? 0.0,
                    getString('voucher_type') ?? 'none',
                    getNumber('voucher_value'),
                    getString('voucher_label'),
                    getNumber('final_amount') ?? 0,
                    getNumber('amount_received') ?? 0,
                    getNumber('change_amount') ?? 0.0,
                    getStatus(),
                    createdAt,
                    (0, mysqlDb_1.toMySQLDateTime)(new Date()),
                    syncedDate ? (0, mysqlDb_1.toMySQLDateTime)(syncedDate) : null,
                    getString('sync_status') ?? 'pending',
                    getNumber('sync_attempts') ?? 0,
                    lastSyncDate ? (0, mysqlDb_1.toMySQLDateTime)(lastSyncDate) : null,
                    getNumber('contact_id'),
                    getString('customer_name'),
                    getNumber('customer_unit'),
                    getString('note'),
                    getString('bank_name'),
                    getString('card_number'),
                    getString('cl_account_id'),
                    getString('cl_account_name'),
                    getNumber('bank_id'),
                    getString('receipt_number'),
                    getString('transaction_type') ?? 'drinks',
                    getNumber('payment_method_id') ?? 0,
                    getNumber('table_id')
                ];
                console.log('📝 [MYSQL] Calling executeTransaction with params:', params);
                console.log('📊 [MYSQL] Params count:', params.length);
                queries.push({
                    sql: `INSERT INTO transactions (
            uuid_id, business_id, user_id, shift_uuid, payment_method, pickup_method, total_amount,
            voucher_discount, voucher_type, voucher_value, voucher_label, final_amount, amount_received, change_amount, status,
            created_at, updated_at, synced_at, sync_status, sync_attempts, last_sync_attempt, contact_id, customer_name, customer_unit, note, bank_name,
            card_number, cl_account_id, cl_account_name, bank_id, receipt_number,
            transaction_type, payment_method_id, table_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            business_id=VALUES(business_id), user_id=VALUES(user_id), shift_uuid=VALUES(shift_uuid), payment_method=VALUES(payment_method),
            pickup_method=VALUES(pickup_method), total_amount=VALUES(total_amount), voucher_discount=VALUES(voucher_discount),
            voucher_type=VALUES(voucher_type), voucher_value=VALUES(voucher_value), voucher_label=VALUES(voucher_label),
            final_amount=VALUES(final_amount), amount_received=VALUES(amount_received), change_amount=VALUES(change_amount),
            status=VALUES(status), created_at=VALUES(created_at), updated_at=VALUES(updated_at), synced_at=VALUES(synced_at),
            sync_status=VALUES(sync_status), sync_attempts=VALUES(sync_attempts), last_sync_attempt=VALUES(last_sync_attempt),
            contact_id=VALUES(contact_id), customer_name=VALUES(customer_name), customer_unit=VALUES(customer_unit), note=VALUES(note),
            bank_name=VALUES(bank_name), card_number=VALUES(card_number), cl_account_id=VALUES(cl_account_id),
            cl_account_name=VALUES(cl_account_name), bank_id=VALUES(bank_id), receipt_number=VALUES(receipt_number),
            transaction_type=VALUES(transaction_type), payment_method_id=VALUES(payment_method_id), table_id=VALUES(table_id)`,
                    params
                });
            }
            if (queries.length > 0) {
                await (0, mysqlDb_1.executeTransaction)(queries);
                console.log('✅ [MYSQL] Transaction upsert successful');
            }
            return { success: true };
        }
        catch (err) {
            console.error('❌ [MYSQL] Transaction upsert error:', err);
            if (err && typeof err === 'object' && 'code' in err) {
                console.error('📝 [MYSQL] Error code:', err.code);
            }
            if (err && typeof err === 'object' && 'message' in err) {
                console.error('📝 [MYSQL] Error message:', err.message);
            }
            return { success: false };
        }
    });
    electron_1.ipcMain.handle('localdb-get-transactions', async (event, businessId, limit) => {
        try {
            // Diagnostic logging
            const diagLogPathTx = path.join(os.homedir(), 'AppData', 'Roaming', 'marviano-pos', 'path-diagnostic.log');
            try {
                const txCountResult = await (0, mysqlDb_1.executeQueryOne)('SELECT COUNT(*) as cnt FROM transactions');
                const txCount = txCountResult?.cnt || 0;
                fs.appendFileSync(diagLogPathTx, `${new Date().toISOString()} [GET-TX] businessId=${businessId}, limit=${limit}, totalTxInDb=${txCount}\n`);
            }
            catch (e) {
                try {
                    fs.appendFileSync(diagLogPathTx, `${new Date().toISOString()} [GET-TX] ERROR: ${e}\n`);
                }
                catch (e2) { }
            }
            let query = `
        SELECT 
          t.*,
          COALESCE(t.uuid_id, t.id) as id,
          CASE 
            WHEN t.created_at IS NOT NULL THEN
              ROW_NUMBER() OVER (
                PARTITION BY DATE(t.created_at), t.business_id
                ORDER BY t.created_at ASC
              )
            ELSE NULL
          END as receipt_number,
          COALESCE(
            NULLIF(t.refund_total, 0),
            COALESCE(refund_summary.total_refund, 0)
          ) as refund_total,
          -- Always recalculate refund_status based on total refund amount vs final_amount
          -- This ensures correct status even if database has incorrect values
          CASE 
            WHEN COALESCE(refund_summary.total_refund, t.refund_total, 0) > 0 THEN
              CASE 
                WHEN COALESCE(refund_summary.total_refund, t.refund_total, 0) >= (t.final_amount - 0.01) THEN 'full'
                ELSE 'partial'
              END
            ELSE 'none'
          END as refund_status
        FROM transactions t
        LEFT JOIN (
          SELECT 
            transaction_uuid,
            SUM(refund_amount) as total_refund,
            COUNT(*) as refund_count,
            MAX(status) as max_status
          FROM transaction_refunds
          WHERE status IN ('pending', 'completed')
          GROUP BY transaction_uuid
        ) refund_summary ON t.uuid_id = refund_summary.transaction_uuid
      `;
            const params = [];
            const conditions = [];
            // Exclude archived transactions
            conditions.push('t.status != \'archived\'');
            if (businessId) {
                conditions.push('t.business_id = ?');
                params.push(businessId);
            }
            if (conditions.length > 0) {
                query += ' WHERE ' + conditions.join(' AND ');
            }
            query += ' ORDER BY t.created_at DESC';
            // LIMIT cannot be parameterized with window functions in some MySQL versions
            // Validate and use string interpolation (safe since we validate it's a number)
            if (limit && typeof limit === 'number' && limit > 0) {
                const safeLimit = Math.min(Math.max(limit, 1), 100000); // Cap at 100k for safety
                query += ` LIMIT ${safeLimit}`;
            }
            const results = await (0, mysqlDb_1.executeQuery)(query, params);
            // Diagnostic logging
            try {
                fs.appendFileSync(diagLogPathTx, `${new Date().toISOString()} [GET-TX] Returned ${results.length} transactions\n`);
            }
            catch (e) { }
            // Debug: Check for specific transaction UUID and verify refunds exist in database
            const specificTx = results.find((tx) => {
                if (typeof tx === 'object' && tx !== null) {
                    const txRecord = tx;
                    const txId = typeof txRecord.id === 'string' ? txRecord.id : (typeof txRecord.id === 'number' ? String(txRecord.id) : '');
                    const txUuidId = typeof txRecord.uuid_id === 'string' ? txRecord.uuid_id : '';
                    return (txId === '0142512271637510001' || txUuidId === '0142512271637510001');
                }
                return false;
            });
            if (specificTx) {
                // Query refunds directly from database for this transaction
                try {
                    const txUuidId = typeof specificTx.uuid_id === 'string' ? specificTx.uuid_id : (typeof specificTx.id === 'string' ? specificTx.id : (typeof specificTx.id === 'number' ? String(specificTx.id) : ''));
                    const refundCheck = await (0, mysqlDb_1.executeQuery)(`
            SELECT 
              transaction_uuid,
              SUM(refund_amount) as total_refund,
              COUNT(*) as refund_count,
              GROUP_CONCAT(status) as statuses,
              GROUP_CONCAT(refund_amount) as amounts
            FROM transaction_refunds
            WHERE transaction_uuid = ?
            GROUP BY transaction_uuid
          `, [txUuidId]);
                    console.log(`🔍 [GET-TX] Debug for transaction 0142512271637510001:`, {
                        id: specificTx.id,
                        uuid_id: specificTx.uuid_id,
                        refund_total_from_query: specificTx.refund_total,
                        refund_status_from_query: specificTx.refund_status,
                        final_amount: specificTx.final_amount,
                        refunds_in_db: refundCheck.length > 0 ? refundCheck[0] : null,
                        refund_total_in_transactions_table: specificTx.refund_total,
                        refund_status_in_transactions_table: specificTx.refund_status
                    });
                }
                catch (refundError) {
                    console.error('❌ [GET-TX] Error checking refunds:', refundError);
                }
            }
            // Debug: Log transactions with refunds to verify refund_total is being calculated
            if (results.length > 0) {
                const transactionsWithRefunds = results.filter((tx) => {
                    const refundTotal = tx.refund_total;
                    return refundTotal && refundTotal > 0;
                });
                if (transactionsWithRefunds.length > 0) {
                    console.log(`💰 [GET-TX] Found ${transactionsWithRefunds.length} transaction(s) with refunds:`, transactionsWithRefunds.slice(0, 3).map((tx) => ({
                        id: tx.id || tx.uuid_id,
                        refund_total: tx.refund_total,
                        refund_status: tx.refund_status,
                        final_amount: tx.final_amount
                    })));
                }
            }
            return results;
        }
        catch (error) {
            console.error('Error getting transactions:', error);
            return [];
        }
    });
    const ensureIsoString = (value) => {
        if (!value)
            return null;
        const date = new Date(value);
        if (Number.isNaN(date.getTime()))
            return null;
        return date.toISOString();
    };
    const buildTransactionFilter = (businessId, startIso, endIso, alias) => {
        const prefix = alias ? `${alias}.` : '';
        const conditions = [`${prefix}business_id = ?`];
        const params = [businessId];
        if (startIso) {
            conditions.push(`${prefix}created_at >= ?`);
            params.push((0, mysqlDb_1.toMySQLDateTime)(startIso));
        }
        if (endIso) {
            conditions.push(`${prefix}created_at <= ?`);
            params.push((0, mysqlDb_1.toMySQLDateTime)(endIso));
        }
        return { clause: conditions.join(' AND '), params };
    };
    // Archive transactions
    electron_1.ipcMain.handle('localdb-archive-transactions', async (event, payload) => {
        const businessId = payload?.businessId;
        if (!businessId)
            return 0;
        const startIso = ensureIsoString(payload.from);
        const endIso = ensureIsoString(payload.to);
        try {
            const { clause: baseClause, params } = buildTransactionFilter(businessId, startIso, endIso);
            const timestamp = Date.now();
            const queries = [];
            // Update transactions to archived
            queries.push({
                sql: `
          UPDATE transactions 
          SET status = 'archived', updated_at = ?
          WHERE ${baseClause} AND status != 'archived'
        `,
                params: [timestamp, ...params]
            });
            await (0, mysqlDb_1.executeTransaction)(queries);
            // Get count of archived transactions
            const archivedClause = `${baseClause} AND status = 'archived'`;
            const countResult = await (0, mysqlDb_1.executeQueryOne)(`
        SELECT COUNT(*) as count FROM transactions WHERE ${archivedClause}
      `, params);
            const archivedCount = countResult?.count || 0;
            console.log(`✅ [ARCHIVE] Archived ${archivedCount} transactions`);
            // Also clear related printer audits for archived transactions
            try {
                await (0, mysqlDb_1.executeUpdate)(`
          DELETE FROM printer1_audit_log
          WHERE transaction_id IN (
            SELECT id FROM transactions WHERE ${archivedClause}
          )
        `, params);
                await (0, mysqlDb_1.executeUpdate)(`
          DELETE FROM printer2_audit_log
          WHERE transaction_id IN (
            SELECT id FROM transactions WHERE ${archivedClause}
          )
        `, params);
            }
            catch (e) {
                console.warn('⚠️ [ARCHIVE] Failed to clear printer audits for archived transactions:', e);
            }
            return archivedCount;
        }
        catch (error) {
            console.error('❌ [ARCHIVE] Failed to archive transactions:', error);
            throw error;
        }
    });
    // Delete transactions permanently
    electron_1.ipcMain.handle('localdb-delete-transactions', async (event, payload) => {
        const businessId = payload?.businessId;
        if (!businessId)
            return 0;
        const startIso = ensureIsoString(payload.from);
        const endIso = ensureIsoString(payload.to);
        try {
            const { clause: baseClause, params } = buildTransactionFilter(businessId, startIso, endIso);
            const queries = [];
            // Delete printer audits first
            queries.push({
                sql: `
          DELETE FROM printer1_audit_log 
          WHERE transaction_id IN (
            SELECT id FROM transactions WHERE ${baseClause}
          )
        `,
                params: [...params]
            });
            queries.push({
                sql: `
          DELETE FROM printer2_audit_log 
          WHERE transaction_id IN (
            SELECT id FROM transactions WHERE ${baseClause}
          )
        `,
                params: [...params]
            });
            // Delete transactions
            queries.push({
                sql: `
          DELETE FROM transactions 
          WHERE ${baseClause}
        `,
                params: [...params]
            });
            await (0, mysqlDb_1.executeTransaction)(queries);
            // Get count of deleted transactions (before deletion, we need to count)
            const countResult = await (0, mysqlDb_1.executeQueryOne)(`
        SELECT COUNT(*) as count FROM transactions WHERE ${baseClause}
      `, params);
            const deletedCount = countResult?.count || 0;
            console.log(`🗑️ [DELETE] Deleted ${deletedCount} transactions`);
            return deletedCount;
        }
        catch (error) {
            console.error('❌ [DELETE] Failed to delete transactions:', error);
            throw error;
        }
    });
    // Delete transactions by user email (both offline and online)
    // Delete transaction items permanently
    electron_1.ipcMain.handle('localdb-delete-transaction-items', async (event, payload) => {
        const businessId = payload?.businessId;
        if (!businessId)
            return { success: true };
        const startIso = ensureIsoString(payload.from);
        const endIso = ensureIsoString(payload.to);
        try {
            const { clause: baseClause, params } = buildTransactionFilter(businessId, startIso, endIso);
            // Get count before deletion
            const countResult = await (0, mysqlDb_1.executeQueryOne)(`
        SELECT COUNT(*) as count FROM transaction_items 
        WHERE transaction_id IN (
          SELECT id FROM transactions WHERE ${baseClause}
        )
      `, params);
            const deletedCount = countResult?.count || 0;
            await (0, mysqlDb_1.executeUpdate)(`
        DELETE FROM transaction_items 
        WHERE transaction_id IN (
          SELECT id FROM transactions WHERE ${baseClause}
        )
      `, params);
            console.log(`🗑️ [DELETE] Deleted ${deletedCount} transaction items`);
            return { success: true, deleted: deletedCount };
        }
        catch (error) {
            console.error('❌ [DELETE] Failed to delete transaction items:', error);
            throw error;
        }
    });
    // Get transactions that are not yet synced to cloud
    electron_1.ipcMain.handle('localdb-get-unsynced-transactions', async (event, businessId) => {
        try {
            // Return all transactions where sync_status = 'pending'
            // This indicates they haven't been synced to cloud yet
            let query = `
        SELECT 
          t.*,
          CASE 
            WHEN t.created_at IS NOT NULL THEN
              ROW_NUMBER() OVER (
                PARTITION BY DATE(t.created_at), t.business_id
                ORDER BY t.created_at ASC
              )
            ELSE NULL
          END as receipt_number
        FROM transactions t
        WHERE t.sync_status = 'pending'
      `;
            const params = [];
            if (businessId) {
                query += ' AND t.business_id = ?';
                params.push(businessId);
            }
            query += ' ORDER BY t.created_at DESC';
            const transactions = await (0, mysqlDb_1.executeQuery)(query, params);
            // ✅ NEW: Fetch transaction items for each transaction
            if (Array.isArray(transactions) && transactions.length > 0) {
                for (const transaction of transactions) {
                    const items = await (0, mysqlDb_1.executeQuery)('SELECT * FROM transaction_items WHERE transaction_id = ?', [transaction.id]);
                    transaction.items = items || [];
                }
            }
            return transactions;
        }
        catch (error) {
            console.error('Error getting unsynced transactions:', error);
            return [];
        }
    });
    // Delete unsynced transactions (data offline yang akan diunggah)
    electron_1.ipcMain.handle('localdb-delete-unsynced-transactions', async (event, businessId) => {
        try {
            console.log(`🗑️ [SYNC] Deleting unsynced transactions, businessId: ${businessId || 'all'}`);
            // Build WHERE clause for filtering
            let whereClause = 'synced_at IS NULL';
            const params = [];
            if (businessId) {
                whereClause += ' AND business_id = ?';
                params.push(businessId);
            }
            const queries = [];
            // Step 1: Delete transaction_item_customization_options (depends on customizations)
            queries.push({
                sql: `
          DELETE FROM transaction_item_customization_options
          WHERE transaction_item_customization_id IN (
            SELECT tic.id FROM transaction_item_customizations tic
            INNER JOIN transaction_items ti ON tic.transaction_item_id = ti.id
            INNER JOIN transactions t ON ti.transaction_id = t.id
            WHERE ${whereClause}
          )
        `,
                params: [...params]
            });
            // Step 2: Delete transaction_item_customizations (depends on transaction_items)
            queries.push({
                sql: `
          DELETE FROM transaction_item_customizations
          WHERE transaction_item_id IN (
            SELECT id FROM transaction_items
            WHERE transaction_id IN (
              SELECT id FROM transactions WHERE ${whereClause}
            )
          )
        `,
                params: [...params]
            });
            // Step 3: Delete transaction_items (depends on transactions)
            queries.push({
                sql: `
          DELETE FROM transaction_items 
          WHERE transaction_id IN (
            SELECT id FROM transactions WHERE ${whereClause}
          )
        `,
                params: [...params]
            });
            // Step 4: Delete transaction_refunds (uses transaction_uuid, not foreign key but should be deleted)
            queries.push({
                sql: `
          DELETE FROM transaction_refunds
          WHERE transaction_uuid IN (
            SELECT id FROM transactions WHERE ${whereClause}
          )
        `,
                params: [...params]
            });
            // Step 5: Finally delete transactions
            queries.push({
                sql: `DELETE FROM transactions WHERE ${whereClause}`,
                params: [...params]
            });
            // Get count before deletion
            const countResult = await (0, mysqlDb_1.executeQueryOne)(`
        SELECT COUNT(*) as count FROM transactions WHERE ${whereClause}
      `, params);
            const deletedCount = countResult?.count || 0;
            // Execute all deletions in a transaction
            await (0, mysqlDb_1.executeTransaction)(queries);
            console.log(`✅ [SYNC] Deleted ${deletedCount} unsynced transactions`);
            return {
                success: true,
                deletedCount
            };
        }
        catch (error) {
            console.error('❌ [SYNC] Error deleting unsynced transactions:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    });
    // Transaction Items
    electron_1.ipcMain.handle('localdb-upsert-transaction-items', async (event, rows) => {
        try {
            console.log('🔍 [MYSQL] Inserting transaction items:', rows.length);
            const queries = [];
            // Map to store transaction UUID -> INT id lookups
            const transactionIdMap = new Map();
            for (const r of rows) {
                console.log('📦 [MYSQL] Item data:', {
                    id: r.id,
                    transaction_id: r.transaction_id,
                    product_id: r.product_id,
                    custom_note: r.custom_note
                });
                // Handle bundle selections (still JSON for structure, but extract customizations to normalized tables)
                let bundleSelectionsJson = null;
                let bundleSelectionsData = null;
                if (r.bundle_selections_json) {
                    bundleSelectionsJson = typeof r.bundle_selections_json === 'string'
                        ? r.bundle_selections_json
                        : JSON.stringify(r.bundle_selections_json);
                    // Parse to extract bundle product customizations
                    try {
                        bundleSelectionsData = parseJsonArray(bundleSelectionsJson, 'bundle_selections_json');
                    }
                    catch (error) {
                        console.warn('⚠️ Failed to parse bundle_selections_json:', error);
                    }
                }
                console.log('📝 [MYSQL] Custom note:', r.custom_note);
                // Use UUID columns: uuid_id (item UUID) and uuid_transaction_id (transaction UUID reference)
                // IMPORTANT: Use r.uuid_id if available, otherwise fall back to r.id as string
                const itemUuidId = typeof r.uuid_id === 'string' && r.uuid_id
                    ? r.uuid_id
                    : (typeof r.id === 'string' ? r.id : String(r.id ?? ''));
                // IMPORTANT: Use uuid_transaction_id field, not transaction_id (which is 0 placeholder)
                const transactionUuidId = typeof r.uuid_transaction_id === 'string' ? r.uuid_transaction_id : (typeof r.transaction_id === 'string' ? r.transaction_id : String(r.transaction_id ?? '')); // Look up transaction INT id from UUID (cache results)
                let transactionIntId;
                if (transactionIdMap.has(transactionUuidId)) {
                    transactionIntId = transactionIdMap.get(transactionUuidId);
                }
                else {
                    try {
                        const tx = await (0, mysqlDb_1.executeQueryOne)('SELECT id FROM transactions WHERE uuid_id = ? LIMIT 1', [transactionUuidId]);
                        if (tx && typeof tx.id === 'number') {
                            transactionIntId = tx.id;
                            transactionIdMap.set(transactionUuidId, transactionIntId);
                        }
                        else {
                            console.warn(`⚠️ Transaction UUID ${transactionUuidId} not found, using 0 as placeholder`);
                            transactionIntId = 0;
                        }
                    }
                    catch (error) {
                        console.error(`❌ Error looking up transaction ID for UUID ${transactionUuidId}:`, error);
                        transactionIntId = 0;
                    }
                }
                const productId = typeof r.product_id === 'number' ? r.product_id : (typeof r.product_id === 'string' ? parseInt(String(r.product_id), 10) : 0);
                const quantity = typeof r.quantity === 'number' ? r.quantity : (typeof r.quantity === 'string' ? parseInt(String(r.quantity), 10) : 1);
                const unitPrice = typeof r.unit_price === 'number' ? r.unit_price : (typeof r.unit_price === 'string' ? parseFloat(String(r.unit_price)) : 0);
                const totalPrice = typeof r.total_price === 'number' ? r.total_price : (typeof r.total_price === 'string' ? parseFloat(String(r.total_price)) : 0);
                const customNote = typeof r.custom_note === 'string' ? r.custom_note : (r.custom_note ? String(r.custom_note) : null);
                const getDate = (key) => {
                    const val = r[key];
                    if (val instanceof Date)
                        return val;
                    if (typeof val === 'string' || typeof val === 'number')
                        return val;
                    return null;
                };
                const createdDate = getDate('created_at');
                const createdAt = createdDate ? (0, mysqlDb_1.toMySQLDateTime)(createdDate) : (0, mysqlDb_1.toMySQLDateTime)(new Date());
                // Handle production status fields
                const productionStatus = typeof r.production_status === 'string' ? r.production_status : (r.production_status ? String(r.production_status) : null);
                const productionStartedDate = getDate('production_started_at');
                const productionStartedAt = productionStartedDate ? (0, mysqlDb_1.toMySQLDateTime)(productionStartedDate) : null;
                const productionFinishedDate = getDate('production_finished_at');
                const productionFinishedAt = productionFinishedDate ? (0, mysqlDb_1.toMySQLDateTime)(productionFinishedDate) : null;
                console.log('🔧 [MYSQL] Production status update:', {
                    itemId: r.id,
                    itemUuidId,
                    productionStatus,
                    productionStartedAt,
                    productionFinishedAt
                });
                queries.push({
                    sql: `INSERT INTO transaction_items (
            uuid_id, transaction_id, uuid_transaction_id, product_id, quantity, unit_price, total_price,
            bundle_selections_json, custom_note, created_at,
            production_status, production_started_at, production_finished_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            transaction_id=VALUES(transaction_id), uuid_transaction_id=VALUES(uuid_transaction_id), product_id=VALUES(product_id), quantity=VALUES(quantity),
            unit_price=VALUES(unit_price), total_price=VALUES(total_price),
            bundle_selections_json=VALUES(bundle_selections_json),
            custom_note=VALUES(custom_note), created_at=VALUES(created_at),
            production_status=VALUES(production_status), production_started_at=VALUES(production_started_at), production_finished_at=VALUES(production_finished_at)`,
                    params: [
                        itemUuidId, transactionIntId, transactionUuidId, productId, quantity, unitPrice, totalPrice,
                        bundleSelectionsJson, customNote, createdAt,
                        productionStatus, productionStartedAt, productionFinishedAt
                    ]
                });
            }
            // Insert all transaction items first
            if (queries.length > 0) {
                await (0, mysqlDb_1.executeTransaction)(queries);
            }
            // Then save customizations for each item (after items are inserted)
            for (const r of rows) {
                // Save main product customizations directly to normalized tables (NO JSON)
                if (r.customizations && Array.isArray(r.customizations)) {
                    try {
                        const customizations = r.customizations;
                        // #region agent log
                        fetch('http://127.0.0.1:7242/ingest/7b565785-72b5-49f7-b2c0-57606ea0d0b5', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'main.ts:3505', message: 'Saving customizations for item', data: { itemId: r.id, itemUuid: r.uuid_id, customizationsCount: customizations.length, hasCustomizations: customizations.length > 0 }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'F' }) }).catch(() => { });
                        // #endregion
                        if (customizations.length > 0) {
                            // CRITICAL: Use uuid_id (UUID string) not id (numeric) for lookup
                            // saveCustomizationsToNormalizedTables looks up items by uuid_id
                            const itemUuid = r.uuid_id || (typeof r.id === 'string' ? r.id : String(r.id ?? ''));
                            const createdAt = r.created_at ? (typeof r.created_at === 'number' || typeof r.created_at === 'string' ? r.created_at : new Date()) : new Date();
                            const createdAtStr = typeof createdAt === 'string' ? createdAt : (createdAt instanceof Date ? (0, mysqlDb_1.toMySQLTimestamp)(createdAt) : (0, mysqlDb_1.toMySQLTimestamp)(new Date()));
                            if (createdAtStr) {
                                // #region agent log
                                fetch('http://127.0.0.1:7242/ingest/7b565785-72b5-49f7-b2c0-57606ea0d0b5', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'main.ts:3510', message: 'Calling saveCustomizationsToNormalizedTables', data: { itemUuid, itemId: r.id, itemUuidId: r.uuid_id, customizationsCount: customizations.length }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'F' }) }).catch(() => { });
                                // #endregion
                                await saveCustomizationsToNormalizedTables(itemUuid, customizations, createdAtStr);
                                // #region agent log
                                fetch('http://127.0.0.1:7242/ingest/7b565785-72b5-49f7-b2c0-57606ea0d0b5', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'main.ts:3520', message: 'saveCustomizationsToNormalizedTables completed', data: { itemUuid, itemId: r.id }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'F' }) }).catch(() => { });
                                // #endregion
                            }
                        }
                    }
                    catch (error) {
                        console.error('❌ Error saving main product customizations to normalized tables:', error);
                        // #region agent log
                        fetch('http://127.0.0.1:7242/ingest/7b565785-72b5-49f7-b2c0-57606ea0d0b5', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'main.ts:3525', message: 'Error saving customizations', data: { itemId: r.id, error: String(error) }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'F' }) }).catch(() => { });
                        // #endregion
                    }
                }
                else {
                    // #region agent log
                    fetch('http://127.0.0.1:7242/ingest/7b565785-72b5-49f7-b2c0-57606ea0d0b5', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'main.ts:3528', message: 'No customizations in item', data: { itemId: r.id, itemUuid: r.uuid_id, hasCustomizations: !!r.customizations }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'F' }) }).catch(() => { });
                    // #endregion
                }
                // Extract and save bundle product customizations to normalized tables (NO JSON)
                let bundleSelectionsData = null;
                if (r.bundle_selections_json) {
                    try {
                        const bundleSelectionsJson = typeof r.bundle_selections_json === 'string'
                            ? r.bundle_selections_json
                            : JSON.stringify(r.bundle_selections_json);
                        bundleSelectionsData = parseJsonArray(bundleSelectionsJson, 'bundle_selections_json');
                    }
                    catch (error) {
                        console.warn('⚠️ Failed to parse bundle_selections_json:', error);
                    }
                }
                if (bundleSelectionsData && bundleSelectionsData.length > 0) {
                    try {
                        // CRITICAL: Use uuid_id (UUID string) not id (numeric) for lookup
                        const transactionItemUuid = r.uuid_id || (typeof r.id === 'string' ? r.id : String(r.id ?? ''));
                        const createdAt = r.created_at ? (typeof r.created_at === 'number' || typeof r.created_at === 'string' ? r.created_at : new Date()) : new Date();
                        const createdAtTimestamp = (0, mysqlDb_1.toMySQLTimestamp)(createdAt);
                        for (const bundleSelection of bundleSelectionsData) {
                            if (!Array.isArray(bundleSelection.selectedProducts))
                                continue;
                            for (const selectedProduct of bundleSelection.selectedProducts) {
                                // Each bundle product can have customizations
                                if (selectedProduct.customizations && Array.isArray(selectedProduct.customizations) && selectedProduct.customizations.length > 0) {
                                    const bundleProductCustomizations = selectedProduct.customizations;
                                    // Save bundle product customizations to normalized tables
                                    // Link them to the bundle product ID so we can reconstruct them later
                                    const bundleProductId = selectedProduct.product?.id || null;
                                    const createdAtStr = typeof createdAt === 'string' ? createdAt : (createdAt instanceof Date ? (0, mysqlDb_1.toMySQLTimestamp)(createdAt) : (0, mysqlDb_1.toMySQLTimestamp)(new Date()));
                                    if (createdAtStr) {
                                        await saveCustomizationsToNormalizedTables(transactionItemUuid, bundleProductCustomizations, createdAtStr, bundleProductId);
                                    }
                                }
                            }
                        }
                    }
                    catch (error) {
                        console.error('❌ Error saving bundle product customizations to normalized tables:', error);
                    }
                }
            }
            console.log('✅ [MYSQL] Transaction items inserted');
            return { success: true };
        }
        catch (error) {
            console.error('❌ Error upserting transaction items:', error);
            return { success: false };
        }
    });
    electron_1.ipcMain.handle('localdb-get-transaction-items', async (event, transactionId) => {
        try { // Get transaction items with product name from LEFT JOIN (includes inactive products)
            // Support both UUID and numeric ID lookups
            let items = [];
            if (transactionId) {
                // Try to match by uuid_transaction_id first (for UUID), then fallback to transaction_id (for numeric)
                // Check if it's a receipt number format (starts with digits but might have leading zeros)
                // IMPORTANT: Check receipt number format FIRST, as it's also numeric but needs UUID lookup
                const isReceiptNumberFormat = typeof transactionId === 'string' && /^0\d{15,}$/.test(String(transactionId).trim());
                const isNumeric = typeof transactionId === 'number' || (typeof transactionId === 'string' && /^\d+$/.test(String(transactionId).trim()));
                const isSimpleNumeric = isNumeric && !isReceiptNumberFormat; // Numeric but NOT receipt number format
                console.log(`[localdb-get-transaction-items] Looking for items with transactionId: ${transactionId} (isNumeric: ${isNumeric}, isReceiptNumberFormat: ${isReceiptNumberFormat}, isSimpleNumeric: ${isSimpleNumeric})`);
                if (isSimpleNumeric) {
                    // Simple numeric ID (not receipt number format) - match by transaction_id
                    items = await (0, mysqlDb_1.executeQuery)(`
            SELECT ti.*, p.nama as product_name 
            FROM transaction_items ti
            LEFT JOIN products p ON ti.product_id = p.id
            WHERE ti.transaction_id = ? 
            ORDER BY ti.id ASC
          `, [transactionId]);
                }
                else {
                    // UUID or receipt number format - try multiple strategies to find items
                    // Strategy 1: Try uuid_transaction_id directly (most direct match)
                    items = await (0, mysqlDb_1.executeQuery)(`
            SELECT ti.*, p.nama as product_name 
            FROM transaction_items ti
            LEFT JOIN products p ON ti.product_id = p.id
            WHERE ti.uuid_transaction_id = ? 
            ORDER BY ti.id ASC
          `, [transactionId]);
                    // Strategy 2: Join with transactions table to match by UUID or receipt_number
                    if (items.length === 0) {
                        console.log(`[localdb-get-transaction-items] No items found by uuid_transaction_id, trying transaction join with receipt_number`);
                        // Try matching receipt_number as string (for formats like "0142512252257150001")
                        items = await (0, mysqlDb_1.executeQuery)(`
              SELECT ti.*, p.nama as product_name 
              FROM transaction_items ti
              LEFT JOIN products p ON ti.product_id = p.id
              INNER JOIN transactions t ON ti.transaction_id = t.id
              WHERE t.uuid_id = ? 
                 OR CAST(t.receipt_number AS CHAR) = ?
                 OR t.receipt_number = ?
              ORDER BY ti.id ASC
            `, [transactionId, String(transactionId), transactionId]);
                    }
                    // Strategy 3: If still no items, find transaction's numeric ID and match by transaction_id
                    if (items.length === 0) {
                        console.log(`[localdb-get-transaction-items] No items found via join, trying to find by transaction numeric ID`);
                        const transaction = await (0, mysqlDb_1.executeQuery)(`
              SELECT id, uuid_id, receipt_number FROM transactions 
              WHERE uuid_id = ? 
                 OR CAST(receipt_number AS CHAR) = ?
                 OR receipt_number = ?
                 OR id = ?
              LIMIT 1
            `, [transactionId, String(transactionId), transactionId, transactionId]);
                        if (transaction && Array.isArray(transaction) && transaction.length > 0) {
                            const tx = transaction[0];
                            const txId = typeof tx.id === 'number' ? tx.id : (typeof tx.id === 'string' ? Number(tx.id) : null);
                            const txUuidId = typeof tx.uuid_id === 'string' ? tx.uuid_id : null;
                            console.log(`[localdb-get-transaction-items] Found transaction:`, {
                                id: tx.id,
                                uuid_id: tx.uuid_id,
                                receipt_number: tx.receipt_number
                            });
                            // Try with numeric ID
                            if (txId !== null && !isNaN(txId)) {
                                const numericId = txId;
                                console.log(`[localdb-get-transaction-items] Querying items by transaction_id: ${numericId}`);
                                items = await (0, mysqlDb_1.executeQuery)(`
                  SELECT ti.*, p.nama as product_name 
                  FROM transaction_items ti
                  LEFT JOIN products p ON ti.product_id = p.id
                  WHERE ti.transaction_id = ? 
                  ORDER BY ti.id ASC
                `, [numericId]);
                            }
                            // If still no items, try with UUID
                            if (items.length === 0 && txUuidId) {
                                console.log(`[localdb-get-transaction-items] Querying items by uuid_transaction_id: ${txUuidId}`);
                                items = await (0, mysqlDb_1.executeQuery)(`
                  SELECT ti.*, p.nama as product_name 
                  FROM transaction_items ti
                  LEFT JOIN products p ON ti.product_id = p.id
                  WHERE ti.uuid_transaction_id = ? 
                  ORDER BY ti.id ASC
                `, [txUuidId]);
                            }
                        }
                        else {
                            console.log(`[localdb-get-transaction-items] Transaction not found in database for: ${transactionId}`);
                        }
                    }
                }
                console.log(`[localdb-get-transaction-items] Found ${items.length} items for transactionId: ${transactionId}`);
                if (items.length > 0) {
                    console.log(`[localdb-get-transaction-items] Sample item:`, {
                        id: items[0].id,
                        product_id: items[0].product_id,
                        product_name: items[0].product_name,
                        transaction_id: items[0].transaction_id,
                        uuid_transaction_id: items[0].uuid_transaction_id
                    });
                }
            }
            else {
                items = await (0, mysqlDb_1.executeQuery)(`
          SELECT ti.*, p.nama as product_name 
          FROM transaction_items ti
          LEFT JOIN products p ON ti.product_id = p.id
          ORDER BY ti.created_at DESC
        `);
            }
            // For each item, load customizations from normalized tables
            const itemsWithCustomizations = await Promise.all(items.map(async (item) => {
                // Use uuid_id for reading customizations (function expects UUID, not INT id)
                const itemUuid = (item.uuid_id || item.id);
                // Read main product customizations from normalized tables (bundle_product_id IS NULL)
                const customizations = await readCustomizationsFromNormalizedTables(itemUuid, null);
                // If item has bundle_selections_json, reconstruct it with customizations from normalized tables
                let bundleSelections = null;
                if (item.bundle_selections_json) {
                    try {
                        const bundleSelectionsJson = typeof item.bundle_selections_json === 'string'
                            ? item.bundle_selections_json
                            : JSON.stringify(item.bundle_selections_json);
                        bundleSelections = parseJsonArray(bundleSelectionsJson, 'bundle_selections_json');
                        // For each bundle selection, load customizations for each product from normalized tables
                        if (bundleSelections && bundleSelections.length > 0) {
                            bundleSelections = await Promise.all(bundleSelections.map(async (bundleSel) => {
                                if (!Array.isArray(bundleSel.selectedProducts))
                                    return bundleSel;
                                return {
                                    ...bundleSel,
                                    selectedProducts: await Promise.all(bundleSel.selectedProducts.map(async (selectedProduct) => {
                                        const bundleProductId = selectedProduct.product?.id;
                                        if (!bundleProductId)
                                            return selectedProduct;
                                        // Read customizations for this specific bundle product from normalized tables
                                        const productCustomizations = await readCustomizationsFromNormalizedTables(itemUuid, bundleProductId);
                                        return {
                                            ...selectedProduct,
                                            customizations: productCustomizations || undefined
                                        };
                                    }))
                                };
                            }));
                        }
                    }
                    catch (error) {
                        console.warn('⚠️ Error reconstructing bundle selections:', error);
                    }
                }
                return {
                    ...item,
                    customizations: customizations || [], // Main product customizations
                    bundleSelections: bundleSelections || null // Bundle selections with customizations from normalized tables
                };
            }));
            return itemsWithCustomizations;
        }
        catch (error) {
            console.error('Error getting transaction items:', error);
            return [];
        }
    });
    // NEW: Get normalized customizations for transaction items (for sync upload)
    electron_1.ipcMain.handle('localdb-get-transaction-item-customizations-normalized', async (event, transactionId) => {
        // #region agent log
        console.log('🔍 [DEBUG] Electron function called with transactionId:', transactionId);
        writeDebugLog(JSON.stringify({ location: 'main.ts:3762', message: 'Electron function called', data: { transactionId, type: typeof transactionId }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'D' }));
        // #endregion
        try {
            // Get all transaction items for this transaction
            // Support both UUID and numeric ID lookups (similar to localDbGetTransactionItems)
            const isReceiptNumberFormat = typeof transactionId === 'string' && /^0\d{15,}$/.test(String(transactionId).trim());
            const isNumeric = typeof transactionId === 'number' || (typeof transactionId === 'string' && /^\d+$/.test(String(transactionId).trim()));
            const isSimpleNumeric = isNumeric && !isReceiptNumberFormat;
            // #region agent log
            console.log('🔍 [DEBUG] Transaction ID analysis:', { transactionId, isReceiptNumberFormat, isNumeric, isSimpleNumeric });
            writeDebugLog(JSON.stringify({ location: 'main.ts:3768', message: 'Transaction ID analysis', data: { transactionId, isReceiptNumberFormat, isNumeric, isSimpleNumeric }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'D' }));
            // #endregion
            let items = [];
            if (isSimpleNumeric) {
                // Simple numeric ID - match by transaction_id
                // Convert transactionId to number if it's a string
                const numericId = typeof transactionId === 'string' ? parseInt(transactionId, 10) : transactionId;
                items = await (0, mysqlDb_1.executeQuery)('SELECT id FROM transaction_items WHERE transaction_id = ?', [numericId]);
                // #region agent log
                console.log('🔍 [DEBUG] Items found (numeric):', items.length, 'items for transaction_id', numericId, items.map(i => i.id));
                writeDebugLog(JSON.stringify({ location: 'main.ts:3786', message: 'Items found (numeric)', data: { transactionId, numericId, itemsCount: items.length, itemIds: items.map(i => i.id) }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'D' }));
                // #endregion
                // Debug: Check if customizations exist for these items
                if (items.length > 0) {
                    const itemIdsForCheck = items.map(i => i.id);
                    const placeholders = itemIdsForCheck.map(() => '?').join(',');
                    const existingCustomizations = await (0, mysqlDb_1.executeQuery)(`SELECT COUNT(*) as count FROM transaction_item_customizations WHERE transaction_item_id IN (${placeholders})`, itemIdsForCheck);
                    console.log('🔍 [DEBUG] Existing customizations in DB for these items:', existingCustomizations[0]?.count || 0);
                    writeDebugLog(JSON.stringify({ location: 'main.ts:3790', message: 'Existing customizations check', data: { itemIds: itemIdsForCheck, existingCount: existingCustomizations[0]?.count || 0 }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'D' }));
                }
            }
            else {
                // UUID or receipt number format - match by uuid_transaction_id
                items = await (0, mysqlDb_1.executeQuery)('SELECT id FROM transaction_items WHERE uuid_transaction_id = ?', [transactionId]);
                // #region agent log
                writeDebugLog(JSON.stringify({ location: 'main.ts:3790', message: 'Items found (UUID)', data: { transactionId, itemsCount: items.length, itemIds: items.map(i => i.id) }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'D' }));
                // #endregion
                // If no items found, try joining with transactions table
                if (items.length === 0) {
                    const tx = await (0, mysqlDb_1.executeQueryOne)('SELECT id FROM transactions WHERE uuid_id = ? OR CAST(receipt_number AS CHAR) = ? OR receipt_number = ? LIMIT 1', [transactionId, String(transactionId), transactionId]);
                    if (tx && tx.id) {
                        items = await (0, mysqlDb_1.executeQuery)('SELECT id FROM transaction_items WHERE transaction_id = ?', [tx.id]);
                        // #region agent log
                        writeDebugLog(JSON.stringify({ location: 'main.ts:3798', message: 'Items found (fallback)', data: { transactionId, txId: tx.id, itemsCount: items.length }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'D' }));
                        // #endregion
                    }
                }
            }
            const allCustomizations = [];
            const allOptions = [];
            // #region agent log
            console.log('🔍 [DEBUG] Starting to fetch customizations for', items.length, 'items');
            writeDebugLog(JSON.stringify({ location: 'main.ts:3791', message: 'Starting to fetch customizations', data: { transactionId, itemsCount: items.length, itemIds: items.map(i => i.id) }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'D' }));
            fetch('http://127.0.0.1:7242/ingest/7b565785-72b5-49f7-b2c0-57606ea0d0b5', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'main.ts:3828', message: 'Starting to fetch customizations', data: { transactionId, itemsCount: items.length, itemIds: items.map(i => i.id) }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'G' }) }).catch(() => { });
            // #endregion
            for (const item of items) {
                const itemId = item.id;
                // #region agent log
                console.log('🔍 [DEBUG] Fetching customizations for item:', itemId);
                writeDebugLog(JSON.stringify({ location: 'main.ts:3796', message: 'Fetching customizations for item', data: { itemId, transactionId }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'D' }));
                // #endregion
                // Get customizations for this item with customization type name from product_customization_types
                // Use LEFT JOIN - if table doesn't exist, will fall back to NULL and use fallback name
                let customizations = [];
                try {
                    customizations = await (0, mysqlDb_1.executeQuery)(`
            SELECT 
              tic.id,
              tic.transaction_item_id,
              tic.uuid_transaction_item_id,
              tic.customization_type_id,
              tic.bundle_product_id,
              tic.created_at,
              COALESCE(pct.name, CONCAT('Customization ', tic.customization_type_id)) as customization_type_name
            FROM transaction_item_customizations tic
            LEFT JOIN product_customization_types pct ON tic.customization_type_id = pct.id
            WHERE tic.transaction_item_id = ?
          `, [itemId]);
                    // #region agent log
                    console.log('🔍 [DEBUG] Customizations found for item', itemId, ':', customizations.length);
                    writeDebugLog(JSON.stringify({ location: 'main.ts:3812', message: 'Customizations query result', data: { itemId, customizationsCount: customizations.length, customizations: customizations.map((c) => ({ id: c.id, transaction_item_id: c.transaction_item_id, uuid_transaction_item_id: c.uuid_transaction_item_id })) }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'D' }));
                    fetch('http://127.0.0.1:7242/ingest/7b565785-72b5-49f7-b2c0-57606ea0d0b5', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'main.ts:3859', message: 'Customizations query result', data: { itemId, customizationsCount: customizations.length, customizations: customizations.map((c) => ({ id: c.id, transaction_item_id: c.transaction_item_id, uuid_transaction_item_id: c.uuid_transaction_item_id })) }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'G' }) }).catch(() => { });
                    // #endregion
                }
                catch (error) {
                    // #region agent log
                    writeDebugLog(JSON.stringify({ location: 'main.ts:3814', message: 'Customizations query error', data: { itemId, error: String(error) }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'D' }));
                    // #endregion
                    // If product_customization_types table doesn't exist, query without JOIN
                    console.warn('⚠️ product_customization_types table not found, using fallback names');
                    customizations = await (0, mysqlDb_1.executeQuery)(`
            SELECT 
              tic.id,
              tic.transaction_item_id,
              tic.uuid_transaction_item_id,
              tic.customization_type_id,
              tic.bundle_product_id,
              tic.created_at,
              CONCAT('Customization ', tic.customization_type_id) as customization_type_name
            FROM transaction_item_customizations tic
            WHERE tic.transaction_item_id = ?
          `, [itemId]);
                    // #region agent log
                    writeDebugLog(JSON.stringify({ location: 'main.ts:3826', message: 'Customizations query result (fallback)', data: { itemId, customizationsCount: customizations.length }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'D' }));
                    // #endregion
                }
                for (const customization of customizations) {
                    allCustomizations.push(customization);
                    // Get options for this customization
                    const customizationId = typeof customization.id === 'number' ? customization.id : (typeof customization.id === 'string' ? parseInt(String(customization.id), 10) : 0);
                    const options = await (0, mysqlDb_1.executeQuery)(`
            SELECT 
              id,
              transaction_item_customization_id,
              customization_option_id,
              option_name,
              price_adjustment,
              created_at
            FROM transaction_item_customization_options
            WHERE transaction_item_customization_id = ?
          `, [customizationId]);
                    allOptions.push(...options);
                }
            }
            // #region agent log
            console.log('🔍 [DEBUG] Returning customizations:', allCustomizations.length, 'customizations,', allOptions.length, 'options');
            writeDebugLog(JSON.stringify({ location: 'main.ts:3849', message: 'Returning customizations', data: { transactionId, totalCustomizations: allCustomizations.length, totalOptions: allOptions.length }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'D' }));
            fetch('http://127.0.0.1:7242/ingest/7b565785-72b5-49f7-b2c0-57606ea0d0b5', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'main.ts:3906', message: 'Returning customizations', data: { transactionId, totalCustomizations: allCustomizations.length, totalOptions: allOptions.length, itemsProcessed: items.length }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'G' }) }).catch(() => { });
            // #endregion
            return {
                customizations: allCustomizations,
                options: allOptions
            };
        }
        catch (error) {
            // #region agent log
            writeDebugLog(JSON.stringify({ location: 'main.ts:3890', message: 'Error in electron function', data: { transactionId, error: String(error), errorStack: error instanceof Error ? error.stack : undefined }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'D' }));
            // #endregion
            console.error('Error getting normalized customizations:', error);
            return { customizations: [], options: [] };
        }
    });
    // Upsert transaction item customizations (for downloading from server)
    electron_1.ipcMain.handle('localdb-upsert-transaction-item-customizations', async (event, rows) => {
        if (!Array.isArray(rows) || rows.length === 0)
            return { success: true, count: 0 };
        try {
            const queries = rows
                .map(row => {
                const getId = () => {
                    const val = row.id;
                    if (typeof val === 'number')
                        return val;
                    if (typeof val === 'string') {
                        const num = Number(val);
                        return isNaN(num) ? null : num;
                    }
                    return null;
                };
                const getNumber = (key) => {
                    const val = row[key];
                    if (typeof val === 'number')
                        return val;
                    if (typeof val === 'string') {
                        const num = Number(val);
                        return isNaN(num) ? null : num;
                    }
                    return null;
                };
                const getString = (key) => (typeof row[key] === 'string' ? row[key] : null);
                const getDate = (key) => {
                    const val = row[key];
                    if (val instanceof Date)
                        return val;
                    if (typeof val === 'string' || typeof val === 'number')
                        return val;
                    return null;
                };
                // If id is null/undefined/0, let database auto-generate it
                const rowId = getId();
                const hasId = rowId !== null && rowId !== 0;
                const transactionItemId = getNumber('transaction_item_id'); // transaction_item_id is a numeric foreign key, not a string
                const customizationTypeId = getNumber('customization_type_id');
                const bundleProductId = getNumber('bundle_product_id');
                const createdDate = getDate('created_at');
                const createdAt = createdDate ? (0, mysqlDb_1.toMySQLDateTime)(createdDate) : (0, mysqlDb_1.toMySQLDateTime)(new Date());
                // Validate required fields - transaction_item_id cannot be null
                if (transactionItemId === null || transactionItemId === 0) {
                    console.warn('⚠️ [TRANSACTION ITEM CUSTOMIZATIONS UPSERT] Skipping row with null/zero transaction_item_id:', {
                        rowId,
                        customizationTypeId,
                        row: JSON.stringify(row).substring(0, 200)
                    });
                    return null; // Skip this row
                }
                if (customizationTypeId === null || customizationTypeId === 0) {
                    console.warn('⚠️ [TRANSACTION ITEM CUSTOMIZATIONS UPSERT] Skipping row with null/zero customization_type_id:', {
                        rowId,
                        transactionItemId,
                        row: JSON.stringify(row).substring(0, 200)
                    });
                    return null; // Skip this row
                }
                if (hasId) {
                    return {
                        sql: `
              INSERT INTO transaction_item_customizations (
                id, transaction_item_id, customization_type_id, bundle_product_id, created_at
              ) VALUES (?, ?, ?, ?, ?)
              ON DUPLICATE KEY UPDATE
                transaction_item_id = VALUES(transaction_item_id),
                customization_type_id = VALUES(customization_type_id),
                bundle_product_id = VALUES(bundle_product_id),
                created_at = VALUES(created_at)
            `,
                        params: [
                            rowId,
                            transactionItemId,
                            customizationTypeId,
                            bundleProductId,
                            createdAt
                        ]
                    };
                }
                else {
                    // Auto-generate ID
                    return {
                        sql: `
              INSERT INTO transaction_item_customizations (
                transaction_item_id, customization_type_id, bundle_product_id, created_at
              ) VALUES (?, ?, ?, ?)
            `,
                        params: [
                            transactionItemId,
                            customizationTypeId,
                            bundleProductId,
                            createdAt
                        ]
                    };
                }
            })
                .filter((query) => query !== null); // Remove null entries (invalid rows)
            if (queries.length === 0) {
                console.warn('⚠️ [TRANSACTION ITEM CUSTOMIZATIONS UPSERT] No valid rows to insert after filtering');
                return { success: true, count: 0 };
            }
            await (0, mysqlDb_1.executeTransaction)(queries);
            return { success: true, count: queries.length };
        }
        catch (error) {
            console.error('Error upserting transaction item customizations:', error);
            return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
    });
    // Upsert transaction item customization options (for downloading from server)
    electron_1.ipcMain.handle('localdb-upsert-transaction-item-customization-options', async (event, rows) => {
        if (!Array.isArray(rows) || rows.length === 0)
            return { success: true, count: 0 };
        try {
            const queries = rows.map(row => {
                const getId = () => {
                    const val = row.id;
                    if (typeof val === 'number')
                        return val;
                    if (typeof val === 'string') {
                        const num = Number(val);
                        return isNaN(num) ? null : num;
                    }
                    return null;
                };
                const getNumber = (key) => {
                    const val = row[key];
                    if (typeof val === 'number')
                        return val;
                    if (typeof val === 'string') {
                        const num = Number(val);
                        return isNaN(num) ? null : num;
                    }
                    return null;
                };
                const getString = (key) => (typeof row[key] === 'string' ? row[key] : null);
                const getDate = (key) => {
                    const val = row[key];
                    if (val instanceof Date)
                        return val;
                    if (typeof val === 'string' || typeof val === 'number')
                        return val;
                    return null;
                };
                // If id is null/undefined/0, let database auto-generate it
                const rowId = getId();
                const hasId = rowId !== null && rowId !== 0;
                const transactionItemCustomizationId = getNumber('transaction_item_customization_id');
                const customizationOptionId = getNumber('customization_option_id');
                const optionName = getString('option_name');
                const priceAdjustment = getNumber('price_adjustment') ?? 0;
                const createdDate = getDate('created_at');
                const createdAt = createdDate ? (0, mysqlDb_1.toMySQLDateTime)(createdDate) : (0, mysqlDb_1.toMySQLDateTime)(new Date());
                if (hasId) {
                    return {
                        sql: `
              INSERT INTO transaction_item_customization_options (
                id, transaction_item_customization_id, customization_option_id, 
                option_name, price_adjustment, created_at
              ) VALUES (?, ?, ?, ?, ?, ?)
              ON DUPLICATE KEY UPDATE
                transaction_item_customization_id = VALUES(transaction_item_customization_id),
                customization_option_id = VALUES(customization_option_id),
                option_name = VALUES(option_name),
                price_adjustment = VALUES(price_adjustment),
                created_at = VALUES(created_at)
            `,
                        params: [
                            rowId,
                            transactionItemCustomizationId,
                            customizationOptionId,
                            optionName,
                            priceAdjustment,
                            createdAt
                        ]
                    };
                }
                else {
                    // Auto-generate ID
                    return {
                        sql: `
              INSERT INTO transaction_item_customization_options (
                transaction_item_customization_id, customization_option_id, 
                option_name, price_adjustment, created_at
              ) VALUES (?, ?, ?, ?, ?)
            `,
                        params: [
                            transactionItemCustomizationId,
                            customizationOptionId,
                            optionName,
                            priceAdjustment,
                            createdAt
                        ]
                    };
                }
            });
            await (0, mysqlDb_1.executeTransaction)(queries);
            return { success: true, count: rows.length };
        }
        catch (error) {
            console.error('Error upserting transaction item customization options:', error);
            return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
    });
    electron_1.ipcMain.handle('localdb-get-transaction-refunds', async (event, transactionUuid) => {
        try {
            return await (0, mysqlDb_1.executeQuery)(`
        SELECT *
        FROM transaction_refunds
        WHERE transaction_uuid = ?
        ORDER BY refunded_at DESC, id DESC
      `, [transactionUuid]);
        }
        catch (error) {
            console.error('Error getting transaction refunds:', error);
            return [];
        }
    });
    electron_1.ipcMain.handle('localdb-get-shift-refunds', async (event, payload) => {
        try {
            const { userId, businessId, shiftUuid, shiftStart, shiftEnd } = payload;
            let query = `
        SELECT 
          tr.uuid_id as refund_uuid,
          tr.transaction_uuid,
          tr.refund_amount,
          tr.cash_delta,
          tr.refunded_at,
          tr.refunded_by,
          tr.payment_method_id,
          tr.reason,
          tr.note,
          t.uuid_id as transaction_uuid_id,
          t.payment_method,
          t.final_amount,
          t.created_at as transaction_created_at
        FROM transaction_refunds tr
        INNER JOIN transactions t ON tr.transaction_uuid = t.uuid_id
        WHERE tr.business_id = ?
        AND tr.status != 'failed'
      `;
            const params = [businessId];
            if (shiftUuid) {
                query += ' AND (tr.shift_uuid = ?';
                params.push(shiftUuid);
                query += ' OR (tr.shift_uuid IS NULL';
                if (userId !== null) {
                    query += ' AND tr.refunded_by = ?';
                    params.push(userId);
                }
                query += ' AND tr.refunded_at >= ?';
                params.push((0, mysqlDb_1.toMySQLDateTime)(shiftStart));
                if (shiftEnd) {
                    query += ' AND tr.refunded_at <= ?';
                    params.push((0, mysqlDb_1.toMySQLDateTime)(shiftEnd));
                }
                query += '))';
            }
            else {
                if (userId !== null) {
                    query += ' AND tr.refunded_by = ?';
                    params.push(userId);
                }
                query += ' AND tr.refunded_at >= ?';
                params.push((0, mysqlDb_1.toMySQLDateTime)(shiftStart));
                if (shiftEnd) {
                    query += ' AND tr.refunded_at <= ?';
                    params.push((0, mysqlDb_1.toMySQLDateTime)(shiftEnd));
                }
            }
            query += ' ORDER BY tr.refunded_at DESC';
            return await (0, mysqlDb_1.executeQuery)(query, params);
        }
        catch (error) {
            console.error('Error getting shift refunds:', error);
            return [];
        }
    });
    electron_1.ipcMain.handle('localdb-upsert-transaction-refunds', async (event, rows) => {
        try {
            const queries = rows.map(r => {
                const uuidId = typeof r.uuid_id === 'string' ? r.uuid_id : String(r.uuid_id ?? '');
                const transactionUuid = typeof r.transaction_uuid === 'string' ? r.transaction_uuid : String(r.transaction_uuid ?? '');
                const businessId = typeof r.business_id === 'number' ? r.business_id : (r.business_id ? Number(r.business_id) : 14);
                const shiftUuid = typeof r.shift_uuid === 'string' ? r.shift_uuid : (r.shift_uuid ? String(r.shift_uuid) : null);
                const refundedBy = typeof r.refunded_by === 'number' ? r.refunded_by : (r.refunded_by ? Number(r.refunded_by) : 0);
                const refundAmount = typeof r.refund_amount === 'number' ? r.refund_amount : (r.refund_amount ? Number(r.refund_amount) : 0);
                const cashDelta = typeof r.cash_delta === 'number' ? r.cash_delta : (r.cash_delta ? Number(r.cash_delta) : 0);
                const paymentMethodId = typeof r.payment_method_id === 'number' ? r.payment_method_id : (r.payment_method_id ? Number(r.payment_method_id) : 1);
                const reason = typeof r.reason === 'string' ? r.reason : (r.reason ? String(r.reason) : null);
                const note = typeof r.note === 'string' ? r.note : (r.note ? String(r.note) : null);
                const refundType = typeof r.refund_type === 'string' ? r.refund_type : 'full';
                const status = typeof r.status === 'string' ? r.status : 'completed';
                const refundedAt = r.refunded_at ? (typeof r.refunded_at === 'number' || typeof r.refunded_at === 'string' ? r.refunded_at : new Date()) : new Date();
                const createdAt = r.created_at ? (typeof r.created_at === 'number' || typeof r.created_at === 'string' ? r.created_at : new Date()) : new Date();
                const updatedAt = r.updated_at ? (typeof r.updated_at === 'number' ? new Date(r.updated_at) : (typeof r.updated_at === 'string' ? r.updated_at : new Date())) : new Date();
                const syncedAt = r.synced_at ? (typeof r.synced_at === 'number' ? new Date(r.synced_at) : (typeof r.synced_at === 'string' ? r.synced_at : null)) : null;
                return {
                    sql: `
            INSERT INTO transaction_refunds (
              uuid_id,
              transaction_uuid,
              business_id,
              shift_uuid,
              refunded_by,
              refund_amount,
              cash_delta,
              payment_method_id,
              reason,
              note,
              refund_type,
              status,
              refunded_at,
              created_at,
              updated_at,
              synced_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              transaction_uuid = VALUES(transaction_uuid),
              business_id = VALUES(business_id),
              shift_uuid = VALUES(shift_uuid),
              refunded_by = VALUES(refunded_by),
              refund_amount = VALUES(refund_amount),
              cash_delta = VALUES(cash_delta),
              payment_method_id = VALUES(payment_method_id),
              reason = VALUES(reason),
              note = VALUES(note),
              refund_type = VALUES(refund_type),
              status = VALUES(status),
              refunded_at = VALUES(refunded_at),
              created_at = VALUES(created_at),
              updated_at = VALUES(updated_at),
              synced_at = VALUES(synced_at)
          `,
                    params: [
                        uuidId,
                        transactionUuid,
                        businessId,
                        shiftUuid,
                        refundedBy,
                        refundAmount,
                        cashDelta,
                        paymentMethodId,
                        reason,
                        note,
                        refundType,
                        status,
                        (0, mysqlDb_1.toMySQLDateTime)(refundedAt),
                        (0, mysqlDb_1.toMySQLDateTime)(createdAt),
                        (0, mysqlDb_1.toMySQLDateTime)(updatedAt),
                        syncedAt ? (0, mysqlDb_1.toMySQLDateTime)(syncedAt) : null
                    ]
                };
            });
            await (0, mysqlDb_1.executeTransaction)(queries);
            return { success: true };
        }
        catch (error) {
            console.error('Error upserting transaction refunds:', error);
            return { success: false, error: String(error) };
        }
    });
    electron_1.ipcMain.handle('localdb-apply-transaction-refund', async (event, payload) => {
        try {
            const { refund, transactionUpdate } = payload || {};
            if (!refund || !refund.uuid_id) {
                return { success: false, error: 'Invalid refund payload' };
            }
            // Auto-link to active shift if shift_uuid is missing
            let finalShiftUuid = refund.shift_uuid;
            if (!finalShiftUuid && refund.refunded_by) {
                try {
                    const activeShift = await (0, mysqlDb_1.executeQueryOne)(`
            SELECT uuid_id 
            FROM shifts 
            WHERE user_id = ? AND status = 'active' AND business_id = ?
            ORDER BY shift_start DESC 
            LIMIT 1
          `, [
                        typeof refund.refunded_by === 'number' ? refund.refunded_by : (typeof refund.refunded_by === 'string' ? parseInt(String(refund.refunded_by), 10) : 0),
                        typeof refund.business_id === 'number' ? refund.business_id : (refund.business_id ? parseInt(String(refund.business_id), 10) : 14)
                    ]);
                    if (activeShift) {
                        finalShiftUuid = activeShift.uuid_id;
                        console.log(`🔗 [REFUND] Linked refund ${refund.uuid_id} to active shift ${finalShiftUuid}`);
                    }
                }
                catch (e) {
                    console.warn('⚠️ [REFUND] Failed to link refund to active shift:', e);
                }
            }
            const refundedAt = (0, mysqlDb_1.toMySQLDateTime)(refund.refunded_at ?? new Date());
            const createdAt = (0, mysqlDb_1.toMySQLDateTime)(refund.created_at ?? refundedAt);
            const updatedAt = (0, mysqlDb_1.toMySQLDateTime)(refund.updated_at ? (typeof refund.updated_at === 'number' ? new Date(refund.updated_at) : refund.updated_at) : new Date());
            const syncedAt = refund.synced_at ? (0, mysqlDb_1.toMySQLDateTime)(typeof refund.synced_at === 'number' ? new Date(refund.synced_at) : refund.synced_at) : null;
            const queries = [];
            // Check if refund with this UUID already exists to prevent duplicates
            // Since uuid_id doesn't have a UNIQUE constraint, we need to check manually
            const existingRefund = await (0, mysqlDb_1.executeQueryOne)('SELECT id FROM transaction_refunds WHERE uuid_id = ? LIMIT 1', [refund.uuid_id]);
            if (existingRefund) {
                // Update existing refund record instead of inserting duplicate
                queries.push({
                    sql: `
            UPDATE transaction_refunds
            SET transaction_uuid = ?,
                business_id = ?,
                shift_uuid = ?,
                refunded_by = ?,
                refund_amount = ?,
                cash_delta = ?,
                payment_method_id = ?,
                reason = ?,
                note = ?,
                refund_type = ?,
                status = ?,
                refunded_at = ?,
                updated_at = ?,
                synced_at = ?
            WHERE uuid_id = ?
          `,
                    params: [
                        refund.transaction_uuid,
                        Number(refund.business_id ?? 14),
                        finalShiftUuid ?? null,
                        Number(refund.refunded_by ?? 0),
                        Number(refund.refund_amount ?? 0),
                        Number(refund.cash_delta ?? 0),
                        Number(refund.payment_method_id ?? 1),
                        refund.reason ?? null,
                        refund.note ?? null,
                        refund.refund_type ?? 'full',
                        refund.status ?? 'completed',
                        refundedAt,
                        updatedAt,
                        syncedAt,
                        refund.uuid_id
                    ]
                });
            }
            else {
                // Insert new refund record
                queries.push({
                    sql: `
            INSERT INTO transaction_refunds (
              uuid_id,
              transaction_uuid,
              business_id,
              shift_uuid,
              refunded_by,
              refund_amount,
              cash_delta,
              payment_method_id,
              reason,
              note,
              refund_type,
              status,
              refunded_at,
              created_at,
              updated_at,
              synced_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
                    params: [
                        refund.uuid_id,
                        refund.transaction_uuid,
                        Number(refund.business_id ?? 14),
                        finalShiftUuid ?? null,
                        Number(refund.refunded_by ?? 0),
                        Number(refund.refund_amount ?? 0),
                        Number(refund.cash_delta ?? 0),
                        Number(refund.payment_method_id ?? 1),
                        refund.reason ?? null,
                        refund.note ?? null,
                        refund.refund_type ?? 'full',
                        refund.status ?? 'completed',
                        refundedAt,
                        createdAt,
                        updatedAt,
                        syncedAt
                    ]
                });
            }
            if (transactionUpdate?.id) {
                // Only update transaction if transactionUpdate fields are explicitly provided (not undefined)
                // This prevents overwriting transaction data when syncing refunds that were already applied locally
                const updateFields = [];
                const updateParams = [];
                if (transactionUpdate.refund_status !== undefined) {
                    updateFields.push('refund_status = ?');
                    updateParams.push(transactionUpdate.refund_status ?? null);
                }
                if (transactionUpdate.refund_total !== undefined) {
                    updateFields.push('refund_total = ?');
                    updateParams.push(typeof transactionUpdate.refund_total === 'number' ? transactionUpdate.refund_total : null);
                }
                if (transactionUpdate.last_refunded_at !== undefined) {
                    updateFields.push('last_refunded_at = ?');
                    updateParams.push(transactionUpdate.last_refunded_at ?? refundedAt);
                }
                if (transactionUpdate.status !== undefined) {
                    updateFields.push('status = ?');
                    updateParams.push(transactionUpdate.status ?? null);
                }
                // Only execute UPDATE if there are fields to update
                if (updateFields.length > 0) {
                    updateParams.push(transactionUpdate.id);
                    queries.push({
                        sql: `
              UPDATE transactions
              SET ${updateFields.join(', ')}
              WHERE id = ?
            `,
                        params: updateParams
                    });
                }
            }
            await (0, mysqlDb_1.executeTransaction)(queries);
            return { success: true };
        }
        catch (error) {
            console.error('Error applying transaction refund:', error);
            return { success: false, error: String(error) };
        }
    });
    // Mark transactions as synced
    electron_1.ipcMain.handle('localdb-mark-transactions-synced', async (event, transactionIds) => {
        if (transactionIds.length === 0)
            return { success: true };
        try {
            const now = (0, mysqlDb_1.toMySQLDateTime)(new Date());
            const placeholders = transactionIds.map(() => '?').join(',');
            // CRITICAL FIX: Use uuid_id instead of id, because smart sync passes UUID strings
            await (0, mysqlDb_1.executeUpdate)(`UPDATE transactions SET synced_at = ?, sync_status = ?, sync_attempts = 0 WHERE uuid_id IN (${placeholders})`, [now, 'synced', ...transactionIds]);
            console.log(`✅ [MARK SYNCED] Marked ${transactionIds.length} transaction(s) as synced: ${transactionIds.slice(0, 3).join(', ')}${transactionIds.length > 3 ? '...' : ''}`);
            return { success: true };
        }
        catch (error) {
            console.error('Error marking transactions as synced:', error);
            return { success: false };
        }
    });
    // Reset transaction sync status (set synced_at to NULL and sync_status to 'pending')
    electron_1.ipcMain.handle('localdb-reset-transaction-sync', async (event, transactionId) => {
        try {
            // CRITICAL FIX: Use uuid_id instead of id, and also reset sync_status to 'pending'
            await (0, mysqlDb_1.executeUpdate)('UPDATE transactions SET synced_at = NULL, sync_status = ? WHERE uuid_id = ?', ['pending', transactionId]);
            console.log(`🔄 [RESET SYNC] Transaction ${transactionId} sync status reset to pending`);
            return { success: true };
        }
        catch (error) {
            console.error('Error resetting transaction sync status:', error);
            return { success: false };
        }
    });
    // Reset transaction sync status by date range (for testing sync feature)
    // Note: Dates are interpreted as UTC+7 (local timezone), but stored in UTC in database
    electron_1.ipcMain.handle('localdb-reset-transactions-sync-by-date', async (event, payload) => {
        try {
            const { businessId, fromDate, toDate } = payload;
            if (!businessId) {
                return { success: false, error: 'businessId is required' };
            }
            let query = 'UPDATE transactions SET synced_at = NULL, sync_status = ?, sync_attempts = 0, last_sync_attempt = NULL WHERE business_id = ?';
            const params = ['pending', businessId];
            if (fromDate && toDate) {
                // Convert UTC+7 date to UTC range for database query
                // Database stores timestamps in UTC, but user inputs are in UTC+7
                // UTC+7 2025-12-26 00:00:00 = UTC 2025-12-25 17:00:00 (subtract 7 hours)
                // UTC+7 2025-12-26 23:59:59 = UTC 2025-12-26 16:59:59 (subtract 7 hours)
                const fromDateOnly = fromDate.includes(' ') ? fromDate.split(' ')[0] : fromDate;
                const toDateOnly = toDate.includes(' ') ? toDate.split(' ')[0] : toDate;
                // Helper to convert UTC+7 date/time to UTC
                const convertUtc7ToUtc = (dateStr, isEnd) => {
                    const [year, month, day] = dateStr.split('-').map(Number);
                    // Create date in UTC+7 (treat as UTC first, then subtract 7 hours)
                    const utc7Date = new Date(Date.UTC(year, month - 1, day, isEnd ? 23 : 0, isEnd ? 59 : 0, isEnd ? 59 : 0, isEnd ? 999 : 0));
                    // Subtract 7 hours (7 * 60 * 60 * 1000 ms)
                    const utcDate = new Date(utc7Date.getTime() - 7 * 60 * 60 * 1000);
                    return utcDate.toISOString().slice(0, 19).replace('T', ' ');
                };
                if (fromDateOnly === toDateOnly) {
                    // Single date: UTC+7 date = UTC range from (date-1) 17:00 to (date) 16:59:59
                    const startUTC = convertUtc7ToUtc(fromDateOnly, false); // 00:00:00 UTC+7
                    const endUTC = convertUtc7ToUtc(toDateOnly, true); // 23:59:59 UTC+7
                    query += ' AND created_at >= ? AND created_at <= ?';
                    params.push(startUTC);
                    params.push(endUTC);
                }
                else {
                    // Date range
                    if (fromDateOnly) {
                        const startUTC = convertUtc7ToUtc(fromDateOnly, false);
                        query += ' AND created_at >= ?';
                        params.push(startUTC);
                    }
                    if (toDateOnly) {
                        const endUTC = convertUtc7ToUtc(toDateOnly, true);
                        query += ' AND created_at <= ?';
                        params.push(endUTC);
                    }
                }
            }
            const result = await (0, mysqlDb_1.executeUpdate)(query, params);
            console.log(`🔄 [RESET SYNC BY DATE] Reset ${result} transaction(s) to pending status for business ${businessId}${fromDate ? ` from ${fromDate} (UTC+7)` : ''}${toDate ? ` to ${toDate} (UTC+7)` : ''}`);
            return { success: true, count: result };
        }
        catch (error) {
            console.error('Error resetting transactions sync status by date:', error);
            return { success: false, error: String(error) };
        }
    });
    // ========== SHIFTS IPC HANDLERS ==========
    // Get active shift for a business (with ownership flag)
    electron_1.ipcMain.handle('localdb-get-active-shift', async (event, userId, businessId = 14) => {
        try {
            const shift = await (0, mysqlDb_1.executeQueryOne)(`
        SELECT *
        FROM shifts 
        WHERE business_id = ? AND status = 'active'
        ORDER BY shift_start ASC
        LIMIT 1
      `, [businessId]);
            if (!shift) {
                return { shift: null, isCurrentUserShift: false };
            }
            return {
                shift,
                isCurrentUserShift: Number(shift.user_id) === Number(userId),
            };
        }
        catch (error) {
            console.error('Error getting active shift:', error);
            return { shift: null, isCurrentUserShift: false };
        }
    });
    // Get shifts history (duplicate handler - already migrated above, removing this duplicate)
    // This handler was already migrated earlier in the file
    // Get all users who have shifts
    electron_1.ipcMain.handle('localdb-get-shift-users', async (event, businessId = 14) => {
        try {
            return await (0, mysqlDb_1.executeQuery)(`
        SELECT DISTINCT user_id, user_name 
        FROM shifts 
        WHERE business_id = ? 
        ORDER BY user_name
      `, [businessId]);
        }
        catch (error) {
            console.error('Error getting shift users:', error);
            return [];
        }
    });
    // Create a new shift
    electron_1.ipcMain.handle('localdb-create-shift', async (event, shiftData) => {
        try {
            // Validate that business exists (required for foreign key constraint)
            const business = await (0, mysqlDb_1.executeQueryOne)('SELECT id FROM businesses WHERE id = ? LIMIT 1', [shiftData.business_id]);
            if (!business) {
                console.error(`❌ [SHIFTS] Business ID ${shiftData.business_id} not found in local database`);
                return {
                    success: false,
                    error: `Business ID ${shiftData.business_id} tidak ditemukan di database lokal. Silakan sinkronkan data dari server terlebih dahulu.`
                };
            }
            // Validate that user exists (required for foreign key constraint)
            const user = await (0, mysqlDb_1.executeQueryOne)('SELECT id FROM users WHERE id = ? LIMIT 1', [shiftData.user_id]);
            if (!user) {
                console.error(`❌ [SHIFTS] User ID ${shiftData.user_id} not found in local database`);
                return {
                    success: false,
                    error: `User ID ${shiftData.user_id} tidak ditemukan di database lokal. Silakan sinkronkan data dari server terlebih dahulu.`
                };
            }
            // Ensure there is no other active shift for the business
            const existingShift = await (0, mysqlDb_1.executeQueryOne)(`
        SELECT id, user_id, user_name, shift_start
        FROM shifts
        WHERE business_id = ? AND status = 'active'
        ORDER BY shift_start ASC
        LIMIT 1
      `, [shiftData.business_id]);
            if (existingShift) {
                return { success: false, error: 'ACTIVE_SHIFT_EXISTS', activeShift: existingShift };
            }
            const now = new Date();
            const nowMySQL = (0, mysqlDb_1.toMySQLDateTime)(now);
            await (0, mysqlDb_1.executeUpdate)(`
        INSERT INTO shifts (
          uuid_id, business_id, user_id, user_name, shift_start, 
          modal_awal, status, created_at, updated_at, synced_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, NULL)
      `, [
                shiftData.uuid_id ?? null,
                shiftData.business_id ?? null,
                shiftData.user_id ?? null,
                shiftData.user_name ?? null,
                nowMySQL,
                shiftData.modal_awal ?? null,
                nowMySQL,
                Date.now()
            ]);
            console.log(`✅ [SHIFTS] Created shift ${shiftData.uuid_id} for user ${shiftData.user_id}`);
            return { success: true };
        }
        catch (error) {
            console.error('Error creating shift:', error);
            const errorMessage = String(error);
            // Provide more helpful error message for foreign key constraint failures
            if (errorMessage.includes('FOREIGN KEY constraint failed') || errorMessage.includes('foreign key constraint')) {
                return {
                    success: false,
                    error: 'Data business atau user tidak ditemukan di database lokal. Silakan sinkronkan data dari server terlebih dahulu sebelum memulai shift.'
                };
            }
            return { success: false, error: errorMessage };
        }
    });
    // End a shift
    electron_1.ipcMain.handle('localdb-end-shift', async (event, payload) => {
        try {
            const { shiftId, kasAkhir } = payload || {};
            if (!shiftId) {
                return { success: false, error: 'Shift ID is required' };
            }
            const shiftRow = await (0, mysqlDb_1.executeQueryOne)(`SELECT * FROM shifts WHERE id = ?`, [shiftId]);
            if (!shiftRow) {
                return { success: false, error: 'Shift not found' };
            }
            if (shiftRow.status !== 'active') {
                return { success: false, error: 'Shift already ended' };
            }
            const now = (0, mysqlDb_1.toMySQLDateTime)(new Date());
            const cashMethod = await (0, mysqlDb_1.executeQueryOne)('SELECT id FROM payment_methods WHERE code = ? LIMIT 1', ['cash']);
            const cashMethodId = cashMethod?.id || 1;
            const shiftSalesResult = await (0, mysqlDb_1.executeQueryOne)(`
        SELECT COALESCE(SUM(final_amount), 0) as cash_total
        FROM transactions
        WHERE business_id = ?
          AND user_id = ?
          AND created_at >= ?
          AND created_at <= ?
          AND payment_method_id = ?
          AND status = 'completed'
      `, [
                shiftRow.business_id,
                shiftRow.user_id,
                shiftRow.shift_start,
                (0, mysqlDb_1.toMySQLDateTime)(now),
                cashMethodId
            ]);
            const shiftRefundResult = await (0, mysqlDb_1.executeQueryOne)(`
        SELECT COALESCE(SUM(refund_amount), 0) as refund_total
        FROM transaction_refunds
        WHERE business_id = ?
          AND refunded_by = ?
          AND refunded_at >= ?
          AND refunded_at <= ?
          AND status != 'failed'
      `, [
                shiftRow.business_id,
                shiftRow.user_id,
                shiftRow.shift_start,
                (0, mysqlDb_1.toMySQLDateTime)(now)
            ]);
            const cashSalesTotal = shiftSalesResult?.cash_total || 0;
            const cashRefundTotal = shiftRefundResult?.refund_total || 0;
            const kasExpected = Number((Number(shiftRow.modal_awal || 0) + cashSalesTotal - cashRefundTotal).toFixed(2));
            let kasAkhirValue = kasAkhir !== undefined && kasAkhir !== null ? Number(kasAkhir) : null;
            if (kasAkhirValue !== null && Number.isNaN(kasAkhirValue)) {
                kasAkhirValue = null;
            }
            let kasSelisih = null;
            let kasSelisihLabel = 'balanced';
            if (kasAkhirValue !== null) {
                kasSelisih = Number((kasAkhirValue - kasExpected).toFixed(2));
                if (Math.abs(kasSelisih) < 0.01) {
                    kasSelisih = 0;
                    kasSelisihLabel = 'balanced';
                }
                else {
                    kasSelisihLabel = kasSelisih > 0 ? 'plus' : 'minus';
                }
            }
            const affectedRows = await (0, mysqlDb_1.executeUpdate)(`
        UPDATE shifts 
        SET shift_end = ?, 
            status = 'completed', 
            updated_at = ?,
            kas_akhir = ?,
            kas_expected = ?,
            kas_selisih = ?,
            kas_selisih_label = ?,
            cash_sales_total = ?,
            cash_refund_total = ?
        WHERE id = ? AND status = 'active'
      `, [
                now,
                Date.now(),
                kasAkhirValue,
                kasExpected,
                kasSelisih,
                kasSelisihLabel,
                cashSalesTotal,
                cashRefundTotal,
                shiftId
            ]);
            if (affectedRows === 0) {
                return { success: false, error: 'Shift not found or already ended' };
            }
            console.log(`✅ [SHIFTS] Ended shift ${shiftId}`);
            return {
                success: true,
                cashSummary: {
                    kas_mulai: shiftRow.modal_awal || 0,
                    kas_expected: kasExpected,
                    kas_akhir: kasAkhirValue,
                    cash_sales: cashSalesTotal,
                    cash_refunds: cashRefundTotal,
                    variance: kasSelisih,
                    variance_label: kasSelisihLabel
                }
            };
        }
        catch (error) {
            console.error('Error ending shift:', error);
            return { success: false, error: String(error) };
        }
    });
    // Get shift statistics
    electron_1.ipcMain.handle('localdb-get-shift-statistics', async (event, userId, shiftStart, shiftEnd, businessId = 14, shiftUuid) => {
        try {
            // Convert ISO date strings to MySQL datetime format
            const shiftStartMySQL = (0, mysqlDb_1.toMySQLDateTime)(shiftStart);
            const shiftEndMySQL = shiftEnd ? (0, mysqlDb_1.toMySQLDateTime)(shiftEnd) : null; // Combined statistics query including voucher metrics
            // Prioritize shift_uuid filtering when available, as it's more accurate than time-based filtering
            let statsQuery = `
        SELECT 
          COUNT(*) as order_count,
          COALESCE(SUM(final_amount), 0) as total_amount,
          COALESCE(SUM(
            CASE 
              WHEN voucher_type = 'free' THEN total_amount
              ELSE COALESCE(voucher_discount, 0)
            END
          ), 0) as total_discount,
          COALESCE(SUM(
            CASE 
              WHEN (voucher_discount IS NOT NULL AND voucher_discount > 0) OR voucher_type = 'free' THEN 1 
              ELSE 0 
            END
          ), 0) as voucher_count
        FROM transactions
        WHERE business_id = ?
        AND status != 'archived'
      `;
            const statsParams = [businessId];
            // Add user_id filter only if userId is not null
            if (userId !== null) {
                statsQuery += ' AND user_id = ?';
                statsParams.push(userId);
            }
            // Use shift_uuid if provided, otherwise fall back to time-based filtering
            if (shiftUuid) {
                statsQuery += ' AND shift_uuid = ?';
                statsParams.push(shiftUuid);
            }
            else {
                statsQuery += ' AND created_at >= ?';
                statsParams.push(shiftStartMySQL);
                if (shiftEnd) {
                    statsQuery += ' AND created_at <= ?';
                    statsParams.push(shiftEndMySQL);
                }
            }
            const statsResult = await (0, mysqlDb_1.executeQueryOne)(statsQuery, statsParams);
            return {
                order_count: statsResult?.order_count || 0,
                total_amount: statsResult?.total_amount || 0,
                total_discount: statsResult?.total_discount || 0,
                voucher_count: statsResult?.voucher_count || 0
            };
        }
        catch (error) {
            console.error('Error getting shift statistics:', error);
            return {
                order_count: 0,
                total_amount: 0,
                total_discount: 0,
                voucher_count: 0
            };
        }
    });
    // Get payment method breakdown
    electron_1.ipcMain.handle('localdb-get-payment-breakdown', async (event, userId, shiftStart, shiftEnd, businessId = 14) => {
        try {
            // Convert ISO date strings to MySQL datetime format
            const shiftStartMySQL = (0, mysqlDb_1.toMySQLDateTime)(shiftStart);
            const shiftEndMySQL = shiftEnd ? (0, mysqlDb_1.toMySQLDateTime)(shiftEnd) : null;
            let query = `
        SELECT 
          COALESCE(pm.name, 'Unknown') as payment_method_name,
          COALESCE(pm.code, 'unknown') as payment_method_code,
          COUNT(t.id) as transaction_count,
          COALESCE(SUM(t.final_amount), 0) as total_amount
        FROM transactions t
        LEFT JOIN payment_methods pm ON t.payment_method_id = pm.id
        WHERE t.business_id = ?
        AND t.created_at >= ?
        AND t.status != 'archived'
      `;
            const params = [businessId, shiftStartMySQL];
            // Add user_id filter only if userId is not null
            if (userId !== null) {
                query = query.replace('WHERE t.business_id = ?', 'WHERE t.user_id = ? AND t.business_id = ?');
                params.unshift(userId);
            }
            if (shiftEnd) {
                query += ' AND t.created_at <= ?';
                params.push(shiftEndMySQL);
            }
            query += ' GROUP BY t.payment_method_id, pm.name, pm.code ORDER BY transaction_count DESC';
            const results = await (0, mysqlDb_1.executeQuery)(query, params);
            // Diagnostic: Check for transactions with NULL payment_method_id
            let diagnosticQuery = `
        SELECT 
          COUNT(*) as total_transactions,
          COUNT(CASE WHEN payment_method_id IS NULL THEN 1 END) as null_payment_method_count,
          SUM(CASE WHEN payment_method_id IS NULL THEN final_amount ELSE 0 END) as null_payment_method_amount,
          SUM(final_amount) as total_final_amount
        FROM transactions
        WHERE user_id = ? AND business_id = ?
        AND created_at >= ?
        AND status = 'completed'
      `;
            const diagnosticParams = [userId, businessId, shiftStartMySQL];
            if (shiftEndMySQL) {
                diagnosticQuery += ' AND created_at <= ?';
                diagnosticParams.push(shiftEndMySQL);
            }
            return results;
        }
        catch (error) {
            console.error('Error getting payment breakdown:', error);
            return [];
        }
    });
    // Get Category II breakdown
    electron_1.ipcMain.handle('localdb-get-category2-breakdown', async (event, userId, shiftStart, shiftEnd, businessId = 14) => {
        try { // Convert ISO date strings to MySQL datetime format
            const shiftStartMySQL = (0, mysqlDb_1.toMySQLDateTime)(shiftStart);
            const shiftEndMySQL = shiftEnd ? (0, mysqlDb_1.toMySQLDateTime)(shiftEnd) : null;
            let query = `
        SELECT 
          COALESCE(c2.name, 'Unknown') as category2_name,
          COALESCE(c2.id, 0) as category2_id,
          COALESCE(SUM(ti.quantity), 0) as total_quantity,
          COALESCE(SUM(ti.total_price), 0) as total_amount
        FROM transaction_items ti
        INNER JOIN transactions t ON ti.transaction_id = t.id
        INNER JOIN products p ON ti.product_id = p.id
        LEFT JOIN category2 c2 ON p.category2_id = c2.id
        WHERE t.business_id = ?
        AND t.created_at >= ?
        AND t.status != 'archived'
        AND p.category2_id IS NOT NULL
        AND c2.id IS NOT NULL
      `;
            const params = [businessId, shiftStartMySQL];
            // Add user_id filter only if userId is not null
            if (userId !== null) {
                query = query.replace('WHERE t.business_id = ?', 'WHERE t.user_id = ? AND t.business_id = ?');
                params.unshift(userId);
            }
            if (shiftEnd) {
                query += ' AND t.created_at <= ?';
                params.push(shiftEndMySQL);
            }
            query += ' GROUP BY category2_name, c2.id ORDER BY total_amount DESC';
            const results = await (0, mysqlDb_1.executeQuery)(query, params);
            console.log(`[CATEGORY2 BREAKDOWN] Found ${results.length} Category II entries for user ${userId}, shift ${shiftStart} to ${shiftEnd || 'now'}`);
            if (results.length > 0) {
                console.log('[CATEGORY2 BREAKDOWN] Sample result:', results[0]);
            }
            return results;
        }
        catch (error) {
            console.error('Error getting Category II breakdown:', error);
            return [];
        }
    });
    // Get cash summary (shift + whole day)
    electron_1.ipcMain.handle('localdb-get-cash-summary', async (event, userId, shiftStart, shiftEnd, businessId = 14, shiftUuid) => {
        try {
            // Get cash payment method ID
            const cashMethod = await (0, mysqlDb_1.executeQueryOne)('SELECT id FROM payment_methods WHERE code = ? LIMIT 1', ['cash']);
            if (!cashMethod) {
                return { cash_shift: 0, cash_whole_day: 0 };
            }
            // Cash received during shift
            // Prioritize shift_uuid filtering when available, as it's more accurate than time-based filtering
            let shiftQuery = `
        SELECT COALESCE(SUM(final_amount), 0) as cash_total
        FROM transactions t
        WHERE t.business_id = ?
        AND t.payment_method_id = ?
        AND t.status != 'archived'
      `;
            const shiftParams = [businessId, cashMethod.id];
            // Add user_id filter only if userId is not null
            if (userId !== null) {
                shiftQuery = shiftQuery.replace('WHERE t.business_id = ?', 'WHERE t.user_id = ? AND t.business_id = ?');
                shiftParams.unshift(userId);
            }
            // Use shift_uuid if provided, otherwise fall back to time-based filtering
            if (shiftUuid) {
                shiftQuery += ' AND t.shift_uuid = ?';
                shiftParams.push(shiftUuid);
            }
            else {
                shiftQuery += ' AND t.created_at >= ?';
                shiftParams.push((0, mysqlDb_1.toMySQLDateTime)(shiftStart));
                if (shiftEnd) {
                    shiftQuery += ' AND t.created_at <= ?';
                    shiftParams.push((0, mysqlDb_1.toMySQLDateTime)(shiftEnd));
                }
            }
            const shiftResult = await (0, mysqlDb_1.executeQueryOne)(shiftQuery, shiftParams);
            // Cash received whole day (GMT+7 - extract date from shift_start)
            // shiftStart is in UTC (ISO format)
            // We need to find the GMT+7 day boundaries
            const shiftDate = new Date(shiftStart);
            const gmt7Offset = 7 * 60 * 60 * 1000; // +7 hours in milliseconds
            // Convert to GMT+7 time
            const gmt7Time = new Date(shiftDate.getTime() + gmt7Offset);
            const year = gmt7Time.getUTCFullYear();
            const month = gmt7Time.getUTCMonth();
            const day = gmt7Time.getUTCDate();
            // Create day boundaries in GMT+7 (00:00:00 and 23:59:59.999)
            const dayStartGMT7 = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
            const dayEndGMT7 = new Date(Date.UTC(year, month, day, 23, 59, 59, 999));
            // Convert back to UTC for MySQL queries (subtract GMT+7 offset)
            const dayStart = new Date(dayStartGMT7.getTime() - gmt7Offset);
            const dayEnd = new Date(dayEndGMT7.getTime() - gmt7Offset);
            const wholeDayResult = await (0, mysqlDb_1.executeQueryOne)(`
        SELECT COALESCE(SUM(final_amount), 0) as cash_total
        FROM transactions t
        WHERE t.business_id = ?
        AND t.created_at >= ?
        AND t.created_at <= ?
        AND t.payment_method_id = ?
        AND t.status != 'archived'
      `, [
                businessId,
                (0, mysqlDb_1.toMySQLDateTime)(dayStart),
                (0, mysqlDb_1.toMySQLDateTime)(dayEnd),
                cashMethod.id
            ]);
            // Refund query - include all refunds for the shift
            // When shift_uuid is provided, include:
            // 1. Refunds with matching shift_uuid
            // 2. Refunds without shift_uuid but matching time range and user (for printer 1 transactions)
            // First, get all refunds in the time range for debugging
            let refundShiftQuery = `
        SELECT COALESCE(SUM(refund_amount), 0) as refund_total
        FROM transaction_refunds
        WHERE business_id = ?
        AND status != 'failed'
      `;
            const refundShiftParams = [businessId];
            // Use shift_uuid if provided, but also include refunds without shift_uuid in the time range
            if (shiftUuid) {
                // Include refunds with matching shift_uuid OR refunds without shift_uuid in the time range
                refundShiftQuery += ' AND (shift_uuid = ?';
                refundShiftParams.push(shiftUuid);
                // Also include refunds without shift_uuid that match the time range and user
                refundShiftQuery += ' OR (shift_uuid IS NULL';
                if (userId !== null) {
                    refundShiftQuery += ' AND refunded_by = ?';
                    refundShiftParams.push(userId);
                }
                refundShiftQuery += ' AND refunded_at >= ?';
                refundShiftParams.push((0, mysqlDb_1.toMySQLDateTime)(shiftStart));
                if (shiftEnd) {
                    refundShiftQuery += ' AND refunded_at <= ?';
                    refundShiftParams.push((0, mysqlDb_1.toMySQLDateTime)(shiftEnd));
                }
                refundShiftQuery += '))';
            }
            else {
                if (userId !== null) {
                    refundShiftQuery += ' AND refunded_by = ?';
                    refundShiftParams.push(userId);
                }
                refundShiftQuery += ' AND refunded_at >= ?';
                refundShiftParams.push((0, mysqlDb_1.toMySQLDateTime)(shiftStart));
                if (shiftEnd) {
                    refundShiftQuery += ' AND refunded_at <= ?';
                    refundShiftParams.push((0, mysqlDb_1.toMySQLDateTime)(shiftEnd));
                }
            }
            const refundShiftResult = await (0, mysqlDb_1.executeQueryOne)(refundShiftQuery, refundShiftParams);
            // Debug: Check refunds matching each condition separately
            const dayRefundResult = await (0, mysqlDb_1.executeQueryOne)(`
        SELECT COALESCE(SUM(refund_amount), 0) as refund_total
        FROM transaction_refunds
        WHERE business_id = ?
        AND refunded_at >= ?
        AND refunded_at <= ?
        AND status != 'failed'
      `, [
                businessId,
                (0, mysqlDb_1.toMySQLDateTime)(dayStart),
                (0, mysqlDb_1.toMySQLDateTime)(dayEnd)
            ]);
            const shiftSales = shiftResult?.cash_total || 0;
            const shiftRefunds = refundShiftResult?.refund_total || 0;
            const daySales = wholeDayResult?.cash_total || 0;
            const dayRefunds = dayRefundResult?.refund_total || 0;
            return {
                cash_shift: shiftSales - shiftRefunds,
                cash_shift_sales: shiftSales,
                cash_shift_refunds: shiftRefunds,
                cash_whole_day: daySales - dayRefunds,
                cash_whole_day_sales: daySales,
                cash_whole_day_refunds: dayRefunds
            };
        }
        catch (error) {
            console.error('Error getting cash summary:', error);
            return {
                cash_shift: 0,
                cash_whole_day: 0
            };
        }
    });
    // Get shifts with filtering
    electron_1.ipcMain.handle('localdb-get-shifts', async (event, filters = {}) => {
        try {
            // Select only needed columns for better performance
            let query = 'SELECT id, uuid_id, business_id, user_id, user_name, shift_start, shift_end, modal_awal, kas_akhir, kas_expected, kas_selisih, kas_selisih_label, cash_sales_total, cash_refund_total, status, created_at, updated_at, synced_at FROM shifts WHERE 1=1';
            const params = [];
            if (filters.businessId) {
                query += ' AND business_id = ?';
                params.push(filters.businessId);
            }
            if (filters.userId) {
                query += ' AND user_id = ?';
                params.push(filters.userId);
            }
            if (filters.startDate) {
                query += ' AND shift_start >= ?';
                // Check if already in MySQL format (YYYY-MM-DD HH:MM:SS), otherwise convert
                const dateStr = filters.startDate;
                if (dateStr.includes('T') || dateStr.includes('Z')) {
                    params.push((0, mysqlDb_1.toMySQLDateTime)(dateStr));
                }
                else {
                    // Already in MySQL format
                    params.push(dateStr);
                }
            }
            if (filters.endDate) {
                query += ' AND shift_start <= ?';
                // Check if already in MySQL format (YYYY-MM-DD HH:MM:SS), otherwise convert
                const dateStr = filters.endDate;
                if (dateStr.includes('T') || dateStr.includes('Z')) {
                    params.push((0, mysqlDb_1.toMySQLDateTime)(dateStr));
                }
                else {
                    // Already in MySQL format
                    params.push(dateStr);
                }
            }
            query += ' ORDER BY shift_start DESC';
            // LIMIT must be a number, not a parameter in some MySQL configurations
            // Use string interpolation for safety (limit is always a number from our code)
            if (filters.limit && filters.limit > 0) {
                const limitValue = Math.floor(Number(filters.limit));
                if (limitValue > 0 && limitValue <= 10000) { // Sanity check
                    query += ` LIMIT ${limitValue}`;
                }
            }
            const shifts = await (0, mysqlDb_1.executeQuery)(query, params);
            return { shifts: shifts || [], count: Array.isArray(shifts) ? shifts.length : 0 };
        }
        catch (error) {
            console.error('Error getting shifts:', error);
            return { shifts: [], count: 0 };
        }
    });
    // Get unsynced shifts
    electron_1.ipcMain.handle('localdb-get-unsynced-shifts', async (event, businessId) => {
        try {
            let query = 'SELECT * FROM shifts WHERE synced_at IS NULL';
            const params = [];
            if (businessId) {
                query += ' AND business_id = ?';
                params.push(businessId);
            }
            query += ' ORDER BY created_at ASC';
            return await (0, mysqlDb_1.executeQuery)(query, params);
        }
        catch (error) {
            console.error('Error getting unsynced shifts:', error);
            return [];
        }
    });
    // Mark shifts as synced
    electron_1.ipcMain.handle('localdb-mark-shifts-synced', async (event, shiftIds) => {
        if (shiftIds.length === 0)
            return { success: true };
        try {
            const placeholders = shiftIds.map(() => '?').join(',');
            // synced_at is BIGINT (timestamp in milliseconds), not DATETIME
            await (0, mysqlDb_1.executeUpdate)(`UPDATE shifts SET synced_at = ? WHERE id IN (${placeholders})`, [Date.now(), ...shiftIds]);
            return { success: true };
        }
        catch (error) {
            console.error('Error marking shifts as synced:', error);
            return { success: false };
        }
    });
    // Upsert shifts (for downloading from server)
    electron_1.ipcMain.handle('localdb-upsert-shifts', async (event, rows) => {
        if (!Array.isArray(rows) || rows.length === 0)
            return { success: true, count: 0 };
        try {
            const queries = rows.map(row => {
                const id = typeof row.id === 'number' ? row.id : (row.id ? parseInt(String(row.id), 10) : null);
                const uuidId = typeof row.uuid_id === 'string' ? row.uuid_id : String(row.uuid_id ?? '');
                const businessId = typeof row.business_id === 'number' ? row.business_id : (row.business_id ? Number(row.business_id) : 0);
                const userId = typeof row.user_id === 'number' ? row.user_id : (row.user_id ? Number(row.user_id) : 0);
                const userName = typeof row.user_name === 'string' ? row.user_name : String(row.user_name ?? '');
                const shiftStart = row.shift_start ? (typeof row.shift_start === 'number' || typeof row.shift_start === 'string' ? row.shift_start : new Date()) : new Date();
                const shiftEnd = row.shift_end ? (typeof row.shift_end === 'number' || typeof row.shift_end === 'string' ? row.shift_end : null) : null;
                const modalAwal = typeof row.modal_awal === 'number' ? row.modal_awal : (row.modal_awal ? Number(row.modal_awal) : 0);
                const kasAkhir = typeof row.kas_akhir === 'number' ? row.kas_akhir : (row.kas_akhir ? Number(row.kas_akhir) : null);
                const kasExpected = typeof row.kas_expected === 'number' ? row.kas_expected : (row.kas_expected ? Number(row.kas_expected) : null);
                const kasSelisih = typeof row.kas_selisih === 'number' ? row.kas_selisih : (row.kas_selisih ? Number(row.kas_selisih) : null);
                const kasSelisihLabel = typeof row.kas_selisih_label === 'string' ? row.kas_selisih_label : 'balanced';
                const cashSalesTotal = typeof row.cash_sales_total === 'number' ? row.cash_sales_total : (row.cash_sales_total ? Number(row.cash_sales_total) : null);
                const cashRefundTotal = typeof row.cash_refund_total === 'number' ? row.cash_refund_total : (row.cash_refund_total ? Number(row.cash_refund_total) : null);
                const status = typeof row.status === 'string' ? row.status : 'active';
                const createdAt = row.created_at ? (typeof row.created_at === 'number' || typeof row.created_at === 'string' ? row.created_at : new Date()) : new Date();
                // updated_at and synced_at are BIGINT (timestamp in milliseconds), not DATETIME
                const updatedAt = row.updated_at ? (typeof row.updated_at === 'number' ? row.updated_at : (typeof row.updated_at === 'string' ? parseInt(row.updated_at, 10) : Date.now())) : null;
                const syncedAt = row.synced_at ? (typeof row.synced_at === 'number' ? row.synced_at : (typeof row.synced_at === 'string' ? parseInt(row.synced_at, 10) : Date.now())) : null;
                return {
                    sql: `
            INSERT INTO shifts (
              id, uuid_id, business_id, user_id, user_name, shift_start, shift_end,
              modal_awal, kas_akhir, kas_expected, kas_selisih, kas_selisih_label,
              cash_sales_total, cash_refund_total, status, created_at, updated_at, synced_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              id = VALUES(id),
              business_id = VALUES(business_id),
              user_id = VALUES(user_id),
              user_name = VALUES(user_name),
              shift_start = VALUES(shift_start),
              shift_end = VALUES(shift_end),
              modal_awal = VALUES(modal_awal),
              kas_akhir = VALUES(kas_akhir),
              kas_expected = VALUES(kas_expected),
              kas_selisih = VALUES(kas_selisih),
              kas_selisih_label = VALUES(kas_selisih_label),
              cash_sales_total = VALUES(cash_sales_total),
              cash_refund_total = VALUES(cash_refund_total),
              status = VALUES(status),
              created_at = VALUES(created_at),
              updated_at = VALUES(updated_at),
              synced_at = VALUES(synced_at)
          `,
                    params: [
                        id,
                        uuidId,
                        businessId,
                        userId,
                        userName,
                        (0, mysqlDb_1.toMySQLDateTime)(shiftStart),
                        shiftEnd ? (0, mysqlDb_1.toMySQLDateTime)(shiftEnd) : null,
                        modalAwal,
                        kasAkhir,
                        kasExpected,
                        kasSelisih,
                        kasSelisihLabel,
                        cashSalesTotal,
                        cashRefundTotal,
                        status,
                        (0, mysqlDb_1.toMySQLDateTime)(createdAt),
                        updatedAt, // BIGINT timestamp
                        syncedAt // BIGINT timestamp
                    ]
                };
            });
            await (0, mysqlDb_1.executeTransaction)(queries);
            return { success: true, count: rows.length };
        }
        catch (error) {
            console.error('Error upserting shifts:', error);
            return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
    });
    // Check for transactions before shift start (today)
    electron_1.ipcMain.handle('localdb-check-today-transactions', async (event, userId, shiftStart, businessId = 14) => {
        try {
            // Get start of day in GMT+7
            const shiftDate = new Date(shiftStart);
            const gmt7Offset = 7 * 60 * 60 * 1000;
            const localTime = new Date(shiftDate.getTime() + gmt7Offset);
            const year = localTime.getUTCFullYear();
            const month = localTime.getUTCMonth();
            const day = localTime.getUTCDate();
            const dayStartUTC = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
            const dayStart = new Date(dayStartUTC.getTime() - gmt7Offset);
            // Check for transactions before shift_start but on the same day
            // AND ensure they are not already linked to another shift
            const result = await (0, mysqlDb_1.executeQueryOne)(`
        SELECT COUNT(*) as count, MIN(created_at) as earliest_time
        FROM transactions
        WHERE user_id = ? 
        AND business_id = ?
        AND created_at >= ?
        AND created_at < ?
        AND status = 'completed'
        AND (shift_uuid IS NULL OR shift_uuid = '')
      `, [userId, businessId, (0, mysqlDb_1.toMySQLDateTime)(dayStart), (0, mysqlDb_1.toMySQLDateTime)(shiftStart)]);
            return {
                hasTransactions: (result?.count || 0) > 0,
                count: result?.count || 0,
                earliestTime: result?.earliest_time || null
            };
        }
        catch (error) {
            console.error('Error checking today transactions:', error);
            return { hasTransactions: false, count: 0, earliestTime: null };
        }
    });
    // Update shift start time to include earlier transactions
    electron_1.ipcMain.handle('localdb-update-shift-start', async (event, shiftId, newStartTime) => {
        try {
            // 1. Get shift details first to have the UUID and User ID
            const shift = await (0, mysqlDb_1.executeQueryOne)('SELECT uuid_id, user_id FROM shifts WHERE id = ?', [shiftId]);
            if (!shift) {
                return { success: false, error: 'Shift not found' };
            }
            const queries = [];
            // 2. Update the shift start time
            queries.push({
                sql: `
          UPDATE shifts 
          SET shift_start = ?, updated_at = ?
          WHERE id = ? AND status = 'active'
        `,
                params: [(0, mysqlDb_1.toMySQLDateTime)(newStartTime), Date.now(), shiftId]
            });
            // 3. Link the transactions in the new time range to this shift
            queries.push({
                sql: `
          UPDATE transactions
          SET shift_uuid = ?
          WHERE user_id = ? 
          AND created_at >= ?
          AND (shift_uuid IS NULL OR shift_uuid = '')
        `,
                params: [shift.uuid_id, shift.user_id, newStartTime]
            });
            await (0, mysqlDb_1.executeTransaction)(queries);
            // Get count of linked transactions
            const linkCountResult = await (0, mysqlDb_1.executeQueryOne)(`
        SELECT COUNT(*) as count FROM transactions
        WHERE user_id = ? 
        AND created_at >= ?
        AND shift_uuid = ?
      `, [shift.user_id, newStartTime, shift.uuid_id]);
            console.log(`✅ [SHIFTS] Updated shift ${shiftId} start time to ${newStartTime}`);
            console.log(`🔗 [SHIFTS] Linked ${linkCountResult?.count || 0} transactions to shift ${shift.uuid_id}`);
            return { success: true };
        }
        catch (error) {
            console.error('Error updating shift start time:', error);
            return { success: false, error: String(error) };
        }
    });
    // Get product sales breakdown for shift
    electron_1.ipcMain.handle('localdb-get-product-sales', async (event, userId, shiftStart, shiftEnd, businessId = 14) => {
        try {
            // Convert ISO date strings to MySQL datetime format
            const shiftStartMySQL = (0, mysqlDb_1.toMySQLDateTime)(shiftStart);
            const shiftEndMySQL = shiftEnd ? (0, mysqlDb_1.toMySQLDateTime)(shiftEnd) : null;
            let query = `
        SELECT 
          ti.uuid_id as id,
          p.id as product_id,
          p.nama as product_name,
          p.menu_code as product_code,
          ti.quantity,
          ti.unit_price,
          ti.total_price,
          ti.bundle_selections_json,
          t.transaction_type,
          pm.code as payment_method_code,
          t.payment_method as payment_method,
          p.harga_jual,
          p.harga_gofood,
          p.harga_grabfood,
          p.harga_shopeefood,
          p.harga_qpon,
          p.harga_tiktok
        FROM transaction_items ti
        INNER JOIN transactions t ON ti.transaction_id = t.id
        LEFT JOIN payment_methods pm ON t.payment_method_id = pm.id
        INNER JOIN products p ON ti.product_id = p.id
        WHERE t.business_id = ?
        AND t.created_at >= ?
        AND t.status != 'archived'
      `;
            const params = [businessId, shiftStartMySQL];
            // Add user_id filter only if userId is not null
            if (userId !== null) {
                query = query.replace('WHERE t.business_id = ?', 'WHERE t.user_id = ? AND t.business_id = ?');
                params.unshift(userId);
            }
            if (shiftEnd) {
                query += ' AND t.created_at <= ?';
                params.push((0, mysqlDb_1.toMySQLDateTime)(shiftEnd));
            }
            const rows = await (0, mysqlDb_1.executeQuery)(query, params);
            const aggregate = new Map();
            const bundleItemsAggregate = new Map();
            const customizationAggregate = new Map();
            const OFFLINE_METHODS = new Set(['cash', 'debit', 'qr', 'ewallet', 'cl', 'voucher', 'offline']);
            const sumCustomizationForRow = async (row, unitQuantity) => {
                let customizationTotal = 0;
                // Read from normalized tables instead of JSON
                // row.id should be the uuid_id (UUID string) from the SELECT clause
                const itemUuid = row.id ? String(row.id) : '';
                if (!itemUuid) {
                    console.warn('⚠️ TransactionItemRow missing id (uuid_id), skipping customizations');
                    return 0;
                }
                const customizations = await readCustomizationsFromNormalizedTables(itemUuid, null);
                if (!customizations || customizations.length === 0)
                    return 0;
                for (const customization of customizations) {
                    if (!Array.isArray(customization?.selected_options))
                        continue;
                    for (const option of customization.selected_options) {
                        const adjustment = Number(option?.price_adjustment || 0);
                        customizationTotal += adjustment;
                        const optionId = Number(option?.option_id);
                        if (Number.isNaN(optionId)) {
                            continue;
                        }
                        const existingOption = customizationAggregate.get(optionId);
                        if (existingOption) {
                            existingOption.total_quantity += unitQuantity;
                            existingOption.total_revenue += adjustment * unitQuantity;
                        }
                        else {
                            customizationAggregate.set(optionId, {
                                option_id: optionId,
                                option_name: option?.option_name || 'Unknown Option',
                                customization_id: Number(customization?.customization_id) || 0,
                                customization_name: customization?.customization_name || 'Unknown Customization',
                                total_quantity: unitQuantity,
                                total_revenue: adjustment * unitQuantity,
                            });
                        }
                    }
                }
                const bundleSelections = parseJsonArray(row.bundle_selections_json, 'bundle_selections_json');
                if (bundleSelections.length > 0) {
                    const rawPlatform = (row.payment_method_code || row.payment_method || '').toString().toLowerCase();
                    const platformCode = rawPlatform && !OFFLINE_METHODS.has(rawPlatform) ? rawPlatform : 'offline';
                    const transactionType = row.transaction_type || 'drinks';
                    for (const selection of bundleSelections) {
                        if (!Array.isArray(selection?.selectedProducts))
                            continue;
                        for (const selectedProduct of selection.selectedProducts) {
                            const selectionQty = typeof selectedProduct?.quantity === 'number' && !Number.isNaN(selectedProduct.quantity)
                                ? selectedProduct.quantity
                                : 1;
                            const totalQty = selectionQty * unitQuantity;
                            if (selectedProduct?.product?.id) {
                                // Use the same platform detection for bundle items (from parent row)
                                const bundlePlatform = determinePlatform(row);
                                const bundleItemKey = `${selectedProduct.product.id}-${bundlePlatform}-${transactionType}`;
                                const existingBundleItem = bundleItemsAggregate.get(bundleItemKey);
                                if (existingBundleItem) {
                                    existingBundleItem.total_quantity += totalQty;
                                }
                                else {
                                    bundleItemsAggregate.set(bundleItemKey, {
                                        product_id: Number(selectedProduct.product.id),
                                        product_name: selectedProduct.product.nama || 'Unknown Product',
                                        product_code: '',
                                        platform: bundlePlatform,
                                        transaction_type: transactionType,
                                        total_quantity: totalQty,
                                        total_subtotal: 0,
                                        customization_subtotal: 0,
                                        base_subtotal: 0,
                                        unit_price: 0, // Bundle items don't have individual prices
                                    });
                                }
                            }
                            if (!Array.isArray(selectedProduct?.customizations))
                                continue;
                            for (const customization of selectedProduct.customizations) {
                                if (!Array.isArray(customization?.selected_options))
                                    continue;
                                for (const option of customization.selected_options) {
                                    const adjustment = Number(option?.price_adjustment || 0);
                                    const qty = selectionQty * unitQuantity;
                                    customizationTotal += adjustment * selectionQty;
                                    const optionId = Number(option?.option_id);
                                    if (Number.isNaN(optionId)) {
                                        continue;
                                    }
                                    const existingOption = customizationAggregate.get(optionId);
                                    if (existingOption) {
                                        existingOption.total_quantity += qty;
                                        existingOption.total_revenue += adjustment * qty;
                                    }
                                    else {
                                        customizationAggregate.set(optionId, {
                                            option_id: optionId,
                                            option_name: option?.option_name || 'Unknown Option',
                                            customization_id: Number(customization?.customization_id) || 0,
                                            customization_name: customization?.customization_name || 'Unknown Customization',
                                            total_quantity: qty,
                                            total_revenue: adjustment * qty,
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
                return customizationTotal * unitQuantity || 0;
            };
            // Helper function to determine platform from unit price
            const determinePlatform = (row) => {
                const unitPrice = Number(row.unit_price || 0);
                // Compare unit price with platform-specific prices
                // Allow small tolerance for floating point comparison (0.01)
                const tolerance = 0.01;
                if (row.harga_gofood && Math.abs(unitPrice - Number(row.harga_gofood)) < tolerance) {
                    return 'gofood';
                }
                if (row.harga_grabfood && Math.abs(unitPrice - Number(row.harga_grabfood)) < tolerance) {
                    return 'grabfood';
                }
                if (row.harga_shopeefood && Math.abs(unitPrice - Number(row.harga_shopeefood)) < tolerance) {
                    return 'shopeefood';
                }
                if (row.harga_qpon && Math.abs(unitPrice - Number(row.harga_qpon)) < tolerance) {
                    return 'qpon';
                }
                if (row.harga_tiktok && Math.abs(unitPrice - Number(row.harga_tiktok)) < tolerance) {
                    return 'tiktok';
                }
                // Default to offline
                return 'offline';
            };
            for (const row of rows) {
                const quantity = Number(row.quantity || 0);
                const totalPrice = Number(row.total_price || 0);
                const unitPrice = Number(row.unit_price || 0);
                const customizationSubtotal = await sumCustomizationForRow(row, quantity);
                let baseSubtotal = totalPrice - customizationSubtotal;
                if (baseSubtotal < 0) {
                    baseSubtotal = 0;
                }
                // Determine platform based on product price, not payment method
                const platformCode = determinePlatform(row);
                const transactionType = row.transaction_type || 'drinks';
                // Include unit_price in the key to split products with different prices into separate rows
                const key = `${row.product_id}-${platformCode}-${transactionType}-${unitPrice}`;
                const existing = aggregate.get(key);
                if (existing) {
                    existing.total_quantity += quantity;
                    existing.total_subtotal += totalPrice;
                    existing.customization_subtotal += customizationSubtotal;
                    existing.base_subtotal += baseSubtotal;
                }
                else {
                    aggregate.set(key, {
                        product_id: Number(row.product_id),
                        product_name: row.product_name,
                        product_code: row.product_code,
                        platform: platformCode,
                        transaction_type: transactionType,
                        total_quantity: quantity,
                        total_subtotal: totalPrice,
                        customization_subtotal: customizationSubtotal,
                        base_subtotal: baseSubtotal,
                        unit_price: unitPrice,
                    });
                }
            }
            const regularProducts = Array.from(aggregate.values()).map(product => {
                const quantity = product.total_quantity || 0;
                const baseSubtotal = product.base_subtotal || 0;
                // Use the stored unit_price instead of calculating average
                // This ensures products with different prices are split into separate rows
                const baseUnitPrice = product.unit_price || (quantity > 0 ? baseSubtotal / quantity : 0);
                return {
                    ...product,
                    base_unit_price: baseUnitPrice,
                    is_bundle_item: false,
                };
            });
            const bundleItems = Array.from(bundleItemsAggregate.values()).map(product => {
                const bundleItem = {
                    ...product,
                    base_unit_price: 0,
                    is_bundle_item: true,
                };
                console.log(`[SHIFT REPORT] Bundle item: ${bundleItem.product_name}, is_bundle_item: ${bundleItem.is_bundle_item}`);
                return bundleItem;
            });
            // Create a map to track bundle item keys to avoid duplicates
            const bundleItemKeys = new Set(bundleItems.map(item => `${item.product_id}-${item.platform}-${item.transaction_type}`));
            // Filter out any regular products that are actually bundle items
            const filteredRegularProducts = regularProducts.filter(product => {
                const key = `${product.product_id}-${product.platform}-${product.transaction_type}`;
                return !bundleItemKeys.has(key);
            });
            const allProducts = [...filteredRegularProducts, ...bundleItems].sort((a, b) => {
                if (a.product_name === b.product_name) {
                    if (a.is_bundle_item !== b.is_bundle_item) {
                        return a.is_bundle_item ? 1 : -1;
                    }
                    return a.platform.localeCompare(b.platform);
                }
                return a.product_name.localeCompare(b.product_name);
            });
            return {
                products: allProducts,
                customizations: Array.from(customizationAggregate.values()).sort((a, b) => b.total_quantity - a.total_quantity),
            };
        }
        catch (error) {
            console.error('Error getting product sales:', error);
            return { products: [], customizations: [] };
        }
    });
    // Payment Methods
    electron_1.ipcMain.handle('localdb-upsert-payment-methods', async (event, rows) => {
        try {
            const queries = rows.map(r => {
                const id = typeof r.id === 'number' ? r.id : (r.id ? parseInt(String(r.id), 10) : null);
                const name = typeof r.name === 'string' ? r.name : (r.name ? String(r.name) : null);
                const code = typeof r.code === 'string' ? r.code : (r.code ? String(r.code) : null);
                const description = typeof r.description === 'string' ? r.description : (r.description ? String(r.description) : null);
                const isActive = typeof r.is_active === 'number' ? r.is_active : (r.is_active ? 1 : 0);
                const requiresAdditionalInfo = typeof r.requires_additional_info === 'number' ? r.requires_additional_info : (r.requires_additional_info ? 1 : 0);
                const createdAt = r.created_at ? (typeof r.created_at === 'number' || typeof r.created_at === 'string' ? r.created_at : new Date()) : new Date();
                return {
                    sql: `INSERT INTO payment_methods (
            id, name, code, description, is_active, requires_additional_info, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            name=VALUES(name), code=VALUES(code), description=VALUES(description),
            is_active=VALUES(is_active), requires_additional_info=VALUES(requires_additional_info),
            created_at=VALUES(created_at), updated_at=VALUES(updated_at)`,
                    params: [id, name, code, description, isActive, requiresAdditionalInfo, (0, mysqlDb_1.toMySQLTimestamp)(createdAt), (0, mysqlDb_1.toMySQLTimestamp)(Date.now())]
                };
            });
            await (0, mysqlDb_1.executeTransaction)(queries);
            return { success: true };
        }
        catch (error) {
            console.error('Error upserting payment methods:', error);
            return { success: false };
        }
    });
    electron_1.ipcMain.handle('localdb-get-payment-methods', async () => {
        try {
            return await (0, mysqlDb_1.executeQuery)('SELECT * FROM payment_methods WHERE is_active = 1 ORDER BY name ASC');
        }
        catch (error) {
            console.error('Error getting payment methods:', error);
            return [];
        }
    });
    // Banks
    electron_1.ipcMain.handle('localdb-upsert-banks', async (event, rows) => {
        try {
            const queries = rows.map(r => {
                const getId = () => {
                    const val = r.id;
                    if (typeof val === 'number')
                        return val;
                    if (typeof val === 'string') {
                        const num = Number(val);
                        return isNaN(num) ? null : num;
                    }
                    return null;
                };
                const getString = (key) => (typeof r[key] === 'string' ? r[key] : null);
                const getNumber = (key) => {
                    const val = r[key];
                    if (typeof val === 'number')
                        return val;
                    if (typeof val === 'string') {
                        const num = Number(val);
                        return isNaN(num) ? null : num;
                    }
                    return null;
                };
                const getBoolean = (key) => {
                    const val = r[key];
                    if (typeof val === 'boolean')
                        return val;
                    if (typeof val === 'number')
                        return val === 1;
                    if (typeof val === 'string')
                        return val === 'true' || val === '1';
                    return null;
                };
                const getDate = (key) => {
                    const val = r[key];
                    if (val instanceof Date)
                        return val;
                    if (typeof val === 'string' || typeof val === 'number')
                        return val;
                    return null;
                };
                const createdDate = getDate('created_at');
                const createdAt = createdDate ? (0, mysqlDb_1.toMySQLTimestamp)(createdDate) : (0, mysqlDb_1.toMySQLTimestamp)(new Date());
                return {
                    sql: `
            INSERT INTO banks (id, bank_code, bank_name, is_popular, is_active, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              bank_code=VALUES(bank_code),
              bank_name=VALUES(bank_name),
              is_popular=VALUES(is_popular),
              is_active=VALUES(is_active),
              created_at=VALUES(created_at)
          `,
                    params: [
                        getId(),
                        getString('bank_code'),
                        getString('bank_name'),
                        getNumber('is_popular') ?? 0,
                        getBoolean('is_active') !== null ? (getBoolean('is_active') ? 1 : 0) : 1,
                        createdAt
                    ]
                };
            });
            await (0, mysqlDb_1.executeTransaction)(queries);
            return { success: true };
        }
        catch (error) {
            console.error('Error upserting banks:', error);
            return { success: false, error: String(error) };
        }
    });
    // Organizations
    electron_1.ipcMain.handle('localdb-upsert-organizations', async (event, rows, skipOwnerValidation = false) => {
        try {
            const queries = [];
            let skippedCount = 0;
            for (const r of rows) {
                const getId = () => {
                    const val = r.id;
                    if (typeof val === 'number')
                        return val;
                    if (typeof val === 'string') {
                        const num = Number(val);
                        return isNaN(num) ? null : num;
                    }
                    return null;
                };
                const getNumber = (key) => {
                    const val = r[key];
                    if (typeof val === 'number')
                        return val;
                    if (typeof val === 'string') {
                        const num = Number(val);
                        return isNaN(num) ? null : num;
                    }
                    return null;
                };
                const orgId = getId();
                const ownerUserId = getNumber('owner_user_id'); // Skip if owner_user_id is null or invalid
                if (!ownerUserId) {
                    skippedCount++;
                    continue;
                }
                // Verify user exists before inserting organization - SKIP on first pass to break circular dependency
                if (!skipOwnerValidation) {
                    try {
                        const userExists = await (0, mysqlDb_1.executeQueryOne)('SELECT id FROM users WHERE id = ? LIMIT 1', [ownerUserId]);
                        if (!userExists) {
                            console.warn(`⚠️ [ORGANIZATIONS] Skipping organization ${orgId}: owner_user_id ${ownerUserId} does not exist`);
                            skippedCount++;
                            continue;
                        }
                    }
                    catch (checkError) {
                        console.warn(`⚠️ [ORGANIZATIONS] Error checking user ${ownerUserId} for organization ${orgId}:`, checkError);
                        skippedCount++;
                        continue;
                    }
                }
                else {
                    console.log(`ℹ️ [ORGANIZATIONS] Skipping owner validation for organization ${orgId} (first pass - breaking circular dependency)`);
                }
                const getString = (key) => (typeof r[key] === 'string' ? r[key] : null);
                const getDate = (key) => {
                    const val = r[key];
                    if (val instanceof Date)
                        return val;
                    if (typeof val === 'string' || typeof val === 'number')
                        return val;
                    return null;
                };
                const name = getString('name') ?? '';
                const slug = getString('slug') ?? '';
                const subscriptionStatus = getString('subscription_status') ?? 'trial';
                const subscriptionPlan = getString('subscription_plan') ?? 'basic';
                const trialEndsDate = getDate('trial_ends_at');
                const trialEndsAt = trialEndsDate ? (0, mysqlDb_1.toMySQLTimestamp)(trialEndsDate) : null;
                const createdDate = getDate('created_at');
                const updatedDate = getDate('updated_at');
                const createdAt = createdDate ? (0, mysqlDb_1.toMySQLTimestamp)(createdDate) : (0, mysqlDb_1.toMySQLTimestamp)(new Date());
                const updatedAt = updatedDate ? (0, mysqlDb_1.toMySQLTimestamp)(updatedDate) : (0, mysqlDb_1.toMySQLTimestamp)(Date.now());
                queries.push({
                    sql: `INSERT INTO organizations (
            id, name, slug, owner_user_id, subscription_status, subscription_plan,
            trial_ends_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            name=VALUES(name), slug=VALUES(slug), owner_user_id=VALUES(owner_user_id),
            subscription_status=VALUES(subscription_status), subscription_plan=VALUES(subscription_plan),
            trial_ends_at=VALUES(trial_ends_at), created_at=VALUES(created_at), updated_at=VALUES(updated_at)`,
                    params: [
                        orgId, name, slug, ownerUserId, subscriptionStatus,
                        subscriptionPlan, trialEndsAt, createdAt, updatedAt
                    ]
                });
            }
            if (queries.length > 0) {
                if (skipOwnerValidation) {
                    // On first pass: Insert organizations one by one to handle foreign key errors individually
                    let successCount = 0;
                    let failCount = 0;
                    for (const query of queries) {
                        try {
                            await (0, mysqlDb_1.executeUpdate)(query.sql, query.params || []);
                            successCount++;
                        }
                        catch (insertError) {
                            const err = insertError;
                            if (err.code === 'ER_NO_REFERENCED_ROW_2' || err.errno === 1452) {
                                // Foreign key constraint - expected on first pass, will retry later
                                failCount++;
                                console.log(`ℹ️ [ORGANIZATIONS] Organization ${query.params?.[0]} insert failed (foreign key - will retry later): ${err.message}`);
                            }
                            else {
                                // Unexpected error - log and continue
                                failCount++;
                                console.warn(`⚠️ [ORGANIZATIONS] Organization ${query.params?.[0]} insert failed: ${err.message}`);
                            }
                        }
                    }
                    console.log(`ℹ️ [ORGANIZATIONS] First pass: ${successCount} inserted, ${failCount} failed (will retry later)`);
                }
                else {
                    // On retry pass: Use transaction for better performance
                    await (0, mysqlDb_1.executeTransaction)(queries);
                    if (skippedCount > 0) {
                        console.log(`⚠️ [ORGANIZATIONS] Skipped ${skippedCount} organizations due to missing owner users`);
                    }
                }
            }
            else {
                console.warn(`⚠️ [ORGANIZATIONS] No valid organizations to insert (all ${rows.length} skipped)`);
            }
            return { success: true };
        }
        catch (error) {
            console.error('Error upserting organizations:', error);
            return { success: false };
        }
    });
    electron_1.ipcMain.handle('localdb-get-organizations', async () => {
        try {
            return await (0, mysqlDb_1.executeQuery)('SELECT * FROM organizations ORDER BY name ASC');
        }
        catch (error) {
            console.error('Error getting organizations:', error);
            return [];
        }
    });
    // Management Groups
    electron_1.ipcMain.handle('localdb-upsert-management-groups', async (event, rows) => {
        try {
            const queries = [];
            let skippedCount = 0;
            for (const r of rows) {
                const getId = () => {
                    const val = r.id;
                    if (typeof val === 'number')
                        return val;
                    if (typeof val === 'string') {
                        const num = Number(val);
                        return isNaN(num) ? null : num;
                    }
                    return null;
                };
                const getNumber = (key) => {
                    const val = r[key];
                    if (typeof val === 'number')
                        return val;
                    if (typeof val === 'string') {
                        const num = Number(val);
                        return isNaN(num) ? null : num;
                    }
                    return null;
                };
                const getString = (key) => (typeof r[key] === 'string' ? r[key] : null);
                const getDate = (key) => {
                    const val = r[key];
                    if (val instanceof Date)
                        return val;
                    if (typeof val === 'string' || typeof val === 'number')
                        return val;
                    return null;
                };
                const mgmtGroupId = getId();
                const organizationId = getNumber('organization_id');
                // Verify organization_id exists before inserting (foreign key constraint)
                if (organizationId) {
                    try {
                        const orgExists = await (0, mysqlDb_1.executeQueryOne)('SELECT id FROM organizations WHERE id = ? LIMIT 1', [organizationId]);
                        if (!orgExists) {
                            console.warn(`⚠️ [MANAGEMENT GROUPS] Skipping management group ${mgmtGroupId}: organization_id ${organizationId} does not exist`);
                            skippedCount++;
                            continue;
                        }
                    }
                    catch (checkError) {
                        console.warn(`⚠️ [MANAGEMENT GROUPS] Failed to verify organization_id ${organizationId}:`, checkError);
                        skippedCount++;
                        continue;
                    }
                }
                const name = getString('name') ?? '';
                const permissionName = getString('permission_name') ?? '';
                const description = getString('description') ?? '';
                const managerUserId = getNumber('manager_user_id');
                const createdDate = getDate('created_at');
                const updatedDate = getDate('updated_at');
                const createdAt = createdDate ? (0, mysqlDb_1.toMySQLTimestamp)(createdDate) : (0, mysqlDb_1.toMySQLTimestamp)(new Date());
                const updatedAt = updatedDate ? (0, mysqlDb_1.toMySQLTimestamp)(updatedDate) : (0, mysqlDb_1.toMySQLTimestamp)(Date.now());
                queries.push({
                    sql: `INSERT INTO management_groups (
            id, name, permission_name, description, organization_id, manager_user_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            name=VALUES(name), permission_name=VALUES(permission_name), description=VALUES(description),
            organization_id=VALUES(organization_id), manager_user_id=VALUES(manager_user_id),
            created_at=VALUES(created_at), updated_at=VALUES(updated_at)`,
                    params: [
                        mgmtGroupId,
                        name,
                        permissionName,
                        description,
                        organizationId,
                        managerUserId,
                        createdAt,
                        updatedAt
                    ]
                });
            }
            if (queries.length > 0) {
                await (0, mysqlDb_1.executeTransaction)(queries);
                if (skippedCount > 0) {
                    console.log(`⚠️ [MANAGEMENT GROUPS] Skipped ${skippedCount} management groups due to missing organizations`);
                }
            }
            else {
                console.warn(`⚠️ [MANAGEMENT GROUPS] No valid management groups to insert (all ${rows.length} skipped)`);
            }
            return { success: true };
        }
        catch (error) {
            console.error('Error upserting management groups:', error);
            return { success: false };
        }
    });
    electron_1.ipcMain.handle('localdb-get-management-groups', async () => {
        try {
            return await (0, mysqlDb_1.executeQuery)('SELECT * FROM management_groups ORDER BY name ASC');
        }
        catch (error) {
            console.error('Error getting management groups:', error);
            return [];
        }
    });
    electron_1.ipcMain.handle('localdb-check-exists', async () => {
        // MySQL database is always available via connection pool
        return { exists: true, path: 'MySQL connection pool' };
    });
    // Category1
    electron_1.ipcMain.handle('localdb-upsert-category1', async (event, rows) => {
        try {
            const queries = rows.map(r => {
                const id = typeof r.id === 'number' ? r.id : (typeof r.id === 'string' ? parseInt(String(r.id), 10) : 0);
                const name = typeof r.name === 'string' ? r.name : String(r.name ?? '');
                const description = typeof r.description === 'string' ? r.description : (r.description ? String(r.description) : null);
                const displayOrder = typeof r.display_order === 'number' ? r.display_order : 0;
                const isActive = typeof r.is_active === 'number' ? r.is_active : (r.is_active ? 1 : 0);
                const createdAt = r.created_at ? (typeof r.created_at === 'number' || typeof r.created_at === 'string' ? r.created_at : new Date()) : new Date();
                return {
                    sql: `INSERT INTO category1 (
            id, name, description, display_order, is_active, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            name=VALUES(name), description=VALUES(description), display_order=VALUES(display_order),
            is_active=VALUES(is_active), created_at=VALUES(created_at), updated_at=VALUES(updated_at)`,
                    params: [
                        id, name, description, displayOrder, isActive,
                        (0, mysqlDb_1.toMySQLTimestamp)(createdAt),
                        (0, mysqlDb_1.toMySQLTimestamp)(Date.now())
                    ]
                };
            });
            await (0, mysqlDb_1.executeTransaction)(queries);
            return { success: true };
        }
        catch (error) {
            console.error('Error upserting category1:', error);
            return { success: false };
        }
    });
    electron_1.ipcMain.handle('localdb-get-category1', async () => {
        try {
            return await (0, mysqlDb_1.executeQuery)('SELECT * FROM category1 WHERE is_active = 1 ORDER BY display_order ASC, name ASC');
        }
        catch (error) {
            console.error('Error getting category1:', error);
            return [];
        }
    });
    // Category2
    electron_1.ipcMain.handle('localdb-upsert-category2', async (event, rows, junctionTableData) => {
        try {
            const queries = [];
            // Upsert category2 records
            const category2Queries = rows.map(r => ({
                sql: `INSERT INTO category2 (
          id, name, description, display_order, is_active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          name=VALUES(name), description=VALUES(description),
          display_order=VALUES(display_order), is_active=VALUES(is_active),
          created_at=VALUES(created_at), updated_at=VALUES(updated_at)`,
                params: [
                    typeof r.id === 'number' ? r.id : (typeof r.id === 'string' ? parseInt(String(r.id), 10) : 0),
                    typeof r.name === 'string' ? r.name : String(r.name ?? ''),
                    typeof r.description === 'string' ? r.description : String(r.description ?? ''),
                    typeof r.display_order === 'number' ? r.display_order : 0,
                    typeof r.is_active === 'number' ? r.is_active : (r.is_active ? 1 : 0),
                    (0, mysqlDb_1.toMySQLTimestamp)(r.created_at ? (typeof r.created_at === 'number' || typeof r.created_at === 'string' ? r.created_at : new Date()) : new Date()),
                    (0, mysqlDb_1.toMySQLTimestamp)(Date.now())
                ]
            }));
            queries.push(...category2Queries);
            // Upsert junction table relationships (REQUIRED - no fallback)
            if (junctionTableData && junctionTableData.length > 0) {
                const validJunctionData = [];
                // Verify business_id exists before inserting (foreign key constraint)
                for (const rel of junctionTableData) {
                    try {
                        const businessExists = await (0, mysqlDb_1.executeQueryOne)('SELECT id FROM businesses WHERE id = ? LIMIT 1', [rel.business_id]);
                        if (!businessExists) {
                            console.warn(`⚠️ [CATEGORY2 UPSERT] Skipping junction: business_id ${rel.business_id} does not exist`);
                            continue;
                        }
                        validJunctionData.push(rel);
                    }
                    catch (checkError) {
                        console.warn(`⚠️ [CATEGORY2 UPSERT] Error checking business_id ${rel.business_id}:`, checkError);
                        continue;
                    }
                }
                if (validJunctionData.length > 0) {
                    const junctionQueries = validJunctionData.map(rel => ({
                        sql: `
              INSERT INTO category2_businesses (category2_id, business_id, created_at)
              VALUES (?, ?, ?)
              ON DUPLICATE KEY UPDATE created_at=VALUES(created_at)
            `,
                        params: [
                            typeof rel.category2_id === 'number' ? rel.category2_id : (rel.category2_id ? Number(rel.category2_id) : 0),
                            typeof rel.business_id === 'number' ? rel.business_id : (rel.business_id ? Number(rel.business_id) : 0),
                            (0, mysqlDb_1.toMySQLTimestamp)(rel.created_at ? (typeof rel.created_at === 'number' || typeof rel.created_at === 'string' ? rel.created_at : new Date()) : new Date())
                        ]
                    }));
                    queries.push(...junctionQueries);
                    console.log(`✅ [CATEGORY2 UPSERT] Stored ${validJunctionData.length} category2-business relationships (${junctionTableData.length - validJunctionData.length} skipped due to missing businesses)`);
                }
                else {
                    console.warn(`⚠️ [CATEGORY2 UPSERT] No valid junction table data (all ${junctionTableData.length} skipped due to missing businesses)`);
                }
            }
            else {
                console.warn(`⚠️ [CATEGORY2 UPSERT] No junction table data provided - category2 records will not be associated with any business`);
            }
            await (0, mysqlDb_1.executeTransaction)(queries);
            return { success: true };
        }
        catch (error) {
            console.error('Error upserting category2:', error);
            return { success: false };
        }
    });
    electron_1.ipcMain.handle('localdb-get-category2', async (event, businessId) => {
        try {
            if (businessId) {
                // Use junction table for multi-business support (junction table only - no fallback)
                return await (0, mysqlDb_1.executeQuery)(`
          SELECT DISTINCT c2.*
          FROM category2 c2
          INNER JOIN category2_businesses cb ON c2.id = cb.category2_id
          WHERE c2.is_active = 1 
            AND cb.business_id = ?
          ORDER BY c2.display_order ASC, c2.name ASC
        `, [businessId]);
            }
            else {
                return await (0, mysqlDb_1.executeQuery)('SELECT * FROM category2 WHERE is_active = 1 ORDER BY display_order ASC, name ASC');
            }
        }
        catch (error) {
            console.error('Error getting category2:', error);
            return [];
        }
    });
    // CL Accounts
    electron_1.ipcMain.handle('localdb-upsert-cl-accounts', async (event, rows) => {
        try {
            const queries = rows.map(r => {
                const getId = () => {
                    const val = r.id;
                    if (typeof val === 'number')
                        return val;
                    if (typeof val === 'string') {
                        const num = Number(val);
                        return isNaN(num) ? null : num;
                    }
                    return null;
                };
                const getString = (key) => (typeof r[key] === 'string' ? r[key] : null);
                const getNumber = (key) => {
                    const val = r[key];
                    if (typeof val === 'number')
                        return val;
                    if (typeof val === 'string') {
                        const num = Number(val);
                        return isNaN(num) ? null : num;
                    }
                    return null;
                };
                const getBoolean = (key) => {
                    const val = r[key];
                    if (typeof val === 'boolean')
                        return val;
                    if (typeof val === 'number')
                        return val === 1;
                    if (typeof val === 'string')
                        return val === 'true' || val === '1';
                    return null;
                };
                const getDate = (key) => {
                    const val = r[key];
                    if (val instanceof Date)
                        return val;
                    if (typeof val === 'string' || typeof val === 'number')
                        return val;
                    return null;
                };
                const createdDate = getDate('created_at');
                const updatedDate = getDate('updated_at');
                const createdAt = createdDate ? (0, mysqlDb_1.toMySQLTimestamp)(createdDate) : (0, mysqlDb_1.toMySQLTimestamp)(new Date());
                const updatedAt = updatedDate ? (0, mysqlDb_1.toMySQLTimestamp)(updatedDate) : (0, mysqlDb_1.toMySQLTimestamp)(Date.now());
                return {
                    sql: `INSERT INTO cl_accounts (
            id, account_code, account_name, contact_info, credit_limit, current_balance,
            is_active, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            account_code=VALUES(account_code), account_name=VALUES(account_name), contact_info=VALUES(contact_info),
            credit_limit=VALUES(credit_limit), current_balance=VALUES(current_balance),
            is_active=VALUES(is_active), created_at=VALUES(created_at), updated_at=VALUES(updated_at)`,
                    params: [
                        getId(),
                        getString('account_code'),
                        getString('account_name'),
                        getString('contact_info'),
                        getNumber('credit_limit') ?? 0.0,
                        getNumber('current_balance') ?? 0.0,
                        getBoolean('is_active') ? 1 : 0,
                        createdAt,
                        updatedAt
                    ]
                };
            });
            await (0, mysqlDb_1.executeTransaction)(queries);
            return { success: true };
        }
        catch (error) {
            console.error('Error upserting CL accounts:', error);
            return { success: false };
        }
    });
    electron_1.ipcMain.handle('localdb-get-cl-accounts', async () => {
        try {
            return await (0, mysqlDb_1.executeQuery)('SELECT * FROM cl_accounts WHERE is_active = 1 ORDER BY account_name ASC');
        }
        catch (error) {
            console.error('Error getting CL accounts:', error);
            return [];
        }
    });
    // Printer configuration handlers
    electron_1.ipcMain.handle('localdb-save-printer-config', async (event, printerType, systemPrinterName, extraSettings) => {
        try {
            let extraSettingsJson = null;
            if (extraSettings !== undefined && extraSettings !== null) {
                if (typeof extraSettings === 'string') {
                    extraSettingsJson = extraSettings.trim() === '' ? null : extraSettings;
                }
                else if (typeof extraSettings === 'object') {
                    try {
                        extraSettingsJson = JSON.stringify(extraSettings);
                    }
                    catch (jsonError) {
                        console.warn('⚠️ Failed to serialize extraSettings, falling back to null:', jsonError);
                        extraSettingsJson = null;
                    }
                }
            }
            const now = (0, mysqlDb_1.toMySQLTimestamp)(Date.now());
            await (0, mysqlDb_1.executeUpsert)(`INSERT INTO printer_configs (id, printer_type, system_printer_name, extra_settings, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           system_printer_name = VALUES(system_printer_name),
           extra_settings = VALUES(extra_settings),
           updated_at = VALUES(updated_at)`, [printerType, printerType, systemPrinterName, extraSettingsJson, now, now]);
            return { success: true };
        }
        catch (error) {
            console.error('Error saving printer config:', error);
            return { success: false, error: String(error) };
        }
    });
    electron_1.ipcMain.handle('localdb-get-printer-configs', async () => {
        try {
            return await (0, mysqlDb_1.executeQuery)('SELECT * FROM printer_configs ORDER BY printer_type ASC');
        }
        catch (error) {
            console.error('Error getting printer configs:', error);
            return [];
        }
    });
    // Local settings handlers (NOT synced to server)
    electron_1.ipcMain.handle('localdb-get-setting', async (event, settingKey) => {
        try {
            const result = await (0, mysqlDb_1.executeQueryOne)('SELECT setting_value FROM local_settings WHERE setting_key = ?', [settingKey]);
            return result?.setting_value || null;
        }
        catch (error) {
            console.error('Error getting local setting:', error);
            return null;
        }
    });
    electron_1.ipcMain.handle('localdb-save-setting', async (event, settingKey, settingValue) => {
        try {
            const now = (0, mysqlDb_1.toMySQLTimestamp)(Date.now());
            await (0, mysqlDb_1.executeUpsert)(`INSERT INTO local_settings (setting_key, setting_value, created_at, updated_at)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           setting_value = VALUES(setting_value),
           updated_at = VALUES(updated_at)`, [settingKey, settingValue, now, now]);
            return { success: true };
        }
        catch (error) {
            console.error('Error saving local setting:', error);
            return { success: false, error: String(error) };
        }
    });
    // ==================== PRINTER MANAGEMENT IPC HANDLERS ====================
    // Generate 19-digit numeric UUID
    electron_1.ipcMain.handle('generate-numeric-uuid', async (event, businessId) => {
        if (!printerService)
            return { success: false, error: 'Printer service not available' };
        try {
            const uuid = await printerService.generateNumericUUID(businessId);
            return { success: true, uuid };
        }
        catch (error) {
            return { success: false, error: String(error) };
        }
    });
    // Get or increment printer counter
    electron_1.ipcMain.handle('get-printer-counter', async (event, printerType, businessId, increment = false) => {
        if (!printerService) {
            console.error(`❌ [IPC] Printer service not available for getPrinterCounter (${printerType}, businessId: ${businessId}, increment: ${increment})`);
            return { success: false, counter: 0 };
        }
        try {
            const counter = await printerService.getPrinterCounter(printerType, businessId, increment);
            console.log(`📊 [IPC] getPrinterCounter returned: ${counter} (${printerType}, businessId: ${businessId}, increment: ${increment})`);
            return { success: true, counter };
        }
        catch (error) {
            console.error(`❌ [IPC] Error in getPrinterCounter (${printerType}, businessId: ${businessId}, increment: ${increment}):`, error);
            return { success: false, counter: 0, error: String(error) };
        }
    });
    // Get Printer 2 mode
    electron_1.ipcMain.handle('get-printer2-mode', async () => {
        if (!printerService)
            return { success: true, mode: 'manual' };
        const mode = printerService.getPrinter2Mode();
        return { success: true, mode };
    });
    // Set Printer 2 mode
    electron_1.ipcMain.handle('set-printer2-mode', async (event, mode) => {
        if (!printerService)
            return { success: false };
        const result = printerService.setPrinter2Mode(mode);
        return { success: result };
    });
    // Get Printer 2 automation selections
    electron_1.ipcMain.handle('get-printer2-automation-selections', async (event, businessId) => {
        if (!printerService)
            return { success: false, cycleNumber: 0, selections: [] };
        const result = printerService.getPrinter2AutomationSelections(businessId);
        return { success: true, ...result };
    });
    // Save Printer 2 automation selections
    electron_1.ipcMain.handle('save-printer2-automation-selections', async (event, businessId, cycleNumber, selections) => {
        if (!printerService)
            return { success: false };
        const result = printerService.savePrinter2AutomationSelections(businessId, cycleNumber, selections);
        return { success: result };
    });
    // Generate random selections
    electron_1.ipcMain.handle('generate-random-selections', async (event, cycleNumber) => {
        if (!printerService)
            return { success: false, selections: [] };
        const selections = printerService.generateRandomSelections(cycleNumber);
        return { success: true, selections };
    });
    // Log Printer 2 print
    electron_1.ipcMain.handle('log-printer2-print', async (event, transactionId, printer2ReceiptNumber, mode, cycleNumber, globalCounter, isReprint, reprintCount) => {
        if (!printerService)
            return { success: false };
        const result = await printerService.logPrinter2Print(transactionId, printer2ReceiptNumber, mode, cycleNumber, globalCounter, isReprint, reprintCount);
        return { success: result };
    });
    // Get Printer 2 audit log
    electron_1.ipcMain.handle('get-printer2-audit-log', async (event, fromDate, toDate, limit) => {
        console.log(`📋 [IPC] get-printer2-audit-log called: fromDate=${fromDate}, toDate=${toDate}, limit=${limit}, printerService=${!!printerService}`);
        if (!printerService) {
            console.log('❌ [IPC] printerService is null!');
            return { success: false, entries: [] };
        }
        const entries = await printerService.getPrinter2AuditLog(fromDate, toDate, limit || 100);
        console.log(`📋 [IPC] get-printer2-audit-log returning ${entries.length} entries`);
        return { success: true, entries };
    });
    // Log Printer 1 print
    electron_1.ipcMain.handle('log-printer1-print', async (event, transactionId, printer1ReceiptNumber, globalCounter, isReprint, reprintCount) => {
        if (!printerService)
            return { success: false };
        const result = await printerService.logPrinter1Print(transactionId, printer1ReceiptNumber, globalCounter, isReprint, reprintCount);
        return { success: result };
    });
    // Queue transaction for System POS sync (when printed to Printer 2)
    // Queue transaction for System POS sync (printer 2 transactions to local system_pos database)
    electron_1.ipcMain.handle('queue-transaction-for-system-pos', async (event, transactionId) => {
        try {
            const now = Date.now();
            await (0, mysqlDb_1.executeSystemPosTransaction)([
                {
                    sql: 'INSERT IGNORE INTO system_pos_queue (transaction_id, queued_at) VALUES (?, ?)',
                    params: [transactionId, now]
                }
            ]);
            console.log(`✅ [SYSTEM POS] Queued transaction ${transactionId} for System POS sync`);
            return { success: true };
        }
        catch (error) {
            console.error('❌ [SYSTEM POS] Error queueing transaction:', error);
            return { success: false, error: String(error) };
        }
    });
    // Get queued transactions for System POS sync
    electron_1.ipcMain.handle('get-system-pos-queue', async () => {
        try {
            // Get ALL queue entries (not just pending) for status checking
            const allQueue = await (0, mysqlDb_1.executeSystemPosQuery)('SELECT id, transaction_id, queued_at, synced_at, retry_count, last_error FROM system_pos_queue ORDER BY queued_at DESC');
            return { success: true, queue: allQueue };
        }
        catch (error) {
            console.error('❌ [SYSTEM POS] Error getting queue:', error);
            return { success: false, queue: [] };
        }
    });
    // Mark transaction as synced in System POS queue
    electron_1.ipcMain.handle('mark-system-pos-synced', async (event, transactionId) => {
        try {
            const now = Date.now();
            await (0, mysqlDb_1.executeSystemPosUpdate)('UPDATE system_pos_queue SET synced_at = ? WHERE transaction_id = ?', [now, transactionId]);
            console.log(`✅ [SYSTEM POS] Marked transaction ${transactionId} as synced`);
            return { success: true };
        }
        catch (error) {
            console.error('❌ [SYSTEM POS] Error marking as synced:', error);
            return { success: false };
        }
    });
    // Mark transaction sync failed (increment retry count)
    electron_1.ipcMain.handle('mark-system-pos-failed', async (event, transactionId, error) => {
        try {
            await (0, mysqlDb_1.executeSystemPosUpdate)('UPDATE system_pos_queue SET retry_count = retry_count + 1, last_error = ? WHERE transaction_id = ?', [error.substring(0, 500), transactionId]);
            console.log(`⚠️ [SYSTEM POS] Marked transaction ${transactionId} sync as failed (retry count incremented)`);
            return { success: true };
        }
        catch (error) {
            console.error('❌ [SYSTEM POS] Error marking as failed:', error);
            return { success: false };
        }
    });
    // Reset retry count for system-pos transactions (for retrying failed transactions)
    electron_1.ipcMain.handle('reset-system-pos-retry-count', async (event, transactionIds) => {
        try {
            if (transactionIds && transactionIds.length > 0) {
                // Reset specific transactions
                const placeholders = transactionIds.map(() => '?').join(',');
                const affectedRows = await (0, mysqlDb_1.executeSystemPosUpdate)(`UPDATE system_pos_queue SET retry_count = 0, last_error = NULL WHERE transaction_id IN (${placeholders})`, transactionIds);
                console.log(`[SYSTEM POS] Reset retry count for ${affectedRows} transaction(s)`);
                return { success: true, count: affectedRows };
            }
            else {
                // Reset all failed transactions (retry_count >= 5)
                const affectedRows = await (0, mysqlDb_1.executeSystemPosUpdate)('UPDATE system_pos_queue SET retry_count = 0, last_error = NULL WHERE retry_count >= 5', []);
                console.log(`[SYSTEM POS] Reset retry count for ${affectedRows} failed transaction(s)`);
                return { success: true, count: affectedRows };
            }
        }
        catch (error) {
            console.error('[SYSTEM POS] Error resetting retry count:', error);
            return { success: false };
        }
    });
    // Debug: Check transaction sync status for System POS
    electron_1.ipcMain.handle('debug-system-pos-transaction', async (event, transactionId) => {
        try {
            // Check if transaction exists in local DB
            const transaction = await (0, mysqlDb_1.executeQueryOne)('SELECT id, business_id, user_id, created_at, synced_at FROM transactions WHERE id = ?', [transactionId]);
            // Check queue status (in system_pos database)
            const queueEntry = await (0, mysqlDb_1.executeSystemPosQueryOne)('SELECT id, transaction_id, queued_at, synced_at, retry_count, last_error FROM system_pos_queue WHERE transaction_id = ?', [transactionId]);
            return {
                success: true,
                transaction: transaction || null,
                queue: queueEntry || null,
                existsInDatabase: !!transaction,
                isQueued: !!queueEntry,
                isSynced: queueEntry?.synced_at !== null,
                retryCount: queueEntry?.retry_count || 0,
                lastError: queueEntry?.last_error || null,
            };
        }
        catch (error) {
            console.error('❌ [SYSTEM POS DEBUG] Error checking transaction:', error);
            return { success: false, error: String(error) };
        }
    });
    // Repopulate System POS queue (Force Resync)
    electron_1.ipcMain.handle('repopulate-system-pos-queue', async (event, options = {}) => {
        try {
            const { days } = options;
            console.log(`[SYSTEM POS] Repopulating queue (days: ${days || 'ALL'})...`);
            let query = 'SELECT id, created_at FROM transactions';
            const params = [];
            if (days && days > 0) {
                const cutoffDate = new Date();
                cutoffDate.setDate(cutoffDate.getDate() - days);
                query += ' WHERE created_at >= ?';
                params.push((0, mysqlDb_1.toMySQLDateTime)(cutoffDate));
            }
            const transactions = await (0, mysqlDb_1.executeQuery)(query, params);
            if (transactions.length === 0) {
                return { success: true, count: 0, message: 'No transactions found in the specified period' };
            }
            console.log(`[SYSTEM POS] Found ${transactions.length} transactions to process`);
            const now = Date.now();
            const queries = [];
            for (const tx of transactions) {
                // Insert or ignore
                queries.push({
                    sql: 'INSERT IGNORE INTO system_pos_queue (transaction_id, queued_at) VALUES (?, ?)',
                    params: [tx.id, now]
                });
                // Always reset status to ensure partial syncs are fixed
                queries.push({
                    sql: 'UPDATE system_pos_queue SET synced_at = NULL, retry_count = 0, last_error = NULL WHERE transaction_id = ?',
                    params: [tx.id]
                });
            }
            await (0, mysqlDb_1.executeSystemPosTransaction)(queries);
            console.log(`[SYSTEM POS] Successfully queued/reset ${transactions.length} transactions`);
            return { success: true, count: transactions.length };
        }
        catch (error) {
            console.error('[SYSTEM POS] Error repopulating queue:', error);
            return { success: false, error: String(error) };
        }
    });
    // Get Printer 1 audit log
    electron_1.ipcMain.handle('get-printer1-audit-log', async (event, fromDate, toDate, limit) => {
        console.log(`[IPC] get-printer1-audit-log called: fromDate=${fromDate}, toDate=${toDate}, limit=${limit}, printerService=${!!printerService}`);
        if (!printerService) {
            console.log('[IPC] printerService is null!');
            return { success: false, entries: [] };
        }
        const entries = await printerService.getPrinter1AuditLog(fromDate, toDate, limit || 100);
        console.log(`[IPC] get-printer1-audit-log returning ${entries.length} entries`);
        return { success: true, entries };
    });
    // Get unsynced printer audits (both tables)
    electron_1.ipcMain.handle('localdb-get-unsynced-printer-audits', async () => {
        try {
            // Get unsynced printer1 audits (where synced_at IS NULL)
            const p1Audits = await (0, mysqlDb_1.executeQuery)(`
        SELECT * FROM printer1_audit_log 
        WHERE synced_at IS NULL 
        ORDER BY printed_at_epoch ASC
        LIMIT 100
      `);
            // Get unsynced printer2 audits (where synced_at IS NULL)
            const p2Audits = await (0, mysqlDb_1.executeQuery)(`
        SELECT * FROM printer2_audit_log 
        WHERE synced_at IS NULL 
        ORDER BY printed_at_epoch ASC
        LIMIT 100
      `);
            return { p1: p1Audits, p2: p2Audits };
        }
        catch (error) {
            console.error('Error getting unsynced printer audits:', error);
            return { p1: [], p2: [] };
        }
    });
    // Mark printer audits as synced
    electron_1.ipcMain.handle('localdb-mark-printer-audits-synced', async (event, ids) => {
        try {
            const now = Date.now();
            const queries = [];
            if (ids?.p1Ids?.length) {
                const placeholders = ids.p1Ids.map(() => '?').join(',');
                queries.push({
                    sql: `UPDATE printer1_audit_log SET synced_at = ? WHERE id IN (${placeholders})`,
                    params: [(0, mysqlDb_1.toMySQLDateTime)(now), ...ids.p1Ids]
                });
            }
            if (ids?.p2Ids?.length) {
                const placeholders = ids.p2Ids.map(() => '?').join(',');
                queries.push({
                    sql: `UPDATE printer2_audit_log SET synced_at = ? WHERE id IN (${placeholders})`,
                    params: [(0, mysqlDb_1.toMySQLDateTime)(now), ...ids.p2Ids]
                });
            }
            if (queries.length > 0) {
                await (0, mysqlDb_1.executeTransaction)(queries);
            }
            return { success: true };
        }
        catch (error) {
            console.error('Error marking printer audits synced:', error);
            return { success: false };
        }
    });
    // Upsert printer audit logs downloaded from cloud
    electron_1.ipcMain.handle('localdb-upsert-printer-audits', async (event, payload) => {
        if (!payload?.rows?.length)
            return { success: true, count: 0 };
        const now = Date.now();
        const { printerType, rows } = payload;
        try {
            const queries = [];
            const parsePrintedAt = (value) => {
                if (typeof value === 'string' || typeof value === 'number') {
                    const date = new Date(value);
                    if (!Number.isNaN(date.getTime())) {
                        return date.getTime();
                    }
                }
                return 0;
            };
            if (printerType === 'receipt') {
                for (const row of rows) {
                    const transactionId = String(row.transaction_id);
                    const receiptNumber = Number(row.printer1_receipt_number);
                    const printedAtEpoch = Number(row.printed_at_epoch ?? parsePrintedAt(row.printed_at));
                    if (!transactionId || Number.isNaN(receiptNumber) || Number.isNaN(printedAtEpoch)) {
                        continue;
                    }
                    // Delete existing record
                    queries.push({
                        sql: 'DELETE FROM printer1_audit_log WHERE transaction_id = ? AND printer1_receipt_number = ? AND printed_at_epoch = ?',
                        params: [transactionId, receiptNumber, printedAtEpoch]
                    });
                    // Insert new record
                    queries.push({
                        sql: `
              INSERT INTO printer1_audit_log (transaction_id, printer1_receipt_number, global_counter, printed_at, printed_at_epoch, synced_at)
              VALUES (?, ?, ?, ?, ?, ?)
            `,
                        params: [
                            transactionId,
                            receiptNumber,
                            typeof row.global_counter === 'number' ? row.global_counter : null,
                            row.printed_at ? (0, mysqlDb_1.toMySQLDateTime)(typeof row.printed_at === 'number' || typeof row.printed_at === 'string' ? row.printed_at : new Date(printedAtEpoch)) : (0, mysqlDb_1.toMySQLDateTime)(new Date(printedAtEpoch)),
                            printedAtEpoch,
                            now
                        ]
                    });
                }
            }
            else {
                for (const row of rows) {
                    const transactionId = String(row.transaction_id);
                    const receiptNumber = Number(row.printer2_receipt_number);
                    const printedAtEpoch = Number(row.printed_at_epoch ?? parsePrintedAt(row.printed_at));
                    if (!transactionId || Number.isNaN(receiptNumber) || Number.isNaN(printedAtEpoch)) {
                        continue;
                    }
                    // Delete existing record
                    queries.push({
                        sql: 'DELETE FROM printer2_audit_log WHERE transaction_id = ? AND printer2_receipt_number = ? AND printed_at_epoch = ?',
                        params: [transactionId, receiptNumber, printedAtEpoch]
                    });
                    // Insert new record
                    queries.push({
                        sql: `
              INSERT INTO printer2_audit_log (transaction_id, printer2_receipt_number, print_mode, cycle_number, global_counter, printed_at, printed_at_epoch, synced_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `,
                        params: [
                            transactionId,
                            receiptNumber,
                            typeof row.print_mode === 'string' ? row.print_mode : 'manual',
                            typeof row.cycle_number === 'number' ? row.cycle_number : null,
                            typeof row.global_counter === 'number' ? row.global_counter : null,
                            row.printed_at ? (0, mysqlDb_1.toMySQLDateTime)(typeof row.printed_at === 'number' || typeof row.printed_at === 'string' ? row.printed_at : new Date(printedAtEpoch)) : (0, mysqlDb_1.toMySQLDateTime)(new Date(printedAtEpoch)),
                            printedAtEpoch,
                            now
                        ]
                    });
                }
            }
            if (queries.length > 0) {
                await (0, mysqlDb_1.executeTransaction)(queries);
            }
            return { success: true, count: rows.length };
        }
        catch (error) {
            console.error('Error upserting printer audits:', error);
            return { success: false, error: String(error) };
        }
    });
    // Get all printer daily counters
    electron_1.ipcMain.handle('localdb-get-all-printer-daily-counters', async () => {
        try {
            return await (0, mysqlDb_1.executeQuery)('SELECT printer_type, business_id, date, counter FROM printer_daily_counters ORDER BY business_id, printer_type, date');
        }
        catch (error) {
            console.error('Error getting printer daily counters:', error);
            return [];
        }
    });
    // Upsert printer daily counters downloaded from cloud
    electron_1.ipcMain.handle('localdb-upsert-printer-daily-counters', async (event, counters) => {
        if (!Array.isArray(counters) || counters.length === 0) {
            return { success: true, count: 0 };
        }
        try {
            const now = Date.now();
            const queries = counters
                .filter(row => row?.printer_type && row?.date)
                .map(row => ({
                sql: `
            INSERT INTO printer_daily_counters (printer_type, business_id, date, counter, last_reset_at)
            VALUES (?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE counter = VALUES(counter), last_reset_at = VALUES(last_reset_at)
          `,
                params: [
                    row.printer_type,
                    Number(row.business_id ?? 0),
                    row.date,
                    Number(row.counter ?? 0),
                    now
                ]
            }));
            if (queries.length > 0) {
                await (0, mysqlDb_1.executeTransaction)(queries);
            }
            return { success: true, count: counters.length };
        }
        catch (error) {
            console.error('Error upserting printer counters:', error);
            return { success: false, error: String(error) };
        }
    });
    electron_1.ipcMain.handle('localdb-reset-printer-daily-counters', async (event, businessId) => {
        try {
            await (0, mysqlDb_1.executeUpdate)(`
        DELETE FROM printer_daily_counters
        WHERE business_id = ?
      `, [businessId]);
            console.log(`[RESET] Cleared printer_daily_counters for business ${businessId}`);
            return { success: true };
        }
        catch (error) {
            console.error('[RESET] Failed to clear printer_daily_counters:', error);
            return { success: false, error: String(error) };
        }
    });
    // Mark transaction as failed (for transactions table)
    electron_1.ipcMain.handle('localdb-mark-transaction-failed', async (event, transactionId) => {
        try {
            const now = Date.now();
            // CRITICAL FIX: Use uuid_id instead of id, because smart sync passes UUID strings
            await (0, mysqlDb_1.executeUpdate)(`
        UPDATE transactions 
        SET sync_status = 'failed', sync_attempts = sync_attempts + 1, last_sync_attempt = ?
        WHERE uuid_id = ?
      `, [now, transactionId]);
            console.log(`[MARK FAILED] Marked transaction ${transactionId} as failed`);
            return { success: true };
        }
        catch (error) {
            console.error('Error marking transaction as failed:', error);
            return { success: false, error: String(error) };
        }
    });
    electron_1.ipcMain.handle('localdb-queue-offline-refund', async (event, refundData) => {
        try {
            const connection = await (0, mysqlDb_1.getConnection)();
            try {
                // Convert timestamp to MySQL DATETIME format (YYYY-MM-DD HH:MM:SS)
                const mysqlDateTime = new Date().toISOString().slice(0, 19).replace('T', ' ');
                const [result] = await connection.query(`
          INSERT INTO offline_refunds (refund_data, created_at, sync_status, sync_attempts)
          VALUES (?, ?, 'pending', 0)
        `, [JSON.stringify(refundData), mysqlDateTime]);
                return { success: true, offlineRefundId: result.insertId };
            }
            finally {
                connection.release();
            }
        }
        catch (error) {
            console.error('Error queueing offline refund:', error);
            return { success: false, error: String(error) };
        }
    });
    electron_1.ipcMain.handle('localdb-get-pending-refunds', async () => {
        try {
            return await (0, mysqlDb_1.executeQuery)(`
        SELECT id, refund_data, created_at, sync_attempts, last_sync_attempt
        FROM offline_refunds
        WHERE sync_status = 'pending'
        ORDER BY created_at ASC
        LIMIT 50
      `);
        }
        catch (error) {
            // Table doesn't exist - return empty array instead of error
            const err = error;
            if (err.code === 'ER_NO_SUCH_TABLE' || err.errno === 1146) {
                console.warn('⚠️ [REFUNDS] offline_refunds table does not exist - returning empty array');
                return [];
            }
            console.error('Error getting pending refunds:', error);
            return [];
        }
    });
    electron_1.ipcMain.handle('localdb-mark-refund-synced', async (event, offlineRefundId) => {
        try {
            // Convert timestamp to MySQL DATETIME format (YYYY-MM-DD HH:MM:SS)
            const mysqlDateTime = new Date().toISOString().slice(0, 19).replace('T', ' ');
            await (0, mysqlDb_1.executeUpdate)(`
        UPDATE offline_refunds
        SET sync_status = 'synced', last_sync_attempt = ?
        WHERE id = ?
      `, [mysqlDateTime, offlineRefundId]);
            return { success: true };
        }
        catch (error) {
            console.error('Error marking refund as synced:', error);
            return { success: false, error: String(error) };
        }
    });
    electron_1.ipcMain.handle('localdb-mark-refund-failed', async (event, offlineRefundId) => {
        try {
            // Convert timestamp to MySQL DATETIME format (YYYY-MM-DD HH:MM:SS)
            const mysqlDateTime = new Date().toISOString().slice(0, 19).replace('T', ' ');
            await (0, mysqlDb_1.executeUpdate)(`
        UPDATE offline_refunds
        SET sync_attempts = sync_attempts + 1, last_sync_attempt = ?
        WHERE id = ?
      `, [mysqlDateTime, offlineRefundId]);
            return { success: true };
        }
        catch (error) {
            console.error('Error marking refund as failed:', error);
            return { success: false, error: String(error) };
        }
    });
    // Load the app - start with login page
    console.log('🔍 isDev:', isDev);
    if (isDev) {
        console.log('🔍 Development mode detected');
        // Wait a bit for Next.js to start, then load the login page
        setTimeout(async () => {
            console.log('🔍 Loading login page...');
            // Try to use the port specified in env (PORT from npm script), fall back to defaults
            const tryLoadURL = async (port) => {
                try {
                    await mainWindow.loadURL(`http://localhost:${port}/login`);
                    console.log(`Successfully loaded login page on port ${port}`);
                    return true;
                }
                catch (error) {
                    console.log(`Failed to load on port ${port}:`, error);
                    return false;
                }
            };
            const preferredPort = Number(process.env.PORT ?? '');
            const fallbackPorts = [3000, 3001, 3002];
            const ports = [
                ...(Number.isFinite(preferredPort) ? [preferredPort] : []),
                ...fallbackPorts
            ].filter((port, index, arr) => arr.indexOf(port) === index);
            let loaded = false;
            for (const port of ports) {
                if (await tryLoadURL(port)) {
                    loaded = true;
                    break;
                }
            }
            if (!loaded) {
                console.error('Failed to load on any port');
            }
        }, 5000); // Wait longer for Next.js to be ready
    }
    else {
        // In production, load the built Next.js app
        const indexPath = path.join(__dirname, '../../out/index.html');
        console.log('🔍 Loading production index file from:', indexPath);
        mainWindow.loadFile(indexPath);
    }
    // Show windows when ready
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        // Always focus on the window (fixes Windows 11 frameless window focus issues)
        mainWindow.focus();
    });
    if (customerWindow) {
        customerWindow.once('ready-to-show', () => {
            customerWindow.setFullScreen(true);
            customerWindow.show();
        });
    }
    // Handle window closed
    mainWindow.on('closed', () => {
        mainWindow = null;
        if (customerWindow) {
            customerWindow.close();
            customerWindow = null;
        }
    });
    if (customerWindow) {
        customerWindow.on('closed', () => {
            customerWindow = null;
        });
    }
    // Create application menu
    const template = [
        {
            label: 'File',
            submenu: [
                {
                    label: 'New Order',
                    accelerator: 'CmdOrCtrl+N',
                    click: () => {
                        if (mainWindow) {
                            mainWindow.webContents.send('menu-new-order');
                        }
                    },
                },
                {
                    label: 'Close',
                    accelerator: 'CmdOrCtrl+W',
                    click: () => {
                        if (mainWindow) {
                            mainWindow.close();
                        }
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
    // Register custom protocol handler for slideshow images
    electron_1.protocol.registerFileProtocol('slideshow-file', (request, callback) => {
        try {
            const url = request.url.replace('slideshow-file://', '');
            const slideshowPath = getSlideshowPath();
            const filePath = path.join(slideshowPath, url);
            // Security check: ensure file is within slideshow directory
            const normalizedPath = path.normalize(filePath);
            const normalizedSlideshowPath = path.normalize(slideshowPath);
            if (!normalizedPath.startsWith(normalizedSlideshowPath)) {
                console.error('❌ Security: Attempted to access file outside slideshow directory');
                callback({ error: -10 }); // ACCESS_DENIED
                return;
            }
            if (fs.existsSync(filePath)) {
                callback({ path: filePath });
            }
            else {
                console.error('❌ Slideshow image not found:', filePath);
                callback({ error: -6 }); // FILE_NOT_FOUND
            }
        }
        catch (error) {
            console.error('❌ Error handling slideshow-file protocol:', error);
            callback({ error: -2 }); // FAILED
        }
    });
    createWindows();
    electron_1.app.on('activate', () => {
        // On macOS, re-create windows when the dock icon is clicked
        if (electron_1.BrowserWindow.getAllWindows().length === 0) {
            createWindows();
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
    try {
        console.log('📄 Printing receipt - Full data received:', JSON.stringify(data, null, 2));
        console.log(`🔍 [PRINT-RECEIPT] Counter values: printer1Counter=${data.printer1Counter}, printer2Counter=${data.printer2Counter}, globalCounter=${data.globalCounter}, printerType=${data.printerType}`);
        let printerName = data.printerName;
        let marginAdjustMm = typeof data.marginAdjustMm === 'number' && !Number.isNaN(data.marginAdjustMm)
            ? data.marginAdjustMm
            : undefined;
        let printerConfig = null;
        if (data.printerType) {
            console.log('🔍 Resolving printer configuration for type:', data.printerType);
            try {
                const allConfigs = await (0, mysqlDb_1.executeQuery)('SELECT * FROM printer_configs');
                console.log('📋 All printer configs in database:', allConfigs);
                printerConfig = await (0, mysqlDb_1.executeQueryOne)('SELECT * FROM printer_configs WHERE printer_type = ?', [data.printerType]) ?? null;
                console.log('📋 Printer config query result for type', data.printerType, ':', printerConfig);
                if (!printerName && printerConfig && printerConfig.system_printer_name) {
                    const configPrinterName = String(printerConfig.system_printer_name).trim();
                    if (configPrinterName) {
                        printerName = configPrinterName;
                        console.log('✅ Found saved printer:', printerName);
                    }
                    else {
                        console.warn('⚠️ Printer config exists but system_printer_name is empty');
                    }
                }
                if (marginAdjustMm === undefined && printerConfig && printerConfig.extra_settings) {
                    try {
                        const extra = typeof printerConfig.extra_settings === 'string'
                            ? JSON.parse(printerConfig.extra_settings)
                            : printerConfig.extra_settings;
                        if (extra && typeof extra.marginAdjustMm === 'number' && !Number.isNaN(extra.marginAdjustMm)) {
                            marginAdjustMm = extra.marginAdjustMm;
                            console.log('🎚️ Loaded marginAdjustMm from saved settings:', marginAdjustMm);
                        }
                    }
                    catch (parseError) {
                        console.warn('⚠️ Failed to parse extra_settings for printer config:', parseError);
                    }
                }
                if (!printerName) {
                    console.log('⚠️ No system printer configured for type:', data.printerType);
                    console.log('💡 Available printer configs:', allConfigs.map(c => ({ type: c.printer_type, name: c.system_printer_name })));
                    return { success: false, error: `No printer configured for ${data.printerType}. Please set up a printer in Settings → Printer Selector.` };
                }
                // Validate printer name is not empty after trim
                if (printerName && typeof printerName === 'string' && !printerName.trim()) {
                    console.error('❌ Printer name is empty after trim');
                    return { success: false, error: `Printer name is empty for ${data.printerType}. Please reconfigure the printer in Settings → Printer Selector.` };
                }
            }
            catch (error) {
                console.error('❌ Error fetching printer config:', error);
                return { success: false, error: 'Error loading printer configuration.' };
            }
        }
        else if (!printerName && !data.printerType) {
            console.error('❌ No printerName and no printerType provided!');
            return { success: false, error: 'No printer specified. Please set up a printer in Settings first.' };
        }
        else if (printerName) {
            console.log('✅ Using provided printer name:', printerName);
        }
        // Validate printerName is a valid string (not printerType identifier)
        if (!printerName || (typeof printerName === 'string' && !printerName.trim())) {
            console.error('❌ No valid printer name found. printerName:', printerName, 'printerType:', data.printerType);
            return { success: false, error: `No printer configured. Please set up a printer in Settings → Printer Selector for ${data.printerType || 'the selected printer type'}.` };
        }
        // Ensure printerName is a string and trimmed
        printerName = String(printerName).trim();
        if (!printerName) {
            console.error('❌ Printer name is empty after validation');
            return { success: false, error: 'No printer specified. Please set up a printer in Settings first.' };
        }
        // Use HTML printing with character-based formatting
        if (printWindow) {
            printWindow.close();
        }
        printWindow = new electron_1.BrowserWindow({
            width: 400,
            height: 600,
            show: false,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
            }
        });
        // Fetch business name from database if business_id is provided
        let businessName = 'MARVIANO MADIUN 1'; // Default fallback
        if (data.business_id) {
            try {
                const business = await (0, mysqlDb_1.executeQueryOne)('SELECT name FROM businesses WHERE id = ?', [data.business_id]);
                if (business) {
                    businessName = business.name;
                    console.log('✅ Fetched business name:', businessName, 'for business_id:', data.business_id);
                }
                else {
                    console.log('⚠️ Business not found for business_id:', data.business_id);
                }
            }
            catch (error) {
                console.error('❌ Error fetching business name:', error);
            }
        }
        const clampedMarginAdjustMm = typeof marginAdjustMm === 'number' && !Number.isNaN(marginAdjustMm)
            ? Math.max(-5, Math.min(5, marginAdjustMm))
            : 0;
        const receiptFormattingOptions = { marginAdjustMm: clampedMarginAdjustMm };
        // Generate receipt HTML with character-based width
        let htmlContent = '';
        if (data.type === 'test') {
            // Check if this is for a label printer
            if (data.printerType === 'labelPrinter') {
                htmlContent = generateTestLabelHTML(printerName);
            }
            else {
                htmlContent = generateTestReceiptHTML(printerName, businessName, receiptFormattingOptions);
            }
        }
        else {
            htmlContent = generateReceiptHTML(data, businessName, receiptFormattingOptions);
        }
        await printWindow.loadURL(`data:text/html,${encodeURIComponent(htmlContent)}`);
        const printOptions = {
            silent: true,
            printBackground: false,
            deviceName: printerName,
        };
        return new Promise((resolve) => {
            const currentWindow = printWindow;
            setTimeout(() => {
                try {
                    if (!currentWindow || currentWindow.isDestroyed()) {
                        console.error('❌ Print window not available when attempting to print');
                        resolve({ success: false, error: 'Print window unavailable' });
                        return;
                    }
                    currentWindow.webContents.print(printOptions, (success, errorType) => {
                        if (success) {
                            console.log('✅ Print sent successfully');
                            resolve({ success: true });
                        }
                        else {
                            console.error('❌ Print failed:', errorType);
                            resolve({ success: false, error: errorType });
                        }
                        setTimeout(() => {
                            if (currentWindow && !currentWindow.isDestroyed()) {
                                currentWindow.close();
                            }
                            if (printWindow === currentWindow) {
                                printWindow = null;
                            }
                        }, 1000);
                    });
                }
                catch (err) {
                    console.error('❌ Exception during webContents.print:', err);
                    resolve({ success: false, error: String(err) });
                    if (currentWindow && !currentWindow.isDestroyed()) {
                        currentWindow.close();
                    }
                    if (printWindow === currentWindow) {
                        printWindow = null;
                    }
                }
            }, 500);
        });
    }
    catch (error) {
        console.error('❌ Error in print-receipt handler:', error);
        return { success: false, error: String(error) };
    }
});
// Execute single label print (used by queue)
async function executeLabelPrint(data) {
    try {
        console.log('🏷️ [EXECUTE] Printing label - Full data received:', JSON.stringify(data, null, 2));
        let printerName = data.printerName;
        // If printer name is not specified, try to get it from saved config
        if (!printerName) {
            if (!data.printerType) {
                console.error('❌ No printer type provided!');
                return { success: false, error: 'No printer specified.' };
            }
            console.log('🔍 No printer name specified, fetching from saved config for printer type:', data.printerType);
            try {
                const config = await (0, mysqlDb_1.executeQueryOne)('SELECT * FROM printer_configs WHERE printer_type = ?', [data.printerType]);
                if (!config) {
                    console.log('⚠️ No saved printer config found for type:', data.printerType);
                    return { success: false, error: 'Label printer not configured. Please set up a valid printer in Settings.' };
                }
                if (!config.system_printer_name || config.system_printer_name.trim() === '') {
                    console.log('⚠️ Printer config found but system_printer_name is empty:', config);
                    return { success: false, error: 'Label printer not configured. Please set up a valid printer in Settings.' };
                }
                printerName = config.system_printer_name;
                console.log('✅ Found saved printer:', printerName);
            }
            catch (error) {
                console.error('❌ Error fetching printer config:', error);
                return { success: false, error: 'Error loading printer configuration.' };
            }
        }
        if (!printerName) {
            console.error('❌ No printer name provided!');
            return { success: false, error: 'No printer specified.' };
        }
        // Create a new print window for this job (don't reuse global)
        const jobPrintWindow = new electron_1.BrowserWindow({
            width: 400,
            height: 600,
            show: false,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
            }
        });
        // Generate label HTML
        const htmlContent = generateLabelHTML(data);
        await jobPrintWindow.loadURL(`data:text/html,${encodeURIComponent(htmlContent)}`);
        const printOptions = {
            silent: true,
            printBackground: false,
            deviceName: printerName,
        };
        return new Promise((resolve) => {
            setTimeout(() => {
                try {
                    if (!jobPrintWindow || jobPrintWindow.isDestroyed()) {
                        console.error('❌ Print window not available when attempting to print label');
                        resolve({ success: false, error: 'Print window unavailable' });
                        return;
                    }
                    jobPrintWindow.webContents.print(printOptions, (success, errorType) => {
                        if (success) {
                            console.log('✅ Label sent successfully');
                            resolve({ success: true });
                        }
                        else {
                            console.error('❌ Label print failed:', errorType);
                            resolve({ success: false, error: errorType });
                        }
                        setTimeout(() => {
                            if (jobPrintWindow && !jobPrintWindow.isDestroyed()) {
                                jobPrintWindow.close();
                            }
                        }, 5000);
                    });
                }
                catch (err) {
                    console.error('❌ Exception during webContents.print:', err);
                    resolve({ success: false, error: String(err) });
                    if (jobPrintWindow && !jobPrintWindow.isDestroyed()) {
                        jobPrintWindow.close();
                    }
                }
            }, 500);
        });
    }
    catch (error) {
        console.error('❌ Error in executeLabelPrint:', error);
        return { success: false, error: String(error) };
    }
}
// Execute batch labels print (used by queue)
async function executeLabelsBatchPrint(data) {
    try {
        console.log('🏷️ [EXECUTE] Printing labels batch - Count:', data.labels?.length || 0);
        if (!data.labels || !Array.isArray(data.labels) || data.labels.length === 0) {
            console.error('❌ No labels provided for batch printing');
            return { success: false, error: 'No labels provided for batch printing.' };
        }
        let printerName = data.printerName;
        // If printer name is not specified, try to get it from saved config
        if (!printerName) {
            if (!data.printerType) {
                console.error('❌ No printer type provided!');
                return { success: false, error: 'No printer specified.' };
            }
            console.log('🔍 No printer name specified, fetching from saved config for printer type:', data.printerType);
            try {
                const config = await (0, mysqlDb_1.executeQueryOne)('SELECT * FROM printer_configs WHERE printer_type = ?', [data.printerType]);
                if (!config) {
                    console.log('⚠️ No saved printer config found for type:', data.printerType);
                    return { success: false, error: 'Label printer not configured. Please set up a valid printer in Settings.' };
                }
                if (!config.system_printer_name || config.system_printer_name.trim() === '') {
                    console.log('⚠️ Printer config found but system_printer_name is empty:', config);
                    return { success: false, error: 'Label printer not configured. Please set up a valid printer in Settings.' };
                }
                printerName = config.system_printer_name;
                console.log('✅ Found saved printer:', printerName);
            }
            catch (error) {
                console.error('❌ Error fetching printer config:', error);
                return { success: false, error: 'Error loading printer configuration.' };
            }
        }
        if (!printerName) {
            console.error('❌ No printer name provided!');
            return { success: false, error: 'No printer specified.' };
        }
        // Create a new print window for this job (don't reuse global)
        const jobPrintWindow = new electron_1.BrowserWindow({
            width: 400,
            height: 600,
            show: false,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
            }
        });
        // Generate batch label HTML
        const htmlContent = generateMultipleLabelsHTML(data.labels);
        await jobPrintWindow.loadURL(`data:text/html,${encodeURIComponent(htmlContent)}`);
        const printOptions = {
            silent: true,
            printBackground: false,
            deviceName: printerName,
        };
        return new Promise((resolve) => {
            setTimeout(() => {
                try {
                    if (!jobPrintWindow || jobPrintWindow.isDestroyed()) {
                        console.error('❌ Print window not available when attempting to print labels batch');
                        resolve({ success: false, error: 'Print window unavailable' });
                        return;
                    }
                    jobPrintWindow.webContents.print(printOptions, (success, errorType) => {
                        if (success) {
                            console.log(`✅ Batch labels (${data.labels.length} labels) sent successfully`);
                            resolve({ success: true });
                        }
                        else {
                            console.error('❌ Batch labels print failed:', errorType);
                            resolve({ success: false, error: errorType });
                        }
                        setTimeout(() => {
                            if (jobPrintWindow && !jobPrintWindow.isDestroyed()) {
                                jobPrintWindow.close();
                            }
                        }, 5000);
                    });
                }
                catch (err) {
                    console.error('❌ Exception during webContents.print:', err);
                    resolve({ success: false, error: String(err) });
                    if (jobPrintWindow && !jobPrintWindow.isDestroyed()) {
                        jobPrintWindow.close();
                    }
                }
            }, 500);
        });
    }
    catch (error) {
        console.error('❌ Error in executeLabelsBatchPrint:', error);
        return { success: false, error: String(error) };
    }
}
// IPC handler for printing labels (queued)
electron_1.ipcMain.handle('print-label', async (event, data) => {
    return new Promise((resolve, reject) => {
        console.log('📋 [PRINT QUEUE] Adding label print job to queue');
        printQueue.push({
            type: 'label',
            data,
            resolve,
            reject
        });
        // Start processing queue if not already processing
        processPrintQueue().catch(err => {
            console.error('❌ [PRINT QUEUE] Error processing queue:', err);
        });
    });
});
// IPC handler for batch printing labels (queued)
electron_1.ipcMain.handle('print-labels-batch', async (event, data) => {
    // Validate input first (before queuing)
    if (!data.labels || !Array.isArray(data.labels) || data.labels.length === 0) {
        console.error('❌ No labels provided for batch printing');
        return { success: false, error: 'No labels provided for batch printing.' };
    }
    return new Promise((resolve, reject) => {
        console.log('📋 [PRINT QUEUE] Adding labels batch print job to queue');
        printQueue.push({
            type: 'labels-batch',
            data,
            resolve,
            reject
        });
        // Start processing queue if not already processing
        processPrintQueue().catch(err => {
            console.error('❌ [PRINT QUEUE] Error processing queue:', err);
        });
    });
});
// Get logo as base64 for embedding in receipt
function getLogoBase64() {
    try {
        // Try multiple possible paths
        const possiblePaths = [
            path.join(__dirname, '../public/logo/Momoyo.png'),
            path.join(__dirname, '../public/images/Momoyo.png'),
            path.join(__dirname, '../../public/logo/Momoyo.png'),
            path.join(__dirname, '../../public/images/Momoyo.png'),
        ];
        console.log('🔍 Looking for logo in paths:', possiblePaths);
        for (const logoPath of possiblePaths) {
            if (fs.existsSync(logoPath)) {
                console.log('✅ Found logo at:', logoPath);
                const imageBuffer = fs.readFileSync(logoPath);
                const base64Image = imageBuffer.toString('base64');
                return `data:image/png;base64,${base64Image}`;
            }
        }
        console.warn('⚠️ Logo not found in any of the checked paths');
        return '';
    }
    catch (error) {
        console.error('❌ Error loading logo:', error);
        return '';
    }
}
// Generate test receipt HTML with character-based formatting
function generateTestReceiptHTML(printerName, businessName, options) {
    const marginAdjust = options?.marginAdjustMm ?? 0;
    const baseLeftPadding = 7;
    const baseRightPadding = 7;
    const leftPadding = Math.max(0, baseLeftPadding - marginAdjust);
    const rightPadding = Math.max(0, baseRightPadding + marginAdjust);
    // Format date as YYYY-MM-DD HH:MM:SS
    const formatDateTime = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');
        return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    };
    // Use the full receipt format for test print with sample data
    const orderTime = formatDateTime(new Date());
    const printTime = formatDateTime(new Date());
    const logoDataUri = getLogoBase64();
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    @page { size: 80mm auto; margin: 0; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Arial', 'Helvetica', sans-serif;
      width: 42ch;
      max-width: 42ch;
      font-size: 10pt;
      font-weight: 500;
      line-height: 1.2;
      padding: 2mm ${rightPadding.toFixed(2)}mm 2mm ${leftPadding.toFixed(2)}mm;
      word-wrap: break-word;
      overflow-wrap: break-word;
    }
    .contact { text-align: center; font-size: 8pt; font-weight: 600; margin-bottom: 1mm; }
    .logo-container { text-align: center; margin-bottom: 1mm; }
    .logo { max-width: 100%; height: auto; max-height: 18mm; }
    .store-name { text-align: center; font-size: 13pt; font-weight: bold; margin-bottom: 1mm; }
    .branch { text-align: center; font-size: 11pt; font-weight: 600; margin-bottom: 1mm; }
    .address { text-align: center; font-size: 8pt; font-weight: 500; margin-bottom: 1.5mm; max-width: 100%; line-height: 1.3; }
    .transaction-type { text-align: center; font-size: 10pt; font-weight: 700; margin-bottom: 1.5mm; }
    .dashed-line { border-top: 1px dashed #000; margin: 1.5mm 0; }
    .info-line { display: flex; justify-content: space-between; margin-bottom: 0.5mm; }
    .info-label { font-size: 9pt; font-weight: 500; }
    .info-value { font-size: 9pt; font-weight: 700; }
    .mono-value {
      font-family: 'Consolas', 'Lucida Console', 'Courier New', monospace;
      white-space: pre;
      font-variant-numeric: tabular-nums;
      -webkit-font-variant-numeric: tabular-nums;
      font-feature-settings: 'tnum' 1, 'lnum' 1;
    }
    .order-number-value { font-size: 9pt; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; margin: 1mm 0; font-size: 9pt; }
    th { text-align: left; font-weight: 700; border-bottom: 1px solid #000; padding: 0.5mm 0; font-size: 8pt; }
    td { padding: 0.5mm 0; font-weight: 500; }
    .summary-line { display: flex; justify-content: space-between; margin-bottom: 0.5mm; font-size: 9pt; font-weight: 500; }
    .summary-label { font-weight: 500; }
    .summary-value { font-weight: 700; }
    .footer { margin-top: 2mm; font-size: 8pt; text-align: left; line-height: 1.3; font-weight: 500; }
  </style>
</head>
<body>
  <div class="contact">silahkan hubungi: 0813-9888-8568</div>
  
  ${logoDataUri ? `<div class="logo-container"><img src="${logoDataUri}" class="logo" alt="Momoyo Logo"></div>` : '<div class="store-name">MOMOYO</div>'}
  <div class="branch">${businessName}</div>
  <div class="address">Jl. Kalimantan no. 21, Kartoharjo<br>Kec. Kartoharjo, Kota Madiun</div>
  
  <div class="transaction-type">DINE IN TEST PRINT</div>
  
  <div class="dashed-line"></div>
  
  <div class="info-line">
    <span class="info-label">Nomor Pesanan:</span>
    <span class="info-value order-number-value mono-value">0000000000000000000</span>
  </div>
  <div class="info-line">
    <span class="info-label">Waktu Pesanan:</span>
    <span class="info-value mono-value">${orderTime}</span>
  </div>
  <div class="info-line">
    <span class="info-label">Waktu Print:</span>
    <span class="info-value mono-value">${printTime}</span>
  </div>
  <div class="info-line">
    <span class="info-label">Operator Kasir:</span>
    <span class="info-value">test print</span>
  </div>
  <div class="info-line">
    <span class="info-label">Saluran:</span>
    <span class="info-value">Toko Offline</span>
  </div>
  
  <div class="dashed-line"></div>
  
  <table>
    <tr>
      <th style="width: 30%;">Nama Produk</th>
      <th style="width: 25%; text-align: right;">Harga</th>
      <th style="width: 20%; text-align: right;">Jumlah</th>
      <th style="width: 25%; text-align: right;">Subtotal</th>
    </tr>
    <tr>
      <td colspan="4" style="text-align: left; padding-bottom: 0.5mm;">testprint</td>
    </tr>
    <tr>
      <td style="width: 30%;"></td>
      <td style="width: 25%; text-align: right; padding-top: 0;">10.000</td>
      <td style="width: 20%; text-align: right; padding-top: 0;">1</td>
      <td style="width: 25%; text-align: right; padding-top: 0;">10.000</td>
    </tr>
  </table>
  
  <div class="dashed-line"></div>
  
  <div class="summary-line">
    <span class="summary-label">Total Pesanan:</span>
    <span class="summary-value">1</span>
  </div>
  <div class="summary-line">
    <span class="summary-label">Total Harga:</span>
    <span class="summary-value">10.000</span>
  </div>
  <div class="summary-line">
    <span class="summary-label">Nominal Pendapatan:</span>
    <span class="summary-value">10.000</span>
  </div>
  
  <div class="dashed-line"></div>
  
  <div class="summary-line">
    <span class="summary-label">Metode Pembayaran:</span>
    <span class="summary-value">Cash</span>
  </div>
  <div class="summary-line">
    <span class="summary-label">Bayar Jumlah:</span>
    <span class="summary-value">30.000</span>
  </div>
  <div class="summary-line">
    <span class="summary-label">Kembali Uang Kecil:</span>
    <span class="summary-value">20.000</span>
  </div>
  <div class="summary-line">
    <span class="summary-label">Pembayaran Sebenarnya:</span>
    <span class="summary-value">10.000</span>
  </div>
  
  <div class="dashed-line"></div>
  
  <div class="footer">
    <p>Pendapat Anda sangat penting bagi kami.</p>
    <p>Untuk kritik dan saran silahkan hubungi :</p>
    <p>0812-1822-2666</p>
    <p style="margin-top: 2mm;">Untuk layanan kemitraan dan partnership</p>
  </div>
</body>
</html>
  `;
}
// Generate test label HTML for 40x30mm label printer
function generateTestLabelHTML(printerName) {
    const labelPrinterName = printerName || 'Label Printer';
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    @page { size: 40mm auto; margin: 0; }
    * { margin: 0; padding: 0; box-sizing: border-box; color: black; }
    body {
      font-family: 'Arial', 'Helvetica', sans-serif;
      width: 21ch;
      max-width: 21ch;
      font-size: 10pt;
      font-weight: 600;
      line-height: 1.4;
      padding: 3mm;
      word-wrap: break-word;
      overflow-wrap: break-word;
      color: black;
    }
    .label-content {
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      text-align: center;
      padding: 2mm 0;
    }
    .customer-name {
      font-size: 14pt;
      font-weight: 700;
      margin-bottom: 2mm;
      text-transform: uppercase;
    }
    .item-name {
      font-size: 11pt;
      font-weight: 600;
    }
  </style>
</head>
<body>
  <div class="label-content">
    <div class="customer-name">Austin</div>
    <div class="item-name">Matcha Latte Hot</div>
    <div style="font-size: 7pt; margin-top: 2mm;">Testing printer: ${labelPrinterName}</div>
  </div>
</body>
</html>
  `;
}
// Generate label HTML for order items
function generateLabelHTML(data) {
    const formatDateTime = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');
        return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    };
    const counter = data.counter || 0;
    const itemNumber = data.itemNumber || 0;
    const totalItems = data.totalItems || 0;
    const pickupMethod = data.pickupMethod || 'dine-in';
    const productName = data.productName || '';
    const customizations = data.customizations || '';
    const labelContinuation = data.labelContinuation || '';
    const orderTime = data.orderTime ? formatDateTime(new Date(data.orderTime)) : formatDateTime(new Date());
    const pickupLabel = pickupMethod === 'dine-in' ? 'DINE IN' : 'TAKE AWAY';
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    @page { 
      size: 40mm auto; 
      margin: 0;
    }
    * { 
      margin: 0; 
      padding: 0; 
      box-sizing: border-box; 
      color: black; 
    }
    body {
      font-family: 'Arial', 'Helvetica', sans-serif;
      width: 22ch;
      max-width: 22ch;
      font-size: 8pt;
      font-weight: 600;
      line-height: 1.4;
      padding: 3mm 0 3mm 3mm;
      word-wrap: break-word;
      overflow-wrap: break-word;
      color: black;
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 100%;
    }
    .content {
      flex: 1;
    }
    .row {
      display: table;
      width: calc(100% + 3mm);
      table-layout: fixed;
      margin-right: -3mm;
    }
    .row > div {
      display: table-cell;
    }
    .counter {
      font-size: 9pt;
      font-weight: 700;
    }
    .pickup {
      text-align: left;
      font-size: 7pt;
      font-weight: 700;
      text-transform: uppercase;
    }
    .product {
      text-align: left;
      font-size: 7pt;
      font-weight: 600;
    }
    .customizations {
      text-align: left;
      font-size: 7pt;
      font-weight: 500;
    }
    .number {
      font-size: 9pt;
      font-weight: 700;
      text-align: right;
    }
    .continuation {
      font-size: 7pt;
      font-weight: 600;
      color: #666;
      text-align: center;
    }
    .footer {
      margin-top: auto;
      padding-top: 2mm;
    }
    .time {
      text-align: left;
      font-size: 7pt;
      font-weight: 500;
    }
  </style>
</head>
<body>
  <div class="content">
    <div class="row">
      <div class="counter">${counter}</div>
      ${labelContinuation ? `<div class="continuation">${labelContinuation}</div>` : '<div class="continuation"></div>'}
      <div class="number">${itemNumber}/${totalItems}</div>
    </div>
    <div class="pickup">${pickupLabel}</div>
    <div class="product">${productName}</div>
    ${customizations ? `<div class="customizations">${customizations}</div>` : ''}
  </div>
  <div class="footer">
    <div class="time">${orderTime}</div>
  </div>
</body>
</html>
  `;
}
// Generate HTML for multiple labels in a single document (batch printing)
function generateMultipleLabelsHTML(labels) {
    const formatDateTime = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');
        return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    };
    const labelHTMLs = labels.map((data) => {
        const counter = data.counter || 0;
        const itemNumber = data.itemNumber || 0;
        const totalItems = data.totalItems || 0;
        const pickupMethod = data.pickupMethod || 'dine-in';
        const productName = data.productName || '';
        const customizations = data.customizations || '';
        const labelContinuation = data.labelContinuation || '';
        const orderTime = data.orderTime ? formatDateTime(new Date(data.orderTime)) : formatDateTime(new Date());
        const pickupLabel = pickupMethod === 'dine-in' ? 'DINE IN' : 'TAKE AWAY';
        return `
    <div class="label-page">
      <div class="content">
        <div class="row">
          <div class="counter">${counter}</div>
          ${labelContinuation ? `<div class="continuation">${labelContinuation}</div>` : '<div class="continuation"></div>'}
          <div class="number">${itemNumber}/${totalItems}</div>
        </div>
        <div class="pickup">${pickupLabel}</div>
        <div class="product">${productName}</div>
        ${customizations ? `<div class="customizations">${customizations}</div>` : ''}
      </div>
      <div class="footer">
        <div class="time">${orderTime}</div>
      </div>
    </div>
    `;
    }).join('');
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    @page { 
      size: 40mm auto; 
      margin: 0;
    }
    * { 
      margin: 0; 
      padding: 0; 
      box-sizing: border-box; 
      color: black; 
    }
    body {
      font-family: 'Arial', 'Helvetica', sans-serif;
      width: 22ch;
      max-width: 22ch;
      font-size: 8pt;
      font-weight: 600;
      line-height: 1.4;
      word-wrap: break-word;
      overflow-wrap: break-word;
      color: black;
    }
    .label-page {
      padding: 3mm 0 3mm 3mm;
      display: flex;
      flex-direction: column;
      min-height: 30mm;
      page-break-after: always;
    }
    .label-page:last-child {
      page-break-after: auto;
    }
    .content {
      flex: 1;
    }
    .row {
      display: table;
      width: calc(100% + 3mm);
      table-layout: fixed;
      margin-right: -3mm;
    }
    .row > div {
      display: table-cell;
    }
    .counter {
      font-size: 9pt;
      font-weight: 700;
    }
    .pickup {
      text-align: left;
      font-size: 7pt;
      font-weight: 700;
      text-transform: uppercase;
    }
    .product {
      text-align: left;
      font-size: 7pt;
      font-weight: 600;
    }
    .customizations {
      text-align: left;
      font-size: 7pt;
      font-weight: 500;
    }
    .number {
      font-size: 9pt;
      font-weight: 700;
      text-align: right;
    }
    .continuation {
      font-size: 7pt;
      font-weight: 600;
      color: #666;
      text-align: center;
    }
    .footer {
      margin-top: auto;
      padding-top: 2mm;
    }
    .time {
      text-align: left;
      font-size: 7pt;
      font-weight: 500;
    }
  </style>
</head>
<body>
  ${labelHTMLs}
</body>
</html>
  `;
}
// Generate transaction receipt HTML
function generateReceiptHTML(data, businessName, options) {
    const marginAdjust = options?.marginAdjustMm ?? 0;
    const baseLeftPadding = 7;
    const baseRightPadding = 7;
    const leftPadding = Math.max(0, baseLeftPadding - marginAdjust);
    const rightPadding = Math.max(0, baseRightPadding + marginAdjust);
    const items = data.items || [];
    const total = data.total || data.final_amount || 0;
    const paymentMethod = data.paymentMethod || 'Cash';
    const amountReceived = data.amountReceived || 0;
    const change = data.change || 0;
    // Calculate total items for summary
    const totalItems = items.reduce((sum, item) => sum + (item.quantity || 1), 0);
    // Generate items HTML
    const itemsHTML = items.map((item) => {
        // Handle both new format (name, quantity, price, total_price) and old format (product.nama, etc.)
        const name = item.name || item.product?.nama || '';
        const qty = item.quantity || 1;
        const price = item.price || item.unit_price || 0;
        const subtotal = item.total_price || (price * qty);
        return `
      <tr>
        <td colspan="4" style="text-align: left; padding-bottom: 0.5mm;">${name}</td>
      </tr>
      <tr>
        <td style="width: 30%;"></td>
        <td style="width: 25%; text-align: right; padding-top: 0;">${price.toLocaleString('id-ID')}</td>
        <td style="width: 20%; text-align: right; padding-top: 0;">${qty}</td>
        <td style="width: 25%; text-align: right; padding-top: 0;">${subtotal.toLocaleString('id-ID')}</td>
      </tr>
    `;
    }).join('');
    // Format date as YYYY-MM-DD HH:MM:SS
    const formatDateTime = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');
        return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    };
    const currentDate = new Date(data.date || Date.now());
    const orderTime = formatDateTime(currentDate);
    const printTime = formatDateTime(new Date());
    // Determine transaction type display (DINE IN / TAKE AWAY)
    const pickupMethod = data.pickupMethod || 'dine-in';
    const isDineIn = pickupMethod === 'dine-in';
    const transactionDisplay = isDineIn ? 'DINE IN' : 'TAKE AWAY';
    const logoDataUri = getLogoBase64();
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    @page { size: 80mm auto; margin: 0; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Arial', 'Helvetica', sans-serif;
      width: 42ch;
      max-width: 42ch;
      font-size: 10pt;
      font-weight: 500;
      line-height: 1.2;
      padding: 2mm ${rightPadding.toFixed(2)}mm 2mm ${leftPadding.toFixed(2)}mm;
      word-wrap: break-word;
      overflow-wrap: break-word;
    }
    .contact { text-align: center; font-size: 8pt; font-weight: 600; margin-bottom: 1mm; }
    .logo-container { text-align: center; margin-bottom: 1mm; }
    .logo { max-width: 100%; height: auto; max-height: 18mm; }
    .store-name { text-align: center; font-size: 13pt; font-weight: bold; margin-bottom: 1mm; }
    .branch { text-align: center; font-size: 11pt; font-weight: 600; margin-bottom: 1mm; }
    .address { text-align: center; font-size: 8pt; font-weight: 500; margin-bottom: 1.5mm; max-width: 100%; line-height: 1.3; }
    .transaction-type { text-align: center; font-size: 10pt; font-weight: 700; margin-bottom: 1.5mm; }
    .dashed-line { border-top: 1px dashed #000; margin: 1.5mm 0; }
    .info-line { display: flex; justify-content: space-between; margin-bottom: 0.5mm; }
    .info-label { font-size: 9pt; font-weight: 500; }
    .info-value { font-size: 9pt; font-weight: 700; }
    .order-number-value { font-size: 9pt; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; margin: 1mm 0; font-size: 9pt; }
    th { text-align: left; font-weight: 700; border-bottom: 1px solid #000; padding: 0.5mm 0; font-size: 8pt; }
    td { padding: 0.5mm 0; font-weight: 500; }
    .summary-line { display: flex; justify-content: space-between; margin-bottom: 0.5mm; font-size: 9pt; font-weight: 500; }
    .summary-label { font-weight: 500; }
    .summary-value { font-weight: 700; }
    .footer { margin-top: 2mm; font-size: 8pt; text-align: left; line-height: 1.3; font-weight: 500; }
  </style>
</head>
<body>
  <div class="contact">silahkan hubungi: 0813-9888-8568</div>
  
  ${logoDataUri ? `<div class="logo-container"><img src="${logoDataUri}" class="logo" alt="Momoyo Logo"></div>` : '<div class="store-name">MOMOYO</div>'}
  <div class="branch">${businessName}</div>
  ${data.isReprint && data.reprintCount ? `<div class="reprint-notice" style="text-align: center; font-size: 10pt; font-weight: bold; margin: 1mm 0; color: #000;">REPRINT KE-${data.reprintCount}</div>` : ''}
  <div class="address">Jl. Kalimantan no. 21, Kartoharjo<br>Kec. Kartoharjo, Kota Madiun</div>
  
  ${(() => {
        // Choose per-printer display number: Each printer type uses its own daily counter
        // Printer 1 (receiptPrinter) uses printer1Counter from receiptPrinter counter
        // Printer 2 (receiptizePrinter) uses printer2Counter from receiptizePrinter counter
        // Fall back to globalCounter, then tableNumber, then '01'
        const isReceiptize = data.printerType === 'receiptizePrinter';
        // Prioritize per-printer counter over globalCounter to ensure each printer has its own counter
        const perPrinterCounter = isReceiptize ? data.printer2Counter : data.printer1Counter;
        // Debug: Log all available counter values
        console.log(`📄 [RECEIPT] Counter selection - printerType: ${data.printerType}, isReceiptize: ${isReceiptize}`);
        console.log(`📄 [RECEIPT] Available counters - printer1Counter: ${data.printer1Counter} (type: ${typeof data.printer1Counter}), printer2Counter: ${data.printer2Counter} (type: ${typeof data.printer2Counter}), globalCounter: ${data.globalCounter}, tableNumber: ${data.tableNumber}`);
        console.log(`📄 [RECEIPT] Selected perPrinterCounter: ${perPrinterCounter} (type: ${typeof perPrinterCounter})`);
        // Use per-printer counter if it's a valid number > 0, otherwise fall back
        let displayCounter;
        if (typeof perPrinterCounter === 'number' && perPrinterCounter > 0) {
            displayCounter = perPrinterCounter;
            console.log(`✅ [RECEIPT] Using per-printer counter: ${displayCounter}`);
        }
        else if (typeof data.globalCounter === 'number' && data.globalCounter > 0) {
            displayCounter = data.globalCounter;
            console.log(`⚠️ [RECEIPT] Per-printer counter invalid, using globalCounter: ${displayCounter}`);
        }
        else if (data.tableNumber) {
            displayCounter = data.tableNumber;
            console.log(`⚠️ [RECEIPT] Using tableNumber as fallback: ${displayCounter}`);
        }
        else {
            displayCounter = '01';
            console.log(`❌ [RECEIPT] All counters invalid, using default '01'`);
        }
        const numStr = String(displayCounter).padStart(2, '0');
        console.log(`📄 [RECEIPT] Final counter display - displayCounter: ${displayCounter}, numStr: ${numStr}, will show: ${transactionDisplay} ${numStr}`);
        return `<div class="transaction-type">${transactionDisplay} ${numStr}</div>`;
    })()}
  
  <div class="dashed-line"></div>
  
  <div class="info-line">
    <span class="info-label">Nomor Pesanan:</span>
    <span class="info-value order-number-value mono-value">${data.receiptNumber || data.id || 'N/A'}</span>
  </div>
  <div class="info-line">
    <span class="info-label">Waktu Pesanan:</span>
    <span class="info-value mono-value">${orderTime}</span>
  </div>
  <div class="info-line">
    <span class="info-label">Waktu Print:</span>
    <span class="info-value mono-value">${printTime}</span>
  </div>
  <div class="info-line">
    <span class="info-label">Operator Kasir:</span>
    <span class="info-value">${data.cashier || 'N/A'}</span>
  </div>
  <div class="info-line">
    <span class="info-label">Saluran:</span>
    <span class="info-value">Toko Offline</span>
  </div>
  
  <div class="dashed-line"></div>
  
  <table>
    <tr>
      <th style="width: 30%;">Nama Produk</th>
      <th style="width: 25%; text-align: right;">Harga</th>
      <th style="width: 20%; text-align: right;">Jumlah</th>
      <th style="width: 25%; text-align: right;">Subtotal</th>
    </tr>
    ${itemsHTML}
  </table>
  
  <div class="dashed-line"></div>
  
  <div class="summary-line">
    <span class="summary-label">Total Pesanan:</span>
    <span class="summary-value">${totalItems}</span>
  </div>
  <div class="summary-line">
    <span class="summary-label">Total Harga:</span>
    <span class="summary-value">${total.toLocaleString('id-ID')}</span>
  </div>
  <div class="summary-line">
    <span class="summary-label">Nominal Pendapatan:</span>
    <span class="summary-value">${total.toLocaleString('id-ID')}</span>
  </div>
  
  <div class="dashed-line"></div>
  
  <div class="summary-line">
    <span class="summary-label">Metode Pembayaran:</span>
    <span class="summary-value">${paymentMethod}</span>
  </div>
  ${amountReceived > 0 ? `
  <div class="summary-line">
    <span class="summary-label">Bayar Jumlah:</span>
    <span class="summary-value">${amountReceived.toLocaleString('id-ID')}</span>
  </div>
  <div class="summary-line">
    <span class="summary-label">Kembali Uang Kecil:</span>
    <span class="summary-value">${change.toLocaleString('id-ID')}</span>
  </div>
  ` : ''}
  <div class="summary-line">
    <span class="summary-label">Pembayaran Sebenarnya:</span>
    <span class="summary-value">${total.toLocaleString('id-ID')}</span>
  </div>
  
  <div class="dashed-line"></div>
  
  <div class="footer">
    <p>Pendapat Anda sangat penting bagi kami.</p>
    <p>Untuk kritik dan saran silahkan hubungi :</p>
    <p>0812-1822-2666</p>
    <p style="margin-top: 2mm;">Untuk layanan kemitraan dan partnership</p>
  </div>
</body>
</html>
  `;
}
// Generate shift breakdown report HTML for printing
function generateShiftBreakdownHTML(shiftData) {
    const formatDateTime = (dateString) => {
        const date = new Date(dateString);
        const gmt7Date = new Date(date.getTime() + (7 * 60 * 60 * 1000));
        const year = gmt7Date.getUTCFullYear();
        const month = String(gmt7Date.getUTCMonth() + 1).padStart(2, '0');
        const day = String(gmt7Date.getUTCDate()).padStart(2, '0');
        const hours = String(gmt7Date.getUTCHours()).padStart(2, '0');
        const minutes = String(gmt7Date.getUTCMinutes()).padStart(2, '0');
        const seconds = String(gmt7Date.getUTCSeconds()).padStart(2, '0');
        return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    };
    const formatCurrency = (value) => {
        return new Intl.NumberFormat('id-ID', {
            style: 'currency',
            currency: 'IDR',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
        }).format(value);
    };
    const formatPlatformLabel = (platform) => {
        const key = (platform || 'offline').toLowerCase();
        switch (key) {
            case 'offline':
                return 'Offline';
            case 'gofood':
                return 'GoFood';
            case 'grabfood':
                return 'GrabFood';
            case 'shopeefood':
                return 'ShopeeFood';
            case 'qpon':
                return 'Qpon';
            case 'tiktok':
                return 'TikTok';
            default:
                return key.charAt(0).toUpperCase() + key.slice(1);
        }
    };
    const formatTransactionLabel = (transactionType) => {
        return transactionType === 'bakery' ? 'Bakery' : 'Drinks';
    };
    const printTime = formatDateTime(new Date().toISOString());
    const renderReportSection = (report, options = {}) => {
        const sectionTitle = options.titleOverride || report.title || 'LAPORAN SHIFT';
        const businessName = options.businessName || shiftData.businessName || 'Momoyo Bakery Kalimantan';
        // Use sectionOptions from options directly if provided, otherwise use defaults
        // This ensures we respect false values from the caller
        const providedSectionOptions = options.sectionOptions;
        // Debug logging
        writeDebugLog(JSON.stringify({
            location: 'electron/main.ts:8453',
            message: 'RENDER SECTION - Options sectionOptions',
            data: options.sectionOptions,
            timestamp: Date.now(),
            sessionId: 'debug-session',
            runId: 'post-fix',
            hypothesisId: 'C'
        }));
        console.log('🔍 [RENDER SECTION] Options sectionOptions:', JSON.stringify(options.sectionOptions));
        console.log('🔍 [RENDER SECTION] Using provided options directly:', providedSectionOptions !== undefined && providedSectionOptions !== null);
        const sectionOptions = providedSectionOptions ? {
            barangTerjual: providedSectionOptions.barangTerjual !== undefined ? providedSectionOptions.barangTerjual : true,
            paymentMethod: providedSectionOptions.paymentMethod !== undefined ? providedSectionOptions.paymentMethod : true,
            categoryII: providedSectionOptions.categoryII !== undefined ? providedSectionOptions.categoryII : true,
            toppingSales: providedSectionOptions.toppingSales !== undefined ? providedSectionOptions.toppingSales : true,
            diskonVoucher: providedSectionOptions.diskonVoucher !== undefined ? providedSectionOptions.diskonVoucher : true
        } : {
            barangTerjual: true,
            paymentMethod: true,
            categoryII: true,
            toppingSales: true,
            diskonVoucher: true
        };
        // Debug logging
        writeDebugLog(JSON.stringify({
            location: 'electron/main.ts:8475',
            message: 'RENDER SECTION - Final resolved sectionOptions',
            data: sectionOptions,
            timestamp: Date.now(),
            sessionId: 'debug-session',
            runId: 'post-fix',
            hypothesisId: 'C'
        }));
        writeDebugLog(JSON.stringify({
            location: 'electron/main.ts:8476',
            message: 'RENDER SECTION - Check values',
            data: {
                barangTerjual: sectionOptions.barangTerjual,
                barangTerjualType: typeof sectionOptions.barangTerjual,
                barangTerjualEqualTrue: sectionOptions.barangTerjual === true
            },
            timestamp: Date.now(),
            sessionId: 'debug-session',
            runId: 'post-fix',
            hypothesisId: 'C'
        }));
        console.log('🔍 [RENDER SECTION] Final resolved sectionOptions:', JSON.stringify(sectionOptions));
        console.log('🔍 [RENDER SECTION] barangTerjual value:', sectionOptions.barangTerjual, 'type:', typeof sectionOptions.barangTerjual, '=== true:', sectionOptions.barangTerjual === true);
        const shiftStartTime = formatDateTime(report.shift_start);
        const shiftEndTime = report.shift_end ? formatDateTime(report.shift_end) : 'Masih Berlangsung';
        const sortedProducts = [...report.productSales].sort((a, b) => {
            const aIsBundle = Boolean(a.is_bundle_item);
            const bIsBundle = Boolean(b.is_bundle_item);
            if (aIsBundle && !bIsBundle)
                return 1;
            if (!aIsBundle && bIsBundle)
                return -1;
            return 0;
        });
        const productRows = sortedProducts.map(product => {
            try {
                const quantity = product.total_quantity || 0;
                const baseSubtotal = product.base_subtotal ?? (product.total_subtotal - product.customization_subtotal);
                // Always calculate unit price from baseSubtotal/quantity (excludes customizations)
                const unitPrice = quantity > 0 ? baseSubtotal / quantity : 0;
                const platformLabel = formatPlatformLabel(product.platform);
                const transactionLabel = formatTransactionLabel(product.transaction_type);
                const isBundleItem = Boolean(product.is_bundle_item);
                // Validate numeric values
                if (isNaN(quantity) || isNaN(baseSubtotal) || isNaN(unitPrice)) {
                    console.error(`❌ [HTML GEN] Invalid numbers in product: ${product.product_name}`, {
                        quantity, baseSubtotal, unitPrice
                    });
                }
                if (isBundleItem) {
                    console.log(`[SHIFT PRINT] Displaying bundle item: ${product.product_name}, is_bundle_item: ${product.is_bundle_item}`);
                }
                const productNameDisplay = isBundleItem
                    ? `<span style="font-size: 4.8pt;">(Bundle)</span> ${product.product_name}`
                    : product.product_name;
                return `
      <tr>
        <td style="text-align: left; padding: 0.3mm 0;">
          <div>${productNameDisplay}</div>
          <div style="font-size: 7pt; color: #555;">${transactionLabel} · ${platformLabel}</div>
        </td>
        <td style="text-align: right; padding: 0.3mm 0;">${quantity}</td>
        <td style="text-align: right; padding: 0.3mm 0;">${isBundleItem ? '-' : (isNaN(unitPrice) ? '0' : Number(unitPrice).toLocaleString('id-ID'))}</td>
        <td style="text-align: right; padding: 0.3mm 0;">${isBundleItem ? '-' : (isNaN(baseSubtotal) ? '0' : Number(baseSubtotal).toLocaleString('id-ID'))}</td>
      </tr>
      `;
            }
            catch (productError) {
                console.error(`❌ [HTML GEN] Error processing product:`, product, productError);
                return `<tr><td colspan="4">Error processing product: ${product?.product_name || 'Unknown'}</td></tr>`;
            }
        }).join('');
        const regularProducts = report.productSales.filter((p) => !p.is_bundle_item);
        const totalProductQty = report.productSales.reduce((sum, p) => sum + Number(p.total_quantity || 0), 0);
        const totalProductBaseSubtotal = regularProducts.reduce((sum, p) => {
            const baseSubtotal = p.base_subtotal ?? (Number(p.total_subtotal || 0) - Number(p.customization_subtotal || 0));
            return sum + Number(baseSubtotal || 0);
        }, 0);
        const customizationRows = report.customizationSales.map(item => {
            try {
                const quantity = item.total_quantity || 0;
                const revenue = item.total_revenue || 0;
                if (isNaN(quantity) || isNaN(revenue)) {
                    console.error(`❌ [HTML GEN] Invalid numbers in customization: ${item.option_name}`, {
                        quantity, revenue
                    });
                }
                return `
      <tr>
        <td style="text-align: left; padding: 0.3mm 0;">
          <div>${item.option_name || 'Unknown'}</div>
          <div style="font-size: 7pt; color: #555;">${item.customization_name || 'N/A'}</div>
        </td>
        <td style="text-align: right; padding: 0.3mm 0;">${isNaN(quantity) ? '0' : quantity}</td>
        <td style="text-align: right; padding: 0.3mm 0;">${isNaN(revenue) ? '0' : Number(revenue).toLocaleString('id-ID')}</td>
      </tr>
    `;
            }
            catch (customizationError) {
                console.error(`❌ [HTML GEN] Error processing customization:`, item, customizationError);
                return `<tr><td colspan="3">Error processing customization</td></tr>`;
            }
        }).join('');
        const totalCustomizationUnits = report.customizationSales.reduce((sum, item) => sum + Number(item.total_quantity || 0), 0);
        const totalCustomizationRevenue = report.customizationSales.reduce((sum, item) => sum + Number(item.total_revenue || 0), 0);
        const paymentRows = report.paymentBreakdown.map(payment => {
            const amount = Number(payment.total_amount || 0);
            const count = Number(payment.transaction_count || 0);
            return `
      <tr>
        <td style="text-align: left; padding: 0.3mm 0;">${payment.payment_method_name || 'N/A'}</td>
        <td style="text-align: right; padding: 0.3mm 0;">${count}</td>
        <td style="text-align: right; padding: 0.3mm 0;">${amount.toLocaleString('id-ID')}</td>
      </tr>
    `;
        }).join('');
        const totalPaymentCount = report.paymentBreakdown.reduce((sum, p) => sum + Number(p.transaction_count || 0), 0);
        const totalPaymentAmount = report.paymentBreakdown.reduce((sum, p) => sum + Number(p.total_amount || 0), 0);
        const category2Data = report.category2Breakdown || [];
        const category2Rows = category2Data.map((category2) => {
            const quantity = Number(category2.total_quantity || 0);
            const amount = Number(category2.total_amount || 0);
            return `
      <tr>
        <td style="text-align: left; padding: 0.3mm 0;">${category2.category2_name || 'N/A'}</td>
        <td style="text-align: right; padding: 0.3mm 0;">${quantity}</td>
        <td style="text-align: right; padding: 0.3mm 0;">${amount.toLocaleString('id-ID')}</td>
      </tr>
    `;
        }).join('');
        const totalCategory2Quantity = (report.category2Breakdown || []).reduce((sum, c) => sum + Number(c.total_quantity || 0), 0);
        const totalCategory2Amount = (report.category2Breakdown || []).reduce((sum, c) => sum + Number(c.total_amount || 0), 0);
        const formattedTotalDiscount = report.statistics.total_discount > 0
            ? formatCurrency(-Math.abs(report.statistics.total_discount))
            : formatCurrency(0);
        const cashSummaryData = report.cashSummary;
        const cashShiftSales = Number(cashSummaryData.cash_shift_sales ?? cashSummaryData.cash_shift ?? 0) || 0;
        const cashShiftRefunds = Number(cashSummaryData.cash_shift_refunds ?? 0) || 0;
        const cashWholeDaySales = Number(cashSummaryData.cash_whole_day_sales ?? cashSummaryData.cash_whole_day ?? 0) || 0;
        const cashWholeDayRefunds = Number(cashSummaryData.cash_whole_day_refunds ?? 0) || 0;
        const cashNetShift = Number(cashSummaryData.cash_shift) || (cashShiftSales - cashShiftRefunds);
        const cashNetWholeDay = Number(cashSummaryData.cash_whole_day) || (cashWholeDaySales - cashWholeDayRefunds);
        // Ensure all values are numbers and handle NaN
        const kasMulaiSummary = Number(cashSummaryData.kas_mulai ?? report.modal_awal ?? 0) || 0;
        const kasExpectedSummary = Number(cashSummaryData.kas_expected) || (kasMulaiSummary + cashShiftSales - cashShiftRefunds);
        const kasAkhirSummary = typeof cashSummaryData.kas_akhir === 'number' && !isNaN(cashSummaryData.kas_akhir) ? cashSummaryData.kas_akhir : null;
        let kasSelisihSummary = typeof cashSummaryData.kas_selisih === 'number' && !isNaN(cashSummaryData.kas_selisih)
            ? cashSummaryData.kas_selisih
            : kasAkhirSummary !== null && !isNaN(kasExpectedSummary)
                ? Number((kasAkhirSummary - kasExpectedSummary).toFixed(2))
                : null;
        let kasSelisihLabelSummary = cashSummaryData.kas_selisih_label ?? null;
        if (kasSelisihSummary !== null && !isNaN(kasSelisihSummary)) {
            if (Math.abs(kasSelisihSummary) < 0.01) {
                kasSelisihSummary = 0;
                kasSelisihLabelSummary = 'balanced';
            }
            else if (!kasSelisihLabelSummary) {
                kasSelisihLabelSummary = kasSelisihSummary > 0 ? 'plus' : 'minus';
            }
        }
        const varianceLabelDisplay = kasSelisihLabelSummary === 'plus'
            ? 'Plus'
            : kasSelisihLabelSummary === 'minus'
                ? 'Minus'
                : kasSelisihLabelSummary === 'balanced'
                    ? 'Balanced'
                    : 'Pending';
        const varianceValueDisplay = kasSelisihSummary === null || isNaN(kasSelisihSummary)
            ? '-'
            : `${kasSelisihSummary > 0 ? '+' : ''}${kasSelisihSummary.toLocaleString('id-ID')}`;
        const kasAkhirDisplay = kasAkhirSummary !== null && !isNaN(kasAkhirSummary) ? kasAkhirSummary.toLocaleString('id-ID') : '-';
        const totalCashInCashierValue = Number(cashSummaryData.total_cash_in_cashier) || kasExpectedSummary;
        const totalCashInCashierDisplay = !isNaN(totalCashInCashierValue) ? totalCashInCashierValue.toLocaleString('id-ID') : '-';
        return `
    <div class="report-block">
      <div class="header">
        <div class="title">${sectionTitle}</div>
        <div class="business-name">${businessName}</div>
      </div>

      <div class="divider"></div>

      <div class="info-line">
        <span class="info-label">Cashier:</span>
        <span class="info-value">${report.user_name}</span>
      </div>
      <div class="info-line">
        <span class="info-label">Shift Start:</span>
        <span class="info-value">${shiftStartTime}</span>
      </div>
      <div class="info-line">
        <span class="info-label">Shift End:</span>
        <span class="info-value">${shiftEndTime}</span>
      </div>
      <div class="info-line">
        <span class="info-label">Modal Awal:</span>
        <span class="info-value">${report.modal_awal.toLocaleString('id-ID')}</span>
      </div>

      <div class="divider"></div>

      <div class="section-title">RINGKASAN</div>
      <div class="summary">
        <div class="summary-line">
          <span class="summary-label">Total Pesanan:</span>
          <span class="summary-value">${report.statistics.order_count}</span>
        </div>
        <div class="summary-line">
          <span class="summary-label">Total Transaksi:</span>
          <span class="summary-value">${Number(report.statistics.total_amount || 0).toLocaleString('id-ID')}</span>
        </div>
        <div class="summary-line">
          <span class="summary-label">Total Topping:</span>
          <span class="summary-value">${totalCustomizationRevenue.toLocaleString('id-ID')}</span>
        </div>
        <div class="summary-line">
          <span class="summary-label">Voucher Dipakai:</span>
          <span class="summary-value">${report.statistics.voucher_count}</span>
        </div>
        <div class="summary-line">
          <span class="summary-label">Total Diskon Voucher:</span>
          <span class="summary-value">${formattedTotalDiscount}</span>
        </div>
        <div class="summary-line">
          <span class="summary-label">Kas Mulai:</span>
          <span class="summary-value">${kasMulaiSummary.toLocaleString('id-ID')}</span>
        </div>
        <div class="summary-line">
          <span class="summary-label">Cash Sales (Shift):</span>
          <span class="summary-value">${cashShiftSales.toLocaleString('id-ID')}</span>
        </div>
        <div class="summary-line">
          <span class="summary-label">Cash Refunds (Shift):</span>
          <span class="summary-value">-${cashShiftRefunds.toLocaleString('id-ID')}</span>
        </div>
        <div class="summary-line">
          <span class="summary-label">Net Cash (Shift):</span>
          <span class="summary-value">${cashNetShift.toLocaleString('id-ID')}</span>
        </div>
        <div class="summary-line">
          <span class="summary-label">Kas Diharapkan:</span>
          <span class="summary-value">${!isNaN(kasExpectedSummary) ? kasExpectedSummary.toLocaleString('id-ID') : '-'}</span>
        </div>
        <div class="summary-line">
          <span class="summary-label">Kas Akhir:</span>
          <span class="summary-value">${kasAkhirDisplay}</span>
        </div>
        <div class="summary-line">
          <span class="summary-label">Selisih (${varianceLabelDisplay}):</span>
          <span class="summary-value">${varianceValueDisplay}</span>
        </div>
        <div class="summary-line">
          <span class="summary-label">Cash Sales (Hari):</span>
          <span class="summary-value">${cashWholeDaySales.toLocaleString('id-ID')}</span>
        </div>
        <div class="summary-line">
          <span class="summary-label">Cash Refunds (Hari):</span>
          <span class="summary-value">-${cashWholeDayRefunds.toLocaleString('id-ID')}</span>
        </div>
        <div class="summary-line">
          <span class="summary-label">Net Cash (Hari):</span>
          <span class="summary-value">${cashNetWholeDay.toLocaleString('id-ID')}</span>
        </div>
        <div class="summary-line">
          <span class="summary-label">Cash in Cashier:</span>
          <span class="summary-value">${totalCashInCashierDisplay}</span>
        </div>
      </div>

      <div class="divider"></div>

      ${sectionOptions.barangTerjual === true ? `
      <div class="section-title">BARANG TERJUAL</div>
      <table>
        <thead>
          <tr>
            <th>Product</th>
            <th class="right">Qty</th>
            <th class="right">Unit Price</th>
            <th class="right">Subtotal</th>
          </tr>
        </thead>
        <tbody>
          ${productRows || '<tr><td colSpan="4" style="text-align: center;">Tidak ada produk</td></tr>'}
          <tr class="total-row">
            <td>TOTAL</td>
            <td class="right">${totalProductQty}</td>
            <td class="right">-</td>
            <td class="right">${Number(totalProductBaseSubtotal).toLocaleString('id-ID')}</td>
          </tr>
        </tbody>
      </table>

      <div class="divider"></div>
      ` : ''}

      ${sectionOptions.paymentMethod === true ? `
      <div class="section-title">PAYMENT METHOD</div>
      <table>
        <thead>
          <tr>
            <th>Payment Method</th>
            <th class="right">Count</th>
            <th class="right">Total</th>
          </tr>
        </thead>
        <tbody>
          ${paymentRows || '<tr><td colSpan="3" style="text-align: center;">Tidak ada transaksi</td></tr>'}
          <tr class="total-row">
            <td>TOTAL</td>
            <td class="right">${totalPaymentCount}</td>
            <td class="right">${Number(totalPaymentAmount).toLocaleString('id-ID')}</td>
          </tr>
        </tbody>
      </table>

      <div class="divider"></div>
      ` : ''}

      ${sectionOptions.categoryII === true ? `
      <div class="section-title">CATEGORY II</div>
      <table>
        <thead>
          <tr>
            <th>Category II</th>
            <th class="right">Quantity</th>
            <th class="right">Total</th>
          </tr>
        </thead>
        <tbody>
          ${category2Rows || '<tr><td colSpan="3" style="text-align: center;">Tidak ada Category II</td></tr>'}
          <tr class="total-row">
            <td>TOTAL</td>
            <td class="right">${totalCategory2Quantity}</td>
            <td class="right">${Number(totalCategory2Amount).toLocaleString('id-ID')}</td>
          </tr>
        </tbody>
      </table>

      <div class="divider"></div>
      ` : ''}

      ${sectionOptions.toppingSales === true ? `
      <div class="section-title">TOPPING SALES BREAKDOWN</div>
      <table>
        <thead>
          <tr>
            <th>Customization</th>
            <th class="right">Qty</th>
            <th class="right">Revenue</th>
          </tr>
        </thead>
        <tbody>
          ${customizationRows || '<tr><td colSpan="3" style="text-align: center;">Tidak ada kustomisasi</td></tr>'}
          <tr class="total-row">
            <td>TOTAL</td>
            <td class="right">${totalCustomizationUnits}</td>
            <td class="right">${Number(totalCustomizationRevenue).toLocaleString('id-ID')}</td>
          </tr>
        </tbody>
      </table>

      <div class="divider"></div>
      ` : ''}

      ${sectionOptions.diskonVoucher === true ? `
      <div class="section-title">DISKON & VOUCHER</div>
      <table>
        <tbody>
          <tr>
            <td style="text-align: left; padding: 0.3mm 0;">Voucher Digunakan</td>
            <td class="right">${report.statistics.voucher_count}</td>
          </tr>
          <tr>
            <td style="text-align: left; padding: 0.3mm 0;">Total Diskon Voucher</td>
            <td class="right">${formattedTotalDiscount}</td>
          </tr>
        </tbody>
      </table>
      ` : ''}
    </div>
    `;
    };
    const sections = [];
    const defaultSectionOptions = {
        barangTerjual: true,
        paymentMethod: true,
        categoryII: true,
        toppingSales: true,
        diskonVoucher: true
    };
    // Respect false values - only use defaults if sectionOptions is not provided at all
    const sectionOptions = shiftData.sectionOptions ? {
        barangTerjual: shiftData.sectionOptions.barangTerjual !== undefined ? shiftData.sectionOptions.barangTerjual : defaultSectionOptions.barangTerjual,
        paymentMethod: shiftData.sectionOptions.paymentMethod !== undefined ? shiftData.sectionOptions.paymentMethod : defaultSectionOptions.paymentMethod,
        categoryII: shiftData.sectionOptions.categoryII !== undefined ? shiftData.sectionOptions.categoryII : defaultSectionOptions.categoryII,
        toppingSales: shiftData.sectionOptions.toppingSales !== undefined ? shiftData.sectionOptions.toppingSales : defaultSectionOptions.toppingSales,
        diskonVoucher: shiftData.sectionOptions.diskonVoucher !== undefined ? shiftData.sectionOptions.diskonVoucher : defaultSectionOptions.diskonVoucher
    } : defaultSectionOptions;
    // Debug logging
    writeDebugLog(JSON.stringify({
        location: 'electron/main.ts:8839',
        message: 'GENERATE HTML - Section options',
        data: sectionOptions,
        timestamp: Date.now(),
        sessionId: 'debug-session',
        runId: 'post-fix',
        hypothesisId: 'B'
    }));
    console.log('🔍 [GENERATE HTML] Section options:', JSON.stringify(sectionOptions));
    sections.push(renderReportSection(shiftData, {
        titleOverride: shiftData.title || 'LAPORAN SHIFT',
        businessName: shiftData.businessName,
        sectionOptions: sectionOptions
    }));
    if (shiftData.wholeDayReport) {
        sections.push(renderReportSection(shiftData.wholeDayReport, {
            titleOverride: shiftData.wholeDayReport.title || 'RINGKASAN HARIAN',
            businessName: shiftData.businessName,
            sectionOptions: sectionOptions
        }));
    }
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    @page { size: 80mm auto; margin: 0; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Arial', 'Helvetica', sans-serif;
      width: 42ch;
      max-width: 42ch;
      font-size: 9pt;
      font-weight: 500;
      line-height: 1.2;
      padding: 2mm 7mm;
      word-wrap: break-word;
      overflow-wrap: break-word;
    }
    .report-block + .report-block {
      margin-top: 3mm;
      padding-top: 3mm;
      border-top: 1px dashed #000;
    }
    .header {
      text-align: center;
      margin-bottom: 2mm;
    }
    .title {
      font-size: 11pt;
      font-weight: 700;
      margin-bottom: 0.5mm;
    }
    .business-name {
      font-size: 10pt;
      font-weight: 600;
      margin-bottom: 0mm;
    }
    .divider {
      border-top: 1px dashed #000;
      margin: 1.5mm 0;
    }
    .info-line {
      display: flex;
      justify-content: space-between;
      margin-bottom: 0.5mm;
      font-size: 8pt;
    }
    .info-label {
      font-weight: 500;
    }
    .info-value {
      font-weight: 700;
    }
    .section-title {
      font-size: 9pt;
      font-weight: 700;
      margin: 1.5mm 0 1mm 0;
      text-align: center;
      text-decoration: underline;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 1mm 0;
      font-size: 8pt;
    }
    th {
      text-align: left;
      font-weight: 700;
      border-bottom: 1px solid #000;
      padding: 0.5mm 0;
      font-size: 8pt;
    }
    th.right, td.right {
      text-align: right;
    }
    td {
      padding: 0.5mm 0;
      font-weight: 500;
    }
    .total-row {
      border-top: 2px solid #000;
      font-weight: 700;
      background-color: #f0f0f0;
    }
    .summary {
      margin-top: 1.5mm;
      font-size: 8pt;
    }
    .summary-line {
      display: flex;
      justify-content: space-between;
      margin-bottom: 0.5mm;
    }
    .summary-label {
      font-weight: 500;
    }
    .summary-value {
      font-weight: 700;
    }
    /* Prevent table headers from repeating on every page */
    @media print {
      thead {
        display: table-row-group;
      }
    }
  </style>
</head>
<body>
  ${sections.join('')}

  <div class="divider"></div>

  <div class="info-line" style="margin-top: 1mm;">
    <span class="info-label">Waktu Print:</span>
    <span class="info-value">${printTime}</span>
  </div>
</body>
</html>
  `;
}
// Print shift breakdown report
electron_1.ipcMain.handle('print-shift-breakdown', async (event, data) => {
    try {
        console.log('🖨️ [SHIFT PRINT] Starting shift breakdown print...');
        console.log('   - Shift:', data.user_name);
        console.log('   - Products:', data.productSales?.length || 0);
        console.log('   - Customizations:', data.customizationSales?.length || 0);
        console.log('   - Payments:', data.paymentBreakdown?.length || 0);
        console.log('   - Orders:', data.statistics?.order_count || 0);
        console.log('   - Printer Type:', data.printerType);
        let printerName = null;
        const printerType = data.printerType || 'receiptPrinter';
        console.log('🔍 [SHIFT PRINT] Looking up printer config for type:', printerType);
        // Get printer name from config
        try {
            // First, list ALL printer configs for debugging
            const allConfigs = await (0, mysqlDb_1.executeQuery)('SELECT * FROM printer_configs');
            console.log('📋 [SHIFT PRINT] All printer configs in database:');
            allConfigs.forEach((cfg) => {
                console.log(`   - Type: ${cfg.printer_type}, Name: "${cfg.system_printer_name}"`);
            });
            const config = await (0, mysqlDb_1.executeQueryOne)('SELECT * FROM printer_configs WHERE printer_type = ?', [printerType]);
            console.log('📋 [SHIFT PRINT] Printer config query result:', config ? JSON.stringify(config) : 'null');
            if (config && config.system_printer_name) {
                printerName = config.system_printer_name.trim();
                console.log('✅ [SHIFT PRINT] Found printer config:', printerName);
                // Validate printer name is not empty after trim
                if (!printerName || printerName.length === 0) {
                    console.error('❌ [SHIFT PRINT] Printer name is empty after trim');
                    return {
                        success: false,
                        error: 'Printer name is empty. Please reconfigure your printer in Settings → Printer Selector.'
                    };
                }
            }
            else {
                console.error('❌ [SHIFT PRINT] No printer config found or system_printer_name is null');
                console.log('   - Config exists:', !!config);
                console.log('   - system_printer_name:', config?.system_printer_name);
                return {
                    success: false,
                    error: `Receipt Printer not configured. Please configure it in Settings → Printer Selector.`
                };
            }
        }
        catch (error) {
            console.error('❌ [SHIFT PRINT] Error fetching printer config:', error);
            return { success: false, error: 'Failed to fetch printer configuration' };
        }
        // Double-check printer name is valid before proceeding
        if (!printerName || typeof printerName !== 'string' || printerName.trim().length === 0) {
            console.error('❌ [SHIFT PRINT] Invalid printer name:', printerName);
            return {
                success: false,
                error: 'Invalid printer name. Please reconfigure your printer in Settings → Printer Selector.'
            };
        }
        console.log('🖨️ [SHIFT PRINT] Final deviceName to be used:', printerName);
        // Verify printer exists in system
        try {
            const printers = await mainWindow?.webContents.getPrintersAsync() || [];
            console.log('🖨️ [SHIFT PRINT] Available system printers:', printers.map(p => p.name));
            const printerExists = printers.some(p => p.name === printerName);
            if (!printerExists) {
                console.error('❌ [SHIFT PRINT] Printer not found in system!');
                console.error(`   - Looking for: "${printerName}"`);
                console.error(`   - Available: ${printers.map(p => `"${p.name}"`).join(', ')}`);
                const suggestion = printers.length > 0
                    ? `\n\nAvailable printers:\n${printers.map(p => `  - ${p.name}`).join('\n')}\n\nPlease select one of these in Settings → Printer Selector.`
                    : '\n\nNo printers detected in Windows. Please check Windows printer settings.';
                return {
                    success: false,
                    error: `Printer "${printerName}" not found.${suggestion}`
                };
            }
            console.log('✅ [SHIFT PRINT] Printer verified in system');
        }
        catch (printerCheckError) {
            console.warn('⚠️ [SHIFT PRINT] Could not verify printer list:', printerCheckError);
            // Continue anyway - the print attempt will fail with proper error if needed
        }
        // Fetch business name
        let businessName = 'Momoyo Bakery Kalimantan';
        if (data.business_id) {
            try {
                const business = await (0, mysqlDb_1.executeQueryOne)('SELECT name FROM businesses WHERE id = ?', [data.business_id]);
                if (business) {
                    businessName = business.name;
                }
            }
            catch (error) {
                console.error('Error fetching business name:', error);
            }
        }
        // Validate data before HTML generation
        console.log('🔍 [SHIFT PRINT] Validating data...');
        try {
            // Log data structure for debugging
            console.log('   - productSales count:', data.productSales?.length || 0);
            console.log('   - customizationSales count:', data.customizationSales?.length || 0);
            console.log('   - paymentBreakdown count:', data.paymentBreakdown?.length || 0);
            console.log('   - cashSummary:', JSON.stringify(data.cashSummary));
            // Check for problematic data
            if (data.productSales) {
                const invalidProducts = data.productSales.filter((p) => !p.product_name ||
                    typeof p.total_quantity !== 'number' ||
                    isNaN(p.total_quantity));
                if (invalidProducts.length > 0) {
                    console.error('❌ [SHIFT PRINT] Found invalid products:', invalidProducts);
                }
            }
            if (data.customizationSales) {
                const invalidCustomizations = data.customizationSales.filter((c) => !c.option_name ||
                    typeof c.total_quantity !== 'number' ||
                    isNaN(c.total_quantity));
                if (invalidCustomizations.length > 0) {
                    console.error('❌ [SHIFT PRINT] Found invalid customizations:', invalidCustomizations);
                }
            }
            // Check cash summary for NaN values
            if (data.cashSummary) {
                const cashKeys = Object.keys(data.cashSummary);
                for (const key of cashKeys) {
                    const value = data.cashSummary[key];
                    if (typeof value === 'number' && isNaN(value)) {
                        console.error(`❌ [SHIFT PRINT] NaN detected in cashSummary.${key}`);
                    }
                }
            }
            console.log('✅ [SHIFT PRINT] Data validation passed');
        }
        catch (validationError) {
            console.error('❌ [SHIFT PRINT] Data validation error:', validationError);
        }
        // Generate HTML with error handling
        let htmlContent;
        try {
            console.log('🎨 [SHIFT PRINT] Generating HTML...');
            // Debug logging
            writeDebugLog(JSON.stringify({
                location: 'electron/main.ts:9191',
                message: 'PRINT HANDLER - Received sectionOptions',
                data: data.sectionOptions,
                timestamp: Date.now(),
                sessionId: 'debug-session',
                runId: 'post-fix',
                hypothesisId: 'A'
            }));
            console.log('🔍 [PRINT HANDLER] Received sectionOptions:', JSON.stringify(data.sectionOptions));
            htmlContent = generateShiftBreakdownHTML({
                ...data,
                productSales: data.productSales || [],
                customizationSales: data.customizationSales || [],
                paymentBreakdown: data.paymentBreakdown || [],
                category2Breakdown: data.category2Breakdown || [],
                cashSummary: data.cashSummary,
                wholeDayReport: data.wholeDayReport || null,
                businessName,
                sectionOptions: data.sectionOptions
            });
            console.log('✅ [SHIFT PRINT] HTML generation successful');
        }
        catch (htmlError) {
            console.error('❌ [SHIFT PRINT] HTML generation failed:', htmlError);
            console.error('   Error stack:', htmlError.stack);
            return {
                success: false,
                error: `HTML generation failed: ${String(htmlError)}`
            };
        }
        const htmlSizeKB = (htmlContent.length / 1024).toFixed(2);
        console.log(`📄 [SHIFT PRINT] Generated HTML size: ${htmlSizeKB} KB (${htmlContent.length} chars)`);
        if (htmlContent.length > 500000) { // > 500KB
            console.warn(`⚠️ [SHIFT PRINT] Large print job detected! This may cause printing issues.`);
        }
        // Close existing print window if any
        if (printWindow) {
            console.log('🗑️ [SHIFT PRINT] Closing existing print window');
            printWindow.close();
        }
        // Create new print window
        console.log('🪟 [SHIFT PRINT] Creating print window');
        try {
            printWindow = new electron_1.BrowserWindow({
                width: 400,
                height: 600,
                show: false,
                webPreferences: {
                    nodeIntegration: false,
                    contextIsolation: true,
                }
            });
        }
        catch (windowError) {
            console.error('❌ [SHIFT PRINT] Failed to create print window:', windowError);
            return { success: false, error: `Failed to create print window: ${String(windowError)}` };
        }
        console.log('📝 [SHIFT PRINT] Loading HTML into print window...');
        try {
            await printWindow.loadURL(`data:text/html,${encodeURIComponent(htmlContent)}`);
            console.log('✅ [SHIFT PRINT] HTML loaded successfully');
        }
        catch (loadError) {
            console.error('❌ [SHIFT PRINT] Failed to load HTML:', loadError);
            if (printWindow && !printWindow.isDestroyed()) {
                printWindow.close();
                printWindow = null;
            }
            return { success: false, error: `Failed to load HTML: ${String(loadError)}` };
        }
        const printOptions = {
            silent: true,
            printBackground: false,
            deviceName: printerName,
        };
        console.log('🖨️ [SHIFT PRINT] Print options:', JSON.stringify(printOptions, null, 2));
        console.log('   - deviceName type:', typeof printerName);
        console.log('   - deviceName length:', printerName?.length || 0);
        console.log('   - deviceName value:', `"${printerName}"`);
        // Use callback-based print to properly wait for completion and catch errors
        return new Promise((resolve) => {
            const currentWindow = printWindow;
            setTimeout(() => {
                try {
                    if (!currentWindow || currentWindow.isDestroyed()) {
                        console.error('❌ [SHIFT PRINT] Print window not available');
                        resolve({ success: false, error: 'Print window unavailable' });
                        return;
                    }
                    currentWindow.webContents.print(printOptions, (success, errorType) => {
                        if (success) {
                            console.log('✅ [SHIFT PRINT] Shift breakdown printed successfully');
                            resolve({ success: true });
                        }
                        else {
                            console.error('❌ [SHIFT PRINT] Print failed:', errorType);
                            console.error('   - deviceName used:', printerName);
                            let userFriendlyError = errorType || 'Print failed';
                            // Provide helpful error messages
                            if (errorType && errorType.toLowerCase().includes('devicename')) {
                                userFriendlyError = `Invalid printer: "${printerName}". Please:\n1. Go to Settings → Printer Selector\n2. Click "Scan Printers"\n3. Select your printer again\n4. Click "Save"\n5. Try printing again`;
                            }
                            else if (errorType && errorType.toLowerCase().includes('offline')) {
                                userFriendlyError = `Printer "${printerName}" is offline. Please check:\n1. Printer is powered on\n2. Printer is connected\n3. Printer shows "Ready" in Windows settings`;
                            }
                            resolve({ success: false, error: userFriendlyError });
                        }
                        // Close window after print completes (success or failure)
                        setTimeout(() => {
                            if (currentWindow && !currentWindow.isDestroyed()) {
                                currentWindow.close();
                            }
                            if (printWindow === currentWindow) {
                                printWindow = null;
                            }
                        }, 1000);
                    });
                }
                catch (err) {
                    console.error('❌ [SHIFT PRINT] Exception during print:', err);
                    resolve({ success: false, error: String(err) });
                    if (currentWindow && !currentWindow.isDestroyed()) {
                        currentWindow.close();
                    }
                    if (printWindow === currentWindow) {
                        printWindow = null;
                    }
                }
            }, 500); // Give window time to fully load before printing
        });
    }
    catch (error) {
        console.error('❌ [SHIFT PRINT] Error printing shift breakdown:', error);
        return { success: false, error: String(error) };
    }
});
// List available system printers for the renderer
electron_1.ipcMain.handle('list-printers', async (event) => {
    try {
        const sender = event?.sender;
        const printers = await sender.getPrintersAsync();
        return { success: true, printers };
    }
    catch (error) {
        console.error('Failed to list printers:', error);
        const errorMessage = (error && typeof error === 'object' && 'message' in error)
            ? String(error.message)
            : String(error);
        return { success: false, error: errorMessage, printers: [] };
    }
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
    if (mainWindow) {
        const currentURL = mainWindow.webContents.getURL();
        const baseURL = currentURL.split('/').slice(0, 3).join('/');
        mainWindow.loadURL(`${baseURL}${path}`);
    }
    return { success: true };
});
// IPC handlers for dual-display communication
electron_1.ipcMain.handle('update-customer-display', async (event, data) => {
    if (customerWindow) {
        customerWindow.webContents.send('order-update', data);
    }
    return { success: true };
});
electron_1.ipcMain.handle('update-customer-slideshow', async (event, data) => {
    if (customerWindow) {
        customerWindow.webContents.send('slideshow-update', data);
    }
    return { success: true };
});
electron_1.ipcMain.handle('get-customer-display-status', async () => {
    return {
        hasCustomerDisplay: customerWindow !== null,
        isCustomerDisplayVisible: customerWindow ? !customerWindow.isDestroyed() : false
    };
});
// Debug function to manually create customer display
electron_1.ipcMain.handle('create-customer-display', async () => {
    if (customerWindow && !customerWindow.isDestroyed()) {
        customerWindow.show();
        return { success: true, message: 'Customer display already exists' };
    }
    const displays = electron_1.screen.getAllDisplays();
    const primaryDisplay = electron_1.screen.getPrimaryDisplay();
    const secondaryDisplay = displays.find(display => display.id !== primaryDisplay.id);
    if (!secondaryDisplay) {
        return { success: false, message: 'No secondary display detected' };
    }
    const customerWindowWidth = Math.floor(secondaryDisplay.workAreaSize.width * 0.9);
    const customerWindowHeight = Math.floor(secondaryDisplay.workAreaSize.height * 0.9);
    customerWindow = new electron_1.BrowserWindow({
        width: customerWindowWidth,
        height: customerWindowHeight,
        x: secondaryDisplay.workArea.x,
        y: secondaryDisplay.workArea.y,
        title: 'Marviano POS - Customer Display',
        frame: false,
        backgroundColor: '#000000',
        alwaysOnTop: true,
        kiosk: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
        },
        show: false,
    });
    // Load customer display page
    if (isDev) {
        // Try ports in order: 3000, 3001, 3002 (3000 is default Next.js port)
        const tryLoadCustomerURL = async (port) => {
            try {
                await customerWindow.loadURL(`http://localhost:${port}/customer-display`);
                customerWindow.show();
                console.log(`✅ Customer display created and shown on port ${port}`);
                return true;
            }
            catch (error) {
                console.log(`❌ Failed to load customer display on port ${port}:`, error);
                return false;
            }
        };
        const ports = [3000, 3001, 3002];
        let loaded = false;
        for (const port of ports) {
            if (await tryLoadCustomerURL(port)) {
                loaded = true;
                break;
            }
        }
        if (!loaded) {
            console.error('❌ Failed to load customer display on any port');
        }
    }
    else {
        customerWindow.loadFile(path.join(__dirname, '../../out/customer-display.html'));
        customerWindow.show();
    }
    return { success: true, message: 'Customer display created successfully' };
});
// ============================================================================
// SLIDESHOW IMAGE MANAGEMENT (userData storage)
// ============================================================================
function getSlideshowPath() {
    const userDataPath = electron_1.app.getPath('userData');
    const slideshowPath = path.join(userDataPath, 'slideshow');
    // Create directory if it doesn't exist
    if (!fs.existsSync(slideshowPath)) {
        fs.mkdirSync(slideshowPath, { recursive: true });
        console.log('📁 Created slideshow directory:', slideshowPath);
    }
    return slideshowPath;
}
// Get all slideshow images from userData
electron_1.ipcMain.handle('get-slideshow-images', async () => {
    try {
        const slideshowPath = getSlideshowPath();
        const files = fs.readdirSync(slideshowPath);
        // Filter for image files only
        const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
        const imageFiles = files.filter(file => {
            const ext = path.extname(file).toLowerCase();
            return imageExtensions.includes(ext);
        });
        // Sort files alphabetically
        imageFiles.sort();
        // Create image objects with metadata
        const images = imageFiles.map((file, index) => {
            const filePath = path.join(slideshowPath, file);
            const stats = fs.statSync(filePath);
            return {
                id: `slide-${index + 1}`,
                filename: file,
                path: `slideshow-file://${file}`, // Custom protocol
                localPath: filePath, // Full system path
                title: file.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' '),
                duration: 5,
                order: index + 1,
                size: stats.size,
                createdAt: stats.birthtime.toISOString()
            };
        });
        console.log(`📸 Found ${images.length} slideshow images in userData`);
        return {
            success: true,
            images,
            count: images.length,
            path: slideshowPath
        };
    }
    catch (error) {
        console.error('❌ Error reading slideshow images:', error);
        return {
            success: false,
            error: 'Failed to read slideshow images',
            images: [],
            count: 0
        };
    }
});
// Save a new slideshow image to userData
electron_1.ipcMain.handle('save-slideshow-image', async (event, imageData) => {
    try {
        const slideshowPath = getSlideshowPath();
        const filePath = path.join(slideshowPath, imageData.filename);
        // Check if file already exists
        if (fs.existsSync(filePath)) {
            return {
                success: false,
                error: 'File already exists. Please rename or delete the existing file first.'
            };
        }
        // Write the file
        fs.writeFileSync(filePath, imageData.buffer);
        console.log('✅ Saved slideshow image:', imageData.filename);
        return {
            success: true,
            message: 'Image saved successfully',
            filename: imageData.filename
        };
    }
    catch (error) {
        console.error('❌ Error saving slideshow image:', error);
        return {
            success: false,
            error: 'Failed to save image'
        };
    }
});
// Delete a slideshow image from userData
electron_1.ipcMain.handle('delete-slideshow-image', async (event, filename) => {
    try {
        const slideshowPath = getSlideshowPath();
        const filePath = path.join(slideshowPath, filename);
        if (!fs.existsSync(filePath)) {
            return {
                success: false,
                error: 'File not found'
            };
        }
        fs.unlinkSync(filePath);
        console.log('🗑️ Deleted slideshow image:', filename);
        return {
            success: true,
            message: 'Image deleted successfully'
        };
    }
    catch (error) {
        console.error('❌ Error deleting slideshow image:', error);
        return {
            success: false,
            error: 'Failed to delete image'
        };
    }
});
// Get Shift by UUID
electron_1.ipcMain.handle('localDbGetShiftByUuid', async (event, shiftUuid) => {
    try {
        const shift = await (0, mysqlDb_1.executeQueryOne)('SELECT * FROM shifts WHERE uuid_id = ?', [shiftUuid]);
        return shift || null;
    }
    catch (error) {
        console.error('❌ Error fetching shift by UUID:', error);
        return null;
    }
});
// Get Printer Audits by Transaction ID
electron_1.ipcMain.handle('localDbGetPrinterAuditsByTransactionId', async (event, transactionId) => {
    try {
        const printer1 = await (0, mysqlDb_1.executeQuery)('SELECT * FROM printer1_audit_log WHERE transaction_id = ?', [transactionId]);
        const printer2 = await (0, mysqlDb_1.executeQuery)('SELECT * FROM printer2_audit_log WHERE transaction_id = ?', [transactionId]);
        return { printer1, printer2 };
    }
    catch (error) {
        console.error('❌ Error fetching printer audits:', error);
        return { printer1: [], printer2: [] };
    }
});
// ============================================================================
// ADMIN: DELETE TRANSACTIONS BY USER EMAIL OR NULL
// ============================================================================
/**
 * Delete all transactions made by marviano.austin@gmail.com or where user_id is NULL
 * Manually deletes from all related tables
 */
electron_1.ipcMain.handle('localdb-delete-transactions-by-role', async () => {
    const details = {
        database: 'MySQL',
        targetUserIds: [],
        printer_audit_log: 0,
        printer1_audit_log: 0,
        printer2_audit_log: 0,
        transaction_items: 0,
        transactions: 0,
        success: false,
        error: null
    };
    try {
        console.log('[CLEANUP] [MySQL] Starting transaction cleanup for marviano.austin@gmail.com and NULL user_id');
        // Find user ID for marviano.austin@gmail.com
        const targetUsers = await (0, mysqlDb_1.executeQuery)('SELECT id FROM users WHERE email = ?', ['marviano.austin@gmail.com']);
        const targetUserIds = targetUsers.map(u => u.id);
        details.targetUserIds = targetUserIds;
        console.log(`[CLEANUP] [MySQL] Target user IDs: ${targetUserIds.join(', ')}`);
        // Build WHERE clause for transactions
        let whereClause = 'WHERE user_id IS NULL';
        const params = [];
        if (targetUserIds.length > 0) {
            whereClause += ` OR user_id IN (${targetUserIds.map(() => '?').join(',')})`;
            params.push(...targetUserIds);
        }
        // Get transaction IDs and UUIDs to delete
        const transactionsToDelete = await (0, mysqlDb_1.executeQuery)(`SELECT id, uuid_id FROM transactions ${whereClause}`, params);
        const transactionIds = transactionsToDelete.map(t => t.id);
        const transactionUuids = transactionsToDelete.map(t => t.uuid_id);
        console.log(`[CLEANUP] [MySQL] Found ${transactionIds.length} transactions to delete`);
        if (transactionIds.length === 0) {
            details.success = true;
            console.log(`✅ [CLEANUP] [MySQL] No transactions to delete`);
            return {
                success: true,
                message: 'No transactions found to delete',
                deleted: 0,
                deletedItems: 0,
                details
            };
        }
        const queries = [];
        const placeholders = transactionIds.map(() => '?').join(',');
        const uuidPlaceholders = transactionUuids.map(() => '?').join(',');
        // 1. Delete transaction_item_customization_options
        // First get customization IDs
        const customizationIds = await (0, mysqlDb_1.executeQuery)(`
      SELECT DISTINCT tic.id 
      FROM transaction_item_customizations tic
      JOIN transaction_items ti ON tic.transaction_item_id = ti.id
      WHERE ti.transaction_id IN (${placeholders})
    `, transactionIds);
        if (customizationIds.length > 0) {
            const customizationPlaceholders = customizationIds.map(() => '?').join(',');
            const customizationIdValues = customizationIds.map(c => c.id);
            queries.push({
                sql: `
          DELETE FROM transaction_item_customization_options 
          WHERE transaction_item_customization_id IN (${customizationPlaceholders})
        `,
                params: customizationIdValues
            });
        }
        // 2. Delete transaction_item_customizations
        queries.push({
            sql: `
        DELETE FROM transaction_item_customizations 
        WHERE transaction_item_id IN (
          SELECT id FROM transaction_items WHERE transaction_id IN (${placeholders})
        )
      `,
            params: [...transactionIds]
        });
        // 3. Delete transaction_items
        queries.push({
            sql: `DELETE FROM transaction_items WHERE transaction_id IN (${placeholders})`,
            params: [...transactionIds]
        });
        // 4. Delete transaction_refunds (uses transaction_uuid, not transaction_id)
        queries.push({
            sql: `DELETE FROM transaction_refunds WHERE transaction_uuid IN (${uuidPlaceholders})`,
            params: [...transactionUuids]
        });
        // 5. Delete printer1_audit_log (uses transaction_id VARCHAR(32))
        queries.push({
            sql: `DELETE FROM printer1_audit_log WHERE transaction_id IN (${uuidPlaceholders})`,
            params: [...transactionUuids]
        });
        // 6. Delete printer2_audit_log (uses transaction_id VARCHAR(36) that references transactions.uuid_id)
        queries.push({
            sql: `DELETE FROM printer2_audit_log WHERE transaction_id IN (${uuidPlaceholders})`,
            params: [...transactionUuids]
        });
        // 8. Finally delete transactions
        queries.push({
            sql: `DELETE FROM transactions ${whereClause}`,
            params: [...params]
        });
        // Execute all deletions in a transaction
        await (0, mysqlDb_1.executeTransaction)(queries);
        // Get counts for reporting
        const itemsCountResult = await (0, mysqlDb_1.executeQueryOne)(`
      SELECT COUNT(*) as count FROM transaction_items WHERE transaction_id IN (${placeholders})
    `, transactionIds);
        details.transaction_items = itemsCountResult?.count || 0;
        const transactionsCountResult = await (0, mysqlDb_1.executeQueryOne)(`
      SELECT COUNT(*) as count FROM transactions ${whereClause}
    `, params);
        details.transactions = transactionsCountResult?.count || 0;
        details.success = true;
        console.log(`✅ [CLEANUP] [MySQL] Completed successfully`);
        return {
            success: true,
            message: 'Transactions deleted successfully',
            deleted: details.transactions,
            deletedItems: details.transaction_items,
            details
        };
    }
    catch (error) {
        details.error = error.message || 'Failed to cleanup transactions';
        console.error(`❌ [CLEANUP] [MySQL] Failed:`, error);
        return {
            success: false,
            deleted: 0,
            deletedItems: 0,
            error: details.error,
            details
        };
    }
});
// Open slideshow folder in file explorer
electron_1.ipcMain.handle('open-slideshow-folder', async () => {
    try {
        const slideshowPath = getSlideshowPath();
        const { shell } = require('electron');
        await shell.openPath(slideshowPath);
        return {
            success: true,
            message: 'Opened slideshow folder',
            path: slideshowPath
        };
    }
    catch (error) {
        console.error('❌ Error opening slideshow folder:', error);
        return {
            success: false,
            error: 'Failed to open folder'
        };
    }
});
// Read slideshow image file (for serving to renderer)
electron_1.ipcMain.handle('read-slideshow-image', async (event, filename) => {
    try {
        const slideshowPath = getSlideshowPath();
        const filePath = path.join(slideshowPath, filename);
        if (!fs.existsSync(filePath)) {
            return {
                success: false,
                error: 'File not found'
            };
        }
        const buffer = fs.readFileSync(filePath);
        const ext = path.extname(filename).toLowerCase();
        // Determine MIME type
        let mimeType = 'image/jpeg';
        if (ext === '.png')
            mimeType = 'image/png';
        else if (ext === '.webp')
            mimeType = 'image/webp';
        else if (ext === '.gif')
            mimeType = 'image/gif';
        return {
            success: true,
            buffer: buffer,
            mimeType: mimeType,
            filename: filename
        };
    }
    catch (error) {
        console.error('❌ Error reading slideshow image:', error);
        return {
            success: false,
            error: 'Failed to read image'
        };
    }
});
// Migrate images from /public/images/slideshow/ to userData (one-time migration)
electron_1.ipcMain.handle('migrate-slideshow-images', async () => {
    try {
        const slideshowPath = getSlideshowPath();
        const publicSlideshowPath = path.join(process.cwd(), 'public', 'images', 'slideshow');
        // Check if public folder exists
        if (!fs.existsSync(publicSlideshowPath)) {
            return {
                success: true,
                message: 'No public slideshow folder found, nothing to migrate',
                migrated: 0
            };
        }
        // Check if userData folder already has images (skip migration if already done)
        const existingFiles = fs.readdirSync(slideshowPath);
        const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
        const existingImages = existingFiles.filter(file => {
            const ext = path.extname(file).toLowerCase();
            return imageExtensions.includes(ext);
        });
        if (existingImages.length > 0) {
            console.log('📸 Slideshow images already exist in userData, skipping migration');
            return {
                success: true,
                message: 'Images already exist in userData, skipping migration',
                migrated: 0,
                existing: existingImages.length
            };
        }
        // Read files from public folder
        const publicFiles = fs.readdirSync(publicSlideshowPath);
        const imagesToMigrate = publicFiles.filter(file => {
            const ext = path.extname(file).toLowerCase();
            return imageExtensions.includes(ext);
        });
        if (imagesToMigrate.length === 0) {
            return {
                success: true,
                message: 'No images found in public folder to migrate',
                migrated: 0
            };
        }
        // Copy images to userData
        let migratedCount = 0;
        for (const file of imagesToMigrate) {
            try {
                const sourcePath = path.join(publicSlideshowPath, file);
                const destPath = path.join(slideshowPath, file);
                fs.copyFileSync(sourcePath, destPath);
                migratedCount++;
                console.log('📸 Migrated:', file);
            }
            catch (error) {
                console.error('❌ Failed to migrate:', file, error);
            }
        }
        console.log(`✅ Successfully migrated ${migratedCount} images to userData`);
        return {
            success: true,
            message: `Migrated ${migratedCount} images to userData`,
            migrated: migratedCount
        };
    }
    catch (error) {
        console.error('❌ Error migrating slideshow images:', error);
        return {
            success: false,
            error: 'Failed to migrate images'
        };
    }
});
// =====================================================
// RESTORE FROM SERVER - FULL DATABASE RESTORE
// =====================================================
/**
 * Restore full database from server
 * Downloads master data + transactions and restores to local DB
 */
electron_1.ipcMain.handle('restore-from-server', async (event, options) => {
    const { businessId, apiUrl, includeTransactions = true } = options;
    const stats = {};
    try {
        console.log('🔄 [RESTORE] Starting full restore from server...');
        console.log('🔄 [RESTORE] Business ID:', businessId);
        console.log('🔄 [RESTORE] API URL:', apiUrl);
        // Step 1: Download Master Data from /api/sync
        console.log('📥 [RESTORE] Step 1: Downloading master data...');
        const syncUrl = `${apiUrl}/api/sync?business_id=${businessId}`;
        const syncResponse = await fetch(syncUrl);
        if (!syncResponse.ok) {
            throw new Error(`Failed to download master data: ${syncResponse.status} ${syncResponse.statusText}`);
        }
        const syncData = await syncResponse.json();
        const data = syncData.data || {};
        // Step 2: Restore Master Data (order matters due to foreign keys!)
        console.log('💾 [RESTORE] Step 2: Restoring master data...');
        const allQueries = [];
        // 2.1 Businesses
        if (Array.isArray(data.businesses) && data.businesses.length > 0) {
            for (const biz of data.businesses) {
                allQueries.push({
                    sql: `
            INSERT INTO businesses (id, name, permission_name, organization_id, management_group_id, image_url, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              name=VALUES(name),
              permission_name=VALUES(permission_name),
              organization_id=VALUES(organization_id),
              management_group_id=VALUES(management_group_id),
              image_url=VALUES(image_url),
              created_at=VALUES(created_at)
          `,
                    params: [
                        biz.id,
                        biz.name,
                        biz.permission_name || biz.name || 'business',
                        biz.organization_id || null,
                        biz.management_group_id || null,
                        biz.image_url || null,
                        (0, mysqlDb_1.toMySQLTimestamp)(biz.created_at || new Date())
                    ]
                });
            }
            stats.businesses = data.businesses.length;
            console.log(`✅ [RESTORE] ${data.businesses.length} businesses restored`);
        }
        // 2.2 Users
        if (Array.isArray(data.users) && data.users.length > 0) {
            for (const usr of data.users) {
                allQueries.push({
                    sql: `
            INSERT INTO users (id, email, password, name, googleId, createdAt, role_id, organization_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              email=VALUES(email),
              password=VALUES(password),
              name=VALUES(name),
              googleId=VALUES(googleId),
              createdAt=VALUES(createdAt),
              role_id=VALUES(role_id),
              organization_id=VALUES(organization_id)
          `,
                    params: [
                        usr.id,
                        usr.email,
                        usr.password || null,
                        usr.name,
                        usr.googleId || null,
                        (0, mysqlDb_1.toMySQLTimestamp)(usr.created_at || usr.createdAt || new Date()),
                        usr.role_id || null,
                        usr.organization_id || null
                    ]
                });
            }
            stats.users = data.users.length;
            console.log(`✅ [RESTORE] ${data.users.length} users restored`);
        }
        // 2.3 Categories
        if (Array.isArray(data.category1) && data.category1.length > 0) {
            for (const cat of data.category1) {
                allQueries.push({
                    sql: `
            INSERT INTO category1 (id, name, description, display_order, is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              name=VALUES(name),
              description=VALUES(description),
              display_order=VALUES(display_order),
              is_active=VALUES(is_active),
              created_at=VALUES(created_at),
              updated_at=VALUES(updated_at)
          `,
                    params: [
                        cat.id,
                        cat.name,
                        cat.description || null,
                        cat.display_order || 0,
                        cat.is_active !== undefined ? cat.is_active : 1,
                        (0, mysqlDb_1.toMySQLTimestamp)(cat.created_at || new Date()),
                        (0, mysqlDb_1.toMySQLTimestamp)(Date.now())
                    ]
                });
            }
            stats.category1 = data.category1.length;
            console.log(`✅ [RESTORE] ${data.category1.length} category1 restored`);
        }
        if (Array.isArray(data.category2) && data.category2.length > 0) {
            for (const cat of data.category2) {
                allQueries.push({
                    sql: `
            INSERT INTO category2 (id, name, description, display_order, is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              name=VALUES(name),
              description=VALUES(description),
              display_order=VALUES(display_order),
              is_active=VALUES(is_active),
              created_at=VALUES(created_at),
              updated_at=VALUES(updated_at)
          `,
                    params: [
                        cat.id ?? null,
                        cat.name ?? null,
                        cat.description ?? null,
                        cat.display_order ?? 0,
                        cat.is_active !== undefined ? cat.is_active : 1,
                        (0, mysqlDb_1.toMySQLTimestamp)(cat.created_at || new Date()),
                        (0, mysqlDb_1.toMySQLTimestamp)(Date.now())
                    ]
                });
            }
            // Store junction table relationships (REQUIRED - no fallback)
            if (Array.isArray(data.category2Businesses) && data.category2Businesses.length > 0) {
                for (const rel of data.category2Businesses) {
                    allQueries.push({
                        sql: `
              INSERT INTO category2_businesses (category2_id, business_id, created_at)
              VALUES (?, ?, ?)
              ON DUPLICATE KEY UPDATE created_at=VALUES(created_at)
            `,
                        params: [rel.category2_id, rel.business_id, (0, mysqlDb_1.toMySQLTimestamp)(new Date())]
                    });
                }
                console.log(`✅ [RESTORE] ${data.category2Businesses.length} category2-business relationships restored`);
            }
            else {
                console.warn(`⚠️ [RESTORE] No junction table data provided for category2 - records will not be associated with any business`);
            }
            stats.category2 = data.category2.length;
            console.log(`✅ [RESTORE] ${data.category2.length} category2 restored`);
        }
        // 2.4 Products (matching local schema: nama, harga_jual, kategori, etc.)
        if (Array.isArray(data.products) && data.products.length > 0) {
            for (const prod of data.products) {
                allQueries.push({
                    sql: `
            INSERT INTO products (
              id, business_id, menu_code, nama, satuan, kategori, jenis, 
              category2_id, category2_name, keterangan, harga_beli, ppn, 
              harga_jual, harga_khusus, harga_online, harga_qpon, harga_gofood, 
              harga_grabfood, harga_shopeefood, harga_tiktok, fee_kerja, 
              status, created_at, updated_at, has_customization, is_bundle
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              business_id=VALUES(business_id),
              menu_code=VALUES(menu_code),
              nama=VALUES(nama),
              satuan=VALUES(satuan),
              kategori=VALUES(kategori),
              jenis=VALUES(jenis),
              category2_id=VALUES(category2_id),
              category2_name=VALUES(category2_name),
              keterangan=VALUES(keterangan),
              harga_beli=VALUES(harga_beli),
              ppn=VALUES(ppn),
              harga_jual=VALUES(harga_jual),
              harga_khusus=VALUES(harga_khusus),
              harga_online=VALUES(harga_online),
              harga_qpon=VALUES(harga_qpon),
              harga_gofood=VALUES(harga_gofood),
              harga_grabfood=VALUES(harga_grabfood),
              harga_shopeefood=VALUES(harga_shopeefood),
              harga_tiktok=VALUES(harga_tiktok),
              fee_kerja=VALUES(fee_kerja),
              status=VALUES(status),
              created_at=VALUES(created_at),
              updated_at=VALUES(updated_at),
              has_customization=VALUES(has_customization),
              is_bundle=VALUES(is_bundle)
          `,
                    params: [
                        prod.id,
                        prod.business_id || businessId,
                        prod.menu_code || prod.code || null,
                        prod.nama || prod.name || 'Unknown',
                        prod.satuan || 'pcs',
                        prod.kategori || prod.category2_name || 'Other',
                        prod.jenis || null,
                        prod.category2_id || null,
                        prod.category2_name || null,
                        prod.keterangan || prod.description || null,
                        prod.harga_beli || 0,
                        prod.ppn || 0,
                        prod.harga_jual || prod.price || 0,
                        prod.harga_khusus || null,
                        prod.harga_online || null,
                        prod.harga_qpon || null,
                        prod.harga_gofood || null,
                        prod.harga_grabfood || null,
                        prod.harga_shopeefood || null,
                        prod.harga_tiktok || null,
                        prod.fee_kerja || null,
                        prod.status || 'active',
                        (0, mysqlDb_1.toMySQLTimestamp)(prod.created_at || new Date()),
                        (0, mysqlDb_1.toMySQLTimestamp)(Date.now()),
                        prod.has_customization || 0,
                        prod.is_bundle || 0
                    ]
                });
            }
            stats.products = data.products.length;
            console.log(`✅ [RESTORE] ${data.products.length} products restored`);
        }
        // 2.5 Customization Types
        if (Array.isArray(data.customizationTypes) && data.customizationTypes.length > 0) {
            for (const type of data.customizationTypes) {
                allQueries.push({
                    sql: `
            INSERT INTO product_customization_types (id, name, selection_mode)
            VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE
              name=VALUES(name),
              selection_mode=VALUES(selection_mode)
          `,
                    params: [type.id, type.name, type.selection_mode || 'single']
                });
            }
            stats.customizationTypes = data.customizationTypes.length;
            console.log(`✅ [RESTORE] ${data.customizationTypes.length} customization types restored`);
        }
        // 2.6 Customization Options
        if (Array.isArray(data.customizationOptions) && data.customizationOptions.length > 0) {
            for (const opt of data.customizationOptions) {
                allQueries.push({
                    sql: `
            INSERT INTO product_customization_options (id, type_id, name, price_adjustment, display_order)
            VALUES (?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              type_id=VALUES(type_id),
              name=VALUES(name),
              price_adjustment=VALUES(price_adjustment),
              display_order=VALUES(display_order)
          `,
                    params: [
                        opt.id,
                        opt.type_id,
                        opt.name,
                        opt.price_adjustment || 0,
                        opt.display_order || 0
                    ]
                });
            }
            stats.customizationOptions = data.customizationOptions.length;
            console.log(`✅ [RESTORE] ${data.customizationOptions.length} customization options restored`);
        }
        // 2.7 Product Customizations
        if (Array.isArray(data.productCustomizations) && data.productCustomizations.length > 0) {
            for (const pc of data.productCustomizations) {
                allQueries.push({
                    sql: `
            INSERT INTO product_customizations (id, product_id, customization_type_id)
            VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE
              product_id=VALUES(product_id),
              customization_type_id=VALUES(customization_type_id)
          `,
                    params: [pc.id, pc.product_id, pc.customization_type_id]
                });
            }
            stats.productCustomizations = data.productCustomizations.length;
            console.log(`✅ [RESTORE] ${data.productCustomizations.length} product customizations restored`);
        }
        // 2.8 Bundle Items
        if (Array.isArray(data.bundleItems) && data.bundleItems.length > 0) {
            for (const bundle of data.bundleItems) {
                allQueries.push({
                    sql: `
            INSERT INTO bundle_items (id, bundle_product_id, category2_id, required_quantity, display_order)
            VALUES (?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              bundle_product_id=VALUES(bundle_product_id),
              category2_id=VALUES(category2_id),
              required_quantity=VALUES(required_quantity),
              display_order=VALUES(display_order)
          `,
                    params: [
                        bundle.id,
                        bundle.bundle_product_id,
                        bundle.category2_id,
                        bundle.required_quantity || 1,
                        bundle.display_order || 0
                    ]
                });
            }
            stats.bundleItems = data.bundleItems.length;
            console.log(`✅ [RESTORE] ${data.bundleItems.length} bundle items restored`);
        }
        // 2.9 Payment Methods
        if (Array.isArray(data.paymentMethods) && data.paymentMethods.length > 0) {
            for (const pm of data.paymentMethods) {
                allQueries.push({
                    sql: `
            INSERT INTO payment_methods (id, name, code, description, is_active, requires_additional_info, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              name=VALUES(name),
              code=VALUES(code),
              description=VALUES(description),
              is_active=VALUES(is_active),
              requires_additional_info=VALUES(requires_additional_info),
              created_at=VALUES(created_at),
              updated_at=VALUES(updated_at)
          `,
                    params: [
                        pm.id ?? null,
                        pm.name ?? null,
                        pm.code ?? null,
                        pm.description ?? null,
                        pm.is_active !== undefined ? pm.is_active : 1,
                        pm.requires_additional_info ?? 0,
                        (0, mysqlDb_1.toMySQLTimestamp)(pm.created_at || new Date()),
                        (0, mysqlDb_1.toMySQLTimestamp)(Date.now())
                    ]
                });
            }
            stats.paymentMethods = data.paymentMethods.length;
            console.log(`✅ [RESTORE] ${data.paymentMethods.length} payment methods restored`);
        }
        // 2.10 Banks
        if (Array.isArray(data.banks) && data.banks.length > 0) {
            for (const bank of data.banks) {
                allQueries.push({
                    sql: `
            INSERT INTO banks (id, bank_code, bank_name, is_popular, is_active, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              bank_code=VALUES(bank_code),
              bank_name=VALUES(bank_name),
              is_popular=VALUES(is_popular),
              is_active=VALUES(is_active),
              created_at=VALUES(created_at)
          `,
                    params: [
                        bank.id,
                        bank.bank_code,
                        bank.bank_name,
                        bank.is_popular || 0,
                        bank.is_active !== undefined ? bank.is_active : 1,
                        (0, mysqlDb_1.toMySQLTimestamp)(bank.created_at || new Date())
                    ]
                });
            }
            stats.banks = data.banks.length;
            console.log(`✅ [RESTORE] ${data.banks.length} banks restored`);
        }
        // 2.11 CL Accounts
        if (Array.isArray(data.clAccounts) && data.clAccounts.length > 0) {
            for (const cl of data.clAccounts) {
                allQueries.push({
                    sql: `
            INSERT INTO cl_accounts (id, account_code, account_name, contact_info, credit_limit, current_balance, is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              account_code=VALUES(account_code),
              account_name=VALUES(account_name),
              contact_info=VALUES(contact_info),
              credit_limit=VALUES(credit_limit),
              current_balance=VALUES(current_balance),
              is_active=VALUES(is_active),
              created_at=VALUES(created_at),
              updated_at=VALUES(updated_at)
          `,
                    params: [
                        cl.id,
                        cl.account_code,
                        cl.account_name,
                        cl.contact_info || null,
                        cl.credit_limit || 0,
                        cl.current_balance || 0,
                        cl.is_active !== undefined ? cl.is_active : 1,
                        (0, mysqlDb_1.toMySQLTimestamp)(cl.created_at || new Date()),
                        (0, mysqlDb_1.toMySQLTimestamp)(Date.now())
                    ]
                });
            }
            stats.clAccounts = data.clAccounts.length;
            console.log(`✅ [RESTORE] ${data.clAccounts.length} CL accounts restored`);
        }
        // Execute all master data queries in a transaction
        if (allQueries.length > 0) {
            await (0, mysqlDb_1.executeTransaction)(allQueries);
            console.log(`✅ [RESTORE] Executed ${allQueries.length} master data queries`);
        }
        // Step 3: Download and Restore Transactions (if requested)
        if (includeTransactions) {
            console.log('📥 [RESTORE] Step 3: Downloading transactions...');
            const transactionsUrl = `${apiUrl}/api/transactions?business_id=${businessId}&limit=10000`;
            const txResponse = await fetch(transactionsUrl);
            if (!txResponse.ok) {
                console.warn(`⚠️ [RESTORE] Failed to download transactions: ${txResponse.status}`);
            }
            else {
                const txData = await txResponse.json();
                const transactions = txData.transactions || [];
                if (transactions.length > 0) {
                    console.log(`💾 [RESTORE] Restoring ${transactions.length} transactions...`);
                    const txQueries = [];
                    const now = Date.now();
                    for (const tx of transactions) {
                        const txId = tx.uuid_id || tx.id;
                        txQueries.push({
                            sql: `
                INSERT INTO transactions (
                  id, business_id, user_id, payment_method, payment_method_id,
                  pickup_method, total_amount, final_amount, amount_received, change_amount,
                  customer_name, status, created_at, updated_at, voucher_discount,
                  voucher_type, voucher_value, transaction_type, receipt_number, shift_uuid,
                  synced_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                  business_id=VALUES(business_id),
                  user_id=VALUES(user_id),
                  payment_method=VALUES(payment_method),
                  payment_method_id=VALUES(payment_method_id),
                  pickup_method=VALUES(pickup_method),
                  total_amount=VALUES(total_amount),
                  final_amount=VALUES(final_amount),
                  amount_received=VALUES(amount_received),
                  change_amount=VALUES(change_amount),
                  customer_name=VALUES(customer_name),
                  status=VALUES(status),
                  created_at=VALUES(created_at),
                  updated_at=VALUES(updated_at),
                  voucher_discount=VALUES(voucher_discount),
                  voucher_type=VALUES(voucher_type),
                  voucher_value=VALUES(voucher_value),
                  transaction_type=VALUES(transaction_type),
                  receipt_number=VALUES(receipt_number),
                  shift_uuid=VALUES(shift_uuid),
                  synced_at=VALUES(synced_at)
              `,
                            params: [
                                txId,
                                tx.business_id || businessId,
                                tx.user_id,
                                tx.payment_method,
                                tx.payment_method_id || null,
                                tx.pickup_method,
                                tx.total_amount || 0,
                                tx.final_amount || 0,
                                tx.amount_received || 0,
                                tx.change_amount || 0,
                                tx.customer_name || null,
                                tx.status || 'completed',
                                (0, mysqlDb_1.toMySQLTimestamp)(tx.created_at || new Date()),
                                (0, mysqlDb_1.toMySQLTimestamp)(Date.now()),
                                tx.voucher_discount || 0,
                                tx.voucher_type || null,
                                tx.voucher_value || null,
                                tx.transaction_type || 'drinks',
                                tx.receipt_number || null,
                                tx.shift_uuid || null,
                                now // Set synced_at to mark as already synced (downloaded from server)
                            ]
                        });
                    }
                    await (0, mysqlDb_1.executeTransaction)(txQueries);
                    stats.transactions = transactions.length;
                    console.log(`✅ [RESTORE] ${transactions.length} transactions restored`);
                }
            }
            // Step 4: Download and Restore Transaction Items
            console.log('📥 [RESTORE] Step 4: Downloading transaction items...');
            const itemsUrl = `${apiUrl}/api/transaction-items?business_id=${businessId}&limit=50000`;
            console.log('📥 [RESTORE] URL:', itemsUrl);
            try {
                const itemsResponse = await fetch(itemsUrl);
                console.log('📥 [RESTORE] Response status:', itemsResponse.status);
                if (!itemsResponse.ok) {
                    const errorText = await itemsResponse.text();
                    console.warn(`⚠️ [RESTORE] Failed to download transaction items: ${itemsResponse.status}`, errorText);
                }
                else {
                    const itemsData = await itemsResponse.json();
                    const items = itemsData.items || [];
                    console.log('📥 [RESTORE] Received', items.length, 'transaction items');
                    if (items.length > 0) {
                        console.log(`💾 [RESTORE] Restoring ${items.length} transaction items...`);
                        const itemQueries = [];
                        for (const item of items) {
                            const itemId = item.uuid_id || item.id;
                            const transactionId = item.uuid_transaction_id || item.transaction_id;
                            // Convert bundle_selections_json to string if it's an object
                            let bundleSelectionsStr = null;
                            if (item.bundle_selections_json) {
                                bundleSelectionsStr = typeof item.bundle_selections_json === 'string'
                                    ? item.bundle_selections_json
                                    : JSON.stringify(item.bundle_selections_json);
                            }
                            itemQueries.push({
                                sql: `
                  INSERT INTO transaction_items (
                    id, transaction_id, product_id, quantity, unit_price, total_price,
                    custom_note, bundle_selections_json, created_at
                  )
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                  ON DUPLICATE KEY UPDATE
                    transaction_id=VALUES(transaction_id),
                    product_id=VALUES(product_id),
                    quantity=VALUES(quantity),
                    unit_price=VALUES(unit_price),
                    total_price=VALUES(total_price),
                    custom_note=VALUES(custom_note),
                    bundle_selections_json=VALUES(bundle_selections_json),
                    created_at=VALUES(created_at)
                `,
                                params: [
                                    itemId,
                                    transactionId,
                                    item.product_id,
                                    item.quantity || 1,
                                    item.unit_price || 0,
                                    item.total_price || 0,
                                    item.custom_note || null,
                                    bundleSelectionsStr,
                                    (0, mysqlDb_1.toMySQLTimestamp)(item.created_at || new Date())
                                ]
                            });
                        }
                        await (0, mysqlDb_1.executeTransaction)(itemQueries);
                        stats.transactionItems = items.length;
                        console.log(`✅ [RESTORE] ${items.length} transaction items restored`);
                    }
                    else {
                        console.warn('⚠️ [RESTORE] No transaction items found in response');
                    }
                }
            }
            catch (itemsError) {
                console.error('❌ [RESTORE] Error downloading transaction items:', itemsError);
            }
            // Step 5: Restore Transaction Item Customizations (from /api/sync)
            console.log('💾 [RESTORE] Step 5: Restoring transaction item customizations...');
            if (Array.isArray(data.transactionItemCustomizations) && data.transactionItemCustomizations.length > 0) {
                const ticQueries = [];
                for (const tic of data.transactionItemCustomizations) {
                    ticQueries.push({
                        sql: `
              INSERT INTO transaction_item_customizations (
                id, transaction_item_id, customization_type_id, bundle_product_id, created_at
              ) VALUES (?, ?, ?, ?, ?)
              ON DUPLICATE KEY UPDATE
                transaction_item_id=VALUES(transaction_item_id),
                customization_type_id=VALUES(customization_type_id),
                bundle_product_id=VALUES(bundle_product_id),
                created_at=VALUES(created_at)
            `,
                        params: [
                            tic.id,
                            tic.transaction_item_id,
                            tic.customization_type_id,
                            tic.bundle_product_id || null,
                            (0, mysqlDb_1.toMySQLTimestamp)(tic.created_at || new Date())
                        ]
                    });
                }
                await (0, mysqlDb_1.executeTransaction)(ticQueries);
                stats.transactionItemCustomizations = data.transactionItemCustomizations.length;
                console.log(`✅ [RESTORE] ${data.transactionItemCustomizations.length} transaction item customizations restored`);
            }
            // Step 6: Restore Transaction Item Customization Options (from /api/sync)
            console.log('💾 [RESTORE] Step 6: Restoring transaction item customization options...');
            if (Array.isArray(data.transactionItemCustomizationOptions) && data.transactionItemCustomizationOptions.length > 0) {
                const ticoQueries = [];
                for (const tico of data.transactionItemCustomizationOptions) {
                    ticoQueries.push({
                        sql: `
              INSERT INTO transaction_item_customization_options (
                id, transaction_item_customization_id, customization_option_id, option_name, price_adjustment, created_at
              ) VALUES (?, ?, ?, ?, ?, ?)
              ON DUPLICATE KEY UPDATE
                transaction_item_customization_id=VALUES(transaction_item_customization_id),
                customization_option_id=VALUES(customization_option_id),
                option_name=VALUES(option_name),
                price_adjustment=VALUES(price_adjustment),
                created_at=VALUES(created_at)
            `,
                        params: [
                            tico.id,
                            tico.transaction_item_customization_id,
                            tico.customization_option_id,
                            tico.option_name,
                            tico.price_adjustment || 0,
                            (0, mysqlDb_1.toMySQLTimestamp)(tico.created_at || new Date())
                        ]
                    });
                }
                await (0, mysqlDb_1.executeTransaction)(ticoQueries);
                stats.transactionItemCustomizationOptions = data.transactionItemCustomizationOptions.length;
                console.log(`✅ [RESTORE] ${data.transactionItemCustomizationOptions.length} transaction item customization options restored`);
            }
            // Step 7: Restore Shifts (from /api/sync)
            console.log('💾 [RESTORE] Step 7: Restoring shifts...');
            if (Array.isArray(data.shifts) && data.shifts.length > 0) {
                const shiftQueries = [];
                for (const shift of data.shifts) {
                    shiftQueries.push({
                        sql: `
              INSERT INTO shifts (
                id, uuid_id, business_id, user_id, user_name, shift_start, shift_end,
                modal_awal, kas_akhir, kas_expected, kas_selisih, kas_selisih_label,
                cash_sales_total, cash_refund_total, status, created_at, updated_at, synced_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON DUPLICATE KEY UPDATE
                business_id=VALUES(business_id),
                user_id=VALUES(user_id),
                user_name=VALUES(user_name),
                shift_start=VALUES(shift_start),
                shift_end=VALUES(shift_end),
                modal_awal=VALUES(modal_awal),
                kas_akhir=VALUES(kas_akhir),
                kas_expected=VALUES(kas_expected),
                kas_selisih=VALUES(kas_selisih),
                kas_selisih_label=VALUES(kas_selisih_label),
                cash_sales_total=VALUES(cash_sales_total),
                cash_refund_total=VALUES(cash_refund_total),
                status=VALUES(status),
                created_at=VALUES(created_at),
                updated_at=VALUES(updated_at),
                synced_at=VALUES(synced_at)
            `,
                        params: [
                            shift.id || null,
                            shift.uuid_id,
                            shift.business_id,
                            shift.user_id,
                            shift.user_name,
                            (0, mysqlDb_1.toMySQLDateTime)(shift.shift_start),
                            shift.shift_end ? (0, mysqlDb_1.toMySQLDateTime)(shift.shift_end) : null,
                            shift.modal_awal || 0,
                            shift.kas_akhir || null,
                            shift.kas_expected || null,
                            shift.kas_selisih || null,
                            shift.kas_selisih_label || 'balanced',
                            shift.cash_sales_total || null,
                            shift.cash_refund_total || null,
                            shift.status || 'active',
                            (0, mysqlDb_1.toMySQLDateTime)(shift.created_at || new Date()),
                            shift.updated_at ? (typeof shift.updated_at === 'number' ? shift.updated_at : parseInt(String(shift.updated_at), 10)) : null,
                            shift.synced_at ? (typeof shift.synced_at === 'number' ? shift.synced_at : parseInt(String(shift.synced_at), 10)) : null
                        ]
                    });
                }
                await (0, mysqlDb_1.executeTransaction)(shiftQueries);
                stats.shifts = data.shifts.length;
                console.log(`✅ [RESTORE] ${data.shifts.length} shifts restored`);
            }
            // Step 8: Restore Transaction Refunds (from /api/sync)
            console.log('💾 [RESTORE] Step 8: Restoring transaction refunds...');
            if (Array.isArray(data.transactionRefunds) && data.transactionRefunds.length > 0) {
                const refundQueries = [];
                for (const refund of data.transactionRefunds) {
                    refundQueries.push({
                        sql: `
              INSERT INTO transaction_refunds (
                id, uuid_id, transaction_uuid, business_id, shift_uuid, refunded_by,
                refund_amount, cash_delta, payment_method_id, reason, note, refund_type,
                status, refunded_at, created_at, updated_at, synced_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON DUPLICATE KEY UPDATE
                transaction_uuid=VALUES(transaction_uuid),
                business_id=VALUES(business_id),
                shift_uuid=VALUES(shift_uuid),
                refunded_by=VALUES(refunded_by),
                refund_amount=VALUES(refund_amount),
                cash_delta=VALUES(cash_delta),
                payment_method_id=VALUES(payment_method_id),
                reason=VALUES(reason),
                note=VALUES(note),
                refund_type=VALUES(refund_type),
                status=VALUES(status),
                refunded_at=VALUES(refunded_at),
                created_at=VALUES(created_at),
                updated_at=VALUES(updated_at),
                synced_at=VALUES(synced_at)
            `,
                        params: [
                            refund.id || null,
                            refund.uuid_id,
                            refund.transaction_uuid,
                            refund.business_id,
                            refund.shift_uuid || null,
                            refund.refunded_by,
                            refund.refund_amount,
                            refund.cash_delta || 0,
                            refund.payment_method_id || null,
                            refund.reason || null,
                            refund.note || null,
                            refund.refund_type || 'full',
                            refund.status || 'completed',
                            refund.refunded_at,
                            (0, mysqlDb_1.toMySQLDateTime)(refund.created_at || new Date()),
                            refund.updated_at ? (0, mysqlDb_1.toMySQLDateTime)(typeof refund.updated_at === 'number' ? new Date(refund.updated_at) : refund.updated_at) : null,
                            refund.synced_at ? (0, mysqlDb_1.toMySQLDateTime)(typeof refund.synced_at === 'number' ? new Date(refund.synced_at) : refund.synced_at) : null
                        ]
                    });
                }
                await (0, mysqlDb_1.executeTransaction)(refundQueries);
                stats.transactionRefunds = data.transactionRefunds.length;
                console.log(`✅ [RESTORE] ${data.transactionRefunds.length} transaction refunds restored`);
            }
            // Step 9: Restore Printer 1 Audit Logs (from /api/sync)
            console.log('💾 [RESTORE] Step 9: Restoring printer 1 audit logs...');
            if (Array.isArray(data.printer1AuditLog) && data.printer1AuditLog.length > 0) {
                const p1Queries = [];
                for (const p1 of data.printer1AuditLog) {
                    p1Queries.push({
                        sql: `
              INSERT INTO printer1_audit_log (
                id, transaction_id, printer1_receipt_number, global_counter,
                printed_at, printed_at_epoch, is_reprint, reprint_count, synced_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON DUPLICATE KEY UPDATE
                transaction_id=VALUES(transaction_id),
                printer1_receipt_number=VALUES(printer1_receipt_number),
                global_counter=VALUES(global_counter),
                printed_at=VALUES(printed_at),
                printed_at_epoch=VALUES(printed_at_epoch),
                is_reprint=VALUES(is_reprint),
                reprint_count=VALUES(reprint_count),
                synced_at=VALUES(synced_at)
            `,
                        params: [
                            p1.id || null,
                            p1.transaction_id,
                            p1.printer1_receipt_number,
                            p1.global_counter || null,
                            p1.printed_at,
                            p1.printed_at_epoch,
                            p1.is_reprint || 0,
                            p1.reprint_count || 0,
                            p1.synced_at || Date.now()
                        ]
                    });
                }
                await (0, mysqlDb_1.executeTransaction)(p1Queries);
                stats.printer1AuditLog = data.printer1AuditLog.length;
                console.log(`✅ [RESTORE] ${data.printer1AuditLog.length} printer 1 audit logs restored`);
            }
            // Step 10: Restore Printer 2 Audit Logs (from /api/sync)
            console.log('💾 [RESTORE] Step 10: Restoring printer 2 audit logs...');
            if (Array.isArray(data.printer2AuditLog) && data.printer2AuditLog.length > 0) {
                const p2Queries = [];
                for (const p2 of data.printer2AuditLog) {
                    p2Queries.push({
                        sql: `
              INSERT INTO printer2_audit_log (
                id, transaction_id, printer2_receipt_number, print_mode, cycle_number,
                global_counter, printed_at, printed_at_epoch, is_reprint, reprint_count, synced_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON DUPLICATE KEY UPDATE
                transaction_id=VALUES(transaction_id),
                printer2_receipt_number=VALUES(printer2_receipt_number),
                print_mode=VALUES(print_mode),
                cycle_number=VALUES(cycle_number),
                global_counter=VALUES(global_counter),
                printed_at=VALUES(printed_at),
                printed_at_epoch=VALUES(printed_at_epoch),
                is_reprint=VALUES(is_reprint),
                reprint_count=VALUES(reprint_count),
                synced_at=VALUES(synced_at)
            `,
                        params: [
                            p2.id || null,
                            p2.transaction_id,
                            p2.printer2_receipt_number,
                            p2.print_mode || 'auto',
                            p2.cycle_number || null,
                            p2.global_counter || null,
                            p2.printed_at,
                            p2.printed_at_epoch,
                            p2.is_reprint || 0,
                            p2.reprint_count || 0,
                            p2.synced_at || Date.now()
                        ]
                    });
                }
                await (0, mysqlDb_1.executeTransaction)(p2Queries);
                stats.printer2AuditLog = data.printer2AuditLog.length;
                console.log(`✅ [RESTORE] ${data.printer2AuditLog.length} printer 2 audit logs restored`);
            }
        }
        console.log('✅ [RESTORE] Full restore completed successfully!');
        console.log('📊 [RESTORE] Stats:', stats);
        return {
            success: true,
            message: 'Database restored successfully',
            stats
        };
    }
    catch (error) {
        console.error('❌ [RESTORE] Restore failed:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error during restore',
            stats
        };
    }
});
// IPC handlers for Restaurant Table Layout
electron_1.ipcMain.handle('get-restaurant-rooms', async (event, businessId) => {
    try {
        const query = `
      SELECT 
        rr.id,
        rr.business_id,
        rr.name,
        rr.canvas_width,
        rr.canvas_height,
        rr.font_size_multiplier,
        rr.created_at,
        rr.updated_at,
        COUNT(rt.id) as table_count
      FROM restaurant_rooms rr
      LEFT JOIN restaurant_tables rt ON rr.id = rt.room_id
      WHERE rr.business_id = ?
      GROUP BY rr.id, rr.business_id, rr.name, rr.canvas_width, rr.canvas_height, rr.font_size_multiplier, rr.created_at, rr.updated_at
      ORDER BY rr.name ASC
    `;
        const result = await (0, mysqlDb_1.executeQuery)(query, [businessId]);
        return result;
    }
    catch (error) {
        console.error('Error getting restaurant rooms:', error);
        return [];
    }
});
electron_1.ipcMain.handle('get-restaurant-tables', async (event, roomId) => {
    try {
        const query = `
      SELECT * FROM restaurant_tables
      WHERE room_id = ?
      ORDER BY table_number ASC
    `;
        return await (0, mysqlDb_1.executeQuery)(query, [roomId]);
    }
    catch (error) {
        console.error('Error getting restaurant tables:', error);
        return [];
    }
});
electron_1.ipcMain.handle('get-restaurant-layout-elements', async (event, roomId) => {
    try {
        const query = `
      SELECT * FROM restaurant_layout_elements
      WHERE room_id = ?
      ORDER BY label ASC
    `;
        return await (0, mysqlDb_1.executeQuery)(query, [roomId]);
    }
    catch (error) {
        console.error('Error getting restaurant layout elements:', error);
        return [];
    }
});
// IPC handlers for syncing restaurant table layout data
electron_1.ipcMain.handle('localdb-upsert-restaurant-rooms', async (event, rows) => {
    try {
        const queries = [];
        let skippedCount = 0;
        for (const r of rows) {
            const getId = () => {
                const val = r.id;
                if (typeof val === 'number')
                    return val;
                if (typeof val === 'string') {
                    const num = Number(val);
                    return isNaN(num) ? null : num;
                }
                return null;
            };
            const getNumber = (key) => {
                const val = r[key];
                if (typeof val === 'number')
                    return val;
                if (typeof val === 'string') {
                    const num = Number(val);
                    return isNaN(num) ? null : num;
                }
                return null;
            };
            const getString = (key) => (typeof r[key] === 'string' ? r[key] : null);
            const getDate = (key) => {
                const val = r[key];
                if (val instanceof Date)
                    return val;
                if (typeof val === 'string' || typeof val === 'number')
                    return val;
                return null;
            };
            const roomId = getId();
            const businessId = getNumber('business_id');
            // Verify business_id exists before inserting (foreign key constraint)
            if (businessId) {
                try {
                    const businessExists = await (0, mysqlDb_1.executeQueryOne)('SELECT id FROM businesses WHERE id = ? LIMIT 1', [businessId]);
                    if (!businessExists) {
                        console.warn(`⚠️ [RESTAURANT ROOMS] Skipping room ${roomId}: business_id ${businessId} does not exist`);
                        skippedCount++;
                        continue;
                    }
                }
                catch (checkError) {
                    console.warn(`⚠️ [RESTAURANT ROOMS] Failed to verify business_id ${businessId}:`, checkError);
                    skippedCount++;
                    continue;
                }
            }
            const createdDate = getDate('created_at');
            const updatedDate = getDate('updated_at');
            const createdAt = createdDate ? (0, mysqlDb_1.toMySQLDateTime)(createdDate) : (0, mysqlDb_1.toMySQLDateTime)(new Date());
            const updatedAt = updatedDate ? (0, mysqlDb_1.toMySQLDateTime)(updatedDate) : (0, mysqlDb_1.toMySQLDateTime)(new Date());
            queries.push({
                sql: `INSERT INTO restaurant_rooms (
          id, business_id, name, canvas_width, canvas_height, font_size_multiplier, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          business_id=VALUES(business_id),
          name=VALUES(name),
          canvas_width=VALUES(canvas_width),
          canvas_height=VALUES(canvas_height),
          font_size_multiplier=VALUES(font_size_multiplier),
          created_at=VALUES(created_at),
          updated_at=VALUES(updated_at)`,
                params: [
                    roomId,
                    businessId,
                    getString('name'),
                    getNumber('canvas_width'),
                    getNumber('canvas_height'),
                    getNumber('font_size_multiplier') ?? 1.0,
                    createdAt,
                    updatedAt
                ]
            });
        }
        if (queries.length > 0) {
            await (0, mysqlDb_1.executeTransaction)(queries);
            if (skippedCount > 0) {
                console.log(`⚠️ [RESTAURANT ROOMS] Skipped ${skippedCount} rooms due to missing businesses`);
            }
        }
        else {
            console.warn(`⚠️ [RESTAURANT ROOMS] No valid rooms to insert (all ${rows.length} skipped)`);
        }
        return { success: true };
    }
    catch (error) {
        console.error('Error upserting restaurant rooms:', error);
        return { success: false };
    }
});
electron_1.ipcMain.handle('localdb-upsert-restaurant-tables', async (event, rows) => {
    try {
        const queries = [];
        let skippedCount = 0;
        for (const r of rows) {
            const getId = () => {
                const val = r.id;
                if (typeof val === 'number')
                    return val;
                if (typeof val === 'string') {
                    const num = Number(val);
                    return isNaN(num) ? null : num;
                }
                return null;
            };
            const getNumber = (key) => {
                const val = r[key];
                if (typeof val === 'number')
                    return val;
                if (typeof val === 'string') {
                    const num = Number(val);
                    return isNaN(num) ? null : num;
                }
                return null;
            };
            const getString = (key) => (typeof r[key] === 'string' ? r[key] : null);
            const getDate = (key) => {
                const val = r[key];
                if (val instanceof Date)
                    return val;
                if (typeof val === 'string' || typeof val === 'number')
                    return val;
                return null;
            };
            const tableId = getId();
            const roomId = getNumber('room_id');
            // Verify room_id exists before inserting (foreign key constraint)
            if (roomId) {
                try {
                    const roomExists = await (0, mysqlDb_1.executeQueryOne)('SELECT id FROM restaurant_rooms WHERE id = ? LIMIT 1', [roomId]);
                    if (!roomExists) {
                        console.warn(`⚠️ [RESTAURANT TABLES] Skipping table ${tableId}: room_id ${roomId} does not exist`);
                        skippedCount++;
                        continue;
                    }
                }
                catch (checkError) {
                    console.warn(`⚠️ [RESTAURANT TABLES] Failed to verify room_id ${roomId}:`, checkError);
                    skippedCount++;
                    continue;
                }
            }
            const createdDate = getDate('created_at');
            const updatedDate = getDate('updated_at');
            const createdAt = createdDate ? (0, mysqlDb_1.toMySQLDateTime)(createdDate) : (0, mysqlDb_1.toMySQLDateTime)(new Date());
            const updatedAt = updatedDate ? (0, mysqlDb_1.toMySQLDateTime)(updatedDate) : (0, mysqlDb_1.toMySQLDateTime)(new Date());
            queries.push({
                sql: `INSERT INTO restaurant_tables (
          id, room_id, table_number, position_x, position_y, width, height, capacity, shape, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          room_id=VALUES(room_id),
          table_number=VALUES(table_number),
          position_x=VALUES(position_x),
          position_y=VALUES(position_y),
          width=VALUES(width),
          height=VALUES(height),
          capacity=VALUES(capacity),
          shape=VALUES(shape),
          created_at=VALUES(created_at),
          updated_at=VALUES(updated_at)`,
                params: [
                    tableId,
                    roomId,
                    getString('table_number'),
                    getNumber('position_x') ?? 0.0,
                    getNumber('position_y') ?? 0.0,
                    getNumber('width') ?? 5.0,
                    getNumber('height') ?? 5.0,
                    getNumber('capacity') ?? 4,
                    getString('shape') ?? 'circle',
                    createdAt,
                    updatedAt
                ]
            });
        }
        if (queries.length > 0) {
            await (0, mysqlDb_1.executeTransaction)(queries);
            if (skippedCount > 0) {
                console.log(`⚠️ [RESTAURANT TABLES] Skipped ${skippedCount} tables due to missing rooms`);
            }
        }
        else {
            console.warn(`⚠️ [RESTAURANT TABLES] No valid tables to insert (all ${rows.length} skipped)`);
        }
        return { success: true };
    }
    catch (error) {
        console.error('Error upserting restaurant tables:', error);
        return { success: false };
    }
});
electron_1.ipcMain.handle('localdb-upsert-restaurant-layout-elements', async (event, rows) => {
    try {
        const queries = [];
        let skippedCount = 0;
        for (const r of rows) {
            const getId = () => {
                const val = r.id;
                if (typeof val === 'number')
                    return val;
                if (typeof val === 'string') {
                    const num = Number(val);
                    return isNaN(num) ? null : num;
                }
                return null;
            };
            const getNumber = (key) => {
                const val = r[key];
                if (typeof val === 'number')
                    return val;
                if (typeof val === 'string') {
                    const num = Number(val);
                    return isNaN(num) ? null : num;
                }
                return null;
            };
            const getString = (key) => (typeof r[key] === 'string' ? r[key] : null);
            const getDate = (key) => {
                const val = r[key];
                if (val instanceof Date)
                    return val;
                if (typeof val === 'string' || typeof val === 'number')
                    return val;
                return null;
            };
            const elementId = getId();
            const roomId = getNumber('room_id');
            // Verify room_id exists before inserting (foreign key constraint)
            if (roomId) {
                try {
                    const roomExists = await (0, mysqlDb_1.executeQueryOne)('SELECT id FROM restaurant_rooms WHERE id = ? LIMIT 1', [roomId]);
                    if (!roomExists) {
                        console.warn(`⚠️ [RESTAURANT LAYOUT ELEMENTS] Skipping element ${elementId}: room_id ${roomId} does not exist`);
                        skippedCount++;
                        continue;
                    }
                }
                catch (checkError) {
                    console.warn(`⚠️ [RESTAURANT LAYOUT ELEMENTS] Failed to verify room_id ${roomId}:`, checkError);
                    skippedCount++;
                    continue;
                }
            }
            const createdDate = getDate('created_at');
            const updatedDate = getDate('updated_at');
            const createdAt = createdDate ? (0, mysqlDb_1.toMySQLDateTime)(createdDate) : (0, mysqlDb_1.toMySQLDateTime)(new Date());
            const updatedAt = updatedDate ? (0, mysqlDb_1.toMySQLDateTime)(updatedDate) : (0, mysqlDb_1.toMySQLDateTime)(new Date());
            queries.push({
                sql: `INSERT INTO restaurant_layout_elements (
          id, room_id, label, position_x, position_y, width, height, element_type, color, text_color, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          room_id=VALUES(room_id),
          label=VALUES(label),
          position_x=VALUES(position_x),
          position_y=VALUES(position_y),
          width=VALUES(width),
          height=VALUES(height),
          element_type=VALUES(element_type),
          color=VALUES(color),
          text_color=VALUES(text_color),
          created_at=VALUES(created_at),
          updated_at=VALUES(updated_at)`,
                params: [
                    elementId,
                    roomId,
                    getString('label'),
                    getNumber('position_x') ?? 0.0,
                    getNumber('position_y') ?? 0.0,
                    getNumber('width') ?? 4.0,
                    getNumber('height') ?? 4.0,
                    getString('element_type') ?? 'custom',
                    getString('color') ?? '#9CA3AF',
                    getString('text_color') ?? '#000000',
                    createdAt,
                    updatedAt
                ]
            });
        }
        if (queries.length === 0) {
            console.log('[IPC] localdb-upsert-restaurant-layout-elements: No valid queries to execute');
            return { success: true, skipped: skippedCount };
        }
        await (0, mysqlDb_1.executeTransaction)(queries);
        console.log('[IPC] localdb-upsert-restaurant-layout-elements transaction completed:', { queriesExecuted: queries.length, skippedCount, totalRows: Array.isArray(rows) ? rows.length : 0 });
        return { success: true, skipped: skippedCount };
    }
    catch (error) {
        console.error('[IPC] localdb-upsert-restaurant-layout-elements error details:', { error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined, rowCount: Array.isArray(rows) ? rows.length : 'not array' });
        return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
});
