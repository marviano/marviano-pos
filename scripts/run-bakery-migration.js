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
    console.log('🚀 Starting bakery products migration...');
    
    // Read and execute the SQL file
    const fs = require('fs');
    const sqlContent = fs.readFileSync('./database_migrations/insert_bakery_products.sql', 'utf8');
    
    // Split by semicolon and execute each statement
    const statements = sqlContent.split(';').filter(stmt => stmt.trim());
    
    for (const statement of statements) {
      if (statement.trim() && !statement.trim().startsWith('--')) {
        console.log('Executing:', statement.trim().substring(0, 50) + '...');
        await connection.execute(statement);
      }
    }
    
    console.log('✅ Bakery products migration completed successfully!');
    
    // Show the inserted products
    console.log('\n📋 Inserted bakery products:');
    const [products] = await connection.execute(`
      SELECT id, menu_code, nama, kategori, jenis, harga_jual, has_customization
      FROM products 
      WHERE business_id = 14 AND kategori = 'bakery'
      ORDER BY id DESC
    `);
    
    products.forEach(product => {
      console.log(`- ${product.nama} (${product.jenis}) - Rp ${product.harga_jual.toLocaleString()}`);
      if (product.has_customization) {
        console.log('  ↳ Has customizations/variants');
      }
    });
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    throw error;
  } finally {
    await connection.end();
  }
}

runMigration().catch(console.error);



