import mysql, { Pool, PoolConnection } from 'mysql2/promise';
import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import { getDbConfig } from './configManager';

/**
 * MySQL Database Helper Module
 * Provides helper functions for executing MySQL queries, updates, and transactions
 */

let mysqlPool: Pool | null = null; // Main database: salespulse
let systemPosPool: Pool | null = null; // Printer 2 transactions: system_pos

/**
 * Initialize MySQL connection pool
 */
export function initializeMySQLPool(): Pool {
  if (mysqlPool) {
    return mysqlPool;
  }

  // Load environment variables
  try {
    const dotenv = require('dotenv');
    const possibleEnvPaths = [
      path.join(process.cwd(), '.env'),
      path.join(app.getAppPath(), '.env'),
      path.join(path.dirname(app.getPath('exe')), '.env')
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
  } catch (dotenvErr) {
    console.warn('⚠️ dotenv module not available, using environment defaults');
  }

  // Get database config from runtime config (with fallback to env vars)
  const dbConfig = getDbConfig();
  
  mysqlPool = mysql.createPool({
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
export function getMySQLPool(): Pool {
  if (!mysqlPool) {
    return initializeMySQLPool();
  }
  return mysqlPool;
}

/**
 * Convert Date, ISO string, or Unix timestamp to MySQL DATETIME format ('YYYY-MM-DD HH:MM:SS')
 * Explicitly converts to UTC+7 (WIB - Western Indonesian Time) to match VPS database timezone
 */
export function toMySQLDateTime(date: Date | string | number | null | undefined): string | null {
  if (date === null || date === undefined) {
    return null;
  }

  let dateObj: Date;
  
  if (typeof date === 'number') {
    // Unix timestamp (milliseconds)
    dateObj = new Date(date);
  } else if (typeof date === 'string') {
    // ISO string or other date string
    dateObj = new Date(date);
  } else {
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
export function toMySQLTimestamp(date: Date | string | number | null | undefined): string | null {
  return toMySQLDateTime(date);
}

/**
 * Execute a SELECT query and return results
 */
export async function executeQuery<T = unknown>(
  sql: string,
  params: (string | number | null | boolean)[] = []
): Promise<T[]> {
  const pool = getMySQLPool();
  try {
    const [results] = await pool.execute(sql, params);
    return results as T[];
  } catch (error) {
    console.error('❌ MySQL query error:', error);
    console.error('SQL:', sql);
    console.error('Params:', params);
    throw error;
  }
}

/**
 * Execute a SELECT query and return first result
 */
export async function executeQueryOne<T = unknown>(
  sql: string,
  params: (string | number | null | boolean)[] = []
): Promise<T | null> {
  const results = await executeQuery<T>(sql, params);
  return results.length > 0 ? results[0] : null;
}

/**
 * Execute an INSERT, UPDATE, or DELETE query
 * Returns the affected rows count
 */
export async function executeUpdate(
  sql: string,
  params: (string | number | null | boolean)[] = []
): Promise<number> {
  const pool = getMySQLPool();
  try {
    const [result] = await pool.execute(sql, params) as [mysql.ResultSetHeader, unknown];
    return result.affectedRows;
  } catch (error) {
    console.error('❌ MySQL update error:', error);
    console.error('SQL:', sql);
    console.error('Params:', params);
    throw error;
  }
}

/**
 * Execute multiple queries in a transaction
 */
export async function executeTransaction(
  queries: Array<{ sql: string; params?: (string | number | null | boolean)[] }>
): Promise<void> {
  const pool = getMySQLPool();
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();
    console.log(`🔄 [TRANSACTION] Started transaction with ${queries.length} queries`);
    
    for (let i = 0; i < queries.length; i++) {
      const { sql, params = [] } = queries[i];
      try {
        const [result] = await connection.execute(sql, params) as [mysql.ResultSetHeader, unknown];
        if (i < 5 || i === queries.length - 1) {
          // Log first 5 and last query for debugging
          console.log(`  ✓ Query ${i + 1}/${queries.length}: ${result.affectedRows} rows affected`);
        }
      } catch (queryError) {
        console.error(`❌ [TRANSACTION] Query ${i + 1} failed:`, queryError);
        console.error(`  SQL: ${sql.substring(0, 200)}...`);
        throw queryError;
      }
    }
    
    await connection.commit();
    console.log(`✅ [TRANSACTION] Committed successfully - ${queries.length} queries executed`);
  } catch (error) {
    await connection.rollback();
    console.error('❌ [TRANSACTION] Error occurred, rolling back:', error);
    console.error('❌ [TRANSACTION] Error details:', {
      message: error instanceof Error ? error.message : String(error),
      code: (error as any)?.code,
      errno: (error as any)?.errno,
      sqlState: (error as any)?.sqlState,
      queryCount: queries.length
    });
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Execute an INSERT ... ON DUPLICATE KEY UPDATE query (upsert)
 */
export async function executeUpsert(
  sql: string,
  params: (string | number | null | boolean)[] = []
): Promise<{ inserted: boolean; updated: boolean }> {
  const pool = getMySQLPool();
  try {
    const [result] = await pool.execute(sql, params) as [mysql.ResultSetHeader, unknown];
    return {
      inserted: result.affectedRows > 0 && result.insertId > 0,
      updated: result.affectedRows > 0 && result.insertId === 0
    };
  } catch (error) {
    console.error('❌ MySQL upsert error:', error);
    console.error('SQL:', sql);
    console.error('Params:', params);
    throw error;
  }
}

/**
 * Get a connection from the pool (for advanced operations)
 */
export async function getConnection(): Promise<PoolConnection> {
  const pool = getMySQLPool();
  return pool.getConnection();
}

/**
 * Initialize System POS MySQL connection pool (for printer 2 transactions)
 */
export function initializeSystemPosPool(): Pool {
  if (systemPosPool) {
    return systemPosPool;
  }

  // Load environment variables (same as main pool)
  try {
    const dotenv = require('dotenv');
    const possibleEnvPaths = [
      path.join(process.cwd(), '.env'),
      path.join(app.getAppPath(), '.env'),
      path.join(path.dirname(app.getPath('exe')), '.env')
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
  } catch (dotenvErr) {
    console.warn('⚠️ dotenv module not available, using environment defaults');
  }

  systemPosPool = mysql.createPool({
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
export function getSystemPosPool(): Pool {
  if (!systemPosPool) {
    return initializeSystemPosPool();
  }
  return systemPosPool;
}

/**
 * Execute a SELECT query on System POS database and return results
 */
export async function executeSystemPosQuery<T = unknown>(
  sql: string,
  params: (string | number | null | boolean)[] = []
): Promise<T[]> {
  const pool = getSystemPosPool();
  try {
    const [results] = await pool.execute(sql, params);
    return results as T[];
  } catch (error) {
    console.error('❌ System POS MySQL query error:', error);
    console.error('SQL:', sql);
    console.error('Params:', params);
    throw error;
  }
}

/**
 * Execute a SELECT query on System POS database and return first result
 */
export async function executeSystemPosQueryOne<T = unknown>(
  sql: string,
  params: (string | number | null | boolean)[] = []
): Promise<T | null> {
  const results = await executeSystemPosQuery<T>(sql, params);
  return results.length > 0 ? results[0] : null;
}

/**
 * Execute an INSERT, UPDATE, or DELETE query on System POS database
 * Returns the affected rows count
 */
export async function executeSystemPosUpdate(
  sql: string,
  params: (string | number | null | boolean)[] = []
): Promise<number> {
  const pool = getSystemPosPool();
  try {
    const [result] = await pool.execute(sql, params) as [mysql.ResultSetHeader, unknown];
    return result.affectedRows;
  } catch (error) {
    console.error('❌ System POS MySQL update error:', error);
    console.error('SQL:', sql);
    console.error('Params:', params);
    throw error;
  }
}

/**
 * Execute multiple queries in a transaction on System POS database
 */
export async function executeSystemPosTransaction(
  queries: Array<{ sql: string; params?: (string | number | null | boolean)[] }>
): Promise<void> {
  const pool = getSystemPosPool();
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();
    
    for (const { sql, params = [] } of queries) {
      await connection.execute(sql, params);
    }
    
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    console.error('❌ System POS MySQL transaction error:', error);
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Test database connection with provided config
 */
export async function testDatabaseConnection(config: {
  serverHost?: string;
  dbUser?: string;
  dbPassword?: string;
  dbName?: string;
  dbPort?: number;
}): Promise<{ success: boolean; message?: string; error?: string }> {
  const host = config.serverHost || 'localhost';
  const user = config.dbUser || 'root';
  const password = config.dbPassword || '';
  const database = config.dbName || 'salespulse';
  const port = config.dbPort || 3306;

  let testConnection: PoolConnection | null = null;
  
  try {
    // Create a temporary connection pool for testing
    const testPool = mysql.createPool({
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
  } catch (error: any) {
    // Clean up on error
    if (testConnection) {
      try {
        testConnection.release();
      } catch (e) {
        // Ignore cleanup errors
      }
    }
    
    let errorMessage = 'Gagal terhubung ke database';
    if (error.code === 'ECONNREFUSED') {
      errorMessage = `Tidak dapat terhubung ke server ${host}:${port}. Pastikan server MySQL berjalan dan dapat diakses.`;
    } else if (error.code === 'ER_ACCESS_DENIED_ERROR' || error.code === 'ER_NOT_SUPPORTED_AUTH_MODE') {
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
      } else {
        errorMessage = 'Username atau password salah. Periksa kredensial database.';
      }
    } else if (error.code === 'ER_BAD_DB_ERROR') {
      errorMessage = `Database "${database}" tidak ditemukan. Pastikan database sudah dibuat.`;
    } else if (error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
      errorMessage = `Tidak dapat mencapai server ${host}. Periksa alamat server dan koneksi jaringan.`;
    } else if (error.message && error.message.includes('is not allowed to connect')) {
      // MySQL host not allowed error
      const hostMatch = error.message.match(/Host '([^']+)' is not allowed/);
      const blockedHost = hostMatch ? hostMatch[1] : 'hostname/IP Anda';
      errorMessage = `Host '${blockedHost}' tidak diizinkan untuk terhubung ke MySQL server.\n\n` +
        `Solusi: Jalankan perintah berikut di MySQL sebagai root:\n` +
        `CREATE USER '${user}'@'${blockedHost}' IDENTIFIED BY 'password';\n` +
        `GRANT ALL PRIVILEGES ON ${database}.* TO '${user}'@'${blockedHost}';\n` +
        `FLUSH PRIVILEGES;\n\n` +
        `Atau gunakan IP address (${host}) sebagai ganti hostname.`;
    } else if (error.message) {
      errorMessage = error.message;
    }
    
    return {
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Close the MySQL connection pools
 */
export async function closeMySQLPool(): Promise<void> {
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





