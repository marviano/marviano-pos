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

async function addDummyData() {
  let connection;
  
  try {
    console.log('🔌 Connecting to database...');
    connection = await mysql.createConnection(dbConfig);
    
    console.log('📦 Adding bundle dummy data...');
    
    const BUSINESS_ID = 14;
    
    // First, let's find or create the necessary categories
    // Assuming we have "Egg Waffle" and "Aren Milk Tea" categories
    const [eggWaffleCategory] = await connection.execute(
      'SELECT id FROM category2 WHERE name = ? LIMIT 1',
      ['Egg Waffle']
    );
    
    const [arenMilkTeaCategory] = await connection.execute(
      'SELECT id FROM category2 WHERE name = ? LIMIT 1',
      ['Aren Milk Tea']
    );
    
    if (eggWaffleCategory.length === 0 || arenMilkTeaCategory.length === 0) {
      console.log('⚠️  Categories not found. Creating sample categories...');
      
      // Create categories if they don't exist
      if (eggWaffleCategory.length === 0) {
        await connection.execute(
          'INSERT INTO category2 (name, display_order, is_active) VALUES (?, ?, ?)',
          ['Egg Waffle', 1, 1]
        );
        const [newEgg] = await connection.execute('SELECT id FROM category2 WHERE name = ?', ['Egg Waffle']);
        eggWaffleCategory.push(newEgg[0]);
      }
      
      if (arenMilkTeaCategory.length === 0) {
        await connection.execute(
          'INSERT INTO category2 (name, display_order, is_active) VALUES (?, ?, ?)',
          ['Aren Milk Tea', 2, 1]
        );
        const [newAren] = await connection.execute('SELECT id FROM category2 WHERE name = ?', ['Aren Milk Tea']);
        arenMilkTeaCategory.push(newAren[0]);
      }
    }
    
    const eggWaffleId = eggWaffleCategory[0].id;
    const arenMilkTeaId = arenMilkTeaCategory[0].id;
    
    console.log('✅ Category IDs:', { eggWaffleId, arenMilkTeaId });
    
    // Create the bundle product: "2 egg waffle original + 2 aren milk tea"
    const [bundleProduct] = await connection.execute(
      `INSERT INTO products (
        menu_code, nama, satuan, harga_jual, status, is_bundle, category2_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE nama = VALUES(nama), is_bundle = VALUES(is_bundle)`,
      [
        'BUNDLE-001',
        '2 Egg Waffle Original + 2 Aren Milk Tea',
        'bundle',
        50000, // Bundle price
        'active',
        1, // is_bundle = true
        eggWaffleId // Use first category as primary
      ]
    );
    
    // Get the bundle product ID
    const [bundleResult] = await connection.execute(
      'SELECT id FROM products WHERE menu_code = ?',
      ['BUNDLE-001']
    );
    const bundleProductId = bundleResult[0].id;
    
    console.log('✅ Bundle product created with ID:', bundleProductId);
    
    // Link bundle product to business_id 14
    await connection.execute(
      `INSERT INTO product_businesses (product_id, business_id)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE product_id = VALUES(product_id)`,
      [bundleProductId, BUSINESS_ID]
    );
    console.log('✅ Bundle product linked to business_id', BUSINESS_ID);
    
    // Create bundle_items entries
    // First section: 2 Egg Waffle
    await connection.execute(
      `INSERT INTO bundle_items (
        bundle_product_id, category2_id, required_quantity, display_order
      ) VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE 
        category2_id = VALUES(category2_id),
        required_quantity = VALUES(required_quantity),
        display_order = VALUES(display_order)`,
      [bundleProductId, eggWaffleId, 2, 1]
    );
    
    // Second section: 2 Aren Milk Tea
    await connection.execute(
      `INSERT INTO bundle_items (
        bundle_product_id, category2_id, required_quantity, display_order
      ) VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE 
        category2_id = VALUES(category2_id),
        required_quantity = VALUES(required_quantity),
        display_order = VALUES(display_order)`,
      [bundleProductId, arenMilkTeaId, 2, 2]
    );
    
    console.log('✅ Bundle items created');
    
    // Create sample products for Egg Waffle category (if they don't exist)
    const eggWaffleProducts = [
      { name: 'Melon Waffle', price: 15000 },
      { name: 'Peach Waffle', price: 15000 },
      { name: 'Original Waffle', price: 12000 },
      { name: 'Chocolate Waffle', price: 15000 }
    ];
    
    for (const prod of eggWaffleProducts) {
      const menuCode = `EGG-${prod.name.replace(/\s+/g, '').toUpperCase()}`;
      
      // Insert or update product
      await connection.execute(
        `INSERT INTO products (menu_code, nama, satuan, harga_jual, status, category2_id)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE nama = VALUES(nama)`,
        [
          menuCode,
          prod.name,
          'pcs',
          prod.price,
          'active',
          eggWaffleId
        ]
      );
      
      // Get product ID
      const [productResult] = await connection.execute(
        'SELECT id FROM products WHERE menu_code = ?',
        [menuCode]
      );
      const productId = productResult[0].id;
      
      // Link to business_id 14
      await connection.execute(
        `INSERT INTO product_businesses (product_id, business_id)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE product_id = VALUES(product_id)`,
        [productId, BUSINESS_ID]
      );
    }
    
    console.log('✅ Egg Waffle products created and linked to business_id', BUSINESS_ID);
    
    // Create sample products for Aren Milk Tea category (if they don't exist)
    const arenMilkTeaProducts = [
      { name: 'Aren Coffee Milk Tea', price: 18000 },
      { name: 'Aren Hot Coffee', price: 15000 },
      { name: 'Aren Milk Tea', price: 16000 },
      { name: 'Aren Iced Coffee', price: 17000 }
    ];
    
    for (const prod of arenMilkTeaProducts) {
      const menuCode = `AREN-${prod.name.replace(/\s+/g, '').toUpperCase()}`;
      
      // Insert or update product
      await connection.execute(
        `INSERT INTO products (menu_code, nama, satuan, harga_jual, status, category2_id)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE nama = VALUES(nama)`,
        [
          menuCode,
          prod.name,
          'cup',
          prod.price,
          'active',
          arenMilkTeaId
        ]
      );
      
      // Get product ID
      const [productResult] = await connection.execute(
        'SELECT id FROM products WHERE menu_code = ?',
        [menuCode]
      );
      const productId = productResult[0].id;
      
      // Link to business_id 14
      await connection.execute(
        `INSERT INTO product_businesses (product_id, business_id)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE product_id = VALUES(product_id)`,
        [productId, BUSINESS_ID]
      );
    }
    
    console.log('✅ Aren Milk Tea products created and linked to business_id', BUSINESS_ID);
    
    // Create another bundle example: "3 Ice Cream Cone"
    // First, get or create Ice Cream Cone category
    const [iceCreamConeCategory] = await connection.execute(
      'SELECT id FROM category2 WHERE name = ? LIMIT 1',
      ['Ice Cream Cone']
    );
    
    let iceCreamConeId;
    if (iceCreamConeCategory.length === 0) {
      await connection.execute(
        'INSERT INTO category2 (name, display_order, is_active) VALUES (?, ?, ?)',
        ['Ice Cream Cone', 3, 1]
      );
      const [newIce] = await connection.execute('SELECT id FROM category2 WHERE name = ?', ['Ice Cream Cone']);
      iceCreamConeId = newIce[0].id;
    } else {
      iceCreamConeId = iceCreamConeCategory[0].id;
    }
    
    // Create bundle product
    const [bundle2Result] = await connection.execute(
      `INSERT INTO products (
        menu_code, nama, satuan, harga_jual, status, is_bundle, category2_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE nama = VALUES(nama), is_bundle = VALUES(is_bundle)`,
      [
        'BUNDLE-002',
        '3 Ice Cream Cone',
        'bundle',
        45000,
        'active',
        1,
        iceCreamConeId
      ]
    );
    
    const [bundle2Product] = await connection.execute(
      'SELECT id FROM products WHERE menu_code = ?',
      ['BUNDLE-002']
    );
    const bundle2ProductId = bundle2Product[0].id;
    
    // Link bundle 2 product to business_id 14
    await connection.execute(
      `INSERT INTO product_businesses (product_id, business_id)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE product_id = VALUES(product_id)`,
      [bundle2ProductId, BUSINESS_ID]
    );
    console.log('✅ Bundle 2 product linked to business_id', BUSINESS_ID);
    
    // Create bundle item: 3 Ice Cream Cone
    await connection.execute(
      `INSERT INTO bundle_items (
        bundle_product_id, category2_id, required_quantity, display_order
      ) VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE 
        category2_id = VALUES(category2_id),
        required_quantity = VALUES(required_quantity),
        display_order = VALUES(display_order)`,
      [bundle2ProductId, iceCreamConeId, 3, 1]
    );
    
    // Create sample ice cream cone products
    const iceCreamProducts = [
      { name: 'Ice Cream Cone Melon', price: 15000 },
      { name: 'Ice Cream Cone Vanilla', price: 15000 },
      { name: 'Ice Cream Cone Chocolate', price: 15000 },
      { name: 'Ice Cream Cone Strawberry', price: 15000 }
    ];
    
    for (const prod of iceCreamProducts) {
      const menuCode = `ICE-${prod.name.replace(/\s+/g, '').toUpperCase()}`;
      
      // Insert or update product
      await connection.execute(
        `INSERT INTO products (menu_code, nama, satuan, harga_jual, status, category2_id)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE nama = VALUES(nama)`,
        [
          menuCode,
          prod.name,
          'pcs',
          prod.price,
          'active',
          iceCreamConeId
        ]
      );
      
      // Get product ID
      const [productResult] = await connection.execute(
        'SELECT id FROM products WHERE menu_code = ?',
        [menuCode]
      );
      const productId = productResult[0].id;
      
      // Link to business_id 14
      await connection.execute(
        `INSERT INTO product_businesses (product_id, business_id)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE product_id = VALUES(product_id)`,
        [productId, BUSINESS_ID]
      );
    }
    
    console.log('✅ Ice Cream Cone bundle and products created and linked to business_id', BUSINESS_ID);
    
    console.log('🎉 All dummy data added successfully!');
    console.log('');
    console.log('📋 Summary:');
    console.log('- Bundle 1: "2 Egg Waffle Original + 2 Aren Milk Tea" (ID:', bundleProductId + ')');
    console.log('- Bundle 2: "3 Ice Cream Cone" (ID:', bundle2ProductId + ')');
    console.log('');
    console.log('✨ You can now test the bundle feature in your POS!');
    
  } catch (error) {
    console.error('❌ Error adding dummy data:', error);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

// Run the script
addDummyData();

