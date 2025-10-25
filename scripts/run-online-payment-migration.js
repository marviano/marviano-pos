const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

// Database configuration
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'marviano_pos',
  port: parseInt(process.env.DB_PORT || '3306'),
};

async function runMigration() {
  let connection;
  
  try {
    console.log('🔄 Connecting to database...');
    connection = await mysql.createConnection(dbConfig);
    
    console.log('📖 Reading migration file...');
    const migrationPath = path.join(__dirname, 'add_online_payment_methods.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    
    // Split the SQL into individual statements
    const statements = migrationSQL
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));
    
    console.log(`📝 Found ${statements.length} SQL statements to execute`);
    
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      
      if (statement.toLowerCase().includes('alter table transactions drop column payment_method')) {
        console.log('⚠️  Skipping DROP COLUMN statement (commented out for safety)');
        continue;
      }
      
      try {
        console.log(`🔄 Executing statement ${i + 1}/${statements.length}...`);
        console.log(`   ${statement.substring(0, 100)}${statement.length > 100 ? '...' : ''}`);
        
        await connection.execute(statement);
        console.log(`✅ Statement ${i + 1} executed successfully`);
      } catch (error) {
        console.error(`❌ Error executing statement ${i + 1}:`, error.message);
        throw error;
      }
    }
    
    console.log('🎉 Migration completed successfully!');
    
    // Verification queries
    console.log('\n📊 Verification:');
    
    // Check if new payment methods were added
    const [paymentMethods] = await connection.execute(
      "SELECT * FROM payment_methods WHERE code IN ('gofood', 'grabfood', 'shopeefood', 'tiktok')"
    );
    console.log(`✅ Added ${paymentMethods.length} online payment methods`);
    
    // Check transaction mapping
    const [transactionCounts] = await connection.execute(
      "SELECT pm.name, pm.code, COUNT(t.id) as transaction_count FROM payment_methods pm LEFT JOIN transactions t ON pm.id = t.payment_method_id GROUP BY pm.id, pm.name, pm.code ORDER BY pm.name"
    );
    console.log('📈 Payment method usage:');
    transactionCounts.forEach(row => {
      console.log(`   ${row.name} (${row.code}): ${row.transaction_count} transactions`);
    });
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
      console.log('🔌 Database connection closed');
    }
  }
}

// Run the migration
runMigration();
