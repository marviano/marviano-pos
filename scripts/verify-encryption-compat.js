const Database = require('better-sqlite3-multiple-ciphers');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// Mock app.getPath for the script since we aren't in Electron environment
const userDataPath = path.join(process.cwd(), 'temp-test-data');
if (!fs.existsSync(userDataPath)) {
    fs.mkdirSync(userDataPath, { recursive: true });
}

const originalDbPath = path.join(process.env.APPDATA, 'marviano-pos', 'pos-offline.db');
const testDbPath = path.join(userDataPath, 'pos-offline-test.db');
const PASSWORD = 'test-password-123';

console.log('Original DB Path:', originalDbPath);
console.log('Test DB Path:', testDbPath);

// 1. Copy original DB to test location
try {
    if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
    }
    // If original DB exists, use it. Otherwise create new one.
    if (fs.existsSync(originalDbPath)) {
        console.log('Copying existing pos-offline.db...');
        fs.copyFileSync(originalDbPath, testDbPath);
    } else {
        console.log('Original DB not found, creating fresh test DB...');
    }
} catch (err) {
    console.error('Failed to prepare test database:', err);
    process.exit(1);
}

// 2. Open with new library (Plaintext first)
console.log('\n--- Step 2: Open Plaintext ---');
let db;
try {
    db = new Database(testDbPath);
    console.log('Successfully opened DB with better-sqlite3-multiple-ciphers');

    // Run a query to verify it works
    const tableCount = db.prepare("SELECT count(*) as count FROM sqlite_master WHERE type='table'").get();
    console.log('Table count:', tableCount.count);

    if (tableCount.count > 0) {
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' LIMIT 5").all();
        console.log('Sample tables:', tables.map(t => t.name));
    }
} catch (err) {
    console.error('Failed to open plaintext DB:', err);
    process.exit(1);
}

// 3. Encrypt the database (Rekey)
console.log('\n--- Step 3: Encrypting (Rekey) ---');
try {
    // Rekeying requires switching out of WAL mode temporarily
    console.log('Switching to journal_mode = DELETE for rekeying...');
    db.pragma('journal_mode = DELETE');

    db.pragma(`rekey = '${PASSWORD}'`);
    console.log('Rekey command executed successfully.');

    // Switch back to WAL Mode
    db.pragma('journal_mode = WAL');
    console.log('Switched back to WAL mode.');
} catch (err) {
    console.error('Failed to rekey DB:', err);
    process.exit(1);
}

// 4. Verify Encryption
console.log('\n--- Step 4: Verify Encryption ---');
db.close();
console.log('Database closed.');

// Attempt to open without password (should fail or return garbage/error on query)
try {
    console.log('Attempting to open WITHOUT password...');
    const protectedDb = new Database(testDbPath);
    try {
        const result = protectedDb.prepare("SELECT count(*) FROM sqlite_master").get();
        console.error('CRITICAL FAIL: Accessed encrypted DB without password!');
        console.log('Result:', result);
        process.exit(1);
    } catch (err) {
        console.log('SUCCESS: Query failed as expected without password.');
        console.log('Error message:', err.message);
    }
    protectedDb.close();
} catch (err) {
    console.log('Database open failed (this is also acceptable behavior).', err.message);
}

// 5. Open WITH password
console.log('\n--- Step 5: Open WITH Password ---');
try {
    const authorizedDb = new Database(testDbPath);
    authorizedDb.pragma(`key = '${PASSWORD}'`);

    const tableCount = authorizedDb.prepare("SELECT count(*) as count FROM sqlite_master WHERE type='table'").get();
    console.log('Successfully accessed encrypted DB with password.');
    console.log('Table count:', tableCount.count);

    authorizedDb.close();
} catch (err) {
    console.error('Failed to open with password:', err);
    process.exit(1);
}

console.log('\n---------------------------------------------------');
console.log('VERIFICATION SUCCESSFUL: Library is compatible and encryption works.');
console.log('---------------------------------------------------');
