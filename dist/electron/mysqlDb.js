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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeMySQLPool = initializeMySQLPool;
exports.getMySQLPool = getMySQLPool;
exports.toMySQLDateTime = toMySQLDateTime;
exports.toMySQLTimestamp = toMySQLTimestamp;
exports.executeQuery = executeQuery;
exports.executeQueryOne = executeQueryOne;
exports.executeUpdate = executeUpdate;
exports.executeTransaction = executeTransaction;
exports.executeUpsert = executeUpsert;
exports.getConnection = getConnection;
exports.initializeSystemPosPool = initializeSystemPosPool;
exports.getSystemPosPool = getSystemPosPool;
exports.executeSystemPosQuery = executeSystemPosQuery;
exports.executeSystemPosQueryOne = executeSystemPosQueryOne;
exports.executeSystemPosUpdate = executeSystemPosUpdate;
exports.executeSystemPosTransaction = executeSystemPosTransaction;
exports.testDatabaseConnection = testDatabaseConnection;
exports.insertTransactionToSystemPos = insertTransactionToSystemPos;
exports.closeMySQLPool = closeMySQLPool;
const promise_1 = __importDefault(require("mysql2/promise"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const electron_1 = require("electron");
const configManager_1 = require("./configManager");
/**
 * MySQL Database Helper Module
 * Provides helper functions for executing MySQL queries, updates, and transactions
 */
let mysqlPool = null; // Main database: salespulse
let systemPosPool = null; // Printer 2 transactions: system_pos
/**
 * Initialize MySQL connection pool
 */
function initializeMySQLPool() {
    if (mysqlPool) {
        return mysqlPool;
    }
    // Load environment variables
    try {
        const dotenv = require('dotenv');
        const possibleEnvPaths = [
            path.join(process.cwd(), '.env'),
            path.join(electron_1.app.getAppPath(), '.env'),
            path.join(path.dirname(electron_1.app.getPath('exe')), '.env')
        ];
        let envLoaded = false;
        for (const envPath of possibleEnvPaths) {
            if (fs.existsSync(envPath)) {
                dotenv.config({ path: envPath });
                envLoaded = true;
                break;
            }
        }
        if (!envLoaded) {
            console.warn('⚠️ No .env file found for MySQL credentials, falling back to defaults');
        }
    }
    catch (dotenvErr) {
        console.warn('⚠️ dotenv module not available, using environment defaults');
    }
    // Get database config from runtime config (with fallback to env vars)
    const dbConfig = (0, configManager_1.getDbConfig)();
    mysqlPool = promise_1.default.createPool({
        host: dbConfig.host,
        user: dbConfig.user,
        password: dbConfig.password,
        database: dbConfig.database,
        port: dbConfig.port,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        enableKeepAlive: true,
        keepAliveInitialDelay: 0
    });
    // Test connection
    mysqlPool.getConnection()
        .then(conn => {
        console.log('✅ MySQL connection pool initialized successfully');
        conn.release();
    })
        .catch(err => {
        console.error('❌ MySQL connection pool initialization failed:', err);
    });
    return mysqlPool;
}
/**
 * Get MySQL connection pool
 */
function getMySQLPool() {
    if (!mysqlPool) {
        return initializeMySQLPool();
    }
    return mysqlPool;
}
/**
 * Convert Date, ISO string, or Unix timestamp to MySQL DATETIME format ('YYYY-MM-DD HH:MM:SS')
 * Explicitly converts to UTC+7 (WIB - Western Indonesian Time) to match VPS database timezone
 */
function toMySQLDateTime(date) {
    if (date === null || date === undefined) {
        return null;
    }
    let dateObj;
    if (typeof date === 'number') {
        // Unix timestamp (milliseconds)
        dateObj = new Date(date);
    }
    else if (typeof date === 'string') {
        // ISO string or other date string
        dateObj = new Date(date);
    }
    else {
        // Already a Date object
        dateObj = date;
    }
    // Check if date is valid
    if (isNaN(dateObj.getTime())) {
        console.warn('⚠️ Invalid date provided to toMySQLDateTime:', date);
        return null;
    }
    // Convert to UTC+7 (WIB - Western Indonesian Time)
    // Add 7 hours (7 * 60 * 60 * 1000 milliseconds) to UTC time
    const utc7Timestamp = dateObj.getTime() + (7 * 60 * 60 * 1000);
    const utc7Date = new Date(utc7Timestamp);
    // Format as 'YYYY-MM-DD HH:MM:SS' using UTC+7 components
    const year = utc7Date.getUTCFullYear();
    const month = String(utc7Date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(utc7Date.getUTCDate()).padStart(2, '0');
    const hours = String(utc7Date.getUTCHours()).padStart(2, '0');
    const minutes = String(utc7Date.getUTCMinutes()).padStart(2, '0');
    const seconds = String(utc7Date.getUTCSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}
/**
 * Convert Date, ISO string, or Unix timestamp to MySQL TIMESTAMP format ('YYYY-MM-DD HH:MM:SS')
 * Same as toMySQLDateTime but kept separate for clarity
 */
function toMySQLTimestamp(date) {
    return toMySQLDateTime(date);
}
/**
 * Execute a SELECT query and return results
 */
async function executeQuery(sql, params = []) {
    const pool = getMySQLPool();
    try {
        const [results] = await pool.execute(sql, params);
        return results;
    }
    catch (error) {
        console.error('❌ MySQL query error:', error);
        console.error('SQL:', sql);
        console.error('Params:', params);
        throw error;
    }
}
/**
 * Execute a SELECT query and return first result
 */
async function executeQueryOne(sql, params = []) {
    const results = await executeQuery(sql, params);
    return results.length > 0 ? results[0] : null;
}
/**
 * Execute an INSERT, UPDATE, or DELETE query
 * Returns the affected rows count
 */
async function executeUpdate(sql, params = []) {
    const pool = getMySQLPool();
    try {
        const [result] = await pool.execute(sql, params);
        return result.affectedRows;
    }
    catch (error) {
        console.error('❌ MySQL update error:', error);
        console.error('SQL:', sql);
        console.error('Params:', params);
        throw error;
    }
}
/**
 * Execute multiple queries in a transaction
 */
async function executeTransaction(queries) {
    const pool = getMySQLPool();
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        console.log(`🔄 [TRANSACTION] Started transaction with ${queries.length} queries`);
        for (let i = 0; i < queries.length; i++) {
            const { sql, params = [] } = queries[i];
            try {
                const [result] = await connection.execute(sql, params);
                if (i < 5 || i === queries.length - 1) {
                    // Log first 5 and last query for debugging
                    console.log(`  ✓ Query ${i + 1}/${queries.length}: ${result.affectedRows} rows affected`);
                }
            }
            catch (queryError) {
                console.error(`❌ [TRANSACTION] Query ${i + 1} failed:`, queryError);
                console.error(`  SQL: ${sql.substring(0, 200)}...`);
                throw queryError;
            }
        }
        await connection.commit();
        console.log(`✅ [TRANSACTION] Committed successfully - ${queries.length} queries executed`);
    }
    catch (error) {
        await connection.rollback();
        console.error('❌ [TRANSACTION] Error occurred, rolling back:', error);
        console.error('❌ [TRANSACTION] Error details:', {
            message: error instanceof Error ? error.message : String(error),
            code: error?.code,
            errno: error?.errno,
            sqlState: error?.sqlState,
            queryCount: queries.length
        });
        throw error;
    }
    finally {
        connection.release();
    }
}
/**
 * Execute an INSERT ... ON DUPLICATE KEY UPDATE query (upsert)
 */
async function executeUpsert(sql, params = []) {
    const pool = getMySQLPool();
    try {
        const [result] = await pool.execute(sql, params);
        return {
            inserted: result.affectedRows > 0 && result.insertId > 0,
            updated: result.affectedRows > 0 && result.insertId === 0
        };
    }
    catch (error) {
        console.error('❌ MySQL upsert error:', error);
        console.error('SQL:', sql);
        console.error('Params:', params);
        throw error;
    }
}
/**
 * Get a connection from the pool (for advanced operations)
 */
async function getConnection() {
    const pool = getMySQLPool();
    return pool.getConnection();
}
/**
 * Initialize System POS MySQL connection pool (for printer 2 transactions)
 */
function initializeSystemPosPool() {
    if (systemPosPool) {
        return systemPosPool;
    }
    // Load environment variables (same as main pool)
    try {
        const dotenv = require('dotenv');
        const possibleEnvPaths = [
            path.join(process.cwd(), '.env'),
            path.join(electron_1.app.getAppPath(), '.env'),
            path.join(path.dirname(electron_1.app.getPath('exe')), '.env')
        ];
        let envLoaded = false;
        for (const envPath of possibleEnvPaths) {
            if (fs.existsSync(envPath)) {
                dotenv.config({ path: envPath });
                envLoaded = true;
                break;
            }
        }
        if (!envLoaded) {
            console.warn('⚠️ No .env file found for MySQL credentials, falling back to defaults');
        }
    }
    catch (dotenvErr) {
        console.warn('⚠️ dotenv module not available, using environment defaults');
    }
    systemPosPool = promise_1.default.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: 'system_pos', // Always use system_pos database for printer 2 transactions
        port: parseInt(process.env.DB_PORT || '3306'),
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        enableKeepAlive: true,
        keepAliveInitialDelay: 0
    });
    // Test connection
    systemPosPool.getConnection()
        .then(conn => {
        console.log('✅ System POS MySQL connection pool initialized successfully');
        conn.release();
    })
        .catch(err => {
        console.error('❌ System POS MySQL connection pool initialization failed:', err);
    });
    return systemPosPool;
}
/**
 * Get System POS MySQL connection pool
 */
function getSystemPosPool() {
    if (!systemPosPool) {
        return initializeSystemPosPool();
    }
    return systemPosPool;
}
/**
 * Execute a SELECT query on System POS database and return results
 */
async function executeSystemPosQuery(sql, params = []) {
    const pool = getSystemPosPool();
    try {
        const [results] = await pool.execute(sql, params);
        return results;
    }
    catch (error) {
        console.error('❌ System POS MySQL query error:', error);
        console.error('SQL:', sql);
        console.error('Params:', params);
        throw error;
    }
}
/**
 * Execute a SELECT query on System POS database and return first result
 */
async function executeSystemPosQueryOne(sql, params = []) {
    const results = await executeSystemPosQuery(sql, params);
    return results.length > 0 ? results[0] : null;
}
/**
 * Execute an INSERT, UPDATE, or DELETE query on System POS database
 * Returns the affected rows count
 */
async function executeSystemPosUpdate(sql, params = []) {
    const pool = getSystemPosPool();
    try {
        const [result] = await pool.execute(sql, params);
        return result.affectedRows;
    }
    catch (error) {
        console.error('❌ System POS MySQL update error:', error);
        console.error('SQL:', sql);
        console.error('Params:', params);
        throw error;
    }
}
/**
 * Execute multiple queries in a transaction on System POS database
 */
async function executeSystemPosTransaction(queries) {
    const pool = getSystemPosPool();
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        for (const { sql, params = [] } of queries) {
            await connection.execute(sql, params);
        }
        await connection.commit();
    }
    catch (error) {
        await connection.rollback();
        console.error('❌ System POS MySQL transaction error:', error);
        throw error;
    }
    finally {
        connection.release();
    }
}
/**
 * Test database connection with provided config
 */
