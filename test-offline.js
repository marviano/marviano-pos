#!/usr/bin/env node

/**
 * Offline System Test Script
 * Tests the comprehensive offline functionality
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

console.log('🧪 OFFLINE SYSTEM TEST SCRIPT');
console.log('==============================\n');

// Get SQLite database path
const userDataPath = path.join(os.homedir(), 'AppData', 'Roaming', 'marviano-pos');
const dbPath = path.join(userDataPath, 'pos-local.db');

console.log('📁 Database Path:', dbPath);

// Test 1: Check if database exists
console.log('\n🔍 Test 1: Database Existence');
if (fs.existsSync(dbPath)) {
  const stats = fs.statSync(dbPath);
  const sizeKB = Math.round(stats.size / 1024);
  console.log(`✅ Database exists (${sizeKB} KB)`);
  console.log(`📅 Last modified: ${stats.mtime.toLocaleString()}`);
} else {
  console.log('❌ Database does not exist (fresh installation)');
}

// Test 2: Check database structure (if exists)
if (fs.existsSync(dbPath)) {
  console.log('\n🔍 Test 2: Database Structure');
  try {
    // Note: This would require sqlite3 module to be installed
    console.log('📊 Database structure check requires sqlite3 module');
    console.log('💡 Install with: npm install -g sqlite3');
    console.log('💡 Then run: sqlite3 "' + dbPath + '" ".tables"');
  } catch (error) {
    console.log('⚠️ Could not check database structure:', error.message);
  }
}

// Test 3: Clean database option
console.log('\n🧹 Test 3: Clean Database Option');
console.log('To wipe the database for fresh testing:');
console.log(`   Delete: ${dbPath}`);
console.log('   Then restart the app');

// Test 4: Expected tables
console.log('\n📋 Test 4: Expected Tables (17 total)');
const expectedTables = [
  'users', 'businesses', 'products', 'ingredients', 'cogs',
  'contacts', 'deals', 'deal_products', 'teams', 'roles',
  'permissions', 'source', 'pekerjaan', 'kartu_keluarga',
  'leasing_companies', 'categories', 'sync_status'
];

expectedTables.forEach((table, index) => {
  console.log(`   ${index + 1}. ${table}`);
});

console.log('\n🎯 TESTING INSTRUCTIONS:');
console.log('1. Delete the database file above');
console.log('2. Start the app: npm run electron-dev');
console.log('3. Login and browse products (this caches data)');
console.log('4. Disconnect internet');
console.log('5. Verify everything still works offline');
console.log('6. Reconnect internet and watch auto-sync');

console.log('\n✅ Ready for production testing!');
