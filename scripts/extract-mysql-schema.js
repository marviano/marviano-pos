const mysql = require('mysql2/promise');
const fs = require('fs');
require('dotenv').config();

/**
 * Extract MySQL schema from Salespulse database
 * Outputs CREATE TABLE statements to a file
 */

async function extractMySQLSchema() {
  console.log('🔌 Connecting to MySQL database...');
  
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'marviano_pos',
    port: parseInt(process.env.DB_PORT || '3306')
  });
  
  try {
    // Get all table names
    const [tables] = await connection.query(`
      SELECT TABLE_NAME 
      FROM information_schema.TABLES 
      WHERE TABLE_SCHEMA = DATABASE()
      ORDER BY TABLE_NAME
    `);
    
    console.log(`📋 Found ${tables.length} tables\n`);
    
    const schemaStatements = [];
    
    for (const table of tables) {
      const tableName = table.TABLE_NAME;
      console.log(`   Extracting: ${tableName}`);
      
      const [createResult] = await connection.query(`SHOW CREATE TABLE \`${tableName}\``);
      const createStatement = createResult[0]['Create Table'];
      
      schemaStatements.push(createStatement + ';');
    }
    
    // Write to file
    const outputFile = process.argv[2] || 'mysql_schema.sql';
    const fullSchema = schemaStatements.join('\n\n');
    
    fs.writeFileSync(outputFile, fullSchema, 'utf8');
    
    console.log(`\n✅ Schema extracted successfully!`);
    console.log(`📄 Saved to: ${outputFile}`);
    console.log(`\nYou can now run:`);
    console.log(`   node scripts/compare-schemas.js ${outputFile}`);
    
  } finally {
    await connection.end();
  }
}

extractMySQLSchema().catch(error => {
  console.error('❌ Error:', error);
  process.exit(1);
});
