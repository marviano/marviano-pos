const mysql = require('mysql2/promise');
require('dotenv').config();

const dbConfig = {
  host: 'localhost',
  user: 'root',
  password: 'adad',
  database: 'salespulse',
  multipleStatements: true
};

async function runMigration() {
  let connection;
  
  try {
    console.log('🔗 Connecting to database...');
    connection = await mysql.createConnection(dbConfig);
    console.log('✅ Connected to database');

    // Create banks table
    console.log('🏦 Creating banks table...');
    const banksTableSql = require('fs').readFileSync('./database_migrations/create_banks_table.sql', 'utf8');
    await connection.execute(banksTableSql);
    console.log('✅ Banks table created');

    // Insert banks data
    console.log('🏦 Inserting banks data...');
    const banksDataSql = require('fs').readFileSync('./database_migrations/insert_banks_data.sql', 'utf8');
    await connection.execute(banksDataSql);
    console.log('✅ Banks data inserted');

    // Add bank_id column to transactions
    console.log('💳 Adding bank_id column to transactions...');
    const bankIdSql = require('fs').readFileSync('./database_migrations/update_transactions_bank_id.sql', 'utf8');
    await connection.execute(bankIdSql);
    console.log('✅ Bank_id column added');

    // Add bank_id index
    console.log('💳 Adding bank_id index...');
    const bankIndexSql = require('fs').readFileSync('./database_migrations/add_bank_id_index.sql', 'utf8');
    await connection.execute(bankIndexSql);
    console.log('✅ Bank_id index added');

    console.log('🎉 Banks migration completed successfully!');

    // Verify tables were created
    console.log('\n📊 Verifying tables...');
    
    const [banks] = await connection.execute('SELECT * FROM banks');
    console.log(`✅ Banks: ${banks.length} records`);
    
    const [popularBanks] = await connection.execute('SELECT * FROM banks WHERE is_popular = 1');
    console.log(`✅ Popular banks: ${popularBanks.length} records`);
    
    const [transactionColumns] = await connection.execute("SHOW COLUMNS FROM transactions LIKE 'bank_id'");
    console.log(`✅ Transaction bank_id column: ${transactionColumns.length > 0 ? 'Added' : 'Not found'}`);

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
      console.log('🔌 Database connection closed');
    }
  }
}

runMigration();
