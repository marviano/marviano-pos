/**
 * Diagnostic script to check database initialization issues
 */

const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');
const fs = require('fs');

console.log('🔍 Database Initialization Diagnostic\n');

// Check possible database paths
const possiblePaths = [
  path.join(os.homedir(), 'AppData', 'Roaming', 'marviano-pos', 'pos-offline.db'),
  path.join(os.homedir(), 'AppData', 'Local', 'marviano-pos', 'pos-offline.db'),
];

console.log('Checking database paths:');
possiblePaths.forEach((dbPath, i) => {
  const exists = fs.existsSync(dbPath);
  console.log(`  ${i + 1}. ${dbPath}`);
  console.log(`     Exists: ${exists ? '✅ YES' : '❌ NO'}`);
  
  if (exists) {
    try {
      const stats = fs.statSync(dbPath);
      console.log(`     Size: ${stats.size} bytes`);
      console.log(`     Modified: ${stats.mtime}`);
      
      // Try to open it
      try {
        const db = new Database(dbPath);
        const tableCount = db.prepare('SELECT count(*) as count FROM sqlite_master').get();
        console.log(`     Tables: ${tableCount.count}`);
        
        // Check if transactions table exists
        try {
          const txCount = db.prepare('SELECT count(*) as count FROM transactions').get();
          console.log(`     Transactions: ${txCount.count}`);
        } catch (e) {
          console.log(`     Transactions table: ❌ Does not exist`);
        }
        
        db.close();
        console.log(`     Status: ✅ Can be opened successfully\n`);
      } catch (openErr) {
        console.log(`     Status: ❌ Cannot be opened: ${openErr.message}\n`);
      }
    } catch (statErr) {
      console.log(`     Status: ❌ Cannot read file stats: ${statErr.message}\n`);
    }
  } else {
    // Check if directory exists
    const dir = path.dirname(dbPath);
    const dirExists = fs.existsSync(dir);
    console.log(`     Directory exists: ${dirExists ? '✅ YES' : '❌ NO'}`);
    
    if (!dirExists) {
      console.log(`     Directory: ${dir}`);
      try {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`     ✅ Created directory`);
      } catch (mkdirErr) {
        console.log(`     ❌ Cannot create directory: ${mkdirErr.message}`);
      }
    }
    console.log('');
  }
});

// Check better-sqlite3 module
console.log('\nChecking better-sqlite3 module:');
try {
  const db = new Database(':memory:');
  db.close();
  console.log('  ✅ better-sqlite3 module is working');
} catch (moduleErr) {
  console.log(`  ❌ better-sqlite3 module error: ${moduleErr.message}`);
  console.log(`  💡 Try running: npm rebuild better-sqlite3`);
}

console.log('\n✅ Diagnostic complete');

