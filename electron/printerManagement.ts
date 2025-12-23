import Database from 'better-sqlite3';
import { Pool } from 'mysql2/promise';

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
};

type Printer2AuditRow = {
  transaction_id: string;
  printer2_receipt_number: number;
  print_mode: 'auto' | 'manual';
  cycle_number: number | null;
  global_counter: number | null;
  printed_at: string;
  printed_at_epoch: number;
};

type QueryParam = string | number | null;

/**
 * Printer Management Service
 * Handles multi-printer system with separate counters and automation
 */

export class PrinterManagementService {
  private db: Database.Database;
  private mysqlPool: Pool;

  constructor(database: Database.Database, mysqlPool: Pool) {
    this.db = database;
    this.mysqlPool = mysqlPool;
    this.ensureGlobalCounterColumns();
  }

  private ensureGlobalCounterColumns() {
    try {
      const printer1Cols = this.db.prepare(`PRAGMA table_info(printer1_audit_log)`).all() as TableColumnInfo[];
      const hasPrinter1Global = printer1Cols.some(col => col.name === 'global_counter');
      if (!hasPrinter1Global) {
        this.db.prepare(`ALTER TABLE printer1_audit_log ADD COLUMN global_counter INTEGER`).run();
        console.log('📋 Added printer1_audit_log.global_counter column');
      }

      // Add is_reprint column
      const hasPrinter1Reprint = printer1Cols.some(col => col.name === 'is_reprint');
      if (!hasPrinter1Reprint) {
        this.db.prepare(`ALTER TABLE printer1_audit_log ADD COLUMN is_reprint INTEGER DEFAULT 0`).run();
        console.log('📋 Added printer1_audit_log.is_reprint column');
      }

      // Add reprint_count column
      const hasPrinter1ReprintCount = printer1Cols.some(col => col.name === 'reprint_count');
      if (!hasPrinter1ReprintCount) {
        this.db.prepare(`ALTER TABLE printer1_audit_log ADD COLUMN reprint_count INTEGER DEFAULT 0`).run();
        console.log('📋 Added printer1_audit_log.reprint_count column');
      }
    } catch (error) {
      console.error('Error ensuring printer1_audit_log columns:', error);
    }

    try {
      const printer2Cols = this.db.prepare(`PRAGMA table_info(printer2_audit_log)`).all() as TableColumnInfo[];
      const hasPrinter2Global = printer2Cols.some(col => col.name === 'global_counter');
      if (!hasPrinter2Global) {
        this.db.prepare(`ALTER TABLE printer2_audit_log ADD COLUMN global_counter INTEGER`).run();
        console.log('📋 Added printer2_audit_log.global_counter column');
      }

      // Add is_reprint column
      const hasPrinter2Reprint = printer2Cols.some(col => col.name === 'is_reprint');
      if (!hasPrinter2Reprint) {
        this.db.prepare(`ALTER TABLE printer2_audit_log ADD COLUMN is_reprint INTEGER DEFAULT 0`).run();
        console.log('📋 Added printer2_audit_log.is_reprint column');
      }

      // Add reprint_count column
      const hasPrinter2ReprintCount = printer2Cols.some(col => col.name === 'reprint_count');
      if (!hasPrinter2ReprintCount) {
        this.db.prepare(`ALTER TABLE printer2_audit_log ADD COLUMN reprint_count INTEGER DEFAULT 0`).run();
        console.log('📋 Added printer2_audit_log.reprint_count column');
      }
    } catch (error) {
      console.error('Error ensuring printer2_audit_log columns:', error);
    }
  }

