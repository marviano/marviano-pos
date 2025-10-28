import mysql from 'mysql2/promise';

// Database configuration
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'marviano_pos',
  port: parseInt(process.env.DB_PORT || '3306'),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  // Removed invalid MySQL2 options: acquireTimeout, timeout, reconnect
  keepAliveInitialDelay: 0,
  enableKeepAlive: true,
};

// Create connection pool
let pool: mysql.Pool | null = null;

export function getPool(): mysql.Pool {
  if (!pool) {
    pool = mysql.createPool(dbConfig);
    
    // Handle connection errors
    pool.on('connection', (connection) => {
      console.log('✅ Database connection established');
    });
    
    pool.on('error', (err) => {
      console.error('❌ Database pool error:', err);
      if (err.code === 'PROTOCOL_CONNECTION_LOST') {
        console.log('🔄 Recreating database pool due to connection loss');
        pool = null;
      }
    });
  }
  return pool;
}

export async function query<T = any>(sql: string, params?: any[]): Promise<T> {
  const maxRetries = 3;
  let lastError: any;
  
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
        } catch (error: any) {
          // Silently retry with direct query
          // If prepared statement fails, try direct query (less secure but works)
          if (params && params.length > 0) {
            let directSql = sql;
            params.forEach((param, index) => {
              const value = typeof param === 'string' ? `'${param}'` : param;
              directSql = directSql.replace('?', value);
            });
            const [results] = await pool.query(directSql);
            return results as T;
          } else {
            const [results] = await pool.query(sql);
            return results as T;
          }
        }
      }
    } catch (error: any) {
      lastError = error;
      console.error(`❌ Database query failed (attempt ${attempt}/${maxRetries}):`, error.message);
      
      // If it's a connection error, recreate the pool
      if (error.code === 'PROTOCOL_CONNECTION_LOST' || error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
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

export default { getPool, query };
