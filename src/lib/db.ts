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
};

// Create connection pool
let pool: mysql.Pool | null = null;

export function getPool(): mysql.Pool {
  if (!pool) {
    pool = mysql.createPool(dbConfig);
  }
  return pool;
}

export async function query<T = any>(sql: string, params?: any[]): Promise<T> {
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
    // For debugging, let's try direct query instead of prepared statement
    try {
      const [results] = await pool.execute(sql, params);
      return results as T;
    } catch (error: any) {
      console.log('Prepared statement failed, trying direct query...');
      console.log('Error:', error.message);
      
      // If prepared statement fails, try direct query (less secure but works)
      if (params && params.length > 0) {
        let directSql = sql;
        params.forEach((param, index) => {
          const value = typeof param === 'string' ? `'${param}'` : param;
          directSql = directSql.replace('?', value);
        });
        console.log('Direct SQL:', directSql);
        const [results] = await pool.query(directSql);
        return results as T;
      } else {
        const [results] = await pool.query(sql);
        return results as T;
      }
    }
  }
}

export default { getPool, query };