async function testDatabaseConnection(config) {
    const host = config.serverHost || 'localhost';
    const user = config.dbUser || 'root';
    const password = config.dbPassword || '';
    const database = config.dbName || 'salespulse';
    const port = config.dbPort || 3306;
    let testConnection = null;
    try {
        // Create a temporary connection pool for testing
        const testPool = promise_1.default.createPool({
            host,
            user,
            password,
            database,
            port,
            waitForConnections: true,
            connectionLimit: 1,
            queueLimit: 0,
            connectTimeout: 5000, // 5 second timeout
        });
        // Try to get a connection
        testConnection = await testPool.getConnection();
        // Test with a simple query
        await testConnection.query('SELECT 1');
        // Clean up
        testConnection.release();
        await testPool.end();
        return {
            success: true,
            message: `Berhasil terhubung ke database ${database} di ${host}:${port}`
        };
    }
    catch (error) {
        // Clean up on error
        if (testConnection) {
            try {
                testConnection.release();
            }
            catch (e) {
                // Ignore cleanup errors
            }
        }
        let errorMessage = 'Gagal terhubung ke database';
        if (error.code === 'ECONNREFUSED') {
            errorMessage = `Tidak dapat terhubung ke server ${host}:${port}. Pastikan server MySQL berjalan dan dapat diakses.`;
        }
        else if (error.code === 'ER_ACCESS_DENIED_ERROR' || error.code === 'ER_NOT_SUPPORTED_AUTH_MODE') {
            // Check if it's a network connection issue
            const isNetworkConnection = host !== 'localhost' && host !== '127.0.0.1';
            if (isNetworkConnection) {
                errorMessage = `Username atau password salah untuk koneksi jaringan ke ${host}.\n\n` +
                    `Kemungkinan penyebab:\n` +
                    `1. User '${user}' belum dibuat untuk koneksi dari IP ${host}\n` +
                    `2. Password berbeda untuk user network vs localhost\n\n` +
                    `Solusi: Di MySQL server, jalankan:\n` +
                    `CREATE USER '${user}'@'${host}' IDENTIFIED BY 'password_yang_sama';\n` +
                    `GRANT ALL PRIVILEGES ON ${database}.* TO '${user}'@'${host}';\n` +
                    `FLUSH PRIVILEGES;\n\n` +
                    `Atau untuk seluruh subnet:\n` +
                    `CREATE USER '${user}'@'192.168.1.%' IDENTIFIED BY 'password_yang_sama';\n` +
                    `GRANT ALL PRIVILEGES ON ${database}.* TO '${user}'@'192.168.1.%';\n` +
                    `FLUSH PRIVILEGES;`;
            }
            else {
                errorMessage = 'Username atau password salah. Periksa kredensial database.';
            }
        }
        else if (error.code === 'ER_BAD_DB_ERROR') {
            errorMessage = `Database "${database}" tidak ditemukan. Pastikan database sudah dibuat.`;
        }
        else if (error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
            errorMessage = `Tidak dapat mencapai server ${host}. Periksa alamat server dan koneksi jaringan.`;
        }
        else if (error.message && error.message.includes('is not allowed to connect')) {
            // MySQL host not allowed error
            const hostMatch = error.message.match(/Host '([^']+)' is not allowed/);
            const blockedHost = hostMatch ? hostMatch[1] : 'hostname/IP Anda';
            errorMessage = `Host '${blockedHost}' tidak diizinkan untuk terhubung ke MySQL server.\n\n` +
                `Solusi: Jalankan perintah berikut di MySQL sebagai root:\n` +
                `CREATE USER '${user}'@'${blockedHost}' IDENTIFIED BY 'password';\n` +
                `GRANT ALL PRIVILEGES ON ${database}.* TO '${user}'@'${blockedHost}';\n` +
                `FLUSH PRIVILEGES;\n\n` +
                `Atau gunakan IP address (${host}) sebagai ganti hostname.`;
        }
        else if (error.message) {
            errorMessage = error.message;
        }
        return {
            success: false,
            error: errorMessage
        };
    }
}
/**
 * Helper function to convert unknown values to MySQL parameter types
 */
