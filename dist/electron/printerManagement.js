"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrinterManagementService = void 0;
const mysqlDb_1 = require("./mysqlDb");
/**
 * Printer Management Service
 * Handles multi-printer system with separate counters and automation
 */
class PrinterManagementService {
    constructor(mysqlPool) {
        this.mysqlPool = mysqlPool;
        // MySQL schema is initialized separately, no need for column checks
    }
    /**
     * Generate 19-digit numeric UUID: [Business(3)][YYMMDD(6)][HHMMSS(6)][Seq(4)]
     */
    async generateNumericUUID(businessId) {
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
            const existing = await (0, mysqlDb_1.executeQueryOne)('SELECT counter FROM uuid_sequence_tracker WHERE `key` = ?', [counterKey]);
            if (existing && typeof existing.counter === 'number') {
                sequence = existing.counter + 1;
                await (0, mysqlDb_1.executeUpdate)('UPDATE uuid_sequence_tracker SET counter = ?, updated_at = ? WHERE `key` = ?', [sequence, Date.now(), counterKey]);
            }
            else {
                await (0, mysqlDb_1.executeUpdate)('INSERT INTO uuid_sequence_tracker (`key`, counter, created_at, updated_at) VALUES (?, ?, ?, ?)', [counterKey, sequence, Date.now(), Date.now()]);
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
            await (0, mysqlDb_1.executeUpdate)('DELETE FROM uuid_sequence_tracker WHERE created_at < ?', [yesterday]);
        }
        catch (error) {
            console.error('Error cleaning up old sequences:', error);
        }
        console.log(`✅ Generated UUID: ${uuid} (Business: ${businessId}, Seq: ${sequence})`);
        return uuid;
    }
    /**
     * Get or increment printer daily counter
     * Uses GMT+7 timezone to match local business day
     */
    async getPrinterCounter(printerType, businessId, increment = false) {
        // Get today's date in GMT+7 (Indonesia timezone)
        const now = new Date();
        const utc7Time = new Date(now.getTime() + (7 * 60 * 60 * 1000));
        const today = utc7Time.toISOString().split('T')[0];
        try {
            const existing = await (0, mysqlDb_1.executeQueryOne)('SELECT counter FROM printer_daily_counters WHERE printer_type = ? AND business_id = ? AND date = ?', [printerType, businessId, today]);
            if (existing && typeof existing.counter === 'number') {
                if (increment) {
                    const newCounter = existing.counter + 1;
                    const rowsUpdated = await (0, mysqlDb_1.executeUpdate)('UPDATE printer_daily_counters SET counter = ?, updated_at = NOW() WHERE printer_type = ? AND business_id = ? AND date = ?', [newCounter, printerType, businessId, today]);
                    console.log(`✅ Incremented ${printerType} counter from ${existing.counter} to ${newCounter} (date: ${today}, businessId: ${businessId}, rows updated: ${rowsUpdated})`);
                    // Verify the update actually happened
                    const verify = await (0, mysqlDb_1.executeQueryOne)('SELECT counter FROM printer_daily_counters WHERE printer_type = ? AND business_id = ? AND date = ?', [printerType, businessId, today]);
                    if (verify && verify.counter !== newCounter) {
                        console.error(`❌ Counter update verification failed! Expected ${newCounter}, got ${verify.counter}`);
                    }
                    return newCounter;
                }
                console.log(`📊 Retrieved ${printerType} counter: ${existing.counter} (date: ${today}, businessId: ${businessId}, increment: ${increment})`);
                return existing.counter;
            }
            else {
                // First transaction today - start at 1
                const counter = increment ? 1 : 0;
                await (0, mysqlDb_1.executeUpdate)('INSERT INTO printer_daily_counters (printer_type, business_id, date, counter, updated_at) VALUES (?, ?, ?, ?, NOW())', [printerType, businessId, today, counter]);
                console.log(`✅ Created new ${printerType} counter starting at ${counter} (date: ${today}, businessId: ${businessId}, increment: ${increment})`);
                return increment ? 1 : 0;
            }
        }
        catch (error) {
            console.error(`❌ Error managing printer counter (${printerType}, businessId: ${businessId}, date: ${today}, increment: ${increment}):`, error);
            return 0;
        }
    }
    /**
     * Get Printer 2 mode setting
     */
    async getPrinter2Mode() {
        try {
            const result = await (0, mysqlDb_1.executeQueryOne)('SELECT mode FROM printer_mode_settings WHERE printer_type = ?', ['receiptizePrinter']);
            if (result?.mode === 'auto' || result?.mode === 'manual') {
                return result.mode;
            }
            return 'manual';
        }
        catch (error) {
            console.error('Error getting printer mode:', error);
            return 'manual';
        }
    }
    /**
     * Set Printer 2 mode
     */
    async setPrinter2Mode(mode) {
        try {
            await (0, mysqlDb_1.executeUpsert)(`INSERT INTO printer_mode_settings (printer_type, mode, updated_at) VALUES (?, ?, NOW())
         ON DUPLICATE KEY UPDATE mode = VALUES(mode), updated_at = NOW()`, ['receiptizePrinter', mode]);
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
    async getPrinter2AutomationSelections(businessId) {
        try {
            const result = await (0, mysqlDb_1.executeQueryOne)('SELECT cycle_number, selected_transactions FROM printer2_automation WHERE business_id = ? ORDER BY created_at DESC LIMIT 1', [businessId]);
            if (result) {
                const parsed = JSON.parse(result.selected_transactions);
                const selections = Array.isArray(parsed) ? parsed.filter((value) => Number.isFinite(value)) : [];
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
    async savePrinter2AutomationSelections(businessId, cycleNumber, selections) {
        try {
            await (0, mysqlDb_1.executeUpsert)(`INSERT INTO printer2_automation (business_id, cycle_number, selected_transactions, created_at)
         VALUES (?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE selected_transactions = VALUES(selected_transactions)`, [businessId, cycleNumber, JSON.stringify(selections)]);
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
    async logPrinter2Print(transactionId, printer2ReceiptNumber, mode, cycleNumber, globalCounter, isReprint = false, reprintCount = 0) {
        try {
            // Convert to UTC+7 and format as MySQL datetime (using centralized function)
            const now = (0, mysqlDb_1.toMySQLDateTime)(new Date());
            const printedAtEpoch = Date.now();
            await (0, mysqlDb_1.executeUpdate)(`INSERT INTO printer2_audit_log 
         (transaction_id, printer2_receipt_number, print_mode, cycle_number, global_counter, printed_at, printed_at_epoch, is_reprint, reprint_count) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
                transactionId,
                printer2ReceiptNumber,
                mode,
                cycleNumber || null,
                typeof globalCounter === 'number' ? globalCounter : null,
                now,
                printedAtEpoch,
                isReprint ? 1 : 0,
                reprintCount
            ]);
            console.log(`✅ Logged Printer 2 print: Transaction ${transactionId}, Receipt #${printer2ReceiptNumber}, Mode: ${mode}${isReprint ? ` (REPRINT ke-${reprintCount})` : ''}`);
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
    async logPrinter1Print(transactionId, printer1ReceiptNumber, globalCounter, isReprint = false, reprintCount = 0) {
        try {
            // Convert to UTC+7 and format as MySQL datetime (using centralized function)
            const now = (0, mysqlDb_1.toMySQLDateTime)(new Date());
            await (0, mysqlDb_1.executeUpdate)('INSERT INTO printer1_audit_log (transaction_id, printer1_receipt_number, global_counter, printed_at, printed_at_epoch, is_reprint, reprint_count) VALUES (?, ?, ?, ?, ?, ?, ?)', [
                transactionId,
                printer1ReceiptNumber,
                typeof globalCounter === 'number' ? globalCounter : null,
                now,
                Date.now(),
                isReprint ? 1 : 0,
                reprintCount
            ]);
            console.log(`✅ Logged Printer 1 print: Transaction ${transactionId}, Receipt #${printer1ReceiptNumber}${isReprint ? ` (REPRINT ke-${reprintCount})` : ''}`);
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
    async getPrinter1AuditLog(fromDate, toDate, limit = 100) {
        try {
            let query = 'SELECT * FROM printer1_audit_log';
            const params = [];
            let fromEpoch;
            let toEpoch;
            if (fromDate || toDate) {
                const conditions = [];
                if (fromDate) {
                    // Parse date as local time (start of day in local timezone)
                    const [year, month, day] = fromDate.split('-').map(Number);
                    fromEpoch = new Date(year, month - 1, day, 0, 0, 0, 0).getTime();
                    conditions.push('printed_at_epoch >= ?');
                    params.push(fromEpoch);
                }
                if (toDate) {
                    // Parse date as local time (end of day in local timezone)
                    const [year, month, day] = toDate.split('-').map(Number);
                    toEpoch = new Date(year, month - 1, day, 23, 59, 59, 999).getTime();
                    conditions.push('printed_at_epoch <= ?');
                    params.push(toEpoch);
                }
                if (conditions.length > 0) {
                    query += ' WHERE ' + conditions.join(' AND ');
                }
            }
            // LIMIT cannot be parameterized in prepared statements reliably
            // Use string interpolation (safe since we validate it's a number)
            const safeLimit = typeof limit === 'number' && limit > 0 ? Math.min(Math.max(limit, 1), 10000) : 100;
            query += ` ORDER BY printed_at_epoch DESC LIMIT ${safeLimit}`;
            console.log(`🔍 [Printer1AuditLog] Query params: fromDate=${fromDate}, toDate=${toDate}, fromEpoch=${fromEpoch}, toEpoch=${toEpoch}, limit=${safeLimit}`);
            const results = await (0, mysqlDb_1.executeQuery)(query, params);
            console.log(`✅ Retrieved ${results.length} printer1 audit log entries`);
            // Debug: show sample entries if any
            if (results.length > 0) {
                console.log(`🔍 [Printer1AuditLog] Sample entry: printed_at_epoch=${results[0].printed_at_epoch}, transaction_id=${results[0].transaction_id}`);
            }
            else {
                // Check total count without filters
                const totalCount = await (0, mysqlDb_1.executeQueryOne)('SELECT COUNT(*) as count FROM printer1_audit_log');
                console.log(`⚠️ [Printer1AuditLog] No results. Total entries in table: ${totalCount?.count || 0}`);
                if (totalCount && totalCount.count > 0) {
                    const sampleRow = await (0, mysqlDb_1.executeQueryOne)('SELECT printed_at_epoch FROM printer1_audit_log ORDER BY printed_at_epoch DESC LIMIT 1');
                    if (sampleRow) {
                        console.log(`⚠️ [Printer1AuditLog] Latest entry epoch: ${sampleRow.printed_at_epoch} (${new Date(sampleRow.printed_at_epoch).toISOString()})`);
                    }
                }
            }
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
    async getPrinter2AuditLog(fromDate, toDate, limit = 100) {
        try {
            let query = 'SELECT * FROM printer2_audit_log';
            const params = [];
            let fromEpoch;
            let toEpoch;
            if (fromDate || toDate) {
                const conditions = [];
                if (fromDate) {
                    // Parse date as local time (start of day in local timezone)
                    const [year, month, day] = fromDate.split('-').map(Number);
                    fromEpoch = new Date(year, month - 1, day, 0, 0, 0, 0).getTime();
                    conditions.push('printed_at_epoch >= ?');
                    params.push(fromEpoch);
                }
                if (toDate) {
                    // Parse date as local time (end of day in local timezone)
                    const [year, month, day] = toDate.split('-').map(Number);
                    toEpoch = new Date(year, month - 1, day, 23, 59, 59, 999).getTime();
                    conditions.push('printed_at_epoch <= ?');
                    params.push(toEpoch);
                }
                if (conditions.length > 0) {
                    query += ' WHERE ' + conditions.join(' AND ');
                }
            }
            // LIMIT cannot be parameterized in prepared statements reliably
            // Use string interpolation (safe since we validate it's a number)
            const safeLimit = typeof limit === 'number' && limit > 0 ? Math.min(Math.max(limit, 1), 10000) : 100;
            query += ` ORDER BY printed_at_epoch DESC LIMIT ${safeLimit}`;
            console.log(`🔍 [Printer2AuditLog] Query params: fromDate=${fromDate}, toDate=${toDate}, fromEpoch=${fromEpoch}, toEpoch=${toEpoch}, limit=${safeLimit}`);
            const results = await (0, mysqlDb_1.executeQuery)(query, params);
            console.log(`✅ Retrieved ${results.length} printer2 audit log entries`);
            // Debug: show sample entries if any
            if (results.length > 0) {
                console.log(`🔍 [Printer2AuditLog] Sample entry: printed_at_epoch=${results[0].printed_at_epoch}, transaction_id=${results[0].transaction_id}`);
            }
            else {
                // Check total count without filters
                const totalCount = await (0, mysqlDb_1.executeQueryOne)('SELECT COUNT(*) as count FROM printer2_audit_log');
                console.log(`⚠️ [Printer2AuditLog] No results. Total entries in table: ${totalCount?.count || 0}`);
                if (totalCount && totalCount.count > 0) {
                    const sampleRow = await (0, mysqlDb_1.executeQueryOne)('SELECT printed_at_epoch FROM printer2_audit_log ORDER BY printed_at_epoch DESC LIMIT 1');
                    if (sampleRow) {
                        console.log(`⚠️ [Printer2AuditLog] Latest entry epoch: ${sampleRow.printed_at_epoch} (${new Date(sampleRow.printed_at_epoch).toISOString()})`);
                    }
                }
            }
            return results;
        }
        catch (error) {
            console.error('Error getting audit log:', error);
            return [];
        }
    }
}
exports.PrinterManagementService = PrinterManagementService;
