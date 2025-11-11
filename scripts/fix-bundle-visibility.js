const mysql = require('mysql2/promise');
require('dotenv').config();

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'marviano_pos',
  port: parseInt(process.env.DB_PORT || '3306'),
};

async function fixBundleVisibility() {
  let connection;
  
  try {
    connection = await mysql.createConnection(dbConfig);
    const BUSINESS_ID = 14;
    
    console.log('🔧 Fixing bundle visibility issues...\n');
    
    // Get all bundle products
    const [bundles] = await connection.execute(
      'SELECT id, menu_code, nama FROM products WHERE is_bundle = 1'
    );
    
    console.log(`Found ${bundles.length} bundle products to fix\n`);
    
    for (const bundle of bundles) {
      // Link bundle to business
      try {
        await connection.execute(
          'INSERT INTO product_businesses (product_id, business_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE product_id = product_id',
          [bundle.id, BUSINESS_ID]
        );
        console.log(`✅ Linked "${bundle.nama}" to business ${BUSINESS_ID}`);
      } catch (error) {
        if (error.code !== 'ER_DUP_ENTRY') {
          throw error;
        }
        console.log(`⚠️  "${bundle.nama}" already linked to business ${BUSINESS_ID}`);
      }
    }
    
    // Now check if "Egg Waffle" and "Aren Milk Tea" categories exist
    // and if we need to add them to the drinks filter
    const [eggWaffleCategory] = await connection.execute(
      'SELECT id, name FROM category2 WHERE name = ?',
      ['Egg Waffle']
    );
    
    const [arenMilkTeaCategory] = await connection.execute(
      'SELECT id, name FROM category2 WHERE name = ?',
      ['Aren Milk Tea']
    );
    
    console.log('\n📋 Category Status:');
    if (eggWaffleCategory.length > 0) {
      console.log(`  ✅ Egg Waffle category exists (ID: ${eggWaffleCategory[0].id})`);
      console.log(`     ⚠️  This category is NOT in the hardcoded drinks filter!`);
      console.log(`     💡 You need to either:`);
      console.log(`        - Update the API filter to include "Egg Waffle"`);
      console.log(`        - OR move the bundle to an existing model category`);
    }
    
    if (arenMilkTeaCategory.length > 0) {
      console.log(`  ✅ Aren Milk Tea category exists (ID: ${arenMilkTeaCategory[0].id})`);
      console.log(`     ⚠️  This category is NOT in the hardcoded drinks filter!`);
    }
    
    console.log('\n✅ Fix completed!');
    console.log('\n📍 Where to find bundles NOW:');
    console.log('  - "3 Ice Cream Cone" → 🥤 Drinks tab → "Ice Cream Cone" category ✅');
    console.log('  - "2 Egg Waffle..." → Currently WON\'T show (category not in filter) ❌');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

fixBundleVisibility();