function convertToMySQLParam(value) {
    if (value === null || value === undefined) {
        return null;
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return value;
    }
    if (value instanceof Date) {
        return toMySQLDateTime(value) || null;
    }
    // Convert other types to string
    return String(value);
}
/**
 * Insert complete transaction data into system_pos database
 * Fetches transaction and all related data from salespulse DB and inserts into system_pos DB
 */
async function insertTransactionToSystemPos(transactionId) {
    const mainPool = getMySQLPool();
    const systemPosPool = getSystemPosPool();
    try {
        // Step 1: Check if transaction already exists in system_pos (deduplication)
        const existingTx = await executeSystemPosQueryOne('SELECT id FROM transactions WHERE uuid_id = ?', [transactionId]);
        if (existingTx) {
            console.log(`⏭️ [SYSTEM POS] Transaction ${transactionId} already exists in system_pos, skipping insertion`);
            return { success: true, skipped: true };
        }
        // Step 2: Fetch transaction from salespulse DB
        const transaction = await executeQueryOne('SELECT * FROM transactions WHERE uuid_id = ?', [transactionId]);
        if (!transaction) {
            return { success: false, error: `Transaction ${transactionId} not found in salespulse DB` };
        }
        // Step 3: Fetch transaction items
        const items = await executeQuery('SELECT * FROM transaction_items WHERE uuid_transaction_id = ? ORDER BY id ASC', [transactionId]);
        // Step 4: Fetch customizations and options
        const itemIds = items.map(item => item.id).filter((id) => typeof id === 'number');
        let customizations = [];
        let customizationOptions = [];
        if (itemIds.length > 0) {
            const placeholders = itemIds.map(() => '?').join(',');
            customizations = await executeQuery(`SELECT * FROM transaction_item_customizations WHERE transaction_item_id IN (${placeholders})`, itemIds);
            if (customizations.length > 0) {
                const customizationIds = customizations.map(c => c.id).filter((id) => typeof id === 'number');
                if (customizationIds.length > 0) {
                    const optionPlaceholders = customizationIds.map(() => '?').join(',');
                    customizationOptions = await executeQuery(`SELECT * FROM transaction_item_customization_options WHERE transaction_item_customization_id IN (${optionPlaceholders})`, customizationIds);
                }
            }
        }
        // Step 5: Fetch refunds
        const refunds = await executeQuery('SELECT * FROM transaction_refunds WHERE transaction_uuid = ? ORDER BY refunded_at DESC', [transactionId]);
        // Step 6: Fetch shift if exists
        let shift = null;
        if (transaction.shift_uuid && typeof transaction.shift_uuid === 'string') {
            shift = await executeQueryOne('SELECT * FROM shifts WHERE uuid_id = ?', [transaction.shift_uuid]);
        }
        // Step 7: Check and insert missing products
        const productIds = items
            .map(item => item.product_id)
            .filter((id) => typeof id === 'number' && id > 0);
        const uniqueProductIds = [...new Set(productIds)];
        let productsInserted = 0;
        let productsFailed = 0;
        let productsSkipped = 0;
        for (const productId of uniqueProductIds) {
            const existingProduct = await executeSystemPosQueryOne('SELECT id FROM products WHERE id = ?', [productId]);
            if (!existingProduct) {
                // Fetch product from salespulse DB
                const product = await executeQueryOne('SELECT * FROM products WHERE id = ?', [productId]);
                if (product) {
                    try {
                        // Insert product into system_pos
                        // Build INSERT statement with all product fields
                        const productFields = Object.keys(product).filter(key => key !== 'id' || product.id === productId);
                        const productValues = productFields.map(field => convertToMySQLParam(product[field]));
                        const productPlaceholders = productFields.map(() => '?').join(', ');
                        await executeSystemPosUpdate(`INSERT INTO products (${productFields.join(', ')}) VALUES (${productPlaceholders})`, productValues);
                        productsInserted++;
                        console.log(`✅ [SYSTEM POS] Inserted missing product ${productId} into system_pos`);
                    }
                    catch (productError) {
                        productsFailed++;
                        const errorMsg = productError instanceof Error ? productError.message : String(productError);
                        console.error(`⚠️ [SYSTEM POS] Failed to insert product ${productId}:`, errorMsg);
                        // Continue with transaction insertion even if product insert fails
                    }
                }
                else {
                    productsFailed++;
                    console.warn(`⚠️ [SYSTEM POS] Product ${productId} not found in salespulse DB, transaction may fail`);
                }
            }
            else {
                productsSkipped++;
            }
        }
        // Step 8: Insert all data into system_pos DB using transaction
        const queries = [];
        // Insert transaction
        const txFields = Object.keys(transaction);
        const txValues = txFields.map(field => convertToMySQLParam(transaction[field]));
        const txPlaceholders = txFields.map(() => '?').join(', ');
        queries.push({
            sql: `INSERT INTO transactions (${txFields.join(', ')}) VALUES (${txPlaceholders})`,
            params: txValues
        });
        // Insert transaction items
        for (const item of items) {
            const itemFields = Object.keys(item);
            const itemValues = itemFields.map(field => convertToMySQLParam(item[field]));
            const itemPlaceholders = itemFields.map(() => '?').join(', ');
            queries.push({
                sql: `INSERT INTO transaction_items (${itemFields.join(', ')}) VALUES (${itemPlaceholders})`,
                params: itemValues
            });
        }
        // Insert customizations
        for (const customization of customizations) {
            const custFields = Object.keys(customization);
            const custValues = custFields.map(field => convertToMySQLParam(customization[field]));
            const custPlaceholders = custFields.map(() => '?').join(', ');
            queries.push({
                sql: `INSERT INTO transaction_item_customizations (${custFields.join(', ')}) VALUES (${custPlaceholders})`,
                params: custValues
            });
        }
        // Insert customization options
        for (const option of customizationOptions) {
            const optFields = Object.keys(option);
            const optValues = optFields.map(field => convertToMySQLParam(option[field]));
            const optPlaceholders = optFields.map(() => '?').join(', ');
            queries.push({
                sql: `INSERT INTO transaction_item_customization_options (${optFields.join(', ')}) VALUES (${optPlaceholders})`,
                params: optValues
            });
        }
        // Insert refunds
        for (const refund of refunds) {
            const refundFields = Object.keys(refund);
            const refundValues = refundFields.map(field => convertToMySQLParam(refund[field]));
            const refundPlaceholders = refundFields.map(() => '?').join(', ');
            queries.push({
                sql: `INSERT INTO transaction_refunds (${refundFields.join(', ')}) VALUES (${refundPlaceholders})`,
                params: refundValues
            });
        }
        // Insert shift if exists
        if (shift) {
            const shiftFields = Object.keys(shift);
            const shiftValues = shiftFields.map(field => convertToMySQLParam(shift[field]));
            const shiftPlaceholders = shiftFields.map(() => '?').join(', ');
            queries.push({
                sql: `INSERT INTO shifts (${shiftFields.join(', ')}) VALUES (${shiftPlaceholders}) ON DUPLICATE KEY UPDATE uuid_id = uuid_id`,
                params: shiftValues
            });
        }
        // Execute all inserts in a transaction
        if (queries.length > 0) {
            await executeSystemPosTransaction(queries);
            console.log(`✅ [SYSTEM POS] Successfully inserted transaction ${transactionId} with ${items.length} items, ${customizations.length} customizations, ${refunds.length} refunds${shift ? ', 1 shift' : ''}`);
        }
        return { success: true };
    }
    catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`❌ [SYSTEM POS] Error inserting transaction ${transactionId} into system_pos:`, errorMsg);
        if (error instanceof Error && error.stack) {
            console.error(`❌ [SYSTEM POS] Stack trace:`, error.stack);
        }
        return { success: false, error: errorMsg };
    }
}
/**
 * Close the MySQL connection pools
 */
async function closeMySQLPool() {
    if (mysqlPool) {
        await mysqlPool.end();
        mysqlPool = null;
        console.log('✅ Main MySQL connection pool closed');
    }
    if (systemPosPool) {
        await systemPosPool.end();
        systemPosPool = null;
        console.log('✅ System POS MySQL connection pool closed');
    }
}
