const mysql = require('mysql2/promise');
require('dotenv').config();

async function runMigration() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'adad',
    database: process.env.DB_NAME || 'salespulse',
    port: process.env.DB_PORT || 3306
  });

  try {
    console.log('🚀 Starting receipt fields migration...');
    
    // Read and execute the SQL file
    const fs = require('fs');
    const sqlContent = fs.readFileSync('./database_migrations/add_receipt_fields.sql', 'utf8');
    
    // Split by semicolon and execute each statement
    const statements = sqlContent.split(';').filter(stmt => stmt.trim());
    
    for (const statement of statements) {
      if (statement.trim()) {
        console.log('Executing:', statement.trim().substring(0, 50) + '...');
        await connection.execute(statement);
      }
    }
    
    console.log('✅ Receipt fields migration completed successfully!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    throw error;
  } finally {
    await connection.end();
  }
}

runMigration().catch(console.error);



