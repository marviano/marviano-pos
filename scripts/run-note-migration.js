const mysql = require('mysql2/promise');
require('dotenv').config();

async function runMigration() {
  let connection;
  
  try {
    console.log('Starting migration: Add note column to transactions table...');
    
    // Create database connection
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || 'adad',
      database: process.env.DB_NAME || 'salespulse',
      multipleStatements: true
    });

    console.log('Connected to database successfully');

    // Read and execute the migration SQL
    const fs = require('fs');
    const path = require('path');
    const sqlFile = path.join(__dirname, '..', 'database_migrations', 'add_note_to_transactions.sql');
    const sql = fs.readFileSync(sqlFile, 'utf8');

    // Split SQL into individual statements
    const statements = sql.split(';').filter(stmt => stmt.trim().length > 0);

    for (const statement of statements) {
      if (statement.trim()) {
        console.log('Executing:', statement.trim().substring(0, 50) + '...');
        await connection.execute(statement.trim());
      }
    }

    console.log('✅ Migration completed successfully: Added note column to transactions table');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

runMigration();
