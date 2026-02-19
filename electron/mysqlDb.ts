import mysql, { Pool, PoolConnection } from 'mysql2/promise';
import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import { getDbConfig, getMirrorDbConfig } from './configManager';

/**
 * MySQL Database Helper Module
 * Provides helper functions for executing MySQL queries, updates, and transactions
 */

let mysqlPool: Pool | null = null; // Main database: salespulse
let systemPosPool: Pool | null = null; // Printer 2 transactions: system_pos
let mirrorPool: Pool | null = null; // Dual-write: localhost + salespulse (template struk tab)

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
 * Get mirror pool for dual-write (template struk tab: localhost + salespulse).
 * Created only when getMirrorDbConfig() returns a config (e.g. DB_VPS_HOST set when primary is localhost).
 */
function getMirrorPool(): Pool | null {
  const mirrorConfig = getMirrorDbConfig();
  if (!mirrorConfig) return null;
  if (mirrorPool) return mirrorPool;
  mirrorPool = mysql.createPool({
    host: mirrorConfig.host,
    user: mirrorConfig.user,
    password: mirrorConfig.password,
    database: mirrorConfig.database,
    port: mirrorConfig.port,
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
  });
  mirrorPool.getConnection()
    .then(conn => {
      console.log(`✅ Mirror MySQL pool initialized (${mirrorConfig.host})`);
      conn.release();
    })
    .catch(err => {
      console.warn('⚠️ Mirror MySQL pool connection failed:', err.message);
    });
  return mirrorPool;
}

/**
 * Run the same write (INSERT/UPDATE/UPSERT) on the mirror DB for dual-write.
 * Does not throw; logs and returns on failure so primary save still succeeds.
 */
export async function executeOnMirror(
  sql: string,
  params: (string | number | null | boolean)[] = []
): Promise<void> {
  const pool = getMirrorPool();
  if (!pool) return;
  try {
    await pool.execute(sql, params);
  } catch (error) {
    console.warn('⚠️ Mirror write failed (primary save succeeded):', (error as Error)?.message);
  }
}

/**
 * Execute a SELECT query on the VPS mirror pool. Returns typed rows.
 * If the mirror pool is not configured (e.g. DB_VPS_HOST not set), throws Error('VPS_NOT_CONFIGURED').
 * On query error, throws with the original error (caller handles it).
 */
