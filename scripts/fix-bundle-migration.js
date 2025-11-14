const mysql = require('mysql2/promise');
require('dotenv').config();

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'marviano_pos',
  port: parseInt(process.env.DB_PORT || '3306'),
};

async function fixMigration() {
  let connection;
  
  try {
    console.log('🔌 Connecting to database...');
    connection = await mysql.createConnection(dbConfig);
    
    // Add is_bundle column to products
    try {
      await connection.execute(
        'ALTER TABLE products ADD COLUMN is_bundle TINYINT(1) DEFAULT 0 COMMENT "Whether this product is a bundle"'
      );
      console.log('✅ Added is_bundle column to products');
    } catch (error) {
      if (error.code === 'ER_DUP_FIELDNAME') {
        console.log('⚠️  Column is_bundle already exists in products');
      } else {
        throw error;
      }
    }
    
    // Create bundle_items table if it doesn't exist
    try {
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS bundle_items (
          id INT NOT NULL AUTO_INCREMENT,
          bundle_product_id INT NOT NULL COMMENT 'Reference to products.id that is a bundle',
          category2_id INT NOT NULL COMMENT 'Category from which products can be selected',
          required_quantity INT NOT NULL DEFAULT 1 COMMENT 'How many items must be selected from this category',
          display_order INT DEFAULT 0 COMMENT 'Order in which this section appears in the bundle selection UI',
          created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          KEY idx_bundle_product (bundle_product_id),
          KEY idx_category2 (category2_id),
          CONSTRAINT fk_bundle_items_product FOREIGN KEY (bundle_product_id) REFERENCES products(id) ON DELETE CASCADE,
          CONSTRAINT fk_bundle_items_category2 FOREIGN KEY (category2_id) REFERENCES category2(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Defines the structure of bundle products'
      `);
      console.log('✅ Created bundle_items table');
    } catch (error) {
      if (error.code === 'ER_TABLE_EXISTS_ERROR') {
        console.log('⚠️  Table bundle_items already exists');
      } else {
        throw error;
      }
    }
    
    // Add bundle_selections_json column to transaction_items
    try {
      await connection.execute(
        'ALTER TABLE transaction_items ADD COLUMN bundle_selections_json JSON DEFAULT NULL COMMENT "JSON array storing selected products for bundle items"'
      );
      console.log('✅ Added bundle_selections_json column to transaction_items');
    } catch (error) {
      if (error.code === 'ER_DUP_FIELDNAME') {
        console.log('⚠️  Column bundle_selections_json already exists in transaction_items');
      } else {
        throw error;
      }
    }
    
    console.log('🎉 Migration fix completed successfully!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

fixMigration();
















