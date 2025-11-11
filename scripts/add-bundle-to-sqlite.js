const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// SQLite database path
const dbPath = path.join(__dirname, '../dist/pos-offline.db');

if (!fs.existsSync(dbPath)) {
  console.error(`❌ SQLite database not found at: ${dbPath}`);
  console.log('💡 Please make sure the app has been run at least once to create the SQLite database.');
  process.exit(1);
}

const db = new Database(dbPath);

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');

console.log('📱 Connecting to SQLite database...\n');

try {
  // Ensure schema exists
  console.log('📋 Checking schema...');
  
  // Check if is_bundle column exists
  const productSchema = db.prepare(`PRAGMA table_info(products)`).all();
  const hasIsBundle = productSchema.some(col => col.name === 'is_bundle');
  
  if (!hasIsBundle) {
    console.log('  Adding is_bundle column...');
    db.prepare('ALTER TABLE products ADD COLUMN is_bundle INTEGER DEFAULT 0').run();
    console.log('  ✅ Added is_bundle column');
  } else {
    console.log('  ✅ is_bundle column exists');
  }
  
  // Check if bundle_items table exists
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='bundle_items'`).get();
  if (!tables) {
    console.log('  Creating bundle_items table...');
    db.prepare(`
      CREATE TABLE bundle_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bundle_product_id INTEGER NOT NULL,
        category2_id INTEGER NOT NULL,
        required_quantity INTEGER NOT NULL DEFAULT 1,
        display_order INTEGER DEFAULT 0,
        created_at TEXT,
        updated_at INTEGER,
        FOREIGN KEY (bundle_product_id) REFERENCES products(id) ON DELETE CASCADE,
        FOREIGN KEY (category2_id) REFERENCES category2(id) ON DELETE CASCADE
      )
    `).run();
    console.log('  ✅ Created bundle_items table');
  } else {
    console.log('  ✅ bundle_items table exists');
  }
  
  // Check if bundle_selections_json column exists in transaction_items
  const txSchema = db.prepare(`PRAGMA table_info(transaction_items)`).all();
  const hasBundleSelections = txSchema.some(col => col.name === 'bundle_selections_json');
  
  if (!hasBundleSelections) {
    console.log('  Adding bundle_selections_json column...');
    db.prepare('ALTER TABLE transaction_items ADD COLUMN bundle_selections_json TEXT').run();
    console.log('  ✅ Added bundle_selections_json column');
  } else {
    console.log('  ✅ bundle_selections_json column exists');
  }
  
  console.log('\n📦 Adding bundle data to SQLite...\n');
  
  const BUSINESS_ID = 14;
  
  // Get or create categories
  let eggWaffleId, arenMilkTeaId, iceCreamConeId;
  
  // Egg Waffle
  let eggWaffle = db.prepare('SELECT id FROM category2 WHERE name = ?').get('Egg Waffle');
  if (!eggWaffle) {
    db.prepare('INSERT INTO category2 (name, display_order, is_active) VALUES (?, ?, ?)').run('Egg Waffle', 1, 1);
    eggWaffle = db.prepare('SELECT id FROM category2 WHERE name = ?').get('Egg Waffle');
  }
  eggWaffleId = eggWaffle.id;
  console.log(`✅ Egg Waffle category ID: ${eggWaffleId}`);
  
  // Aren Milk Tea
  let arenMilkTea = db.prepare('SELECT id FROM category2 WHERE name = ?').get('Aren Milk Tea');
  if (!arenMilkTea) {
    db.prepare('INSERT INTO category2 (name, display_order, is_active) VALUES (?, ?, ?)').run('Aren Milk Tea', 2, 1);
    arenMilkTea = db.prepare('SELECT id FROM category2 WHERE name = ?').get('Aren Milk Tea');
  }
  arenMilkTeaId = arenMilkTea.id;
  console.log(`✅ Aren Milk Tea category ID: ${arenMilkTeaId}`);
  
  // Ice Cream Cone
  let iceCreamCone = db.prepare('SELECT id FROM category2 WHERE name = ?').get('Ice Cream Cone');
  if (!iceCreamCone) {
    db.prepare('INSERT INTO category2 (name, display_order, is_active) VALUES (?, ?, ?)').run('Ice Cream Cone', 3, 1);
    iceCreamC转向 = db.prepare('SELECT id FROM category2 WHERE name = ?').get('Ice Cream Cone');
  }
  iceCreamConeId = iceCreamCone.id;
  console.log(`✅ Ice Cream Cone category ID: ${iceCreamConeId}`);
  
  // Bundle 1: 2 Egg Waffle + 2 Aren Milk Tea
  console.log('\n📦 Creating Bundle 1...');
  const insertBundle1 = db.prepare(`
    INSERT INTO products (menu_code, nama, satuan, harga_jual, status, is_bundle, category2_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(menu_code) DO UPDATE SET
      nama = excluded.nama,
      is_bundle = excluded.is_bundle,
      harga_jual = excluded.harga_jual
  `);
  
  try {
    insertBundle1.run('BUNDLE-001', '2 Egg Waffle Original + 2 Aren Milk Tea', 'bundle这样一个', 50000, 'active', 1, eggWaffleId);
  } catch (e) {
    // SQLite doesn't support ON CONFLICT the same way, try without it
    const existing = db.prepare('SELECT id FROM products WHERE menu_code = ?').get('BUNDLE-001');
    if (!existing) {
      db.prepare(`
        INSERT INTO products (menu_code, nama, satuan, harga_jual, status, is_bundle, category2_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('BUNDLE-001', '2 Egg Waffle Original + 2 Aren Milk Tea', 'bundle', 50000, 'active', 1, eggWaffleId);
    } else {
      db.prepare(`
        UPDATE products SET nama = ?, is_bundle = ?, harga_jual = ? WHERE menu_code = ?
      `).run('2 Egg Waffle Original + 2 Aren Milk Tea', 1, 50000, 'BUNDLE-001');
    }
  }
  
  const bundle1 = db.prepare('SELECT id FROM products WHERE menu_code = ?').get('BUNDLE-001');
  const bundle1Id = bundle1.id;
  console.log(`  ✅ Bundle 1 ID: ${bundle1Id}`);
  
  // Link to business
  const existingLink1 = db.prepare('SELECT * FROM product_businesses WHERE product_id = ? AND business_id = ?').get(bundle1Id, BUSINESS_ID);
  if (!existingLink1) {
    db.prepare('INSERT INTO product_businesses (product_id, business_id) VALUES (?, ?)').run(bundle1Id, BUSINESS_ID);
    console.log(`  ✅ Linked to business ${BUSINESS_ID}`);
  }
  
  // Bundle items for Bundle 1
  const existingBI1a = db.prepare('SELECT id FROM bundle_items WHERE bundle_product_id = ? AND category2_id = ?').get(bundle1Id, eggWaffleId);
  if (!existingBI1a) {
    db.prepare(`
      INSERT INTO bundle_items (bundle_product_id, category2_id, required_quantity, display_order)
      VALUES (?, ?, ?, ?)
    `).run(bundle1Id, eggWaffleId, 2, 1);
  }
  
  const existingBI1b = db.prepare('SELECT id FROM bundle_items WHERE bundle_product_id = ? AND category2_id = ?').get(bundle1Id, arenMilkTeaId);
  if (!existingBI1b) {
    db.prepare(`
      INSERT INTO bundle_items (bundle_product_id, category2_id, required_quantity, display_order)
      VALUES (?, ?, ?, ?)
    `).run(bundle1Id, arenMilkTeaId, 2, 2);
  }
  
  // Bundle 2: 3 Ice Cream Cone
  console.log('\n📦 Creating Bundle 2...');
  const existing2 = db.prepare('SELECT id FROM products WHERE menu_code = ?').get('BUNDLE-002');
  let bundle2Id;
  if (!existing2) {
    db.prepare(`
      INSERT INTO products (menu_code, nama, satuan, harga_jual, status, is_bundle, category2_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('BUNDLE-002', '3 Ice Cream Cone', 'bundle', 45000, 'active', 1, iceCreamConeId);
    const bundle2 = db.prepare('SELECT id FROM products WHERE menu_code = ?').get('BUNDLE-002');
    bundle2Id = bundle2.id;
  } else {
    db.prepare(`
      UPDATE products SET nama = ?, is_bundle = ?, harga_jual = ? WHERE menu_code = ?
    `).run('3 Ice Cream Cone', 1, 45000, 'BUNDLE-002');
    bundle2Id = existing2.id;
  }
  console.log(`  ✅ Bundle 2 ID: ${bundle2Id}`);
  
  // Link to business
  const existingLink2 = db.prepare('SELECT * FROM product_businesses WHERE product_id = ? AND business_id = ?').get(bundle2Id, BUSINESS_ID);
  if (!existingLink2) {
    db.prepare('INSERT INTO product_businesses (product_id, business_id) VALUES (?, ?)').run(bundle2Id, BUSINESS_ID);
    console.log(`  ✅ Linked to business ${BUSINESS_ID}`);
  }
  
  // Bundle items for Bundle 2
  const existingBI2 = db.prepare('SELECT id FROM bundle_items WHERE bundle_product_id = ? AND category2_id = ?').get(bundle2Id, iceCreamConeId);
  if (!existingBI2) {
    db.prepare(`
      INSERT INTO bundle_items (bundle_product_id, category2_id, required_quantity, display_order)
      VALUES (?, ?, ?, ?)
    `).run(bundle2Id, iceCreamConeId, 3, 1);
  }
  
  // Create sample products
  console.log('\n📦 Creating sample products...');
  
  const eggWaffleProducts = [
    { code: 'EGG-MELONWAFFLE', name: 'Melon Waffle', price: 15000 },
    { code: 'EGG-PEACHWAFFLE', name: 'Peach Waffle', price: 15000 },
    { code: 'EGG-ORIGINALWAFFLE', name: 'Original Waffle', price: 12000 },
    { code: 'EGG-CHOCOLATEWAFFLE', name: 'Chocolate Waffle', price: 15000 }
  ];
  
  for (const prod of eggWaffleProducts) {
    const existing = db.prepare('SELECT id FROM products WHERE menu_code = ?').get(prod.code);
    if (!existing) {
      db.prepare(`
        INSERT INTO products (menu_code, nama, satuan, harga_jual, status, category2_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(prod.code, prod.name, 'pcs', prod.price, 'active', eggWaffleId);
      const newProd = db.prepare('SELECT id FROM products WHERE menu_code = ?').get(prod.code);
      db.prepare('INSERT INTO product_businesses (product_id, business_id) VALUES (?, ?)').run(newProd.id, BUSINESS_ID);
    }
  }
  
  const arenProducts = [
    { code: 'AREN-ARENCOFFEEMILKTEA', name: 'Aren Coffee Milk Tea', price: 18000 },
    { code: 'AREN-ARENHOTCOFFEE', name: 'Aren Hot Coffee', price: 15000 },
    { code: 'AREN-ARENMILKTEA', name: 'Aren Milk Tea', price: 16000 },
    { code: 'AREN-ARENICEDCOFFEE', name: 'Aren Iced Coffee', price: 17000 }
  ];
  
  for (const prod of arenProducts) {
    const existing = db.prepare('SELECT id FROM products WHERE menu_code = ?').get(prod.code);
    if (!existing) {
      db.prepare(`
        INSERT INTO products (menu_code, nama, satuan, harga_jual, status, category2_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(prod.code, prod.name, 'cup', prod.price, 'active', arenMilkTeaId);
      const newProd = db.prepare('SELECT id FROM products WHERE menu_code = ?').get(prod.code);
      db.prepare('INSERT INTO product_businesses (product_id, business_id) VALUES (?, ?)').run(newProd.id, BUSINESS_ID);
    }
  }
  
  const iceProducts = [
    { code: 'ICE-ICECREAMCONEMELON', name: 'Ice Cream Cone Melon', price: 15000 },
    { code: 'ICE-ICECREAMCONEVANILLA', name: 'Ice Cream Cone Vanilla', price: 15000 },
    { code: 'ICE-ICECREAMCONECHOCOLATE', name: 'Ice Cream Cone Chocolate', price: 15000 },
    { code: 'ICE-ICECREAMCONESTRAWBERRY', name: 'Ice Cream Cone Strawberry', price: 15000 }
  ];
  
  for (const prod of iceProducts) {
    const existing = db.prepare('SELECT id FROM products WHERE menu_code = ?').get(prod.code);
    if (!existing) {
      db.prepare(`
        INSERT INTO products (menu_code, nama, satuan, harga_jual, status, category2_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(prod.code, prod.name, 'pcs', prod.price, 'active', iceCreamConeId);
      const newProd = db.prepare('SELECT id FROM products WHERE menu_code = ?').get(prod.code);
      db.prepare('INSERT INTO product_businesses (product_id, business_id) VALUES (?, ?)').run(newProd.id, BUSINESS_ID);
    }
  }
  
  console.log('\n✅ All bundles and products added to SQLite!');
  console.log('\n📍 Where to find:');
  console.log('  - 🥤 Drinks tab → "Egg Waffle" → "2 Egg Waffle Original + 2 Aren Milk Tea"');
  console.log('  - 🥤 Drinks tab → "Ice Cream Cone" → "3 Ice Cream Cone"');
  console.log('\n💡 Restart your app to see the changes!');
  
} catch (error) {
  console.error('❌ Error:', error.message);
  console.error(error);
  process.exit(1);
} finally {
  db.close();
}






