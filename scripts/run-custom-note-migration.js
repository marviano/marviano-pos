const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'adad',
  database: process.env.DB_NAME || 'salespulse',
  charset: 'utf8mb4'
};

async function runMigration() {
  let connection;
  
  try {
    console.log('🔗 Connecting to database...');
    connection = await mysql.createConnection(dbConfig);
    console.log('✅ Connected to database successfully');

    // Read the migration file
    const migrationPath = path.join(__dirname, '../database_migrations/add_custom_note_to_transaction_items.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    
    console.log('📝 Running custom note migration...');
    console.log('SQL:', migrationSQL);
    
    // Execute the migration
    await connection.execute(migrationSQL);
    
    console.log('✅ Custom note migration completed successfully!');
    console.log('📊 transaction_items table now supports custom notes');
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    if (error.code === 'ER_DUP_FIELDNAME') {
      console.log('ℹ️  Column already exists - migration may have been run before');
    }
  } finally {
    if (connection) {
      await connection.end();
      console.log('🔌 Database connection closed');
    }
  }
}

runMigration();