export async function executeQueryOnMirror<T>(
  sql: string,
  params: (string | number | null | boolean)[] = []
): Promise<T[]> {
  const pool = getMirrorPool();
  if (!pool) {
    throw new Error('VPS_NOT_CONFIGURED');
  }
  try {
    const [results] = await pool.execute(sql, params);
    return results as T[];
  } catch (error) {
    console.error('❌ Mirror query error:', error);
    console.error('SQL:', sql);
    throw error;
  }
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

export type ExecuteTransactionOptions = {
  /** When true, run SET FOREIGN_KEY_CHECKS=0 for this connection so inserts succeed on empty DB (e.g. structure-only restore). */
  disableForeignKeyChecks?: boolean;
};

/**
 * Execute multiple queries in a transaction
 */
export async function executeTransaction(
  queries: Array<{ sql: string; params?: (string | number | null | boolean)[] }>,
  options?: ExecuteTransactionOptions
): Promise<void> {
  const pool = getMySQLPool();
  const connection = await pool.getConnection();
  const disableFk = options?.disableForeignKeyChecks === true;

  try {
    if (disableFk) {
      await connection.execute('SET FOREIGN_KEY_CHECKS = 0', []);
    }
    await connection.beginTransaction();
    console.log(`🔄 [TRANSACTION] Started transaction with ${queries.length} queries${disableFk ? ' (FK checks off)' : ''}`);

    for (let i = 0; i < queries.length; i++) {
      const { sql, params = [] } = queries[i];
      try {
        const [result] = await connection.execute(sql, params) as [mysql.ResultSetHeader, unknown];
        if (i < 5 || i === queries.length - 1) {
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
    if (disableFk) {
      try {
        await connection.execute('SET FOREIGN_KEY_CHECKS = 1', []);
      } catch (e) {
        console.warn('⚠️ [TRANSACTION] Failed to restore FOREIGN_KEY_CHECKS:', (e as Error)?.message);
      }
    }
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
 * Uses same host/user/password/port as main DB (getDbConfig: pos-config.json + env)
 * so packaged clients that configure DB only via pos-config.json work for system_pos too.
 */
export function initializeSystemPosPool(): Pool {
  if (systemPosPool) {
    return systemPosPool;
  }

  // Load .env so process.env.DB_* are available when present
  try {
    const dotenv = require('dotenv');
    const possibleEnvPaths = [
      path.join(process.cwd(), '.env'),
      path.join(app.getAppPath(), '.env'),
      path.join(path.dirname(app.getPath('exe')), '.env')
    ];
    for (const envPath of possibleEnvPaths) {
      if (fs.existsSync(envPath)) {
        dotenv.config({ path: envPath });
        break;
      }
    }
  } catch {
    // ignore
  }

  // Prefer .env credentials for system_pos so we don't need GRANT CREATE/REFERENCES for limited users (e.g. client).
  // When DB_HOST/DB_USER/DB_PASSWORD are set (e.g. from .env), use them; otherwise fall back to pos-config / getDbConfig().
  const useEnv =
    process.env.DB_HOST?.trim() &&
    process.env.DB_USER?.trim() &&
    process.env.DB_PASSWORD !== undefined;

  const host = useEnv ? process.env.DB_HOST!.trim() : getDbConfig().host;
  let user = useEnv ? process.env.DB_USER!.trim() : getDbConfig().user;
  if (!user || !String(user).trim()) user = 'root';
  const password = useEnv ? String(process.env.DB_PASSWORD) : getDbConfig().password;
  const port = useEnv
    ? parseInt(process.env.DB_PORT || '3306', 10)
    : getDbConfig().port;

  systemPosPool = mysql.createPool({
    host,
    user,
    password,
    database: 'system_pos', // Always use system_pos database for printer 2 transactions
    port,
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
 * Execute DDL (e.g. CREATE TABLE) on System POS database. No return value.
 */
export async function executeSystemPosDdl(sql: string): Promise<void> {
  const pool = getSystemPosPool();
  try {
    await pool.execute(sql, []);
  } catch (error) {
    console.error('❌ System POS MySQL DDL error:', error);
    console.error('SQL:', sql);
    throw error;
  }
}

/**
 * Execute DDL on main DB, but silently ignore ER_DUP_FIELDNAME (1060) and ER_DUP_KEYNAME (1061).
 * Use for ALTER ADD COLUMN/INDEX when columns may already exist.
 */
export async function executeDdlIgnoreDup(sql: string): Promise<void> {
  const pool = getMySQLPool();
  try {
    await pool.execute(sql, []);
  } catch (error: unknown) {
    const err = error as { errno?: number; code?: string };
    if (err.errno === 1060 || err.errno === 1061 || err.code === 'ER_DUP_FIELDNAME' || err.code === 'ER_DUP_KEYNAME') {
      return; /* column/index already exists */
    }
    console.error('❌ MySQL DDL error (main DB):', error);
    console.error('SQL:', sql);
    throw error;
  }
}

/**
 * Execute DDL, but silently ignore ER_DUP_FIELDNAME (1060) and ER_DUP_KEYNAME (1061).
 * Use for ALTER ADD COLUMN/INDEX when columns may already exist. No console logging for those.
 */
export async function executeSystemPosDdlIgnoreDup(sql: string): Promise<void> {
  const pool = getSystemPosPool();
  try {
    await pool.execute(sql, []);
  } catch (error: unknown) {
    const err = error as { errno?: number; code?: string };
    if (err.errno === 1060 || err.errno === 1061 || err.code === 'ER_DUP_FIELDNAME' || err.code === 'ER_DUP_KEYNAME') {
      return; /* column/index already exists */
    }
    console.error('❌ System POS MySQL DDL error:', error);
    console.error('SQL:', sql);
    throw error;
  }
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
        // MySQL error often contains client IP: "Access denied for user 'client'@'192.168.1.75'"
        const clientIpMatch = error.message?.match(/user\s+'[^']+'@'([^']+)'/);
        const clientIp = clientIpMatch ? clientIpMatch[1] : 'IP_komputer_ini';
        errorMessage = `Username atau password salah untuk koneksi jaringan ke ${host}.\n\n` +
          `Kemungkinan penyebab:\n` +
          `1. User '${user}' belum dibuat untuk koneksi dari IP komputer ini (${clientIp})\n` +
          `2. Password salah atau berbeda\n` +
          `3. Komputer ini di subnet lain (bukan 192.168.1.x)\n\n` +
          `Solusi: Di MySQL server (${host}), jalankan:\n` +
          `CREATE USER '${user}'@'${clientIp}' IDENTIFIED BY 'password_yang_sama';\n` +
          `GRANT ALL PRIVILEGES ON ${database}.* TO '${user}'@'${clientIp}';\n` +
          `FLUSH PRIVILEGES;\n\n` +
          `Atau untuk seluruh subnet 192.168.1.x:\n` +
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
 * Helper function to convert unknown values to MySQL parameter types
 */
function convertToMySQLParam(value: unknown): string | number | null | boolean {
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
 * Insert a minimal product row into system_pos.products so transaction_items FK is satisfied.
 * Used when the product is missing from salespulse or when full product insert fails.
 * Uses only id, nama, satuan to avoid UNIQUE/FK issues; never throws.
 */
async function insertStubProductIntoSystemPos(productId: number): Promise<void> {
  const nama = `Produk #${productId}`;
  try {
    await executeSystemPosUpdate(
      'INSERT IGNORE INTO products (id, nama, satuan) VALUES (?, ?, ?)',
      [productId, nama, 'pcs']
    );
    console.log(`✅ [SYSTEM POS] Inserted stub product ${productId} into system_pos`);
  } catch (e1: unknown) {
    const msg = e1 instanceof Error ? e1.message : String(e1);
    console.warn(`⚠️ [SYSTEM POS] Stub insert (id,nama,satuan) failed for ${productId}:`, msg);
    try {
      await executeSystemPosUpdate(
        'INSERT INTO products (id, nama, satuan) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE id=id',
        [productId, nama, 'pcs']
      );
      console.log(`✅ [SYSTEM POS] Inserted stub product ${productId} (ON DUPLICATE) into system_pos`);
    } catch (e2: unknown) {
      console.error(`❌ [SYSTEM POS] Stub product ${productId} insert failed:`, e2 instanceof Error ? e2.message : String(e2));
    }
  }
}

/**
 * Insert complete transaction data into system_pos database
 * Fetches transaction and all related data from salespulse DB and inserts into system_pos DB
 */
export async function insertTransactionToSystemPos(transactionId: string): Promise<{ success: boolean; error?: string; skipped?: boolean }> {
  const mainPool = getMySQLPool();
  const systemPosPool = getSystemPosPool();
  
  try {
    // Step 1: Check if transaction already exists in system_pos (deduplication)
    const existingTx = await executeSystemPosQueryOne<{ id: number }>(
      'SELECT id FROM transactions WHERE uuid_id = ?',
      [transactionId]
    );
    
    if (existingTx) {
      console.log(`⏭️ [SYSTEM POS] Transaction ${transactionId} already exists in system_pos, skipping insertion`);
      return { success: true, skipped: true };
    }

    // Step 2: Fetch transaction from salespulse DB
    const transaction = await executeQueryOne<Record<string, unknown>>(
      'SELECT * FROM transactions WHERE uuid_id = ?',
      [transactionId]
    );

    if (!transaction) {
      return { success: false, error: `Transaction ${transactionId} not found in salespulse DB` };
    }

    // Step 3: Fetch transaction items
    const items = await executeQuery<Record<string, unknown>>(
      'SELECT * FROM transaction_items WHERE uuid_transaction_id = ? ORDER BY id ASC',
      [transactionId]
    );

    // Step 4: Fetch customizations and options
    const itemIds = items.map(item => item.id).filter((id): id is number => typeof id === 'number');
    let customizations: Record<string, unknown>[] = [];
    let customizationOptions: Record<string, unknown>[] = [];

    if (itemIds.length > 0) {
      const placeholders = itemIds.map(() => '?').join(',');
      customizations = await executeQuery<Record<string, unknown>>(
        `SELECT * FROM transaction_item_customizations WHERE transaction_item_id IN (${placeholders})`,
        itemIds
      );

      if (customizations.length > 0) {
        const customizationIds = customizations.map(c => c.id).filter((id): id is number => typeof id === 'number');
        if (customizationIds.length > 0) {
          const optionPlaceholders = customizationIds.map(() => '?').join(',');
          customizationOptions = await executeQuery<Record<string, unknown>>(
            `SELECT * FROM transaction_item_customization_options WHERE transaction_item_customization_id IN (${optionPlaceholders})`,
            customizationIds
          );
        }
      }
    }

    // Step 5: Fetch refunds
    const refunds = await executeQuery<Record<string, unknown>>(
      'SELECT * FROM transaction_refunds WHERE transaction_uuid = ? ORDER BY refunded_at DESC',
      [transactionId]
    );

    // Step 6: Fetch shift if exists
    let shift: Record<string, unknown> | null = null;
    if (transaction.shift_uuid && typeof transaction.shift_uuid === 'string') {
      shift = await executeQueryOne<Record<string, unknown>>(
        'SELECT * FROM shifts WHERE uuid_id = ?',
        [transaction.shift_uuid]
      );
    }

    // Step 7: Ensure every product referenced by items exists in system_pos (so transaction data matches)
    const productIds = items
      .map(item => item.product_id)
      .filter((id): id is number => typeof id === 'number' && id > 0);
    
    const uniqueProductIds = [...new Set(productIds)];
    
    let productsInserted = 0;
    let productsSkipped = 0;
    
    for (const productId of uniqueProductIds) {
      const existingProduct = await executeSystemPosQueryOne<{ id: number }>(
        'SELECT id FROM products WHERE id = ?',
        [productId]
      );

      if (existingProduct) {
        productsSkipped++;
        continue;
      }

      // Fetch product from salespulse DB and try full insert
      const product = await executeQueryOne<Record<string, unknown>>(
        'SELECT * FROM products WHERE id = ?',
        [productId]
      );

      if (product) {
        try {
          const productFields = Object.keys(product).filter(key => key !== 'id' || product.id === productId);
          const productValues = productFields.map(field => convertToMySQLParam(product[field]));
          const productPlaceholders = productFields.map(() => '?').join(', ');
          await executeSystemPosUpdate(
            `INSERT INTO products (${productFields.join(', ')}) VALUES (${productPlaceholders})`,
            productValues
          );
          productsInserted++;
          console.log(`✅ [SYSTEM POS] Inserted missing product ${productId} into system_pos`);
        } catch (productError: unknown) {
          const errorMsg = productError instanceof Error ? productError.message : String(productError);
          console.warn(`⚠️ [SYSTEM POS] Full product insert failed for ${productId}, inserting stub:`, errorMsg);
          await insertStubProductIntoSystemPos(productId);
          productsInserted++;
        }
      } else {
        console.warn(`⚠️ [SYSTEM POS] Product ${productId} not in salespulse DB, inserting stub so transaction can sync`);
        await insertStubProductIntoSystemPos(productId);
        productsInserted++;
      }
    }

    // Step 7a: Ensure every product really exists in system_pos (retry stub for any still missing)
    for (const productId of uniqueProductIds) {
      const exists = await executeSystemPosQueryOne<{ id: number }>(
        'SELECT id FROM products WHERE id = ?',
        [productId]
      );
      if (!exists) {
        console.warn(`⚠️ [SYSTEM POS] Product ${productId} still missing before insert, retrying stub`);
        await insertStubProductIntoSystemPos(productId);
      }
    }

    // Step 7b: Ensure table_id exists in system_pos.restaurant_tables (FK constraint)
    // If the transaction has a table_id but that table doesn't exist in system_pos, use NULL
    let transactionForInsert = transaction;
    const tableId = transaction.table_id;
    if (tableId != null && tableId !== '') {
      const tableIdNum = typeof tableId === 'number' ? tableId : Number(tableId);
      if (!Number.isNaN(tableIdNum)) {
        const tableExists = await executeSystemPosQueryOne<{ id: number }>(
          'SELECT id FROM restaurant_tables WHERE id = ? LIMIT 1',
          [tableIdNum]
        );
        if (!tableExists) {
          transactionForInsert = { ...transaction, table_id: null };
          console.warn(`⚠️ [SYSTEM POS] table_id ${tableIdNum} not found in system_pos.restaurant_tables, inserting transaction with table_id=NULL`);
        }
      }
    }

    // Step 7c: Ensure payment_method_id exists in system_pos.payment_methods (FK constraint)
    const paymentMethodId = typeof transaction.payment_method_id === 'number'
      ? transaction.payment_method_id
      : (transaction.payment_method_id ? Number(transaction.payment_method_id) : 1);
    if (!Number.isNaN(paymentMethodId) && paymentMethodId > 0) {
      const pmExists = await executeSystemPosQueryOne<{ id: number }>(
        'SELECT id FROM payment_methods WHERE id = ? LIMIT 1',
        [paymentMethodId]
      );
      if (!pmExists) {
        const pm = await executeQueryOne<Record<string, unknown>>(
          'SELECT * FROM payment_methods WHERE id = ?',
          [paymentMethodId]
        );
        if (pm) {
          try {
            const pmFields = Object.keys(pm);
            const pmValues = pmFields.map(f => convertToMySQLParam(pm[f]));
            const pmPlaceholders = pmFields.map(() => '?').join(', ');
            await executeSystemPosUpdate(
              `INSERT INTO payment_methods (${pmFields.join(', ')}) VALUES (${pmPlaceholders}) ON DUPLICATE KEY UPDATE name=VALUES(name), code=VALUES(code), description=VALUES(description), is_active=VALUES(is_active), requires_additional_info=VALUES(requires_additional_info), updated_at=VALUES(updated_at)`,
              pmValues
            );
            console.log(`✅ [SYSTEM POS] Ensured payment_method id=${paymentMethodId} in system_pos.payment_methods`);
          } catch (pmErr: unknown) {
            const msg = pmErr instanceof Error ? pmErr.message : String(pmErr);
            console.warn(`⚠️ [SYSTEM POS] Could not ensure payment_method ${paymentMethodId} in system_pos:`, msg);
          }
        }
      }
    }

    // Step 8: Insert all data into system_pos DB using transaction
    const queries: Array<{ sql: string; params?: (string | number | null | boolean)[] }> = [];

    // Insert transaction
    const txFields = Object.keys(transactionForInsert);
    const txValues = txFields.map(field => convertToMySQLParam(transactionForInsert[field]));
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
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`❌ [SYSTEM POS] Error inserting transaction ${transactionId} into system_pos:`, errorMsg);
    if (error instanceof Error && error.stack) {
      console.error(`❌ [SYSTEM POS] Stack trace:`, error.stack);
    }
    return { success: false, error: errorMsg };
  }
}

/**
 * Upsert category1 and category2 from main to system_pos so product FK inserts succeed.
 */
async function upsertCategoriesFromMainToSystemPos(): Promise<void> {
  for (const table of ['category1', 'category2'] as const) {
    const rows = await executeQuery<Record<string, unknown>>(`SELECT * FROM \`${table}\``);
    for (const row of rows) {
      const fields = Object.keys(row);
      const values = fields.map(f => convertToMySQLParam(row[f]));
      const placeholders = fields.map(() => '?').join(', ');
      const updateSet = fields.filter(f => f !== 'id').map(f => `\`${f}\`=VALUES(\`${f}\`)`).join(', ');
      const sql = `INSERT INTO \`${table}\` (${fields.map(f => `\`${f}\``).join(', ')}) VALUES (${placeholders}) ON DUPLICATE KEY UPDATE ${updateSet}`;
      await executeSystemPosUpdate(sql, values);
    }
    console.log(`✅ [SYSTEM POS] Upserted ${rows.length} rows from salespulse.${table} to system_pos`);
  }
}

/**
 * Upsert all products (and their category refs) from main (salespulse) DB into system_pos so transaction sync never fails on missing product.
 * Call after "Download master data" or before bulk re-sync.
 */
export async function upsertProductsFromMainToSystemPos(): Promise<{ success: boolean; upserted: number; error?: string }> {
  try {
    await upsertCategoriesFromMainToSystemPos();
    const products = await executeQuery<Record<string, unknown>>('SELECT * FROM products');
    if (!products.length) {
      return { success: true, upserted: 0 };
    }
    let upserted = 0;
    for (const product of products) {
      const fields = Object.keys(product);
      const values = fields.map(f => convertToMySQLParam(product[f]));
      const placeholders = fields.map(() => '?').join(', ');
      const updateSet = fields.filter(f => f !== 'id').map(f => `\`${f}\`=VALUES(\`${f}\`)`).join(', ');
      const sql = updateSet
        ? `INSERT INTO products (${fields.map(f => `\`${f}\``).join(', ')}) VALUES (${placeholders}) ON DUPLICATE KEY UPDATE ${updateSet}`
        : `INSERT IGNORE INTO products (${fields.map(f => `\`${f}\``).join(', ')}) VALUES (${placeholders})`;
      await executeSystemPosUpdate(sql, values);
      upserted++;
    }
    console.log(`✅ [SYSTEM POS] Upserted ${upserted} products from salespulse to system_pos`);
    return { success: true, upserted };
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('❌ [SYSTEM POS] upsertProductsFromMainToSystemPos failed:', errorMsg);
    return { success: false, upserted: 0, error: errorMsg };
  }
}

/**
 * Auto re-sync refunded Printer 2 transactions to system_pos.
 * During Smart Sync, detects transactions with refunds in main DB that need their
 * refund data synced to system_pos. Handles both:
 * - Existing transactions: UPDATE refund_total, refund_status, last_refunded_at; upsert transaction_refunds
 * - Missing transactions: Full insert via insertTransactionToSystemPos
 */
export async function syncRefundedTransactionsToSystemPos(): Promise<{ success: boolean; syncedCount: number; error?: string }> {
  try {
    // Get Printer 2 transactions that have refunds in main DB
    const rows = await executeQuery<{
      uuid_id: string;
      refund_total: number;
      refund_status: string;
      last_refunded_at: string | null;
    }>(`
      SELECT
        t.uuid_id,
        COALESCE(r.total_refund, t.refund_total, 0) AS refund_total,
        CASE
          WHEN COALESCE(r.total_refund, t.refund_total, 0) >= (t.final_amount - 0.01) THEN 'full'
          WHEN COALESCE(r.total_refund, t.refund_total, 0) > 0 THEN 'partial'
          ELSE 'none'
        END AS refund_status,
        (SELECT MAX(refunded_at) FROM transaction_refunds WHERE transaction_uuid = t.uuid_id AND status IN ('pending', 'completed')) AS last_refunded_at
      FROM transactions t
      INNER JOIN printer2_audit_log p2 ON p2.transaction_id = t.uuid_id
      LEFT JOIN (
        SELECT transaction_uuid, SUM(refund_amount) AS total_refund
        FROM transaction_refunds
        WHERE status IN ('pending', 'completed')
        GROUP BY transaction_uuid
      ) r ON t.uuid_id = r.transaction_uuid
      WHERE COALESCE(r.total_refund, t.refund_total, 0) > 0
    `);

    if (!rows.length) {
      return { success: true, syncedCount: 0 };
    }

    let syncedCount = 0;

    for (const row of rows) {
      const transactionId = row.uuid_id;

      const existingTx = await executeSystemPosQueryOne<{
        id: number;
        refund_total: number | string;
        last_refunded_at: string | null;
      }>(
        'SELECT id, refund_total, last_refunded_at FROM transactions WHERE uuid_id = ?',
        [transactionId]
      );

      if (!existingTx) {
        // Transaction missing in system_pos - full sync
        const insertResult = await insertTransactionToSystemPos(transactionId);
        if (insertResult.success) {
          syncedCount++;
          console.log(`✅ [SYSTEM POS] Auto re-sync: inserted missing refunded transaction ${transactionId}`);
        }
        continue;
      }

      // Transaction exists - skip if refund data already in sync (prevent duplicate syncs)
      const mainRefundTotal = Number(row.refund_total) || 0;
      const sysRefundTotal = Number(existingTx.refund_total) || 0;
      const mainLastRefundedAt = row.last_refunded_at ? toMySQLDateTime(row.last_refunded_at) : null;
      const sysLastRefundedAt = existingTx.last_refunded_at
        ? (typeof existingTx.last_refunded_at === 'string'
          ? existingTx.last_refunded_at.replace('T', ' ').slice(0, 19)
          : String(existingTx.last_refunded_at))
        : null;
      if (sysRefundTotal === mainRefundTotal && sysLastRefundedAt === mainLastRefundedAt) {
        continue; // Already in sync
      }

      // Update transaction refund fields and set system_pos_synced_at
      const lastRefundedAt = mainLastRefundedAt;
      await executeSystemPosUpdate(
        `UPDATE transactions SET refund_total = ?, refund_status = ?, last_refunded_at = ?, system_pos_synced_at = NOW() WHERE uuid_id = ?`,
        [mainRefundTotal, row.refund_status || 'partial', lastRefundedAt, transactionId]
      );

      // Sync transaction_refunds from main to system_pos
      const refunds = await executeQuery<Record<string, unknown>>(
        'SELECT * FROM transaction_refunds WHERE transaction_uuid = ? AND status IN (?, ?) ORDER BY refunded_at ASC',
        [transactionId, 'pending', 'completed']
      );

      const refundFields = ['uuid_id', 'transaction_uuid', 'business_id', 'shift_uuid', 'refunded_by',
        'refund_amount', 'cash_delta', 'payment_method_id', 'reason', 'note',
        'refund_type', 'status', 'refunded_at', 'created_at', 'updated_at', 'synced_at'];

      for (const refund of refunds) {
        const values = refundFields.map(f => convertToMySQLParam(refund[f]));
        const placeholders = refundFields.map(() => '?').join(', ');
        const updateSet = refundFields.filter(f => f !== 'uuid_id').map(f => `${f}=VALUES(${f})`).join(', ');
        await executeSystemPosUpdate(
          `INSERT INTO transaction_refunds (${refundFields.join(', ')}) VALUES (${placeholders})
           ON DUPLICATE KEY UPDATE ${updateSet}`,
          values
        );
      }

      syncedCount++;
      console.log(`✅ [SYSTEM POS] Auto re-sync: updated refund data for transaction ${transactionId}`);
    }

    if (syncedCount > 0) {
      console.log(`✅ [SYSTEM POS] Auto re-sync completed: ${syncedCount} refunded transaction(s) synced`);
    }

    return { success: true, syncedCount };
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('❌ [SYSTEM POS] syncRefundedTransactionsToSystemPos failed:', errorMsg);
    return { success: false, syncedCount: 0, error: errorMsg };
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





