"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrinterManagementService = void 0;
/**
 * Printer Management Service
 * Handles multi-printer system with separate counters and automation
 */
class PrinterManagementService {
    constructor(database) {
        this.db = database;
        this.ensureGlobalCounterColumns();
    }
    ensureGlobalCounterColumns() {
        try {
            const printer1Cols = this.db.prepare(`PRAGMA table_info(printer1_audit_log)`).all();
            const hasPrinter1Global = printer1Cols.some(col => col.name === 'global_counter');
            if (!hasPrinter1Global) {
                this.db.prepare(`ALTER TABLE printer1_audit_log ADD COLUMN global_counter INTEGER`).run();
                console.log('📋 Added printer1_audit_log.global_counter column');
            }
        }
        catch (error) {
            console.error('Error ensuring printer1_audit_log.global_counter column:', error);
        }
        try {
            const printer2Cols = this.db.prepare(`PRAGMA table_info(printer2_audit_log)`).all();
            const hasPrinter2Global = printer2Cols.some(col => col.name === 'global_counter');
            if (!hasPrinter2Global) {
                this.db.prepare(`ALTER TABLE printer2_audit_log ADD COLUMN global_counter INTEGER`).run();
                console.log('📋 Added printer2_audit_log.global_counter column');
            }
        }
        catch (error) {
            console.error('Error ensuring printer2_audit_log.global_counter column:', error);
        }
    }
    /**
     * Generate 19-digit numeric UUID: [Business(3)][YYMMDD(6)][HHMMSS(6)][Seq(4)]
     */
    generateNumericUUID(businessId) {
        const now = new Date();
        const year = now.getFullYear().toString().slice(2);
        const month = (now.getMonth() + 1).toString().padStart(2, '0');
        const day = now.getDate().toString().padStart(2, '0');
        const hours = now.getHours().toString().padStart(2, '0');
        const minutes = now.getMinutes().toString().padStart(2, '0');
        const seconds = now.getSeconds().toString().padStart(2, '0');
        const date = `${year}${month}${day}`;
        const time = `${hours}${minutes}${seconds}`;
        // Get sequence number for this second
        const thisSecond = `${date}${time}`;
        const counterKey = `uuid_seq_${businessId}_${thisSecond}`;
        let sequence = 1;
        try {
            const existing = this.db.prepare('SELECT counter FROM uuid_sequence_tracker WHERE key = ?').get(counterKey);
            if (existing) {
                sequence = existing.counter + 1;
                this.db.prepare('UPDATE uuid_sequence_tracker SET counter = ?, updated_at = ? WHERE key = ?').run(sequence, Date.now(), counterKey);
            }
            else {
                this.db.prepare('INSERT INTO uuid_sequence_tracker (key, counter, created_at, updated_at) VALUES (?, ?, ?, ?)').run(counterKey, sequence, Date.now(), Date.now());
            }
        }
        catch (error) {
            console.error('Error managing sequence:', error);
        }
        const businessStr = businessId.toString().padStart(3, '0');
        const seqStr = sequence.toString().padStart(4, '0');
        const uuid = `${businessStr}${date}${time}${seqStr}`;
        // Clean up old entries (keep only last 24 hours)
        try {
            const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).getTime();
            this.db.prepare('DELETE FROM uuid_sequence_tracker WHERE created_at < ?').run(yesterday);
        }
        catch (error) {
            console.error('Error cleaning up old sequences:', error);
        }
        console.log(`✅ Generated UUID: ${uuid} (Business: ${businessId}, Seq: ${sequence})`);
        return uuid;
    }
    /**
     * Get or increment printer daily counter
     */
    getPrinterCounter(printerType, businessId, increment = false) {
        const today = new Date().toISOString().split('T')[0];
        try {
            const existing = this.db.prepare('SELECT counter FROM printer_daily_counters WHERE printer_type = ? AND business_id = ? AND date = ?')
                .get(printerType, businessId, today);
            if (existing) {
                if (increment) {
                    const newCounter = existing.counter + 1;
                    this.db.prepare('UPDATE printer_daily_counters SET counter = ?, last_reset_at = ? WHERE printer_type = ? AND business_id = ? AND date = ?')
                        .run(newCounter, Date.now(), printerType, businessId, today);
                    console.log(`✅ Incremented ${printerType} counter to ${newCounter}`);
                    return newCounter;
                }
                return existing.counter;
            }
            else {
                // First transaction today - start at 1
                const counter = increment ? 1 : 0;
                this.db.prepare('INSERT INTO printer_daily_counters (printer_type, business_id, date, counter, last_reset_at) VALUES (?, ?, ?, ?, ?)')
                    .run(printerType, businessId, today, counter, Date.now());
                console.log(`✅ Created new ${printerType} counter starting at ${counter}`);
                return increment ? 1 : 0;
            }
        }
        catch (error) {
            console.error('Error managing printer counter:', error);
            return 0;
        }
    }
    /**
     * Get Printer 2 mode setting
     */
    getPrinter2Mode() {
        try {
            const result = this.db.prepare('SELECT mode FROM printer_mode_settings WHERE printer_type = ?')
                .get('receiptizePrinter');
            return result?.mode || 'auto';
        }
        catch (error) {
            console.error('Error getting printer mode:', error);
            return 'auto';
        }
    }
    /**
     * Set Printer 2 mode
     */
    setPrinter2Mode(mode) {
        try {
            const now = Date.now();
            this.db.prepare('INSERT INTO printer_mode_settings (printer_type, mode, created_at, updated_at) VALUES (?, ?, ?, ?) ' +
                'ON CONFLICT(printer_type) DO UPDATE SET mode = excluded.mode, updated_at = excluded.updated_at')
                .run('receiptizePrinter', mode, now, now);
            console.log(`✅ Set Printer 2 mode to ${mode}`);
            return true;
        }
        catch (error) {
            console.error('Error setting printer mode:', error);
            return false;
        }
    }
    /**
     * Get Printer 2 automation selections for current cycle
     */
    getPrinter2AutomationSelections(businessId) {
        try {
            const result = this.db.prepare('SELECT cycle_number, selected_transactions FROM printer2_automation WHERE business_id = ? ORDER BY created_at DESC LIMIT 1')
                .get(businessId);
            if (result) {
                const selections = JSON.parse(result.selected_transactions);
                return { cycleNumber: result.cycle_number, selections };
            }
            return { cycleNumber: 0, selections: [] };
        }
        catch (error) {
            console.error('Error getting automation selections:', error);
            return { cycleNumber: 0, selections: [] };
        }
    }
    /**
     * Save Printer 2 automation selections
     */
    savePrinter2AutomationSelections(businessId, cycleNumber, selections) {
        try {
            this.db.prepare('INSERT INTO printer2_automation (business_id, cycle_number, selected_transactions, created_at) ' +
                'VALUES (?, ?, ?, ?) ON CONFLICT(business_id, cycle_number) DO UPDATE SET selected_transactions = excluded.selected_transactions')
                .run(businessId, cycleNumber, JSON.stringify(selections), Date.now());
            console.log(`✅ Saved Printer 2 automation: Cycle ${cycleNumber}, Selections: ${selections.join(',')}`);
            return true;
        }
        catch (error) {
            console.error('Error saving automation selections:', error);
            return false;
        }
    }
    /**
     * Generate random selections for Printer 2 automation (3 out of 10)
     */
    generateRandomSelections(cycleNumber) {
        const startNum = ((cycleNumber - 1) * 10) + 1;
        const candidates = Array.from({ length: 10 }, (_, i) => startNum + i);
        // Randomly select 3
        const selected = [];
        const candidatesCopy = [...candidates];
        for (let i = 0; i < 3; i++) {
            const randomIndex = Math.floor(Math.random() * candidatesCopy.length);
            selected.push(candidatesCopy.splice(randomIndex, 1)[0]);
        }
        return selected.sort((a, b) => a - b);
    }
    /**
     * Log Printer 2 print to audit
     */
    logPrinter2Print(transactionId, printer2ReceiptNumber, mode, cycleNumber, globalCounter) {
        try {
            const now = new Date().toISOString();
            this.db.prepare('INSERT INTO printer2_audit_log (transaction_id, printer2_receipt_number, print_mode, cycle_number, global_counter, printed_at, printed_at_epoch) ' +
                'VALUES (?, ?, ?, ?, ?, ?, ?)')
                .run(transactionId, printer2ReceiptNumber, mode, cycleNumber || null, typeof globalCounter === 'number' ? globalCounter : null, now, Date.now());
            console.log(`✅ Logged Printer 2 print: Transaction ${transactionId}, Receipt #${printer2ReceiptNumber}, Mode: ${mode}`);
            return true;
        }
        catch (error) {
            console.error('Error logging printer2 print:', error);
            return false;
        }
    }
    /**
     * Log Printer 1 print to audit
     */
    logPrinter1Print(transactionId, printer1ReceiptNumber, globalCounter) {
        try {
            const now = new Date().toISOString();
            this.db.prepare('INSERT INTO printer1_audit_log (transaction_id, printer1_receipt_number, global_counter, printed_at, printed_at_epoch) ' +
                'VALUES (?, ?, ?, ?, ?)')
                .run(transactionId, printer1ReceiptNumber, typeof globalCounter === 'number' ? globalCounter : null, now, Date.now());
            console.log(`✅ Logged Printer 1 print: Transaction ${transactionId}, Receipt #${printer1ReceiptNumber}`);
            return true;
        }
        catch (error) {
            console.error('Error logging printer1 print:', error);
            return false;
        }
    }
    /**
     * Get Printer 1 audit log entries
     */
    getPrinter1AuditLog(fromDate, toDate, limit = 100) {
        try {
            let query = 'SELECT * FROM printer1_audit_log';
            const params = [];
            if (fromDate || toDate) {
                const conditions = [];
                if (fromDate) {
                    const fromEpoch = new Date(fromDate).getTime();
                    conditions.push('printed_at_epoch >= ?');
                    params.push(fromEpoch);
                }
                if (toDate) {
                    const toEpoch = new Date(toDate + 'T23:59:59').getTime();
                    conditions.push('printed_at_epoch <= ?');
                    params.push(toEpoch);
                }
                if (conditions.length > 0) {
                    query += ' WHERE ' + conditions.join(' AND ');
                }
            }
            query += ' ORDER BY printed_at_epoch DESC LIMIT ?';
            params.push(limit);
            const results = this.db.prepare(query).all(...params);
            console.log(`✅ Retrieved ${results.length} printer1 audit log entries`);
            return results;
        }
        catch (error) {
            console.error('Error getting printer1 audit log:', error);
            return [];
        }
    }
    /**
     * Get Printer 2 audit log entries
     */
    getPrinter2AuditLog(fromDate, toDate, limit = 100) {
        try {
            let query = 'SELECT * FROM printer2_audit_log';
            const params = [];
            if (fromDate || toDate) {
                const conditions = [];
                if (fromDate) {
                    const fromEpoch = new Date(fromDate).getTime();
                    conditions.push('printed_at_epoch >= ?');
                    params.push(fromEpoch);
                }
                if (toDate) {
                    const toEpoch = new Date(toDate + 'T23:59:59').getTime();
                    conditions.push('printed_at_epoch <= ?');
                    params.push(toEpoch);
                }
                if (conditions.length > 0) {
                    query += ' WHERE ' + conditions.join(' AND ');
                }
            }
            query += ' ORDER BY printed_at_epoch DESC LIMIT ?';
            params.push(limit);
            const results = this.db.prepare(query).all(...params);
            console.log(`✅ Retrieved ${results.length} audit log entries`);
            return results;
        }
        catch (error) {
            console.error('Error getting audit log:', error);
            return [];
        }
    }
}
exports.PrinterManagementService = PrinterManagementService;
