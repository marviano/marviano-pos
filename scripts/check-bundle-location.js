const mysql = require('mysql2/promise');
require('dotenv').config();

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'marviano_pos',
  port: parseInt(process.env.DB_PORT || '3306'),
};

async function checkBundleLocation() {
  let connection;
  
  try {
    connection = await mysql.createConnection(dbConfig);
    
    // Get all bundle products
    const [bundles] = await connection.execute(
      'SELECT id, menu_code, nama, category2_id, is_bundle FROM products WHERE is_bundle = 1'
    );
    
    console.log('📦 Bundle Products Found:');
    console.log('='.repeat(60));
    
    for (const bundle of bundles) {
      console.log(`\nBundle ID: ${bundle.id}`);
      console.log(`  Name: ${bundle.nama}`);
      console.log(`  Code: ${bundle.menu_code}`);
      console.log(`  Category2 ID: ${bundle.category2_id}`);
      
      // Get category name
      const [category] = await connection.execute(
        'SELECT id, name FROM category2 WHERE id = ?',
        [bundle.category2_id]
      );
      
      if (category.length > 0) {
        console.log(`  Category: ${category[0].name}`);
        
        // Check if category is "Bakery" (which goes to bakery tab)
        // Everything else goes to drinks tab
        const isBakery = category[0].name === 'Bakery';
        console.log(`  📍 Tab Location: ${isBakery ? '🥖 BAKERY' : '🥤 DRINKS'} (Offline & Online)`);
      }
      
      // Get bundle items configuration
      const [bundleItems] = await connection.execute(
        `SELECT bi.*, c2.name as category_name 
         FROM bundle_items bi 
         LEFT JOIN category2 c2 ON bi.category2_id = c2.id
         WHERE bi.bundle_product_id = ? 
         ORDER BY bi.display_order`,
        [bundle.id]
      );
      
      console.log(`  Bundle Configuration:`);
      bundleItems.forEach((item, idx) => {
        console.log(`    ${idx + 1}. Category: ${item.category_name} - Select ${item.required_quantity} items`);
      });
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('\n📍 WHERE TO FIND THEM:');
    console.log('\n1. Go to Kasir page');
    console.log('2. Click on the RIGHT SIDEBAR category where the bundle belongs:');
    
    for (const bundle of bundles) {
      const [category] = await connection.execute(
        'SELECT name FROM category2 WHERE id = ?',
        [bundle.category2_id]
      );
      if (category.length > 0) {
        const isBakery = category[0].name === 'Bakery';
        const tabName = isBakery ? '🥖 Bakery' : '🥤 Drinks';
        console.log(`   - ${tabName} tab → Click "${category[0].name}" category → Look for "${bundle.nama}"`);
      }
    }
    
    console.log('\n💡 Note: Bundles work in BOTH offline and online tabs!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

checkBundleLocation();

