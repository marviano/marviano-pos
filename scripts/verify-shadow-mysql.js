require('dotenv').config();
const mysql = require('mysql2/promise');
const Database = require('better-sqlite3-multiple-ciphers');
const path = require('path');
const fs = require('fs');

// Mock Browser Window and IPC logic which we don't need for this text
const { PrinterManagementService } = require('../dist/electron/printerManagement');
// NOTE: We are importing from 'dist/electron' because TS needs to be compiled or we use ts-node. 
// However, since we haven't compiled yet, this might fail.
// Alternative: We write a simple script that REPLICATES the logic to test connection ONLY,
// OR we compile first.

// Let's testing the connection and INSERT directly first to verify credentials.
// Then we can try to test the class if we can. 

async function verifyShadowDB() {
    console.log('--- Verifying Shadow DB (MySQL) ---');
    
    const dbHost = process.env.DB_HOST || 'localhost';
    const dbUser = process.env.DB_USER || 'root';
    const dbPassword = process.env.DB_PASSWORD || '';
    const dbName = process.env.DB_NAME || 'system_pos';
    
    console.log(`Credentials: ${dbUser} / [from .env] @ ${dbHost}/${dbName}`);

    if (!dbPassword) {
        console.error('❌ DB_PASSWORD not found in .env file!');
        process.exit(1);
    }

    try {
        const connection = await mysql.createConnection({
            host: dbHost,
            user: dbUser,
            password: dbPassword,
            database: dbName
        });

        console.log('✅ Connected to MySQL!');

        // Check table existence
        const [rows] = await connection.execute("SHOW TABLES LIKE 'printer2_audit_log'");
        if (rows.length === 0) {
            console.log('⚠️ Table printer2_audit_log DOES NOT exist yet (Expected if app hasn\'t run). Creating it...');
            await connection.execute(`
                CREATE TABLE IF NOT EXISTS printer2_audit_log (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    transaction_id VARCHAR(255) NOT NULL,
                    printer2_receipt_number INT NOT NULL,
                    print_mode ENUM('auto', 'manual') NOT NULL,
                    cycle_number INT,
                    global_counter INT,
                    printed_at DATETIME NOT NULL,
                    printed_at_epoch BIGINT NOT NULL,
                    is_reprint TINYINT DEFAULT 0,
                    reprint_count INT DEFAULT 0,
                    completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_transaction (transaction_id),
                    INDEX idx_printed_at (printed_at)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            `);
            console.log('✅ Created table printer2_audit_log');
        } else {
            console.log('✅ Table printer2_audit_log exists.');
        }

        // Test Insert
        const testTxId = 'TEST-' + Date.now();
        console.log(`INSERTing test record: ${testTxId}`);
        await connection.execute(
            `INSERT INTO printer2_audit_log 
             (transaction_id, printer2_receipt_number, print_mode, cycle_number, global_counter, printed_at, printed_at_epoch, is_reprint, reprint_count) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [testTxId, 999, 'manual', null, 100, new Date(), Date.now(), 0, 0]
        );
        console.log('✅ Insert successful!');

        // Verify retrieval
        const [results] = await connection.execute('SELECT * FROM printer2_audit_log WHERE transaction_id = ?', [testTxId]);
        if (results.length > 0) {
            console.log('✅ Verified record existence:', results[0]);
        } else {
            console.error('❌ Could not find inserted record!');
        }

        await connection.end();
        console.log('--- Verification Complete ---');

    } catch (err) {
        console.error('❌ Verification Failed:', err);
        process.exit(1);
    }
}

verifyShadowDB();
