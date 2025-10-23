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

    // Read and execute payment methods table creation
    console.log('📋 Creating payment methods table...');
    const paymentMethodsSql = require('fs').readFileSync('./database_migrations/create_payment_methods_table.sql', 'utf8');
    await connection.execute(paymentMethodsSql);
    console.log('✅ Payment methods table created');

    // Insert payment methods data
    console.log('📋 Inserting payment methods data...');
    const paymentMethodsDataSql = require('fs').readFileSync('./database_migrations/insert_payment_methods_data.sql', 'utf8');
    await connection.execute(paymentMethodsDataSql);
    console.log('✅ Payment methods data inserted');

    // Read and execute CL accounts table creation
    console.log('👥 Creating CL accounts table...');
    const clAccountsSql = require('fs').readFileSync('./database_migrations/create_cl_accounts_table.sql', 'utf8');
    await connection.execute(clAccountsSql);
    console.log('✅ CL accounts table created');

    // Insert CL accounts data
    console.log('👥 Inserting CL accounts data...');
    const clAccountsDataSql = require('fs').readFileSync('./database_migrations/insert_cl_accounts_data.sql', 'utf8');
    await connection.execute(clAccountsDataSql);
    console.log('✅ CL accounts data inserted');

    // Read and execute transactions table updates
    console.log('💳 Updating transactions table...');
    
    // Add bank_name column
    const bankNameSql = require('fs').readFileSync('./database_migrations/update_transactions_for_payment_details.sql', 'utf8');
    await connection.execute(bankNameSql);
    console.log('✅ Added bank_name column');

    // Add card_number column
    const cardNumberSql = require('fs').readFileSync('./database_migrations/add_card_number_column.sql', 'utf8');
    await connection.execute(cardNumberSql);
    console.log('✅ Added card_number column');

    // Add cl_account_id column
    const clAccountIdSql = require('fs').readFileSync('./database_migrations/add_cl_account_id_column.sql', 'utf8');
    await connection.execute(clAccountIdSql);
    console.log('✅ Added cl_account_id column');

    // Add cl_account_name column
    const clAccountNameSql = require('fs').readFileSync('./database_migrations/add_cl_account_name_column.sql', 'utf8');
    await connection.execute(clAccountNameSql);
    console.log('✅ Added cl_account_name column');

    // Add indexes
    const indexesSql = require('fs').readFileSync('./database_migrations/add_transaction_indexes.sql', 'utf8');
    await connection.execute(indexesSql);
    console.log('✅ Added cl_account index');

    const bankIndexSql = require('fs').readFileSync('./database_migrations/add_bank_index.sql', 'utf8');
    await connection.execute(bankIndexSql);
    console.log('✅ Added bank index');

    console.log('🎉 Payment system migration completed successfully!');

    // Verify tables were created
    console.log('\n📊 Verifying tables...');
    
    const [paymentMethods] = await connection.execute('SELECT * FROM payment_methods');
    console.log(`✅ Payment methods: ${paymentMethods.length} records`);
    
    const [clAccounts] = await connection.execute('SELECT * FROM cl_accounts');
    console.log(`✅ CL accounts: ${clAccounts.length} records`);
    
    const [transactionColumns] = await connection.execute("SHOW COLUMNS FROM transactions LIKE 'bank_name'");
    console.log(`✅ Transaction columns: ${transactionColumns.length > 0 ? 'Updated' : 'Not found'}`);

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
