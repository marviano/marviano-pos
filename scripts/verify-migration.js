const mysql = require('mysql2/promise');
require('dotenv').config();

// Database configuration
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root', 
  password: process.env.DB_PASSWORD || 'MarvianoSalespulse96!',
  database: process.env.DB_NAME || 'salespulse',
  port: parseInt(process.env.DB_PORT || '3306')
};

async function checkMigration() {
  let connection;
  
  try {
    console.log('🔌 Connecting to database...');
    connection = await mysql.createConnection(dbConfig);
    
    console.log('🔍 Checking payment methods table...');
    const [paymentMethods] = await connection.execute(
      'SELECT * FROM payment_methods WHERE code IN ("gofood", "grabfood", "shopeefood", "tiktok")'
    );
    console.log('✅ Online payment methods found:', paymentMethods.length);
    paymentMethods.forEach(pm => {
      console.log(`   - ${pm.name} (${pm.code})`);
    });
    
    console.log('\n🔍 Checking transactions table structure...');
    const [columns] = await connection.execute('DESCRIBE transactions');
    const paymentMethodColumns = columns.filter(col => col.Field.includes('payment_method'));
    console.log('✅ Payment method columns:');
    paymentMethodColumns.forEach(col => {
      console.log(`   - ${col.Field}: ${col.Type} ${col.Null === 'NO' ? '(NOT NULL)' : '(NULL)'}`);
    });
    
    console.log('\n🔍 Checking recent transactions...');
    const [transactions] = await connection.execute(
      'SELECT id, payment_method_id, created_at FROM transactions ORDER BY created_at DESC LIMIT 5'
    );
    console.log('✅ Recent transactions:');
    transactions.forEach(t => {
      console.log(`   - Transaction ${t.id}: payment_method_id = ${t.payment_method_id}, created: ${t.created_at}`);
    });
    
    console.log('\n🔍 Testing payment method lookup...');
    const [testLookup] = await connection.execute(
      'SELECT pm.name, pm.code FROM payment_methods pm JOIN transactions t ON pm.id = t.payment_method_id LIMIT 3'
    );
    console.log('✅ Payment method lookup test:');
    testLookup.forEach(result => {
      console.log(`   - ${result.name} (${result.code})`);
    });
    
    console.log('\n🎉 Migration verification completed successfully!');
    
  } catch (error) {
    console.error('❌ Verification failed:', error.message);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
      console.log('🔌 Database connection closed');
    }
  }
}

// Run verification
checkMigration();
