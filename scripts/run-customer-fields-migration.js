const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Database configuration
const dbConfig = {
  host: 'localhost',
  user: 'root',
  password: 'adad',
  database: 'salespulse',
  port: 3306,
};

async function runMigration() {
  let connection;
  
  try {
    console.log('🔌 Connecting to database...');
    connection = await mysql.createConnection(dbConfig);
    
    // Read the migration file
    const migrationPath = path.join(__dirname, '../database_migrations/add_customer_fields_to_transactions.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    
    console.log('📄 Running customer fields migration...');
    
    // Execute SQL statements directly
    try {
      console.log('🔍 Adding contact_id column...');
      await connection.execute(`
        ALTER TABLE transactions 
        ADD COLUMN contact_id int DEFAULT NULL COMMENT 'Reference to contact book entry'
      `);
      console.log('✅ contact_id column added');
    } catch (error) {
      console.log('❌ Error adding contact_id:', error.message);
    }
    
    try {
      console.log('🔍 Adding customer_name column...');
      await connection.execute(`
        ALTER TABLE transactions 
        ADD COLUMN customer_name varchar(255) DEFAULT NULL COMMENT 'Customer name (manual entry)'
      `);
      console.log('✅ customer_name column added');
    } catch (error) {
      console.log('❌ Error adding customer_name:', error.message);
    }
    
    try {
      console.log('🔍 Adding index for contact_id...');
      await connection.execute(`
        ALTER TABLE transactions 
        ADD KEY idx_transactions_contact (contact_id)
      `);
      console.log('✅ Index added');
    } catch (error) {
      console.log('❌ Error adding index:', error.message);
    }
    
    console.log('🎉 Customer fields migration completed successfully!');
    
    // Check if the columns already exist
    const [existingColumns] = await connection.execute(`
      SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
      FROM information_schema.COLUMNS 
      WHERE TABLE_SCHEMA = ? 
      AND TABLE_NAME = 'transactions'
      AND COLUMN_NAME IN ('contact_id', 'customer_name')
    `, [dbConfig.database]);
    
    console.log('📋 Existing customer columns:', existingColumns.map(c => c.COLUMN_NAME));
    
    // Check all columns in transactions table
    const [allColumns] = await connection.execute(`
      SELECT COLUMN_NAME
      FROM information_schema.COLUMNS 
      WHERE TABLE_SCHEMA = ? 
      AND TABLE_NAME = 'transactions'
      ORDER BY ORDINAL_POSITION
    `, [dbConfig.database]);
    
    console.log('📋 All transactions table columns:', allColumns.map(c => c.COLUMN_NAME));
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

// Run the migration
runMigration();
