import mysql from 'mysql2/promise';

// Note: For Next.js API routes, we can't use Electron IPC, so we fall back to env vars
// The config will be loaded via IPC in renderer process contexts only

/**
 * Get database configuration
 * Note: This is used in Next.js API routes which run server-side,
 * so we can only use environment variables here.
 * Runtime config is handled in Electron main process (electron/mysqlDb.ts)
 */
function getLocalDbConfig(): {
  host: string;
  user: string;
  password: string;
  database: string;
  port: number;
  waitForConnections: boolean;
  connectionLimit: number;
  queueLimit: number;
  keepAliveInitialDelay: number;
  enableKeepAlive: boolean;
} {
  // Next.js API routes run server-side, so we use environment variables
  // Runtime config is handled in Electron main process
  return {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'salespulse',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    keepAliveInitialDelay: 0,
    enableKeepAlive: true,
  };
}

// Extract VPS host from API URL if not explicitly set
const getVpsHost = (): string => {
  if (process.env.DB_VPS_HOST) {
    return process.env.DB_VPS_HOST;
  }
  
  // Try to extract hostname from API URL
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';
  if (apiUrl) {
    try {
      const url = new URL(apiUrl);
      return url.hostname;
    } catch {
      // Invalid URL, fall back to localhost
    }
  }
  
  // Fall back to localhost (but this should be configured!)
  console.warn('⚠️ [DB] VPS database host not configured. Using localhost. Set DB_VPS_HOST in .env');
  return process.env.DB_HOST || 'localhost';
};

// VPS database configuration (for remote MySQL - used for syncing)
const vpsDbConfig = {
  host: getVpsHost(),
  user: process.env.DB_VPS_USER || process.env.DB_USER || 'root',
  password: process.env.DB_VPS_PASSWORD || process.env.DB_PASSWORD || '',
  database: process.env.DB_VPS_NAME || process.env.DB_NAME || 'salespulse',
  port: parseInt(process.env.DB_VPS_PORT || process.env.DB_PORT || '3306'),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  keepAliveInitialDelay: 0,
  enableKeepAlive: true,
};

// Create connection pools
let pool: mysql.Pool | null = null;
let vpsPool: mysql.Pool | null = null;

export function getPool(): mysql.Pool {
  if (!pool) {
    const config = getLocalDbConfig();
    pool = mysql.createPool(config);
    
    // Handle connection errors
    pool.on('connection', () => {
      console.log('✅ Local database connection established');
    });
    
    // Note: mysql2 Pool doesn't have an 'error' event, errors are handled per-connection
    // Connection errors are handled in the query function
  }
  return pool;
}

/**
 * Get VPS database connection pool (for syncing from remote server)
 * This connects to the VPS MySQL database to fetch data for syncing to local
 */
export function getVpsPool(): mysql.Pool {
  if (!vpsPool) {
    vpsPool = mysql.createPool(vpsDbConfig);
    
    // Handle connection errors
    vpsPool.on('connection', () => {
      console.log('✅ VPS database connection established');
    });
  }
  return vpsPool;
}

/**
 * Query VPS database (for syncing)
 * This is used by the sync endpoint to fetch data from VPS MySQL
 */
export async function queryVps<T = unknown>(sql: string, params?: (string | number | null)[]): Promise<T> {
  const maxRetries = 3;
  let lastError: unknown;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const pool = getVpsPool();
      
      // Handle transaction commands that don't work with prepared statements
      const transactionCommands = ['START TRANSACTION', 'COMMIT', 'ROLLBACK'];
      const isTransactionCommand = transactionCommands.some(cmd => 
        sql.trim().toUpperCase().startsWith(cmd)
      );
      
      if (isTransactionCommand) {
        const [results] = await pool.query(sql);
        return results as T;
      } else {
        // Try prepared statement first
        try {
          const [results] = await pool.execute(sql, params);
          return results as T;
        } catch {
          // Silently retry with direct query
          if (params && params.length > 0) {
            let directSql = sql;
            params.forEach((param) => {
              const value = typeof param === 'string' ? `'${param.replace(/'/g, "''")}'` : param;
              directSql = directSql.replace('?', String(value));
            });
            const [results] = await pool.query(directSql);
            return results as T;
          } else {
            const [results] = await pool.query(sql);
            return results as T;
          }
        }
      }
    } catch (error: unknown) {
      lastError = error;
      const err = error as { message?: string; code?: string };
      console.error(`❌ VPS database query failed (attempt ${attempt}/${maxRetries}):`, err.message || 'Unknown error');
      
      // If it's a connection error, recreate the pool
      if (err.code === 'PROTOCOL_CONNECTION_LOST' || err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT') {
        console.log('🔄 VPS connection lost, recreating pool...');
        vpsPool = null;
        
        // Wait before retrying
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
      } else {
        // For other errors, don't retry
        throw error;
      }
    }
  }
  
  throw lastError;
}

export async function query<T = unknown>(sql: string, params?: (string | number | null)[]): Promise<T> {
  const maxRetries = 3;
  let lastError: unknown;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const pool = getPool();
      
      // Handle transaction commands that don't work with prepared statements
      const transactionCommands = ['START TRANSACTION', 'COMMIT', 'ROLLBACK'];
      const isTransactionCommand = transactionCommands.some(cmd => 
        sql.trim().toUpperCase().startsWith(cmd)
      );
      
      if (isTransactionCommand) {
        const [results] = await pool.query(sql);
        return results as T;
      } else {
        // Try prepared statement first
        try {
          const [results] = await pool.execute(sql, params);
          return results as T;
        } catch {
          // Silently retry with direct query
          // If prepared statement fails, try direct query (less secure but works)
          if (params && params.length > 0) {
            let directSql = sql;
            params.forEach((param) => {
              const value = typeof param === 'string' ? `'${param.replace(/'/g, "''")}'` : param;
              directSql = directSql.replace('?', String(value));
            });
            const [results] = await pool.query(directSql);
            return results as T;
          } else {
            const [results] = await pool.query(sql);
            return results as T;
          }
        }
      }
    } catch (error: unknown) {
      lastError = error;
      const err = error as { message?: string; code?: string };
      console.error(`❌ Database query failed (attempt ${attempt}/${maxRetries}):`, err.message || 'Unknown error');
      
      // If it's a connection error, recreate the pool
      if (err.code === 'PROTOCOL_CONNECTION_LOST' || err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT') {
        console.log('🔄 Connection lost, recreating pool...');
        pool = null;
        
        // Wait before retrying
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
      } else {
        // For other errors, don't retry
        throw error;
      }
    }
  }
  
  throw lastError;
}

const dbExports = { getPool, query, getVpsPool, queryVps };
export default dbExports;
