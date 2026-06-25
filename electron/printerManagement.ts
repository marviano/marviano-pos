import { Pool } from 'mysql2/promise';
import { executeQuery, executeQueryOne, executeUpdate, executeUpsert, toMySQLDateTime } from './mysqlDb';
import { wibDateRangeEpochBounds, formatDateTimeForWib, getCalendarDateYMDInWib } from './wibDateTime';

type TableColumnInfo = {
  name: string;
};

type CounterRow = {
  counter: number;
};

type ModeRow = {
  mode?: 'auto' | 'manual';
};

type AutomationRow = {
  cycle_number: number;
  selected_transactions: string;
};

type Printer1AuditRow = {
  transaction_id: string;
  printer1_receipt_number: number;
  global_counter: number | null;
  printed_at: string;
  printed_at_epoch: number;
  is_reprint?: number;
  reprint_count?: number;
};

type Printer2AuditRow = {
  transaction_id: string;
  printer2_receipt_number: number;
  print_mode: 'auto' | 'manual';
  cycle_number: number | null;
  global_counter: number | null;
  printed_at: string;
  printed_at_epoch: number;
  is_reprint?: number;
  reprint_count?: number;
};

type PrinterMoveLogRow = {
  id: number;
  transaction_id: string;
  from_printer: 'printer1' | 'printer2';
  to_printer: 'printer1' | 'printer2';
  business_id: number | null;
  moved_by_user_id: number | null;
  moved_at: string;
  moved_at_epoch: number;
};

type QueryParam = string | number | null;

/**
 * Printer Management Service
 * Handles multi-printer system with separate counters and automation
 */

export class PrinterManagementService {
  private mysqlPool: Pool;

  constructor(mysqlPool: Pool) {
    this.mysqlPool = mysqlPool;
    // MySQL schema is initialized separately, no need for column checks
  }

  /**
   * Generate 19-digit numeric UUID: [Business(3)][Seq(4)][YYMMDD(6)][HH(2)][MMSS(4)]
   */
  async generateNumericUUID(businessId: number): Promise<string> {
    const now = new Date();
    const year = now.getFullYear().toString().slice(2);
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    const seconds = now.getSeconds().toString().padStart(2, '0');

    const date = `${year}${month}${day}`;
    const hour = hours;
    const minutesSeconds = `${minutes}${seconds}`;
    const fullTime = `${hours}${minutes}${seconds}`;

    // Get sequence number for this second
    const thisSecond = `${date}${fullTime}`;
    const counterKey = `uuid_seq_${businessId}_${thisSecond}`;

    let sequence = 1;
    try {
      const existing = await executeQueryOne<CounterRow>(
        'SELECT counter FROM uuid_sequence_tracker WHERE `key` = ?',
        [counterKey]
      );
      if (existing && typeof existing.counter === 'number') {
        sequence = existing.counter + 1;
        await executeUpdate(
          'UPDATE uuid_sequence_tracker SET counter = ?, updated_at = ? WHERE `key` = ?',
          [sequence, Date.now(), counterKey]
        );
      } else {
        await executeUpdate(
          'INSERT INTO uuid_sequence_tracker (`key`, counter, created_at, updated_at) VALUES (?, ?, ?, ?)',
          [counterKey, sequence, Date.now(), Date.now()]
        );
      }
    } catch (error) {
      console.error('Error managing sequence:', error);
    }

    const businessStr = businessId.toString().padStart(3, '0');
    const seqStr = sequence.toString().padStart(4, '0');

    // Format: [Business(3)][Seq(4)][YYMMDD(6)][HH(2)][MMSS(4)]
    const uuid = `${businessStr}${seqStr}${date}${hour}${minutesSeconds}`;

    // Clean up old entries (keep only last 24 hours)
    try {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).getTime();
      await executeUpdate('DELETE FROM uuid_sequence_tracker WHERE created_at < ?', [yesterday]);
    } catch (error) {
      console.error('Error cleaning up old sequences:', error);
    }

