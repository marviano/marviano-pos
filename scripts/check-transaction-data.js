const mysql = require('mysql2/promise');
require('dotenv').config();

// Database configuration
const dbConfig = {
  host: process.env.DB_HOST || '217.217.252.95',
  user: process.env.DB_USER || 'root', 
  password: process.env.DB_PASSWORD || 'MarvianoSalespulse96!',
  database: process.env.DB_NAME || 'salespulse',
  port: parseInt(process.env.DB_PORT || '3306')
};

async function checkTransactionData() {
  let connection;
  
  try {
    console.log('🔌 Connecting to database...');
    connection = await mysql.createConnection(dbConfig);
    
    console.log('🔍 Checking recent transactions...');
    const [transactions] = await connection.execute(`
      SELECT 
        t.id,
        t.payment_method,
        t.payment_method_id,
        pm.code as payment_method_code,
        pm.name as payment_method_name,
        t.bank_id,
        t.card_number,
        t.created_at
      FROM transactions t
      LEFT JOIN payment_methods pm ON t.payment_method_id = pm.id
      ORDER BY t.created_at DESC 
      LIMIT 5
    `);
    
    console.log('✅ Recent transactions:');
    transactions.forEach(t => {
      console.log(`   Transaction ${t.id}:`);
      console.log(`     - payment_method (old): ${t.payment_method}`);
      console.log(`     - payment_method_id: ${t.payment_method_id}`);
      console.log(`     - payment_method_code: ${t.payment_method_code}`);
      console.log(`     - payment_method_name: ${t.payment_method_name}`);
      console.log(`     - bank_id: ${t.bank_id}`);
      console.log(`     - card_number: ${t.card_number ? '**** **** **** ' + t.card_number.slice(-4) : 'null'}`);
      console.log(`     - created: ${t.created_at}`);
      console.log('');
    });
    
    console.log('🔍 Checking payment methods table...');
    const [paymentMethods] = await connection.execute('SELECT * FROM payment_methods ORDER BY id');
    console.log('✅ Payment methods:');
    paymentMethods.forEach(pm => {
      console.log(`   ${pm.id}: ${pm.name} (${pm.code})`);
    });
    
  } catch (error) {
    console.error('❌ Check failed:', error.message);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
      console.log('🔌 Database connection closed');
    }
  }
}

// Run check
checkTransactionData();