  /**
   * Generate 19-digit numeric UUID: [Business(3)][YYMMDD(6)][HHMMSS(6)][Seq(4)]
   */
  generateNumericUUID(businessId: number): string {
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
      const existing = this.db.prepare('SELECT counter FROM uuid_sequence_tracker WHERE key = ?').get(counterKey) as CounterRow | undefined;
      if (existing && typeof existing.counter === 'number') {
        sequence = existing.counter + 1;
        this.db.prepare('UPDATE uuid_sequence_tracker SET counter = ?, updated_at = ? WHERE key = ?').run(sequence, Date.now(), counterKey);
      } else {
        this.db.prepare('INSERT INTO uuid_sequence_tracker (key, counter, created_at, updated_at) VALUES (?, ?, ?, ?)').run(counterKey, sequence, Date.now(), Date.now());
      }
    } catch (error) {
      console.error('Error managing sequence:', error);
    }

    const businessStr = businessId.toString().padStart(3, '0');
    const seqStr = sequence.toString().padStart(4, '0');

    const uuid = `${businessStr}${date}${time}${seqStr}`;

    // Clean up old entries (keep only last 24 hours)
    try {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).getTime();
      this.db.prepare('DELETE FROM uuid_sequence_tracker WHERE created_at < ?').run(yesterday);
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
  getPrinterCounter(printerType: string, businessId: number, increment: boolean = false): number {
    // Get today's date in GMT+7 (Indonesia timezone)
    const now = new Date();
    const utc7Time = new Date(now.getTime() + (7 * 60 * 60 * 1000));
    const today = utc7Time.toISOString().split('T')[0];

    try {
      const existing = this.db.prepare('SELECT counter FROM printer_daily_counters WHERE printer_type = ? AND business_id = ? AND date = ?')
        .get(printerType, businessId, today) as CounterRow | undefined;

        if (existing && typeof existing.counter === 'number') {
        if (increment) {
          const newCounter = existing.counter + 1;
          const updateStmt = this.db.prepare('UPDATE printer_daily_counters SET counter = ?, last_reset_at = ? WHERE printer_type = ? AND business_id = ? AND date = ?');
          const updateResult = updateStmt.run(newCounter, Date.now(), printerType, businessId, today);
          console.log(`✅ Incremented ${printerType} counter from ${existing.counter} to ${newCounter} (date: ${today}, businessId: ${businessId}, rows updated: ${updateResult.changes})`);
          
          // Verify the update actually happened
          const verify = this.db.prepare('SELECT counter FROM printer_daily_counters WHERE printer_type = ? AND business_id = ? AND date = ?')
            .get(printerType, businessId, today) as CounterRow | undefined;
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
        const insertStmt = this.db.prepare('INSERT INTO printer_daily_counters (printer_type, business_id, date, counter, last_reset_at) VALUES (?, ?, ?, ?, ?)');
        const insertResult = insertStmt.run(printerType, businessId, today, counter, Date.now());
        console.log(`✅ Created new ${printerType} counter starting at ${counter} (date: ${today}, businessId: ${businessId}, increment: ${increment}, rows inserted: ${insertResult.changes})`);
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
  getPrinter2Mode(): 'auto' | 'manual' {
    try {
      const result = this.db.prepare('SELECT mode FROM printer_mode_settings WHERE printer_type = ?')
        .get('receiptizePrinter') as ModeRow | undefined;
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
  setPrinter2Mode(mode: 'auto' | 'manual'): boolean {
    try {
      const now = Date.now();
      this.db.prepare('INSERT INTO printer_mode_settings (printer_type, mode, created_at, updated_at) VALUES (?, ?, ?, ?) ' +
        'ON CONFLICT(printer_type) DO UPDATE SET mode = excluded.mode, updated_at = excluded.updated_at')
        .run('receiptizePrinter', mode, now, now);

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
  getPrinter2AutomationSelections(businessId: number): { cycleNumber: number; selections: number[] } {
    try {
      const result = this.db.prepare('SELECT cycle_number, selected_transactions FROM printer2_automation WHERE business_id = ? ORDER BY created_at DESC LIMIT 1')
        .get(businessId) as AutomationRow | undefined;

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
  savePrinter2AutomationSelections(businessId: number, cycleNumber: number, selections: number[]): boolean {
    try {
      this.db.prepare('INSERT INTO printer2_automation (business_id, cycle_number, selected_transactions, created_at) ' +
        'VALUES (?, ?, ?, ?) ON CONFLICT(business_id, cycle_number) DO UPDATE SET selected_transactions = excluded.selected_transactions')
        .run(businessId, cycleNumber, JSON.stringify(selections), Date.now());

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
  logPrinter2Print(transactionId: string, printer2ReceiptNumber: number, mode: 'auto' | 'manual', cycleNumber?: number, globalCounter?: number, isReprint: boolean = false, reprintCount: number = 0): boolean {
    try {
      // Convert to UTC+7 and format as MySQL datetime
      const utc7Date = new Date(Date.now() + 7 * 60 * 60 * 1000);
      const now = utc7Date.toISOString().slice(0, 19).replace('T', ' ');
      const printedAtEpoch = Date.now();
      this.db.prepare('INSERT INTO printer2_audit_log (transaction_id, printer2_receipt_number, print_mode, cycle_number, global_counter, printed_at, printed_at_epoch, is_reprint, reprint_count) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(
          transactionId,
          printer2ReceiptNumber,
          mode,
          cycleNumber || null,
          typeof globalCounter === 'number' ? globalCounter : null,
          now,
          printedAtEpoch,
          isReprint ? 1 : 0,
          reprintCount
        );

      console.log(`✅ Logged Printer 2 print: Transaction ${transactionId}, Receipt #${printer2ReceiptNumber}, Mode: ${mode}${isReprint ? ` (REPRINT ke-${reprintCount})` : ''}`);

      // Shadow DB (MySQL) Write - Fire and Forget
      // Note: This writes to local MySQL system_pos database
      // Foreign key constraint requires transaction to exist in system_pos.transactions first
      // If transaction doesn't exist yet, this will fail silently (expected behavior)
      this.mysqlPool.execute(
        `INSERT INTO printer2_audit_log 
         (transaction_id, printer2_receipt_number, print_mode, cycle_number, global_counter, printed_at, printed_at_epoch, is_reprint, reprint_count) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          transactionId,
          printer2ReceiptNumber,
          mode,
          cycleNumber || null,
          typeof globalCounter === 'number' ? globalCounter : null,
          now, // Use the same timestamp string
          printedAtEpoch,
          isReprint ? 1 : 0,
          reprintCount
        ]
      ).then(() => {
        console.log(`✅ [SHADOW-DB] Logged Printer 2 print to MySQL for Trans ${transactionId}`);
      }).catch(err => {
        // Foreign key constraint error is expected if transaction doesn't exist in system_pos yet
        // This will be synced later by systemPosSyncService
        if (err.code === 'ER_NO_REFERENCED_ROW_2' || err.errno === 1452) {
          console.log(`ℹ️ [SHADOW-DB] Transaction ${transactionId} not yet in system_pos, will be synced later`);
        } else {
          console.error(`❌ [SHADOW-DB] Failed to log to MySQL:`, err);
        }
      });

      return true;
    } catch (error) {
      console.error('Error logging printer2 print:', error);
      return false;
    }
  }

  /**
   * Log Printer 1 print to audit
   */
  logPrinter1Print(transactionId: string, printer1ReceiptNumber: number, globalCounter?: number, isReprint: boolean = false, reprintCount: number = 0): boolean {
    try {
      // Convert to UTC+7 and format as MySQL datetime
      const utc7Date = new Date(Date.now() + 7 * 60 * 60 * 1000);
      const now = utc7Date.toISOString().slice(0, 19).replace('T', ' ');
      this.db.prepare('INSERT INTO printer1_audit_log (transaction_id, printer1_receipt_number, global_counter, printed_at, printed_at_epoch, is_reprint, reprint_count) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(
          transactionId,
          printer1ReceiptNumber,
          typeof globalCounter === 'number' ? globalCounter : null,
          now,
          Date.now(),
          isReprint ? 1 : 0,
          reprintCount
        );
      console.log(`✅ Logged Printer 1 print: Transaction ${transactionId}, Receipt #${printer1ReceiptNumber}${isReprint ? ` (REPRINT ke-${reprintCount})` : ''}`);
      return true;
    } catch (error) {
      console.error('Error logging printer1 print:', error);
      return false;
    }
  }

  /**
   * Get Printer 1 audit log entries
   */
  getPrinter1AuditLog(fromDate?: string, toDate?: string, limit: number = 100): Printer1AuditRow[] {
    try {
      let query = 'SELECT * FROM printer1_audit_log';
      const params: QueryParam[] = [];
      let fromEpoch: number | undefined;
      let toEpoch: number | undefined;
      
      if (fromDate || toDate) {
        const conditions: string[] = [];
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
      query += ' ORDER BY printed_at_epoch DESC LIMIT ?';
      params.push(limit);
      
      console.log(`🔍 [Printer1AuditLog] Query params: fromDate=${fromDate}, toDate=${toDate}, fromEpoch=${fromEpoch}, toEpoch=${toEpoch}, limit=${limit}`);
      
      const results = this.db.prepare(query).all(...params) as Printer1AuditRow[];
      console.log(`✅ Retrieved ${results.length} printer1 audit log entries`);
      
      // Debug: show sample entries if any
      if (results.length > 0) {
        console.log(`🔍 [Printer1AuditLog] Sample entry: printed_at_epoch=${results[0].printed_at_epoch}, transaction_id=${results[0].transaction_id}`);
      } else {
        // Check total count without filters
        const totalCount = this.db.prepare('SELECT COUNT(*) as count FROM printer1_audit_log').get() as { count: number };
        console.log(`⚠️ [Printer1AuditLog] No results. Total entries in table: ${totalCount.count}`);
        if (totalCount.count > 0) {
          const sampleRow = this.db.prepare('SELECT printed_at_epoch FROM printer1_audit_log ORDER BY printed_at_epoch DESC LIMIT 1').get() as { printed_at_epoch: number } | undefined;
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

  /**
   * Get Printer 2 audit log entries
   */
  getPrinter2AuditLog(fromDate?: string, toDate?: string, limit: number = 100): Printer2AuditRow[] {
    try {
      let query = 'SELECT * FROM printer2_audit_log';
      const params: QueryParam[] = [];
      let fromEpoch: number | undefined;
      let toEpoch: number | undefined;

      if (fromDate || toDate) {
        const conditions: string[] = [];
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

      query += ' ORDER BY printed_at_epoch DESC LIMIT ?';
      params.push(limit);

      console.log(`🔍 [Printer2AuditLog] Query params: fromDate=${fromDate}, toDate=${toDate}, fromEpoch=${fromEpoch}, toEpoch=${toEpoch}, limit=${limit}`);

      const results = this.db.prepare(query).all(...params) as Printer2AuditRow[];
      console.log(`✅ Retrieved ${results.length} printer2 audit log entries`);
      
      // Debug: show sample entries if any
      if (results.length > 0) {
        console.log(`🔍 [Printer2AuditLog] Sample entry: printed_at_epoch=${results[0].printed_at_epoch}, transaction_id=${results[0].transaction_id}`);
      } else {
        // Check total count without filters
        const totalCount = this.db.prepare('SELECT COUNT(*) as count FROM printer2_audit_log').get() as { count: number };
        console.log(`⚠️ [Printer2AuditLog] No results. Total entries in table: ${totalCount.count}`);
        if (totalCount.count > 0) {
          const sampleRow = this.db.prepare('SELECT printed_at_epoch FROM printer2_audit_log ORDER BY printed_at_epoch DESC LIMIT 1').get() as { printed_at_epoch: number } | undefined;
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
}

