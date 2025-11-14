const mysql = require('mysql2/promise');
require('dotenv').config();

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'marviano_pos',
  port: parseInt(process.env.DB_PORT || '3306'),
};

async function checkBundleIssues() {
  let connection;
  
  try {
    connection = await mysql.createConnection(dbConfig);
    const BUSINESS_ID = 14;
    
    console.log('🔍 Checking bundle products...\n');
    
    // Check if bundles exist and their status
    const [bundles] = await connection.execute(
      'SELECT id, menu_code, nama, category2_id, is_bundle, status FROM products WHERE is_bundle = 1'
    );
    
    console.log(`Found ${bundles.length} bundle products:\n`);
    
    for (const bundle of bundles) {
      console.log(`Bundle: ${bundle.nama}`);
      console.log(`  ID: ${bundle.id}`);
      console.log(`  Status: ${bundle.status}`);
      console.log(`  Category2 ID: ${bundle.category2_id}`);
      
      // Check category name
      const [category] = await connection.execute(
        'SELECT name FROM category2 WHERE id = ?',
        [bundle.category2_id]
      );
      const categoryName = category.length > 0 ? category[0].name : 'Unknown';
      console.log(`  Category: ${categoryName}`);
      
      // Check if linked to business
      const [businessLink] = await connection.execute(
        'SELECT * FROM product_businesses WHERE product_id = ? AND business_id = ?',
        [bundle.id, BUSINESS_ID]
      );
      console.log(`  Linked to business ${BUSINESS_ID}: ${businessLink.length > 0 ? 'YES ✅' : 'NO ❌'}`);
      
      // Check if category matches hardcoded filter
      const drinksCategories = ['Ice Cream Cone', 'Sundae', 'Milk Tea', 'Iced Coffee'];
      const isInDrinksFilter = drinksCategories.includes(categoryName);
      console.log(`  In drinks filter: ${isInDrinksFilter ? 'YES ✅' : 'NO ❌'}`);
      
      console.log('');
    }
    
    console.log('\n📋 Issues found:');
    console.log('1. Products MUST be linked to business_id = 14 via product_businesses table');
    console.log('2. For drinks tab, categories must be: Ice Cream Cone, Sundae, Milk Tea, or Iced Coffee');
    console.log('3. Egg Waffle and Aren Milk Tea are NOT in the hardcoded drinks filter!\n');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

checkBundleIssues();
















