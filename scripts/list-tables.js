const mysql = require('mysql2/promise');
require('dotenv').config();

/**
 * List all table names from the database
 * Uses DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, and DB_PORT from .env
 */

async function listTables() {
  console.log('🔌 Connecting to MySQL database...');
  console.log(`   Host: ${process.env.DB_HOST || 'localhost'}`);
  console.log(`   Database: ${process.env.DB_NAME || 'salespulse'}\n`);
  
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'salespulse',
    port: parseInt(process.env.DB_PORT || '3306')
  });
  
  try {
    // Get all table names
    const [tables] = await connection.query(`
      SELECT TABLE_NAME 
      FROM information_schema.TABLES 
      WHERE TABLE_SCHEMA = DATABASE()
      ORDER BY TABLE_NAME
    `);
    
    console.log(`📋 Found ${tables.length} tables:\n`);
    
    // Output just the table names
    tables.forEach((table, index) => {
      console.log(`${(index + 1).toString().padStart(3, ' ')}. ${table.TABLE_NAME}`);
    });
    
    console.log(`\n✅ Total: ${tables.length} tables`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await connection.end();
  }
}

listTables().catch(error => {
  console.error('❌ Error:', error);
  process.exit(1);
});
