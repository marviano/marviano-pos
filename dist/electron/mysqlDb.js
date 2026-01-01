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
        for (const { sql, params = [] } of queries) {
            await connection.execute(sql, params);
        }
        await connection.commit();
    }
    catch (error) {
        await connection.rollback();
        console.error('❌ MySQL transaction error:', error);
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
