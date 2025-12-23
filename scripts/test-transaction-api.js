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

async function testTransactionAPI() {
  let connection;
  
  try {
    console.log('🔌 Connecting to database...');
    connection = await mysql.createConnection(dbConfig);
    
    console.log('🔍 Testing transaction API query...');
    const [transactions] = await connection.execute(`
      SELECT 
        t.id,
        t.business_id,
        t.user_id,
        t.pickup_method,
        t.total_amount,
        t.voucher_discount,
        t.final_amount,
        t.amount_received,
        t.change_amount,
        t.status,
        t.created_at,
        t.updated_at,
        t.contact_id,
        t.customer_name,
        t.note,
        t.bank_name,
        t.card_number,
        t.cl_account_id,
        t.cl_account_name,
        t.bank_id,
        t.receipt_number,
        t.transaction_type,
        pm.code as payment_method,
        pm.name as payment_method_name
      FROM transactions t
      LEFT JOIN payment_methods pm ON t.payment_method_id = pm.id
      ORDER BY t.created_at DESC 
      LIMIT 3
    `);
    
    console.log('✅ API Query Results:');
    transactions.forEach(t => {
      console.log(`   Transaction ${t.id}:`);
      console.log(`     - payment_method: ${t.payment_method}`);
      console.log(`     - payment_method_name: ${t.payment_method_name}`);
      console.log(`     - bank_id: ${t.bank_id}`);
      console.log(`     - card_number: ${t.card_number ? '**** **** **** ' + t.card_number.slice(-4) : 'null'}`);
      console.log(`     - created: ${t.created_at}`);
      console.log('');
    });
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
      console.log('🔌 Database connection closed');
    }
  }
}

// Run test
testTransactionAPI();