    console.log(`✅ Generated UUID: ${uuid} (Business: ${businessId}, Seq: ${sequence})`);
    return uuid;
  }

  /**
   * Get or increment printer daily counter
   * Uses GMT+7 timezone to match local business day
   */
  async getPrinterCounter(printerType: string, businessId: number, increment: boolean = false): Promise<number> {
    // Get today's date in GMT+7 (Indonesia timezone)
    const today = getCalendarDateYMDInWib(new Date());

    try {
      const existing = await executeQueryOne<CounterRow>(
        'SELECT counter FROM printer_daily_counters WHERE printer_type = ? AND business_id = ? AND date = ?',
        [printerType, businessId, today]
      );

        if (existing && typeof existing.counter === 'number') {
        if (increment) {
          const newCounter = existing.counter + 1;
          const rowsUpdated = await executeUpdate(
            'UPDATE printer_daily_counters SET counter = ?, updated_at = NOW() WHERE printer_type = ? AND business_id = ? AND date = ?',
            [newCounter, printerType, businessId, today]
          );
          console.log(`✅ Incremented ${printerType} counter from ${existing.counter} to ${newCounter} (date: ${today}, businessId: ${businessId}, rows updated: ${rowsUpdated})`);
          
          // Verify the update actually happened
          const verify = await executeQueryOne<CounterRow>(
            'SELECT counter FROM printer_daily_counters WHERE printer_type = ? AND business_id = ? AND date = ?',
            [printerType, businessId, today]
          );
          if (verify && verify.counter !== newCounter) {
            console.error(`❌ Counter update verification failed! Expected ${newCounter}, got ${verify.counter}`);
          }
          
          return newCounter;
        }
        console.log(`📊 Retrieved ${printerType} counter: ${existing.counter} (date: ${today}, businessId: ${businessId}, increment: ${increment})`);
        return existing.counter;
      } else {
        // First transaction today - start at 1
        const counter = increment ? 1 : 0;
        await executeUpdate(
          'INSERT INTO printer_daily_counters (printer_type, business_id, date, counter, updated_at) VALUES (?, ?, ?, ?, NOW())',
          [printerType, businessId, today, counter]
        );
        console.log(`✅ Created new ${printerType} counter starting at ${counter} (date: ${today}, businessId: ${businessId}, increment: ${increment})`);
        return increment ? 1 : 0;
      }
    } catch (error) {
      console.error(`❌ Error managing printer counter (${printerType}, businessId: ${businessId}, date: ${today}, increment: ${increment}):`, error);
      return 0;
    }
  }

  /**
   * Get Printer 2 mode setting
   */
  async getPrinter2Mode(): Promise<'auto' | 'manual'> {
    try {
      const result = await executeQueryOne<ModeRow>(
        'SELECT mode FROM printer_mode_settings WHERE printer_type = ?',
        ['receiptizePrinter']
      );
      if (result?.mode === 'auto' || result?.mode === 'manual') {
        return result.mode;
      }
      return 'manual';
    } catch (error) {
      console.error('Error getting printer mode:', error);
      return 'manual';
    }
  }

  /**
   * Set Printer 2 mode
   */
  async setPrinter2Mode(mode: 'auto' | 'manual'): Promise<boolean> {
    try {
      await executeUpsert(
        `INSERT INTO printer_mode_settings (printer_type, mode, updated_at) VALUES (?, ?, NOW())
         ON DUPLICATE KEY UPDATE mode = VALUES(mode), updated_at = NOW()`,
        ['receiptizePrinter', mode]
      );

      console.log(`✅ Set Printer 2 mode to ${mode}`);
      return true;
    } catch (error) {
      console.error('Error setting printer mode:', error);
      return false;
    }
  }

  /**
   * Get Printer 2 automation selections for current cycle
   */
  async getPrinter2AutomationSelections(businessId: number): Promise<{ cycleNumber: number; selections: number[] }> {
    try {
      const result = await executeQueryOne<AutomationRow>(
        'SELECT cycle_number, selected_transactions FROM printer2_automation WHERE business_id = ? ORDER BY created_at DESC LIMIT 1',
        [businessId]
      );

      if (result) {
        const parsed = JSON.parse(result.selected_transactions);
        const selections = Array.isArray(parsed) ? parsed.filter((value): value is number => Number.isFinite(value)) : [];
        return { cycleNumber: result.cycle_number, selections };
      }
      return { cycleNumber: 0, selections: [] };
    } catch (error) {
      console.error('Error getting automation selections:', error);
      return { cycleNumber: 0, selections: [] };
    }
  }

  /**
   * Save Printer 2 automation selections
   */
  async savePrinter2AutomationSelections(businessId: number, cycleNumber: number, selections: number[]): Promise<boolean> {
    try {
      await executeUpsert(
        `INSERT INTO printer2_automation (business_id, cycle_number, selected_transactions, created_at)
         VALUES (?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE selected_transactions = VALUES(selected_transactions)`,
        [businessId, cycleNumber, JSON.stringify(selections)]
      );

      console.log(`✅ Saved Printer 2 automation: Cycle ${cycleNumber}, Selections: ${selections.join(',')}`);
      return true;
    } catch (error) {
      console.error('Error saving automation selections:', error);
      return false;
    }
  }

  /**
   * Generate random selections for Printer 2 automation (3 out of 10)
   */
  generateRandomSelections(cycleNumber: number): number[] {
    const startNum = ((cycleNumber - 1) * 10) + 1;
    const candidates = Array.from({ length: 10 }, (_, i) => startNum + i);

    // Randomly select 3
    const selected: number[] = [];
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
  async logPrinter2Print(transactionId: string, printer2ReceiptNumber: number, mode: 'auto' | 'manual', cycleNumber?: number, globalCounter?: number, isReprint: boolean = false, reprintCount: number = 0): Promise<boolean> {
    try {
      // Convert to UTC+7 and format as MySQL datetime (using centralized function)
      const now = toMySQLDateTime(new Date());
      const printedAtEpoch = Date.now();
      
      await executeUpdate(
        `INSERT INTO printer2_audit_log 
         (transaction_id, printer2_receipt_number, print_mode, cycle_number, global_counter, printed_at, printed_at_epoch, is_reprint, reprint_count) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          transactionId,
          printer2ReceiptNumber,
          mode,
          cycleNumber || null,
          typeof globalCounter === 'number' ? globalCounter : null,
          now,
          printedAtEpoch,
          isReprint ? 1 : 0,
          reprintCount
        ]
      );

      console.log(`✅ Logged Printer 2 print: Transaction ${transactionId}, Receipt #${printer2ReceiptNumber}, Mode: ${mode}${isReprint ? ` (REPRINT ke-${reprintCount})` : ''}`);
      return true;
    } catch (error) {
      console.error('Error logging printer2 print:', error);
      return false;
    }
  }

  /**
   * Log Printer 1 print to audit
   */
  async logPrinter1Print(transactionId: string, printer1ReceiptNumber: number, globalCounter?: number, isReprint: boolean = false, reprintCount: number = 0): Promise<boolean> {
    try {
      // Convert to UTC+7 and format as MySQL datetime (using centralized function)
      const now = toMySQLDateTime(new Date());
      await executeUpdate(
        'INSERT INTO printer1_audit_log (transaction_id, printer1_receipt_number, global_counter, printed_at, printed_at_epoch, is_reprint, reprint_count) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
          transactionId,
          printer1ReceiptNumber,
          typeof globalCounter === 'number' ? globalCounter : null,
          now,
          Date.now(),
          isReprint ? 1 : 0,
          reprintCount
        ]
        );
      console.log(`✅ Logged Printer 1 print: Transaction ${transactionId}, Receipt #${printer1ReceiptNumber}${isReprint ? ` (REPRINT ke-${reprintCount})` : ''}`);
      return true;
    } catch (error) {
      console.error('Error logging printer1 print:', error);
      return false;
    }
  }

  /**
   * Get Printer 1 audit log entries.
   * When transactionId is provided, only entries for that transaction are returned (no limit cap).
   */
  async getPrinter1AuditLog(fromDate?: string, toDate?: string, limit: number = 100, transactionId?: string): Promise<Printer1AuditRow[]> {
    try {
      let query = 'SELECT * FROM printer1_audit_log';
      const params: QueryParam[] = [];
      const conditions: string[] = [];

      if (transactionId != null && String(transactionId).trim() !== '') {
        conditions.push('transaction_id = ?');
        params.push(String(transactionId).trim());
      }

      if (fromDate || toDate) {
        const { fromEpoch, toEpoch } = wibDateRangeEpochBounds(fromDate, toDate);
        if (fromEpoch != null) {
          conditions.push('printed_at_epoch >= ?');
          params.push(fromEpoch);
        }
        if (toEpoch != null) {
          conditions.push('printed_at_epoch <= ?');
          params.push(toEpoch);
        }
      }

      if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
      }
      query += ' ORDER BY printed_at_epoch DESC';

      // When filtering by transactionId, no limit (we need all entries for reprint count). Otherwise cap at 10000.
      if (transactionId == null || String(transactionId).trim() === '') {
        const safeLimit = typeof limit === 'number' && limit > 0 ? Math.min(Math.max(limit, 1), 10000) : 100;
        query += ` LIMIT ${safeLimit}`;
      }
      
      const results = await executeQuery<Printer1AuditRow>(query, params);
      console.log(`✅ Retrieved ${results.length} printer1 audit log entries`);
      
      // Debug: show sample entries if any
      if (results.length > 0) {
        console.log(`🔍 [Printer1AuditLog] Sample entry: printed_at_epoch=${results[0].printed_at_epoch}, transaction_id=${results[0].transaction_id}`);
      } else {
        // Check total count without filters
        const totalCount = await executeQueryOne<{ count: number }>('SELECT COUNT(*) as count FROM printer1_audit_log');
        console.log(`⚠️ [Printer1AuditLog] No results. Total entries in table: ${totalCount?.count || 0}`);
        if (totalCount && totalCount.count > 0) {
          const sampleRow = await executeQueryOne<{ printed_at_epoch: number }>('SELECT printed_at_epoch FROM printer1_audit_log ORDER BY printed_at_epoch DESC LIMIT 1');
          if (sampleRow) {
            console.log(`⚠️ [Printer1AuditLog] Latest entry epoch: ${sampleRow.printed_at_epoch} (${new Date(sampleRow.printed_at_epoch).toISOString()})`);
          }
        }
      }
      
      return results;
    } catch (error) {
      console.error('Error getting printer1 audit log:', error);
      return [];
    }
  }

  async getPrinter1AuditLogByTransactionIds(transactionIds: string[]): Promise<Printer1AuditRow[]> {
    return this.getPrinterAuditLogByTransactionIds('printer1_audit_log', transactionIds) as Promise<Printer1AuditRow[]>;
  }

  async getPrinter2AuditLogByTransactionIds(transactionIds: string[]): Promise<Printer2AuditRow[]> {
    return this.getPrinterAuditLogByTransactionIds('printer2_audit_log', transactionIds) as Promise<Printer2AuditRow[]>;
  }

  private async getPrinterAuditLogByTransactionIds(
    table: 'printer1_audit_log' | 'printer2_audit_log',
    transactionIds: string[]
  ): Promise<Array<Printer1AuditRow | Printer2AuditRow>> {
    const ids = [...new Set(transactionIds.map((id) => String(id).trim()).filter((id) => id.length > 0))];
    if (ids.length === 0) return [];

    const CHUNK = 400;
    const merged: Array<Printer1AuditRow | Printer2AuditRow> = [];

    try {
      for (let i = 0; i < ids.length; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK);
        const placeholders = chunk.map(() => '?').join(',');
        const rows = await executeQuery<Printer1AuditRow | Printer2AuditRow>(
          `SELECT * FROM ${table} WHERE transaction_id IN (${placeholders}) ORDER BY printed_at_epoch DESC`,
          chunk
        );
        merged.push(...(rows || []));
      }
      return merged;
    } catch (error) {
      console.error(`Error getting ${table} by transaction ids:`, error);
      return [];
    }
  }

  /**
   * Move transaction from Printer 1 audit log to Printer 2 audit log
   * This will:
   * 1. Get the Printer 1 audit entry
   * 2. Delete it from printer1_audit_log
   * 3. Get/increment Printer 2 daily counter
   * 4. Insert into printer2_audit_log with manual mode
   * 5. Return success and counters (for Receiptize print on the renderer)
   */
  async moveTransactionToPrinter2(
    transactionId: string,
    businessId: number,
    movedByUserId?: number | null
  ): Promise<
    | { success: true; printer2Counter: number; globalCounter: number | null }
    | { success: false; error: string }
  > {
    try {
      // Step 1: Get the Printer 1 audit entry
      const p1Entry = await executeQueryOne<Printer1AuditRow>(
        'SELECT * FROM printer1_audit_log WHERE transaction_id = ? LIMIT 1',
        [transactionId]
      );

      if (!p1Entry) {
        const msg = `Transaction ${transactionId} not found in printer1_audit_log`;
        console.error(`❌ ${msg}`);
        return { success: false, error: msg };
      }

      // Step 2: Get and increment Printer 2 daily counter
      const printer2Counter = await this.getPrinterCounter('receiptizePrinter', businessId, true);
      if (printer2Counter <= 0) {
        const msg = `Failed to get Printer 2 counter for transaction ${transactionId}`;
        console.error(`❌ ${msg}`);
        return { success: false, error: msg };
      }

      // Step 3: Insert into printer2_audit_log — preserve P1 printed_at (hari omset / bagi hasil), bukan waktu pindah.
      const printedAt = p1Entry.printed_at || toMySQLDateTime(new Date(p1Entry.printed_at_epoch));
      const printedAtEpoch = p1Entry.printed_at_epoch;

      await executeUpdate(
        `INSERT INTO printer2_audit_log 
         (transaction_id, printer2_receipt_number, print_mode, cycle_number, global_counter, printed_at, printed_at_epoch, is_reprint, reprint_count) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          transactionId,
          printer2Counter,
          'manual',
          null,
          p1Entry.global_counter,
          printedAt,
          printedAtEpoch,
          p1Entry.is_reprint || 0,
          p1Entry.reprint_count || 0
        ]
      );

      // Step 4: Delete from printer1_audit_log
      await executeUpdate(
        'DELETE FROM printer1_audit_log WHERE transaction_id = ?',
        [transactionId]
      );

      await this.logPrinterMove(transactionId, 'printer1', 'printer2', businessId, movedByUserId);

      console.log(`✅ Moved transaction ${transactionId} from Printer 1 to Printer 2 audit log (Printer 2 counter: ${printer2Counter})`);
      return {
        success: true,
        printer2Counter,
        globalCounter: p1Entry.global_counter,
      };
    } catch (error) {
      console.error(`❌ Error moving transaction ${transactionId} to Printer 2:`, error);
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: msg };
    }
  }

  /**
   * Move an audit entry from Printer 2 to Printer 1 (super admin only — enforced in frontend).
   * Deletes printer2_audit_log row, assigns next Printer 1 daily counter, inserts printer1_audit_log.
   */
  async moveTransactionToPrinter1(
    transactionId: string,
    businessId: number,
    movedByUserId?: number | null
  ): Promise<
    | { success: true; printer1Counter: number; globalCounter: number | null }
    | { success: false; error: string }
  > {
    try {
      const p2Entry = await executeQueryOne<Printer2AuditRow>(
        'SELECT * FROM printer2_audit_log WHERE transaction_id = ? LIMIT 1',
        [transactionId]
      );

      if (!p2Entry) {
        const msg = `Transaction ${transactionId} not found in printer2_audit_log`;
        console.error(`❌ ${msg}`);
        return { success: false, error: msg };
      }

      const existingP1 = await executeQueryOne<{ transaction_id: string }>(
        'SELECT transaction_id FROM printer1_audit_log WHERE transaction_id = ? LIMIT 1',
        [transactionId]
      );
      if (existingP1) {
        const msg = `Transaction ${transactionId} already exists in printer1_audit_log`;
        console.error(`❌ ${msg}`);
        return { success: false, error: msg };
      }

      const printer1Counter = await this.getPrinterCounter('receiptPrinter', businessId, true);
      if (printer1Counter <= 0) {
        const msg = `Failed to get Printer 1 counter for transaction ${transactionId}`;
        console.error(`❌ ${msg}`);
        return { success: false, error: msg };
      }

      const printedAt = p2Entry.printed_at || toMySQLDateTime(new Date(p2Entry.printed_at_epoch));
      const printedAtEpoch = p2Entry.printed_at_epoch;

      await executeUpdate(
        `INSERT INTO printer1_audit_log
         (transaction_id, printer1_receipt_number, global_counter, printed_at, printed_at_epoch, is_reprint, reprint_count)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          transactionId,
          printer1Counter,
          p2Entry.global_counter,
          printedAt,
          printedAtEpoch,
          p2Entry.is_reprint || 0,
          p2Entry.reprint_count || 0,
        ]
      );

      await executeUpdate(
        'DELETE FROM printer2_audit_log WHERE transaction_id = ?',
        [transactionId]
      );

      await this.logPrinterMove(transactionId, 'printer2', 'printer1', businessId, movedByUserId);

      console.log(`✅ Moved transaction ${transactionId} from Printer 2 to Printer 1 audit log (Printer 1 counter: ${printer1Counter})`);
      return {
        success: true,
        printer1Counter,
        globalCounter: p2Entry.global_counter,
      };
    } catch (error) {
      console.error(`❌ Error moving transaction ${transactionId} to Printer 1:`, error);
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: msg };
    }
  }

  /**
   * Get Printer 2 audit log entries.
   * When transactionId is provided, only entries for that transaction are returned (no limit cap).
   */
  async getPrinter2AuditLog(fromDate?: string, toDate?: string, limit: number = 100, transactionId?: string): Promise<Printer2AuditRow[]> {
    try {
      let query = 'SELECT * FROM printer2_audit_log';
      const params: QueryParam[] = [];
      const conditions: string[] = [];

      if (transactionId != null && String(transactionId).trim() !== '') {
        conditions.push('transaction_id = ?');
        params.push(String(transactionId).trim());
      }

      if (fromDate || toDate) {
        const { fromEpoch, toEpoch } = wibDateRangeEpochBounds(fromDate, toDate);
        if (fromEpoch != null) {
          conditions.push('printed_at_epoch >= ?');
          params.push(fromEpoch);
        }
        if (toEpoch != null) {
          conditions.push('printed_at_epoch <= ?');
          params.push(toEpoch);
        }
      }

      if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
      }
      query += ' ORDER BY printed_at_epoch DESC';

      if (transactionId == null || String(transactionId).trim() === '') {
        const safeLimit = typeof limit === 'number' && limit > 0 ? Math.min(Math.max(limit, 1), 10000) : 100;
        query += ` LIMIT ${safeLimit}`;
      }

      const results = await executeQuery<Printer2AuditRow>(query, params);
      console.log(`✅ Retrieved ${results.length} printer2 audit log entries`);

      // Debug: show sample entries if any
      if (results.length > 0) {
        console.log(`🔍 [Printer2AuditLog] Sample entry: printed_at_epoch=${results[0].printed_at_epoch}, transaction_id=${results[0].transaction_id}`);
      } else {
        // Check total count without filters
        const totalCount = await executeQueryOne<{ count: number }>('SELECT COUNT(*) as count FROM printer2_audit_log');
        console.log(`⚠️ [Printer2AuditLog] No results. Total entries in table: ${totalCount?.count || 0}`);
        if (totalCount && totalCount.count > 0) {
          const sampleRow = await executeQueryOne<{ printed_at_epoch: number }>('SELECT printed_at_epoch FROM printer2_audit_log ORDER BY printed_at_epoch DESC LIMIT 1');
          if (sampleRow) {
            console.log(`⚠️ [Printer2AuditLog] Latest entry epoch: ${sampleRow.printed_at_epoch} (${new Date(sampleRow.printed_at_epoch).toISOString()})`);
          }
        }
      }
      
      return results;
    } catch (error) {
      console.error('Error getting audit log:', error);
      return [];
    }
  }

  async logPrinterMove(
    transactionId: string,
    fromPrinter: 'printer1' | 'printer2',
    toPrinter: 'printer1' | 'printer2',
    businessId?: number | null,
    movedByUserId?: number | null
  ): Promise<void> {
    try {
      const now = toMySQLDateTime(new Date());
      const movedAtEpoch = Date.now();
      await executeUpdate(
        `INSERT INTO printer_move_log
         (transaction_id, from_printer, to_printer, business_id, moved_by_user_id, moved_at, moved_at_epoch)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          transactionId,
          fromPrinter,
          toPrinter,
          typeof businessId === 'number' ? businessId : null,
          typeof movedByUserId === 'number' ? movedByUserId : null,
          now,
          movedAtEpoch,
        ]
      );
    } catch (error) {
      console.error('Failed to log printer move:', error);
    }
  }

  async getPrinterMoveLog(options: {
    fromDate?: string;
    toDate?: string;
    limit?: number;
    offset?: number;
    businessId?: number;
  } = {}): Promise<{ entries: PrinterMoveLogRow[]; total: number }> {
    try {
      const { fromDate, toDate, limit = 50, offset = 0, businessId } = options;
      const params: QueryParam[] = [];
      const conditions: string[] = [];

      if (typeof businessId === 'number' && !Number.isNaN(businessId)) {
        conditions.push('business_id = ?');
        params.push(businessId);
      }

      if (fromDate || toDate) {
        const { fromEpoch, toEpoch } = wibDateRangeEpochBounds(fromDate, toDate);
        if (fromEpoch != null) {
          conditions.push('moved_at_epoch >= ?');
          params.push(fromEpoch);
        }
        if (toEpoch != null) {
          conditions.push('moved_at_epoch <= ?');
          params.push(toEpoch);
        }
      }

      const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
      const safeLimit =
        typeof limit === 'number' && limit > 0 ? Math.min(Math.max(Math.floor(limit), 1), 10000) : 50;
      const safeOffset =
        typeof offset === 'number' && offset > 0 ? Math.min(Math.floor(offset), 1000000) : 0;

      const countQuery = `SELECT COUNT(*) as total FROM printer_move_log${whereClause}`;
      const dataQuery = `SELECT * FROM printer_move_log${whereClause} ORDER BY moved_at_epoch DESC LIMIT ${safeLimit} OFFSET ${safeOffset}`;

      const [countRows, entries] = await Promise.all([
        executeQuery<{ total: number }>(countQuery, params),
        executeQuery<PrinterMoveLogRow>(dataQuery, params),
      ]);

      return {
        entries,
        total: Number(countRows[0]?.total ?? 0),
      };
    } catch (error) {
      console.error('Error getting printer move log:', error);
      return { entries: [], total: 0 };
    }
  }

  /**
   * Perbaiki audit P2 yang printed_at ikut hari pindah (bug lama): set ke created_at transaksi (WIB).
   * Hanya baris yang punya log P1→P2 dan hari printed_at P2 ≠ hari created_at WIB.
   */
  async repairMovedP2AuditPrintedDates(businessId?: number): Promise<{
    scanned: number;
    fixed: number;
    errors: string[];
  }> {
    const errors: string[] = [];
    let fixed = 0;
    try {
      const params: number[] = [];
      let moveQuery = `
        SELECT DISTINCT m.transaction_id
        FROM printer_move_log m
        WHERE m.from_printer = 'printer1' AND m.to_printer = 'printer2'`;
      if (typeof businessId === 'number' && !Number.isNaN(businessId)) {
        moveQuery += ' AND m.business_id = ?';
        params.push(businessId);
      }
      const moves = await executeQuery<{ transaction_id: string }>(moveQuery, params);
      for (const { transaction_id: transactionId } of moves) {
        if (!transactionId) continue;
        const tx = await executeQueryOne<{ created_at: string }>(
          'SELECT created_at FROM transactions WHERE uuid_id = ? OR CAST(id AS CHAR) = ? LIMIT 1',
          [transactionId, transactionId]
        );
        const p2 = await executeQueryOne<{ printed_at_epoch: number }>(
          'SELECT printed_at_epoch FROM printer2_audit_log WHERE transaction_id = ? LIMIT 1',
          [transactionId]
        );
        if (!tx?.created_at || !p2) continue;

        const saleDay = getCalendarDateYMDInWib(tx.created_at);
        const auditDay = getCalendarDateYMDInWib(new Date(p2.printed_at_epoch));
        if (!saleDay || saleDay === auditDay) continue;

        const printedAt = formatDateTimeForWib(tx.created_at);
        const printedAtEpoch = new Date(tx.created_at).getTime();
        if (!printedAt || !Number.isFinite(printedAtEpoch)) {
          errors.push(`${transactionId}: invalid created_at`);
          continue;
        }

        await executeUpdate(
          'UPDATE printer2_audit_log SET printed_at = ?, printed_at_epoch = ? WHERE transaction_id = ?',
          [printedAt, printedAtEpoch, transactionId]
        );
        fixed += 1;
      }
      return { scanned: moves.length, fixed, errors };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('repairMovedP2AuditPrintedDates failed:', error);
      return { scanned: 0, fixed, errors: [...errors, msg] };
    }
  }
}

