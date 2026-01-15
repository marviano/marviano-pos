const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

/**
 * Check which database tables are unused in the marviano-pos codebase
 * Searches through src/, electron/, and scripts/ directories
 */

async function checkUnusedTables() {
  console.log('🔌 Connecting to MySQL database...');
  
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'salespulse',
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
    
    console.log(`📋 Found ${tables.length} tables in database\n`);
    
    // Directories to search
    const searchDirs = [
      path.join(__dirname, '..', 'src'),
      path.join(__dirname, '..', 'electron'),
      path.join(__dirname, '..', 'scripts')
    ];
    
    // Get all files to search
    const filesToSearch = [];
    for (const dir of searchDirs) {
      if (fs.existsSync(dir)) {
        const files = getAllFiles(dir);
        filesToSearch.push(...files);
      }
    }
    
    console.log(`🔍 Searching ${filesToSearch.length} files for table references...\n`);
    
    // Check each table
    const usedTables = new Set();
    const unusedTables = [];
    
    for (const table of tables) {
      const tableName = table.TABLE_NAME;
      let found = false;
      
      // Search in all files
      for (const filePath of filesToSearch) {
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          
          // Check for various patterns:
          // - FROM table_name
          // - INTO table_name
          // - UPDATE table_name
          // - JOIN table_name
          // - 'table_name' (in strings)
          // - "table_name" (in strings)
          // - `table_name` (in template strings)
          // - table_name (as variable/identifier)
          
          const patterns = [
            // SQL patterns
            new RegExp(`FROM\\s+[\`'"]?${tableName}[\`'"]?\\b`, 'i'),
            new RegExp(`INTO\\s+[\`'"]?${tableName}[\`'"]?\\b`, 'i'),
            new RegExp(`UPDATE\\s+[\`'"]?${tableName}[\`'"]?\\b`, 'i'),
            new RegExp(`JOIN\\s+[\`'"]?${tableName}[\`'"]?\\b`, 'i'),
            // String literals
            new RegExp(`['"\`]${tableName}['"\`]`, 'i'),
            // Table name in comments (might indicate usage)
            new RegExp(`//.*${tableName}`, 'i'),
            new RegExp(`/\\*.*${tableName}.*\\*/`, 'i'),
          ];
          
          for (const pattern of patterns) {
            if (pattern.test(content)) {
              found = true;
              usedTables.add(tableName);
              break;
            }
          }
          
          if (found) break;
        } catch (err) {
          // Skip files that can't be read
        }
      }
      
      if (!found) {
        unusedTables.push(tableName);
      }
    }
    
    // Output results
    console.log('='.repeat(60));
    console.log('📊 RESULTS');
    console.log('='.repeat(60));
    console.log(`\n✅ Used tables: ${usedTables.size}`);
    console.log(`❌ Unused tables: ${unusedTables.length}\n`);
    
    if (unusedTables.length > 0) {
      console.log('❌ UNUSED TABLES:');
      console.log('-'.repeat(60));
      unusedTables.forEach((table, index) => {
        console.log(`${(index + 1).toString().padStart(3, ' ')}. ${table}`);
      });
      console.log('');
    } else {
      console.log('✅ All tables appear to be used!\n');
    }
    
    // Also show used tables for reference
    if (usedTables.size > 0) {
      console.log('✅ USED TABLES (sample, first 10):');
      console.log('-'.repeat(60));
      Array.from(usedTables).sort().slice(0, 10).forEach((table, index) => {
        console.log(`${(index + 1).toString().padStart(3, ' ')}. ${table}`);
      });
      if (usedTables.size > 10) {
        console.log(`   ... and ${usedTables.size - 10} more`);
      }
      console.log('');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await connection.end();
  }
}

/**
 * Recursively get all files in a directory
 */
function getAllFiles(dirPath, arrayOfFiles = []) {
  const files = fs.readdirSync(dirPath);
  
  files.forEach(file => {
    const filePath = path.join(dirPath, file);
    if (fs.statSync(filePath).isDirectory()) {
      // Skip node_modules and other common ignore directories
      if (!['node_modules', '.git', 'dist', 'out', '.next'].includes(file)) {
        arrayOfFiles = getAllFiles(filePath, arrayOfFiles);
      }
    } else {
      // Only include code files
      const ext = path.extname(file);
      if (['.ts', '.tsx', '.js', '.jsx', '.sql'].includes(ext)) {
        arrayOfFiles.push(filePath);
      }
    }
  });
  
  return arrayOfFiles;
}

checkUnusedTables().catch(error => {
  console.error('❌ Error:', error);
  process.exit(1);
});
