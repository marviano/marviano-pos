const mysql = require('mysql2/promise');
require('dotenv').config();

// Database configuration
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'marviano_pos',
  port: parseInt(process.env.DB_PORT || '3306'),
};

async function deleteBundleAndProducts() {
  let connection;
  
  try {
    console.log('🔌 Connecting to database...');
    connection = await mysql.createConnection(dbConfig);
    
    console.log('🗑️  Deleting Egg Waffle and Aren Milk Tea bundle and products...');
    
    const BUSINESS_ID = 14;
    
    // 1. Delete Bundle 1 (BUNDLE-001)
    console.log('\n📦 Deleting Bundle 1: "2 Egg Waffle Original + 2 Aren Milk Tea"...');
    
    // First, delete bundle_items for BUNDLE-001
    const [bundleProduct] = await connection.execute(
      'SELECT id FROM products WHERE menu_code = ?',
      ['BUNDLE-001']
    );
    
    if (bundleProduct.length > 0) {
      const bundleProductId = bundleProduct[0].id;
      
      // Delete bundle_items
      const [deleteBundleItems] = await connection.execute(
        'DELETE FROM bundle_items WHERE bundle_product_id = ?',
        [bundleProductId]
      );
      console.log(`  ✅ Deleted ${deleteBundleItems.affectedRows} bundle items`);
      
      // Delete product_businesses link
      await connection.execute(
        'DELETE FROM product_businesses WHERE product_id = ? AND business_id = ?',
        [bundleProductId, BUSINESS_ID]
      );
      
      // Delete the bundle product
      await connection.execute(
        'DELETE FROM products WHERE id = ?',
        [bundleProductId]
      );
      console.log('  ✅ Deleted bundle product');
    } else {
      console.log('  ℹ️  Bundle 1 not found (may already be deleted)');
    }
    
    // 2. Delete Egg Waffle products
    console.log('\n🥞 Deleting Egg Waffle products...');
    const eggWaffleProducts = [
      'EGG-MELONWAFFLE',
      'EGG-PEACHWAFFLE',
      'EGG-ORIGINALWAFFLE',
      'EGG-CHOCOLATEWAFFLE'
    ];
    
    for (const menuCode of eggWaffleProducts) {
      const [product] = await connection.execute(
        'SELECT id FROM products WHERE menu_code = ?',
        [menuCode]
      );
      
      if (product.length > 0) {
        const productId = product[0].id;
        
        // Delete product_businesses link
        await connection.execute(
          'DELETE FROM product_businesses WHERE product_id = ? AND business_id = ?',
          [productId, BUSINESS_ID]
        );
        
        // Delete the product
        await connection.execute(
          'DELETE FROM products WHERE id = ?',
          [productId]
        );
        console.log(`  ✅ Deleted: ${menuCode}`);
      } else {
        console.log(`  ℹ️  Not found: ${menuCode}`);
      }
    }
    
    // 3. Delete Aren Milk Tea products
    console.log('\n🧋 Deleting Aren Milk Tea products...');
    const arenProducts = [
      'AREN-ARENCOFFEEMILKTEA',
      'AREN-ARENHOTCOFFEE',
      'AREN-ARENMILKTEA',
      'AREN-ARENICEDCOFFEE'
    ];
    
    for (const menuCode of arenProducts) {
      const [product] = await connection.execute(
        'SELECT id FROM products WHERE menu_code = ?',
        [menuCode]
      );
      
      if (product.length > 0) {
        const productId = product[0].id;
        
        // Delete product_businesses link
        await connection.execute(
          'DELETE FROM product_businesses WHERE product_id = ? AND business_id = ?',
          [productId, BUSINESS_ID]
        );
        
        // Delete the product
        await connection.execute(
          'DELETE FROM products WHERE id = ?',
          [productId]
        );
        console.log(`  ✅ Deleted: ${menuCode}`);
      } else {
        console.log(`  ℹ️  Not found: ${menuCode}`);
      }
    }
    
    console.log('\n✅ All Egg Waffle and Aren Milk Tea products deleted successfully!');
    console.log('📝 Note: Categories (category2) were kept. Only products and bundle were deleted.');
    
  } catch (error) {
    console.error('❌ Error deleting products:', error);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

// Run the script
deleteBundleAndProducts();

