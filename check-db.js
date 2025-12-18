// Run with: npx electron check-db.js
const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'marviano-pos', 'pos-offline.db');
console.log('Database path:', dbPath);

try {
  const db = new Database(dbPath);
  
  // Check tables
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%audit%'").all();
  console.log('\nAudit tables:', tables);
  
  // Check printer1_audit_log
  try {
    const p1Count = db.prepare('SELECT COUNT(*) as count FROM printer1_audit_log').get();
    console.log('\nprinter1_audit_log count:', p1Count.count);
    
    if (p1Count.count > 0) {
      const p1Sample = db.prepare('SELECT * FROM printer1_audit_log ORDER BY id DESC LIMIT 3').all();
      console.log('printer1_audit_log samples:', p1Sample);
    }
  } catch (e) {
    console.log('printer1_audit_log error:', e.message);
  }
  
  // Check printer2_audit_log
  try {
    const p2Count = db.prepare('SELECT COUNT(*) as count FROM printer2_audit_log').get();
    console.log('\nprinter2_audit_log count:', p2Count.count);
    
    if (p2Count.count > 0) {
      const p2Sample = db.prepare('SELECT * FROM printer2_audit_log ORDER BY id DESC LIMIT 3').all();
      console.log('printer2_audit_log samples:', p2Sample);
    }
  } catch (e) {
    console.log('printer2_audit_log error:', e.message);
  }
  
  // Check transactions count
  try {
    const txCount = db.prepare('SELECT COUNT(*) as count FROM transactions').get();
    console.log('\ntransactions count:', txCount.count);
  } catch (e) {
    console.log('transactions error:', e.message);
  }
  
  db.close();
} catch (e) {
  console.error('Database error:', e.message);
}

process.exit(0);
